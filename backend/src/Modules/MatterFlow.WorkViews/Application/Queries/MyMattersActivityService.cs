using System.Text.Json;
using MatterFlow.Identity.Domain;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Visibility;
using MatterFlow.WorkManagement.Domain;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// Recent activity and the unread marker (issue #683). The events come from the audit log by matter (<c>IX_Audit_Matter</c>) and by a lower bound on the
/// event id found through the time index, so the read is bounded by the window and not by the size of the log. The log is read with plain SQL because
/// the Audit module is not a dependency of WorkViews. Only five kinds are shown (task created, status changed, reassigned, commented, manager changed);
/// a comment is the audit event "a comment was added" and its text is never read (privilege).
/// The marker is a per-person audit event id in <c>dbo.UserMatterActivitySeen</c>: the first read creates it at the newest event (nothing is unread on the first visit), only
/// <see cref="MarkSeenAsync"/> moves it, and only forward. A person's own actions are never unread.
/// </summary>
public sealed class MyMattersActivityService(MyMattersScopeResolver scopes, DbContext db, IMatterVisibility visibility, IManagedMatterScope managed)
{
    public const int WindowDays = 7;
    private const int MaxLookBackDays = 90;

    private const string TaskCreatedEvent = "TASK_CREATED";
    private const string StatusEvent = "TASK_STATUS_CHANGED";
    private const string AssignedEvent = "TASK_ASSIGNED";
    private const string CommentEvent = "COMMENT_ADDED";
    private const string ManagerEvent = "MATTER_MANAGER_CHANGED";
    private const string NormalComment = "NORMAL";

    private static readonly string[] Kinds = [TaskCreatedEvent, StatusEvent, AssignedEvent, CommentEvent, ManagerEvent];

