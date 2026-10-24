namespace MatterFlow.Assets.Contracts;

/// <summary>An Asset as other modules see it (Tasks link Assets of their own Matter only).</summary>
/// <param name="AssetId">Internal id.</param>
/// <param name="MatterId">The one Matter that owns the Asset; it never changes.</param>
/// <param name="AssetTypeId">Asset Type id.</param>
/// <param name="AssetTypeName">Asset Type name.</param>
/// <param name="DisplayName">Name shown in lists and pickers.</param>
/// <param name="ExternalReference">URL, workspace id or media label, if any.</param>
/// <param name="IsActive">Inactive assets keep their history and existing links but cannot be linked anew.</param>
public sealed record AssetSummary(
    int AssetId,
    int MatterId,
    int AssetTypeId,
    string AssetTypeName,
    string DisplayName,
    string? ExternalReference,
    bool IsActive);

/// <summary>A Matter's active Assets in short: how many there are and the first few by name (the matter overview, epic #758).</summary>
/// <param name="Total">All active Assets of the Matter.</param>
/// <param name="First">The first Assets by display name.</param>
public sealed record MatterAssetSnapshot(int Total, IReadOnlyList<AssetSummary> First);

/// <summary>Read-only lookups of Assets for other modules (Tasks, Search, WorkViews).</summary>
public interface IAssetDirectory
{
    /// <summary>The Asset with the given id (including its Matter id, so callers can enforce same-Matter links), or null.</summary>
    Task<AssetSummary?> FindAsync(int assetId, CancellationToken cancellationToken = default);

    /// <summary>The Assets with the given ids that exist (missing ids are skipped), in no particular order.</summary>
    Task<IReadOnlyList<AssetSummary>> FindManyAsync(IReadOnlyCollection<int> assetIds, CancellationToken cancellationToken = default);

    /// <summary>The Matter's Assets ordered by display name (a Matter holds a few hundred at most). Inactive ones only when asked.</summary>
    Task<IReadOnlyList<AssetSummary>> ListForMatterAsync(int matterId, bool includeInactive = false, CancellationToken cancellationToken = default);

    /// <summary>
    /// The count of the Matter's active Assets and the first <paramref name="take"/> by display name: two statements whatever the number of Assets. The caller has already
    /// checked that the Matter is visible. The default reads the whole list.
    /// </summary>
    async Task<MatterAssetSnapshot> SnapshotForMatterAsync(int matterId, int take, CancellationToken cancellationToken = default)
    {
        var all = await ListForMatterAsync(matterId, false, cancellationToken);
        return new MatterAssetSnapshot(all.Count, [.. all.Take(take)]);
    }

    /// <summary>Names of the Asset Types that exist (inactive ones too: history keeps their names), keyed by Asset Type id. The default resolves nothing.</summary>
    Task<IReadOnlyDictionary<int, string>> AssetTypeNamesAsync(IReadOnlyCollection<int> assetTypeIds, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyDictionary<int, string>>(new Dictionary<int, string>());
}
