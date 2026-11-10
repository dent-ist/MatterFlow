using System.Linq.Expressions;
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
    /// <summary>The default window of the activity list (epic #758: 30 days; it was 7 in epic #667). A date range replaces it, at most <see cref="MaxLookBackDays"/> back.</summary>
    public const int WindowDays = 30;
    internal const int MaxLookBackDays = 90;

    internal const string TaskCreatedEvent = "TASK_CREATED";
    internal const string StatusEvent = "TASK_STATUS_CHANGED";
    internal const string AssignedEvent = "TASK_ASSIGNED";
    internal const string CommentEvent = "COMMENT_ADDED";
    internal const string ManagerEvent = "MATTER_MANAGER_CHANGED";
    internal const string FieldChangedEvent = "FIELD_CHANGED";
    internal const string NormalComment = "NORMAL";

    /// <summary>The values of the <c>kind</c> filter: the five kinds of an item, plus <c>COMPLETED</c> and <c>ON_HOLD</c> (the status changes to that status).</summary>
    public static readonly IReadOnlyList<string> KindFilters = [ActivityKinds.TaskCreated, ActivityKinds.StatusChanged, "COMPLETED", "ON_HOLD", ActivityKinds.Reassigned, ActivityKinds.Commented, ActivityKinds.ManagerChanged];

    private static readonly string[] Kinds = [TaskCreatedEvent, StatusEvent, AssignedEvent, CommentEvent, ManagerEvent];

    public async Task<Result<MyMattersActivity>> GetAsync(MyMattersActivityQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        var kinds = (query.Kind ?? []).SelectMany(k => (k ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)).Select(k => k.ToUpperInvariant()).Distinct().ToList();
        var unknown = kinds.FirstOrDefault(k => !KindFilters.Contains(k));
        if (unknown is not null)
            return Error.Validation("kind", "UNKNOWN_KIND", $"Unknown kind '{unknown}'. Allowed: {string.Join(", ", KindFilters)}.");
        var dir = string.IsNullOrWhiteSpace(query.Dir) ? "desc" : query.Dir.Trim().ToLowerInvariant();
        if (dir is not ("asc" or "desc"))
            return Error.Validation("dir", "UNKNOWN_DIR", "dir must be asc or desc.");
        var ascending = dir == "asc";

        // The Matter filter narrows the LIST only: the unread badge counts the whole window, whatever the filter says (so the scope is not narrowed by it).
        var resolved = await scopes.ResolveAsync(query, ct, matterNarrowsScope: false);
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
        var firstId = await FirstIdSinceAsync(since, ct);
        if (firstId is null)
            return new MyMattersActivity(clock.ZoneId, now, since, seen, 0, 0, 0, false, []);

        var me = scope.Me;
        var events = ScopedEvents(scope, firstId.Value, since, until);

        // The unread badge counts the whole window, whatever the matter / kind filter on the list says; the total is the list's own "of N". One statement for both.
        Expression<Func<AuditRow, bool>> isUnread = e => e.AuditEventId > seen && e.ActorUserId != me;
        var filter = ListFilter(query.MatterId, kinds, query.Unread == true ? isUnread : null);
        var counts = await events.GroupBy(_ => 1).Select(g => new { Unread = g.AsQueryable().Count(isUnread), Total = g.AsQueryable().Count(filter) }).FirstOrDefaultAsync(ct);
        var unreadCount = counts?.Unread ?? 0;
        var total = counts?.Total ?? 0;

        var listed = events.Where(filter);
        if (query.Cursor is { } cursor)
            listed = ascending ? listed.Where(e => e.AuditEventId > cursor) : listed.Where(e => e.AuditEventId < cursor);
        var ordered = ascending ? listed.OrderBy(e => e.AuditEventId) : listed.OrderByDescending(e => e.AuditEventId);
        var skip = query.Cursor is null ? (long)(query.Page - 1) * query.Take : 0;
        var page = await ordered.Skip((int)Math.Min(skip, int.MaxValue)).Take(query.Take + 1).ToListAsync(ct);
        var hasMore = page.Count > query.Take;
        page = [.. page.Take(query.Take)];
        var items = await ToItemsAsync(page, seen, me, ct);
        return new MyMattersActivity(clock.ZoneId, now, since, seen, page.Count == 0 ? 0 : page.Max(e => e.AuditEventId), unreadCount, total, hasMore, items, hasMore ? page[^1].AuditEventId : null);
    }

    /// <summary>The matter, kind and unread filters of the list as one predicate (ANDed; no filter matches everything). The matter narrows the list only, never the unread badge.</summary>
    private static Expression<Func<AuditRow, bool>> ListFilter(int? matterId, IReadOnlyCollection<string> kinds, Expression<Func<AuditRow, bool>>? unread)
    {
        var parameter = Expression.Parameter(typeof(AuditRow), "e");
        Expression body = Expression.Constant(true);
        void And(LambdaExpression part) => body = Expression.AndAlso(body, new ReplaceParameter(part.Parameters[0], parameter).Visit(part.Body)!);
        if (matterId is { } onlyMatter)
            And((Expression<Func<AuditRow, bool>>)(e => e.MatterId == onlyMatter));
        if (kinds.Count > 0)
            And(KindPredicate(kinds));
        if (unread is not null)
            And(unread);
        return Expression.Lambda<Func<AuditRow, bool>>(body, parameter);
    }

    /// <summary>The smallest audit event id written at or after <paramref name="since"/> (a seek of the time index), or null when there is none; it bounds every read of the log.</summary>
    internal Task<long?> FirstIdSinceAsync(DateTime since, CancellationToken ct) =>
        db.Database.SqlQuery<long?>($"SELECT MIN(AuditEventId) AS [Value] FROM dbo.AuditEvent WHERE OccurredAtUtc >= {since}").FirstOrDefaultAsync(ct);

    /// <summary>
    /// The audit events of the scope's matters from event id <paramref name="fromId"/> on, of the five kinds (ordinary comments only), with the sensitive-matter rule applied: history
    /// written while a matter was sensitive stays restricted after un-marking, only for the matter's managers and see-all viewers.
    /// </summary>
    internal IQueryable<AuditRow> ScopedEvents(MyMattersScope scope, long fromId, DateTime since, DateTime? until, IReadOnlyCollection<string>? eventTypes = null)
    {
        var types = eventTypes ?? Kinds;
        var ids = scope.Matters.Select(m => m.Id);
        var events = db.Database.SqlQuery<AuditRow>($"""
            SELECT AuditEventId, OccurredAtUtc, ActorUserId, EventType, MatterId, TaskId, FieldKey, OldValue, NewValue, IsSensitiveScope
            FROM dbo.AuditEvent
            """)
            .Where(e => e.AuditEventId >= fromId && e.OccurredAtUtc >= since && e.MatterId != null && ids.Contains(e.MatterId.Value))
            .Where(e => types.Contains(e.EventType) && (e.EventType != CommentEvent || e.NewValue == NormalComment));
        if (until is { } end)
            events = events.Where(e => e.OccurredAtUtc < end);

        if (visibility.Enabled && !visibility.Current.SeeAll)
        {
            var managedIds = managed.ManagedMatterIds(scope.Me);
            events = events.Where(e => !e.IsSensitiveScope || managedIds.Contains(e.MatterId!.Value));
        }

        return events;
    }

    /// <summary>The predicate of a list of <c>kind</c> filter values, ORed.</summary>
    internal static Expression<Func<AuditRow, bool>> KindPredicate(IReadOnlyCollection<string> kinds)
    {
        var parameter = Expression.Parameter(typeof(AuditRow), "e");
        Expression? body = null;
        foreach (var kind in kinds)
        {
            Expression<Func<AuditRow, bool>> test = kind switch
            {
                ActivityKinds.TaskCreated => e => e.EventType == TaskCreatedEvent,
                ActivityKinds.StatusChanged => e => e.EventType == StatusEvent,
                "COMPLETED" => e => e.EventType == StatusEvent && e.NewValue == "COMPLETED",
                "ON_HOLD" => e => e.EventType == StatusEvent && e.NewValue == "ON_HOLD",
                ActivityKinds.Reassigned => e => e.EventType == AssignedEvent,
                ActivityKinds.Commented => e => e.EventType == CommentEvent && e.NewValue == NormalComment,
                _ => e => e.EventType == ManagerEvent,
            };
            var rewritten = new ReplaceParameter(test.Parameters[0], parameter).Visit(test.Body)!;
            body = body is null ? rewritten : Expression.OrElse(body, rewritten);
        }

        return Expression.Lambda<Func<AuditRow, bool>>(body ?? Expression.Constant(true), parameter);
    }

    private sealed class ReplaceParameter(ParameterExpression from, Expression to) : ExpressionVisitor
    {
        protected override Expression VisitParameter(ParameterExpression node) => node == from ? to : base.VisitParameter(node);
    }

    /// <summary>Names the page: matters and clients, tasks, people and pods, one statement each (none when the page does not need them), and builds the structured items.</summary>
    internal async Task<List<MyMattersActivityItem>> ToItemsAsync(List<AuditRow> page, long seen, int me, CancellationToken ct)
    {
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

        return page.Select(e =>
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
               SET SeenAuditEventId = CASE WHEN @to > SeenAuditEventId THEN @to ELSE SeenAuditEventId END, SeenAtUtc = SYSUTCDATETIME(), IsInitial = 0
             WHERE UserId = {me};
            IF @@ROWCOUNT = 0
                INSERT dbo.UserMatterActivitySeen (UserId, SeenAuditEventId, SeenAtUtc, IsInitial) VALUES ({me}, @to, SYSUTCDATETIME(), 0);
            """, ct);
        var row = await db.Database.SqlQuery<SeenRow>($"SELECT SeenAuditEventId, SeenAtUtc FROM dbo.UserMatterActivitySeen WHERE UserId = {me}").FirstAsync(ct);
        return new MyMattersActivitySeen(row.SeenAuditEventId, DateTime.SpecifyKind(row.SeenAtUtc, DateTimeKind.Utc));
    }

    /// <summary>The person's marker; the first call creates it at the newest audit event so nothing is unread on the first visit. That starting point is flagged <c>IsInitial</c>: "Since your last visit" ignores it until the person marks activity as read (issue #815).</summary>
    internal async Task<long> EnsureSeenAsync(int me, CancellationToken ct)
    {
        try
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                IF NOT EXISTS (SELECT 1 FROM dbo.UserMatterActivitySeen WHERE UserId = {me})
                    INSERT dbo.UserMatterActivitySeen (UserId, SeenAuditEventId, SeenAtUtc, IsInitial)
                    SELECT {me}, ISNULL(MAX(AuditEventId), 0), SYSUTCDATETIME(), 1 FROM dbo.AuditEvent;
                """, ct);
        }
        catch (SqlException ex) when (ex.Number is 2627 or 2601)
        {
            // Two first requests at once: the other one created the row.
        }

        return await db.Database.SqlQuery<long>($"SELECT SeenAuditEventId AS [Value] FROM dbo.UserMatterActivitySeen WHERE UserId = {me}").FirstAsync(ct);
    }

    /// <summary>The person's marker as an audit event id and the instant it was set (the feed's "unread" is time based, so assets and states can be unread too).</summary>
    internal async Task<(long EventId, DateTime AtUtc)> EnsureSeenWithTimeAsync(int me, CancellationToken ct)
    {
        var eventId = await EnsureSeenAsync(me, ct);
        var at = await db.Database.SqlQuery<DateTime>($"SELECT SeenAtUtc AS [Value] FROM dbo.UserMatterActivitySeen WHERE UserId = {me}").FirstAsync(ct);
        return (eventId, DateTime.SpecifyKind(at, DateTimeKind.Utc));
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

    internal sealed class AuditRow
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
