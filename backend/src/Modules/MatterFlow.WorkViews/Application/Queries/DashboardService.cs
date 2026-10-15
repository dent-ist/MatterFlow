using System.Linq.Expressions;
using MatterFlow.Configuration.Domain;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Time;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;



namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// Read side of the Dashboard: a handful of aggregate reads (one for the headline counts, one per breakdown, one for aging and two for the trend), never a read per row. It reuses <see cref="TaskQueueRules"/> so every number agrees with the Task Queue the user lands
/// on, and each number carries the Task Queue query that lists exactly the counted Tasks. Phase 1 has no per-record visibility (addendum E).
/// </summary>
public sealed class DashboardService(DbContext db, IClock clock, IUserTimeZone timeZone, ICurrentUser currentUser, IPermissionChecker permissions, DashboardCache cache)
{
    public async Task<Result<DashboardSummary>> GetAsync(DashboardQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        if (currentUser.UserId is not { } me)
            return Error.Unauthenticated("Sign in to see the dashboard.");

        var queueClock = QueueClock.Create(clock.UtcNow, timeZone);
        var today = queueClock.Today;

        // The permission is read before the cache so a user who lost (or gained) the department view never sees an answer computed under the other right.
        var department = permissions.Has(Permissions.Dashboard.ViewDepartment);
        var cacheKey = $"{me}|{query.PeriodDays}|{queueClock.ZoneId}|{today:yyyy-MM-dd}|{(department ? 1 : 0)}";
        if (!query.Fresh && cache.TryGet(cacheKey, out var cached))
            return cached;

        var from = DashboardRules.PeriodStart(today, query.PeriodDays);
        var fromUtc = queueClock.StartOfDayUtc(from);
        var dueSoonDay = today.AddDays(TaskQueueRules.DueSoonDays);

        var tasks = db.Set<WorkTask>().AsNoTracking();
        var open = tasks.Where(TaskQueueRules.Open);
        var overdue = TaskQueueRules.Overdue(queueClock);
        Expression<Func<WorkTask, bool>> dueSoon = t => t.DueDate != null && t.DueDate <= dueSoonDay;
        var openDueSoon = open.Where(dueSoon).Where(Not(overdue));

        // Department figures need Dashboard.ViewDepartment; without it the caller gets empty department blocks (SEC2-05).

        // Headline counts: one statement with a scalar subquery per number.
        var head = !department ? null : await tasks.Select(_ => new
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

        var departmentOpen = department ? open : open.Where(_ => false);
        var byStatus = await departmentOpen.GroupBy(t => t.Status).Select(g => new { Status = g.Key, Count = g.Count() }).ToListAsync(ct);
        var byPriority = await departmentOpen.GroupBy(t => t.PriorityId).Select(g => new { Id = g.Key, Count = g.Count() }).ToListAsync(ct);
        var byType = await departmentOpen.GroupBy(t => t.TaskTypeId).Select(g => new { Id = g.Key, Count = g.Count() }).ToListAsync(ct);

        var aging = await AgingAsync(departmentOpen, queueClock, ct);
        var trend = department ? await TrendAsync(tasks, queueClock, from, fromUtc, ct) : [];

        var statusLabels = await db.Set<TaskStatusLabel>().AsNoTracking().ToDictionaryAsync(l => l.StatusCode, l => l.DisplayLabel, ct);
        var priorityRows = await db.Set<Priority>().AsNoTracking().OrderBy(p => p.SortOrder).Select(p => new { p.Id, p.Label, p.IsActive }).ToListAsync(ct);
        var typeIds = byType.Select(t => t.Id).ToList();
        var typeRows = await db.Set<TaskType>().AsNoTracking().Where(t => typeIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id, t => new { t.Name, t.IconKey }, ct);

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

        var typeItems = DashboardRules.TopWithOther(
            byType.Select(t => new DashboardBreakdownItem(
                t.Id,
                null,
                typeRows.TryGetValue(t.Id, out var row) ? row.Name : "Task Type " + t.Id,
                t.Count,
                DashboardRules.Open("type=" + t.Id),
                false,
                row?.IconKey)),
            DashboardRules.TopTypes,
            "Other task types",
            rest => DashboardRules.Open([.. rest.Select(r => "type=" + r.Id)]));

        head ??= new { Open = 0, Unassigned = 0, Overdue = 0, OnHold = 0, DueSoon = 0, AsapOpen = 0, Completed = 0, Created = 0 };

        var summary = new DashboardSummary(
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
            typeItems,
            priorityItems,
            statusItems,
            aging,
            trend);
        cache.Set(cacheKey, summary);
        return summary;
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
        var counts = await open.Select(_ => new
        {
            B0 = open.Count(t => t.CreatedAtUtc >= l0 && t.CreatedAtUtc < u0),
            B1 = open.Count(t => t.CreatedAtUtc >= l1 && t.CreatedAtUtc < u1),
            B2 = open.Count(t => t.CreatedAtUtc >= l2 && t.CreatedAtUtc < u2),
            B3 = open.Count(t => t.CreatedAtUtc >= l3 && t.CreatedAtUtc < u3),
        }).FirstOrDefaultAsync(ct);

        int[] values = counts is null ? [0, 0, 0, 0] : [counts.B0, counts.B1, counts.B2, counts.B3];
        return [.. bands.Select((b, i) => new DashboardAgingBucket(b.Key, b.Label, b.MinDays, b.MaxDays, values[i], DashboardRules.Aging(b, today)))];
    }

    /// <summary>
    /// Created and completed per local day. Two reads of one timestamp column each (covered by the CreatedAt / StatusChanged indexes); the days are
    /// assigned in memory because the viewer's day edges are not UTC days. The totals equal the Created and Completed counts of the same period.
    /// </summary>
    private static async Task<IReadOnlyList<DashboardTrendPoint>> TrendAsync(IQueryable<WorkTask> tasks, QueueClock queueClock, DateOnly from, DateTime fromUtc, CancellationToken ct)
    {
        var created = await tasks.Where(t => t.CreatedAtUtc >= fromUtc).Select(t => t.CreatedAtUtc).ToListAsync(ct);
        var completed = await tasks.Where(t => t.Status == TaskStatusCode.Completed && t.StatusChangedAtUtc >= fromUtc).Select(t => t.StatusChangedAtUtc).ToListAsync(ct);
        return DashboardRules.Trend(from, queueClock.Today, created, completed, queueClock.StartOfDayUtc);
    }

    private static Expression<Func<WorkTask, bool>> Not(Expression<Func<WorkTask, bool>> predicate) =>
        Expression.Lambda<Func<WorkTask, bool>>(Expression.Not(predicate.Body), predicate.Parameters);
}
