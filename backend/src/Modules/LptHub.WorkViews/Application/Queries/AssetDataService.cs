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
    AssetSelectionResolver selections,
    AssetAggregates aggregates,
    IFormFieldCatalog fieldCatalog,
    IEnumerable<IAssetTaskLinkReader> links,
    IClock clock)
{
    public async Task<Result<AssetDataResponse>> GetAsync(AssetDataQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        var resolved = await selections.ResolveAsync(query.Scope, query.Role, query.MatterIds, query.AssetTypeIds, query.SizeFields, query.From, query.To, ct);
        if (resolved.IsFailure)
            return resolved.Error!;

        var selection = resolved.Value;
        var scope = selection.Scope;
        var assets = selection.Assets;

        // Two statements over the selected assets, not four: one grouped by matter, type and disposition and one grouped by matter, type, disposition and unit; the per matter and per type
        // figures are sums of those cells (at most matters x types x four states rows). Every aggregate reads the assets of the selection once (PV-36: measured at 100,000 assets).
        var cells = await assets.GroupBy(a => new { a.MatterId, a.AssetTypeId, a.DispositionCode })
            .Select(g => new { g.Key.MatterId, g.Key.AssetTypeId, g.Key.DispositionCode, Count = g.Count() }).ToListAsync(ct);
        var byMatter = cells.GroupBy(c => (c.MatterId, c.DispositionCode)).Select(g => new { g.Key.MatterId, g.Key.DispositionCode, Count = g.Sum(c => c.Count) }).ToList();
        var byType = cells.GroupBy(c => (c.AssetTypeId, c.DispositionCode)).Select(g => new { g.Key.AssetTypeId, g.Key.DispositionCode, Count = g.Sum(c => c.Count) }).ToList();
        var valued = aggregates.Valued(assets, selection.Plan);
        var sizeCells = await valued.GroupBy(v => new { v.Asset.MatterId, v.Asset.AssetTypeId, v.Asset.DispositionCode, v.Unit })
            .Select(g => new { g.Key.MatterId, g.Key.AssetTypeId, g.Key.DispositionCode, g.Key.Unit, Sum = g.Sum(v => v.Value), Valued = g.Count() }).ToListAsync(ct);
        var sizeByMatter = sizeCells.GroupBy(c => (c.MatterId, c.Unit)).Select(g => new { g.Key.MatterId, g.Key.Unit, Sum = g.Sum(c => c.Sum), Valued = g.Sum(c => c.Valued) }).ToList();
        var sizeByType = sizeCells.GroupBy(c => (c.AssetTypeId, c.Unit)).Select(g => new { g.Key.AssetTypeId, g.Key.Unit, Sum = g.Sum(c => c.Sum), Valued = g.Sum(c => c.Valued) }).ToList();
        var sizeByTypeStatus = sizeCells.GroupBy(c => (c.AssetTypeId, c.DispositionCode, c.Unit)).Select(g => new { g.Key.AssetTypeId, g.Key.DispositionCode, g.Key.Unit, Sum = g.Sum(c => c.Sum), Valued = g.Sum(c => c.Valued) }).ToList();

        var matterIds = cells.Select(c => c.MatterId).Distinct().ToList();
        var matters = await (from m in db.Set<Matter>().AsNoTracking()
                             where matterIds.Contains(m.Id)
                             join c in db.Set<Client>().AsNoTracking() on m.ClientId equals c.Id
                             select new { m.Id, m.MatterRef, m.Name, ClientName = c.Name, m.IsActive }).ToListAsync(ct);

        // The matters that were asked for and that the caller may see: the scope's own matter list (already limited to what the caller may see) narrowed to the ids asked for.
        var selected = new List<AssetDataSelectedMatter>();
        if (selection.MatterIds.Count > 0)
        {
            var asked = selection.MatterIds.ToArray();
            selected = [.. (await scope.Matters.Where(m => asked.Contains(m.Id)).Select(m => new { m.Id, m.MatterRef, m.Name }).ToListAsync(ct))
                .OrderBy(m => m.MatterRef, StringComparer.Ordinal).Select(m => new AssetDataSelectedMatter(m.Id, m.MatterRef, m.Name))];
        }

        var typeIds = byType.Select(r => r.AssetTypeId).Distinct().ToList();
        var types = await db.Set<AssetType>().AsNoTracking().Where(t => typeIds.Contains(t.Id)).Select(t => new { t.Id, t.Name, t.SizeFieldKey, t.SizeUnit }).ToListAsync(ct);
        var published = types.Count == 0
            ? new Dictionary<int, IReadOnlyList<FormFieldInfo>>()
            : new Dictionary<int, IReadOnlyList<FormFieldInfo>>(await fieldCatalog.GetPublishedFieldsAsync(FormOwnerKind.AssetType, [.. typeIds], ct));

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
            .Select(t =>
            {
                var fields = published.GetValueOrDefault(t.Id) ?? [];
                string LabelOf(string key) => fields.FirstOrDefault(f => f.Key == key)?.Label ?? Humanize(key);
                var chosen = selection.Plan.Fields.Where(f => f.AssetTypeId == t.Id).ToList();
                IReadOnlyList<AssetDataMeasure> measures = chosen.Count > 0
                    ? [.. chosen.Select(f => new AssetDataMeasure(f.FieldKey!, LabelOf(f.FieldKey!), f.Unit!))]
                    : t.SizeFieldKey is { } key && t.SizeUnit is { } unit ? [new AssetDataMeasure(key, LabelOf(key), unit)] : [];
                IReadOnlyList<AssetDataNumberField> numberFields =
                [
                    .. fields.Where(f => f.IsNumber).Select(f => new AssetDataNumberField(f.Key, f.Label, f.Key == t.SizeFieldKey, f.Key == t.SizeFieldKey ? t.SizeUnit : null)),
                ];
                IReadOnlyList<AssetDispositionSize> dispositionSizes =
                [
                    .. sizeByTypeStatus.Where(r => r.AssetTypeId == t.Id).GroupBy(r => r.DispositionCode)
                        .OrderBy(g => g.Key, StringComparer.Ordinal)
                        .Select(g => new AssetDispositionSize(g.Key, Size(g.Select(r => (r.Unit, r.Sum, r.Valued))))),
                ];
                return new AssetDataTypeRow(
                    t.Id,
                    t.Name,
                    Counts(
                        [.. byType.Where(r => r.AssetTypeId == t.Id).Select(r => (r.DispositionCode, r.Count))],
                        sizeByType.Where(r => r.AssetTypeId == t.Id).Select(r => (r.Unit, r.Sum, r.Valued))),
                    scope.AssetsQuery("assetTypeId=" + t.Id.ToString(CultureInfo.InvariantCulture)),
                    measures,
                    numberFields,
                    dispositionSizes);
            })
            .ToList();

        var totals = Counts(
            [.. byMatter.GroupBy(r => r.DispositionCode).Select(g => (g.Key, g.Sum(r => r.Count)))],
            sizeByMatter.Select(r => (r.Unit, r.Sum, r.Valued)));

        var warnings = await WarningsAsync(assets, scope, ct);
        return new AssetDataResponse(totals, matterRows, typeRows, warnings, unitsWarning, scope.AssetsQuery(), selected);
    }

    /// <summary>A field key as words when its label is not known: <c>volume_gb</c> becomes <c>Volume gb</c>.</summary>
    private static string Humanize(string key)
    {
        var words = key.Replace('_', ' ').Replace('-', ' ').Trim();
        return words.Length == 0 ? key : char.ToUpperInvariant(words[0]) + words[1..];
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
