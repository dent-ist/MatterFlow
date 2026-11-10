using System.Globalization;
using MatterFlow.Assets.Domain;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// The number fields that mean "size" in one view of the Data Area (epic #893, issue #931): for each asset type named here, these fields replace the type's own default size
/// field; every other type keeps its default. A field of one type is never measured on another type's assets.
/// </summary>
/// <param name="Fields">The chosen fields, each with the unit it is measured in.</param>
public sealed record AssetMeasurePlan(IReadOnlyList<AssetMeasureSource> Fields)
{
    /// <summary>Every type's own default size field (nothing chosen).</summary>
    public static AssetMeasurePlan Defaults { get; } = new([]);

    /// <summary>The asset types whose default size field is replaced by the chosen fields.</summary>
    public IReadOnlyList<int> OverriddenTypes => [.. Fields.Where(f => f.AssetTypeId is not null).Select(f => f.AssetTypeId!.Value).Distinct()];
}

/// <summary>
/// What one call of the Data Area looks at: the assets (of the matters the caller may see, narrowed by the matters, asset types and period the person chose) and the number fields
/// that measure their size. The matters are an INTERSECTION with what the caller may see: an id the caller may not see, or that does not exist, changes nothing and is not
/// reported (a hidden matter must not show in any total, row or answer, even when its id is asked for).
/// </summary>
public sealed record AssetSelection(AssetScope Scope, IQueryable<Asset> Assets, AssetMeasurePlan Plan, IReadOnlyList<int> AssetTypeIds, IReadOnlyList<int> MatterIds, DateOnly? From, DateOnly? To)
{
    /// <summary>True when the selection narrows by period.</summary>
    public bool HasPeriod => From is not null || To is not null;
}

/// <summary>Turns the optional <c>matterIds</c>, <c>assetTypeIds</c>, <c>sizeFields</c>, <c>from</c> and <c>to</c> of the Data Area and its volume chart into an <see cref="AssetSelection"/>.</summary>
public sealed class AssetSelectionResolver(DbContext db, AssetScopeResolver scopes, IFormFieldCatalog fieldCatalog)
{
    /// <summary>More matters than this in one call is a mistake of the caller (the screen's address would not hold them either).</summary>
    public const int MaxMatters = 500;

    public const int MaxAssetTypes = 200;

    public const int MaxSizeFields = 40;

    public async Task<Result<AssetSelection>> ResolveAsync(
        string? scopeText,
        string? roleText,
        IReadOnlyCollection<int>? matterIds,
        IReadOnlyCollection<int>? assetTypeIds,
        IReadOnlyCollection<string>? sizeFields,
        DateOnly? from,
        DateOnly? to,
        CancellationToken ct)
    {
        if (matterIds is { Count: > MaxMatters })
            return Error.Validation("matterIds", "TOO_MANY", $"Choose at most {MaxMatters} matters.");
        if (assetTypeIds is { Count: > MaxAssetTypes })
            return Error.Validation("assetTypeIds", "TOO_MANY", $"Choose at most {MaxAssetTypes} asset types.");
        if (sizeFields is { Count: > MaxSizeFields })
            return Error.Validation("sizeFields", "TOO_MANY", $"Choose at most {MaxSizeFields} size fields.");
        if (from is { } f && to is { } t && f > t)
            return Error.Validation("from", "RANGE", "The period starts after it ends.");

        var resolved = scopes.Resolve(scopeText, roleText, matterIds);
        if (resolved.IsFailure)
            return resolved.Error!;

        var scope = resolved.Value;
        var assets = scope.Assets();

        var typeIds = assetTypeIds is { Count: > 0 } ? assetTypeIds.Distinct().Order().ToArray() : [];
        if (typeIds.Length > 0)
        {
            var found = await db.Set<AssetType>().AsNoTracking().Where(x => typeIds.Contains(x.Id)).Select(x => x.Id).ToListAsync(ct);
            if (typeIds.Except(found).Any())
                return Error.Validation("assetTypeIds", "NOT_FOUND", "An asset type does not exist.");

            assets = assets.Where(a => typeIds.Contains(a.AssetTypeId));
        }

        if (from is { } start)
        {
            var startUtc = start.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
            assets = assets.Where(a => a.CreatedAtUtc >= startUtc);
        }

        if (to is { } end)
        {
            var beforeUtc = end.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
            assets = assets.Where(a => a.CreatedAtUtc < beforeUtc);
        }

        var plan = await PlanAsync(sizeFields, typeIds, ct);
        if (plan.IsFailure)
            return plan.Error!;

        var matters = matterIds is { Count: > 0 } ? matterIds.Distinct().Order().ToArray() : [];
        return new AssetSelection(scope, assets, plan.Value, typeIds, matters, from, to);
    }

    /// <summary>
    /// <c>typeId:fieldKey</c> or <c>typeId:fieldKey:unit</c>. The unit is required for a field that is not the type's default size field (the default field is always in the type's
    /// own unit). A field of a type that is not among the chosen types is ignored (the screen drops it with the type).
    /// </summary>
    private async Task<Result<AssetMeasurePlan>> PlanAsync(IReadOnlyCollection<string>? tokens, int[] chosenTypes, CancellationToken ct)
    {
        if (tokens is not { Count: > 0 })
            return AssetMeasurePlan.Defaults;

        var parsed = new List<(int TypeId, string Key, string? Unit)>();
        foreach (var token in tokens)
        {
            var parts = (token ?? string.Empty).Split(':', 3, StringSplitOptions.TrimEntries);
            if (parts.Length < 2 || !int.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var typeId) || typeId <= 0 || parts[1].Length == 0 || parts[1].Length > 64)
                return Error.Validation("sizeFields", "INVALID", "A size field is written typeId:fieldKey or typeId:fieldKey:unit.");

            parsed.Add((typeId, parts[1], parts.Length == 3 && parts[2].Length > 0 ? parts[2] : null));
        }

        var typeIds = parsed.Select(p => p.TypeId).Distinct().ToArray();
        var types = await db.Set<AssetType>().AsNoTracking().Where(x => typeIds.Contains(x.Id)).Select(x => new { x.Id, x.SizeFieldKey, x.SizeUnit }).ToDictionaryAsync(x => x.Id, ct);
        var published = await fieldCatalog.GetPublishedFieldsAsync(FormOwnerKind.AssetType, typeIds, ct);

        var fields = new List<AssetMeasureSource>();
        foreach (var (typeId, key, unitText) in parsed.DistinctBy(p => (p.TypeId, p.Key)))
        {
            if (!types.TryGetValue(typeId, out var type))
                return Error.Validation("sizeFields", "NOT_FOUND", "The asset type of a size field does not exist.");
            if (chosenTypes.Length > 0 && !chosenTypes.Contains(typeId))
                continue;

            if (!published.TryGetValue(typeId, out var list) || !list.Any(x => x.IsNumber && x.Key == key))
                return Error.Validation("sizeFields", "INVALID", "A size field must be a number field of the published form of its asset type.");

            var unit = key == type.SizeFieldKey ? type.SizeUnit : unitText;
            if (!AssetSize.IsKnownUnit(unit))
                return Error.Validation("sizeFields", "UNIT_REQUIRED", $"Choose the unit of a size field: {string.Join(", ", AssetSize.Units)}.");

            fields.Add(new AssetMeasureSource(typeId, key, unit));
        }

        return fields.Count == 0 ? AssetMeasurePlan.Defaults : new AssetMeasurePlan(fields);
    }
}
