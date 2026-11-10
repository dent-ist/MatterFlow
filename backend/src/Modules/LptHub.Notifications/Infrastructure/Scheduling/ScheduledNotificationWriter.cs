using MatterFlow.Notifications.Contracts;
using MatterFlow.Notifications.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Notifications.Infrastructure.Scheduling;

/// <summary>
/// Writes the notifications of the scheduled jobs. Like the publisher it drops the actor (none for system events), applies the switches and
/// collapses the requests of one "action" (all hits for one task and stage) to one notification per person, the lowest priority number
/// winning. Unlike the publisher it is idempotent: a row whose key (recipient, event type, object, dedupe key) exists is not written again, so a
/// repeated, overlapping or restarted run creates nothing new. Saves itself, in batches.
/// </summary>
public sealed class ScheduledNotificationWriter(DbContext db, MatterFlow.SharedKernel.Time.IClock clock, MatterFlow.Notifications.Application.RecipientVisibility recipientVisibility)
{
    /// <param name="actions">The rule hits, grouped by action (one group per task and stage).</param>
    /// <returns>The number of notification rows created.</returns>
    public async Task<int> WriteAsync(IReadOnlyList<IReadOnlyList<NotificationRequest>> actions, CancellationToken cancellationToken)
    {
        if (actions.Count == 0)
            return 0;

        var candidates = actions.SelectMany(a => a).SelectMany(r => r.RecipientUserIds).Distinct().ToArray();
        if (candidates.Length == 0)
            return 0;

        // Sparse switches: only "off" rows matter (absence means on).
        var off = (await db.Set<NotificationPreference>().AsNoTracking()
                .Where(p => candidates.Contains(p.UserId) && !p.Enabled)
                .Select(p => new { p.UserId, p.EventType })
                .ToListAsync(cancellationToken))
            .Select(p => (p.UserId, p.EventType))
            .ToHashSet();

        var planned = new List<(int Recipient, NotificationRequest Request)>();
        foreach (var action in actions)
        {
            foreach (var p in RecipientRules.Plan(action, (user, type) => off.Contains((user, type.Code()))))
                planned.Add((p.RecipientUserId, p.Request));
        }

        if (planned.Count > 0 && recipientVisibility.Enabled)
        {
            // Sensitive-matter rule: the candidate scan above reads as the system, but each recipient is checked as themselves (their own grants, never "see all").
            var seen = await recipientVisibility.VisibleAsync([.. planned.Select(p => (p.Recipient, p.Request.ObjectKind, p.Request.ObjectId))], cancellationToken);
            planned = [.. planned.Where(p => seen.Contains((p.Recipient, p.Request.ObjectKind, p.Request.ObjectId)))];
        }

        if (planned.Count == 0)
            return 0;

        var recipients = planned.Select(p => p.Recipient).Distinct().ToArray();
        var objectIds = planned.Select(p => p.Request.ObjectId).Distinct().ToArray();
        var types = planned.Select(p => p.Request.EventType.Code()).Distinct().ToArray();
        var existing = (await db.Set<Notification>().AsNoTracking()
                .Where(n => recipients.Contains(n.RecipientUserId) && types.Contains(n.EventType) && objectIds.Contains(n.ObjectId))
                .Select(n => new { n.RecipientUserId, n.EventType, n.ObjectId, n.DedupeKey })
                .ToListAsync(cancellationToken))
            .Select(n => (n.RecipientUserId, n.EventType, n.ObjectId, n.DedupeKey))
            .ToHashSet();

        var now = Millis(clock.UtcNow);
        var fresh = new List<Notification>();
        foreach (var (recipient, request) in planned)
        {
            if (!existing.Add((recipient, request.EventType.Code(), request.ObjectId, request.DedupeKey)))
                continue;

            fresh.Add(new Notification
            {
                RecipientUserId = recipient,
                EventType = request.EventType.Code(),
                ObjectKind = request.ObjectKind,
                ObjectId = request.ObjectId,
                MatterId = request.MatterId,
                ActorUserId = request.ActorUserId,
                Message = Limit(request.Message),
                DedupeKey = request.DedupeKey,
                CreatedUtc = now,
            });
        }

        if (fresh.Count == 0)
            return 0;

        db.Set<Notification>().AddRange(fresh);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return fresh.Count;
        }
        catch (DbUpdateException)
        {
            // A concurrent writer created some of the same keys (another instance without the lock, or a manual run): keep what is new.
            db.ChangeTracker.Clear();
            return await WriteOneByOneAsync(fresh, cancellationToken);
        }
    }

    private async Task<int> WriteOneByOneAsync(List<Notification> rows, CancellationToken cancellationToken)
    {
        var written = 0;
        foreach (var row in rows)
        {
            db.Set<Notification>().Add(new Notification
            {
                RecipientUserId = row.RecipientUserId,
                EventType = row.EventType,
                ObjectKind = row.ObjectKind,
                ObjectId = row.ObjectId,
                MatterId = row.MatterId,
                ActorUserId = row.ActorUserId,
                Message = row.Message,
                DedupeKey = row.DedupeKey,
                CreatedUtc = row.CreatedUtc,
            });
            try
            {
                await db.SaveChangesAsync(cancellationToken);
                written++;
            }
            catch (DbUpdateException)
            {
                db.ChangeTracker.Clear(); // that key exists already
            }
        }

        return written;
    }

    private static string Limit(string message) =>
        message.Length <= NotificationMessages.MaxLength ? message : message[..(NotificationMessages.MaxLength - 1)] + "…";

    private static DateTime Millis(DateTime utc) => new(utc.Ticks - (utc.Ticks % TimeSpan.TicksPerMillisecond), DateTimeKind.Utc);
}
