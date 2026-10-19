namespace MatterFlow.SharedKernel.Tasks;

/// <summary>
/// Open Task counts for the Task Type, Workflow and Workflow Version administration screens (#372, #391). The Task table belongs to the Work
/// Management module, which the Configuration and Workflow Engine modules may not reference, so the WorkViews module implements this with the
/// predicate of the Task Queue (<c>TaskQueueRules.Open</c>: New, In Progress, On Hold). Counts are configuration data: they cover every Task in
/// every pod and are never trimmed to what the viewer may open. Callers apply the <c>Task.View</c> rule themselves (null without it).
/// </summary>
public interface IConfigurationTaskCounts
{
    /// <summary>Open Tasks per Task Type, in one grouped statement. Types with no open Task are absent (a missing key means 0).</summary>
    Task<IReadOnlyDictionary<int, int>> OpenByTaskTypeAsync(IReadOnlyCollection<int> taskTypeIds, CancellationToken cancellationToken = default);
}

/// <summary>Default <see cref="IConfigurationTaskCounts"/> until the WorkViews module registers the real one: no Task is counted.</summary>
public sealed class NoTasksConfigurationTaskCounts : IConfigurationTaskCounts
{
    public Task<IReadOnlyDictionary<int, int>> OpenByTaskTypeAsync(IReadOnlyCollection<int> taskTypeIds, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyDictionary<int, int>>(new Dictionary<int, int>());
}
