using System.ComponentModel.DataAnnotations;
using System.Text.Json;

namespace MatterFlow.Assets.Application;

/// <summary>An Asset Type with its form status.</summary>
/// <param name="AssetTypeId">Internal id.</param>
/// <param name="Name">Unique name.</param>
/// <param name="Description">Optional description.</param>
/// <param name="SortOrder">Position in pickers and lists.</param>
/// <param name="IsActive">An inactive type cannot be chosen for new Assets; existing Assets keep it.</param>
/// <param name="AssetCount">Number of Assets of this type.</param>
/// <param name="PublishedFormVersionId">The published version of the type's field form, if any.</param>
/// <param name="PublishedFormVersionNo">Its version number, if any.</param>
/// <param name="RowVersion">Concurrency token (base64); send it back on update.</param>
/// <param name="CreatedAtUtc">When the type was created (UTC).</param>
/// <param name="ModifiedAtUtc">When the type was last changed (UTC), if ever.</param>
public sealed record AssetTypeResponse(
    [property: Required] int AssetTypeId,
    [property: Required] string Name,
    string? Description,
    [property: Required] int SortOrder,
    [property: Required] bool IsActive,
    [property: Required] int AssetCount,
    int? PublishedFormVersionId,
    int? PublishedFormVersionNo,
    [property: Required] string RowVersion,
    [property: Required] DateTime CreatedAtUtc,
    DateTime? ModifiedAtUtc);

/// <summary>Creates an Asset Type (and its empty field form).</summary>
public sealed class CreateAssetTypeRequest
{
    /// <summary>Unique name (max 100).</summary>
    [Required, StringLength(100, MinimumLength = 1)]
    public string Name { get; init; } = string.Empty;

    /// <summary>Optional description (max 500).</summary>
    [StringLength(500)]
    public string? Description { get; init; }

    /// <summary>Position; default is the end of the list.</summary>
    public int? SortOrder { get; init; }
}

/// <summary>Updates an Asset Type.</summary>
public sealed class UpdateAssetTypeRequest
{
    [Required, StringLength(100, MinimumLength = 1)]
    public string Name { get; init; } = string.Empty;

    [StringLength(500)]
    public string? Description { get; init; }

    public int SortOrder { get; init; }

    public bool IsActive { get; init; } = true;

    /// <summary>The <c>rowVersion</c> last read.</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

/// <summary>Asset Type list filters.</summary>
public sealed class AssetTypeListQuery : AssetListQueryBase
{
    /// <summary>Name fragment.</summary>
    [StringLength(200)]
    public string? Q { get; init; }

    /// <summary>Filter by active state.</summary>
    public bool? IsActive { get; init; }

    internal static readonly string[] Keys = ["page", "pageSize", "sort", "q", "isActive"];
}

/// <summary>Paging and sort parameters shared by the Asset list endpoints.</summary>
public class AssetListQueryBase
{
    /// <summary>1-based page number.</summary>
    [Range(1, int.MaxValue)]
    public int Page { get; init; } = 1;

    /// <summary>Items per page (default 25, max 100).</summary>
    [Range(1, 100)]
    public int PageSize { get; init; } = 25;

    /// <summary>Comma-separated sort fields; prefix with <c>-</c> for descending.</summary>
    [StringLength(200)]
    public string? Sort { get; init; }
}

/// <summary>Asset list filters.</summary>
public sealed class AssetListQuery : AssetListQueryBase
{
    /// <summary>Only Assets of this Matter.</summary>
    public int? MatterId { get; init; }

    /// <summary>Only Assets of this Asset Type.</summary>
    public int? AssetTypeId { get; init; }

    /// <summary>Filter by active state.</summary>
    public bool? IsActive { get; init; }

    /// <summary>Fragment of the display name, the Asset Type name or the external reference.</summary>
    [StringLength(200)]
    public string? Q { get; init; }

    /// <summary>Column filter: fragment of the display name only.</summary>
    [StringLength(200)]
    public string? Name { get; init; }