    public async Task<Result<MyMattersActivity>> GetAsync(MyMattersActivityQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        var resolved = await scopes.ResolveAsync(query, ct);
        if (resolved.IsFailure)
            return resolved.Error!;
        var scope = resolved.Value;
        var clock = scope.Clock;
        var now = DateTime.SpecifyKind(clock.NowUtc, DateTimeKind.Utc);

        var since = scope.From is { } from ? clock.StartOfDayUtc(from) : now.AddDays(-WindowDays);
        var floor = now.AddDays(-MaxLookBackDays);
        if (since < floor)
            since = floor;
        DateTime? until = scope.To is { } to ? clock.EndOfDayUtc(to) : null;

        var seen = await EnsureSeenAsync(scope.Me, ct);
        var firstId = await db.Database.SqlQuery<long?>($"SELECT MIN(AuditEventId) AS [Value] FROM dbo.AuditEvent WHERE OccurredAtUtc >= {since}").FirstOrDefaultAsync(ct);
        if (firstId is null)
            return new MyMattersActivity(clock.ZoneId, now, since, seen, 0, 0, false, []);

        var ids = scope.Matters.Select(m => m.Id);
        var me = scope.Me;
        var from0 = firstId.Value;
        var events = db.Database.SqlQuery<AuditRow>($"""
            SELECT AuditEventId, OccurredAtUtc, ActorUserId, EventType, MatterId, TaskId, FieldKey, OldValue, NewValue, IsSensitiveScope
            FROM dbo.AuditEvent
            """)
            .Where(e => e.AuditEventId >= from0 && e.OccurredAtUtc >= since && e.MatterId != null && ids.Contains(e.MatterId.Value))
            .Where(e => Kinds.Contains(e.EventType) && (e.EventType != CommentEvent || e.NewValue == NormalComment));
        if (until is { } end)
            events = events.Where(e => e.OccurredAtUtc < end);

        // History written while a matter was sensitive stays restricted after un-marking: only for the matter's managers and see-all viewers (sensitive-matter rule).
        if (visibility.Enabled && !visibility.Current.SeeAll)
        {
            var managedIds = managed.ManagedMatterIds(me);
            events = events.Where(e => !e.IsSensitiveScope || managedIds.Contains(e.MatterId!.Value));
        }

        var unreadCount = await events.CountAsync(e => e.AuditEventId > seen && e.ActorUserId != me, ct);
        var page = await events.OrderByDescending(e => e.AuditEventId).Take(query.Take + 1).ToListAsync(ct);
        var hasMore = page.Count > query.Take;
        page = [.. page.Take(query.Take)];

        var matterIds = page.Select(e => e.MatterId!.Value).Distinct().ToList();
        var taskIds = page.Where(e => e.TaskId != null).Select(e => e.TaskId!.Value).Distinct().ToList();
        var assigned = page.Where(e => e.EventType == AssignedEvent).Select(e => (Old: ParseAssignment(e.OldValue), New: ParseAssignment(e.NewValue))).ToList();
        var userIds = page.Where(e => e.ActorUserId != null).Select(e => e.ActorUserId!.Value)
            .Concat(assigned.SelectMany(a => new[] { a.Old.UserId, a.New.UserId }).OfType<int>()).Distinct().ToList();
        var podIds = assigned.SelectMany(a => new[] { a.Old.PodId, a.New.PodId }).OfType<int>().Distinct().ToList();

        var matters = matterIds.Count == 0
            ? []
            : (await (from m in db.Set<Matter>().AsNoTracking().Where(m => matterIds.Contains(m.Id))
                      join c in db.Set<Client>().AsNoTracking() on m.ClientId equals c.Id
                      select new { m.Id, m.MatterRef, m.Name, ClientName = c.Name }).ToListAsync(ct)).ToDictionary(m => m.Id);
        var tasks = taskIds.Count == 0
            ? []
            : await db.Set<WorkTask>().AsNoTracking().Where(t => taskIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id, t => new { t.Number, t.Title }, ct);
        var users = userIds.Count == 0 ? [] : await db.Set<AppUser>().AsNoTracking().Where(u => userIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.DisplayName, ct);
        var pods = podIds.Count == 0 ? [] : await db.Set<Pod>().AsNoTracking().Where(p => podIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name, ct);

        string? Who((int? PodId, int? UserId) a) =>
            a.UserId is { } u ? users.GetValueOrDefault(u) ?? $"User {u}" : a.PodId is { } p ? pods.GetValueOrDefault(p) ?? $"Pod {p}" : null;

        var items = page.Select(e =>
        {
            var matter = matters[e.MatterId!.Value];
            var task = e.TaskId is { } tid && tasks.TryGetValue(tid, out var t) ? t : null;
            string kind;
            string? fromValue = null, toValue = null, place = null;
            switch (e.EventType)
            {
                case TaskCreatedEvent:
                    kind = ActivityKinds.TaskCreated;
                    break;
                case StatusEvent:
                    kind = ActivityKinds.StatusChanged;
                    (fromValue, toValue) = (e.OldValue, e.NewValue);
                    break;
                case AssignedEvent:
                    kind = ActivityKinds.Reassigned;
                    (fromValue, toValue) = (Who(ParseAssignment(e.OldValue)), Who(ParseAssignment(e.NewValue)));
                    break;
                case CommentEvent:
                    kind = ActivityKinds.Commented;
                    break;
                default:
                    kind = ActivityKinds.ManagerChanged;
                    (fromValue, toValue) = (e.OldValue, e.NewValue);
                    place = string.Equals(e.FieldKey, "SecondaryManager", StringComparison.OrdinalIgnoreCase) ? "secondary" : "primary";
                    break;
            }

            return new MyMattersActivityItem(
                e.AuditEventId,
                DateTime.SpecifyKind(e.OccurredAtUtc, DateTimeKind.Utc),
                kind,
                e.ActorUserId,
                e.ActorUserId is { } actor ? users.GetValueOrDefault(actor) : null,
                e.MatterId.Value,
                matter.MatterRef,
                matter.Name,
                matter.ClientName,
                e.TaskId,
                task?.Number,
                task?.Title,
                fromValue,
                toValue,
                place,
                e.AuditEventId > seen && e.ActorUserId != me);
        }).ToList();

        return new MyMattersActivity(clock.ZoneId, now, since, seen, page.Count == 0 ? 0 : page[0].AuditEventId, unreadCount, hasMore, items);
    }

