using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// The count strip of My Matters (issue #678): two statements whatever the number of matters (the active matters, and one grouped pass over the open
/// tasks of those matters through <c>IX_Task_Matter</c>). Every number uses the <see cref="TaskQueueRules"/> predicates in the viewer's time zone and
/// carries the Task Queue query that lists exactly the counted tasks. Cached for a short time per person and filters, like the Dashboard.
/// </summary>
public sealed class MyMattersSummaryService(MyMattersScopeResolver scopes, DashboardCache cache, VisibilityStamp stamp)
{
    public async Task<Result<MyMattersSummary>> GetAsync(MyMattersSummaryQuery query, CancellationToken ct)
    {
        var resolved = await scopes.ResolveAsync(query, ct);
        if (resolved.IsFailure)
            return resolved.Error!;
        var scope = resolved.Value;
        var clock = scope.Clock;

        // The visibility stamp keeps the cache partitioned by what the person may see (sensitive-matter rule, epic #788): it changes the moment their access does.
        var types = (query.TaskTypeId ?? []).Distinct().Order().ToList();
        var cacheKey = $"mm-summary|{scope.Me}|{await stamp.KeyAsync(ct)}|{clock.ZoneId}|{clock.Today:yyyy-MM-dd}|{scope.Key}|{string.Join(',', types)}";
        if (query.Fresh != true && cache.TryGet<MyMattersSummary>(cacheKey, out var cached))
            return cached;

        var overdue = TaskQueueRules.Overdue(clock);
        var due3 = TaskQueueRules.DueWithin(clock, 3);
        var due7 = TaskQueueRules.DueWithin(clock, 7);
        var open = scope.OpenTasks();
        if (types.Count > 0)
            open = open.Where(t => types.Contains(t.TaskTypeId));
        var head = await open.GroupBy(_ => 1).Select(g => new
        {
            Open = g.Count(),
            Overdue = g.AsQueryable().Count(overdue),
            Due3 = g.AsQueryable().Count(due3),
            Due7 = g.AsQueryable().Count(due7),
            Unassigned = g.AsQueryable().Count(MyMattersRules.Unassigned),
            OnHold = g.AsQueryable().Count(MyMattersRules.OnHold),
            OldestHold = g.AsQueryable().Where(MyMattersRules.OnHold).Min(t => (DateTime?)t.StatusChangedAtUtc),
        }).FirstOrDefaultAsync(ct);
        var matters = await scope.Matters.CountAsync(ct);
        var atRisk = await AtRiskRules.Where(open, scope.Db, clock).CountAsync(ct);

        DateTime? since = head?.OldestHold is { } held ? DateTime.SpecifyKind(held, DateTimeKind.Utc) : null;
        var typeParts = types.Select(id => "type=" + id.ToString(System.Globalization.CultureInfo.InvariantCulture)).ToArray();
        var summary = new MyMattersSummary(
            clock.ZoneId,
            DateTime.SpecifyKind(clock.NowUtc, DateTimeKind.Utc),
            scope.All ? MyMattersScopeResolver.ScopeAll : MyMattersScopeResolver.ScopeMine,
            scope.Role,
            new DashboardCount(matters, scope.MattersQuery()),
            new DashboardCount(head?.Open ?? 0, scope.QueueOpen(typeParts)),
            new DashboardCount(head?.Overdue ?? 0, scope.QueueOpen(["overdue=true", .. typeParts])),
            new DashboardCount(head?.Due3 ?? 0, scope.QueueOpen(["dueWithin=3", .. typeParts])),
            new DashboardCount(head?.Due7 ?? 0, scope.QueueOpen(["dueWithin=7", .. typeParts])),
            new DashboardCount(head?.Unassigned ?? 0, scope.QueueOpen(["unassigned=true", .. typeParts])),
            new DashboardCount(head?.OnHold ?? 0, scope.QueueStatus(TaskStatusCode.OnHold, ["sort=" + TaskQueueRules.SortOnHoldSince, .. typeParts])),
            new DashboardCount(atRisk, scope.QueueOpen(["atRisk=true", .. typeParts])),
            since is { } at ? MyMattersRules.WholeDaysSince(at, clock.NowUtc) : null,
            since);
        cache.Set(cacheKey, summary);
        return summary;
    }
}
