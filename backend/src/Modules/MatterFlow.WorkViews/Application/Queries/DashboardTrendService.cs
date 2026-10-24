using MatterFlow.Configuration.Domain;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Time;
using MatterFlow.SharedKernel.Visibility;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// Read side of the Dashboard Trends tab (<c>GET /api/v1/dashboard/trend</c>): created and completed per local day for the department and for each
/// requested Task Type, plus the legend of Task Types with their totals. A fixed number of reads whatever the number of Tasks or types: one read of the
/// Task Type catalogue and one read per metric group (created, completed, tasks with a due date) of (Task Type, instants) rows, bucketed into the viewer's local days in memory (the viewer's day edges
/// are not UTC days, so SQL cannot group by day). The rules are those of the summary trend, so the <c>all</c> series equals it.
/// </summary>
public sealed class DashboardTrendService(DbContext db, IClock clock, IUserTimeZone timeZone, ICurrentUser currentUser, DashboardCache cache, DashboardScopeResolver scopes, IMatterVisibility visibility, VisibilityStamp stamp)
{
    public async Task<Result<DashboardTrend>> GetAsync(DashboardTrendQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        if (currentUser.UserId is not { } me)
            return Error.Unauthenticated("Sign in to see the dashboard.");

        var metric = query.Metric?.Trim().ToLowerInvariant();
        if (!string.IsNullOrEmpty(query.Metric) && !DashboardRules.TrendMetrics.Contains(metric!))
            return Error.Validation("metric", "UNKNOWN_METRIC", $"Unknown metric '{query.Metric}'. Allowed: {string.Join(", ", DashboardRules.TrendMetrics)}.");
        metric = string.IsNullOrEmpty(metric) ? null : metric;

        var wanted = (query.TaskTypeIds ?? []).Distinct().ToList();
        if (wanted.Count > DashboardRules.MaxTrendTypes)
            return Error.Validation("taskTypeIds", "TOO_MANY_TYPES", $"Pick up to {DashboardRules.MaxTrendTypes} task types to keep the chart readable.", "TOO_MANY_TYPES");

        var resolvedScope = await scopes.ResolveAsync(query.PodScope, null, ct);
        if (resolvedScope.IsFailure)
            return resolvedScope.Error!;
        var scope = resolvedScope.Value;

        var queueClock = QueueClock.Create(clock.UtcNow, timeZone);
        var today = queueClock.Today;
        var resolved = DashboardPeriods.Resolve(query.Period, query.From, query.To, query.PeriodDays, today);
        if (resolved.IsFailure)
            return resolved.Error!;
        var period = resolved.Value;
        var cacheKey = $"trend|{me}|{await stamp.KeyAsync(ct)}|{period.Key}|{period.From:yyyy-MM-dd}|{period.To:yyyy-MM-dd}|{DashboardRules.TrendGranularity(period.Days)}|{queueClock.ZoneId}|{today:yyyy-MM-dd}|{metric}|{string.Join(',', wanted.Order())}|{scope.Key}";
        if (!query.Fresh && cache.TryGet<DashboardTrend>(cacheKey, out var cached))
            return cached;

        var catalogue = await db.Set<TaskType>().AsNoTracking().Select(t => new { t.Id, t.Name, t.IconKey, t.IsActive }).ToListAsync(ct);
        var unknown = wanted.Where(id => catalogue.All(t => t.Id != id)).ToList();
        if (unknown.Count > 0)
            return Error.Validation("taskTypeIds", "UNKNOWN_TASK_TYPE", $"Unknown task type id {string.Join(", ", unknown)}.", "UNKNOWN_TASK_TYPE");

        var from = period.From;
        var to = period.To;
        var fromUtc = queueClock.StartOfDayUtc(from);
        var toUtc = queueClock.EndOfDayUtc(to);
        DateOnly? endsBeforeToday = to < today ? to : null;
        var tasks = scope.Apply(VisibleTasks.Of(db, visibility));

        var needCreated = metric is null or "created";
        var needCompleted = metric is null or "completed";
        var needDue = metric is null or "overdue" or "ontime" or "late";
        var needOpen = metric is null or "open";
        // Tasks created inside the period: one read (type, created, status, last change) feeds the Created series and, replayed per day, the Open series.
        var inPeriod = !needCreated && !needOpen
            ? []
            : (await tasks.Where(t => t.CreatedAtUtc >= fromUtc && t.CreatedAtUtc < toUtc).Select(t => new { t.TaskTypeId, t.CreatedAtUtc, t.Status, t.StatusChangedAtUtc }).ToListAsync(ct))
                .Select(r => new OpenTask(r.TaskTypeId, r.CreatedAtUtc, r.Status is TaskStatusCode.Completed or TaskStatusCode.Cancelled, r.StatusChangedAtUtc))
                .ToList();
        var created = !needCreated ? [] : inPeriod.Select(r => (r.TypeId, At: r.CreatedAtUtc)).ToList();
        var completed = !needCompleted
            ? []
            : (await tasks.Where(t => t.Status == TaskStatusCode.Completed && t.StatusChangedAtUtc >= fromUtc && t.StatusChangedAtUtc < toUtc).Select(t => new { t.TaskTypeId, At = t.StatusChangedAtUtc }).ToListAsync(ct)).Select(r => (r.TaskTypeId, r.At)).ToList();

        // Tasks with a due date that were open at some point of the period: open now, or closed (completed or cancelled) during it. One read, replayed per day in memory.
        var nowUtc = queueClock.NowUtc;
        var dueTasks = !needDue
            ? []
            : (await tasks
                .Where(t => (t.DueDate != null || t.DueAtUtc != null) && t.CreatedAtUtc < nowUtc
                    && (t.Status == TaskStatusCode.New || t.Status == TaskStatusCode.InProgress || t.Status == TaskStatusCode.OnHold || t.StatusChangedAtUtc >= fromUtc))
                .Select(t => new { t.TaskTypeId, t.CreatedAtUtc, t.DueAtUtc, t.DueDate, t.Status, t.StatusChangedAtUtc })
                .ToListAsync(ct))
                .Select(r => new DueTask(r.TaskTypeId, r.CreatedAtUtc, r.DueAtUtc, r.DueDate, r.Status, r.StatusChangedAtUtc))
                .ToList();

        // Open at the end of each day: the Tasks created by the first snapshot that are still open now are counted by Task Type in SQL (no row per Task);
        // every other Task created by the last snapshot that is not closed by the first one (created later in the period, or closed during it) is read and replayed per day in memory.
        var openAtStart = new Dictionary<int, int>();
        var openTasks = new List<OpenTask>();
        if (needOpen)
        {
            var firstSnap = Snapshot(queueClock, from, nowUtc);
            var lastSnap = Snapshot(queueClock, to, nowUtc);
            openAtStart = await tasks
                .Where(t => t.CreatedAtUtc <= firstSnap && (t.Status == TaskStatusCode.New || t.Status == TaskStatusCode.InProgress || t.Status == TaskStatusCode.OnHold))
                .GroupBy(t => t.TaskTypeId)
                .Select(g => new { TypeId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(r => r.TypeId, r => r.Count, ct);
            // Created before the period and closed after the first snapshot (open on the first days): the only rows not already read above.
            var older = (await tasks
                .Where(t => t.CreatedAtUtc < fromUtc && (t.Status == TaskStatusCode.Completed || t.Status == TaskStatusCode.Cancelled) && t.StatusChangedAtUtc > firstSnap)
                .Select(t => new { t.TaskTypeId, t.CreatedAtUtc, t.StatusChangedAtUtc })
                .ToListAsync(ct))
                .Select(r => new OpenTask(r.TaskTypeId, r.CreatedAtUtc, true, r.StatusChangedAtUtc));
            openTasks = [.. inPeriod.Where(t => t.CreatedAtUtc <= lastSnap && (t.CreatedAtUtc > firstSnap || (t.Closed && t.StatusChangedAtUtc > firstSnap))), .. older];
        }

        var built = DashboardRules.TrendByTaskType(from, to, created, completed, dueTasks, queueClock.StartOfDayUtc, nowUtc, wanted, openTasks, openAtStart);

        var types = catalogue
            .Select(t =>
            {
                var n = built.Totals.GetValueOrDefault(t.Id) ?? new TrendTypeTotals(0, 0, 0, 0, 0);
                return new DashboardTrendType(
                    t.Id, t.Name, t.IconKey, t.IsActive, n.Created, n.Completed, n.Overdue, n.OnTime, n.Late, n.Open,
                    scope.Scoped(DashboardRules.Created(from, endsBeforeToday) + "&type=" + t.Id),
                    scope.Scoped(DashboardRules.Completed(from, endsBeforeToday) + "&type=" + t.Id),
                    scope.Scoped(DashboardRules.Overdue + "&type=" + t.Id),
                    scope.Scoped(DashboardRules.OpenQuery + "&type=" + t.Id));
            })
            .Where(t => t.IsActive || t.Created > 0 || t.Completed > 0 || t.Overdue > 0)
            .OrderByDescending(t => t.Created).ThenByDescending(t => t.Completed).ThenBy(t => t.Name, StringComparer.CurrentCultureIgnoreCase).ThenBy(t => t.Id)
            .ToList();

        var trend = new DashboardTrend(
            new DashboardPeriod(period.Days, from, to, period.Key),
            queueClock.ZoneId,
            DateTime.SpecifyKind(queueClock.NowUtc, DateTimeKind.Utc),
            metric,
            built.Granularity,
            built.All,
            built.Series,
            types,
            scope.Scoped(DashboardRules.Created(from, endsBeforeToday)),
            scope.Scoped(DashboardRules.Completed(from, endsBeforeToday)),
            scope.Scoped(DashboardRules.Overdue),
            scope.Scoped(DashboardRules.OpenQuery));
        cache.Set(cacheKey, trend);
        return trend;
    }

    /// <summary>The instant the snapshot of a local day is taken: the end of that day, or now for today.</summary>
    private static DateTime Snapshot(QueueClock clock, DateOnly day, DateTime nowUtc)
    {
        var start = clock.StartOfDayUtc(day);
        var end = clock.StartOfDayUtc(day.AddDays(1));
        return DateTime.SpecifyKind(new DateTime(Math.Min(end.Ticks, Math.Max(start.Ticks, nowUtc.Ticks))), DateTimeKind.Utc);
    }
}
