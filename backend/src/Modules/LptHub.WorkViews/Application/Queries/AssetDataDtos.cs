using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// The parameters of <c>GET /my-matters/data</c> (epic #851 issue #869; the Data Area of epic #893 issue #931). Unknown parameters are a 400. Every selection is optional: nothing chosen means
/// everything the caller may see.
/// </summary>
public sealed class AssetDataQuery
{
    public static readonly IReadOnlyList<string> Keys = ["scope", "role", "matterIds", "assetTypeIds", "sizeFields", "from", "to"];

    /// <summary><c>mine</c> (default): matters the caller manages. <c>all</c>: every matter the caller may see; needs <c>Matter.AssignManagers</c> (403 otherwise).</summary>
    [FromQuery(Name = "scope"), StringLength(10)]
    public string? Scope { get; init; }

    /// <summary><c>both</c> (default), <c>primary</c> or <c>secondary</c>: which place of the matter the caller holds (scope mine only).</summary>
    [FromQuery(Name = "role"), StringLength(10)]
    public string? Role { get; init; }

    /// <summary>
    /// Only these matters (at most 500). An id the caller may not see, or that does not exist, is left out without a word, so the answer never tells whether a hidden matter exists and
    /// no total ever includes one.
    /// </summary>
    [FromQuery(Name = "matterIds")]
    public int[]? MatterIds { get; init; }

    /// <summary>Only assets of these asset types.</summary>
    [FromQuery(Name = "assetTypeIds")]
    public int[]? AssetTypeIds { get; init; }

    /// <summary>
    /// The number fields that mean size, each written <c>assetTypeId:fieldKey</c> or, for a field that is not the type's own default size field, <c>assetTypeId:fieldKey:unit</c> (B, KB, MB, GB,
    /// TB or Items). A type with chosen fields is measured by them instead of its default; every other type keeps its default. Not stored: the choice belongs to the view.
    /// </summary>
    [FromQuery(Name = "sizeFields")]
    public string[]? SizeFields { get; init; }

    /// <summary>First day (<c>yyyy-MM-dd</c>, UTC) of the period in which the assets were added.</summary>
    [FromQuery(Name = "from")]
    public DateOnly? From { get; init; }

    /// <summary>Last day of the period (see <c>from</c>), included.</summary>
    [FromQuery(Name = "to")]
    public DateOnly? To { get; init; }
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

/// <summary>A number field that measures the size of an asset type.</summary>
/// <param name="Key">The field's key (what a size field choice is written with).</param>
/// <param name="Label">The label of the field on the asset type's form.</param>
/// <param name="Unit">The unit it is measured in.</param>
public sealed record AssetDataMeasure([property: Required] string Key, [property: Required] string Label, [property: Required] string Unit);

/// <summary>A number field of an asset type's published form that can be chosen to mean size.</summary>
/// <param name="Key">The field's key.</param>
/// <param name="Label">The label of the field on the form.</param>
/// <param name="IsDefault">True for the asset type's own default size field (its unit is the type's).</param>
/// <param name="Unit">The unit of the default field; null for the other fields (the person chooses it).</param>
public sealed record AssetDataNumberField([property: Required] string Key, [property: Required] string Label, [property: Required] bool IsDefault, string? Unit);

/// <summary>The size of the assets of one disposition (a type's Active assets, say), per unit.</summary>
/// <param name="Disposition">The disposition code, for example <c>ACTIVE</c>.</param>
/// <param name="Size">The size per unit.</param>
public sealed record AssetDispositionSize([property: Required] string Disposition, [property: Required] IReadOnlyList<AssetUnitValue> Size);

/// <summary>One asset type of the Data tab.</summary>
/// <param name="AssetTypeId">The type.</param>
/// <param name="Name">Type name.</param>
/// <param name="Counts">Assets by disposition and size.</param>
/// <param name="Query">Assets list query that lists exactly these assets.</param>
/// <param name="Measures">The number fields measured for this type now: the type's default size field or the fields the view chose. Empty when the type has no size field.</param>
/// <param name="NumberFields">The number fields of the type's published form, the choices for the size fields.</param>
/// <param name="DispositionSizes">The size split by disposition (only dispositions that have a size), so a view of one status can show its size.</param>
public sealed record AssetDataTypeRow(
    [property: Required] int AssetTypeId,
    [property: Required] string Name,
    [property: Required] AssetDataCounts Counts,
    [property: Required] string Query,
    [property: Required] IReadOnlyList<AssetDataMeasure> Measures,
    [property: Required] IReadOnlyList<AssetDataNumberField> NumberFields,
    [property: Required] IReadOnlyList<AssetDispositionSize> DispositionSizes);

/// <summary>A matter that was asked for and that the caller may see.</summary>
/// <param name="MatterId">The matter.</param>
/// <param name="MatterRef">Reference.</param>
/// <param name="MatterName">Name.</param>
public sealed record AssetDataSelectedMatter([property: Required] int MatterId, [property: Required] string MatterRef, [property: Required] string MatterName);

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
/// <param name="SelectedMatters">The matters of <c>matterIds</c> that the caller may see (empty when none were asked for).</param>
public sealed record AssetDataResponse(
    [property: Required] AssetDataCounts Totals,
    [property: Required] IReadOnlyList<AssetDataMatterRow> Matters,
    [property: Required] IReadOnlyList<AssetDataTypeRow> Types,
    [property: Required] AssetDataWarnings Warnings,
    string? UnitsWarning,
    [property: Required] string ScopeQuery,
    [property: Required] IReadOnlyList<AssetDataSelectedMatter> SelectedMatters);

/// <summary>
/// The parameters of <c>GET /my-matters/data/volume</c> (epic #851 issue #871; the Data Area of epic #893 issue #931). Unknown parameters are a 400. The selection is the one of the Data
/// call, so the two always describe the same assets.
/// </summary>
public sealed class AssetVolumeQuery
{
    public static readonly IReadOnlyList<string> Keys = ["scope", "role", "matterIds", "assetTypeIds", "sizeFields", "from", "to", "months"];

