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

/// <summary>
/// Implemented by the module that owns Task-Asset links (WorkManagement), so the Assets module can show the Tasks using an Asset without
/// referencing it. Without an implementation the list is empty.
/// </summary>
public interface IAssetTaskLinkReader
{
    /// <summary>The Tasks the Asset is linked to, newest link first.</summary>
    Task<IReadOnlyList<AssetTaskLink>> ListForAssetAsync(int assetId, CancellationToken cancellationToken = default);
}
