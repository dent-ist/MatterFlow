namespace MatterFlow.Assets.Contracts;

/// <summary>A Task that an Asset is linked to ("Linked Tasks" on the Asset detail).</summary>
/// <param name="TaskId">Internal Task id.</param>
/// <param name="TaskNumber">Human-friendly reference, for example <c>TSK-1042</c>.</param>
/// <param name="Title">Task title.</param>
/// <param name="StatusCode">Task status code (<c>NEW</c>, <c>IN_PROGRESS</c>, <c>ON_HOLD</c>, <c>COMPLETED</c>, <c>CANCELLED</c>).</param>
/// <param name="AssetLinkRoleId">The relationship of the Asset to the Task, if one was chosen.</param>
/// <param name="AssetLinkRoleName">Name of that role.</param>
/// <param name="LinkedAtUtc">When the link was made (UTC).</param>
/// <param name="DueDate">The Task's due date when it has a date only (the same field the Task Queue shows), else null.</param>
/// <param name="DueAtUtc">The Task's due instant (UTC) when it has a time, else null.</param>
/// <param name="IsAsap">The Task is due as soon as possible.</param>
/// <param name="IsOverdue">The Task is open and its due date has passed in the viewer's time zone: the rule of the Task Queue.</param>
/// <param name="IsOpen">The Task is New, In Progress or On Hold.</param>
/// <param name="AssigneeUserId">The assigned person, if any.</param>
/// <param name="AssigneeName">Display name of the assigned person.</param>
/// <param name="PriorityLabel">The Task's priority label.</param>
/// <param name="PriorityColor">The Task's priority colour token.</param>
public sealed record AssetTaskLink(
    long TaskId,
    string TaskNumber,
    string Title,
    string StatusCode,
    int? AssetLinkRoleId,
    string? AssetLinkRoleName,
    DateTime LinkedAtUtc,
    DateOnly? DueDate = null,
    DateTime? DueAtUtc = null,
    bool IsAsap = false,
    bool IsOverdue = false,
    bool IsOpen = false,
    int? AssigneeUserId = null,
    string? AssigneeName = null,
    string? PriorityLabel = null,
    string? PriorityColor = null);

/// <summary>How many Tasks an Asset is linked to (BUG A2): all of them, and the open ones (New, In Progress, On Hold: the Task Queue definition).</summary>
/// <param name="Linked">Every Task linked to the Asset.</param>
/// <param name="Open">Of those, the Tasks that are New, In Progress or On Hold.</param>
public sealed record AssetTaskCounts(int Linked, int Open);

/// <summary>One row of <see cref="IAssetTaskLinkReader.Grouped"/>: the link counts of one Asset (an Asset with no link has no row).</summary>
public sealed class AssetTaskCountRow
{
    /// <summary>The Asset id.</summary>
    public int AssetId { get; init; }

    /// <summary>Every Task linked to the Asset.</summary>
    public int Linked { get; init; }

    /// <summary>Of those, the Tasks that are New, In Progress or On Hold.</summary>
    public int Open { get; init; }
}

/// <summary>
/// Implemented by the module that owns Task-Asset links (WorkManagement), so the Assets module can show the Tasks using an Asset without
/// referencing it. Without an implementation the list is empty.
/// </summary>
public interface IAssetTaskLinkReader
{
    /// <summary>The Tasks the Asset is linked to, due date ascending (no due date last), then newest link first. Only the Tasks the caller may see (sensitive-matter rule, mode T).</summary>
    Task<IReadOnlyList<AssetTaskLink>> ListForAssetAsync(int assetId, CancellationToken cancellationToken = default);

    /// <summary>
    /// The link counts of the given Assets (a page of ids) in ONE grouped statement, whatever the number of ids; Assets with no link are absent.
    /// Counts only the Tasks the caller may see (sensitive-matter rule, mode T). Never applies a permission: the caller checks <c>Task.View</c> first.
    /// </summary>
    Task<IReadOnlyDictionary<int, AssetTaskCounts>> CountForAssetsAsync(IReadOnlyCollection<int> assetIds, CancellationToken cancellationToken = default);

    /// <summary>
    /// The ids of the Assets linked to a Task that is currently assigned to the person: the part of the asset rule (mode A, epic #788) that lets an assignee
    /// open the assets of their own task. A query, so a list can use it as a subquery.
    /// </summary>
    IQueryable<int> AssetIdsOfTasksAssignedTo(int userId);

    /// <summary>
    /// Loads, once per request, the Assets that reach the person only through their assignment: linked to a Task currently assigned to them on a sensitive matter (the Assets of
    /// every other matter are visible by the matter rule anyway). A few ids, so a list can write the rule as a parameter list instead of a subquery (issue #810). Safe to call again;
    /// a write in the same request drops the loaded ids.
    /// </summary>
    Task PrepareAsync(int userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// The ids loaded by <see cref="PrepareAsync"/> for this person, or null when none are loaded (not prepared, a save happened since, another person, or too many to send as a list):
    /// the caller then uses <see cref="AssetIdsOfTasksAssignedTo"/> as a subquery. Together with the matter rule it gives the same Assets either way.
    /// </summary>
    IReadOnlyList<int>? PreparedAssetIdsOfTasksAssignedTo(int userId);

    /// <summary>The link counts grouped by Asset, as a query so a list can join it and sort by it (one row per linked Asset; a missing row means 0).</summary>
    IQueryable<AssetTaskCountRow> Grouped();
}
