namespace MatterFlow.SharedKernel.Tasks;

/// <summary>
/// Open Task counts for the Task Type, Workflow and Workflow Version administration screens (#372, #391). The Task table belongs to the Work
/// Management module, which the Configuration and Workflow Engine modules may not reference, so the WorkViews module implements this with the
/// predicate of the Task Queue (<c>TaskQueueRules.Open</c>: New, In Progress, On Hold). Counts cover every pod but only the Tasks the viewer may see
/// (sensitive-matter rule, epic #788); the "in use" guards of deletes use their own unfiltered probes and show no number. Callers apply the <c>Task.View</c> rule themselves (null without it).
/// </summary>
public interface IConfigurationTaskCounts
{
    /// <summary>Open Tasks per Task Type, in one grouped statement. Types with no open Task are absent (a missing key means 0).</summary>
    Task<IReadOnlyDictionary<int, int>> OpenByTaskTypeAsync(IReadOnlyCollection<int> taskTypeIds, CancellationToken cancellationToken = default);

    /// <summary>Open Tasks per workflow version (through the workflow instance each Task runs on), in one grouped statement. Absent means 0.</summary>
    Task<IReadOnlyDictionary<int, int>> OpenByWorkflowVersionAsync(IReadOnlyCollection<int> workflowVersionIds, CancellationToken cancellationToken = default);

    /// <summary>Open Tasks per priority (#599), in one grouped statement. Priorities with no open Task are absent (a missing key means 0).</summary>
    Task<IReadOnlyDictionary<int, int>> OpenByPriorityAsync(IReadOnlyCollection<int> priorityIds, CancellationToken cancellationToken = default);

    /// <summary>Tasks per status code (<c>NEW</c>, ..., <c>CANCELLED</c>; #599), open or closed, in one grouped statement. Statuses with no Task are absent.</summary>
    Task<IReadOnlyDictionary<string, int>> CountByStatusAsync(CancellationToken cancellationToken = default);
}

/// <summary>Default <see cref="IConfigurationTaskCounts"/> until the WorkViews module registers the real one: no Task is counted.</summary>
public sealed class NoTasksConfigurationTaskCounts : IConfigurationTaskCounts
{
    public Task<IReadOnlyDictionary<int, int>> OpenByTaskTypeAsync(IReadOnlyCollection<int> taskTypeIds, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyDictionary<int, int>>(new Dictionary<int, int>());

    public Task<IReadOnlyDictionary<int, int>> OpenByWorkflowVersionAsync(IReadOnlyCollection<int> workflowVersionIds, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyDictionary<int, int>>(new Dictionary<int, int>());

    public Task<IReadOnlyDictionary<int, int>> OpenByPriorityAsync(IReadOnlyCollection<int> priorityIds, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyDictionary<int, int>>(new Dictionary<int, int>());

    public Task<IReadOnlyDictionary<string, int>> CountByStatusAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyDictionary<string, int>>(new Dictionary<string, int>());
}

/// <summary>
/// Open Task counts per assignee for the Users administration (#426): the offboarding aid "this person still has 7 open tasks". Open means
/// exactly what the Task Queue means (New, In Progress, On Hold). Every Task counts, in every pod and Matter state; the caller decides who
/// may see the number (<c>Task.View</c>).
/// </summary>
public interface IUserTaskCounts
{
    /// <summary>Open Tasks assigned to each of the users, in one grouped statement. Users with none are absent (a missing key means 0).</summary>
    Task<IReadOnlyDictionary<int, int>> OpenByAssigneeAsync(IReadOnlyCollection<int> userIds, CancellationToken cancellationToken = default);
}

/// <summary>Default <see cref="IUserTaskCounts"/> until the WorkViews module registers the real one: no Task is counted.</summary>
public sealed class NoTasksUserTaskCounts : IUserTaskCounts
{
    public Task<IReadOnlyDictionary<int, int>> OpenByAssigneeAsync(IReadOnlyCollection<int> userIds, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyDictionary<int, int>>(new Dictionary<int, int>());
}
