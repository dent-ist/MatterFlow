using MatterFlow.Identity.Domain;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// "Needs my attention" and "Upcoming deadlines" (issue #681). Attention: four groups (overdue, due in 3 days, unassigned, stuck on hold), each a count
/// and a <c>TOP 10</c>; deadlines: one count and a <c>TOP 25</c>. All bounded by TOP, all on the open tasks of the scope's matters, all with the
/// <see cref="TaskQueueRules"/> predicates. Tasks of matters nobody manages are not in anybody's "mine" scope, so they are never an item.
/// </summary>
public sealed class MyMattersAttentionService(MyMattersScopeResolver scopes, DbContext db)
{
    public const int GroupSize = 10;
    public const int DeadlineSize = 25;
    public static readonly IReadOnlyList<int> DeadlineWindows = [14, 28];

    public async Task<Result<MyMattersAttention>> GetAsync(MyMattersQuery query, CancellationToken ct)
    {
        var resolved = await scopes.ResolveAsync(query, ct);
        if (resolved.IsFailure)
            return resolved.Error!;
        var scope = resolved.Value;
        var clock = scope.Clock;

        var overdue = TaskQueueRules.Overdue(clock);
        var due3 = TaskQueueRules.DueWithin(clock, MyMattersRules.AmberDueDays);
        var stuck = MyMattersRules.StuckOnHold(clock.NowUtc);
        var today = clock.Today;
        var weekEnd = today.AddDays(7);
        var open = scope.OpenTasks();

        var totals = await open.GroupBy(_ => 1).Select(g => new
        {
            Overdue = g.AsQueryable().Count(overdue),
            Due3 = g.AsQueryable().Count(due3),
            Unassigned = g.AsQueryable().Count(MyMattersRules.Unassigned),
            Stuck = g.AsQueryable().Count(stuck),
        }).FirstOrDefaultAsync(ct);

        // Each group is first a TOP N of task ids over index columns only (a seek and a small sort, no row lookups); the other columns of those few
        // tasks, and then the names of their matters, clients and people, are read once for all four groups.
        var overdueIds = await TopIdsAsync(open.Where(overdue), q => q.OrderBy(x => x.DueSortKey).ThenBy(x => x.Id), GroupSize, ct);
        var dueSoonIds = await TopIdsAsync(open.Where(due3), q => q.OrderBy(x => x.DueSortKey).ThenBy(x => x.Id), GroupSize, ct);
        // Unassigned: those due within 7 days (overdue ones included) first, soonest first; then the rest, oldest first.
        var unassignedIds = await TopIdsAsync(
            open.Where(MyMattersRules.Unassigned),
            q => q.OrderBy(x => x.DueDate != null && x.DueDate <= weekEnd ? 0 : 1).ThenBy(x => x.DueDate != null && x.DueDate <= weekEnd ? x.DueSortKey : (DateTime?)null).ThenBy(x => x.CreatedAtUtc).ThenBy(x => x.Id),
            GroupSize,
            ct);
        var stuckIds = await TopIdsAsync(open.Where(stuck), q => q.OrderBy(x => x.StatusChangedAtUtc).ThenBy(x => x.Id), GroupSize, ct);
        var details = await DetailsAsync([.. overdueIds, .. dueSoonIds, .. unassignedIds, .. stuckIds], ct);
        var names = await NamesAsync(details.Values, ct);
        IReadOnlyList<TaskRow> Rows(IEnumerable<long> ids) => [.. ids.Select(id => details[id])];
        var overdueRows = Rows(overdueIds);
        var dueSoonRows = Rows(dueSoonIds);
        var unassignedRows = Rows(unassignedIds);
        var stuckRows = Rows(stuckIds);

        MyMattersAttentionGroup Group(string kind, int total, string queryString, IReadOnlyList<TaskRow> rows, Func<TaskRow, (string, int?)> fact) =>
            new(kind, total, queryString, [.. rows.Select(r => ToItem(r, names, fact(r)))]);

        (string, int?) OverdueFact(TaskRow r) => (AttentionFacts.Overdue, DaysOverdue(r, today, clock.NowUtc));
        (string, int?) DueFact(TaskRow r) => DueFactOf(r, today);
        (string, int?) NoAssigneeFact(TaskRow _) => (AttentionFacts.NoAssignee, null);
        (string, int?) HoldFact(TaskRow r) => (AttentionFacts.OnHoldDays, MyMattersRules.WholeDaysSince(r.StatusChangedAtUtc, clock.NowUtc));

        return new MyMattersAttention(
            clock.ZoneId,
            DateTime.SpecifyKind(clock.NowUtc, DateTimeKind.Utc),
            MyMattersRules.StuckOnHoldDays,
            [
                Group("overdue", totals?.Overdue ?? 0, scope.QueueOpen("overdue=true", "sort=due"), overdueRows, OverdueFact),
                Group("dueSoon", totals?.Due3 ?? 0, scope.QueueOpen($"dueWithin={MyMattersRules.AmberDueDays}", "sort=due"), dueSoonRows, DueFact),
                Group("unassigned", totals?.Unassigned ?? 0, scope.QueueOpen("unassigned=true", "sort=due"), unassignedRows, NoAssigneeFact),
                Group("stuckOnHold", totals?.Stuck ?? 0, scope.QueueStatus(TaskStatusCode.OnHold, "sort=" + TaskQueueRules.SortOnHoldSince), stuckRows, HoldFact),
            ]);
    }

