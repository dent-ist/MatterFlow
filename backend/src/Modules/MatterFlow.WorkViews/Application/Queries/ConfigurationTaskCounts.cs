using MatterFlow.SharedKernel.Tasks;
using MatterFlow.WorkflowEngine.Domain;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// The open Task counts behind the Task Type list and detail (#372) and the workflow version table (#391). Open means exactly what the Task Queue
/// and the Dashboard mean (<see cref="TaskQueueRules.Open"/>), so each number equals the total behind the link to the Task Queue. Every Task counts,
/// in every pod, Matter state and Project state (configuration data, not permission trimmed); the caller decides who may see the number.
/// </summary>
public sealed class ConfigurationTaskCounts(DbContext db) : IConfigurationTaskCounts
{
    public async Task<IReadOnlyDictionary<int, int>> OpenByTaskTypeAsync(IReadOnlyCollection<int> taskTypeIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(taskTypeIds);
        if (taskTypeIds.Count == 0)
            return new Dictionary<int, int>();

        var ids = taskTypeIds.Distinct().ToList();
        var rows = await db.Set<WorkTask>().AsNoTracking().Where(TaskQueueRules.Open)
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
        var rows = await (from t in db.Set<WorkTask>().AsNoTracking().Where(TaskQueueRules.Open)
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
        var rows = await db.Set<WorkTask>().AsNoTracking().Where(TaskQueueRules.Open)
            .Where(t => ids.Contains(t.PriorityId))
            .GroupBy(t => t.PriorityId)
            .Select(g => new { Key = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        return rows.ToDictionary(r => r.Key, r => r.Count);
    }

    public async Task<IReadOnlyDictionary<string, int>> CountByStatusAsync(CancellationToken cancellationToken = default)
    {
        var rows = await db.Set<WorkTask>().AsNoTracking()
            .GroupBy(t => t.Status)
            .Select(g => new { Key = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        return rows.ToDictionary(r => r.Key.ToCode(), r => r.Count);
    }
}

/// <summary>The open Task count per assignee behind the Users list and drawer (#426); same open rule as the Task Queue, one grouped statement.</summary>
public sealed class UserTaskCounts(DbContext db) : IUserTaskCounts
{
    public async Task<IReadOnlyDictionary<int, int>> OpenByAssigneeAsync(IReadOnlyCollection<int> userIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(userIds);
        if (userIds.Count == 0)
            return new Dictionary<int, int>();

        var ids = userIds.Distinct().ToList();
        var rows = await db.Set<WorkTask>().AsNoTracking().Where(TaskQueueRules.Open)
            .Where(t => t.AssignedUserId != null && ids.Contains(t.AssignedUserId.Value))
            .GroupBy(t => t.AssignedUserId!.Value)
            .Select(g => new { Key = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        return rows.ToDictionary(r => r.Key, r => r.Count);
    }
}

/// <summary>The Task load per candidate assignee behind the assignee pickers (#757): open count (same rule as the Task Queue) and the last assignment time; two grouped statements whatever the number of users.</summary>
public sealed class AssigneeLoadReader(DbContext db) : IAssigneeLoadReader
{
    public async Task<IReadOnlyDictionary<int, AssigneeLoad>> ReadAsync(IReadOnlyCollection<int> userIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(userIds);
        if (userIds.Count == 0)
            return new Dictionary<int, AssigneeLoad>();

        var ids = userIds.Distinct().ToList();
        var open = await db.Set<WorkTask>().AsNoTracking().Where(TaskQueueRules.Open)
            .Where(t => t.AssignedUserId != null && ids.Contains(t.AssignedUserId.Value))
            .GroupBy(t => t.AssignedUserId!.Value)
            .Select(g => new { Key = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        var last = await db.Set<WorkTask>().AsNoTracking()
            .Where(t => t.AssignedUserId != null && ids.Contains(t.AssignedUserId.Value))
            .GroupBy(t => t.AssignedUserId!.Value)
            .Select(g => new { Key = g.Key, Last = g.Max(t => t.AssignedAtUtc) })
            .ToListAsync(cancellationToken);

        var openByUser = open.ToDictionary(r => r.Key, r => r.Count);
        return last.Select(r => r.Key).Union(openByUser.Keys).ToDictionary(
            id => id,
            id => new AssigneeLoad(openByUser.GetValueOrDefault(id), last.FirstOrDefault(r => r.Key == id)?.Last));
    }
}
