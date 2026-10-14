using System.Linq.Expressions;
using MatterFlow.Configuration.Domain;
using MatterFlow.Identity.Domain;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Time;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;



namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// Read side of the Dashboard: a handful of aggregate reads (one for the headline counts, one per breakdown, one for aging, one for the personal
/// block and two small lists), never a read per row. It reuses <see cref="TaskQueueRules"/> so every number agrees with the Task Queue the user lands
/// on, and each number carries the Task Queue query that lists exactly the counted Tasks. Phase 1 has no per-record visibility (addendum E).
/// </summary>
public sealed class DashboardService(DbContext db, IClock clock, IUserTimeZone timeZone, ICurrentUser currentUser)
{
    public async Task<Result<DashboardSummary>> GetAsync(DashboardQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        if (currentUser.UserId is not { } me)
            return Error.Unauthenticated("Sign in to see the dashboard.");

        var queueClock = QueueClock.Create(clock.UtcNow, timeZone);
        var today = queueClock.Today;
        var from = DashboardRules.PeriodStart(today, query.PeriodDays);
        var fromUtc = queueClock.StartOfDayUtc(from);
        var dueSoonDay = today.AddDays(TaskQueueRules.DueSoonDays);

        var tasks = db.Set<WorkTask>().AsNoTracking();
        var open = tasks.Where(TaskQueueRules.Open);
        var overdue = TaskQueueRules.Overdue(queueClock);
        Expression<Func<WorkTask, bool>> dueSoon = t => t.DueDate != null && t.DueDate <= dueSoonDay;
        var openDueSoon = open.Where(dueSoon).Where(Not(overdue));

        // Headline counts: one statement with a scalar subquery per number.
        var head = await tasks.Select(_ => new
        {
            Open = open.Count(),
            Unassigned = open.Count(t => t.AssignedUserId == null),
            Overdue = open.Count(overdue),
            OnHold = tasks.Count(t => t.Status == TaskStatusCode.OnHold),
            DueSoon = openDueSoon.Count(),
            AsapOpen = open.Count(t => t.DueDate == null),
            Completed = tasks.Count(t => t.Status == TaskStatusCode.Completed && t.StatusChangedAtUtc >= fromUtc),
            Created = tasks.Count(t => t.CreatedAtUtc >= fromUtc),
        }).FirstOrDefaultAsync(ct);

        var mineOpen = open.Where(t => t.AssignedUserId == me);
        var mine = await tasks.Select(_ => new
        {
            Open = mineOpen.Count(),
            Overdue = mineOpen.Count(overdue),
            DueSoon = mineOpen.Where(dueSoon).Where(Not(overdue)).Count(),
            Created = tasks.Count(t => t.CreatedByUserId == me && t.CreatedAtUtc >= fromUtc),
        }).FirstOrDefaultAsync(ct);

        var byStatus = await open.GroupBy(t => t.Status).Select(g => new { Status = g.Key, Count = g.Count() }).ToListAsync(ct);
        var byPriority = await open.GroupBy(t => t.PriorityId).Select(g => new { Id = g.Key, Count = g.Count() }).ToListAsync(ct);
        var byPod = await open.GroupBy(t => t.AssignedPodId).Select(g => new { Id = g.Key, Count = g.Count() }).ToListAsync(ct);
        var byType = await open.GroupBy(t => t.TaskTypeId).Select(g => new { Id = g.Key, Count = g.Count() }).ToListAsync(ct);

        var aging = await AgingAsync(open, queueClock, ct);

        var statusLabels = await db.Set<TaskStatusLabel>().AsNoTracking().ToDictionaryAsync(l => l.StatusCode, l => l.DisplayLabel, ct);
        var priorityRows = await db.Set<Priority>().AsNoTracking().OrderBy(p => p.SortOrder).Select(p => new { p.Id, p.Label, p.IsActive }).ToListAsync(ct);
        var podIds = byPod.Where(p => p.Id != null).Select(p => p.Id!.Value).ToList();
        var podNames = await db.Set<Pod>().AsNoTracking().Where(p => podIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name, ct);
        var typeIds = byType.Select(t => t.Id).ToList();
        var typeNames = await db.Set<TaskType>().AsNoTracking().Where(t => typeIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id, t => t.Name, ct);

        string StatusLabel(string code) => statusLabels.GetValueOrDefault(code, code);

        var statusItems = new[] { TaskStatusCode.New, TaskStatusCode.InProgress, TaskStatusCode.OnHold }
            .Select(s => new DashboardBreakdownItem(
                null,
                s.ToCode(),
                StatusLabel(s.ToCode()),
                byStatus.FirstOrDefault(x => x.Status == s)?.Count ?? 0,
                DashboardRules.Status(s),
                false))
            .ToList();

        var priorityCounts = byPriority.ToDictionary(p => p.Id, p => p.Count);
        var priorityItems = priorityRows
            .Where(p => p.IsActive || priorityCounts.ContainsKey(p.Id))
            .Select(p => new DashboardBreakdownItem(p.Id, null, p.Label, priorityCounts.GetValueOrDefault(p.Id), DashboardRules.Open("priority=" + p.Id), false))
            .ToList();

        var podItems = DashboardRules.TopWithOther(
            byPod.Where(p => p.Id != null).Select(p => new DashboardBreakdownItem(
                p.Id,
                null,
                podNames.GetValueOrDefault(p.Id!.Value, "Pod " + p.Id),
                p.Count,
                DashboardRules.Open("pod=" + p.Id),
                false)),
            DashboardRules.TopN,
            "Other Pods").ToList();
        if (byPod.FirstOrDefault(p => p.Id == null) is { Count: > 0 } noPod)
            podItems.Add(new DashboardBreakdownItem(null, null, "No Pod", noPod.Count, null, false));

        var typeItems = DashboardRules.TopWithOther(
            byType.Select(t => new DashboardBreakdownItem(t.Id, null, typeNames.GetValueOrDefault(t.Id, "Task Type " + t.Id), t.Count, DashboardRules.Open("type=" + t.Id), false)),
            DashboardRules.TopN,
            "Other Task Types");

        var recentlyCreated = await RecentAsync(tasks, null, t => t.CreatedAtUtc, t => t.CreatedAtUtc, statusLabels, ct);
        var recentlyCompleted = await RecentAsync(tasks, t => t.Status == TaskStatusCode.Completed, t => t.StatusChangedAtUtc, t => t.CompletedAtUtc ?? t.StatusChangedAtUtc, statusLabels, ct);

        head ??= new { Open = 0, Unassigned = 0, Overdue = 0, OnHold = 0, DueSoon = 0, AsapOpen = 0, Completed = 0, Created = 0 };
        mine ??= new { Open = 0, Overdue = 0, DueSoon = 0, Created = 0 };

        return new DashboardSummary(
            new DashboardPeriod(query.PeriodDays, from, today),
            queueClock.ZoneId,
            DateTime.SpecifyKind(queueClock.NowUtc, DateTimeKind.Utc),
            new DashboardCount(head.Open, DashboardRules.OpenQuery),
            new DashboardCount(head.Unassigned, DashboardRules.Unassigned),
            new DashboardCount(head.Overdue, DashboardRules.Overdue),
            new DashboardCount(head.OnHold, DashboardRules.OnHold),
            new DashboardCount(head.DueSoon, DashboardRules.DueSoon(dueSoonDay)),
            new DashboardCount(head.AsapOpen, DashboardRules.AsapOpen),
            new DashboardCount(head.Completed, DashboardRules.Completed(from)),
            new DashboardCount(head.Created, DashboardRules.Created(from)),
            podItems,
            typeItems,
            priorityItems,
            statusItems,
            aging,
            recentlyCreated,
            recentlyCompleted,
            new DashboardMine(
                new DashboardCount(mine.Open, DashboardRules.Open("assignee=" + me)),
                new DashboardCount(mine.Overdue, DashboardRules.Open("assignee=" + me, "overdue=true")),
                new DashboardCount(mine.DueSoon, DashboardRules.Open("assignee=" + me, "asap=false", "overdue=false", "dueTo=" + DashboardRules.Date(dueSoonDay))),
                new DashboardCount(mine.Created, DashboardRules.Join(["creator=" + me, DashboardRules.Created(from)]))));
    }

