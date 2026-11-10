using MatterFlow.Assets.Contracts;
using MatterFlow.Assets.Domain;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>The assets narrowed to one asset type (when the call named one) and the number field to measure on them.</summary>
public sealed record AssetMeasure(IQueryable<Asset> Assets, AssetMeasureSource Source);

/// <summary>
/// Turns the optional <c>assetTypeId</c>, <c>sizeField</c> and <c>sizeUnit</c> of the Data tab and its volume chart (epic #851, issues #869 and #871) into the assets to count and the
/// number field to measure: the type's own default size field, or another published number field chosen by the view (never stored).
/// </summary>
public sealed class AssetMeasureResolver(DbContext db, IFormFieldCatalog fieldCatalog)
{
    public async Task<Result<AssetMeasure>> ResolveAsync(IQueryable<Asset> assets, int? assetTypeId, string? sizeField, string? sizeUnit, CancellationToken ct)
    {
        var source = AssetMeasureSource.DefaultSize;
        if (assetTypeId is { } typeId)
        {
            var type = await db.Set<AssetType>().AsNoTracking().Where(t => t.Id == typeId).Select(t => new { t.SizeFieldKey, t.SizeUnit }).SingleOrDefaultAsync(ct);
            if (type is null)
                return Error.Validation("assetTypeId", "NOT_FOUND", "The asset type does not exist.");

            assets = assets.Where(a => a.AssetTypeId == typeId);
            if (AssetSupportText.Clean(sizeField) is { } key)
            {
                var published = await fieldCatalog.GetPublishedFieldsAsync(FormOwnerKind.AssetType, typeId, ct);
                if (!published.Any(f => f.IsNumber && f.Key == key))
                    return Error.Validation("sizeField", "INVALID", "The size field must be a number field of the published form of this asset type.");

                var unit = key == type.SizeFieldKey ? type.SizeUnit : AssetSupportText.Clean(sizeUnit);
                if (!AssetSize.IsKnownUnit(unit))
                    return Error.Validation("sizeUnit", "REQUIRED", $"Choose the unit of this field: {string.Join(", ", AssetSize.Units)}.");

                source = new AssetMeasureSource(typeId, key, unit);
            }
            else if (type.SizeFieldKey is { } defaultKey && type.SizeUnit is { } defaultUnit)
            {
                source = new AssetMeasureSource(typeId, defaultKey, defaultUnit);
            }
            else
            {
                source = new AssetMeasureSource(typeId, null, null);
            }
        }
        else if (!string.IsNullOrWhiteSpace(sizeField) || !string.IsNullOrWhiteSpace(sizeUnit))
        {
            return Error.Validation("assetTypeId", "REQUIRED", "Choose an asset type to measure another size field.");
        }

        return new AssetMeasure(assets, source);
    }
}
