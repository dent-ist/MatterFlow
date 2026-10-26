using System.ComponentModel.DataAnnotations;

namespace MatterFlow.Assets.Application;

/// <summary>Measures of an asset report.</summary>
public static class AssetReportMeasures
{
    public const string Count = "count";
    public const string Sum = "sum";
    public const string Average = "average";

    public static readonly IReadOnlyList<string> All = [Count, Sum, Average];
}

/// <summary>Built-in group-by keys of an asset report (a Select field of the type is <c>field:&lt;key&gt;</c>).</summary>
public static class AssetReportGroupBy
{
    public const string Disposition = "disposition";
    public const string Matter = "matter";
    public const string Client = "client";
    public const string AssetType = "assetType";
    public const string FieldPrefix = "field:";

    public static readonly IReadOnlyList<string> BuiltIn = [Disposition, Matter, Client, AssetType];

    public static string Label(string key) => key switch
    {
        Disposition => "Disposition",
        Matter => "Matter",
        Client => "Client",
        AssetType => "Asset type",
        _ => key,
    };
}

/// <summary>
/// The definition of a saved asset report, version 1 (epic #851, issue #872). Narrow on purpose: an asset type (or all), a measure, a number field and
/// its unit, one group-by, a disposition filter, the scope and the matters, and how to draw the result. No SQL, no parameters.
/// </summary>
public sealed class AssetReportDefinition
{
    /// <summary>Definition version; only 1 exists. An unknown version is rejected.</summary>
    public int V { get; init; } = 1;

    /// <summary>The asset type to report on; null means all asset types (then the measure is Count, or a Sum or Average of each type's default size field).</summary>
    public int? AssetTypeId { get; init; }

    /// <summary><c>count</c>, <c>sum</c> or <c>average</c>.</summary>
    public string Measure { get; init; } = AssetReportMeasures.Count;

    /// <summary>The NUMBER field to sum or average; null with Sum or Average means the type's default size field. Always null for Count.</summary>
    [StringLength(64)]
    public string? NumberField { get; init; }

    /// <summary>The unit of a number field that is not the type's default size field (B, KB, MB, GB, TB or Items).</summary>
    [StringLength(10)]
    public string? NumberUnit { get; init; }

    /// <summary><c>disposition</c>, <c>matter</c>, <c>client</c>, <c>assetType</c> or <c>field:&lt;key&gt;</c> (a SELECT field of the chosen type).</summary>
    [StringLength(80)]
    public string GroupBy { get; init; } = AssetReportGroupBy.Disposition;

    /// <summary><c>mine</c> (matters I manage) or <c>all</c> (needs Matter.AssignManagers).</summary>
    public string Scope { get; init; } = "mine";

    /// <summary>Restrict to these matters (at most 100); null means every matter in the scope.</summary>
    public int[]? MatterIds { get; init; }

    /// <summary>Keep only assets with one of these dispositions (ACTIVE, INACTIVE, PENDING_DISPOSITION, DISPOSED); null means all.</summary>
    public string[]? Dispositions { get; init; }

    /// <summary>How the result is shown by default: <c>table</c> (default), <c>pie</c> or <c>bar</c>.</summary>
    public string? Chart { get; init; }
}

/// <summary>A saved asset report.</summary>
/// <param name="AssetReportId">Internal id.</param>
/// <param name="Name">Name, unique per owner.</param>
/// <param name="Definition">The definition; null when it was saved by a newer version of the application that this one cannot read (<paramref name="IsSupported"/> false).</param>
/// <param name="IsSupported">False when the stored definition has an unknown version.</param>
/// <param name="RowVersion">Concurrency token (base64).</param>
/// <param name="CreatedAtUtc">When it was saved (UTC).</param>
/// <param name="ModifiedAtUtc">When it was last changed (UTC), if ever.</param>
public sealed record AssetReportResponse(
    [property: Required] int AssetReportId,
    [property: Required] string Name,
    AssetReportDefinition? Definition,
    [property: Required] bool IsSupported,
    [property: Required] string RowVersion,
    [property: Required] DateTime CreatedAtUtc,
    DateTime? ModifiedAtUtc);

/// <summary>Saves a new asset report.</summary>
public sealed class CreateAssetReportRequest
{
    /// <summary>Name (max 100), unique among the caller's reports.</summary>
    [Required, StringLength(100, MinimumLength = 1)]
    public string Name { get; init; } = string.Empty;

    [Required]
    public AssetReportDefinition Definition { get; init; } = new();
}

/// <summary>Replaces the name and definition of a saved asset report.</summary>
public sealed class UpdateAssetReportRequest
{
    [Required, StringLength(100, MinimumLength = 1)]
    public string Name { get; init; } = string.Empty;

    [Required]
    public AssetReportDefinition Definition { get; init; } = new();

    /// <summary>The <c>rowVersion</c> last read.</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

/// <summary>A number field a report can sum or average.</summary>
/// <param name="Key">Field key.</param>
/// <param name="Label">Display label.</param>
/// <param name="IsDefaultSize">True for the type's designated size field.</param>
/// <param name="Unit">The unit of the default size field; null for other fields (the report names the unit).</param>
public sealed record AssetReportNumberField(
    [property: Required] string Key,
    [property: Required] string Label,
    [property: Required] bool IsDefaultSize,
    string? Unit);

/// <summary>A way to group a report.</summary>
/// <param name="Key"><c>disposition</c>, <c>matter</c>, <c>client</c>, <c>assetType</c> or <c>field:&lt;key&gt;</c>.</param>
/// <param name="Label">Display label.</param>
public sealed record AssetReportGroupOption([property: Required] string Key, [property: Required] string Label);

/// <summary>What the report builder can offer for an asset type (or all types).</summary>
/// <param name="Measures">The measures allowed (all types: Count, Sum and Average of each type's default size).</param>
/// <param name="NumberFields">The NUMBER fields of the type's published form; empty for all types.</param>
/// <param name="GroupBy">The group-by choices.</param>
/// <param name="Units">The units a number field can have.</param>
/// <param name="DefaultSizeFieldKey">The type's default size field, if designated.</param>
/// <param name="DefaultSizeUnit">Its unit.</param>
public sealed record AssetReportFieldsResponse(
    [property: Required] IReadOnlyList<string> Measures,
    [property: Required] IReadOnlyList<AssetReportNumberField> NumberFields,
    [property: Required] IReadOnlyList<AssetReportGroupOption> GroupBy,
    [property: Required] IReadOnlyList<string> Units,
    string? DefaultSizeFieldKey,
    string? DefaultSizeUnit);
