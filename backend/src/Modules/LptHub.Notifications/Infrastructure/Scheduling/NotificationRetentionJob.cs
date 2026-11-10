using MatterFlow.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Notifications.Infrastructure.Scheduling;

/// <summary>
/// Retention (README section 11, issue #744), once a day: read notifications older than 90 days are deleted, and so is anything older than 365
/// days even if it was never read (README Q5). Batches of 1,000 rows with a short pause between them keep locks short. Idempotent; the number of
/// deleted rows is returned (the scheduler logs it).
/// </summary>
public sealed class NotificationRetentionJob(DbContext db, Microsoft.Extensions.Options.IOptions<NotificationSchedulerOptions> options) : INotificationJob
{
    public string Name => "retention";

    public TimeSpan MinimumInterval => TimeSpan.FromHours(24);

    public async Task<int> RunAsync(JobContext context, CancellationToken cancellationToken)
    {
        var readCutoff = context.NowUtc.AddDays(-NotificationRules.ReadRetentionDays);
        var hardCutoff = context.NowUtc.AddDays(-NotificationRules.UnreadRetentionDays);
        var total = 0;
        while (true)
        {
            var deleted = await db.Database.ExecuteSqlAsync(
                $"DELETE TOP ({NotificationRules.DeleteBatch}) FROM dbo.Notification WHERE ReadUtc IS NOT NULL AND ReadUtc < {readCutoff}",
                cancellationToken);
            total += deleted;
            if (deleted < NotificationRules.DeleteBatch)
                break;

            await Pause(cancellationToken);
        }

        while (true)
        {
            var deleted = await db.Database.ExecuteSqlAsync(
                $"DELETE TOP ({NotificationRules.DeleteBatch}) FROM dbo.Notification WHERE ReadUtc IS NULL AND CreatedUtc < {hardCutoff}",
                cancellationToken);
            total += deleted;
            if (deleted < NotificationRules.DeleteBatch)
                break;

            await Pause(cancellationToken);
        }

        return total;
    }

    private Task Pause(CancellationToken cancellationToken) =>
        options.Value.RetentionBatchPauseMilliseconds > 0
            ? Task.Delay(options.Value.RetentionBatchPauseMilliseconds, cancellationToken)
            : Task.CompletedTask;
}
