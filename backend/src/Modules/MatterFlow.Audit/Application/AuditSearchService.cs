using System.Globalization;
using MatterFlow.Audit.Contracts;
using MatterFlow.Audit.Domain;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Audit.Application;

/// <summary>Filters of the audit browser. Dates are calendar days in the viewer's time zone (<c>yyyy-MM-dd</c>); <c>To</c> is inclusive.</summary>
public sealed record AuditSearchFilter(
    string? ObjectType,
    string? ObjectId,
    int? ActorUserId,
    string? EventType,
    string? From,
    string? To,
    string? Text,
    Guid? CorrelationId,
    long? Cursor,
    int PageSize);

/// <summary>Who did it: the user id and, when the user is known, the display name. A null id is the system.</summary>
public sealed record AuditActor(int? UserId, string DisplayName);

/// <summary>The audited object with a readable label when it could be resolved (otherwise <see cref="Label"/> is null and the id is shown).</summary>
public sealed record AuditObjectInfo(string Type, string Id, string? Label);

/// <summary>One row of the browser.</summary>
/// <param name="AuditEventId">Event id (also the paging cursor).</param>
/// <param name="OccurredAtUtc">When it happened (UTC); the client shows it in the viewer's zone.</param>
/// <param name="Actor">Who did it; the system for events without an actor.</param>
/// <param name="EventType">Event code, for example <c>TASK_STATUS_CHANGED</c>.</param>
/// <param name="Object">The audited object.</param>
/// <param name="MatterId">Matter the event is scoped to, if any.</param>
/// <param name="TaskId">Task the event is scoped to, if any (comments, steps and links point to their Task).</param>
/// <param name="FieldKey">Changed field, if any.</param>
/// <param name="Summary">Readable sentence.</param>
/// <param name="OldValue">Previous value (full, up to 4000 characters), masked when secret.</param>
/// <param name="NewValue">New value, as above.</param>
/// <param name="OldValueTruncated">True when the old value was cut for display.</param>
/// <param name="NewValueTruncated">True when the new value was cut for display.</param>
/// <param name="ValuesRedacted">True when a value was masked because it is or looks like a secret.</param>
/// <param name="CorrelationId">Shared by every event of one operation (a bulk action's events).</param>
/// <param name="CorrelationEventCount">How many events share the correlation id.</param>
public sealed record AuditSearchItem(
    long AuditEventId,
    DateTime OccurredAtUtc,
    AuditActor Actor,
    string EventType,
    AuditObjectInfo Object,
    int? MatterId,
    long? TaskId,
    string? FieldKey,
    string Summary,
    string? OldValue,
    string? NewValue,
    bool OldValueTruncated,
    bool NewValueTruncated,
    bool ValuesRedacted,
    Guid CorrelationId,
    int CorrelationEventCount);

/// <summary>A page of the audit browser, newest first.</summary>
/// <param name="Items">Events, newest first.</param>
/// <param name="NextCursor">Pass as <c>cursor</c> for the next (older) page; null on the last page.</param>
/// <param name="PageSize">The page size actually used (capped).</param>
/// <param name="TimeZone">IANA zone the date filters were interpreted in.</param>
public sealed record AuditSearchPage(IReadOnlyList<AuditSearchItem> Items, long? NextCursor, int PageSize, string TimeZone);

/// <summary>Object types and event types that occur in the audit trail, to fill the browser's filter lists.</summary>
public sealed record AuditFacets(IReadOnlyList<string> ObjectTypes, IReadOnlyList<string> EventTypes);

/// <summary>Searches the append-only audit trail for the admin audit browser (read only; the trail is never written here).</summary>
public sealed class AuditSearchService(DbContext db, IAuditDisplayLookup display, IUserTimeZone timeZone)
{
    public const int DefaultPageSize = 50;
    public const int MaxPageSize = 200;

    private const char LikeEscape = '\\';

    public async Task<AuditSearchPage> SearchAsync(AuditSearchFilter filter, CancellationToken cancellationToken)
    {
        var size = Math.Clamp(filter.PageSize <= 0 ? DefaultPageSize : filter.PageSize, 1, MaxPageSize);
        var query = db.Set<AuditEvent>().AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(filter.ObjectType))
        {
            var type = filter.ObjectType.Trim();
            query = query.Where(e => e.ObjectType == type);
        }

        if (!string.IsNullOrWhiteSpace(filter.ObjectId))
        {
            if (string.IsNullOrWhiteSpace(filter.ObjectType))
                Fail("objectId", "An object id needs an object type.");
            var id = filter.ObjectId.Trim();
            query = query.Where(e => e.ObjectId == id);
        }

        if (filter.ActorUserId is { } actor)
            query = query.Where(e => e.ActorUserId == actor);

        if (!string.IsNullOrWhiteSpace(filter.EventType))
        {
            var eventType = filter.EventType.Trim();
            query = query.Where(e => e.EventType == eventType);
        }

        if (filter.CorrelationId is { } correlation)
            query = query.Where(e => e.CorrelationId == correlation);

        var from = ParseDay(filter.From, "from");
        var to = ParseDay(filter.To, "to");
        if (from is not null && to is not null && from > to)
            Fail("from", "The start date must not be after the end date.");
        if (from is { } f)
        {
            var fromUtc = timeZone.ToUtc(f.ToDateTime(TimeOnly.MinValue));
            query = query.Where(e => e.OccurredAtUtc >= fromUtc);
        }

