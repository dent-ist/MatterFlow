using System.Globalization;
using System.Text.Json;

namespace MatterFlow.Reports.Application.Results;

/// <summary>A filter on one column of the result, from the grid's header filters (spec 11).</summary>
/// <param name="Column">Column name.</param>
/// <param name="Op">text: contains, equals, startsWith; number: eq, gt, lt, between; date: on, before, after, between; yes/no: eq; any: blank, notBlank.</param>
/// <param name="Value">The operand as text (a number, <c>yyyy-MM-dd</c>, true/false or a search text).</param>
/// <param name="Value2">The upper bound of <c>between</c>.</param>
public sealed record ResultFilter(string Column, string Op, string? Value, string? Value2);

public sealed record ResultSort(string Column, bool Descending);

/// <summary>One page of a result after filtering and sorting.</summary>
/// <param name="Rows">The cells of the page, in column order.</param>
/// <param name="TotalRows">Rows in the whole result.</param>
/// <param name="FilteredRows">Rows left after the filters (the number the pager counts).</param>
public sealed record ResultPage(IReadOnlyList<IReadOnlyList<object?>> Rows, int TotalRows, int FilteredRows, int Page, int PageSize);

/// <summary>A malformed sort or filter (unknown column, operator not valid for the type, unreadable value).</summary>
public sealed class ResultQueryException(string message) : Exception(message);

/// <summary>
/// Server-side filter, stable sort and paging over a <see cref="ResultTable"/> (spec 6.4, 11). Nulls come last ascending and first descending;
/// text compares case-insensitively; numbers and dates compare by value. Filtering produces row indexes, sorting orders those indexes, and the
/// result of the last combination is cached on the table so paging through it is a slice.
/// </summary>
public static class ResultQuery
{
    public const int MaxSortColumns = 3;
    public const int MaxFilters = 20;
    public const int MaxPageSize = 250;

    public static IReadOnlyList<ResultSort> ParseSort(string? text, ResultTable table)
    {
        if (string.IsNullOrWhiteSpace(text))
            return [];
        var sorts = new List<ResultSort>();
        foreach (var part in text.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            var colon = part.LastIndexOf(':');
            var name = colon < 0 ? part : part[..colon];
            var direction = colon < 0 ? "asc" : part[(colon + 1)..].ToLowerInvariant();
            if (table.IndexOf(name) < 0)
                throw new ResultQueryException($"Unknown column '{Short(name)}'.");
            if (direction is not ("asc" or "desc"))
                throw new ResultQueryException("Sort direction must be asc or desc.");
            if (sorts.Any(s => string.Equals(s.Column, name, StringComparison.OrdinalIgnoreCase)))
                continue;
            sorts.Add(new ResultSort(table.Columns[table.IndexOf(name)].Name, direction == "desc"));
        }

        if (sorts.Count > MaxSortColumns)
            throw new ResultQueryException($"Sort by at most {MaxSortColumns} columns.");
        return sorts;
    }

    public static IReadOnlyList<ResultFilter> ParseFilters(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return [];
        List<ResultFilter>? filters;
        try
        {
            filters = JsonSerializer.Deserialize<List<ResultFilter>>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        }
        catch (JsonException)
        {
            throw new ResultQueryException("The filter is not valid JSON.");
        }

        filters ??= [];
        if (filters.Count > MaxFilters)
            throw new ResultQueryException($"Use at most {MaxFilters} filters.");
        return filters;
    }

    public static ResultPage Page(ResultTable table, IReadOnlyList<ResultFilter> filters, IReadOnlyList<ResultSort> sorts, int page, int pageSize)
    {
        pageSize = Math.Clamp(pageSize, 1, MaxPageSize);
        var order = Order(table, filters, sorts);
        var pages = Math.Max(1, (order.Length + pageSize - 1) / pageSize);
        page = Math.Clamp(page, 1, pages);
        var start = (page - 1) * pageSize;
        var take = Math.Min(pageSize, order.Length - start);
        var rows = new List<IReadOnlyList<object?>>(Math.Max(take, 0));
        for (var i = 0; i < take; i++)
        {
            var row = order[start + i];
            var cells = new object?[table.Columns.Count];
            for (var c = 0; c < cells.Length; c++)
                cells[c] = table.Get(row, c);
            rows.Add(cells);
        }

        return new ResultPage(rows, table.RowCount, order.Length, page, pageSize);
    }

