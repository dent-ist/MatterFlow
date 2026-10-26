using System.Globalization;
using MatterFlow.Assets.Application;
using MatterFlow.Assets.Domain;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// Runs an asset report (epic #851, issue #873): Count, Sum or Average of a number field of the assets, grouped by disposition, matter, client, asset type or a SELECT field, as SQL
/// aggregates over the assets of the caller's visible matters and the typed index (never the stored JSON, never in memory). A saved report is only a definition; every run uses the
/// viewer's current visibility and the form as it is today. Limits: 200 groups ("N more hidden") and 10 seconds.
/// </summary>
public sealed class AssetReportRunService(
    DbContext db,
    AssetScopeResolver scopes,
    AssetAggregates aggregates,
    AssetReportService reports,
    IFormFieldCatalog fieldCatalog)
{
    public const int MaxGroups = 200;
    public const int TimeoutSeconds = 10;
    public const string TimeoutCode = "REPORT_TIMEOUT";

    private static readonly string[] DispositionOrder = [AssetDisposition.Active, AssetDisposition.Inactive, AssetDisposition.PendingDisposition, AssetDisposition.Disposed];

    /// <summary>Runs an unsaved definition.</summary>
    public async Task<Result<AssetReportResult>> RunAsync(AssetReportDefinition definition, CancellationToken ct)
    {
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(ct);
        limit.CancelAfter(TimeSpan.FromSeconds(TimeoutSeconds));
        try
        {
            return await RunCoreAsync(definition, limit.Token);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return Error.Conflict(TimeoutCode, $"The report took longer than {TimeoutSeconds} seconds. Narrow it to one asset type or fewer matters.");
        }
    }

    /// <summary>Runs one of the caller's saved reports (another person's id is a 404).</summary>
    public async Task<Result<AssetReportResult>> RunSavedAsync(int reportId, CancellationToken ct)
    {
        var report = await reports.FindOwnAsync(reportId, tracked: false, ct);
        if (report is null)
            return Error.NotFound("Asset report not found.");

        return AssetReportService.Parse(report.DefinitionJson) is { } definition
            ? await RunAsync(definition, ct)
            : Error.Validation("definition", AssetReportService.UnsupportedVersionCode, "This report was saved by a newer version and cannot be run here.");
    }

    private async Task<Result<AssetReportResult>> RunCoreAsync(AssetReportDefinition input, CancellationToken ct)
    {
        var normalised = await reports.NormaliseAsync(input, ct);
        if (normalised.IsFailure)
            return normalised.Error!;

        var definition = normalised.Value;
        var resolved = scopes.Resolve(definition.Scope, null, definition.MatterIds);
        if (resolved.IsFailure)
            return resolved.Error!;

        var assets = resolved.Value.Assets();
        if (definition.AssetTypeId is { } typeId)
            assets = assets.Where(a => a.AssetTypeId == typeId);
        if (definition.Dispositions is { Length: > 0 } dispositions)
            assets = assets.Where(a => dispositions.Contains(a.DispositionCode));

        AssetType? type = definition.AssetTypeId is { } id ? await db.Set<AssetType>().AsNoTracking().SingleAsync(t => t.Id == id, ct) : null;
        IReadOnlyList<FormFieldInfo> published = type is null ? [] : await fieldCatalog.GetPublishedFieldsAsync(FormOwnerKind.AssetType, type.Id, ct);

        // The group-by: client is matter-level data rolled up in memory (one row per matter, at most a few thousand), the others are grouped in the database.
        var groupBy = definition.GroupBy;
        var sqlKind = groupBy switch
        {
            AssetReportGroupBy.Disposition => AssetGroupKind.Disposition,
            AssetReportGroupBy.Matter or AssetReportGroupBy.Client => AssetGroupKind.Matter,
            AssetReportGroupBy.AssetType => AssetGroupKind.AssetType,
            _ => AssetGroupKind.Field,
        };
        var fieldKey = sqlKind == AssetGroupKind.Field ? groupBy[AssetReportGroupBy.FieldPrefix.Length..] : null;

        var counts = await aggregates.CountsAsync(assets, sqlKind, fieldKey, ct);
        var measure = definition.Measure;
        var sums = new List<AssetSumRow>();
        var numberLabel = "Size";
        if (measure != AssetReportMeasures.Count)
        {
            AssetMeasureSource source;
            if (type is not null && definition.NumberField is { } numberField)
            {
                var unit = numberField == type.SizeFieldKey ? type.SizeUnit : definition.NumberUnit;
                source = new AssetMeasureSource(type.Id, numberField, unit);
                numberLabel = published.FirstOrDefault(f => f.Key == numberField)?.Label ?? numberField;
            }
            else if (type is not null)
            {
                source = new AssetMeasureSource(type.Id, type.SizeFieldKey, type.SizeUnit);
                numberLabel = published.FirstOrDefault(f => f.Key == type.SizeFieldKey)?.Label ?? "Size";
            }
            else
            {
                source = AssetMeasureSource.DefaultSize;
            }

            sums = await aggregates.SumsAsync(assets, sqlKind, fieldKey, source, ct);
        }

        // Matter and client labels (and the client roll-up) need the matters of the groups.
        Dictionary<int, (string Ref, string Name, int ClientId, string ClientName)> matters = [];
        if (sqlKind == AssetGroupKind.Matter)
        {
            var ids = counts.Select(c => int.Parse(c.Key, CultureInfo.InvariantCulture)).Distinct().ToList();
            var found = await (from m in db.Set<Matter>().AsNoTracking().Where(m => ids.Contains(m.Id))
                               join c in db.Set<Client>().AsNoTracking() on m.ClientId equals c.Id
                               select new { m.Id, m.MatterRef, m.Name, m.ClientId, ClientName = c.Name }).ToListAsync(ct);
            matters = found.ToDictionary(r => r.Id, r => (r.MatterRef, r.Name, r.ClientId, r.ClientName));
        }

        if (groupBy == AssetReportGroupBy.Client)
        {
            string ClientOf(string matterKey) => matters.TryGetValue(int.Parse(matterKey, CultureInfo.InvariantCulture), out var m) ? m.ClientId.ToString(CultureInfo.InvariantCulture) : "0";
            counts = [.. counts.GroupBy(c => ClientOf(c.Key)).Select(g => new AssetCountRow { Key = g.Key, Count = g.Sum(c => c.Count) })];
            sums = [.. sums.GroupBy(s => (Key: ClientOf(s.Key), s.Unit)).Select(g => new AssetSumRow { Key = g.Key.Key, Unit = g.Key.Unit, Sum = g.Sum(s => s.Sum), Valued = g.Sum(s => s.Valued) })];
        }

        var labels = await LabelsAsync(groupBy, counts.Select(c => c.Key).ToList(), matters, published, fieldKey, ct);

        // Units: one unit stays as it is; several are shown per unit with the size family converted to GB.
        var units = sums.Select(s => s.Unit).Distinct().Order(StringComparer.Ordinal).ToList();
        var mixed = units.Count > 1;
        string DisplayUnit(string unit) => mixed ? AssetUnits.DisplayUnit(unit) : unit;
        decimal Display(decimal value, string unit) => mixed ? AssetUnits.ToDisplay(value, unit) : value;
        var displayUnits = units.Select(DisplayUnit).Distinct().ToList();

        string? unitsWarning = null;
        if (mixed)
        {
            var typeNames = await db.Set<AssetType>().AsNoTracking().ToDictionaryAsync(t => t.Id, t => t.Name, ct);
            var typeUnits = await db.Set<AssetType>().AsNoTracking().Where(t => t.SizeUnit != null).Select(t => new { t.Id, t.SizeUnit }).ToListAsync(ct);
            var parts = units.Select(u => $"{u} ({string.Join(", ", typeUnits.Where(t => t.SizeUnit == u).Select(t => typeNames[t.Id]).Order(StringComparer.OrdinalIgnoreCase))})");
            unitsWarning = $"This result mixes units: {string.Join(" and ", parts)}. Totals are shown per unit.";
            if (units.Count(AssetSize.IsByteUnit) > 1)
                unitsWarning += " Sizes in B, KB, MB, GB and TB are added up and shown in GB.";
        }

        var verb = measure == AssetReportMeasures.Sum ? "Sum of" : "Average";
        List<AssetReportColumn> columns = [new("count", "Assets", null)];
        if (measure != AssetReportMeasures.Count)
            columns.AddRange(displayUnits.Select(u => new AssetReportColumn($"{measure}:{u}", $"{verb} {numberLabel} ({u})", u)));

        AssetReportRow MakeRow(string key, string label, int count, IEnumerable<AssetSumRow> own)
        {
            var cells = new List<decimal?> { count };
            foreach (var unit in displayUnits)
            {
                var inUnit = own.Where(s => DisplayUnit(s.Unit) == unit).ToList();
                if (measure == AssetReportMeasures.Count || inUnit.Count == 0)
                {
                    cells.Add(null);
                    continue;
                }

                var sum = inUnit.Sum(s => Display(s.Sum, s.Unit));
                var valued = inUnit.Sum(s => s.Valued);
                cells.Add(measure == AssetReportMeasures.Sum ? sum : valued == 0 ? null : decimal.Round(sum / valued, 4));
            }

            // Count measure: the cells beyond the first column do not exist.
            return new AssetReportRow(key, label, measure == AssetReportMeasures.Count ? [count] : cells);
        }

        var sumsByKey = sums.ToLookup(s => s.Key);
        var rows = counts
            .Select(c => MakeRow(c.Key, labels.GetValueOrDefault(c.Key, c.Key), c.Count, sumsByKey[c.Key]))
            .ToList();
        // A group with only values but no asset row cannot exist (the count query sees every asset), so no group is lost.
        rows = groupBy == AssetReportGroupBy.Disposition
            ? [.. rows.OrderBy(r => DispositionRank(r.Key))]
            : [.. rows.OrderByDescending(r => r.Cells[measure == AssetReportMeasures.Count ? 0 : 1] ?? decimal.MinValue).ThenBy(r => r.Label, StringComparer.OrdinalIgnoreCase)];
        var hidden = Math.Max(0, rows.Count - MaxGroups);
        if (hidden > 0)
            rows = rows.Take(MaxGroups).ToList();

        var totals = MakeRow(string.Empty, "Total", counts.Sum(c => c.Count), sums);
        return new AssetReportResult(
            measure,
            groupBy,
            GroupByLabel(groupBy, published),
            type?.Id,
            type?.Name,
            columns.Take(measure == AssetReportMeasures.Count ? 1 : columns.Count).ToList(),
            rows,
            totals,
            hidden,
            unitsWarning,
            counts.Sum(c => c.Count));
    }

    private static int DispositionRank(string code)
    {
        var index = Array.IndexOf(DispositionOrder, code);
        return index < 0 ? int.MaxValue : index;
    }

    private static string GroupByLabel(string groupBy, IReadOnlyList<FormFieldInfo> published) =>
        groupBy.StartsWith(AssetReportGroupBy.FieldPrefix, StringComparison.Ordinal)
            ? published.FirstOrDefault(f => f.Key == groupBy[AssetReportGroupBy.FieldPrefix.Length..])?.Label ?? groupBy
            : AssetReportGroupBy.Label(groupBy);

    private async Task<Dictionary<string, string>> LabelsAsync(
        string groupBy,
        IReadOnlyList<string> keys,
        Dictionary<int, (string Ref, string Name, int ClientId, string ClientName)> matters,
        IReadOnlyList<FormFieldInfo> published,
        string? fieldKey,
        CancellationToken ct)
    {
        var labels = new Dictionary<string, string>();
        switch (groupBy)
        {
            case AssetReportGroupBy.Disposition:
                foreach (var key in keys)
                    labels[key] = DispositionLabel(key);
                break;
            case AssetReportGroupBy.Matter:
                foreach (var key in keys)
                {
                    labels[key] = matters.TryGetValue(int.Parse(key, CultureInfo.InvariantCulture), out var m) ? $"{m.Ref} {m.Name}" : key;
                }

                break;
            case AssetReportGroupBy.Client:
                foreach (var m in matters.Values)
                    labels[m.ClientId.ToString(CultureInfo.InvariantCulture)] = m.ClientName;
                break;
            case AssetReportGroupBy.AssetType:
                {
                    var ids = keys.Select(k => int.Parse(k, CultureInfo.InvariantCulture)).ToList();
                    var names = await db.Set<AssetType>().AsNoTracking().Where(t => ids.Contains(t.Id)).Select(t => new { t.Id, t.Name }).ToListAsync(ct);
                    foreach (var n in names)
                        labels[n.Id.ToString(CultureInfo.InvariantCulture)] = n.Name;
                    break;
                }

            default:
                {
                    var options = published.FirstOrDefault(f => f.Key == fieldKey)?.Options ?? [];
                    foreach (var key in keys)
                        labels[key] = key.Length == 0 ? "(none)" : options.FirstOrDefault(o => o.Key == key)?.Label ?? key;
                    break;
                }
        }

        return labels;
    }

    /// <summary>The display text of a disposition code.</summary>
    public static string DispositionLabel(string code) => code switch
    {
        AssetDisposition.Active => "Active",
        AssetDisposition.Inactive => "Inactive",
        AssetDisposition.PendingDisposition => "Pending disposition",
        AssetDisposition.Disposed => "Disposed",
        _ => code,
    };
}
