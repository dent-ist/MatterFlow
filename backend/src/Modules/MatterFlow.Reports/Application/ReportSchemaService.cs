namespace MatterFlow.Reports.Application;

/// <summary>A column the report login can read.</summary>
/// <param name="Type">SQL type as an author writes it, for example <c>nvarchar(200)</c>, <c>decimal(18,2)</c>, <c>int</c>.</param>
public sealed record SchemaColumn(string Name, string Type, bool IsNullable, bool IsPrimaryKey);

/// <summary>A table or view the report login can read (metadata only).</summary>
public sealed record SchemaTable(string Schema, string Name, bool IsView, IReadOnlyList<SchemaColumn> Columns)
{
    public string FullName => Schema + "." + Name;
}

/// <summary>Reads the metadata of the objects the report login may SELECT from. Uses the report connection, so denied tables are never listed.</summary>
public interface IReportSchemaReader
{
    /// <summary>All readable tables and views with their columns (cached for 60 seconds); null while the report login is not ready.</summary>
    Task<IReadOnlyList<SchemaTable>?> ReadAsync(CancellationToken cancellationToken);
}

/// <summary>One page of the schema browser.</summary>
public sealed record SchemaPageResult(IReadOnlyList<SchemaTable> Tables, int Total, int Page, int PageSize);

/// <summary>Search and paging over the readable schema (spec 4, 7.12): by table or column name, paged, metadata only.</summary>
public sealed class ReportSchemaService(IReportSchemaReader reader, IReportsAvailability availability)
{
    public const int DefaultPageSize = 50;
    public const int MaxPageSize = 200;

    /// <summary>Null when Reports are unavailable (503 for the caller).</summary>
    public async Task<SchemaPageResult?> SearchAsync(string? search, int page, int pageSize, CancellationToken cancellationToken)
    {
        if (!availability.Current.Enabled)
            return null;
        var all = await reader.ReadAsync(cancellationToken);
        if (all is null)
            return null;

        pageSize = Math.Clamp(pageSize <= 0 ? DefaultPageSize : pageSize, 1, MaxPageSize);
        IEnumerable<SchemaTable> matches = all;
        var term = search?.Trim();
        if (!string.IsNullOrEmpty(term))
        {
            matches = all.Where(t =>
                t.Name.Contains(term, StringComparison.OrdinalIgnoreCase)
                || t.FullName.Contains(term, StringComparison.OrdinalIgnoreCase)
                || t.Columns.Any(c => c.Name.Contains(term, StringComparison.OrdinalIgnoreCase)));
        }

        var list = matches.OrderBy(t => t.Schema, StringComparer.OrdinalIgnoreCase).ThenBy(t => t.Name, StringComparer.OrdinalIgnoreCase).ToList();
        var lastPage = Math.Max(1, (int)Math.Ceiling(list.Count / (double)pageSize));
        page = Math.Clamp(page, 1, lastPage);
        return new SchemaPageResult(list.Skip((page - 1) * pageSize).Take(pageSize).ToList(), list.Count, page, pageSize);
    }

    /// <summary>One table by <c>name</c> or <c>schema.name</c>; null when it does not exist or the login cannot read it (the same answer for both).</summary>
    public async Task<SchemaTable?> FindAsync(string name, CancellationToken cancellationToken)
    {
        if (!availability.Current.Enabled)
            return null;
        var all = await reader.ReadAsync(cancellationToken);
        var wanted = name.Trim();
        return all?.FirstOrDefault(t => string.Equals(t.FullName, wanted, StringComparison.OrdinalIgnoreCase))
            ?? all?.FirstOrDefault(t => string.Equals(t.Name, wanted, StringComparison.OrdinalIgnoreCase));
    }
}
