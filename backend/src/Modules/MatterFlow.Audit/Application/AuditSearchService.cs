using System.Globalization;
using MatterFlow.Audit.Contracts;
using MatterFlow.Audit.Domain;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace MatterFlow.Audit.Application;

/// <summary>Filters of the audit browser. Dates are calendar days in the viewer's time zone (<c>yyyy-MM-dd</c>); <c>To</c> is inclusive.</summary>
public sealed record AuditSearchFilter(
    string? ObjectType,
    string? ObjectId,
    IReadOnlyCollection<int>? ActorUserIds,
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
/// <param name="TaskLabel">Readable label of the Task the event is scoped to (for example <c>TSK-1042 Process Smith custodians</c>), when it could be resolved; lets the browser say "Workflow step of TSK-1042" instead of a step id.</param>
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
    int CorrelationEventCount,
    string? TaskLabel = null);

/// <summary>A page of the audit browser, newest first.</summary>
/// <param name="Items">Events, newest first.</param>
/// <param name="NextCursor">Pass as <c>cursor</c> for the next (older) page; null on the last page.</param>
/// <param name="PageSize">The page size actually used (capped).</param>
/// <param name="TimeZone">IANA zone the date filters were interpreted in.</param>
public sealed record AuditSearchPage(IReadOnlyList<AuditSearchItem> Items, long? NextCursor, int PageSize, string TimeZone);

/// <summary>Object types and event types that occur in the audit trail the caller may see, to fill the browser's filter lists.</summary>
public sealed record AuditFacets(IReadOnlyList<string> ObjectTypes, IReadOnlyList<string> EventTypes);

/// <summary>Searches the append-only audit trail for the admin audit browser (read only; the trail is never written here).</summary>
public sealed class AuditSearchService(DbContext db, IAuditDisplayLookup display, IUserTimeZone timeZone, AuditVisibility visibility)
{
    public const int DefaultPageSize = 50;
    public const int MaxPageSize = 200;

    private const char LikeEscape = '\\';

    public async Task<AuditSearchPage> SearchAsync(AuditSearchFilter filter, CancellationToken cancellationToken)
    {
        var size = Math.Clamp(filter.PageSize <= 0 ? DefaultPageSize : filter.PageSize, 1, MaxPageSize);
        // The sensitive-matter rule applies first (epic #788): hidden events are not rows, totals, facets or labels for this caller.
        var query = visibility.Apply(db.Set<AuditEvent>().AsNoTracking());

        if (!string.IsNullOrWhiteSpace(filter.ObjectType))
        {
            // One type, or several separated by commas (a group of related types): any of them.
            string[] types = [.. filter.ObjectType.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct()];
            if (types.Length > 1 && !string.IsNullOrWhiteSpace(filter.ObjectId))
                Fail("objectId", "An object id needs one object type.");
            if (types.Length == 1)
                query = query.Where(e => e.ObjectType == types[0]);
            else if (types.Length > 1)
                query = query.Where(e => types.Contains(e.ObjectType));
        }

        if (!string.IsNullOrWhiteSpace(filter.ObjectId))
        {
            if (string.IsNullOrWhiteSpace(filter.ObjectType))
                Fail("objectId", "An object id needs an object type.");
            var id = filter.ObjectId.Trim();
            query = query.Where(e => e.ObjectId == id);
        }

        if (filter.ActorUserIds is { Count: > 0 } actors)
        {
            int[] actorIds = [.. actors.Distinct()];
            query = actorIds.Length == 1
                ? query.Where(e => e.ActorUserId == actorIds[0])
                : query.Where(e => e.ActorUserId != null && actorIds.Contains(e.ActorUserId.Value));
        }

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
            var beforeUtc = t == DateOnly.MaxValue ? DateTime.SpecifyKind(DateTime.MaxValue, DateTimeKind.Utc) : timeZone.ToUtc(t.AddDays(1).ToDateTime(TimeOnly.MinValue));
            query = query.Where(e => e.OccurredAtUtc < beforeUtc);
        }

