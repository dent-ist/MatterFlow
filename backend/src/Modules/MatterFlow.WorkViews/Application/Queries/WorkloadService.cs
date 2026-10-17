using MatterFlow.Configuration.Domain;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using MatterFlow.SharedKernel.Availability;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Time;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// Read side of the Dashboard Users tab: per person the open Tasks by Priority, overdue, due soon, on hold, the next due date and the availability
/// from <see cref="IUserAvailabilityReader"/>. The counts use <see cref="TaskQueueRules"/>, so they agree with the Task Queue. A fixed number of
/// grouped reads regardless of the number of Tasks. Operational capacity only: no completion statistics, speed or ranking (addendum).
/// </summary>
public sealed class WorkloadService(DbContext db, IClock clock, IUserTimeZone timeZone, IUserAvailabilityReader availability, IOptions<DashboardOptions> options, DashboardScopeResolver scopes)
{
    public async Task<Result<WorkloadBoard>> GetAsync(WorkloadQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        var filter = WorkloadRules.AvailabilityFilters.FirstOrDefault(f => string.Equals(f, query.Availability ?? WorkloadRules.AvailabilityAll, StringComparison.OrdinalIgnoreCase));
        if (filter is null)
            return Error.Validation("availability", "UNKNOWN_AVAILABILITY", $"Unknown availability '{query.Availability}'. Allowed: {string.Join(", ", WorkloadRules.AvailabilityFilters)}.");

        var resolvedScope = await scopes.ResolveAsync(query.PodScope, query.PodId, ct);
        if (resolvedScope.IsFailure)
            return resolvedScope.Error!;
        var podScope = resolvedScope.Value;

        var queueClock = QueueClock.Create(clock.UtcNow, timeZone);
        var thresholds = new WorkloadThresholds(Math.Max(0, options.Value.Workload.LightMax), Math.Max(options.Value.Workload.LightMax, options.Value.Workload.NormalMax));

        // Active users who can hold work: at least one role that carries an active permission (Access Pending users are left out).
        var people = db.Set<AppUser>().AsNoTracking().Where(u => u.IsActive
            && u.Roles.Any(ur => ur.Role.IsActive && (ur.Role.IsSystemAdmin || ur.Role.Permissions.Any(rp => rp.Permission.IsActive))));
        var hiddenCount = 0;
        if (!podScope.IsAll)
        {
            // A Pod scope lists the members of the scope's Pods ("my pods" without a Pod lists nobody).
            var scopePods = podScope.PodIds.ToList();
            people = people.Where(u => db.Set<PodMember>().Any(m => scopePods.Contains(m.PodId) && m.UserId == u.Id));
        }
        else if (query.IncludeNoPod == false)
        {
            // "Can take work" (U4): a member of at least one active Pod, or someone who holds an open Task (never hidden, so an overloaded person outside every Pod stays visible).
            var everyone = await people.CountAsync(ct);
            people = people.Where(u => db.Set<PodMember>().Any(m => m.UserId == u.Id && m.Pod.IsActive)
                || db.Set<WorkTask>().Where(TaskQueueRules.Open).Any(t => t.AssignedUserId == u.Id));
            hiddenCount = everyone - await people.CountAsync(ct);
        }

        var users = await people.Select(u => new { u.Id, u.DisplayName }).ToListAsync(ct);
        var ids = users.Select(u => u.Id).ToList();

        var tasks = db.Set<WorkTask>().AsNoTracking();
        var open = tasks.Where(TaskQueueRules.Open);
        var mine = open.Where(t => t.AssignedUserId != null && ids.Contains(t.AssignedUserId.Value));

        var byPriority = await mine.GroupBy(t => new { UserId = t.AssignedUserId!.Value, t.PriorityId })
            .Select(g => new { g.Key.UserId, g.Key.PriorityId, Count = g.Count(), OnHold = g.Count(t => t.Status == TaskStatusCode.OnHold) })
            .ToListAsync(ct);
        var overdue = await CountsByUserAsync(mine.Where(TaskQueueRules.Overdue(queueClock)), ct);
        var dueSoon = await CountsByUserAsync(mine.Where(TaskQueueRules.DueSoon(queueClock)).Where(Not(TaskQueueRules.Overdue(queueClock))), ct);
        // The unassigned queue of the scope (the Summary's Unassigned tile): under a Pod scope only the Tasks of that scope's Pods.
        var unassignedTasks = await podScope.Apply(open).CountAsync(t => t.AssignedUserId == null, ct);

        var nextKeys = await mine.Where(t => t.DueSortKey != null)
            .GroupBy(t => t.AssignedUserId!.Value)
            .Select(g => new { UserId = g.Key, Key = g.Min(t => t.DueSortKey) })
            .ToListAsync(ct);
        var keys = nextKeys.Select(k => k.Key).Distinct().ToList();
        var nextCandidates = nextKeys.Count == 0
            ? []
            : await mine.Where(t => t.DueSortKey != null && keys.Contains(t.DueSortKey))
                .Select(t => new { UserId = t.AssignedUserId!.Value, t.Id, t.Number, t.DueDate, t.DueAtUtc, t.DueSortKey, t.Status })
                .ToListAsync(ct);

        var priorityRows = await db.Set<Priority>().AsNoTracking().OrderBy(p => p.SortOrder).ThenBy(p => p.Id)
            .Select(p => new { p.Id, p.Label, p.Color, p.SortOrder, p.IsActive }).ToListAsync(ct);
        var used = byPriority.Select(p => p.PriorityId).ToHashSet();
        var legend = priorityRows.Where(p => p.IsActive || used.Contains(p.Id)).Select(p => new WorkloadPriority(p.Id, p.Label, p.Color, p.SortOrder)).ToList();

        var pods = (await db.Set<PodMember>().AsNoTracking().Where(m => ids.Contains(m.UserId) && m.Pod.IsActive)
                .Select(m => new { m.UserId, m.PodId, m.Pod.Name, m.IsPrimary }).ToListAsync(ct))
            .ToLookup(m => m.UserId);
        var states = await availability.EvaluateAsync(ids, queueClock.NowUtc, ct);

        var entries = users.Select(u =>
        {
            var mineByPriority = byPriority.Where(p => p.UserId == u.Id).ToDictionary(p => p.PriorityId, p => p.Count);
            var openTotal = mineByPriority.Values.Sum();
            var counts = legend.Select(p => new WorkloadPriorityCount(p.PriorityId, mineByPriority.GetValueOrDefault(p.PriorityId))).ToList();
            var top = legend.Where(p => mineByPriority.GetValueOrDefault(p.PriorityId) > 0).OrderBy(p => p.Rank).ThenBy(p => p.PriorityId).FirstOrDefault();
            var next = nextKeys.FirstOrDefault(k => k.UserId == u.Id) is { } nk
                ? nextCandidates.Where(c => c.UserId == u.Id && c.DueSortKey == nk.Key).OrderBy(c => c.Id).FirstOrDefault()
                : null;
            return new WorkloadUser(
                u.Id,
                u.DisplayName,
                WorkloadRules.Initials(u.DisplayName),
                [.. pods[u.Id].OrderBy(p => p.Name, StringComparer.CurrentCultureIgnoreCase).Select(p => new WorkloadPod(p.PodId, p.Name, p.IsPrimary))],
                UserAvailabilitySummary.From(states[u.Id]),
                counts,
                openTotal,
                overdue.GetValueOrDefault(u.Id),
                dueSoon.GetValueOrDefault(u.Id),
                byPriority.Where(p => p.UserId == u.Id).Sum(p => p.OnHold),
                top is null ? null : new WorkloadTopPriority(top.PriorityId, top.Label, top.Color, top.Rank, mineByPriority[top.PriorityId]),
                next is null
                    ? null
                    : new WorkloadNextDue(next.Id, next.Number, next.DueDate, next.DueAtUtc is { } d ? DateTime.SpecifyKind(d, DateTimeKind.Utc) : null, TaskQueueRules.IsOverdue(next.Status, next.DueDate, next.DueAtUtc, queueClock)),
                WorkloadRules.LoadLevel(openTotal, thresholds.LightMax, thresholds.NormalMax));
        }).ToList();

        var summary = new WorkloadSummary(
            entries.Count(e => e.Availability.State != AvailabilityStates.OutOfOffice && e.OpenTotal == 0),
            entries.Count(e => e.Availability.State != AvailabilityStates.OutOfOffice && e.OpenTotal > 0),
            entries.Count(e => e.Availability.State == AvailabilityStates.OutOfOffice),
            unassignedTasks,
            entries.Count);

        IEnumerable<WorkloadUser> shown = entries;
        if (!string.IsNullOrWhiteSpace(query.Q))
        {
            var term = query.Q.Trim();
            shown = shown.Where(e => e.DisplayName.Contains(term, StringComparison.CurrentCultureIgnoreCase));
        }

        shown = filter switch
        {
            WorkloadRules.AvailabilityAvailable => shown.Where(e => e.Availability.State != AvailabilityStates.OutOfOffice),
            WorkloadRules.AvailabilityOut => shown.Where(e => e.Availability.State == AvailabilityStates.OutOfOffice),
            _ => shown,
        };

        // Available first (in hours, then off hours, then out of office), then lighter load first, then by name.
        var ordered = shown
            .OrderBy(e => e.Availability.State switch { AvailabilityStates.Available => 0, AvailabilityStates.OffHours => 1, _ => 2 })
            .ThenBy(e => e.OpenTotal)
            .ThenBy(e => e.DisplayName, StringComparer.CurrentCultureIgnoreCase)
            .ThenBy(e => e.UserId)
            .ToList();

        return new WorkloadBoard(queueClock.ZoneId, DateTime.SpecifyKind(queueClock.NowUtc, DateTimeKind.Utc), legend, ordered, summary, thresholds, hiddenCount);
    }

    private static async Task<Dictionary<int, int>> CountsByUserAsync(IQueryable<WorkTask> tasks, CancellationToken ct) =>
        await tasks.GroupBy(t => t.AssignedUserId!.Value).Select(g => new { UserId = g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.UserId, g => g.Count, ct);

    private static System.Linq.Expressions.Expression<Func<WorkTask, bool>> Not(System.Linq.Expressions.Expression<Func<WorkTask, bool>> predicate) =>
        System.Linq.Expressions.Expression.Lambda<Func<WorkTask, bool>>(System.Linq.Expressions.Expression.Not(predicate.Body), predicate.Parameters);
}