    /// <summary>Column filter: fragment of the external reference only.</summary>
    [StringLength(200)]
    public string? ExternalReference { get; init; }

    /// <summary>Column filter: fragment of the Matter reference (<c>00343-00012</c>, or the typed pair <c>343-12</c>) or of the Matter name.</summary>
    [StringLength(200)]
    public string? Matter { get; init; }

    internal static readonly string[] Keys = ["page", "pageSize", "sort", "matterId", "assetTypeId", "isActive", "q", "name", "externalReference", "matter"];
}

/// <summary>Asset picker lookup filters (always inside one Matter).</summary>
public sealed class AssetLookupQuery
{
    /// <summary>The Matter whose Assets are offered.</summary>
    [Required, Range(1, int.MaxValue)]
    public int MatterId { get; init; }

    /// <summary>Fragment of the display name, the Asset Type name or the external reference.</summary>
    [StringLength(200)]
    public string? Q { get; init; }

    /// <summary>Include inactive Assets (default false).</summary>
    public bool IncludeInactive { get; init; }

    /// <summary>Maximum number of items (default 25, max 50).</summary>
    [Range(1, 50)]
    public int Limit { get; init; } = 25;

    internal static readonly string[] Keys = ["matterId", "q", "includeInactive", "limit"];
}

/// <summary>An Asset in a list.</summary>
/// <param name="AssetId">Internal id.</param>
/// <param name="MatterId">Owning Matter (cannot change).</param>
/// <param name="MatterRef">Matter reference, for example <c>00343-00012</c>.</param>
/// <param name="MatterName">Matter name.</param>
/// <param name="AssetTypeId">Asset Type id (cannot change).</param>
/// <param name="AssetTypeName">Asset Type name.</param>
/// <param name="DisplayName">Name shown in lists and pickers.</param>
/// <param name="ExternalReference">URL, workspace id or media label, if any.</param>
/// <param name="Description">Optional description.</param>
/// <param name="IsActive">Active or inactive.</param>
/// <param name="RowVersion">Concurrency token (base64).</param>
/// <param name="CreatedAtUtc">When the Asset was created (UTC).</param>
/// <param name="ModifiedAtUtc">When the Asset was last changed (UTC), if ever.</param>
public sealed record AssetListItem(
    [property: Required] int AssetId,
    [property: Required] int MatterId,
    [property: Required] string MatterRef,
    [property: Required] string MatterName,
    [property: Required] int AssetTypeId,
    [property: Required] string AssetTypeName,
    [property: Required] string DisplayName,
    string? ExternalReference,
    string? Description,
    [property: Required] bool IsActive,
    [property: Required] string RowVersion,
    [property: Required] DateTime CreatedAtUtc,
    DateTime? ModifiedAtUtc);

/// <summary>An Asset with its type-specific values.</summary>
/// <param name="AssetId">Internal id.</param>
/// <param name="MatterId">Owning Matter (cannot change).</param>
/// <param name="MatterRef">Matter reference, for example <c>00343-00012</c>.</param>
/// <param name="MatterName">Matter name.</param>
/// <param name="AssetTypeId">Asset Type id (cannot change).</param>
/// <param name="AssetTypeName">Asset Type name.</param>
/// <param name="AssetTypeIsActive">False when the Asset Type has been deactivated.</param>
/// <param name="DisplayName">Name shown in lists and pickers.</param>
/// <param name="ExternalReference">URL, workspace id or media label, if any.</param>
/// <param name="Description">Optional description.</param>
/// <param name="IsActive">Active or inactive.</param>
/// <param name="FormVersionId">The form version the stored values were captured under (the schema to render them with); null when none were saved.</param>
/// <param name="PublishedFormVersionId">The type's currently published form version, the schema to edit with; null when the type has none.</param>
/// <param name="FormValues">Stored values keyed by field key.</param>
/// <param name="DroppedFields">Keys of values dropped by this save because the form hides them (empty on reads).</param>
/// <param name="RowVersion">Concurrency token (base64).</param>
/// <param name="CreatedAtUtc">When the Asset was created (UTC).</param>
/// <param name="ModifiedAtUtc">When the Asset was last changed (UTC), if ever.</param>
public sealed record AssetResponse(
    [property: Required] int AssetId,
    [property: Required] int MatterId,
    [property: Required] string MatterRef,
    [property: Required] string MatterName,
    [property: Required] int AssetTypeId,
    [property: Required] string AssetTypeName,
    [property: Required] bool AssetTypeIsActive,
    [property: Required] string DisplayName,
    string? ExternalReference,
    string? Description,
    [property: Required] bool IsActive,
    int? FormVersionId,
    int? PublishedFormVersionId,
    [property: Required] Dictionary<string, JsonElement> FormValues,
    [property: Required] IReadOnlyList<string> DroppedFields,
    [property: Required] string RowVersion,
    [property: Required] DateTime CreatedAtUtc,
    DateTime? ModifiedAtUtc);

/// <summary>An Asset offered by a picker.</summary>
/// <param name="AssetId">Internal id.</param>
/// <param name="MatterId">Owning Matter.</param>
/// <param name="AssetTypeName">Asset Type name.</param>
/// <param name="DisplayName">Name shown in the picker.</param>
/// <param name="ExternalReference">URL, workspace id or media label, if any.</param>
/// <param name="IsActive">Active or inactive.</param>
public sealed record AssetLookupItem(
    [property: Required] int AssetId,
    [property: Required] int MatterId,
    [property: Required] string AssetTypeName,
    [property: Required] string DisplayName,
    string? ExternalReference,
    [property: Required] bool IsActive);

/// <summary>Creates an Asset in a Matter.</summary>
public sealed class CreateAssetRequest
{
    /// <summary>The owning Matter; it cannot be changed later.</summary>
    [Range(1, int.MaxValue)]
    public int MatterId { get; init; }

