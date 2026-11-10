using System.Text.Json;

namespace LptHub.Reports.Application;

/// <summary>A column of a saved view: its place in the list is its order.</summary>
/// <param name="Name">The result column's name.</param>
/// <param name="Hidden">True when the person hid the column.</param>
/// <param name="Width">Width in pixels (80 to 640), or null for the default.</param>
public sealed record ViewColumnLayout(string Name, bool Hidden, int? Width);

/// <summary>One sort key of a saved view.</summary>
public sealed record ViewSortLayout(string Column, bool Descending);

/// <summary>One header filter of a saved view, in the form the rows endpoint takes.</summary>
public sealed record ViewFilterLayout(string Column, string Op, string? Value, string? Value2);

/// <summary>
/// The layout a saved view keeps (spec 6.1): column order, hidden columns, widths, sort, filters and page size. Never parameter values and never data.
/// It is only ever sent back to the page; nothing in it reaches SQL.
/// </summary>
public sealed record ReportViewLayout(IReadOnlyList<ViewColumnLayout>? Columns, IReadOnlyList<ViewSortLayout>? Sort, IReadOnlyList<ViewFilterLayout>? Filters, int? PageSize);

/// <summary>A saved view as the person sees it.</summary>
/// <param name="IgnoredColumns">On a save: columns the person's live result of this report does not have, left out of the stored view. Empty on a list.</param>
public sealed record ReportViewResponseModel(int ViewId, string Name, bool IsDefault, ReportViewLayout Layout, DateTime CreatedAtUtc, DateTime? ModifiedAtUtc, IReadOnlyList<string> IgnoredColumns);

public sealed record SavedViewRow(int ViewId, string Name, bool IsDefault, string ViewJson, DateTime CreatedAtUtc, DateTime? ModifiedAtUtc);

public enum ViewWrite
{
    Ok,
    NameTaken,
    LimitReached,
    NotFound,
}

/// <summary>Storage of the saved views (<c>dbo.SavedReportView</c>, application connection). Every call is bound to one person: another person's view is simply not found.</summary>
public interface IReportViewStore
{
    Task<IReadOnlyList<SavedViewRow>> ListAsync(int reportId, int userId, CancellationToken cancellationToken);

    /// <summary>Adds a view unless the person already has <paramref name="maxViews"/> for the report or the name is taken (case-insensitive); with <paramref name="isDefault"/> it becomes the only default.</summary>
    Task<(ViewWrite Result, SavedViewRow? Row)> CreateAsync(int reportId, int userId, string name, string viewJson, bool isDefault, int maxViews, CancellationToken cancellationToken);

    /// <summary>Renames and/or replaces the layout (a null argument is left as it is).</summary>
    Task<(ViewWrite Result, SavedViewRow? Row)> UpdateAsync(int viewId, int reportId, int userId, string? name, string? viewJson, CancellationToken cancellationToken);

    Task<bool> DeleteAsync(int viewId, int reportId, int userId, CancellationToken cancellationToken);

    /// <summary>Makes the view the person's only default for the report, or clears it. Null when the view is not the person's.</summary>
    Task<SavedViewRow?> SetDefaultAsync(int viewId, int reportId, int userId, bool isDefault, CancellationToken cancellationToken);
}

/// <summary>The stored JSON of a layout: web casing, a version number so the shape can grow.</summary>
internal static class ViewJson
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull };

    public static string Write(ReportViewLayout layout) => JsonSerializer.Serialize(new Stored(1, layout.Columns ?? [], layout.Sort ?? [], layout.Filters ?? [], layout.PageSize), Options);

    /// <summary>The layout of a stored row; an unreadable value gives an empty layout (the page then shows the report's default).</summary>
    public static ReportViewLayout Read(string json)
    {
        try
        {
            var stored = JsonSerializer.Deserialize<Stored>(json, Options);
            return stored is null ? new ReportViewLayout([], [], [], null) : new ReportViewLayout(stored.Columns ?? [], stored.Sort ?? [], stored.Filters ?? [], stored.PageSize);
        }
        catch (JsonException)
        {
            return new ReportViewLayout([], [], [], null);
        }
    }

    private sealed record Stored(int V, IReadOnlyList<ViewColumnLayout>? Columns, IReadOnlyList<ViewSortLayout>? Sort, IReadOnlyList<ViewFilterLayout>? Filters, int? PageSize);
}
