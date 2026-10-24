using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// Trends of the matters in scope, week by week (epic #758, PX-09, owner decision: approximate, derived from existing columns, limitation stated). A fixed number of statements: one grouped read of the open
/// tasks (count, average age, on hold), one read of the creation instants, one of the completion instants, and one of the tasks with a due moment that were open at some point of the range, which are
/// bucketed into the viewer's weeks in memory (week edges are not UTC edges, so SQL cannot group by week). Created and closed are exact; "overdue at week end" and the figures of today are derived.
/// </summary>
public sealed class MyMattersTrendsService(MyMattersScopeResolver scopes)
{
    public static readonly IReadOnlyList<int> WeekChoices = [8, 12, 26];

    public static readonly IReadOnlyList<string> Limitations = ["CURRENT_DUE_DATES", "CURRENT_STATUS", "CURRENT_MATTER_SET"];

    public async Task<Result<MyMattersTrends>> GetAsync(MyMattersTrendsQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        var weeks = query.Weeks ?? WeekChoices[0];
        if (!WeekChoices.Contains(weeks))
            return Error.Validation("weeks", "UNKNOWN_WEEKS", $"weeks must be {string.Join(", ", WeekChoices.Take(WeekChoices.Count - 1))} or {WeekChoices[^1]}.");

        var resolved = await scopes.ResolveAsync(query, ct);
        if (resolved.IsFailure)
            return resolved.Error!;
        var scope = resolved.Value;
        var clock = scope.Clock;
        var now = DateTime.SpecifyKind(clock.NowUtc, DateTimeKind.Utc);
        var today = clock.Today;

        var firstMonday = DashboardRules.WeekStart(today).AddDays(-7 * (weeks - 1));
        var edges = Enumerable.Range(0, weeks + 1).Select(i => clock.StartOfDayUtc(firstMonday.AddDays(7 * i))).ToArray();
        var fromUtc = edges[0];

        // The scope's matters with all their tasks: the date range of the other tabs does not apply, the weeks are the range.
        var ids = scope.Matters.Select(m => m.Id);
        var tasks = scope.Db.Set<WorkTask>().AsNoTracking().Where(t => ids.Contains(t.MatterId));

        var current = await tasks.Where(TaskQueueRules.Open).GroupBy(_ => 1).Select(g => new
        {
            Open = g.Count(),
            AgeHours = g.Average(t => (double)EF.Functions.DateDiffHour(t.CreatedAtUtc, now)),
            OnHold = g.Count(t => t.Status == TaskStatusCode.OnHold),
            OldestHold = g.Where(t => t.Status == TaskStatusCode.OnHold).Min(t => (DateTime?)t.StatusChangedAtUtc),
        }).FirstOrDefaultAsync(ct);

        var created = (await tasks.Where(t => t.CreatedAtUtc >= fromUtc && t.CreatedAtUtc < now).Select(t => t.CreatedAtUtc).ToListAsync(ct));
        var closed = (await tasks.Where(t => t.Status == TaskStatusCode.Completed && t.StatusChangedAtUtc >= fromUtc && t.StatusChangedAtUtc < now).Select(t => t.StatusChangedAtUtc).ToListAsync(ct));
        var dated = (await tasks
            .Where(t => (t.DueDate != null || t.DueAtUtc != null) && t.CreatedAtUtc < now
                && (t.Status == TaskStatusCode.New || t.Status == TaskStatusCode.InProgress || t.Status == TaskStatusCode.OnHold || t.StatusChangedAtUtc >= fromUtc))
            .Select(t => new { t.CreatedAtUtc, t.DueAtUtc, t.DueDate, t.Status, t.StatusChangedAtUtc })
            .ToListAsync(ct))
            .Select(t => new MyMattersTrendRules.DatedTask(t.CreatedAtUtc, t.DueAtUtc, t.DueDate, t.Status is TaskStatusCode.Completed or TaskStatusCode.Cancelled, t.StatusChangedAtUtc))
            .ToList();

        var createdPerWeek = MyMattersTrendRules.CountPerWeek(created, edges);
        var closedPerWeek = MyMattersTrendRules.CountPerWeek(closed, edges);
        var overduePerWeek = MyMattersTrendRules.OverdueAtWeekEnd(dated, edges, now, clock.StartOfDayUtc);

        var points = new List<MyMattersTrendWeek>();
        for (var i = 0; i < weeks; i++)
        {
            var start = firstMonday.AddDays(7 * i);
            var end = start.AddDays(6);
            var isCurrent = today >= start && today <= end;
            points.Add(new MyMattersTrendWeek(
                start,
                end,
                isCurrent,
                createdPerWeek[i],
                closedPerWeek[i],
                overduePerWeek[i],
                scope.Queue(DashboardRules.Created(start, isCurrent ? null : end)),
                scope.Queue(DashboardRules.Completed(start, isCurrent ? null : end))));
        }

        var today2 = new MyMattersTrendNow(
            current?.Open ?? 0,
            current is null ? null : Math.Round(current.AgeHours / 24d, 1),
            current?.OnHold ?? 0,
            current?.OldestHold is { } oldest ? MyMattersRules.WholeDaysSince(oldest, now) : null,
            scope.QueueOpen(),
            scope.QueueStatus(TaskStatusCode.OnHold, "sort=" + TaskQueueRules.SortOnHoldSince),
            scope.QueueOpen("overdue=true", "sort=due"));
        return new MyMattersTrends(clock.ZoneId, now, weeks, true, Limitations, points, today2);
    }
}

