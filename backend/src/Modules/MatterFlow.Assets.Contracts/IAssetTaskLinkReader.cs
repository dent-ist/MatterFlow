namespace MatterFlow.Assets.Contracts;

/// <summary>A Task that an Asset is linked to ("Linked Tasks" on the Asset detail).</summary>
/// <param name="TaskId">Internal Task id.</param>
/// <param name="TaskNumber">Human-friendly reference, for example <c>TSK-1042</c>.</param>
/// <param name="Title">Task title.</param>
/// <param name="StatusCode">Task status code (<c>NEW</c>, <c>IN_PROGRESS</c>, <c>ON_HOLD</c>, <c>COMPLETED</c>, <c>CANCELLED</c>).</param>
/// <param name="AssetLinkRoleId">The relationship of the Asset to the Task, if one was chosen.</param>
/// <param name="AssetLinkRoleName">Name of that role.</param>
/// <param name="LinkedAtUtc">When the link was made (UTC).</param>
public sealed record AssetTaskLink(
    long TaskId,
    string TaskNumber,
    string Title,
    string StatusCode,
    int? AssetLinkRoleId,
    string? AssetLinkRoleName,
    DateTime LinkedAtUtc);

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
    /// <summary>The Tasks the Asset is linked to, newest link first.</summary>
    Task<IReadOnlyList<AssetTaskLink>> ListForAssetAsync(int assetId, CancellationToken cancellationToken = default);

    /// <summary>
    /// The link counts of the given Assets (a page of ids) in ONE grouped statement, whatever the number of ids; Assets with no link are absent.
    /// Never applies a permission: the caller checks <c>Task.View</c> first.
    /// </summary>
    Task<IReadOnlyDictionary<int, AssetTaskCounts>> CountForAssetsAsync(IReadOnlyCollection<int> assetIds, CancellationToken cancellationToken = default);

    /// <summary>The link counts grouped by Asset, as a query so a list can join it and sort by it (one row per linked Asset; a missing row means 0).</summary>
    IQueryable<AssetTaskCountRow> Grouped();
}