    /// <summary>Open Tasks per age band; the band edges are the viewer's local midnights so the drill-through (createdFrom/createdTo) lists the same Tasks.</summary>
    private async Task<IReadOnlyList<DashboardAgingBucket>> AgingAsync(IQueryable<WorkTask> open, QueueClock queueClock, CancellationToken ct)
    {
        var today = queueClock.Today;
        var bands = DashboardRules.AgingBands;
        var edges = bands.Select(b => (
            Lower: b.MaxDays is { } max ? queueClock.StartOfDayUtc(today.AddDays(-max)) : DateTime.MinValue,
            Upper: queueClock.StartOfDayUtc(today.AddDays(1 - b.MinDays)))).ToList();

        var (l0, u0) = edges[0];
        var (l1, u1) = edges[1];
        var (l2, u2) = edges[2];
        var (l3, u3) = edges[3];
        var (l4, u4) = edges[4];
        var counts = await open.Select(_ => new
        {
            B0 = open.Count(t => t.CreatedAtUtc >= l0 && t.CreatedAtUtc < u0),
            B1 = open.Count(t => t.CreatedAtUtc >= l1 && t.CreatedAtUtc < u1),
            B2 = open.Count(t => t.CreatedAtUtc >= l2 && t.CreatedAtUtc < u2),
            B3 = open.Count(t => t.CreatedAtUtc >= l3 && t.CreatedAtUtc < u3),
            B4 = open.Count(t => t.CreatedAtUtc >= l4 && t.CreatedAtUtc < u4),
        }).FirstOrDefaultAsync(ct);

        int[] values = counts is null ? [0, 0, 0, 0, 0] : [counts.B0, counts.B1, counts.B2, counts.B3, counts.B4];
        return [.. bands.Select((b, i) => new DashboardAgingBucket(b.Key, b.Label, b.MinDays, b.MaxDays, values[i], DashboardRules.Aging(b, today)))];
    }