/// <summary>The pure week arithmetic of the trends, so it can be tested without a database.</summary>
public static class MyMattersTrendRules
{
    /// <summary>A task with a due moment, as the overdue replay needs it.</summary>
    public sealed record DatedTask(DateTime CreatedAtUtc, DateTime? DueAtUtc, DateOnly? DueDate, bool Closed, DateTime StatusChangedAtUtc);

    /// <summary>How many instants fall into each week; <paramref name="edges"/> are the start instants of the weeks plus the end of the last one.</summary>
    public static int[] CountPerWeek(IEnumerable<DateTime> instants, DateTime[] edges)
    {
        ArgumentNullException.ThrowIfNull(instants);
        ArgumentNullException.ThrowIfNull(edges);
        var weeks = edges.Length - 1;
        var counts = new int[weeks];
        var ticks = edges.Select(e => e.Ticks).ToArray();
        foreach (var at in instants)
        {
            var found = Array.BinarySearch(ticks, at.Ticks);
            var week = found >= 0 ? found : ~found - 1;
            if (week >= 0 && week < weeks)
                counts[week]++;
        }

        return counts;
    }

    /// <summary>
    /// Per week: the tasks that, at the end of the week (now, for the week that is not over), were open and past their due moment. A task counts from the first week whose end is at or after
    /// both its creation and its due moment, until the first week whose end is at or after the moment it was closed. A date-only due is past at the end of that calendar day.
    /// </summary>
    public static int[] OverdueAtWeekEnd(IEnumerable<DatedTask> tasks, DateTime[] edges, DateTime nowUtc, Func<DateOnly, DateTime> startOfDayUtc)
    {
        ArgumentNullException.ThrowIfNull(tasks);
        ArgumentNullException.ThrowIfNull(edges);
        ArgumentNullException.ThrowIfNull(startOfDayUtc);
        var weeks = edges.Length - 1;
        var snaps = Enumerable.Range(0, weeks).Select(i => Math.Min(edges[i + 1].Ticks, Math.Max(edges[i].Ticks, nowUtc.Ticks))).ToArray();
        int FirstSnapAtOrAfter(long ticks)
        {
            int lo = 0, hi = weeks;
            while (lo < hi)
            {
                var mid = (lo + hi) / 2;
                if (snaps[mid] >= ticks)
                    hi = mid;
                else
                    lo = mid + 1;
            }

            return lo;
        }

        var diff = new int[weeks + 1];
        foreach (var t in tasks)
        {
            if (t.DueAtUtc is null && t.DueDate is null)
                continue;
            var due = t.DueAtUtc is { } at ? at.Ticks : t.DueDate!.Value == DateOnly.MaxValue ? long.MaxValue : startOfDayUtc(t.DueDate.Value.AddDays(1)).Ticks;
            var start = FirstSnapAtOrAfter(Math.Max(t.CreatedAtUtc.Ticks, due));
            var end = t.Closed ? FirstSnapAtOrAfter(t.StatusChangedAtUtc.Ticks) : weeks;
            if (start >= end)
                continue;
            diff[start]++;
            diff[end]--;
        }

        var result = new int[weeks];
        var sum = 0;
        for (var i = 0; i < weeks; i++)
        {
            sum += diff[i];
            result[i] = sum;
        }

        return result;
    }
}
