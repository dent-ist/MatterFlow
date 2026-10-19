using MatterFlow.SharedKernel.Tasks;
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
}
