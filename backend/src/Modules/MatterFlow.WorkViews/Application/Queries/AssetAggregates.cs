using MatterFlow.Assets.Domain;
using MatterFlow.Configuration.Contracts.Forms;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>The kinds of group an asset aggregate can have.</summary>
public enum AssetGroupKind
{
    Disposition,
    Matter,
    AssetType,
    Field,
}

/// <summary>
/// Which number to measure. <see cref="FieldKey"/> null means each asset type's own default size field and unit (the types that have none contribute no value); with a key,
/// only assets of <see cref="AssetTypeId"/> are measured, in <see cref="Unit"/>.
/// </summary>
public sealed record AssetMeasureSource(int? AssetTypeId, string? FieldKey, string? Unit)
{
    public static AssetMeasureSource DefaultSize { get; } = new(null, null, null);
}

/// <summary>One group of assets and how many assets it holds.</summary>
public sealed class AssetCountRow
{
    public string Key { get; init; } = string.Empty;

    public int Count { get; init; }
}

/// <summary>The measure of one group in one unit: the sum of the number field and how many assets had a value.</summary>
public sealed class AssetSumRow
{
    public string Key { get; init; } = string.Empty;

    public string Unit { get; init; } = string.Empty;

    public decimal Sum { get; init; }

    public int Valued { get; init; }
}

/// <summary>An asset with the value of the measured number field and its unit (the join of the asset, its type and the typed index).</summary>
public sealed class ValuedAsset
{
    public Asset Asset { get; init; } = null!;

    public string Unit { get; init; } = string.Empty;

    public decimal Value { get; init; }
}

/// <summary>
/// The SQL behind the Data tab and the asset reports (epic #851, issues #869 and #873): counts and sums grouped in the database over the typed index
/// (<c>CustomFieldIndex</c>), never in memory and never through the stored JSON. The caller passes assets that are already scoped to the matters the viewer may see.
/// </summary>
public sealed class AssetAggregates(DbContext db, IFormIndexReader index)
{
    /// <summary>The assets that have a value of the measured number field, with the value and its unit.</summary>
    public IQueryable<ValuedAsset> Valued(IQueryable<Asset> assets, AssetMeasureSource source)
    {
        var numbers = index.Rows(FormValueOwnerKind.Asset).Where(i => i.ValueNumber != null);
        if (source.FieldKey is { } key)
        {
            var unit = source.Unit ?? string.Empty;
            return from a in assets.Where(a => a.AssetTypeId == source.AssetTypeId)
                   join i in numbers.Where(i => i.FieldKey == key) on (long)a.Id equals i.OwnerId
                   select new ValuedAsset { Asset = a, Unit = unit, Value = i.ValueNumber!.Value };
        }

        var types = db.Set<AssetType>().AsNoTracking().Where(t => t.SizeFieldKey != null && t.SizeUnit != null);
        return from a in assets
               join t in types on a.AssetTypeId equals t.Id
               join i in numbers on new { Id = (long)a.Id, Key = t.SizeFieldKey! } equals new { Id = i.OwnerId, Key = i.FieldKey }
               select new ValuedAsset { Asset = a, Unit = t.SizeUnit!, Value = i.ValueNumber!.Value };
    }

    /// <summary>
    /// The assets that have a value of a measured number field, for a plan of the Data Area: the chosen fields of the types that named some, and the default size field of every other
    /// type (one statement; the parts are joined to the typed index by seeks).
    /// </summary>
    public IQueryable<ValuedAsset> Valued(IQueryable<Asset> assets, AssetMeasurePlan plan)
    {
        var numbers = index.Rows(FormValueOwnerKind.Asset).Where(i => i.ValueNumber != null);
        var overridden = plan.OverriddenTypes.ToArray();
        var types = db.Set<AssetType>().AsNoTracking().Where(t => t.SizeFieldKey != null && t.SizeUnit != null);
        if (overridden.Length > 0)
            types = types.Where(t => !overridden.Contains(t.Id));

        var valued = from a in assets
                     join t in types on a.AssetTypeId equals t.Id
                     join i in numbers on new { Id = (long)a.Id, Key = t.SizeFieldKey! } equals new { Id = i.OwnerId, Key = i.FieldKey }
                     select new ValuedAsset { Asset = a, Unit = t.SizeUnit!, Value = i.ValueNumber!.Value };
        foreach (var field in plan.Fields)
        {
            var key = field.FieldKey!;
            var unit = field.Unit ?? string.Empty;
            var typeId = field.AssetTypeId;
            valued = valued.Concat(
                from a in assets.Where(a => a.AssetTypeId == typeId)
                join i in numbers.Where(i => i.FieldKey == key) on (long)a.Id equals i.OwnerId
                select new ValuedAsset { Asset = a, Unit = unit, Value = i.ValueNumber!.Value });
        }

        return valued;
    }

