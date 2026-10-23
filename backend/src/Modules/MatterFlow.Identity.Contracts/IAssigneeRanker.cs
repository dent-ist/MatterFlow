namespace MatterFlow.Identity.Contracts;

/// <summary>One person who could be assigned a Task, with the facts a ranking may use.</summary>
/// <param name="UserId">User id.</param>
/// <param name="DisplayName">Display name.</param>
/// <param name="OpenTaskCount">Open Tasks (New, In Progress, On Hold) assigned to the person.</param>
/// <param name="LastAssignedUtc">When a Task was last assigned to the person; null when never.</param>
/// <param name="IsAvailable">False while out of office (work hours and time zone are not considered).</param>
/// <param name="AvailableAgainUtc">While out of office: when it ends (UTC); null when open-ended or available.</param>
public sealed record AssigneeCandidate(int UserId, string DisplayName, int OpenTaskCount, DateTime? LastAssignedUtc, bool IsAvailable, DateTime? AvailableAgainUtc);

/// <summary>What to rank: who, for which Pod and Task Type (both optional, for smarter rules), and the instant "now".</summary>
/// <param name="Candidates">The eligible people (active, holding a role), already narrowed to the Pod's members when the Task is in a Pod.</param>
/// <param name="PodId">The Pod of the Task, when it has one.</param>
/// <param name="TaskTypeId">The Task Type of the Task, when known (the default ranking ignores it; a later rule may weigh experience with the type).</param>
/// <param name="NowUtc">The current instant (UTC), so a ranking is deterministic in tests.</param>
public sealed record AssigneeRankingRequest(IReadOnlyList<AssigneeCandidate> Candidates, int? PodId, int? TaskTypeId, DateTime NowUtc);

/// <summary>One candidate in ranked position.</summary>
/// <param name="Candidate">The candidate, unchanged.</param>
/// <param name="Suggestable">Whether the person may appear in the short Suggested list (the default: available).</param>
/// <param name="Reason">Why the person ranks here, in a short sentence for a tooltip ("2 open tasks, last assigned 3 days ago").</param>
public sealed record RankedAssignee(AssigneeCandidate Candidate, bool Suggestable, string Reason);

/// <summary>
/// The single place that decides who is the best person to assign a Task to (#757). Every assignee picker (inline grid picker, Edit task,
/// Create task) gets its order and its Suggested list from the implementation registered in <c>IdentityModule</c>; a smarter rule (skills,
/// experience with the Task Type) replaces that one registration and nothing else. Pure: no I/O, so it is unit tested without a database.
/// </summary>
public interface IAssigneeRanker
{
    /// <summary>The candidates in order, best first, every candidate present exactly once.</summary>
    IReadOnlyList<RankedAssignee> Rank(AssigneeRankingRequest request);
}
