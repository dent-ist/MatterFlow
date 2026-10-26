using MatterFlow.Configuration.Domain;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>What a My Matters row says about the kind of work, the priority and the state of a task (PM v2, #855). Loaded for the few rows a call returns.</summary>
public sealed record TaskFacts(
    int TaskTypeId,
    string TaskTypeName,
    string TaskTypeIconKey,
    string? TaskTypeColourKey,
    string PriorityName,
    int PriorityRank,
    string StatusCode,
    int AgeDays,
    MyMattersOnHold? OnHold,
    bool AtRisk)
{
    /// <summary>A task that vanished between the two reads: empty facts rather than a failure.</summary>
    public static TaskFacts Unknown { get; } = new(0, string.Empty, "file-text", null, string.Empty, 0, string.Empty, 0, null, false);
}

/// <summary>Loads <see cref="TaskFacts"/> for a set of tasks: one statement for the task columns and one each for the types, priorities and hold reasons they use, plus one for the overdue test.</summary>
public static class MyMattersTaskFacts
{
    public static async Task<IReadOnlyDictionary<long, TaskFacts>> LoadAsync(DbContext db, IReadOnlyCollection<long> taskIds, QueueClock clock, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(clock);
        if (taskIds.Count == 0)
            return new Dictionary<long, TaskFacts>();

        var ids = taskIds.Distinct().ToList();
        var rows = await db.Set<WorkTask>().AsNoTracking().Where(t => ids.Contains(t.Id))
            .Select(t => new { t.Id, t.TaskTypeId, t.PriorityId, t.Status, t.CreatedAtUtc, t.StatusChangedAtUtc, t.OnHoldReasonId, t.DueDate, t.DueAtUtc })
            .ToListAsync(ct);
        var typeIds = rows.Select(r => r.TaskTypeId).Distinct().ToList();
        var priorityIds = rows.Select(r => r.PriorityId).Distinct().ToList();
        var reasonIds = rows.Where(r => r.OnHoldReasonId != null).Select(r => r.OnHoldReasonId!.Value).Distinct().ToList();
        var types = await db.Set<TaskType>().AsNoTracking().Where(t => typeIds.Contains(t.Id))
            .Select(t => new { t.Id, t.Name, t.IconKey, t.ColourKey, t.TargetDays }).ToDictionaryAsync(t => t.Id, ct);
        var priorities = await db.Set<Priority>().AsNoTracking().Where(p => priorityIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => new { p.Label, p.SortOrder }, ct);
        var reasons = reasonIds.Count == 0
            ? []
            : await db.Set<OnHoldReason>().AsNoTracking().Where(r => reasonIds.Contains(r.Id)).ToDictionaryAsync(r => r.Id, r => r.Name, ct);

        var result = new Dictionary<long, TaskFacts>();
        foreach (var r in rows)
        {
            types.TryGetValue(r.TaskTypeId, out var type);
            var overdue = TaskQueueRules.IsOverdue(r.Status, r.DueDate, r.DueAtUtc, clock);
            MyMattersOnHold? onHold = r.Status == TaskStatusCode.OnHold
                ? new MyMattersOnHold(r.OnHoldReasonId is { } rid ? reasons.GetValueOrDefault(rid) : null, MyMattersRules.WholeDaysSince(r.StatusChangedAtUtc, clock.NowUtc))
                : null;
            priorities.TryGetValue(r.PriorityId, out var priority);
            result[r.Id] = new TaskFacts(
                r.TaskTypeId,
                type?.Name ?? string.Empty,
                type?.IconKey ?? "file-text",
                type?.ColourKey,
                priority?.Label ?? string.Empty,
                priority?.SortOrder ?? 0,
                r.Status.ToCode(),
                MyMattersRules.WholeDaysSince(r.CreatedAtUtc, clock.NowUtc),
                onHold,
                AtRiskRules.IsAtRisk(r.Status, overdue, r.CreatedAtUtc, type?.TargetDays, clock.NowUtc));
        }

        return result;
    }
}
