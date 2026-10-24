using MatterFlow.Assets.Contracts;
using MatterFlow.Assets.Domain;
using MatterFlow.SharedKernel.Visibility;

namespace MatterFlow.Assets.Application;

/// <summary>
/// The assets the caller may see (epic #788, mode A): those of a visible matter, plus those linked to a task that is currently assigned to the caller.
/// Writes follow the matter alone (<see cref="OfVisibleMatters"/>): an assignee reads the assets of their task but cannot create or change assets of a matter they do not see.
/// While the go-live switch is off both are the plain set.
/// </summary>
public sealed class AssetAccess(IMatterVisibility visibility, IEnumerable<IAssetTaskLinkReader> links)
{
    /// <summary>The assets the caller may see (mode A), written as the LEFT JOIN form of the rule.</summary>
    public IQueryable<Asset> Visible(IQueryable<Asset> assets)
    {
        var reader = links.FirstOrDefault();
        return reader is null
            ? visibility.WhereMatterVisible(assets, a => a.MatterId)
            : visibility.WhereMatterVisibleOr(assets, a => a.MatterId, user => VisibilityPredicates.In<Asset, int>(a => a.Id, reader.AssetIdsOfTasksAssignedTo(user)));
    }

    /// <summary>The assets of the matters the caller may see as a whole (mode M): the set a command may load.</summary>
    public IQueryable<Asset> OfVisibleMatters(IQueryable<Asset> assets) => visibility.WhereMatterVisible(assets, a => a.MatterId);

    /// <summary>True when the matter exists and the caller may see it as a whole (mode M).</summary>
    public Task<bool> CanSeeMatterAsync(int matterId, CancellationToken ct) => visibility.CanSeeMatterAsync(matterId, ct);
}
