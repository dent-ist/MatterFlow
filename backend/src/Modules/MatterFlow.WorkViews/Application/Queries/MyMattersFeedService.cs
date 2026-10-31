using System.Globalization;
using System.Linq.Expressions;
using MatterFlow.Assets.Domain;
using MatterFlow.Configuration.Domain;
using MatterFlow.Identity.Domain;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// The six-kind recent activity feed (UI-03, #956): New assets, New comments, New status updates, On hold, Overdue, Due date updated. The event kinds come from assets (created) and the
/// audit log of the scope's visible matters (the sensitive history rule of <see cref="MyMattersActivityService"/>); On hold and Overdue are the CURRENT state of the scope's tasks (Overdue =
/// New or In Progress and past due, On Hold is never overdue). Each source is read once for its top items and counted once, so the statement count does not depend on the number of matters;
/// the sources are merged in memory (page times page size is capped at 500). Unread = after the person's marker and not their own doing.
/// </summary>
public sealed class MyMattersFeedService(MyMattersScopeResolver scopes, MyMattersActivityService activity, DbContext db)
{
    /// <summary>One candidate item before it is named.</summary>
    internal sealed class FeedRow
    {
        public long Id { get; init; }

        public DateTime At { get; init; }

        public int? Actor { get; init; }

        public int MatterId { get; init; }

        public long? TaskId { get; init; }

        public int? AssetId { get; init; }

        public string? Old { get; init; }

        public string? New { get; init; }
    }

    public async Task<Result<MyMattersFeed>> GetAsync(MyMattersFeedQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        var wanted = new List<string>();
        foreach (var code in (query.Kind ?? []).SelectMany(FilterParsing.SplitList))
        {
            var kind = code.Trim().ToUpperInvariant();
            if (!FeedKinds.All.Contains(kind))
                return Error.Validation("kind", "UNKNOWN_KIND", $"Unknown kind '{code}'. Allowed: {string.Join(", ", FeedKinds.All)}.");
            if (!wanted.Contains(kind))
                wanted.Add(kind);
        }

        if (wanted.Count == 0)
            wanted = [.. FeedKinds.All];
        if ((long)query.Page * query.PageSize > MyMattersFeedQuery.MaxItems)
            return Error.Validation("page", "PAGE_TOO_DEEP", $"page times pageSize may not exceed {MyMattersFeedQuery.MaxItems}. Narrow the kinds or the window.");

        var resolved = await scopes.ResolveAsync(query, ct);
        if (resolved.IsFailure)
            return resolved.Error!;
        var scope = resolved.Value;
        var clock = scope.Clock;
        var me = scope.Me;
        var now = DateTime.SpecifyKind(clock.NowUtc, DateTimeKind.Utc);
        var since = now.AddDays(-query.Days);

        var (_, seenAt) = await activity.EnsureSeenWithTimeAsync(me, ct);
        var sources = await BuildSourcesAsync(scope, since, ct);

        Expression<Func<FeedRow, bool>> isUnread = r => r.At > seenAt && r.Actor != me;
        var counts = new Dictionary<string, int>();
        var totals = new Dictionary<string, (int All, int Unread)>();
        foreach (var kind in FeedKinds.All)
        {
            var source = sources[kind];
            var c = source is null
                ? null
                : await source.GroupBy(_ => 1).Select(g => new { All = g.Count(), Unread = g.AsQueryable().Count(isUnread) }).FirstOrDefaultAsync(ct);
            totals[kind] = (c?.All ?? 0, c?.Unread ?? 0);
            counts[kind] = c?.All ?? 0;
        }

        var unreadAll = totals.Values.Sum(t => t.Unread);
        var total = wanted.Sum(k => query.Unread == true ? totals[k].Unread : totals[k].All);

        var take = query.Page * query.PageSize;
        var candidates = new List<(string Kind, FeedRow Row)>();
        foreach (var kind in wanted)
        {
            var source = sources[kind];
            if (source is null || totals[kind].All == 0)
                continue;
            var rows = query.Unread == true ? source.Where(isUnread) : source;
            var top = await rows.OrderByDescending(r => r.At).ThenByDescending(r => r.Id).Take(take).ToListAsync(ct);
            candidates.AddRange(top.Select(r => (kind, r)));
        }

        var page = candidates
            .OrderByDescending(c => c.Row.At)
            .ThenBy(c => FeedKinds.All.ToList().IndexOf(c.Kind))
            .ThenByDescending(c => c.Row.Id)
            .Skip((query.Page - 1) * query.PageSize)
            .Take(query.PageSize)
            .ToList();

        var items = await NameAsync(page, seenAt, me, clock, ct);
        return new MyMattersFeed(now, clock.ZoneId, since, seenAt, unreadAll, total, query.Page, query.PageSize, counts, items);
    }

