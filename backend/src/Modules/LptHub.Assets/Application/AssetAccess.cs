using System.Linq.Expressions;
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
            : visibility.WhereMatterVisibleOr(assets, a => a.MatterId, user => AssignedAssets(reader, user));
    }

    /// <summary>
    /// "Linked to a task assigned to the person" as a parameter list when it was prepared (<see cref="PrepareAsync"/>), otherwise as the subquery. A subquery joined by OR made the
    /// plan probe the link table once per asset (50,000 reads, issue #810).
    /// </summary>
    internal static Expression<Func<Asset, bool>> AssignedAssets(IAssetTaskLinkReader reader, int user)
    {
        if (reader.PreparedAssetIdsOfTasksAssignedTo(user) is not { } ids)
            return VisibilityPredicates.In<Asset, int>(a => a.Id, reader.AssetIdsOfTasksAssignedTo(user));

        if (ids.Count == 0)
            return a => false;

        var list = ids.ToArray();
        return a => list.Contains(a.Id);
    }

    /// <summary>Loads what <see cref="Visible"/> needs for the caller (the assets of their tasks on sensitive matters); call before a list or count. A no-op while the rule is off or for a see-all caller.</summary>
    public async Task PrepareAsync(CancellationToken ct)
    {
        if (!visibility.Enabled || links.FirstOrDefault() is not { } reader)
            return;

        var viewer = visibility.Current;
        if (!viewer.SeeAll && viewer.UserId is { } user)
            await reader.PrepareAsync(user, ct);
    }

    /// <summary>The assets of the matters the caller may see as a whole (mode M): the set a command may load.</summary>
    public IQueryable<Asset> OfVisibleMatters(IQueryable<Asset> assets) => visibility.WhereMatterVisible(assets, a => a.MatterId);

    /// <summary>True when the matter exists and the caller may see it as a whole (mode M).</summary>
    public Task<bool> CanSeeMatterAsync(int matterId, CancellationToken ct) => visibility.CanSeeMatterAsync(matterId, ct);
}
