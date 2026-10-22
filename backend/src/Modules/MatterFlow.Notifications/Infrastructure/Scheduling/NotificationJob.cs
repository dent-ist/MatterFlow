namespace MatterFlow.Notifications.Infrastructure.Scheduling;

/// <summary>What a job needs to know about this run: the instant, the firm zone and its calendar day.</summary>
public sealed record JobContext(DateTime NowUtc, TimeZoneInfo FirmZone)
{
    /// <summary>Today's calendar date in the firm zone (the definition the Dashboard uses for overdue).</summary>
    public DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(NowUtc, FirmZone));
}

/// <summary>
/// One scheduled step. Jobs are idempotent (running one twice, or concurrently, or after a restart changes nothing the second time) and
/// report how many rows they changed. An exception is logged by the scheduler and does not stop the other jobs or the service.
/// </summary>
public interface INotificationJob
{
    /// <summary>Short name for logs and the run summary.</summary>
    string Name { get; }

    /// <summary>The job runs at most this often (one tick of the timer for the due and stalled jobs, a day for retention).</summary>
    TimeSpan MinimumInterval { get; }

    /// <summary>Runs once; returns the number of rows created or deleted.</summary>
    Task<int> RunAsync(JobContext context, CancellationToken cancellationToken);
}