    /// <summary>An active Asset Type; it cannot be changed later.</summary>
    [Range(1, int.MaxValue)]
    public int AssetTypeId { get; init; }

    /// <summary>Name shown in lists and pickers (max 300).</summary>
    [Required, StringLength(300, MinimumLength = 1)]
    public string DisplayName { get; init; } = string.Empty;

    /// <summary>URL, workspace id or media label (max 1000).</summary>
    [StringLength(1000)]
    public string? ExternalReference { get; init; }

    /// <summary>Optional description (max 2000).</summary>
    [StringLength(2000)]
    public string? Description { get; init; }

    /// <summary>Values of the Asset Type's fields keyed by field key; validated against the published form (hidden values are dropped).</summary>
    public Dictionary<string, JsonElement>? FormValues { get; init; }
}

/// <summary>Updates an Asset. The Matter and the Asset Type cannot change.</summary>
public sealed class UpdateAssetRequest
{
    /// <summary>Optional; when sent it must equal the current Matter (otherwise 409 IMMUTABLE_FIELD).</summary>
    public int? MatterId { get; init; }

    /// <summary>Optional; when sent it must equal the current Asset Type (otherwise 409 IMMUTABLE_FIELD).</summary>
    public int? AssetTypeId { get; init; }

    [Required, StringLength(300, MinimumLength = 1)]
    public string DisplayName { get; init; } = string.Empty;

    [StringLength(1000)]
    public string? ExternalReference { get; init; }

    [StringLength(2000)]
    public string? Description { get; init; }

    /// <summary>
    /// A patch over the stored values keyed by field key: a JSON <c>null</c> clears a value, omitted keys stay as they are.
    /// Omit the property to leave the values untouched. Only the changed fields are validated.
    /// </summary>
    public Dictionary<string, JsonElement>? FormValues { get; init; }

    /// <summary>The <c>rowVersion</c> last read.</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

/// <summary>Activates or deactivates an Asset.</summary>
public sealed class SetAssetActiveRequest
{
    public bool IsActive { get; init; }

    /// <summary>The <c>rowVersion</c> last read.</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;
}
