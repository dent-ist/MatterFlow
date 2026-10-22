using MatterFlow.Notifications.Contracts;
using MatterFlow.Notifications.Domain;
using MatterFlow.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Notifications.Application;

/// <summary>
/// Adds notification rows to the shared unit of work (the DbContext of the running command), so the action and its notifications commit or roll
/// back together. Switches are read in one query for all candidate recipients.
/// </summary>
internal sealed class NotificationPublisher(DbContext db, IClock clock) : INotificationPublisher
{
    public async Task<int> PublishAsync(IReadOnlyCollection<NotificationRequest> requests, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(requests);
        var candidates = requests.SelectMany(r => r.RecipientUserIds.Where(u => u != r.ActorUserId)).Distinct().ToArray();
        if (candidates.Length == 0)
            return 0;

        // Sparse switches: only "off" rows matter (absence means on).
        var off = (await db.Set<NotificationPreference>().AsNoTracking()
                .Where(p => candidates.Contains(p.UserId) && !p.Enabled)
                .Select(p => new { p.UserId, p.EventType })
                .ToListAsync(cancellationToken))
            .Select(p => (p.UserId, p.EventType))
            .ToHashSet();

        var planned = RecipientRules.Plan(requests, (user, type) => off.Contains((user, type.Code())));
        var now = Millis(clock.UtcNow);
        foreach (var p in planned)
        {
            db.Set<Notification>().Add(new Notification
            {
                RecipientUserId = p.RecipientUserId,
                EventType = p.Request.EventType.Code(),
                ObjectKind = p.Request.ObjectKind,
                ObjectId = p.Request.ObjectId,
                MatterId = p.Request.MatterId,
                ActorUserId = p.Request.ActorUserId,
                Message = NotificationText.Limit(p.Request.Message),
                DedupeKey = p.Request.DedupeKey,
                CreatedUtc = now,
            });
        }

        return planned.Count;
    }

    private static DateTime Millis(DateTime utc) => new(utc.Ticks - (utc.Ticks % TimeSpan.TicksPerMillisecond), DateTimeKind.Utc);
}

internal static class NotificationText
{
    /// <summary>Guards the column length (the builders already stay within it).</summary>
    public static string Limit(string message) =>
        message.Length <= NotificationMessages.MaxLength ? message : message[..(NotificationMessages.MaxLength - 1)] + "…";
}
