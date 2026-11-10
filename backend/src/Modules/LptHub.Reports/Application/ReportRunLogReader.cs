namespace MatterFlow.Reports.Application;

/// <summary>Filters of the run log (all optional).</summary>
/// <param name="Before">Cursor: only runs with a smaller id (older).</param>
public sealed record RunLogQuery(int? ReportId, string? Status, string? Kind, int? UserId, long? Before, int PageSize);

/// <summary>One run in the log, with the parameter values as they were bound (long values shortened).</summary>
public sealed record RunLogItem(
    long RunId,
    int ReportId,
    string ReportName,
    int VersionNo,
    int UserId,
    string UserName,
    DateTime StartedAtUtc,
    DateTime? FinishedAtUtc,
    string Status,
    string Kind,
    int? RowCount,
    bool Truncated,
    int? DurationMs,
    string? ErrorCode,
    IReadOnlyList<string> Parameters);

public sealed record RunLogPage(IReadOnlyList<RunLogItem> Items, long? NextBefore);

/// <summary>Reads the append-only run log for administrators (<c>Report.Manage</c>).</summary>
public interface IReportRunLogReader
{
    Task<RunLogPage> ListAsync(RunLogQuery query, CancellationToken cancellationToken);
}
