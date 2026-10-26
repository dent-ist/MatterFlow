using System.Globalization;
using MatterFlow.Assets.Contracts;
using MatterFlow.Assets.Domain;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// The Data tab of My Matters (epic #851, issue #869): assets and their size per matter and per asset type, counted by disposition, with the two warnings (not Active but still
/// linked to open tasks; awaiting disposition). Every number is a SQL aggregate over the scope's assets and the typed index; the scope is the matters the caller manages (or, with
/// <c>Matter.AssignManagers</c>, all matters the caller may see), closed matters included, and the sensitive-matter rule applies through the scope. The queries it hands out
/// (<see cref="AssetDataMatterRow.Query"/> and the warnings') list exactly the assets that were counted.
/// </summary>
public sealed class AssetDataService(
    DbContext db,
    AssetScopeResolver scopes,
    AssetAggregates aggregates,
    IFormFieldCatalog fieldCatalog,
    IEnumerable<IAssetTaskLinkReader> links,
    IClock clock)
{
    public async Task<Result<AssetDataResponse>> GetAsync(AssetDataQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        var resolved = scopes.Resolve(query.Scope, query.Role);
        if (resolved.IsFailure)
            return resolved.Error!;

        var scope = resolved.Value;
        var assets = scope.Assets();
        var source = AssetMeasureSource.DefaultSize;
        if (query.AssetTypeId is { } typeId)
        {
            var type = await db.Set<AssetType>().AsNoTracking().Where(t => t.Id == typeId).Select(t => new { t.SizeFieldKey, t.SizeUnit }).SingleOrDefaultAsync(ct);
            if (type is null)
                return Error.Validation("assetTypeId", "NOT_FOUND", "The asset type does not exist.");

            assets = assets.Where(a => a.AssetTypeId == typeId);
            if (AssetSupportText.Clean(query.SizeField) is { } key)
            {
                var published = await fieldCatalog.GetPublishedFieldsAsync(FormOwnerKind.AssetType, typeId, ct);
                if (!published.Any(f => f.IsNumber && f.Key == key))
                    return Error.Validation("sizeField", "INVALID", "The size field must be a number field of the published form of this asset type.");

                var unit = key == type.SizeFieldKey ? type.SizeUnit : AssetSupportText.Clean(query.SizeUnit);
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
        else if (!string.IsNullOrWhiteSpace(query.SizeField) || !string.IsNullOrWhiteSpace(query.SizeUnit))
        {
            return Error.Validation("assetTypeId", "REQUIRED", "Choose an asset type to measure another size field.");
        }

        // A type that has no size field contributes assets but no size (the join finds nothing).
        var measured = source.FieldKey is null && source.AssetTypeId is not null ? new AssetMeasureSource(source.AssetTypeId, "\u0001none", string.Empty) : source;

        var byMatter = await assets.GroupBy(a => new { a.MatterId, a.DispositionCode }).Select(g => new { g.Key.MatterId, g.Key.DispositionCode, Count = g.Count() }).ToListAsync(ct);
        var byType = await assets.GroupBy(a => new { a.AssetTypeId, a.DispositionCode }).Select(g => new { g.Key.AssetTypeId, g.Key.DispositionCode, Count = g.Count() }).ToListAsync(ct);
        var valued = aggregates.Valued(assets, measured);
        var sizeByMatter = await valued.GroupBy(v => new { v.Asset.MatterId, v.Unit }).Select(g => new { g.Key.MatterId, g.Key.Unit, Sum = g.Sum(v => v.Value), Valued = g.Count() }).ToListAsync(ct);
        var sizeByType = await valued.GroupBy(v => new { v.Asset.AssetTypeId, v.Unit }).Select(g => new { g.Key.AssetTypeId, g.Key.Unit, Sum = g.Sum(v => v.Value), Valued = g.Count() }).ToListAsync(ct);

        var matters = await (from m in db.Set<Matter>().AsNoTracking()
                             where assets.Select(a => a.MatterId).Contains(m.Id)
                             join c in db.Set<Client>().AsNoTracking() on m.ClientId equals c.Id
                             select new { m.Id, m.MatterRef, m.Name, ClientName = c.Name, m.IsActive }).ToListAsync(ct);
        var typeIds = byType.Select(r => r.AssetTypeId).Distinct().ToList();
        var types = await db.Set<AssetType>().AsNoTracking().Where(t => typeIds.Contains(t.Id)).Select(t => new { t.Id, t.Name, t.SizeFieldKey, t.SizeUnit }).ToListAsync(ct);

        // One decision for the whole response: a single unit stays as it is, several units are shown per unit with the size family in GB.
        var units = sizeByType.Select(r => r.Unit).Distinct().ToList();
        var mixed = units.Count > 1;
        string? unitsWarning = null;
        if (mixed)
        {
            var typeNames = types.ToDictionary(t => t.Id, t => t.Name);
            var parts = units.Order(StringComparer.Ordinal).Select(u =>
                $"{u} ({string.Join(", ", sizeByType.Where(r => r.Unit == u).Select(r => typeNames.GetValueOrDefault(r.AssetTypeId, "?")).Distinct().Order(StringComparer.OrdinalIgnoreCase))})");
            unitsWarning = $"This result mixes units: {string.Join(" and ", parts)}. Totals are shown per unit.";
            if (units.Count(AssetSize.IsByteUnit) > 1)
                unitsWarning += " Sizes in B, KB, MB, GB and TB are added up and shown in GB.";
        }

        IReadOnlyList<AssetUnitValue> Size(IEnumerable<(string Unit, decimal Sum, int Valued)> rows) =>
        [
            .. rows.GroupBy(r => mixed ? AssetUnits.DisplayUnit(r.Unit) : r.Unit)
                .OrderBy(g => g.Key, StringComparer.Ordinal)
                .Select(g => new AssetUnitValue(g.Key, g.Sum(r => mixed ? AssetUnits.ToDisplay(r.Sum, r.Unit) : r.Sum), g.Sum(r => r.Valued))),
        ];

        static int Of(IEnumerable<(string Code, int Count)> rows, string code) => rows.Where(r => r.Code == code).Sum(r => r.Count);

        AssetDataCounts Counts(IReadOnlyList<(string Code, int Count)> dispositions, IEnumerable<(string Unit, decimal Sum, int Valued)> sizes) =>
            new(
                dispositions.Sum(r => r.Count),
                Of(dispositions, AssetDisposition.Active),
                Of(dispositions, AssetDisposition.Inactive),
                Of(dispositions, AssetDisposition.PendingDisposition),
                Of(dispositions, AssetDisposition.Disposed),
                Size(sizes));

        var matterRows = matters
            .OrderBy(m => m.MatterRef, StringComparer.Ordinal)
            .Select(m => new AssetDataMatterRow(
                m.Id,
                m.MatterRef,
                m.Name,
                m.ClientName,
                m.IsActive,
                Counts(
                    [.. byMatter.Where(r => r.MatterId == m.Id).Select(r => (r.DispositionCode, r.Count))],
                    sizeByMatter.Where(r => r.MatterId == m.Id).Select(r => (r.Unit, r.Sum, r.Valued))),
                "matterId=" + m.Id.ToString(CultureInfo.InvariantCulture)))
            .ToList();

        var typeRows = types
            .OrderBy(t => t.Name, StringComparer.OrdinalIgnoreCase)
            .Select(t => new AssetDataTypeRow(
                t.Id,
                t.Name,
                Counts(
                    [.. byType.Where(r => r.AssetTypeId == t.Id).Select(r => (r.DispositionCode, r.Count))],
                    sizeByType.Where(r => r.AssetTypeId == t.Id).Select(r => (r.Unit, r.Sum, r.Valued))),
                source.AssetTypeId == t.Id && source.FieldKey is not null ? source.FieldKey : t.SizeFieldKey,
                source.AssetTypeId == t.Id && source.FieldKey is not null ? source.Unit : t.SizeUnit,
                scope.AssetsQuery("assetTypeId=" + t.Id.ToString(CultureInfo.InvariantCulture))))
            .ToList();

        var totals = Counts(
            [.. byMatter.GroupBy(r => r.DispositionCode).Select(g => (g.Key, g.Sum(r => r.Count)))],
            sizeByMatter.Select(r => (r.Unit, r.Sum, r.Valued)));

        var warnings = await WarningsAsync(assets, scope, ct);
        return new AssetDataResponse(totals, matterRows, typeRows, warnings, unitsWarning, scope.AssetsQuery());
    }

    private async Task<AssetDataWarnings> WarningsAsync(IQueryable<Asset> assets, AssetScope scope, CancellationToken ct)
    {
        var inactiveLinked = 0;
        if (links.FirstOrDefault() is { } reader)
        {
            var grouped = reader.Grouped();
            inactiveLinked = await assets.CountAsync(a => a.DispositionCode != AssetDisposition.Active && grouped.Any(g => g.AssetId == a.Id && g.Open > 0), ct);
        }

        var awaiting = await assets.Where(a => a.DispositionCode == AssetDisposition.PendingDisposition)
            .GroupBy(_ => 1)
            .Select(g => new { Count = g.Count(), Oldest = g.Min(a => a.DispositionChangedAtUtc ?? a.CreatedAtUtc) })
            .SingleOrDefaultAsync(ct);
        int? oldestDays = awaiting is null ? null : Math.Max(0, (int)(clock.UtcNow - awaiting.Oldest).TotalDays);
        return new AssetDataWarnings(
            new AssetDataWarning(inactiveLinked, null, scope.AssetsQuery("inactiveLinked=true")),
            new AssetDataWarning(awaiting?.Count ?? 0, oldestDays, scope.AssetsQuery("disposition=PENDING_DISPOSITION")));
    }
}

internal static class AssetSupportText
{
    public static string? Clean(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();
}
