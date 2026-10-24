namespace MatterFlow.SharedKernel.Tasks;

/// <summary>What the assignee suggestions need to know about one person's Task load (#757).</summary>
/// <param name="OpenTaskCount">Tasks assigned to the person that are open: New, In Progress or On Hold (the Task Queue's rule).</param>
/// <param name="LastAssignedUtc">When a Task was last assigned to the person (the newest assignment time among the Tasks they hold, open or closed); null when they hold none.</param>
/// <param name="Visible">The same two facts counted over the tasks the caller may see (sensitive-matter rule, epic #788): what a screen may DISPLAY. Null: the same as the true values
/// (the rule is off). The ranking uses the true values (owner decision Q5: rank by true load, display only what the viewer may see).</param>
public sealed record AssigneeLoad(int OpenTaskCount, DateTime? LastAssignedUtc, AssigneeLoadDisplay? Visible = null);

/// <summary>What a viewer may see of a person's load: open tasks and the last assignment time over the tasks that viewer can see.</summary>
public sealed record AssigneeLoadDisplay(int OpenTaskCount, DateTime? LastAssignedUtc);

/// <summary>
/// Task load per candidate assignee for the assignee pickers (#757). The Task table belongs to the Work Management module, which the Identity
/// module (where the lookup lives) may not reference, so the WorkViews module implements this. A constant number of grouped statements,
/// whatever the number of users. Every Task counts, in every pod and Matter state, for the ranking; the display values count only what the caller may see; the caller applies the <c>Task.Assign</c> rule.
/// </summary>
public interface IAssigneeLoadReader
{
    /// <summary>Load of each of the users. Users who hold no Task are absent (a missing key means no open Tasks and never assigned).</summary>
    Task<IReadOnlyDictionary<int, AssigneeLoad>> ReadAsync(IReadOnlyCollection<int> userIds, CancellationToken cancellationToken = default);
}

/// <summary>Default <see cref="IAssigneeLoadReader"/> until the WorkViews module registers the real one: nobody holds a Task.</summary>
public sealed class NoTasksAssigneeLoadReader : IAssigneeLoadReader
{
    public Task<IReadOnlyDictionary<int, AssigneeLoad>> ReadAsync(IReadOnlyCollection<int> userIds, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyDictionary<int, AssigneeLoad>>(new Dictionary<int, AssigneeLoad>());
}
