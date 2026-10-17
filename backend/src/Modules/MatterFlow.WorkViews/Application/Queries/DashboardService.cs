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
/// Read side of the Dashboard: a handful of aggregate reads (one for the headline counts, one per breakdown, and one for aging; the Trends tab has its own endpoint, <see cref="DashboardTrendService"/>), never a read per row. It reuses <see cref="TaskQueueRules"/> so every number agrees with the Task Queue the user lands
/// on, and each number carries the Task Queue query that lists exactly the counted Tasks. Phase 1 has no per-record visibility (addendum E).
/// </summary>
public sealed class DashboardService(DbContext db, IClock clock, IUserTimeZone timeZone, ICurrentUser currentUser, IPermissionChecker permissions, DashboardCache cache, DashboardScopeResolver scopes)
{
    public async Task<Result<DashboardSummary>> GetAsync(DashboardQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        if (currentUser.UserId is not { } me)
            return Error.Unauthenticated("Sign in to see the dashboard.");

        var resolvedScope = await scopes.ResolveAsync(query.PodScope, null, ct);
        if (resolvedScope.IsFailure)
            return resolvedScope.Error!;
        var scope = resolvedScope.Value;

        var queueClock = QueueClock.Create(clock.UtcNow, timeZone);
        var today = queueClock.Today;

        // The rights are read before the cache so a user who lost (or gained) a tab never sees an answer computed under other rights. A tab permission
        // only has effect together with Dashboard.View. What the caller may not see is not computed: the payload carries zeros and empty lists for it.
        var canView = permissions.Has(Permissions.Dashboard.View);
        var showSummary = canView && permissions.Has(Permissions.Dashboard.ViewSummary);
        var showBreakdowns = canView && permissions.Has(Permissions.Dashboard.ViewBreakdowns);
        // Dashboard.ViewUnassigned alone: only the size of the unassigned queue (and the query that lists it), none of the department-wide counts.
        var showUnassigned = showSummary || (canView && permissions.Has(Permissions.Dashboard.ViewUnassigned));
        var sections = (showSummary ? 1 : 0) | (showBreakdowns ? 2 : 0) | (showUnassigned ? 4 : 0);
        var resolved = DashboardPeriods.Resolve(query.Period, query.From, query.To, query.PeriodDays, today);
        if (resolved.IsFailure)
            return resolved.Error!;
        var period = resolved.Value;
        var cacheKey = $"{me}|{period.Key}|{period.From:yyyy-MM-dd}|{period.To:yyyy-MM-dd}|{queueClock.ZoneId}|{today:yyyy-MM-dd}|{sections}|{scope.Key}";
        if (!query.Fresh && cache.TryGet(cacheKey, out var cached))
            return cached;

        var from = period.From;
        var fromUtc = queueClock.StartOfDayUtc(from);
        var toUtc = queueClock.EndOfDayUtc(period.To);
        DateOnly? endsBeforeToday = period.To < today ? period.To : null;
        var dueSoonDay = today.AddDays(TaskQueueRules.DueSoonDays);

        // Change since before (S3): Overdue and Open as they were at the end of yesterday (the Trends snapshot rules: created by then, not yet Completed or Cancelled by then, a
        // due moment that had passed by then; no status replay), Completed and Created in the period before this one.
        var previous = DashboardPeriods.Previous(period);
        var previousFromUtc = queueClock.StartOfDayUtc(previous.From);
        var previousToUtc = queueClock.EndOfDayUtc(previous.To);
        var snap = queueClock.StartOfDayUtc(today);
        var lastDay = today.AddDays(-1);

        // Every number below is about the Tasks of the scope (all Tasks, or the Tasks whose Pod field is one of the scope's Pods) and its query carries the same Pod filter.
        var tasks = scope.Apply(db.Set<WorkTask>().AsNoTracking());
        var open = tasks.Where(TaskQueueRules.Open);
        var overdue = TaskQueueRules.Overdue(queueClock);
        Expression<Func<WorkTask, bool>> dueSoon = t => t.DueDate != null && t.DueDate <= dueSoonDay;
        var openDueSoon = open.Where(dueSoon).Where(Not(overdue));

        // Overdue severity (Overdue tile caption): the priorities whose badge token is critical or high.
        var severityRows = showSummary
            ? await db.Set<Priority>().AsNoTracking().Where(p => p.Color == PriorityColors.Critical || p.Color == PriorityColors.High).Select(p => new { p.Id, p.Color }).ToListAsync(ct)
            : [];
        var criticalIds = severityRows.Where(p => p.Color == PriorityColors.Critical).Select(p => p.Id).ToList();
        var highIds = severityRows.Where(p => p.Color == PriorityColors.High).Select(p => p.Id).ToList();

        // Headline counts (Summary tab): one statement with a scalar subquery per number. With Dashboard.ViewUnassigned alone only the size of the
        // unassigned queue is read: the department-wide counts are neither computed nor sent.
        var head = showSummary ? await tasks.Select(_ => new
        {
            Open = open.Count(),
            Unassigned = open.Count(t => t.AssignedUserId == null),
            Overdue = open.Count(overdue),
            OverdueCritical = open.Where(overdue).Count(t => criticalIds.Contains(t.PriorityId)),
            OverdueHigh = open.Where(overdue).Count(t => highIds.Contains(t.PriorityId)),
            OnHold = tasks.Count(t => t.Status == TaskStatusCode.OnHold),
            DueSoon = openDueSoon.Count(),
            AsapOpen = open.Count(t => t.DueDate == null),
            Completed = tasks.Count(t => t.Status == TaskStatusCode.Completed && t.StatusChangedAtUtc >= fromUtc && t.StatusChangedAtUtc < toUtc),
            Created = tasks.Count(t => t.CreatedAtUtc >= fromUtc && t.CreatedAtUtc < toUtc),
            OpenYesterday = tasks.Count(t => t.CreatedAtUtc <= snap
                && (t.Status == TaskStatusCode.New || t.Status == TaskStatusCode.InProgress || t.Status == TaskStatusCode.OnHold || t.StatusChangedAtUtc > snap)),
            OverdueYesterday = tasks.Count(t => t.CreatedAtUtc <= snap
                && (t.Status == TaskStatusCode.New || t.Status == TaskStatusCode.InProgress || t.Status == TaskStatusCode.OnHold || t.StatusChangedAtUtc > snap)
                && ((t.DueAtUtc != null && t.DueAtUtc <= snap) || (t.DueAtUtc == null && t.DueDate != null && t.DueDate <= lastDay))),
            CompletedPrevious = tasks.Count(t => t.Status == TaskStatusCode.Completed && t.StatusChangedAtUtc >= previousFromUtc && t.StatusChangedAtUtc < previousToUtc),
            CreatedPrevious = tasks.Count(t => t.CreatedAtUtc >= previousFromUtc && t.CreatedAtUtc < previousToUtc),
            HadYesterday = tasks.Any(t => t.CreatedAtUtc <= snap),
            HadBeforePrevious = tasks.Any(t => t.CreatedAtUtc < previousFromUtc),
        }).FirstOrDefaultAsync(ct)
        : showUnassigned ? await tasks.Select(_ => new
        {
            Open = 0,
            Unassigned = open.Count(t => t.AssignedUserId == null),
            Overdue = 0,
            OverdueCritical = 0,
            OverdueHigh = 0,
            OnHold = 0,
            DueSoon = 0,
            AsapOpen = 0,
            Completed = 0,
            Created = 0,
            OpenYesterday = 0,
            OverdueYesterday = 0,
            CompletedPrevious = 0,
            CreatedPrevious = 0,
            HadYesterday = false,
            HadBeforePrevious = false,
        }).FirstOrDefaultAsync(ct)
        : null;

        // Breakdowns tab: open Tasks by status, priority and type, and their age.
        var departmentOpen = showBreakdowns ? open : open.Where(_ => false);
        // Each row also carries how many of its Tasks are overdue (the Overdue tile's predicate): a second grouped read over the overdue subset.
        var departmentOverdue = departmentOpen.Where(overdue);
        var byStatus = await departmentOpen.GroupBy(t => t.Status).Select(g => new { Status = g.Key, Count = g.Count() }).ToListAsync(ct);
        var byPriority = await departmentOpen.GroupBy(t => t.PriorityId).Select(g => new { Id = g.Key, Count = g.Count() }).ToListAsync(ct);
        var byType = await departmentOpen.GroupBy(t => t.TaskTypeId).Select(g => new { Id = g.Key, Count = g.Count() }).ToListAsync(ct);
        var overdueByStatus = (await departmentOverdue.GroupBy(t => t.Status).Select(g => new { Status = g.Key, Count = g.Count() }).ToListAsync(ct)).ToDictionary(x => x.Status, x => x.Count);
        var overdueByPriority = (await departmentOverdue.GroupBy(t => t.PriorityId).Select(g => new { Id = g.Key, Count = g.Count() }).ToListAsync(ct)).ToDictionary(x => x.Id, x => x.Count);
        var overdueByType = (await departmentOverdue.GroupBy(t => t.TaskTypeId).Select(g => new { Id = g.Key, Count = g.Count() }).ToListAsync(ct)).ToDictionary(x => x.Id, x => x.Count);

        IReadOnlyList<DashboardAgingBucket> aging = showBreakdowns ? await AgingAsync(departmentOpen, departmentOverdue, queueClock, scope, ct) : [];

        var statusLabels = await db.Set<TaskStatusLabel>().AsNoTracking().ToDictionaryAsync(l => l.StatusCode, l => l.DisplayLabel, ct);
        var priorityRows = await db.Set<Priority>().AsNoTracking().OrderBy(p => p.SortOrder).Select(p => new { p.Id, p.Label, p.IsActive }).ToListAsync(ct);
        var typeIds = byType.Select(t => t.Id).ToList();
        var typeRows = await db.Set<TaskType>().AsNoTracking().Where(t => typeIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id, t => new { t.Name, t.IconKey }, ct);

        string StatusLabel(string code) => statusLabels.GetValueOrDefault(code, code);

        var statusItems = new[] { TaskStatusCode.New, TaskStatusCode.InProgress, TaskStatusCode.OnHold }
            .Where(_ => showBreakdowns)
            .Select(s => new DashboardBreakdownItem(
                null,
                s.ToCode(),
                StatusLabel(s.ToCode()),
                byStatus.FirstOrDefault(x => x.Status == s)?.Count ?? 0,
                scope.Scoped(DashboardRules.Status(s)),
                false,
                null,
                overdueByStatus.GetValueOrDefault(s)))
            .ToList();

        var priorityCounts = byPriority.ToDictionary(p => p.Id, p => p.Count);
        var priorityItems = priorityRows
            .Where(_ => showBreakdowns)
            .Where(p => p.IsActive || priorityCounts.ContainsKey(p.Id))
            .Select(p => new DashboardBreakdownItem(p.Id, null, p.Label, priorityCounts.GetValueOrDefault(p.Id), scope.Scoped(DashboardRules.Open("priority=" + p.Id)), false, null, overdueByPriority.GetValueOrDefault(p.Id)))
            .ToList();

        var typeItems = DashboardRules.TopWithOther(
            byType.Select(t => new DashboardBreakdownItem(
                t.Id,
                null,
                typeRows.TryGetValue(t.Id, out var row) ? row.Name : "Task Type " + t.Id,
                t.Count,
                scope.Scoped(DashboardRules.Open("type=" + t.Id)),
                false,
                row?.IconKey,
                overdueByType.GetValueOrDefault(t.Id))),
            DashboardRules.TopTypes,
            "Other task types",
            rest => scope.Scoped(DashboardRules.Open([.. rest.Select(r => "type=" + r.Id)])));

        // Under a Pod scope, the unassigned Tasks that belong to no Pod are in no scope: the Summary says how many, so they cannot be lost.
        var unassignedNoPod = !scope.IsAll && showUnassigned
            ? await db.Set<WorkTask>().AsNoTracking().Where(TaskQueueRules.Open).CountAsync(t => t.AssignedUserId == null && t.AssignedPodId == null, ct)
            : 0;

        head ??= new { Open = 0, Unassigned = 0, Overdue = 0, OverdueCritical = 0, OverdueHigh = 0, OnHold = 0, DueSoon = 0, AsapOpen = 0, Completed = 0, Created = 0, OpenYesterday = 0, OverdueYesterday = 0, CompletedPrevious = 0, CreatedPrevious = 0, HadYesterday = false, HadBeforePrevious = false };

        // Dashboard.ViewUnassigned without Dashboard.ViewSummary (the Technician's Summary): the caller's own open and overdue Tasks, by the Task Queue definitions and whatever the page scope.
        DashboardMine? mine = null;
        if (showUnassigned && !showSummary)
        {
            var own = db.Set<WorkTask>().AsNoTracking().Where(t => t.AssignedUserId == me).Where(TaskQueueRules.Open);
            mine = new DashboardMine(await own.CountAsync(ct), await own.CountAsync(overdue, ct));
        }

        var summary = new DashboardSummary(
            new DashboardPeriod(period.Days, from, period.To, period.Key),
            queueClock.ZoneId,
            DateTime.SpecifyKind(queueClock.NowUtc, DateTimeKind.Utc),
            new DashboardCount(head.Open, scope.Scoped(DashboardRules.OpenQuery)),
            new DashboardCount(head.Unassigned, scope.Scoped(DashboardRules.Unassigned)),
            new DashboardCount(head.Overdue, scope.Scoped(DashboardRules.Overdue)),
            new DashboardCount(head.OnHold, scope.Scoped(DashboardRules.OnHold)),
            new DashboardCount(head.DueSoon, scope.Scoped(DashboardRules.DueSoon(dueSoonDay))),
            new DashboardCount(head.AsapOpen, scope.Scoped(DashboardRules.AsapOpen)),
            new DashboardCount(head.Completed, scope.Scoped(DashboardRules.Completed(from, endsBeforeToday))),
            new DashboardCount(head.Created, scope.Scoped(DashboardRules.Created(from, endsBeforeToday))),
            typeItems,
            priorityItems,
            statusItems,
            aging,
            new DashboardCount(head.OverdueCritical, scope.Scoped(DashboardRules.OverdueWith(criticalIds))),
            new DashboardCount(head.OverdueHigh, scope.Scoped(DashboardRules.OverdueWith(highIds))),
            new DashboardScopeInfo(scope.Value, scope.PodIds, unassignedNoPod),
            showSummary && head.HadYesterday ? head.OverdueYesterday : null,
            showSummary && head.HadYesterday ? head.OpenYesterday : null,
            showSummary && head.HadBeforePrevious ? head.CompletedPrevious : null,
            showSummary && head.HadBeforePrevious ? head.CreatedPrevious : null,
            showSummary ? new DashboardPreviousPeriod(previous.Kind, previous.From, previous.To) : null,
            mine);
        cache.Set(cacheKey, summary);
        return summary;
    }