    /// <summary>The row indexes that pass the filters, in sort order. Also what the CSV export walks.</summary>
    public static int[] Order(ResultTable table, IReadOnlyList<ResultFilter> filters, IReadOnlyList<ResultSort> sorts)
    {
        var key = CacheKey(filters, sorts);
        if (table.TryGetCachedOrder(key, out var cached))
            return cached;

        var compiled = filters.Select(f => Compile(table, f)).ToList();
        int[] indexes;
        if (compiled.Count == 0)
        {
            indexes = new int[table.RowCount];
            for (var i = 0; i < indexes.Length; i++)
                indexes[i] = i;
        }
        else
        {
            var list = new List<int>(table.RowCount);
            for (var i = 0; i < table.RowCount; i++)
            {
                var keep = true;
                foreach (var predicate in compiled)
                {
                    if (!predicate(i))
                    {
                        keep = false;
                        break;
                    }
                }

                if (keep)
                    list.Add(i);
            }

            indexes = list.ToArray();
        }

        if (sorts.Count > 0)
        {
            var columns = sorts.Select(s => (Data: table.Data(table.IndexOf(s.Column)), s.Descending)).ToArray();
            // Stable: ties keep their original order (the index is the last sort key).
            Array.Sort(indexes, (a, b) =>
            {
                foreach (var (data, descending) in columns)
                {
                    var c = data.Compare(a, b);
                    if (c != 0)
                        return descending ? -c : c;
                }

                return a.CompareTo(b);
            });
        }

        table.CacheOrder(key, indexes);
        return indexes;
    }

    private static string CacheKey(IReadOnlyList<ResultFilter> filters, IReadOnlyList<ResultSort> sorts) =>
        string.Join("|", sorts.Select(s => s.Column.ToUpperInvariant() + (s.Descending ? "-" : "+")))
        + "#" + string.Join("|", filters.Select(f => $"{f.Column.ToUpperInvariant()}:{f.Op}:{f.Value}:{f.Value2}"));

    // ---- filters ----

    private static Func<int, bool> Compile(ResultTable table, ResultFilter filter)
    {
        var index = table.IndexOf(filter.Column ?? "");
        if (index < 0)
            throw new ResultQueryException($"Unknown column '{Short(filter.Column ?? "")}'.");
        var column = table.Columns[index];
        var data = table.Data(index);
        var op = (filter.Op ?? "").Trim();

        if (op.Equals("blank", StringComparison.OrdinalIgnoreCase))
            return row => data.IsNull(row) || (data is TextColumn t && string.IsNullOrWhiteSpace(t[row]));
        if (op.Equals("notBlank", StringComparison.OrdinalIgnoreCase))
            return row => !data.IsNull(row) && !(data is TextColumn t && string.IsNullOrWhiteSpace(t[row]));

        switch (data)
        {
            case TextColumn text:
                return CompileText(text, op, filter.Value ?? "", column.Name);
            case LongColumn l:
                return CompileNumber(row => l.IsNull(row) ? null : l[row], op, filter, column.Name);
            case DecimalColumn d:
                return CompileNumber(row => d.IsNull(row) ? null : d[row], op, filter, column.Name);
            case DoubleColumn db:
                return CompileNumber(row => db.IsNull(row) ? null : (decimal?)SafeDecimal(db[row]), op, filter, column.Name);
            case BoolColumn b:
                return CompileBool(b, op, filter, column.Name);
            case TicksColumn ticks:
                return CompileDate(ticks, op, filter, column.Name);
            default:
                throw new ResultQueryException("This column cannot be filtered.");
        }
    }

