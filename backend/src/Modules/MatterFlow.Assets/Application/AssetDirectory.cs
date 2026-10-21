using MatterFlow.Assets.Contracts;
using MatterFlow.Assets.Domain;
using MatterFlow.Organization.Contracts;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Assets.Application;

/// <summary>Implements the read-only lookups other modules use (<see cref="IAssetDirectory"/>).</summary>
internal sealed class AssetDirectory(DbContext db) : IAssetDirectory
{
    public async Task<AssetSummary?> FindAsync(int assetId, CancellationToken cancellationToken = default)
    {
        var rows = await Rows().Where(r => r.Asset.Id == assetId).Take(1).ToListAsync(cancellationToken);
        return rows.Select(ToSummary).FirstOrDefault();
    }

    public async Task<IReadOnlyList<AssetSummary>> FindManyAsync(IReadOnlyCollection<int> assetIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(assetIds);
        if (assetIds.Count == 0)
            return [];

        var ids = assetIds.Distinct().ToList();
        var rows = await Rows().Where(r => ids.Contains(r.Asset.Id)).ToListAsync(cancellationToken);
        return [.. rows.Select(ToSummary)];
    }

    public async Task<IReadOnlyList<AssetSummary>> ListForMatterAsync(int matterId, bool includeInactive = false, CancellationToken cancellationToken = default)
    {
        var rows = await Rows()
            .Where(r => r.Asset.MatterId == matterId && (includeInactive || r.Asset.IsActive))
            .OrderBy(r => r.Asset.DisplayName)
            .ThenBy(r => r.Asset.Id)
            .ToListAsync(cancellationToken);
        return [.. rows.Select(ToSummary)];
    }

    public async Task<IReadOnlyDictionary<int, string>> AssetTypeNamesAsync(IReadOnlyCollection<int> assetTypeIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(assetTypeIds);
        if (assetTypeIds.Count == 0)
            return new Dictionary<int, string>();

        var ids = assetTypeIds.Distinct().ToList();
        return await db.Set<AssetType>().AsNoTracking()
            .Where(t => ids.Contains(t.Id))
            .ToDictionaryAsync(t => t.Id, t => t.Name, cancellationToken);
    }

    private IQueryable<AssetService.AssetRow> Rows() =>
        from a in db.Set<Asset>().AsNoTracking()
        join t in db.Set<AssetType>().AsNoTracking() on a.AssetTypeId equals t.Id
        select new AssetService.AssetRow { Asset = a, AssetTypeName = t.Name, AssetTypeIsActive = t.IsActive };

    private static AssetSummary ToSummary(AssetService.AssetRow r) =>
        new(r.Asset.Id, r.Asset.MatterId, r.Asset.AssetTypeId, r.AssetTypeName, r.Asset.DisplayName, r.Asset.ExternalReference, r.Asset.IsActive);
}

/// <summary>Counts a Matter's Assets for the Matter summary (<see cref="IMatterAssetCounts"/>); retired Assets are counted too.</summary>
internal sealed class MatterAssetCounts(DbContext db) : IMatterAssetCounts
{
    public Task<int> CountAsync(int matterId, CancellationToken cancellationToken = default) =>
        db.Set<Asset>().AsNoTracking().CountAsync(a => a.MatterId == matterId, cancellationToken);
}