    private async Task<IReadOnlyList<DashboardRecentTask>> RecentAsync(
        IQueryable<WorkTask> tasks,
        Expression<Func<WorkTask, bool>>? filter,
        Expression<Func<WorkTask, DateTime>> order,
        Func<WorkTask, DateTime> atSelector,
        IReadOnlyDictionary<string, string> labels,
        CancellationToken ct)
    {
        var source = filter is null ? tasks : tasks.Where(filter);
        var ids = await source.OrderByDescending(order).ThenByDescending(t => t.Id).Take(DashboardRules.RecentCount).Select(t => t.Id).ToListAsync(ct);
        if (ids.Count == 0)
            return [];

        var rows = await (
            from t in tasks.Where(t => ids.Contains(t.Id))
            join m in db.Set<Matter>().AsNoTracking() on t.MatterId equals m.Id
            select new { Task = t, m.MatterRef, MatterName = m.Name }).ToListAsync(ct);
        var byId = rows.ToDictionary(r => r.Task.Id);
        return
        [
            .. ids.Where(byId.ContainsKey).Select(id =>
            {
                var r = byId[id];
                var code = r.Task.Status.ToCode();
                return new DashboardRecentTask(
                    id,
                    r.Task.Number,
                    r.Task.Title,
                    r.Task.MatterId,
                    r.MatterRef,
                    r.MatterName,
                    code,
                    labels.GetValueOrDefault(code, code),
                    DateTime.SpecifyKind(atSelector(r.Task), DateTimeKind.Utc));
            }),
        ];
    }

    private static Expression<Func<WorkTask, bool>> Not(Expression<Func<WorkTask, bool>> predicate) =>
        Expression.Lambda<Func<WorkTask, bool>>(Expression.Not(predicate.Body), predicate.Parameters);
}