    private async Task<Dictionary<string, IQueryable<FeedRow>?>> BuildSourcesAsync(MyMattersScope scope, DateTime since, CancellationToken ct)
    {
        var clock = scope.Clock;
        var matterIds = scope.Matters.Select(m => m.Id);
        var sources = new Dictionary<string, IQueryable<FeedRow>?>
        {
            [FeedKinds.NewAssets] = db.Set<Asset>().AsNoTracking().Where(a => matterIds.Contains(a.MatterId) && a.CreatedAtUtc >= since)
                .Select(a => new FeedRow { Id = a.Id, At = a.CreatedAtUtc, Actor = a.CreatedByUserId, MatterId = a.MatterId, AssetId = a.Id }),
            [FeedKinds.OnHold] = scope.Tasks().Where(t => t.Status == MatterFlow.SharedKernel.Tasks.TaskStatusCode.OnHold)
                .Select(t => new FeedRow { Id = t.Id, At = t.StatusChangedAtUtc, Actor = null, MatterId = t.MatterId, TaskId = t.Id }),
            [FeedKinds.Overdue] = scope.Tasks().Where(ShowFilter.Active).Where(TaskQueueRules.Overdue(clock))
                .Select(t => new FeedRow { Id = t.Id, At = t.DueAtUtc ?? t.DueSortKey ?? t.CreatedAtUtc, Actor = null, MatterId = t.MatterId, TaskId = t.Id }),
            [FeedKinds.NewStatusUpdates] = null,
            [FeedKinds.NewComments] = null,
            [FeedKinds.DueDateUpdated] = null,
        };

        var firstId = await activity.FirstIdSinceAsync(since, ct);
        if (firstId is { } from)
        {
            var events = activity.ScopedEvents(scope, from, since, null, [MyMattersActivityService.StatusEvent, MyMattersActivityService.CommentEvent, MyMattersActivityService.FieldChangedEvent]);
            sources[FeedKinds.NewStatusUpdates] = events.Where(e => e.EventType == MyMattersActivityService.StatusEvent && e.NewValue != "ON_HOLD" && e.TaskId != null).Select(Project());
            sources[FeedKinds.NewComments] = events.Where(e => e.EventType == MyMattersActivityService.CommentEvent && e.TaskId != null).Select(Project());
            sources[FeedKinds.DueDateUpdated] = events.Where(e => e.EventType == MyMattersActivityService.FieldChangedEvent && e.FieldKey == "dueDate" && e.TaskId != null).Select(Project());
        }

        return sources;
    }

    private static Expression<Func<MyMattersActivityService.AuditRow, FeedRow>> Project() =>
        e => new FeedRow { Id = e.AuditEventId, At = e.OccurredAtUtc, Actor = e.ActorUserId, MatterId = e.MatterId!.Value, TaskId = e.TaskId, Old = e.OldValue, New = e.NewValue };

