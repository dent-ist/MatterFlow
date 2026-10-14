namespace MatterFlow.SharedKernel.Paging;

/// <summary>
/// Limits on the read endpoints that scan large tables (task queues, My Work, Pod Work, search, audit browser, dashboard), section <c>Queries</c>.
/// A query that runs longer than <see cref="ReadCommandTimeoutSeconds"/> is cancelled by SQL Server and answered with 503 <c>QUERY_TIMEOUT</c>, so one
/// pathological filter cannot hold a connection (security review 2, SEC2-03).
/// </summary>
public sealed class ReadQueryOptions
{
    public const string SectionName = "Queries";

    /// <summary>Command timeout of those reads in seconds (default 15; 0 keeps the provider default of 30 seconds).</summary>
    public int ReadCommandTimeoutSeconds { get; set; } = 15;
}
