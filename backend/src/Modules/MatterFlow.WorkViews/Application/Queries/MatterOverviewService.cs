using System.Globalization;
using MatterFlow.Assets.Contracts;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Time;
using MatterFlow.SharedKernel.Visibility;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// The matter record Overview in one round trip (epic #758, PX-11, <c>GET /matters/{id}/overview</c>). A fixed number of statements whatever the size of the matter: the header (matter, client, managers),
/// ONE grouped pass over the matter's tasks that yields the status counts and every health figure, the next five deadlines, the people (one grouped read and the away windows in one batch), the
/// asset count with its first five, and the last ten audit events. The tasks are the visible tasks (sensitive-matter rule); a matter the caller may not see answers 404, as everywhere. Sections the
/// caller may not use are null. Health is the My Matters rule (<see cref="MyMattersRules.Flag"/>) on this one matter, so the matter list and this page can never disagree.
/// </summary>
public sealed class MatterOverviewService(
    DbContext db,
    IClock clock,
    IUserTimeZone timeZone,
    ICurrentUser currentUser,
    IPermissionChecker permissions,
    IMatterVisibility visibility,
    IUserAvailabilityReader availability,
    IAssetDirectory assets,
    MyMattersActivityService activity)
{
    public const int DeadlineCount = 5;
    public const int PeopleCount = 10;
    public const int AssetCount = 5;
    public const int ActivityCount = 10;

    /// <summary>The activity looks this many days back.</summary>
    public const int ActivityDays = MyMattersActivityService.MaxLookBackDays;

    /// <summary>"Completed" counts the last this many days.</summary>
    public const int CompletedDays = 30;

    public async Task<Result<MatterOverview>> GetAsync(int matterId, CancellationToken ct)
    {
        if (currentUser.UserId is not { } me)
            return Error.Unauthenticated("Sign in to see a matter.");
        if (!await visibility.CanSeeMatterAsync(matterId, ct))
            return Error.NotFound("Matter not found.");

        var header = await (from m in db.Set<Matter>().AsNoTracking().Where(m => m.Id == matterId)
                            join c in db.Set<Client>().AsNoTracking() on m.ClientId equals c.Id
                            select new { m.Id, m.MatterRef, m.Name, ClientId = c.Id, ClientName = c.Name, m.IsActive, m.IsSensitive, m.PrimaryManagerId, m.SecondaryManagerId })
            .FirstOrDefaultAsync(ct);
        if (header is null)
            return Error.NotFound("Matter not found.");

        var queueClock = QueueClock.Create(clock.UtcNow, timeZone);
        var now = DateTime.SpecifyKind(queueClock.NowUtc, DateTimeKind.Utc);
        var today = queueClock.Today;
        var id = matterId.ToString(CultureInfo.InvariantCulture);
        var matterPart = "matter=" + id;

        var managerIds = new[] { header.PrimaryManagerId, header.SecondaryManagerId }.OfType<int>().Distinct().ToList();
        var users = new Dictionary<int, UserName>();
        void Remember(IEnumerable<UserName> rows)
        {
            foreach (var row in rows)
                users[row.Id] = row;
        }

        Remember(managerIds.Count == 0 ? [] : await db.Set<AppUser>().AsNoTracking().Where(u => managerIds.Contains(u.Id)).Select(u => new UserName(u.Id, u.DisplayName, u.IsActive)).ToListAsync(ct));
        MatterOverviewManager? Manager(int? userId) => userId is { } uid ? new MatterOverviewManager(uid, users.TryGetValue(uid, out var u) ? u.DisplayName : $"User {uid}", users.TryGetValue(uid, out var v) && v.IsActive) : null;

        var matterHeader = new MatterOverviewHeader(header.Id, header.MatterRef, header.Name, header.ClientId, header.ClientName, header.IsActive, header.IsSensitive, Manager(header.PrimaryManagerId), Manager(header.SecondaryManagerId));
        if (!permissions.Has(Permissions.Task.View))
            return new MatterOverview(queueClock.ZoneId, now, matterHeader, null, null, null, await AssetsAsync(matterId, ct), null, null);

        // The one grouped pass: status counts and every health figure.
        var tasks = VisibleTasks.Of(db, visibility).Where(t => t.MatterId == matterId);
        var overdue = TaskQueueRules.Overdue(queueClock);
        var dueSoon = TaskQueueRules.DueWithin(queueClock, MyMattersRules.AmberDueDays);
        var stuck = MyMattersRules.StuckOnHold(queueClock.NowUtc);
        var completedFrom = today.AddDays(-CompletedDays);
        var completedSince = queueClock.StartOfDayUtc(completedFrom);
        var figures = await tasks.GroupBy(_ => 1).Select(g => new
        {
            New = g.Count(t => t.Status == TaskStatusCode.New),
            InProgress = g.Count(t => t.Status == TaskStatusCode.InProgress),
            OnHold = g.Count(t => t.Status == TaskStatusCode.OnHold),
            Completed = g.Count(t => t.Status == TaskStatusCode.Completed && t.StatusChangedAtUtc >= completedSince),
            Overdue = g.AsQueryable().Count(overdue),
            DueSoon = g.AsQueryable().Count(dueSoon),
            Unassigned = g.AsQueryable().Count(MyMattersRules.Unassigned),
            Stuck = g.AsQueryable().Count(stuck),
        }).FirstOrDefaultAsync(ct);
        var open = (figures?.New ?? 0) + (figures?.InProgress ?? 0) + (figures?.OnHold ?? 0);

        var taskCounts = new MatterOverviewTaskCounts(
            figures?.New ?? 0,
            figures?.InProgress ?? 0,
            figures?.OnHold ?? 0,
            figures?.Completed ?? 0,
            open,
            DashboardRules.Status(TaskStatusCode.New, matterPart),
            DashboardRules.Status(TaskStatusCode.InProgress, matterPart),
            DashboardRules.Status(TaskStatusCode.OnHold, matterPart),
            DashboardRules.Completed(completedFrom) + "&" + matterPart,
            DashboardRules.Open(matterPart));

        var (flag, codes) = MyMattersRules.Flag(open, figures?.Overdue ?? 0, figures?.Unassigned ?? 0, figures?.DueSoon ?? 0, figures?.Stuck ?? 0);
        MatterOverviewReason Reason(string code) => code switch
        {
            MyMattersRules.ReasonOverdue => new(code, figures?.Overdue ?? 0, DashboardRules.Open(matterPart, "overdue=true", "sort=due")),
            MyMattersRules.ReasonUnassigned => new(code, figures?.Unassigned ?? 0, DashboardRules.Open(matterPart, "unassigned=true", "sort=due")),
            MyMattersRules.ReasonDueSoon => new(code, figures?.DueSoon ?? 0, DashboardRules.Open(matterPart, $"dueWithin={MyMattersRules.AmberDueDays}", "sort=due")),
            MyMattersRules.ReasonLongHold => new(code, figures?.Stuck ?? 0, DashboardRules.Status(TaskStatusCode.OnHold, matterPart, "sort=" + TaskQueueRules.SortOnHoldSince)),
            _ => new(code, 0, null),
        };
        var health = new MatterOverviewHealth(flag, [.. codes.Select(Reason)], MyMattersRules.AmberDueDays, MyMattersRules.StuckOnHoldDays);

        // Next five deadlines: open, not overdue, an explicit due date; and how many there are.
        var upcoming = tasks.Where(TaskQueueRules.Open).Where(MyMattersRules.Not(overdue)).Where(t => t.DueDate != null);
        var upcomingTotal = await upcoming.CountAsync(ct);
        var next = upcomingTotal == 0
            ? []
            : await upcoming.OrderBy(t => t.DueSortKey).ThenBy(t => t.Id).Take(DeadlineCount)
                .Select(t => new { t.Id, t.Number, t.Title, t.DueDate, t.DueAtUtc, t.AssignedUserId }).ToListAsync(ct);

        // People: one grouped read of the open tasks of the matter by assignee.
        var groups = await tasks.Where(TaskQueueRules.Open).Where(t => t.AssignedUserId != null).GroupBy(t => t.AssignedUserId!.Value)
            .Select(g => new { UserId = g.Key, Open = g.Count(), Overdue = g.AsQueryable().Count(overdue) }).ToListAsync(ct);
        var shown = groups.OrderByDescending(g => g.Open).ThenByDescending(g => g.Overdue).ThenBy(g => g.UserId).Take(PeopleCount).ToList();

        var nameIds = shown.Select(g => g.UserId).Concat(next.Where(n => n.AssignedUserId != null).Select(n => n.AssignedUserId!.Value)).Where(u => !users.ContainsKey(u)).Distinct().ToList();
        Remember(nameIds.Count == 0 ? [] : await db.Set<AppUser>().AsNoTracking().Where(u => nameIds.Contains(u.Id)).Select(u => new UserName(u.Id, u.DisplayName, u.IsActive)).ToListAsync(ct));
        var shownIds = shown.Select(g => g.UserId).ToList();
        var windows = shownIds.Count == 0 ? new Dictionary<int, AwayWindow>() : new Dictionary<int, AwayWindow>(await availability.AwayWindowsAsync(shownIds, today, today.AddDays(MyMattersWorkloadService.AwayDays), ct));

        var people = new MatterOverviewPeople(
            groups.Count,
            figures?.Unassigned ?? 0,
            [.. shown
                .Select(g => new MatterOverviewPerson(
                    g.UserId,
                    users.TryGetValue(g.UserId, out var u) ? u.DisplayName : $"User {g.UserId}",
                    !users.TryGetValue(g.UserId, out var w) || w.IsActive,
                    g.Open,
                    g.Overdue,
                    windows.TryGetValue(g.UserId, out var window) ? new MyMattersAwayWindow(window.From, window.Until, MyMattersWorkloadService.AwayReasonCode) : null,
                    DashboardRules.Open(matterPart, "assignee=" + g.UserId.ToString(CultureInfo.InvariantCulture))))
                .OrderByDescending(p => p.Open).ThenByDescending(p => p.Overdue).ThenBy(p => p.DisplayName, StringComparer.CurrentCultureIgnoreCase).ThenBy(p => p.UserId)]);

        var deadlines = new MatterOverviewDeadlines(
            upcomingTotal,
            DashboardRules.Open(matterPart, "asap=false", "overdue=false", "sort=due"),
            [.. next.Select(n => new MatterOverviewDeadline(
                n.Id,
                n.Number,
                n.Title,
                n.DueDate,
                n.DueAtUtc is { } at ? DateTime.SpecifyKind(at, DateTimeKind.Utc) : null,
                n.AssignedUserId,
                n.AssignedUserId is { } uid && users.TryGetValue(uid, out var assignee) ? assignee.DisplayName : null))]);

        return new MatterOverview(queueClock.ZoneId, now, matterHeader, taskCounts, deadlines, people, await AssetsAsync(matterId, ct), await ActivityAsync(matterId, me, queueClock, now, ct), health);
    }

    private async Task<MatterOverviewAssets?> AssetsAsync(int matterId, CancellationToken ct)
    {
        if (!permissions.Has(Permissions.Asset.View))
            return null;

        var snapshot = await assets.SnapshotForMatterAsync(matterId, AssetCount, ct);
        return new MatterOverviewAssets(snapshot.Total, [.. snapshot.First.Select(a => new MatterOverviewAsset(a.AssetId, a.DisplayName, a.AssetTypeName, a.ExternalReference))]);
    }

    /// <summary>The last events of the matter, newest first, with the same sensitive-history rule as My Matters; nothing is unread here and the marker is neither created nor moved.</summary>
    private async Task<IReadOnlyList<MyMattersActivityItem>> ActivityAsync(int matterId, int me, QueueClock queueClock, DateTime now, CancellationToken ct)
    {
        var since = now.AddDays(-ActivityDays);
        if (await activity.FirstIdSinceAsync(since, ct) is not { } firstId)
            return [];

        var scope = new MyMattersScope(db, me, queueClock, db.Set<Matter>().AsNoTracking().Where(m => m.Id == matterId), TaskQueueFilter.RoleBoth, new MyMattersQuery(), all: true);
        var page = await activity.ScopedEvents(scope, firstId, since, until: null).OrderByDescending(e => e.AuditEventId).Take(ActivityCount).ToListAsync(ct);
        return await activity.ToItemsAsync(page, long.MaxValue, me, ct);
    }

    private sealed record UserName(int Id, string DisplayName, bool IsActive);
}