    /// <summary>Open Tasks per age band, and how many of them are overdue; the band edges are the viewer's local midnights so the drill-through (createdFrom/createdTo) lists the same Tasks.</summary>
    private async Task<IReadOnlyList<DashboardAgingBucket>> AgingAsync(IQueryable<WorkTask> open, IQueryable<WorkTask> overdue, QueueClock queueClock, DashboardScope scope, CancellationToken ct)
    {
        var today = queueClock.Today;
        var bands = DashboardRules.AgingBands;
        var edges = bands.Select(b => (
            Lower: b.MaxDays is { } max ? queueClock.StartOfDayUtc(today.AddDays(-max)) : DateTime.MinValue,
            Upper: queueClock.StartOfDayUtc(today.AddDays(1 - b.MinDays)))).ToList();

        // One statement, one scalar subquery per band and measure; six bands (see DashboardRules.AgingBands).
        var (l0, u0) = edges[0];
        var (l1, u1) = edges[1];
        var (l2, u2) = edges[2];
        var (l3, u3) = edges[3];
        var (l4, u4) = edges[4];
        var (l5, u5) = edges[5];
        var counts = await open.Select(_ => new
        {
            B0 = open.Count(t => t.CreatedAtUtc >= l0 && t.CreatedAtUtc < u0),
            B1 = open.Count(t => t.CreatedAtUtc >= l1 && t.CreatedAtUtc < u1),
            B2 = open.Count(t => t.CreatedAtUtc >= l2 && t.CreatedAtUtc < u2),
            B3 = open.Count(t => t.CreatedAtUtc >= l3 && t.CreatedAtUtc < u3),
            B4 = open.Count(t => t.CreatedAtUtc >= l4 && t.CreatedAtUtc < u4),
            B5 = open.Count(t => t.CreatedAtUtc >= l5 && t.CreatedAtUtc < u5),
            O0 = overdue.Count(t => t.CreatedAtUtc >= l0 && t.CreatedAtUtc < u0),
            O1 = overdue.Count(t => t.CreatedAtUtc >= l1 && t.CreatedAtUtc < u1),
            O2 = overdue.Count(t => t.CreatedAtUtc >= l2 && t.CreatedAtUtc < u2),
            O3 = overdue.Count(t => t.CreatedAtUtc >= l3 && t.CreatedAtUtc < u3),
            O4 = overdue.Count(t => t.CreatedAtUtc >= l4 && t.CreatedAtUtc < u4),
            O5 = overdue.Count(t => t.CreatedAtUtc >= l5 && t.CreatedAtUtc < u5),
        }).FirstOrDefaultAsync(ct);

        int[] values = counts is null ? new int[6] : [counts.B0, counts.B1, counts.B2, counts.B3, counts.B4, counts.B5];
        int[] overdues = counts is null ? new int[6] : [counts.O0, counts.O1, counts.O2, counts.O3, counts.O4, counts.O5];
        return [.. bands.Select((b, i) => new DashboardAgingBucket(b.Key, b.Label, b.MinDays, b.MaxDays, values[i], scope.Scoped(DashboardRules.Aging(b, today)), overdues[i]))];
    }

    private static Expression<Func<WorkTask, bool>> Not(Expression<Func<WorkTask, bool>> predicate) =>
        Expression.Lambda<Func<WorkTask, bool>>(Expression.Not(predicate.Body), predicate.Parameters);
}
