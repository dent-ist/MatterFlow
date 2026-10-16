using MatterFlow.Configuration.Domain;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Time;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// Read side of the task type coverage matrix: one grouped read of the Tasks completed in the period (status COMPLETED, completion time inside the
/// period in the viewer's zone) by assigned person and task type, plus the people, task types and pods to label it. The person is the assignee of
/// the completed Task: the Task keeps no separate "completed by" (reassignment after completion is not possible), so this is the person who held
/// it when it was completed. Cancelled Tasks never count. For training and cross-coverage planning only (addendum Q): no ranking or score.
/// </summary>
public sealed class CoverageService(DbContext db, IClock clock, IUserTimeZone timeZone, IUserAvailabilityReader availability)
{
    public async Task<Result<CoverageBoard>> GetAsync(CoverageQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        var queueClock = QueueClock.Create(clock.UtcNow, timeZone);

        var resolved = DashboardPeriods.Resolve(query.Period, query.From, query.To, query.PeriodDays, queueClock.Today);
        if (resolved.IsFailure)
            return resolved.Error!;
        var (from, to) = (resolved.Value.From, resolved.Value.To);

        var fromUtc = queueClock.StartOfDayUtc(from);
        var toUtc = queueClock.EndOfDayUtc(to);

        var grouped = await db.Set<WorkTask>().AsNoTracking()
            .Where(t => t.Status == TaskStatusCode.Completed && t.AssignedUserId != null && t.CompletedAtUtc >= fromUtc && t.CompletedAtUtc < toUtc)
            .GroupBy(t => new { UserId = t.AssignedUserId!.Value, t.TaskTypeId })
            .Select(g => new { g.Key.UserId, g.Key.TaskTypeId, Completed = g.Count() })
            .ToListAsync(ct);
        var completedBy = grouped.Select(g => g.UserId).Distinct().ToList();

        // Active users who can hold work, plus (unless switched off) inactive users who completed something in the period.
        var includeInactive = query.IncludeInactive ?? true;
        var people = db.Set<AppUser>().AsNoTracking().Where(u =>
            (u.IsActive && u.Roles.Any(ur => ur.Role.IsActive && (ur.Role.IsSystemAdmin || ur.Role.Permissions.Any(rp => rp.Permission.IsActive))))
            || (includeInactive && !u.IsActive && completedBy.Contains(u.Id)));
        if (query.PodId is { } podId)
            people = people.Where(u => db.Set<PodMember>().Any(m => m.PodId == podId && m.UserId == u.Id));
        var users = await people.Select(u => new { u.Id, u.DisplayName, u.IsActive }).ToListAsync(ct);
        var ids = users.Select(u => u.Id).ToHashSet();

        var cells = grouped.Where(g => ids.Contains(g.UserId)).ToList();
        var usedTypes = cells.Select(c => c.TaskTypeId).ToHashSet();
        var types = await db.Set<TaskType>().AsNoTracking()
            .Where(t => t.IsActive || usedTypes.Contains(t.Id))
            .Select(t => new { t.Id, t.Name, t.IconKey, t.IsActive })
            .ToListAsync(ct);

        var pods = (await db.Set<PodMember>().AsNoTracking().Where(m => m.Pod.IsActive && ids.Contains(m.UserId))
                .Select(m => new { m.UserId, m.PodId, m.Pod.Name, m.IsPrimary }).ToListAsync(ct))
            .ToLookup(m => m.UserId);

        var states = await availability.EvaluateAsync([.. ids], queueClock.NowUtc, ct);
        var userTotals = cells.GroupBy(c => c.UserId).ToDictionary(g => g.Key, g => g.Sum(c => c.Completed));
        var typeTotals = cells.GroupBy(c => c.TaskTypeId).ToDictionary(g => g.Key, g => g.Sum(c => c.Completed));
        var typePeople = cells.GroupBy(c => c.TaskTypeId).ToDictionary(g => g.Key, g => g.Select(c => c.UserId).Distinct().Count());

        var typeRows = types
            .OrderBy(t => t.Name, StringComparer.CurrentCultureIgnoreCase).ThenBy(t => t.Id)
            .Select(t => new CoverageTaskType(t.Id, t.Name, t.IconKey, t.IsActive, typeTotals.GetValueOrDefault(t.Id), typePeople.GetValueOrDefault(t.Id)))
            .ToList();
        var userRows = users
            .OrderBy(u => u.DisplayName, StringComparer.CurrentCultureIgnoreCase).ThenBy(u => u.Id)
            .Select(u => new CoverageUser(
                u.Id,
                u.DisplayName,
                WorkloadRules.Initials(u.DisplayName),
                [.. pods[u.Id].OrderBy(p => p.Name, StringComparer.CurrentCultureIgnoreCase).Select(p => new WorkloadPod(p.PodId, p.Name, p.IsPrimary))],
                u.IsActive,
                UserAvailabilitySummary.From(states[u.Id]),
                userTotals.GetValueOrDefault(u.Id)))
            .ToList();

        var summary = new CoverageSummary(typeRows.Count, userRows.Count, typeRows.Count(t => t.PeopleWhoHandledIt < 2), cells.Sum(c => c.Completed));
        var cellRows = cells.OrderBy(c => c.TaskTypeId).ThenBy(c => c.UserId).Select(c => new CoverageCell(c.UserId, c.TaskTypeId, c.Completed)).ToList();
        return new CoverageBoard(
            queueClock.ZoneId,
            DateTime.SpecifyKind(queueClock.NowUtc, DateTimeKind.Utc),
            DashboardRules.Date(from),
            DashboardRules.Date(to),
            to.DayNumber - from.DayNumber + 1,
            typeRows,
            userRows,
            cellRows,
            summary);
    }
}