    private static decimal SafeDecimal(double value) => value is > 7.9e28 or < -7.9e28 ? (value > 0 ? decimal.MaxValue : decimal.MinValue) : (decimal)value;

    private static Func<int, bool> CompileText(TextColumn column, string op, string value, string name) => op.ToLowerInvariant() switch
    {
        "contains" => row => !column.IsNull(row) && column[row]!.Contains(value, StringComparison.OrdinalIgnoreCase),
        "equals" or "eq" => row => !column.IsNull(row) && string.Equals(column[row], value, StringComparison.OrdinalIgnoreCase),
        "startswith" => row => !column.IsNull(row) && column[row]!.StartsWith(value, StringComparison.OrdinalIgnoreCase),
        _ => throw new ResultQueryException($"'{Short(op)}' is not a text filter for '{Short(name)}'."),
    };

    private static Func<int, bool> CompileNumber(Func<int, decimal?> get, string op, ResultFilter filter, string name)
    {
        decimal Number(string? text, string what)
        {
            if (!decimal.TryParse(text, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var v))
                throw new ResultQueryException($"{what} for '{Short(name)}' is not a number.");
            return v;
        }

        switch (op.ToLowerInvariant())
        {
            case "eq":
                var eq = Number(filter.Value, "The value");
                return row => get(row) is { } v && v == eq;
            case "gt":
                var gt = Number(filter.Value, "The value");
                return row => get(row) is { } v && v > gt;
            case "lt":
                var lt = Number(filter.Value, "The value");
                return row => get(row) is { } v && v < lt;
            case "between":
                var lo = Number(filter.Value, "The lower value");
                var hi = Number(filter.Value2, "The upper value");
                if (hi < lo)
                    (lo, hi) = (hi, lo);
                return row => get(row) is { } v && v >= lo && v <= hi;
            default:
                throw new ResultQueryException($"'{Short(op)}' is not a number filter for '{Short(name)}'.");
        }
    }

    private static Func<int, bool> CompileBool(BoolColumn column, string op, ResultFilter filter, string name)
    {
        if (!op.Equals("eq", StringComparison.OrdinalIgnoreCase))
            throw new ResultQueryException($"'{Short(op)}' is not a yes/no filter for '{Short(name)}'.");
        var wanted = filter.Value?.ToLowerInvariant() switch
        {
            "true" or "yes" => true,
            "false" or "no" => false,
            _ => throw new ResultQueryException($"The value for '{Short(name)}' must be true or false."),
        };
        return row => !column.IsNull(row) && column[row] == wanted;
    }

    private static Func<int, bool> CompileDate(TicksColumn column, string op, ResultFilter filter, string name)
    {
        DateTime Date(string? text, string what)
        {
            if (!DateTime.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var v))
                throw new ResultQueryException($"{what} for '{Short(name)}' must be a date written yyyy-MM-dd.");
            return v.Date;
        }

        long Day(int row) => new DateTime(column[row]).Date.Ticks;

        switch (op.ToLowerInvariant())
        {
            case "on":
                var on = Date(filter.Value, "The date").Ticks;
                return row => !column.IsNull(row) && Day(row) == on;
            case "before":
                var before = Date(filter.Value, "The date").Ticks;
                return row => !column.IsNull(row) && Day(row) < before;
            case "after":
                var after = Date(filter.Value, "The date").Ticks;
                return row => !column.IsNull(row) && Day(row) > after;
            case "between":
                var from = Date(filter.Value, "The first date").Ticks;
                var to = Date(filter.Value2, "The second date").Ticks;
                if (to < from)
                    (from, to) = (to, from);
                return row => !column.IsNull(row) && Day(row) >= from && Day(row) <= to;
            default:
                throw new ResultQueryException($"'{Short(op)}' is not a date filter for '{Short(name)}'.");
        }
    }

    private static string Short(string text) => text.Length <= 40 ? text : text[..40] + "...";
}
