using System.ComponentModel.DataAnnotations;
using LptHub.Configuration.Domain;
using LptHub.Identity.Domain;
using LptHub.SharedKernel.Results;
using LptHub.SharedKernel.Tasks;
using LptHub.SharedKernel.Time;
using LptHub.SharedKernel.Visibility;
using LptHub.WorkManagement.Domain;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LptHub.WorkViews.Application.Queries;

/// <summary>Request of the Skills matrix: the page-wide scope.</summary>
public class SkillsQuery
{
    public static readonly IReadOnlyList<string> Keys = ["podScope"];

    /// <summary><c>all</c> (default), <c>mine</c> (the caller's active Pods, resolved on the server) or a Pod id. A Pod that does not exist is 400 <c>UNKNOWN_POD</c>; one the caller may not see is 403.</summary>
    [FromQuery(Name = "podScope"), StringLength(20)]
    public string? PodScope { get; init; }
}

/// <summary>A task type column of the Skills matrix with its totals over the people listed.</summary>
/// <param name="Completed3Months">Tasks of the type the listed people completed in the last 3 months.</param>
/// <param name="Completed12Months">The same for the last 12 months.</param>
/// <param name="ExperiencedPeople">Listed people with at least <c>ExperiencedMin</c> completed in the last 12 months (whatever their availability).</param>
/// <param name="IsThin">True when <c>ExperiencedPeople</c> is at most <c>ThinMax</c>: a training opportunity.</param>
public sealed record SkillsTaskType(
    [property: Required] int TaskTypeId,
    [property: Required] string Name,
    [property: Required] string IconKey,
    [property: Required] bool IsActive,
    [property: Required] int Completed3Months,
    [property: Required] int Completed12Months,
    [property: Required] int ExperiencedPeople,
    [property: Required] bool IsThin);

/// <summary>A person row of the Skills matrix (alphabetical, never ranked). <c>State</c> and <c>Load</c> are the capacity battery's (the load is the true count of New and In progress Tasks, a bare integer).</summary>
public sealed record SkillsPerson(
    [property: Required] int UserId,
    [property: Required] string DisplayName,
    [property: Required] string Initials,
    [property: Required] IReadOnlyList<WorkloadPod> Pods,
    [property: Required] string State,
    [property: Required] int Load,
    [property: Required] int Completed3Months,
    [property: Required] int Completed12Months);

/// <summary>One non-zero cell: what a person completed of a task type.</summary>
public sealed record SkillsCell([property: Required] int UserId, [property: Required] int TaskTypeId, [property: Required] int Completed3Months, [property: Required] int Completed12Months);

/// <summary>
/// The Skills matrix (Dashboard Users, issue #1092): people by task types, completed counts of the last 3 and 12 months, for the workers of the scope (hold <c>Workflow.Execute</c> and are active members of
/// an active Pod in the scope, exactly the capacity battery's workers), with each person's capacity state and load and per type how many are experienced. Counts are over the Tasks the caller may see
/// (sensitive-matter rule: the display figures of the assignee experience), aggregate numbers only. Cells list only non-zero counts. The windows are the last 3 and 12 months back from <c>AsOfUtc</c>.
/// </summary>
public sealed record SkillsMatrix(
    [property: Required] DateTime AsOfUtc,
    [property: Required] DateTime Since3MonthsUtc,
    [property: Required] DateTime Since12MonthsUtc,
    [property: Required] int ExperiencedMin,
    [property: Required] int ThinMax,
    [property: Required] IReadOnlyList<SkillsTaskType> Types,
    [property: Required] IReadOnlyList<SkillsPerson> People,
    [property: Required] IReadOnlyList<SkillsCell> Cells);

public static class SkillsRules
{
    /// <summary>Completed Tasks of a type in the last 12 months that make a person experienced with it.</summary>
    public const int ExperiencedMin = 5;

    /// <summary>A type with this many experienced people or fewer is thin (0 to 2).</summary>
    public const int ThinMax = 2;

    public const int ShortMonths = 3;
    public const int LongMonths = 12;
}

