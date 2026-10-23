using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using MatterFlow.SharedKernel.Availability;
using MatterFlow.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// Workload and capacity (issue #682): the open tasks on my matters grouped by pod, then person. One grouped statement over the open tasks of the scope
/// (<c>GROUP BY AssignedPodId, AssignedUserId</c>), then one read each for the pod names, the people and, through <see cref="IUserAvailabilityReader"/>,
/// their out-of-office state. Alphabetical, never ranked: no thresholds, no "overloaded" label. People and pods with no open work on these matters are not listed.
/// </summary>
public sealed class MyMattersWorkloadService(MyMattersScopeResolver scopes, DbContext db, IUserAvailabilityReader availability)
{
    public async Task<Result<MyMattersWorkload>> GetAsync(MyMattersQuery query, CancellationToken ct)
    {
        var resolved = await scopes.ResolveAsync(query, ct);
        if (resolved.IsFailure)
            return resolved.Error!;
        var scope = resolved.Value;
        var clock = scope.Clock;
        var overdue = TaskQueueRules.Overdue(clock);

        var groups = await scope.OpenTasks().GroupBy(t => new { t.AssignedPodId, t.AssignedUserId }).Select(g => new
        {
            PodId = g.Key.AssignedPodId,
            UserId = g.Key.AssignedUserId,
            Open = g.Count(),
            Overdue = g.AsQueryable().Count(overdue),
            OnHold = g.AsQueryable().Count(MyMattersRules.OnHold),
        }).ToListAsync(ct);

        var podIds = groups.Where(g => g.PodId != null).Select(g => g.PodId!.Value).Distinct().ToList();
        var userIds = groups.Where(g => g.UserId != null).Select(g => g.UserId!.Value).Distinct().ToList();
        var pods = podIds.Count == 0 ? [] : await db.Set<Pod>().AsNoTracking().Where(p => podIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name, ct);
        var users = userIds.Count == 0 ? [] : await db.Set<AppUser>().AsNoTracking().Where(u => userIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => new { u.DisplayName, u.IsActive }, ct);
        var states = userIds.Count == 0 ? new Dictionary<int, AvailabilityEvaluation>() : new Dictionary<int, AvailabilityEvaluation>(await availability.EvaluateAsync(userIds, clock.NowUtc, ct));

        var podGroups = groups
            .GroupBy(g => g.PodId)
            .Select(pg =>
            {
                var podQuery = pg.Key is { } id ? $"pod={id}" : "noPod=true";
                var people = pg
                    .Select(g =>
                    {
                        users.TryGetValue(g.UserId ?? 0, out var user);
                        var away = g.UserId is { } uid && states.TryGetValue(uid, out var state) && state.State == AvailabilityStates.OutOfOffice ? UserAvailabilitySummary.From(state) : null;
                        return new MyMattersWorkloadPerson(
                            g.UserId,
                            g.UserId is null ? null : user?.DisplayName ?? $"User {g.UserId}",
                            g.UserId is null || (user?.IsActive ?? true),
                            g.Open,
                            g.Overdue,
                            g.OnHold,
                            away,
                            scope.QueueOpen(podQuery, g.UserId is { } who ? $"assignee={who}" : "unassigned=true"));
                    })
                    // The "not assigned to a person" row first, then people alphabetically.
                    .OrderBy(p => p.UserId is null ? 0 : 1)
                    .ThenBy(p => p.DisplayName, StringComparer.CurrentCultureIgnoreCase)
                    .ThenBy(p => p.UserId)
                    .ToList();
                return new MyMattersWorkloadPod(
                    pg.Key,
                    pg.Key is { } podId ? pods.GetValueOrDefault(podId) ?? $"Pod {podId}" : null,
                    pg.Sum(g => g.Open),
                    pg.Sum(g => g.Overdue),
                    pg.Sum(g => g.OnHold),
                    scope.QueueOpen(podQuery),
                    people);
            })
            // Pods alphabetically, the tasks with no pod last.
            .OrderBy(p => p.PodId is null ? 1 : 0)
            .ThenBy(p => p.PodName, StringComparer.CurrentCultureIgnoreCase)
            .ThenBy(p => p.PodId)
            .ToList();

        return new MyMattersWorkload(clock.ZoneId, DateTime.SpecifyKind(clock.NowUtc, DateTimeKind.Utc), groups.Sum(g => g.Open), podGroups);
    }
}