    private async Task<List<MyMattersFeedItem>> NameAsync(List<(string Kind, FeedRow Row)> page, DateTime seenAt, int me, QueueClock clock, CancellationToken ct)
    {
        if (page.Count == 0)
            return [];

        var matterIds = page.Select(p => p.Row.MatterId).Distinct().ToList();
        var taskIds = page.Where(p => p.Row.TaskId != null).Select(p => p.Row.TaskId!.Value).Distinct().ToList();
        var assetIds = page.Where(p => p.Row.AssetId != null).Select(p => p.Row.AssetId!.Value).Distinct().ToList();
        var userIds = page.Where(p => p.Row.Actor != null).Select(p => p.Row.Actor!.Value).Distinct().ToList();

        var matters = (await (from m in db.Set<Matter>().AsNoTracking().Where(m => matterIds.Contains(m.Id))
                              join c in db.Set<Client>().AsNoTracking() on m.ClientId equals c.Id
                              select new { m.Id, m.MatterRef, m.Name, ClientId = c.Id, ClientName = c.Name }).ToListAsync(ct)).ToDictionary(m => m.Id);
        var tasks = taskIds.Count == 0
            ? []
            : await db.Set<WorkTask>().AsNoTracking().Where(t => taskIds.Contains(t.Id))
                .Select(t => new
                {
                    t.Id,
                    t.Number,
                    t.Title,
                    t.DueDate,
                    t.StatusChangedAtUtc,
                    Reason = t.OnHoldReasonId == null ? null : db.Set<OnHoldReason>().Where(r => r.Id == t.OnHoldReasonId).Select(r => r.Name).FirstOrDefault(),
                }).ToDictionaryAsync(t => t.Id, ct);
        var assets = assetIds.Count == 0
            ? []
            : await (from a in db.Set<Asset>().AsNoTracking().Where(a => assetIds.Contains(a.Id))
                     join t in db.Set<AssetType>().AsNoTracking() on a.AssetTypeId equals t.Id
                     select new { a.Id, a.DisplayName, TypeName = t.Name }).ToDictionaryAsync(a => a.Id, ct);
        var users = userIds.Count == 0 ? [] : await db.Set<AppUser>().AsNoTracking().Where(u => userIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.DisplayName, ct);

        static DateOnly? ParseDate(string? text) =>
            DateOnly.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;

        return page.Select(p =>
        {
            var (kind, r) = p;
            var matter = matters[r.MatterId];
            var task = r.TaskId is { } tid && tasks.TryGetValue(tid, out var t) ? t : null;
            var asset = r.AssetId is { } aid && assets.TryGetValue(aid, out var a) ? a : null;
            var at = DateTime.SpecifyKind(r.At, DateTimeKind.Utc);
            return new MyMattersFeedItem(
                $"{kind}:{r.Id.ToString(CultureInfo.InvariantCulture)}",
                kind,
                at,
                at > seenAt && r.Actor != me,
                r.Actor is { } actor ? users.GetValueOrDefault(actor) : null,
                r.MatterId,
                matter.MatterRef,
                matter.Name,
                matter.ClientId,
                matter.ClientName,
                r.TaskId,
                task?.Number,
                task?.Title,
                r.AssetId,
                asset?.DisplayName,
                asset?.TypeName,
                kind == FeedKinds.NewStatusUpdates ? r.Old : null,
                kind == FeedKinds.NewStatusUpdates ? r.New : null,
                kind == FeedKinds.OnHold ? task?.Reason : null,
                kind == FeedKinds.OnHold && task is not null ? Math.Max(0, (int)(clock.NowUtc - DateTime.SpecifyKind(task.StatusChangedAtUtc, DateTimeKind.Utc)).TotalDays) : null,
                kind == FeedKinds.Overdue && task?.DueDate is { } due ? Math.Max(1, clock.Today.DayNumber - due.DayNumber) : null,
                kind == FeedKinds.DueDateUpdated ? ParseDate(r.Old) : null,
                kind == FeedKinds.DueDateUpdated ? ParseDate(r.New) : null);
        }).ToList();
    }
}
