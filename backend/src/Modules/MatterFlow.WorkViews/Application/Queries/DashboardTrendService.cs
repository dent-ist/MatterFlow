using MatterFlow.Configuration.Domain;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Time;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// Read side of the Dashboard Trends tab (<c>GET /api/v1/dashboard/trend</c>): created and completed per local day for the department and for each
/// requested Task Type, plus the legend of Task Types with their totals. A fixed number of reads whatever the number of Tasks or types: one read of the
/// Task Type catalogue and one read per metric of (Task Type, instant) pairs, bucketed into the viewer's local days in memory (the viewer's day edges
/// are not UTC days, so SQL cannot group by day). The rules are those of the summary trend, so the <c>all</c> series equals it.
/// </summary>
public sealed class DashboardTrendService(DbContext db, IClock clock, IUserTimeZone timeZone, ICurrentUser currentUser, DashboardCache cache)
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

        var queueClock = QueueClock.Create(clock.UtcNow, timeZone);
        var today = queueClock.Today;
        var cacheKey = $"trend|{me}|{query.PeriodDays}|{queueClock.ZoneId}|{today:yyyy-MM-dd}|{metric}|{string.Join(',', wanted.Order())}";
        if (!query.Fresh && cache.TryGet<DashboardTrend>(cacheKey, out var cached))
            return cached;

        var catalogue = await db.Set<TaskType>().AsNoTracking().Select(t => new { t.Id, t.Name, t.IconKey, t.IsActive }).ToListAsync(ct);
        var unknown = wanted.Where(id => catalogue.All(t => t.Id != id)).ToList();
        if (unknown.Count > 0)
            return Error.Validation("taskTypeIds", "UNKNOWN_TASK_TYPE", $"Unknown task type id {string.Join(", ", unknown)}.", "UNKNOWN_TASK_TYPE");

        var from = DashboardRules.PeriodStart(today, query.PeriodDays);
        var fromUtc = queueClock.StartOfDayUtc(from);
        var tasks = db.Set<WorkTask>().AsNoTracking();

        var created = metric == "completed"
            ? []
            : (await tasks.Where(t => t.CreatedAtUtc >= fromUtc).Select(t => new { t.TaskTypeId, At = t.CreatedAtUtc }).ToListAsync(ct)).Select(r => (r.TaskTypeId, r.At)).ToList();
        var completed = metric == "created"
            ? []
            : (await tasks.Where(t => t.Status == TaskStatusCode.Completed && t.StatusChangedAtUtc >= fromUtc).Select(t => new { t.TaskTypeId, At = t.StatusChangedAtUtc }).ToListAsync(ct)).Select(r => (r.TaskTypeId, r.At)).ToList();

        var built = DashboardRules.TrendByTaskType(from, today, created, completed, queueClock.StartOfDayUtc, wanted);

        var types = catalogue
            .Select(t =>
            {
                var (c, d) = built.Totals.GetValueOrDefault(t.Id);
                return new DashboardTrendType(t.Id, t.Name, t.IconKey, t.IsActive, c, d, DashboardRules.Created(from) + "&type=" + t.Id, DashboardRules.Completed(from) + "&type=" + t.Id);
            })
            .Where(t => t.IsActive || t.Created > 0 || t.Completed > 0)
            .OrderByDescending(t => t.Created).ThenByDescending(t => t.Completed).ThenBy(t => t.Name, StringComparer.CurrentCultureIgnoreCase).ThenBy(t => t.Id)
            .ToList();

        var trend = new DashboardTrend(
            new DashboardPeriod(query.PeriodDays, from, today),
            queueClock.ZoneId,
            DateTime.SpecifyKind(queueClock.NowUtc, DateTimeKind.Utc),
            metric,
            built.All,
            built.Series,
            types,
            DashboardRules.Created(from),
            DashboardRules.Completed(from));
        cache.Set(cacheKey, trend);
        return trend;
    }
}
