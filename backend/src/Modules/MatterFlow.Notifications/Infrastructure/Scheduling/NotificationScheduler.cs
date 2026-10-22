using System.Collections.Concurrent;
using MatterFlow.SharedKernel.Time;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace MatterFlow.Notifications.Infrastructure.Scheduling;

/// <summary>What the scheduler remembers between runs, for the health check and the daily retention step. One instance per process.</summary>
public sealed class NotificationSchedulerState
{
    private readonly ConcurrentDictionary<string, DateTime> _lastRun = new(StringComparer.Ordinal);

    /// <summary>When the timer started (UTC); the health check measures from here until a first run has completed.</summary>
    public DateTime? StartedUtc { get; private set; }

    public DateTime? LastSuccessUtc { get; private set; }

    public DateTime? LastFailureUtc { get; private set; }

    public string? LastFailure { get; private set; }

    public void Started(DateTime nowUtc) => StartedUtc ??= nowUtc;

    public void Succeeded(DateTime nowUtc) => LastSuccessUtc = nowUtc;

    public void Failed(DateTime nowUtc, string what)
    {
        LastFailureUtc = nowUtc;
        LastFailure = what;
    }

    public DateTime? LastRunOf(string job) => _lastRun.TryGetValue(job, out var at) ? at : null;

    public void Ran(string job, DateTime nowUtc) => _lastRun[job] = nowUtc;
}

/// <summary>The outcome of one <see cref="NotificationScheduler.RunOnceAsync"/>.</summary>
/// <param name="Skipped">True when another run (this process or another instance) holds the application lock: nothing was executed.</param>
/// <param name="Created">Per job that ran: rows created (or deleted for retention).</param>
/// <param name="Failed">Names of the jobs that threw (logged); the other jobs still ran.</param>
public sealed record SchedulerRunResult(bool Skipped, IReadOnlyDictionary<string, int> Created, IReadOnlyList<string> Failed)
{
    public bool Succeeded => !Skipped && Failed.Count == 0;
}

/// <summary>
/// One run of the notification jobs (README section 8, issue #741). It takes the SQL Server application lock <c>Notifications.Scheduler</c>
/// without waiting, so two overlapping runs (a slow run still going, a second API instance) execute once: the late one returns "skipped". Each
/// job is isolated: an exception is logged and counted, the other jobs still run and the service stays up. This is also the deterministic
/// entry point for tests (<c>RunOnceAsync</c>); the timer in <see cref="NotificationSchedulerService"/> only calls it.
/// </summary>
public sealed class NotificationScheduler(
    DbContext db,
    IEnumerable<INotificationJob> jobs,
    IClock clock,
    IConfiguration configuration,
    NotificationSchedulerState state,
    ILogger<NotificationScheduler> logger)
{
    public const string LockResource = "Notifications.Scheduler";

    /// <param name="ignoreIntervals">True runs every job now, also the daily retention step (tests, manual runs).</param>
    public async Task<SchedulerRunResult> RunOnceAsync(CancellationToken cancellationToken = default, bool ignoreIntervals = false)
    {
        var connectionString = db.Database.GetConnectionString() ?? throw new InvalidOperationException("The notification scheduler needs a database connection.");
        await using var gate = new SqlConnection(connectionString);
        await gate.OpenAsync(cancellationToken);
        if (!await TryLockAsync(gate, cancellationToken))
        {
            logger.LogInformation("Notification scheduler: another run holds the lock, skipping this one.");
            state.Succeeded(clock.UtcNow);
            return new SchedulerRunResult(true, new Dictionary<string, int>(), []);
        }

        try
        {
            var now = clock.UtcNow;
            var context = new JobContext(now, FirmZone());
            var created = new Dictionary<string, int>();
            var failed = new List<string>();
            foreach (var job in jobs)
            {
                if (!ignoreIntervals && state.LastRunOf(job.Name) is { } last && now - last < job.MinimumInterval)
                    continue;

                try
                {
                    // Each job starts from a clean unit of work, whatever the previous one left tracked.
                    db.ChangeTracker.Clear();
                    var count = await job.RunAsync(context, cancellationToken);
                    created[job.Name] = count;
                    state.Ran(job.Name, now);
                    logger.LogInformation("Notification scheduler: {Job} finished, {Count} rows.", job.Name, count);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    failed.Add(job.Name);
                    state.Failed(clock.UtcNow, job.Name);
                    logger.LogError(ex, "Notification scheduler: {Job} failed; the other jobs continue.", job.Name);
                }
            }

            if (failed.Count == 0)
                state.Succeeded(clock.UtcNow);
            return new SchedulerRunResult(false, created, failed);
        }
        finally
        {
            await ReleaseAsync(gate);
        }
    }

    private TimeZoneInfo FirmZone() =>
        UserTimeZone.Resolve(null, configuration["Firm:TimeZoneId"]).Zone;

    private static async Task<bool> TryLockAsync(SqlConnection connection, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            DECLARE @result int;
            EXEC @result = sp_getapplock @Resource = N'Notifications.Scheduler', @LockMode = N'Exclusive', @LockOwner = N'Session', @LockTimeout = 0;
            SELECT @result;
            """;
        return Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken), System.Globalization.CultureInfo.InvariantCulture) >= 0;
    }

    private static async Task ReleaseAsync(SqlConnection connection)
    {
        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText = "EXEC sp_releaseapplock @Resource = N'Notifications.Scheduler', @LockOwner = N'Session'";
            await command.ExecuteNonQueryAsync();
        }
        catch (SqlException)
        {
            // closing the connection releases a session lock anyway
        }
    }
}
