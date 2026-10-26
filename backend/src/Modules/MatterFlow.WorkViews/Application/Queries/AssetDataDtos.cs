using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>The parameters of <c>GET /my-matters/data</c> (epic #851, issue #869). Unknown parameters are a 400.</summary>
public sealed class AssetDataQuery
{
    public static readonly IReadOnlyList<string> Keys = ["scope", "role", "assetTypeId", "sizeField", "sizeUnit"];

    /// <summary><c>mine</c> (default): matters the caller manages. <c>all</c>: every matter the caller may see; needs <c>Matter.AssignManagers</c> (403 otherwise).</summary>
    [FromQuery(Name = "scope"), StringLength(10)]
    public string? Scope { get; init; }

    /// <summary><c>both</c> (default), <c>primary</c> or <c>secondary</c>: which place of the matter the caller holds (scope mine only).</summary>
    [FromQuery(Name = "role"), StringLength(10)]
    public string? Role { get; init; }

    /// <summary>Only assets of this asset type; needed to override the size field.</summary>
    [FromQuery(Name = "assetTypeId")]
    public int? AssetTypeId { get; init; }

    /// <summary>With <c>assetTypeId</c>: measure this number field of the type instead of its default size field (not stored; the choice belongs to the view).</summary>
    [FromQuery(Name = "sizeField"), StringLength(64)]
    public string? SizeField { get; init; }

    /// <summary>The unit of <c>sizeField</c> when it is not the type's default (B, KB, MB, GB, TB or Items).</summary>
    [FromQuery(Name = "sizeUnit"), StringLength(10)]
    public string? SizeUnit { get; init; }
}

/// <summary>A size in one unit. B to TB are added up after conversion and shown in GB; Items (files, pages) are never added to bytes.</summary>
/// <param name="Unit"><c>GB</c> or <c>Items</c>, or the type's own unit when the result has a single unit.</param>
/// <param name="Value">The sum.</param>
/// <param name="Assets">How many assets contributed a value.</param>
public sealed record AssetUnitValue([property: Required] string Unit, [property: Required] decimal Value, [property: Required] int Assets);

/// <summary>Counts of assets by disposition and the size.</summary>
public sealed record AssetDataCounts(
    [property: Required] int Assets,
    [property: Required] int Active,
    [property: Required] int Inactive,
    [property: Required] int PendingDisposition,
    [property: Required] int Disposed,
    [property: Required] IReadOnlyList<AssetUnitValue> Size);

/// <summary>One matter of the Data tab.</summary>
/// <param name="MatterId">The matter.</param>
/// <param name="MatterRef">Reference, for example <c>00343-00012</c>.</param>
/// <param name="MatterName">Matter name.</param>
/// <param name="ClientName">Client name.</param>
/// <param name="MatterIsActive">False for a closed matter (its assets still need a disposition).</param>
/// <param name="Counts">Assets by disposition and size.</param>
/// <param name="Query">Assets list query that lists exactly these assets.</param>
public sealed record AssetDataMatterRow(
    [property: Required] int MatterId,
    [property: Required] string MatterRef,
    [property: Required] string MatterName,
    [property: Required] string ClientName,
    [property: Required] bool MatterIsActive,
    [property: Required] AssetDataCounts Counts,
    [property: Required] string Query);

/// <summary>One asset type of the Data tab.</summary>
/// <param name="AssetTypeId">The type.</param>
/// <param name="Name">Type name.</param>
/// <param name="Counts">Assets by disposition and size.</param>
/// <param name="SizeFieldKey">The size field measured (the type's default or the override).</param>
/// <param name="SizeUnit">Its unit.</param>
/// <param name="Query">Assets list query that lists exactly these assets.</param>
public sealed record AssetDataTypeRow(
    [property: Required] int AssetTypeId,
    [property: Required] string Name,
    [property: Required] AssetDataCounts Counts,
    string? SizeFieldKey,
    string? SizeUnit,
    [property: Required] string Query);

/// <summary>A fact the Data tab states (never dismissed): how many assets, how old, and the Assets list query that lists exactly them.</summary>
/// <param name="Assets">The assets concerned.</param>
/// <param name="OldestDays">For "awaiting disposition": the age in days of the oldest; null otherwise.</param>
/// <param name="Query">Assets list query that lists exactly these assets.</param>
public sealed record AssetDataWarning(
    [property: Required] int Assets,
    int? OldestDays,
    [property: Required] string Query);

/// <summary>The two warnings of the Data tab.</summary>
/// <param name="InactiveLinked">Assets that are not Active but still linked to open tasks.</param>
/// <param name="AwaitingDisposition">Assets in Pending disposition.</param>
public sealed record AssetDataWarnings(
    [property: Required] AssetDataWarning InactiveLinked,
    [property: Required] AssetDataWarning AwaitingDisposition);

/// <summary>The Data tab of My Matters: assets and their size per matter and per asset type, by disposition, with the two warnings.</summary>
/// <param name="Totals">All assets of the scope.</param>
/// <param name="Matters">One row per matter that has assets, by reference.</param>
/// <param name="Types">One row per asset type that has assets, by name.</param>
/// <param name="Warnings">Inactive-but-linked and awaiting disposition.</param>
/// <param name="UnitsWarning">Set when the sizes mix units, for example <c>This result mixes units: GB and Items. Totals are shown per unit.</c>; null otherwise.</param>
/// <param name="ScopeQuery">Assets list query that lists exactly the assets of the scope.</param>
public sealed record AssetDataResponse(
    [property: Required] AssetDataCounts Totals,
    [property: Required] IReadOnlyList<AssetDataMatterRow> Matters,
    [property: Required] IReadOnlyList<AssetDataTypeRow> Types,
    [property: Required] AssetDataWarnings Warnings,
    string? UnitsWarning,
    [property: Required] string ScopeQuery);
