using MatterFlow.Reports.Domain.Parameters;

namespace MatterFlow.Reports.Application;

public enum ReportRunKind
{
    Run,
    Preview,
    Export,
    ChoiceQuery,
}

public enum ReportRunStatus
{
    Running,
    Succeeded,
    Failed,
    Cancelled,
    TimedOut,
    Truncated,
    Rejected,
}

/// <summary>The type of a result column, as far as the grid, sorting, filtering and CSV care.</summary>
public enum ReportColumnType
{
    Text,
    Integer,
    Decimal,
    Boolean,
    Date,
    DateTime,
}

/// <param name="Floating">For decimal columns: the source is a floating point type (float, real), kept as double instead of decimal.</param>
public sealed record ResultColumn(string Name, ReportColumnType Type, bool Floating = false);

/// <summary>The current version of an active report that the caller's role may run, as the engine needs it.</summary>
public sealed record RunnableReport(
    int ReportId,
    string Name,
    int VersionId,
    int VersionNo,
    string SqlText,
    byte[] SqlHash,
    string ParametersJson,
    int? TimeoutSeconds,
    int? MaxRows);

/// <summary>Finds what a person may run. Not found, inactive and not assigned all look the same (null): nothing leaks.</summary>
public interface IReportCatalog
{
    Task<RunnableReport?> FindRunnableAsync(int reportId, int userId, CancellationToken cancellationToken);
}

/// <summary>Receives the rows of a result while the reader streams. Returns false to stop reading (the cap is reached).</summary>
public interface IRowSink
{
    void Begin(IReadOnlyList<ResultColumn> columns);

    /// <summary>Adds one row; <c>false</c> means "enough, stop reading".</summary>
    bool TryAdd(object?[] row);
}

/// <summary>What to run: the exact text, its typed parameters and the limits.</summary>
public sealed record ExecutionRequest(
    string SqlText,
    IReadOnlyList<BoundParameter> Parameters,
    int TimeoutSeconds,
    int MaxRows,
    int RetainRows);

/// <summary>How a run ended. <see cref="AdminDetail"/> carries SQL Server's own message and is shown to administrators in preview only.</summary>
public sealed record ExecutionOutcome(
    ReportRunStatus Status,
    IReadOnlyList<ResultColumn> Columns,
    int RowCount,
    bool Truncated,
    int DurationMs,
    string? ErrorCode,
    string? AdminDetail,
    int? ErrorLine);

/// <summary>Runs one query on the read-only report connection. Never uses the application connection.</summary>
public interface IReportExecutor
{
    Task<ExecutionOutcome> ExecuteAsync(ExecutionRequest request, IRowSink sink, CancellationToken cancellationToken);
}

public sealed record RunStart(int ReportId, int VersionId, int UserId, ReportRunKind Kind, string? ParametersJson, Guid CorrelationId);

public sealed record RunCompletion(ReportRunStatus Status, int? RowCount, bool Truncated, int? DurationMs, string? ErrorCode, int? ExportedRowCount);

/// <summary>The run log (<c>dbo.ReportRun</c>): append-only, completed once.</summary>
public interface IReportRunLog
{
    /// <summary>Inserts the run as <c>Running</c> and returns its id.</summary>
    Task<long> StartAsync(RunStart start, CancellationToken cancellationToken);

    /// <summary>Writes a run that never started (refused before SQL), directly with its final status.</summary>
    Task<long> RecordRejectedAsync(RunStart start, string errorCode, CancellationToken cancellationToken);

    Task CompleteAsync(long runId, RunCompletion completion, CancellationToken cancellationToken);
}