    /// <summary>"Mark all as read" (or opening one item): moves the person's marker forward to <paramref name="upToEventId"/>, or to the newest audit event.</summary>
    public async Task<Result<MyMattersActivitySeen>> MarkSeenAsync(long? upToEventId, CancellationToken ct)
    {
        var resolved = await scopes.ResolveAsync(new MyMattersActivityQuery(), ct);
        if (resolved.IsFailure)
            return resolved.Error!;
        var me = resolved.Value.Me;

        await db.Database.ExecuteSqlInterpolatedAsync($"""
            DECLARE @max BIGINT = (SELECT ISNULL(MAX(AuditEventId), 0) FROM dbo.AuditEvent);
            DECLARE @to BIGINT = CASE WHEN {upToEventId} IS NULL OR {upToEventId} > @max THEN @max ELSE {upToEventId} END;
            UPDATE dbo.UserMatterActivitySeen
               SET SeenAuditEventId = CASE WHEN @to > SeenAuditEventId THEN @to ELSE SeenAuditEventId END, SeenAtUtc = SYSUTCDATETIME()
             WHERE UserId = {me};
            IF @@ROWCOUNT = 0
                INSERT dbo.UserMatterActivitySeen (UserId, SeenAuditEventId, SeenAtUtc) VALUES ({me}, @to, SYSUTCDATETIME());
            """, ct);
        var row = await db.Database.SqlQuery<SeenRow>($"SELECT SeenAuditEventId, SeenAtUtc FROM dbo.UserMatterActivitySeen WHERE UserId = {me}").FirstAsync(ct);
        return new MyMattersActivitySeen(row.SeenAuditEventId, DateTime.SpecifyKind(row.SeenAtUtc, DateTimeKind.Utc));
    }

    /// <summary>The person's marker; the first call creates it at the newest audit event so nothing is unread on the first visit.</summary>
    private async Task<long> EnsureSeenAsync(int me, CancellationToken ct)
    {
        try
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                IF NOT EXISTS (SELECT 1 FROM dbo.UserMatterActivitySeen WHERE UserId = {me})
                    INSERT dbo.UserMatterActivitySeen (UserId, SeenAuditEventId, SeenAtUtc)
                    SELECT {me}, ISNULL(MAX(AuditEventId), 0), SYSUTCDATETIME() FROM dbo.AuditEvent;
                """, ct);
        }
        catch (SqlException ex) when (ex.Number is 2627 or 2601)
        {
            // Two first requests at once: the other one created the row.
        }

        return await db.Database.SqlQuery<long>($"SELECT SeenAuditEventId AS [Value] FROM dbo.UserMatterActivitySeen WHERE UserId = {me}").FirstAsync(ct);
    }

    private static (int? PodId, int? UserId) ParseAssignment(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return (null, null);
        try
        {
            using var doc = JsonDocument.Parse(json);
            int? Read(string name) => doc.RootElement.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.Number && p.TryGetInt32(out var v) ? v : null;
            return (Read("podId"), Read("userId"));
        }
        catch (JsonException)
        {
            return (null, null);
        }
    }

    private sealed class AuditRow
    {
        public long AuditEventId { get; set; }

        public DateTime OccurredAtUtc { get; set; }

        public int? ActorUserId { get; set; }

        public string EventType { get; set; } = string.Empty;

        public int? MatterId { get; set; }

        public long? TaskId { get; set; }

        public string? FieldKey { get; set; }

        public string? OldValue { get; set; }

        public string? NewValue { get; set; }

        public bool IsSensitiveScope { get; set; }
    }

    private sealed class SeenRow
    {
        public long SeenAuditEventId { get; set; }

        public DateTime SeenAtUtc { get; set; }
    }
}
