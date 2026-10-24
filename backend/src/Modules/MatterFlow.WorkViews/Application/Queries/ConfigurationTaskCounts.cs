using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Visibility;
using MatterFlow.WorkflowEngine.Domain;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// The open Task counts behind the Task Type list and detail (#372) and the workflow version table (#391). Open means exactly what the Task Queue
/// and the Dashboard mean (<see cref="TaskQueueRules.Open"/>), so each number equals the total behind the link to the Task Queue. Every Task counts,
/// in every pod, Matter state and Project state, but only the Tasks the caller may see (sensitive-matter rule, epic #788): the numbers are what a screen DISPLAYS. The integrity guards ("in use, deactivate instead") use the unfiltered probes (<c>IPriorityUsage</c>, <c>IMatterTaskGuard</c>, <c>IUserWorkSource</c>) and say "in use" without a number. The caller decides who may see the number.
/// </summary>
public sealed class ConfigurationTaskCounts(DbContext db, IMatterVisibility visibility) : IConfigurationTaskCounts
{
    public async Task<IReadOnlyDictionary<int, int>> OpenByTaskTypeAsync(IReadOnlyCollection<int> taskTypeIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(taskTypeIds);
        if (taskTypeIds.Count == 0)
            return new Dictionary<int, int>();

        var ids = taskTypeIds.Distinct().ToList();
        var rows = await VisibleTasks.Of(db, visibility).Where(TaskQueueRules.Open)
            .Where(t => ids.Contains(t.TaskTypeId))
            .GroupBy(t => t.TaskTypeId)
            .Select(g => new { Key = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        return rows.ToDictionary(r => r.Key, r => r.Count);
    }

    public async Task<IReadOnlyDictionary<int, int>> OpenByWorkflowVersionAsync(IReadOnlyCollection<int> workflowVersionIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(workflowVersionIds);
        if (workflowVersionIds.Count == 0)
            return new Dictionary<int, int>();

        var ids = workflowVersionIds.Distinct().ToList();
        var rows = await (from t in VisibleTasks.Of(db, visibility).Where(TaskQueueRules.Open)
                          join i in db.Set<WorkflowInstanceRecord>().AsNoTracking() on t.WorkflowInstanceId equals i.Id
                          where ids.Contains(i.WorkflowVersionId)
                          group t by i.WorkflowVersionId into g
                          select new { Key = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        return rows.ToDictionary(r => r.Key, r => r.Count);
    }

    public async Task<IReadOnlyDictionary<int, int>> OpenByPriorityAsync(IReadOnlyCollection<int> priorityIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(priorityIds);
        if (priorityIds.Count == 0)
            return new Dictionary<int, int>();

        var ids = priorityIds.Distinct().ToList();
        var rows = await VisibleTasks.Of(db, visibility).Where(TaskQueueRules.Open)
            .Where(t => ids.Contains(t.PriorityId))
            .GroupBy(t => t.PriorityId)
            .Select(g => new { Key = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        return rows.ToDictionary(r => r.Key, r => r.Count);
    }

    public async Task<IReadOnlyDictionary<string, int>> CountByStatusAsync(CancellationToken cancellationToken = default)
    {
        var rows = await VisibleTasks.Of(db, visibility)
            .GroupBy(t => t.Status)
            .Select(g => new { Key = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        return rows.ToDictionary(r => r.Key.ToCode(), r => r.Count);
    }
}

/// <summary>The open Task count per assignee behind the Users list and drawer (#426); same open rule as the Task Queue, one grouped statement.</summary>
public sealed class UserTaskCounts(DbContext db, IMatterVisibility visibility) : IUserTaskCounts
{
    public async Task<IReadOnlyDictionary<int, int>> OpenByAssigneeAsync(IReadOnlyCollection<int> userIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(userIds);
        if (userIds.Count == 0)
            return new Dictionary<int, int>();

        var ids = userIds.Distinct().ToList();
        var rows = await VisibleTasks.Of(db, visibility).Where(TaskQueueRules.Open)
            .Where(t => t.AssignedUserId != null && ids.Contains(t.AssignedUserId.Value))
            .GroupBy(t => t.AssignedUserId!.Value)
            .Select(g => new { Key = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        return rows.ToDictionary(r => r.Key, r => r.Count);
    }
}

/// <summary>The Task load per candidate assignee behind the assignee pickers (#757): open count (same rule as the Task Queue) and the last assignment time; two grouped statements whatever the number of users.</summary>
public sealed class AssigneeLoadReader(DbContext db, IMatterVisibility visibility) : IAssigneeLoadReader
{
    public async Task<IReadOnlyDictionary<int, AssigneeLoad>> ReadAsync(IReadOnlyCollection<int> userIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(userIds);
        if (userIds.Count == 0)
            return new Dictionary<int, AssigneeLoad>();

        var ids = userIds.Distinct().ToList();
        // The true load (what the ranking orders by) and, when the rule is on, the same facts over the tasks the caller may see (what a screen may show).
        var (open, last) = await ReadAsync(db.Set<WorkTask>().AsNoTracking(), ids, cancellationToken);
        (Dictionary<int, int> Open, Dictionary<int, DateTime?> Last)? shown = visibility.Enabled ? await ReadAsync(VisibleTasks.Of(db, visibility), ids, cancellationToken) : null;

        return last.Keys.Union(open.Keys).ToDictionary(
            id => id,
            id => new AssigneeLoad(
                open.GetValueOrDefault(id),
                last.GetValueOrDefault(id),
                shown is null ? null : new AssigneeLoadDisplay(shown.Value.Open.GetValueOrDefault(id), shown.Value.Last.GetValueOrDefault(id))));
    }

    private static async Task<(Dictionary<int, int> Open, Dictionary<int, DateTime?> Last)> ReadAsync(IQueryable<WorkTask> tasks, List<int> ids, CancellationToken cancellationToken)
    {
        var open = await tasks.Where(TaskQueueRules.Open)
            .Where(t => t.AssignedUserId != null && ids.Contains(t.AssignedUserId.Value))
            .GroupBy(t => t.AssignedUserId!.Value)
            .Select(g => new { Key = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        var last = await tasks
            .Where(t => t.AssignedUserId != null && ids.Contains(t.AssignedUserId.Value))
            .GroupBy(t => t.AssignedUserId!.Value)
            .Select(g => new { Key = g.Key, Last = g.Max(t => t.AssignedAtUtc) })
            .ToListAsync(cancellationToken);
        return (open.ToDictionary(r => r.Key, r => r.Count), last.ToDictionary(r => r.Key, r => r.Last));
    }
}