    /// <summary>The assets per group (one statement).</summary>
    public async Task<List<AssetCountRow>> CountsAsync(IQueryable<Asset> assets, AssetGroupKind kind, string? fieldKey, CancellationToken ct)
    {
        switch (kind)
        {
            case AssetGroupKind.Disposition:
                return await assets.GroupBy(a => a.DispositionCode).Select(g => new AssetCountRow { Key = g.Key, Count = g.Count() }).ToListAsync(ct);
            case AssetGroupKind.Matter:
                return await assets.GroupBy(a => a.MatterId.ToString()).Select(g => new AssetCountRow { Key = g.Key, Count = g.Count() }).ToListAsync(ct);
            case AssetGroupKind.AssetType:
                return await assets.GroupBy(a => a.AssetTypeId.ToString()).Select(g => new AssetCountRow { Key = g.Key, Count = g.Count() }).ToListAsync(ct);
            default:
                {
                    var values = index.Rows(FormValueOwnerKind.Asset).Where(i => i.FieldKey == fieldKey);
                    var keyed = from a in assets
                                join i in values on (long)a.Id equals i.OwnerId into joined
                                from i in joined.DefaultIfEmpty()
                                select new { Key = i == null ? null : i.ValueText };
                    var rows = await keyed.GroupBy(k => k.Key).Select(g => new { g.Key, Count = g.Count() }).ToListAsync(ct);
                    return [.. rows.Select(r => new AssetCountRow { Key = r.Key ?? string.Empty, Count = r.Count })];
                }
        }
    }

    /// <summary>The sums of the measured number per group and unit (one statement).</summary>
    public async Task<List<AssetSumRow>> SumsAsync(IQueryable<Asset> assets, AssetGroupKind kind, string? fieldKey, AssetMeasureSource source, CancellationToken ct)
    {
        var valued = Valued(assets, source);
        switch (kind)
        {
            case AssetGroupKind.Disposition:
                return await valued.GroupBy(v => new { Key = v.Asset.DispositionCode, v.Unit }).Select(g => new AssetSumRow { Key = g.Key.Key, Unit = g.Key.Unit, Sum = g.Sum(v => v.Value), Valued = g.Count() }).ToListAsync(ct);
            case AssetGroupKind.Matter:
                return await valued.GroupBy(v => new { Key = v.Asset.MatterId.ToString(), v.Unit }).Select(g => new AssetSumRow { Key = g.Key.Key, Unit = g.Key.Unit, Sum = g.Sum(v => v.Value), Valued = g.Count() }).ToListAsync(ct);
            case AssetGroupKind.AssetType:
                return await valued.GroupBy(v => new { Key = v.Asset.AssetTypeId.ToString(), v.Unit }).Select(g => new AssetSumRow { Key = g.Key.Key, Unit = g.Key.Unit, Sum = g.Sum(v => v.Value), Valued = g.Count() }).ToListAsync(ct);
            default:
                {
                    var values = index.Rows(FormValueOwnerKind.Asset).Where(i => i.FieldKey == fieldKey);
                    var keyed = from v in valued
                                join i in values on (long)v.Asset.Id equals i.OwnerId into joined
                                from i in joined.DefaultIfEmpty()
                                select new { Key = i == null ? null : i.ValueText, v.Unit, v.Value };
                    var rows = await keyed.GroupBy(k => new { k.Key, k.Unit }).Select(g => new { g.Key.Key, g.Key.Unit, Sum = g.Sum(k => k.Value), Valued = g.Count() }).ToListAsync(ct);
                    return [.. rows.Select(r => new AssetSumRow { Key = r.Key ?? string.Empty, Unit = r.Unit, Sum = r.Sum, Valued = r.Valued })];
                }
        }
    }
}

/// <summary>Sizes in one unit: the bytes family is added up after conversion and shown in GB, Items (files, pages, documents) are never mixed with bytes.</summary>
public static class AssetUnits
{
    public const string Bytes = "GB";

    /// <summary>The unit a stored unit is shown in when results of several units are combined: B to TB become GB, Items stay.</summary>
    public static string DisplayUnit(string unit) => AssetSize.IsByteUnit(unit) ? Bytes : unit;

    /// <summary>The value converted to its display unit (GB for the size family).</summary>
    public static decimal ToDisplay(decimal value, string unit) =>
        AssetSize.IsByteUnit(unit) ? decimal.Round(value * AssetSize.BytesFor(unit)!.Value / AssetSize.BytesFor(Bytes)!.Value, 4) : value;
}
