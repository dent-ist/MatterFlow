using System.Globalization;
using MatterFlow.Assets.Domain;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// Data volume over time (epic #851, issue #871): the cumulative size of the scope's assets by the month they were created, with disposed assets leaving at the month their
/// disposition changed. Derived from the assets and the typed index with four SQL aggregates; there is no snapshot table, and the response says so. The scope is that of the Data tab
/// (<see cref="AssetSelectionResolver"/>), so the sensitive-matter rule and the manager scope apply, and the last month's held size plus the disposed size equals the Data tab's total.
/// </summary>
public sealed class AssetVolumeService(AssetSelectionResolver selections, AssetAggregates aggregates, IClock clock)
{
    public const int DefaultMonths = 24;

    public const string LimitationText =
        "Derived from the month each asset was created, using its current size; sizes edited later change the past. Disposed assets leave in the month their disposition changed. No history is recorded.";

    public async Task<Result<AssetVolumeResponse>> GetAsync(AssetVolumeQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        var selection = await selections.ResolveAsync(query.Scope, query.Role, query.MatterIds, query.AssetTypeIds, query.SizeFields, query.From, query.To, ct);
        if (selection.IsFailure)
            return selection.Error!;

        var assets = selection.Value.Assets;
        var valued = aggregates.Valued(assets, selection.Value.Plan);
        var disposed = AssetDisposition.Disposed;

        var createdCounts = await assets.GroupBy(a => new { a.CreatedAtUtc.Year, a.CreatedAtUtc.Month }).Select(g => new { g.Key.Year, g.Key.Month, Count = g.Count() }).ToListAsync(ct);
        var disposedCounts = await assets.Where(a => a.DispositionCode == disposed)
            .GroupBy(a => new { (a.DispositionChangedAtUtc ?? a.CreatedAtUtc).Year, (a.DispositionChangedAtUtc ?? a.CreatedAtUtc).Month })
            .Select(g => new { g.Key.Year, g.Key.Month, Count = g.Count() })
            .ToListAsync(ct);
        var createdSizes = await valued.GroupBy(v => new { v.Asset.CreatedAtUtc.Year, v.Asset.CreatedAtUtc.Month, v.Unit })
            .Select(g => new { g.Key.Year, g.Key.Month, g.Key.Unit, Sum = g.Sum(v => v.Value), Valued = g.Count() })
            .ToListAsync(ct);
        var disposedSizes = await valued.Where(v => v.Asset.DispositionCode == disposed)
            .GroupBy(v => new { (v.Asset.DispositionChangedAtUtc ?? v.Asset.CreatedAtUtc).Year, (v.Asset.DispositionChangedAtUtc ?? v.Asset.CreatedAtUtc).Month, v.Unit })
            .Select(g => new { g.Key.Year, g.Key.Month, g.Key.Unit, Sum = g.Sum(v => v.Value), Valued = g.Count() })
            .ToListAsync(ct);

        var storedUnits = createdSizes.Select(r => r.Unit).Distinct().ToList();
        var mixed = storedUnits.Count > 1;
        string Display(string unit) => mixed ? AssetUnits.DisplayUnit(unit) : unit;
        decimal Convert(decimal value, string unit) => mixed ? AssetUnits.ToDisplay(value, unit) : value;
        var units = storedUnits.Select(Display).Distinct().Order(StringComparer.Ordinal).ToList();

        var now = clock.UtcNow;
        var current = now.Year * 12 + now.Month - 1;
        var months = Math.Clamp(query.Months ?? DefaultMonths, 1, 60);
        var windowStart = current - months + 1;
        var first = windowStart;
        foreach (var key in createdCounts.Select(r => r.Year * 12 + r.Month - 1))
            first = Math.Min(first, key);

        var added = createdSizes.GroupBy(r => (r.Year * 12 + r.Month - 1, Display(r.Unit))).ToDictionary(g => g.Key, g => (Sum: g.Sum(r => Convert(r.Sum, r.Unit)), Valued: g.Sum(r => r.Valued)));
        var removed = disposedSizes.GroupBy(r => (r.Year * 12 + r.Month - 1, Display(r.Unit))).ToDictionary(g => g.Key, g => (Sum: g.Sum(r => Convert(r.Sum, r.Unit)), Valued: g.Sum(r => r.Valued)));
        var createdBy = createdCounts.ToDictionary(r => r.Year * 12 + r.Month - 1, r => r.Count);
        var disposedBy = disposedCounts.GroupBy(r => r.Year * 12 + r.Month - 1).ToDictionary(g => g.Key, g => g.Sum(r => r.Count));

        var heldSum = units.ToDictionary(u => u, _ => 0m);
        var heldValued = units.ToDictionary(u => u, _ => 0);
        var heldAssets = 0;
        var points = new List<AssetVolumePoint>();
        for (var m = first; m <= current; m++)
        {
            heldAssets += createdBy.GetValueOrDefault(m) - disposedBy.GetValueOrDefault(m);
            foreach (var unit in units)
            {
                var a = added.GetValueOrDefault((m, unit));
                var r = removed.GetValueOrDefault((m, unit));
                heldSum[unit] += a.Sum - r.Sum;
                heldValued[unit] += a.Valued - r.Valued;
            }

            if (m < windowStart)
                continue;

            AssetUnitValue[] Row(Dictionary<(int, string), (decimal Sum, int Valued)> map) =>
                [.. units.Select(u => new AssetUnitValue(u, map.GetValueOrDefault((m, u)).Sum, map.GetValueOrDefault((m, u)).Valued))];

            points.Add(new AssetVolumePoint(
                string.Create(CultureInfo.InvariantCulture, $"{m / 12:0000}-{m % 12 + 1:00}"),
                heldAssets,
                createdBy.GetValueOrDefault(m),
                [.. units.Select(u => new AssetUnitValue(u, heldSum[u], heldValued[u]))],
                Row(added),
                Row(removed)));
        }

        string? warning = null;
        if (mixed)
            warning = $"This result mixes units: {string.Join(" and ", units)}. Each unit is charted on its own.";

        return new AssetVolumeResponse(points, units, warning, LimitationText);
    }
}