/// <summary>
/// Read side of the Skills matrix: the workers (the capacity battery's reader, so the same rule and the same state), one grouped count of completed Tasks by person and type with both windows in the same statement,
/// the Pods of the workers and the task types. A fixed number of statements whatever the number of people.
/// </summary>
public sealed class SkillsService(DbContext db, IClock clock, CapacityService capacity, DashboardScopeResolver scopes, IMatterVisibility visibility)
{
    public async Task<Result<SkillsMatrix>> GetAsync(SkillsQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        var resolved = await scopes.ResolveAsync(query.PodScope, null, ct);
        if (resolved.IsFailure)
            return resolved.Error!;

        var now = DateTime.SpecifyKind(clock.UtcNow, DateTimeKind.Utc);
        var short3 = now.AddMonths(-SkillsRules.ShortMonths);
        var long12 = now.AddMonths(-SkillsRules.LongMonths);

        var workers = await capacity.ReadWorkersAsync(resolved.Value, now, ct);
        var ids = workers.Select(w => w.UserId).ToList();
        var grouped = ids.Count == 0
            ? []
            : await VisibleTasks.Of(db, visibility)
                .Where(t => t.Status == TaskStatusCode.Completed && t.AssignedUserId != null && ids.Contains(t.AssignedUserId.Value) && t.CompletedAtUtc >= long12)
                .GroupBy(t => new { UserId = t.AssignedUserId!.Value, t.TaskTypeId })
                .Select(g => new { g.Key.UserId, g.Key.TaskTypeId, Long = g.Count(), Short = g.Count(t => t.CompletedAtUtc >= short3) })
                .ToListAsync(ct);

        var usedTypes = grouped.Select(g => g.TaskTypeId).ToHashSet();
        var types = await db.Set<TaskType>().AsNoTracking()
            .Where(t => t.IsActive || usedTypes.Contains(t.Id))
            .Select(t => new { t.Id, t.Name, t.IconKey, t.IsActive })
            .ToListAsync(ct);
        var pods = ids.Count == 0
            ? new List<(int UserId, int PodId, string Name, bool IsPrimary)>().ToLookup(p => p.UserId)
            : (await db.Set<PodMember>().AsNoTracking().Where(m => m.Pod.IsActive && ids.Contains(m.UserId)).Select(m => new { m.UserId, m.PodId, m.Pod.Name, m.IsPrimary }).ToListAsync(ct))
                .ToLookup(p => p.UserId, p => (p.UserId, p.PodId, p.Name, p.IsPrimary));

        var perType = grouped.GroupBy(g => g.TaskTypeId).ToDictionary(g => g.Key);
        var perUser = grouped.GroupBy(g => g.UserId).ToDictionary(g => g.Key);

        var typeRows = types
            .OrderBy(t => t.Name, StringComparer.CurrentCultureIgnoreCase).ThenBy(t => t.Id)
            .Select(t =>
            {
                var cells = perType.GetValueOrDefault(t.Id);
                var experienced = cells?.Count(c => c.Long >= SkillsRules.ExperiencedMin) ?? 0;
                return new SkillsTaskType(t.Id, t.Name, t.IconKey, t.IsActive, cells?.Sum(c => c.Short) ?? 0, cells?.Sum(c => c.Long) ?? 0, experienced, experienced <= SkillsRules.ThinMax);
            })
            .ToList();

        var people = workers
            .OrderBy(w => w.DisplayName, StringComparer.CurrentCultureIgnoreCase).ThenBy(w => w.UserId)
            .Select(w =>
            {
                var cells = perUser.GetValueOrDefault(w.UserId);
                return new SkillsPerson(
                    w.UserId,
                    w.DisplayName,
                    WorkloadRules.Initials(w.DisplayName),
                    [.. pods[w.UserId].OrderBy(p => p.Name, StringComparer.CurrentCultureIgnoreCase).Select(p => new WorkloadPod(p.PodId, p.Name, p.IsPrimary))],
                    w.State,
                    w.Load,
                    cells?.Sum(c => c.Short) ?? 0,
                    cells?.Sum(c => c.Long) ?? 0);
            })
            .ToList();

        var cellRows = grouped.OrderBy(c => c.TaskTypeId).ThenBy(c => c.UserId).Select(c => new SkillsCell(c.UserId, c.TaskTypeId, c.Short, c.Long)).ToList();
        return new SkillsMatrix(now, short3, long12, SkillsRules.ExperiencedMin, SkillsRules.ThinMax, typeRows, people, cellRows);
    }
}
