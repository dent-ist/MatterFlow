using MatterFlow.Notifications.Contracts;
using MatterFlow.Notifications.Domain;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Notifications.Application;

/// <summary>
/// The caller's switches. One switch per event type, all on by default; only "off" rows are stored, so a new event type is on for everybody
/// without a data migration. A switch is applied when a notification is created: turning it off stops future items, turning it on does not
/// backfill.
/// </summary>
public sealed class NotificationPreferenceService(DbContext db, ICurrentUser user, IClock clock)
{
    public async Task<Result<NotificationPreferencesResponse>> GetAsync(CancellationToken ct)
    {
        if (user.UserId is not { } userId)
            return Error.Unauthenticated("Sign in to see your notification settings.");

        return Build(await OffAsync(userId, ct));
    }

    public async Task<Result<NotificationPreferencesResponse>> UpdateAsync(UpdateNotificationPreferencesRequest request, CancellationToken ct)
    {
        if (user.UserId is not { } userId)
            return Error.Unauthenticated("Sign in to change your notification settings.");

        var wanted = new Dictionary<NotificationEventType, bool>();
        var errors = new Dictionary<string, IReadOnlyList<FieldError>>();
        for (var i = 0; i < request.Items.Count; i++)
        {
            var item = request.Items[i];
            var field = $"items[{i}].eventType";
            if (!NotificationEventTypes.TryParse(item.EventType, out var type) || !NotificationEventTypes.Switchable.Contains(type))
                errors[field] = [new FieldError("UNKNOWN_EVENT_TYPE", $"'{item.EventType}' is not a notification event type.")];
            else if (!wanted.TryAdd(type, item.Enabled))
                errors[field] = [new FieldError("DUPLICATE", $"'{item.EventType}' is listed twice.")];
        }

        if (errors.Count > 0)
            return Error.Validation("Some event types are not valid.", errors);

        // A concurrent first write of the same switch loses on the primary key: read again and apply once more.
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                await ApplyAsync(userId, wanted, ct);
                break;
            }
            catch (DbUpdateException) when (attempt == 0)
            {
                db.ChangeTracker.Clear();
            }
        }

        return Build(await OffAsync(userId, ct));
    }

    private async Task ApplyAsync(int userId, Dictionary<NotificationEventType, bool> wanted, CancellationToken ct)
    {
        var codes = wanted.Keys.Select(t => t.Code()).ToArray();
        var existing = await db.Set<NotificationPreference>().Where(p => p.UserId == userId && codes.Contains(p.EventType)).ToListAsync(ct);
        var now = new DateTime(clock.UtcNow.Ticks - (clock.UtcNow.Ticks % TimeSpan.TicksPerMillisecond), DateTimeKind.Utc);
        foreach (var (type, enabled) in wanted)
        {
            var row = existing.FirstOrDefault(p => p.EventType == type.Code());
            if (enabled)
            {
                if (row is not null)
                    db.Set<NotificationPreference>().Remove(row); // back to the default: no row
            }
            else if (row is null)
            {
                db.Set<NotificationPreference>().Add(new NotificationPreference { UserId = userId, EventType = type.Code(), Enabled = false, UpdatedUtc = now });
            }
            else if (row.Enabled)
            {
                row.Enabled = false;
                row.UpdatedUtc = now;
            }
        }

        await db.SaveChangesAsync(ct);
    }

    private async Task<HashSet<string>> OffAsync(int userId, CancellationToken ct) =>
        (await db.Set<NotificationPreference>().AsNoTracking().Where(p => p.UserId == userId && !p.Enabled).Select(p => p.EventType).ToListAsync(ct)).ToHashSet();

    private static NotificationPreferencesResponse Build(HashSet<string> off) =>
        new(NotificationEventTypes.Switchable
            .Select(t => new NotificationPreferenceItem(t.Code(), !off.Contains(t.Code()), t.Audience().ToString(), t.SwitchLabel()))
            .ToList());
}
