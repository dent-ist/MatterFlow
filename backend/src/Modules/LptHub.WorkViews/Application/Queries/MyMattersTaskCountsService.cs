using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// Status counts and Show counts for a My Matters scope (UI-04, #957). Seven statements whatever the number of matters, all through the scope's tasks (visible matters by construction).
/// </summary>
public sealed class MyMattersTaskCountsService(MyMattersScopeResolver scopes)
{
    private static readonly TaskStatusCode[] OpenStatuses = [TaskStatusCode.New, TaskStatusCode.InProgress, TaskStatusCode.OnHold];

    public async Task<Result<MyMattersTaskCounts>> GetAsync(MyMattersTaskCountsQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        string? show = null;
        if (!string.IsNullOrWhiteSpace(query.Show))
        {
            show = query.Show.Trim().ToLowerInvariant();
            if (!ShowFilter.All.Contains(show))
                return Error.Validation("show", "UNKNOWN_SHOW", $"Unknown show '{query.Show}'. Allowed: {string.Join(", ", ShowFilter.All)}.");
        }

        var statuses = new List<TaskStatusCode>();
        foreach (var code in (query.Status ?? []).SelectMany(FilterParsing.SplitList))
        {
            if (!TaskStatusCodeExtensions.TryParse(code.ToUpperInvariant(), out var status))
                return Error.Validation("status", "UNKNOWN_STATUS", $"Unknown status '{code}'.");
            if (!statuses.Contains(status))
                statuses.Add(status);
        }

        var resolved = await scopes.ResolveAsync(query, ct);
        if (resolved.IsFailure)
            return resolved.Error!;
        var scope = resolved.Value;
        var clock = scope.Clock;

        var all = scope.Tasks();
        var byStatusBase = show is null ? all : ShowFilter.Apply(all, show, scope.Db, clock);
        var perStatus = await byStatusBase.GroupBy(t => t.Status).Select(g => new { Status = g.Key, Count = g.Count() }).ToListAsync(ct);
        int Of(TaskStatusCode s) => perStatus.Where(x => x.Status == s).Sum(x => x.Count);
        var byStatus = new TaskStatusCounts(
            Of(TaskStatusCode.New) + Of(TaskStatusCode.InProgress) + Of(TaskStatusCode.OnHold),
            Of(TaskStatusCode.New),
            Of(TaskStatusCode.InProgress),
            Of(TaskStatusCode.OnHold),
            Of(TaskStatusCode.Completed),
            Of(TaskStatusCode.Cancelled));

        var selection = statuses.Count > 0 ? statuses : [.. OpenStatuses];
        var byShowBase = all.Where(t => selection.Contains(t.Status));
        async Task<int> CountAsync(string s) => await ShowFilter.Apply(byShowBase, s, scope.Db, clock).CountAsync(ct);
        var byShow = new TaskShowCounts(
            await byShowBase.CountAsync(ct),
            await CountAsync(ShowFilter.Overdue),
            await CountAsync(ShowFilter.Risk),
            await CountAsync(ShowFilter.Unassigned),
            await CountAsync(ShowFilter.Critical),
            await CountAsync(ShowFilter.Due7));

        return new MyMattersTaskCounts(clock.ZoneId, DateTime.SpecifyKind(clock.NowUtc, DateTimeKind.Utc), byStatus, byShow);
    }
}