    public async Task<Result<MyMattersDeadlines>> DeadlinesAsync(MyMattersDeadlinesQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        var days = query.Days ?? DeadlineWindows[0];
        if (!DeadlineWindows.Contains(days))
            return Error.Validation("days", "UNKNOWN_DAYS", $"days must be {string.Join(" or ", DeadlineWindows)}.");

        var resolved = await scopes.ResolveAsync(query, ct);
        if (resolved.IsFailure)
            return resolved.Error!;
        var scope = resolved.Value;
        var clock = scope.Clock;
        var today = clock.Today;
        var last = today.AddDays(days);

        // Open, an explicit due date today or within the window, not overdue (overdue is in "Needs my attention"). The date range, if any, narrows it further.
        var window = scope.OpenTasks().Where(TaskQueueRules.DueWithin(clock, days));
        var total = await window.CountAsync(ct);
        var ids = await TopIdsAsync(window, q => q.OrderBy(x => x.DueSortKey).ThenBy(x => x.Id), DeadlineSize, ct);
        var details = await DetailsAsync(ids, ct);
        var rows = ids.Select(id => details[id]).ToList();
        var names = await NamesAsync(rows, ct);

        return new MyMattersDeadlines(
            clock.ZoneId,
            DateTime.SpecifyKind(clock.NowUtc, DateTimeKind.Utc),
            days,
            today,
            last,
            total,
            scope.QueueOpen("asap=false", "overdue=false", "dueTo=" + DashboardRules.Date(last), "sort=due"),
            [.. rows.Select(r => ToItem(r, names, DueFactOf(r, today)))]);
    }

    private static (string, int?) DueFactOf(TaskRow r, DateOnly today)
    {
        var due = r.DueDate ?? (r.DueAtUtc is { } at ? DateOnly.FromDateTime(at) : (DateOnly?)null);
        if (due is null)
            return (AttentionFacts.DueToday, null);
        var diff = due.Value.DayNumber - today.DayNumber;
        return diff <= 0 ? (AttentionFacts.DueToday, 0) : (AttentionFacts.DueInDays, diff);
    }

    private static int DaysOverdue(TaskRow r, DateOnly today, DateTime nowUtc)
    {
        if (r.DueDate is { } due)
            return Math.Max(0, today.DayNumber - due.DayNumber);
        return r.DueAtUtc is { } at ? MyMattersRules.WholeDaysSince(at, nowUtc) : 0;
    }

