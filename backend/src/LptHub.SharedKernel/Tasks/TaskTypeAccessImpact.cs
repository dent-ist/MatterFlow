namespace LptHub.SharedKernel.Tasks;

/// <summary>The three role lists of a Task Type (role ids). An empty Can View list means the type is open to everyone.</summary>
/// <param name="CanView">Roles that may see tasks of the type.</param>
/// <param name="CanEdit">Roles that may change tasks of the type; empty = no extra limit among those who can view.</param>
/// <param name="CanAssign">Roles whose people may be assignee; empty = no extra limit among those who can view.</param>
public sealed record TaskTypeAccessSets(IReadOnlyCollection<int> CanView, IReadOnlyCollection<int> CanEdit, IReadOnlyCollection<int> CanAssign);

/// <summary>What saving proposed role lists would do (counts only, no names or ids), computed over all tasks of the type (design section 9.1).</summary>
/// <param name="OpenTasksBecomingHidden">Open tasks of the type that at least one person would no longer see.</param>
/// <param name="PeopleLosingView">Active people holding Task.View who may view the type now and would not afterwards.</param>
/// <param name="OpenTasksAssignedToPeopleLosingView">Open tasks of the type assigned to one of those people.</param>
/// <param name="PeopleLosingEdit">Active people holding Task.View who may edit the type now and would not afterwards (people who lose view count here too).</param>
/// <param name="CallerLosesView">True when the person asking would no longer see the type (System Admin never does).</param>
public sealed record TaskTypeAccessImpact(
    int OpenTasksBecomingHidden,
    int PeopleLosingView,
    int OpenTasksAssignedToPeopleLosingView,
    int PeopleLosingEdit,
    bool CallerLosesView);

/// <summary>
/// The "who is affected" numbers behind the preview of a Task Type access change. The Task table belongs to the Work Management module, which the
/// Configuration module may not reference, so the WorkViews module implements this. The numbers deliberately cover every task, not only the tasks the
/// caller may see: the confirming administrator has to know the real effect (design section 6, gap 3). The caller decides who may ask (<c>TaskType.Manage</c>).
/// </summary>
public interface ITaskTypeAccessImpact
{
    Task<TaskTypeAccessImpact> PreviewAsync(int taskTypeId, TaskTypeAccessSets current, TaskTypeAccessSets proposed, int? callerUserId, CancellationToken cancellationToken = default);
}

/// <summary>Default <see cref="ITaskTypeAccessImpact"/> until the WorkViews module registers the real one: nobody is affected.</summary>
public sealed class NoTasksTaskTypeAccessImpact : ITaskTypeAccessImpact
{
    public Task<TaskTypeAccessImpact> PreviewAsync(int taskTypeId, TaskTypeAccessSets current, TaskTypeAccessSets proposed, int? callerUserId, CancellationToken cancellationToken = default) =>
        Task.FromResult(new TaskTypeAccessImpact(0, 0, 0, 0, false));
}
