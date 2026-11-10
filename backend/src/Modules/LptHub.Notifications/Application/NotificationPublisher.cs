using MatterFlow.Notifications.Contracts;
using MatterFlow.Notifications.Domain;
using MatterFlow.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Notifications.Application;

/// <summary>
/// Adds notification rows to the shared unit of work (the DbContext of the running command), so the action and its notifications commit or roll
/// back together. Switches are read in one query for all candidate recipients. With the sensitive-matter rule on, a recipient who cannot see the subject
/// gets nothing (see <see cref="RecipientVisibility"/>).
/// </summary>
internal sealed class NotificationPublisher(DbContext db, IClock clock, RecipientVisibility recipients) : INotificationPublisher
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
        if (recipients.Enabled && planned.Count > 0)
        {
            // Sensitive-matter rule: only a recipient who can see the subject right now gets a notification. The command's own change (a new assignee, a new
            // manager) is flushed first, inside the command's transaction, so the check sees the state the notification is about.
            await db.SaveChangesAsync(cancellationToken);
            var seen = await recipients.VisibleAsync([.. planned.Select(p => (p.RecipientUserId, p.Request.ObjectKind, p.Request.ObjectId))], cancellationToken);
            planned = [.. planned.Where(p => seen.Contains((p.RecipientUserId, p.Request.ObjectKind, p.Request.ObjectId)))];
        }

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