    /// <summary><c>mine</c> (default) or <c>all</c> (needs <c>Matter.AssignManagers</c>), as for the Data tab.</summary>
    [FromQuery(Name = "scope"), StringLength(10)]
    public string? Scope { get; init; }

    /// <summary><c>both</c> (default), <c>primary</c> or <c>secondary</c> (scope mine only).</summary>
    [FromQuery(Name = "role"), StringLength(10)]
    public string? Role { get; init; }

    /// <summary>Only the assets of these matters (the ones the caller may see; see the Data call).</summary>
    [FromQuery(Name = "matterIds")]
    public int[]? MatterIds { get; init; }

    /// <summary>Only assets of these asset types.</summary>
    [FromQuery(Name = "assetTypeIds")]
    public int[]? AssetTypeIds { get; init; }

    /// <summary>The number fields that mean size, as for the Data call.</summary>
    [FromQuery(Name = "sizeFields")]
    public string[]? SizeFields { get; init; }

    /// <summary>First day of the period in which the assets were added, as for the Data call.</summary>
    [FromQuery(Name = "from")]
    public DateOnly? From { get; init; }

    /// <summary>Last day of the period, included.</summary>
    [FromQuery(Name = "to")]
    public DateOnly? To { get; init; }

    /// <summary>How many months to return, ending with the current month (1 to 60, default 24). Earlier history is carried into the first month, not cut off.</summary>
    [FromQuery(Name = "months"), Range(1, 60)]
    public int? Months { get; init; }
}

/// <summary>One month of the volume chart: the size held at the end of the month and what came in and went out during it.</summary>
/// <param name="Month">Calendar month, <c>yyyy-MM</c>.</param>
/// <param name="Assets">Assets held at the end of the month (created up to then, not disposed up to then).</param>
/// <param name="AssetsAdded">How many assets were created in the month (whether or not they have a size); the screen shows the volume only when assets came in over several months.</param>
/// <param name="Held">Cumulative size held at the end of the month, one entry per unit of the result (zero when none).</param>
/// <param name="Added">Size of the assets created in the month, per unit.</param>
/// <param name="Removed">Size of the assets whose disposition became Disposed in the month, per unit.</param>
public sealed record AssetVolumePoint(
    [property: Required] string Month,
    [property: Required] int Assets,
    [property: Required] int AssetsAdded,
    [property: Required] IReadOnlyList<AssetUnitValue> Held,
    [property: Required] IReadOnlyList<AssetUnitValue> Added,
    [property: Required] IReadOnlyList<AssetUnitValue> Removed);

/// <summary>
/// Data volume over time (monthly, cumulative). It is derived, not recorded: an asset's size is its <b>current</b> value placed at the month the asset was created, and a disposed asset
/// leaves at the month its disposition changed. There is no snapshot table, so a size edited later changes the past.
/// </summary>
/// <param name="Points">The months, oldest first; the last one is the current month.</param>
/// <param name="Units">The units of the result (one, or GB and Items when they meet).</param>
/// <param name="UnitsWarning">Set when the units mix, as for the Data tab; null otherwise.</param>
/// <param name="Limitation">The limit of the figures, as text to show on screen.</param>
public sealed record AssetVolumeResponse(
    [property: Required] IReadOnlyList<AssetVolumePoint> Points,
    [property: Required] IReadOnlyList<string> Units,
    string? UnitsWarning,
    [property: Required] string Limitation);