        if (!string.IsNullOrWhiteSpace(filter.Text))
        {
            // Lower-cased and compared in a binary collation: the same matches as the case-insensitive collation, about five times cheaper per row on this table.
            var pattern = "%" + EscapeLike(filter.Text.Trim().ToLowerInvariant()) + "%";
            query = query.Where(e => EF.Functions.Like(EF.Functions.Collate(e.Summary!.ToLower(), "Latin1_General_100_BIN2"), pattern, "\\")
                || EF.Functions.Like(EF.Functions.Collate(e.FieldKey!.ToLower(), "Latin1_General_100_BIN2"), pattern, "\\"));
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
        // DISTINCT over the whole trail reads every index entry (half a million and growing). A skip scan jumps from one value to the next with an
        // index seek instead (IX_Audit_Object and IX_Audit_EventType both lead with the column): a few dozen seeks however many events there are.
        var filter = await visibility.FacetFilterAsync(cancellationToken);
        var objectTypes = await DistinctBySkipScanAsync("ObjectType", filter, cancellationToken);
        var eventTypes = await DistinctBySkipScanAsync("EventType", filter, cancellationToken);
        return new AuditFacets(objectTypes, eventTypes);
    }

    /// <summary>
    /// The distinct values of an indexed leading column in order, by skip scan: one batch that repeatedly asks for the next value above the last one
    /// (an index seek each). Only called with constant column names. A plain command on the context's connection, because EF cannot compose a batch.
    /// </summary>
    private async Task<IReadOnlyList<string>> DistinctBySkipScanAsync(string column, (string Declarations, string Predicate) filter, CancellationToken cancellationToken)
    {
        var sql = $"""
            SET NOCOUNT ON;
            {filter.Declarations}
            DECLARE @r TABLE (Value VARCHAR(100) PRIMARY KEY);
            DECLARE @v VARCHAR(100) = (SELECT MIN(a.{column}) FROM dbo.AuditEvent a WHERE 1 = 1{filter.Predicate});
            WHILE @v IS NOT NULL
            BEGIN
                INSERT @r (Value) VALUES (@v);
                SET @v = (SELECT MIN(a.{column}) FROM dbo.AuditEvent a WHERE a.{column} > @v{filter.Predicate});
            END;
            SELECT Value FROM @r ORDER BY Value;
            """;
        await db.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            await using var command = db.Database.GetDbConnection().CreateCommand();
            command.CommandText = sql;
            if (db.Database.GetCommandTimeout() is { } timeout)
                command.CommandTimeout = timeout;
            if (db.Database.CurrentTransaction is { } transaction)
                command.Transaction = transaction.GetDbTransaction();

            var values = new List<string>();
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
                values.Add(reader.GetString(0));

            return values;
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
    }

