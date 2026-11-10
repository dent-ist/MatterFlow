using System.Text;
using MatterFlow.Audit.Contracts;
using MatterFlow.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>An export ready to send: the bytes (CSV with its byte order mark), the content type and a file name.</summary>
public sealed record ExportFile(byte[] Content, string ContentType, string FileName, int RowCount);

/// <summary>
/// Export of the Task Queue (PM v2, #879): exactly the rows the screen lists for the same filters and sort, all pages, at most
/// <see cref="ListExport.RowCap"/> (more is refused, not cut). The rows come from <see cref="TaskQueueService"/>, so every row has passed the
/// sensitive-matter rule and the PM scope; one <c>EXPORT_RUN</c> audit event records the surface, the row count and the filters (no data).
/// </summary>
public sealed class TaskQueueExportService(TaskQueueService queue, IAuditWriter audit, DbContext db)
{
    private static readonly string[] Header =
    [
        "Task", "Title", "Matter", "Matter name", "Client", "Task type", "Workflow", "Priority", "Status", "On-hold reason", "Assignee", "Pod",
        "Due date", "Due at (UTC)", "ASAP", "Overdue", "At risk", "Created (UTC)", "Updated (UTC)", "Closed (UTC)",
    ];

    private static IReadOnlyList<string?> Cells(TaskQueueRow r) =>
    [
        r.TaskNumber, r.Title, r.MatterRef, r.MatterName, r.ClientName, r.TaskTypeName, r.WorkflowName, r.Priority.Label, r.StatusLabel,
        r.OnHoldReasonName, r.AssignedUser?.DisplayName, r.AssignedPod?.Name, ListExport.Iso(r.DueDate), ListExport.Iso(r.DueAtUtc),
        r.IsAsap ? "yes" : "no", r.IsOverdue ? "yes" : "no", r.AtRisk ? "yes" : "no", ListExport.Iso(r.CreatedAtUtc), ListExport.Iso(r.UpdatedAtUtc), ListExport.Iso(r.ClosedAtUtc),
    ];

    public async Task<Result<ExportFile>> ExportAsync(TaskQueueListQuery query, string format, string filterSummary, CancellationToken ct)
    {
        var rows = await queue.ExportRowsAsync(query, ct);
        if (rows.IsFailure)
            return rows.Error!;

        var text = ListExport.Build(format, Header, rows.Value.Select(Cells));
        var body = Encoding.UTF8.GetBytes(text);
        var bytes = format == ListExport.Csv ? [.. Encoding.UTF8.GetPreamble(), .. body] : body;

        audit.Write(new AuditEntry
        {
            EventType = "EXPORT_RUN",
            ObjectType = "Export",
            ObjectId = ListExport.SurfaceTaskQueue,
            FieldKey = format,
            NewValue = rows.Value.Count.ToString(System.Globalization.CultureInfo.InvariantCulture),
            Summary = Trim($"Exported {rows.Value.Count} rows of the Task Queue ({format}). Filters: {(filterSummary.Length == 0 ? "none" : filterSummary)}"),
        });
        await db.SaveChangesAsync(ct);
        return new ExportFile(bytes, ListExport.ContentType(format), format == ListExport.Csv ? "task-queue.csv" : "task-queue.txt", rows.Value.Count);
    }

    /// <summary>Records an export made in the browser from rows the person already sees (My Matters sections, Breakdown): the surface, the count and the filters, never the data.</summary>
    public async Task<Result> LogAsync(string surface, string format, int rowCount, string? filters, CancellationToken ct)
    {
        var allowed = new[] { "my-matters.attention", "my-matters.deadlines", "my-matters.breakdown", ListExport.SurfaceAssetReport, ListExport.SurfaceTaskQueue };
        if (!allowed.Contains(surface))
            return Error.Validation("surface", "UNKNOWN_SURFACE", "Unknown export surface.");
        if (rowCount is < 0 or > ListExport.RowCap)
            return Error.Validation("rowCount", "RANGE", $"rowCount must be between 0 and {ListExport.RowCap}.");
        audit.Write(new AuditEntry
        {
            EventType = "EXPORT_RUN",
            ObjectType = "Export",
            ObjectId = surface,
            FieldKey = ListExport.FormatOf(format),
            NewValue = rowCount.ToString(System.Globalization.CultureInfo.InvariantCulture),
            Summary = Trim($"Exported {rowCount} rows of {surface} ({ListExport.FormatOf(format)}). Filters: {(string.IsNullOrWhiteSpace(filters) ? "none" : filters.Trim())}"),
        });
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    private static string Trim(string value) => value.Length <= 500 ? value : value[..500];
}
