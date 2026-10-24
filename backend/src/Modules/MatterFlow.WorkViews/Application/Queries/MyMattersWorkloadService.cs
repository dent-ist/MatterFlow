using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using MatterFlow.Organization.Domain;
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
    /// <summary>How far ahead "away" looks: today and the next four weeks.</summary>
    public const int AwayDays = 28;

    /// <summary>The only reason the availability profile records (its free-text note is never returned here).</summary>
    public const string AwayReasonCode = "OUT_OF_OFFICE";

    private const int TopMatters = 5;

    public async Task<Result<MyMattersWorkload>> GetAsync(MyMattersWorkloadQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        var include = query.Include?.Trim().ToLowerInvariant();
        if (!string.IsNullOrEmpty(include) && include != "matters")
            return Error.Validation("include", "UNKNOWN_INCLUDE", "include must be matters.");

        var resolved = await scopes.ResolveAsync(query, ct);
        if (resolved.IsFailure)
            return resolved.Error!;
        var scope = resolved.Value;
        var clock = scope.Clock;
        var overdue = TaskQueueRules.Overdue(clock);
        var dueWeek = TaskQueueRules.DueWithin(clock, MyMattersRules.DueWeekDays);

        var groups = await scope.OpenTasks().GroupBy(t => new { t.AssignedPodId, t.AssignedUserId }).Select(g => new
        {
            PodId = g.Key.AssignedPodId,
            UserId = g.Key.AssignedUserId,
            Open = g.Count(),
            Overdue = g.AsQueryable().Count(overdue),
            OnHold = g.AsQueryable().Count(MyMattersRules.OnHold),
            DueWeek = g.AsQueryable().Count(dueWeek),
        }).ToListAsync(ct);

        var podIds = groups.Where(g => g.PodId != null).Select(g => g.PodId!.Value).Distinct().ToList();
        var userIds = groups.Where(g => g.UserId != null).Select(g => g.UserId!.Value).Distinct().ToList();
        var pods = podIds.Count == 0 ? [] : await db.Set<Pod>().AsNoTracking().Where(p => podIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name, ct);
        var users = userIds.Count == 0 ? [] : await db.Set<AppUser>().AsNoTracking().Where(u => userIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => new { u.DisplayName, u.IsActive }, ct);
        var states = userIds.Count == 0 ? new Dictionary<int, AvailabilityEvaluation>() : new Dictionary<int, AvailabilityEvaluation>(await availability.EvaluateAsync(userIds, clock.NowUtc, ct));
        // Who is away at any time from today to four weeks ahead (calendar days, as the profile saves them): from, to and a code, never the note.
        var windows = userIds.Count == 0 ? new Dictionary<int, AwayWindow>() : new Dictionary<int, AwayWindow>(await availability.AwayWindowsAsync(userIds, clock.Today, clock.Today.AddDays(AwayDays), ct));
        var split = include == "matters" ? await SplitByMatterAsync(scope, ct) : null;

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
                            scope.QueueOpen(podQuery, g.UserId is { } who ? $"assignee={who}" : "unassigned=true"),
                            g.DueWeek,
                            g.UserId is { } awayId && windows.TryGetValue(awayId, out var window) ? new MyMattersAwayWindow(window.From, window.Until, AwayReasonCode) : null,
                            split is null ? null : split.GetValueOrDefault((g.PodId, g.UserId)));
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

    /// <summary>
    /// The open tasks of each (pod, person) row by matter, in one grouped statement and one name read: the five matters with most open tasks (ties by matter reference) and the rest as a count.
    /// </summary>
    private async Task<Dictionary<(int? PodId, int? UserId), MyMattersWorkloadMatters>> SplitByMatterAsync(MyMattersScope scope, CancellationToken ct)
    {
        var overdue = TaskQueueRules.Overdue(scope.Clock);
        var groups = await scope.OpenTasks().GroupBy(t => new { t.AssignedPodId, t.AssignedUserId, t.MatterId }).Select(g => new
        {
            PodId = g.Key.AssignedPodId,
            UserId = g.Key.AssignedUserId,
            MatterId = g.Key.MatterId,
            Open = g.Count(),
            Overdue = g.AsQueryable().Count(overdue),
        }).ToListAsync(ct);
        var matterIds = groups.Select(g => g.MatterId).Distinct().ToList();
        var names = matterIds.Count == 0
            ? []
            : await db.Set<Matter>().AsNoTracking().Where(m => matterIds.Contains(m.Id)).Select(m => new { m.Id, m.MatterRef, m.Name }).ToDictionaryAsync(m => m.Id, ct);

        var result = new Dictionary<(int? PodId, int? UserId), MyMattersWorkloadMatters>();
        foreach (var row in groups.GroupBy(g => (g.PodId, g.UserId)))
        {
            var ordered = row.OrderByDescending(g => g.Open).ThenBy(g => names[g.MatterId].MatterRef, StringComparer.Ordinal).ThenBy(g => g.MatterId).ToList();
            var top = ordered.Take(TopMatters).Select(g =>
            {
                var matter = names[g.MatterId];
                var podQuery = row.Key.PodId is { } pod ? $"pod={pod}" : "noPod=true";
                return new MyMattersWorkloadMatter(
                    g.MatterId,
                    matter.MatterRef,
                    matter.Name,
                    g.Open,
                    g.Overdue,
                    scope.QueueOpen(podQuery, row.Key.UserId is { } who ? $"assignee={who}" : "unassigned=true", "matter=" + g.MatterId.ToString(System.Globalization.CultureInfo.InvariantCulture)));
            }).ToList();
            var rest = ordered.Skip(TopMatters).ToList();
            result[row.Key] = new MyMattersWorkloadMatters(top, rest.Count, rest.Sum(g => g.Open));
        }

        return result;
    }
}
