namespace MatterFlow.SharedKernel.Tasks;

/// <summary>What the assignee suggestions need to know about one person's Task load (#757).</summary>
/// <param name="OpenTaskCount">Tasks assigned to the person that are open: New, In Progress or On Hold (the Task Queue's rule).</param>
/// <param name="LastAssignedUtc">When a Task was last assigned to the person (the newest assignment time among the Tasks they hold, open or closed); null when they hold none.</param>
/// <param name="Visible">The same two facts counted over the tasks the caller may see (sensitive-matter rule, epic #788): what a screen may DISPLAY. Null: the same as the true values
/// (the rule is off). The ranking uses the true values (owner decision Q5: rank by true load, display only what the viewer may see).</param>
/// <param name="ActiveCount">Dashboard v4 capacity load: the person's open Tasks that are New or In progress (On hold does not count), the TRUE number whatever the visibility rule (a bare integer, decision AS item 12).</param>
public sealed record AssigneeLoad(int OpenTaskCount, DateTime? LastAssignedUtc, AssigneeLoadDisplay? Visible = null, int ActiveCount = 0);

/// <summary>What a viewer may see of a person's load: open tasks, the capacity load (New and In progress) and the last assignment time over the tasks that viewer can see.</summary>
public sealed record AssigneeLoadDisplay(int OpenTaskCount, DateTime? LastAssignedUtc, int ActiveCount);

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

/// <summary>
/// How much of one Task Type a person completed lately (DB-14, assignee ranking step 2).
/// </summary>
/// <param name="Completed">Tasks of the type the person completed in the window: the TRUE count, what the ranking orders by.</param>
/// <param name="Visible">The same count over the tasks the caller may see (sensitive-matter rule), what a screen may DISPLAY. Null: the same as <paramref name="Completed"/> (the rule is off).</param>
public sealed record AssigneeExperience(int Completed, int? Visible = null);

/// <summary>
/// Experience of candidate assignees with one Task Type: Tasks of that type the person COMPLETED (Completed only, not Cancelled) since a given instant. The Task table belongs to the
/// Work Management module, which the Identity module may not reference, so the WorkViews module implements this (like <see cref="IAssigneeLoadReader"/>). One grouped statement per
/// call, whatever the number of users. The person is the one the Task was assigned to when it was completed.
/// </summary>
public interface IAssigneeExperienceReader
{
    /// <summary>Completed Tasks of the type per user since <paramref name="sinceUtc"/>. Users with none are absent.</summary>
    Task<IReadOnlyDictionary<int, AssigneeExperience>> ReadAsync(IReadOnlyCollection<int> userIds, int taskTypeId, DateTime sinceUtc, CancellationToken cancellationToken = default);
}

/// <summary>Default <see cref="IAssigneeExperienceReader"/> until the WorkViews module registers the real one: nobody completed anything.</summary>
public sealed class NoTasksAssigneeExperienceReader : IAssigneeExperienceReader
{
    public Task<IReadOnlyDictionary<int, AssigneeExperience>> ReadAsync(IReadOnlyCollection<int> userIds, int taskTypeId, DateTime sinceUtc, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyDictionary<int, AssigneeExperience>>(new Dictionary<int, AssigneeExperience>());
}