    private async Task<IReadOnlyList<AuditSearchItem>> ToItemsAsync(List<AuditEvent> rows, CancellationToken cancellationToken)
    {
        if (rows.Count == 0)
            return [];

        var assignments = rows.Where(r => r.EventType == AuditEventTypes.TaskAssigned).ToList();
        var assigned = assignments.SelectMany(r => new[] { r.OldValue, r.NewValue }).Select(AuditAssignmentText.Parse).ToList();
        var userIds = rows
            .Where(r => r.ActorUserId is not null)
            .Select(r => r.ActorUserId!.Value)
            .Concat(assigned.Where(a => a.UserId is not null).Select(a => a.UserId!.Value))
            .Distinct()
            .ToList();
        var names = await display.UserNamesAsync(userIds, cancellationToken);
        var podIds = assigned.Where(a => a.PodId is not null).Select(a => a.PodId!.Value).Distinct().ToList();
        var pods = podIds.Count == 0 ? new Dictionary<int, string>() : await display.PodNamesAsync(podIds, cancellationToken);
        // The Tasks the events belong to are labelled too, so a step, comment or form answer can say which Task it is part of.
        var refs = rows
            .Select(r => new AuditObjectRef(r.ObjectType, r.ObjectId))
            .Concat(rows.Where(r => r.TaskId is not null).Select(r => new AuditObjectRef("Task", r.TaskId!.Value.ToString(CultureInfo.InvariantCulture))))
            .Distinct()
            .ToList();
        var labels = new Dictionary<AuditObjectRef, string>(await display.ObjectLabelsAsync(refs, cancellationToken));
        await AddStoredNamesAsync(refs, labels, cancellationToken);

        var correlationIds = rows.Select(r => r.CorrelationId).Distinct().ToList();
        var counts = await visibility.Apply(db.Set<AuditEvent>().AsNoTracking())
            .Where(e => correlationIds.Contains(e.CorrelationId))
            .GroupBy(e => e.CorrelationId)
            .Select(g => new { Id = g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.Id, g => g.Count, cancellationToken);

        return rows.Select(r => ToItem(r, names, pods, labels, counts)).ToList();
    }

    /// <summary>The Administration records that carry their own name in the events (field <c>Name</c>, <c>Label</c> or <c>DisplayLabel</c>).</summary>
    private static readonly string[] NamedTypes = ["AssetType", "Priority", "StatusLabel", "AssetLinkRole", "Role"];

    private static readonly string[] NameFields = ["Name", "Label", "DisplayLabel"];

    /// <summary>
    /// A record that was deleted (a priority or link role nobody used) has no row any more: it keeps the last name its events stored. One
    /// statement for the whole page, whatever the number of events (#649).
    /// </summary>
    private async Task AddStoredNamesAsync(IReadOnlyList<AuditObjectRef> refs, Dictionary<AuditObjectRef, string> labels, CancellationToken cancellationToken)
    {
        var missing = refs.Where(r => NamedTypes.Contains(r.ObjectType) && !labels.ContainsKey(r)).ToList();
        if (missing.Count == 0)
            return;

        var types = missing.Select(r => r.ObjectType).Distinct().ToList();
        var ids = missing.Select(r => r.ObjectId).Distinct().ToList();
        var events = await db.Set<AuditEvent>()
            .AsNoTracking()
            .Where(e => types.Contains(e.ObjectType) && ids.Contains(e.ObjectId) && e.FieldKey != null && NameFields.Contains(e.FieldKey))
            .OrderByDescending(e => e.Id)
            .Select(e => new { e.ObjectType, e.ObjectId, e.NewValue, e.OldValue })
            .ToListAsync(cancellationToken);
        foreach (var e in events)
        {
            var key = new AuditObjectRef(e.ObjectType, e.ObjectId);
            var name = e.NewValue ?? e.OldValue;
            if (!string.IsNullOrWhiteSpace(name) && missing.Contains(key) && !labels.ContainsKey(key))
                labels[key] = name;
        }
    }

    private static AuditSearchItem ToItem(
        AuditEvent e,
        IReadOnlyDictionary<int, string> names,
        IReadOnlyDictionary<int, string> pods,
        IReadOnlyDictionary<AuditObjectRef, string> labels,
        IReadOnlyDictionary<Guid, int> counts)
    {
        var sensitive = AuditValueGuard.IsSensitiveKey(e.FieldKey);
        var oldValue = AuditValueGuard.Guard(e.OldValue, sensitive, out var oldTruncated, out var oldRedacted);
        var newValue = AuditValueGuard.Guard(e.NewValue, sensitive, out var newTruncated, out var newRedacted);
        var redacted = oldRedacted || newRedacted;

        var summarySecret = AuditValueGuard.LooksLikeSecret(e.Summary);
        var summary = AuditSummaryComposer.Compose(e.EventType, e.FieldKey, oldValue, newValue, summarySecret ? null : e.Summary, redacted);

        if (e.EventType == AuditEventTypes.TaskAssigned && !redacted)
            summary = AuditAssignmentText.Describe(oldValue, newValue, names, pods);

        var actor = e.ActorUserId is { } uid
            ? new AuditActor(uid, names.TryGetValue(uid, out var name) ? name : $"User {uid.ToString(CultureInfo.InvariantCulture)}")
            : new AuditActor(null, "System");

        labels.TryGetValue(new AuditObjectRef(e.ObjectType, e.ObjectId), out var label);
        string? taskLabel = null;
        if (e.TaskId is { } scopedTask)
            labels.TryGetValue(new AuditObjectRef("Task", scopedTask.ToString(CultureInfo.InvariantCulture)), out taskLabel);

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
            counts.TryGetValue(e.CorrelationId, out var count) ? count : 1,
            taskLabel);
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