    private static MyMattersTaskItem ToItem(TaskRow r, Names names, (string Code, int? Days) fact)
    {
        var matter = names.Matters[r.MatterId];
        return new MyMattersTaskItem(
            r.Id,
            r.Number,
            r.Title,
            r.MatterId,
            matter.MatterRef,
            matter.MatterName,
            matter.ClientName,
            fact.Code,
            fact.Days,
            r.DueDate,
            r.DueAtUtc is { } d ? DateTime.SpecifyKind(d, DateTimeKind.Utc) : null,
            r.AssignedUserId,
            r.AssignedUserId is { } uid ? names.Users.GetValueOrDefault(uid) : null);
    }

    private sealed class TaskRow
    {
        public long Id { get; init; }

        public string Number { get; init; } = string.Empty;

        public string Title { get; init; } = string.Empty;

        public int MatterId { get; init; }

        public DateOnly? DueDate { get; init; }

        public DateTime? DueAtUtc { get; init; }

        public int? AssignedUserId { get; init; }

        public DateTime StatusChangedAtUtc { get; init; }
    }

    private sealed record Names(IReadOnlyDictionary<int, MatterNameRow> Matters, IReadOnlyDictionary<int, string> Users);

    private sealed record MatterNameRow(string MatterRef, string MatterName, string ClientName);

    /// <summary>The ids of the first <paramref name="take"/> tasks in the given order. The order uses columns of <c>IX_Task_Matter</c> only, so this is a seek and a small sort.</summary>
    private static async Task<List<long>> TopIdsAsync(IQueryable<WorkTask> tasks, Func<IQueryable<WorkTask>, IOrderedQueryable<WorkTask>> order, int take, CancellationToken ct) =>
        await order(tasks).Take(take).Select(t => t.Id).ToListAsync(ct);

    /// <summary>The columns of the given tasks in one statement (a clustered-key seek per task).</summary>
    private async Task<Dictionary<long, TaskRow>> DetailsAsync(IReadOnlyCollection<long> ids, CancellationToken ct)
    {
        if (ids.Count == 0)
            return [];
        var wanted = ids.Distinct().ToList();
        return await db.Set<WorkTask>().AsNoTracking().Where(t => wanted.Contains(t.Id)).Select(t => new TaskRow
        {
            Id = t.Id,
            Number = t.Number,
            Title = t.Title,
            MatterId = t.MatterId,
            DueDate = t.DueDate,
            DueAtUtc = t.DueAtUtc,
            AssignedUserId = t.AssignedUserId,
            StatusChangedAtUtc = t.StatusChangedAtUtc,
        }).ToDictionaryAsync(t => t.Id, ct);
    }

    /// <summary>Matter, client and assignee names of the rows: two statements whatever the number of rows.</summary>
    private async Task<Names> NamesAsync(IEnumerable<TaskRow> source, CancellationToken ct)
    {
        var rows = source.ToList();
        var matterIds = rows.Select(r => r.MatterId).Distinct().ToList();
        var userIds = rows.Where(r => r.AssignedUserId != null).Select(r => r.AssignedUserId!.Value).Distinct().ToList();
        var matters = matterIds.Count == 0
            ? []
            : await (from m in db.Set<Matter>().AsNoTracking().Where(m => matterIds.Contains(m.Id))
                     join c in db.Set<Client>().AsNoTracking() on m.ClientId equals c.Id
                     select new { m.Id, m.MatterRef, MatterName = m.Name, ClientName = c.Name }).ToDictionaryAsync(m => m.Id, m => new MatterNameRow(m.MatterRef, m.MatterName, m.ClientName), ct);
        var users = userIds.Count == 0 ? [] : await db.Set<AppUser>().AsNoTracking().Where(u => userIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.DisplayName, ct);
        return new Names(matters, users);
    }
}