        if (to is { } t)
        {
            // Inclusive day in the viewer's zone: everything before local midnight of the next day.
            var beforeUtc = timeZone.ToUtc(t.AddDays(1).ToDateTime(TimeOnly.MinValue));
            query = query.Where(e => e.OccurredAtUtc < beforeUtc);
        }

        if (!string.IsNullOrWhiteSpace(filter.Text))
        {
            var pattern = "%" + EscapeLike(filter.Text.Trim()) + "%";
            query = query.Where(e => EF.Functions.Like(e.Summary!, pattern, "\\") || EF.Functions.Like(e.FieldKey!, pattern, "\\"));
        }

        if (filter.Cursor is { } cursor)
            query = query.Where(e => e.Id < cursor);

        var rows = await query.OrderByDescending(e => e.Id).Take(size + 1).ToListAsync(cancellationToken);
        var hasMore = rows.Count > size;
        var page = rows.Take(size).ToList();

        return new AuditSearchPage(await ToItemsAsync(page, cancellationToken), hasMore ? page[^1].Id : null, size, timeZone.Id);
    }

    public async Task<AuditFacets> FacetsAsync(CancellationToken cancellationToken)
    {
        var set = db.Set<AuditEvent>().AsNoTracking();
        var objectTypes = await set.Select(e => e.ObjectType).Distinct().OrderBy(x => x).ToListAsync(cancellationToken);
        var eventTypes = await set.Select(e => e.EventType).Distinct().OrderBy(x => x).ToListAsync(cancellationToken);
        return new AuditFacets(objectTypes, eventTypes);
    }

    private async Task<IReadOnlyList<AuditSearchItem>> ToItemsAsync(List<AuditEvent> rows, CancellationToken cancellationToken)
    {
        if (rows.Count == 0)
            return [];

        var userIds = rows.Where(r => r.ActorUserId is not null).Select(r => r.ActorUserId!.Value).Distinct().ToList();
        var names = await display.UserNamesAsync(userIds, cancellationToken);
        var refs = rows.Select(r => new AuditObjectRef(r.ObjectType, r.ObjectId)).Distinct().ToList();
        var labels = await display.ObjectLabelsAsync(refs, cancellationToken);

        var correlationIds = rows.Select(r => r.CorrelationId).Distinct().ToList();
        var counts = await db.Set<AuditEvent>()
            .AsNoTracking()
            .Where(e => correlationIds.Contains(e.CorrelationId))
            .GroupBy(e => e.CorrelationId)
            .Select(g => new { Id = g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.Id, g => g.Count, cancellationToken);

        return rows.Select(r => ToItem(r, names, labels, counts)).ToList();
    }

    private static AuditSearchItem ToItem(
        AuditEvent e,
        IReadOnlyDictionary<int, string> names,
        IReadOnlyDictionary<AuditObjectRef, string> labels,
        IReadOnlyDictionary<Guid, int> counts)
    {
        var sensitive = AuditValueGuard.IsSensitiveKey(e.FieldKey);
        var oldValue = AuditValueGuard.Guard(e.OldValue, sensitive, out var oldTruncated, out var oldRedacted);
        var newValue = AuditValueGuard.Guard(e.NewValue, sensitive, out var newTruncated, out var newRedacted);
        var redacted = oldRedacted || newRedacted;

        var summarySecret = AuditValueGuard.LooksLikeSecret(e.Summary);
        var summary = AuditSummaryComposer.Compose(e.EventType, e.FieldKey, oldValue, newValue, summarySecret ? null : e.Summary, redacted);

        var actor = e.ActorUserId is { } uid
            ? new AuditActor(uid, names.TryGetValue(uid, out var name) ? name : $"User {uid.ToString(CultureInfo.InvariantCulture)}")
            : new AuditActor(null, "System");

        labels.TryGetValue(new AuditObjectRef(e.ObjectType, e.ObjectId), out var label);

        return new AuditSearchItem(
            e.Id,
            DateTime.SpecifyKind(e.OccurredAtUtc, DateTimeKind.Utc),
            actor,
            e.EventType,
            new AuditObjectInfo(e.ObjectType, e.ObjectId, label),
            e.MatterId,
            e.TaskId,
            e.FieldKey,
            summary,
            oldValue,
            newValue,
            oldTruncated,
            newTruncated,
            redacted,
            e.CorrelationId,
            counts.TryGetValue(e.CorrelationId, out var count) ? count : 1);
    }

    private static DateOnly? ParseDay(string? text, string field)
    {
        if (string.IsNullOrWhiteSpace(text))
            return null;
        if (DateOnly.TryParseExact(text.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day))
            return day;
        Fail(field, "Use a date in the form yyyy-MM-dd.");
        return null;
    }

    private static string EscapeLike(string text) =>
        text.Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("%", "\\%", StringComparison.Ordinal)
            .Replace("_", "\\_", StringComparison.Ordinal)
            .Replace("[", "\\[", StringComparison.Ordinal);

    private static void Fail(string field, string message) =>
        Result.Failure(Error.Validation(field, "invalid", message)).OrThrow();
}
