using MatterFlow.Reports.Application.Results;
using MatterFlow.SharedKernel.Results;

namespace MatterFlow.Reports.Application;

/// <summary>
/// The rules a saved layout must meet before it is stored (issue #722): sizes, counts, the filter operators the rows endpoint knows, the page sizes the
/// pager offers. A column that the person's live result does not have is dropped, not refused. The stored text is only data for the page: it is never
/// used to build SQL, so there is nothing to escape, but it is still kept small and plain.
/// </summary>
public static class ReportViewLayoutRules
{
    public const int MaxNameLength = 80;
    public const int MaxViewsPerReport = 25;
    public const int MaxColumns = 200;
    public const int MaxNameOfColumn = 200;
    public const int MaxValueLength = 500;
    public const int MaxJsonLength = 16_384;
    public const int MinWidth = 80;
    public const int MaxWidth = 640;

    public static readonly IReadOnlyList<int> PageSizes = [25, 50, 100, 250];

    private static readonly HashSet<string> Operators = new(StringComparer.OrdinalIgnoreCase)
    {
        "contains", "equals", "eq", "startsWith", "gt", "lt", "gte", "lte", "between", "on", "before", "after", "onOrAfter", "onOrBefore", "blank", "notBlank",
    };

    /// <summary>The view name as it is stored (trimmed), or the field error.</summary>
    public static (string? Name, FieldError? Error) CheckName(string? name)
    {
        var trimmed = (name ?? "").Trim();
        if (trimmed.Length == 0)
            return (null, new FieldError("NAME_REQUIRED", "Enter a view name."));
        if (trimmed.Length > MaxNameLength)
            return (null, new FieldError("NAME_TOO_LONG", $"View name must be {MaxNameLength} characters or fewer."));
        if (trimmed.Any(char.IsControl))
            return (null, new FieldError("NAME_INVALID", "View name cannot contain control characters."));
        return (trimmed, null);
    }

    /// <summary>
    /// Checks the layout and returns the one to store. <paramref name="knownColumns"/> (the column names of the person's live result of this report, or
    /// null when there is none) decides which columns are kept: unknown ones are left out and listed in <c>ignored</c>.
    /// </summary>
    public static (ReportViewLayout? Layout, IReadOnlyList<string> Ignored, FieldError? Error) Sanitize(ReportViewLayout? layout, IReadOnlyCollection<string>? knownColumns)
    {
        if (layout is null)
            return (null, [], new FieldError("LAYOUT_REQUIRED", "The view has no layout."));

        var known = knownColumns is null ? null : new Dictionary<string, string>(knownColumns.Select(c => KeyValuePair.Create(c, c)), StringComparer.OrdinalIgnoreCase);
        var ignored = new List<string>();

        string? Resolve(string? name)
        {
            if (string.IsNullOrWhiteSpace(name) || name.Length > MaxNameOfColumn || name.Any(char.IsControl))
                return null;
            if (known is null)
                return name;
            if (known.TryGetValue(name, out var canonical))
                return canonical;
            if (!ignored.Contains(name, StringComparer.OrdinalIgnoreCase))
                ignored.Add(name);
            return null;
        }

        var inColumns = layout.Columns ?? [];
        if (inColumns.Count > MaxColumns)
            return Bad("COLUMNS_TOO_MANY", $"A view can hold at most {MaxColumns} columns.");
        var columns = new List<ViewColumnLayout>();
        foreach (var c in inColumns)
        {
            if (c is null || string.IsNullOrWhiteSpace(c.Name) || c.Name.Length > MaxNameOfColumn || c.Name.Any(char.IsControl))
                return Bad("COLUMN_INVALID", "A column name in the view is not valid.");
            if (c.Width is { } w && (w < MinWidth || w > MaxWidth))
                return Bad("WIDTH_INVALID", $"A column width must be between {MinWidth} and {MaxWidth}.");
            if (Resolve(c.Name) is { } name && !columns.Any(x => string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase)))
                columns.Add(new ViewColumnLayout(name, c.Hidden, c.Width));
        }

        var inSort = layout.Sort ?? [];
        if (inSort.Count > ResultQuery.MaxSortColumns)
            return Bad("SORT_TOO_MANY", $"Sort by at most {ResultQuery.MaxSortColumns} columns.");
        var sort = new List<ViewSortLayout>();
        foreach (var s in inSort)
        {
            if (s is null || string.IsNullOrWhiteSpace(s.Column) || s.Column.Length > MaxNameOfColumn)
                return Bad("SORT_INVALID", "A sort column in the view is not valid.");
            if (Resolve(s.Column) is { } name && !sort.Any(x => string.Equals(x.Column, name, StringComparison.OrdinalIgnoreCase)))
                sort.Add(new ViewSortLayout(name, s.Descending));
        }

        var inFilters = layout.Filters ?? [];
        if (inFilters.Count > ResultQuery.MaxFilters)
            return Bad("FILTERS_TOO_MANY", $"Use at most {ResultQuery.MaxFilters} filters.");
        var filters = new List<ViewFilterLayout>();
        foreach (var f in inFilters)
        {
            if (f is null || string.IsNullOrWhiteSpace(f.Column) || f.Column.Length > MaxNameOfColumn || string.IsNullOrWhiteSpace(f.Op) || !Operators.Contains(f.Op.Trim()))
                return Bad("FILTER_INVALID", "A filter in the view is not valid.");
            if ((f.Value?.Length ?? 0) > MaxValueLength || (f.Value2?.Length ?? 0) > MaxValueLength)
                return Bad("FILTER_VALUE_TOO_LONG", $"A filter value can have at most {MaxValueLength} characters.");
            if (Resolve(f.Column) is { } name)
                filters.Add(new ViewFilterLayout(name, f.Op.Trim(), f.Value, f.Value2));
        }

        if (layout.PageSize is { } size && !PageSizes.Contains(size))
            return Bad("PAGE_SIZE_INVALID", "The page size must be 25, 50, 100 or 250.");

        var clean = new ReportViewLayout(columns, sort, filters, layout.PageSize);
        if (ViewJson.Write(clean).Length > MaxJsonLength)
            return Bad("LAYOUT_TOO_LARGE", "The view is too large to save.");
        return (clean, ignored, null);

        static (ReportViewLayout?, IReadOnlyList<string>, FieldError?) Bad(string code, string message) => (null, [], new FieldError(code, message));
    }
}
