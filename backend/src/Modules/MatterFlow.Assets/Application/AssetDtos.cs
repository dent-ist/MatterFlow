using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using MatterFlow.Assets.Domain;

namespace MatterFlow.Assets.Application;

/// <summary>An Asset Type with its form status.</summary>
/// <param name="AssetTypeId">Internal id.</param>
/// <param name="Name">Unique name.</param>
/// <param name="Description">Optional description.</param>
/// <param name="SortOrder">Position in pickers and lists.</param>
/// <param name="IsActive">An inactive type cannot be chosen for new Assets; existing Assets keep it.</param>
/// <param name="AssetCount">Number of Assets of this type (retired ones included). Null, not 0, when the viewer lacks <c>Asset.View</c> (a type manager may read the type without seeing Assets).</param>
/// <param name="PublishedFormVersionId">The published version of the type's field form, if any.</param>
/// <param name="PublishedFormVersionNo">Its version number, if any.</param>
/// <param name="RowVersion">Concurrency token (base64); send it back on update.</param>
/// <param name="CreatedAtUtc">When the type was created (UTC).</param>
/// <param name="ModifiedAtUtc">When the type was last changed (UTC), if ever.</param>
/// <param name="FieldCount">Fields of the published version of the type's form (#627); null when no version is published.</param>
/// <param name="PublishedAtUtc">When that version was published (UTC); null when none is published.</param>
/// <param name="DraftVersionNo">Number of the open draft of the form; null when there is none.</param>
/// <param name="SizeFieldKey">Key of the NUMBER field of the published form that means size (the default for the Data tab and reports); null when none is designated.</param>
/// <param name="SizeUnit">Unit of that field: B, KB, MB, GB, TB or Items; null together with <paramref name="SizeFieldKey"/>.</param>
public sealed record AssetTypeResponse(
    [property: Required] int AssetTypeId,
    [property: Required] string Name,
    string? Description,
    [property: Required] int SortOrder,
    [property: Required] bool IsActive,
    int? AssetCount,
    int? PublishedFormVersionId,
    int? PublishedFormVersionNo,
    [property: Required] string RowVersion,
    [property: Required] DateTime CreatedAtUtc,
    DateTime? ModifiedAtUtc,
    int? FieldCount = null,
    DateTime? PublishedAtUtc = null,
    int? DraftVersionNo = null,
    string? SizeFieldKey = null,
    string? SizeUnit = null,
    string? IconKey = null,
    string? ColourKey = null);

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

    /// <summary>An icon key of the shared library (<c>contracts/task-type-icons.json</c>); omitted = none (the client derives a default). 400 <c>UNKNOWN_ICON</c> otherwise.</summary>
    [StringLength(50)]
    public string? IconKey { get; init; }

    /// <summary>A palette name (<c>contracts/task-type-colours.json</c>); omitted = none. 400 <c>UNKNOWN_COLOUR</c> otherwise.</summary>
    [StringLength(20)]
    public string? ColourKey { get; init; }
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

    /// <summary>The icon key; null clears it (the client derives a default). 400 <c>UNKNOWN_ICON</c> when not in the library.</summary>
    [StringLength(50)]
    public string? IconKey { get; init; }

    /// <summary>The colour name; null clears it. 400 <c>UNKNOWN_COLOUR</c> when not in the palette.</summary>
    [StringLength(20)]
    public string? ColourKey { get; init; }

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

    /// <summary>Column filter: fragment of the name (same as <c>q</c>; both apply when both are given).</summary>
    [StringLength(200)]
    public string? Name { get; init; }

    /// <summary>Filter by active state.</summary>
    public bool? IsActive { get; init; }

    internal static readonly string[] Keys = ["page", "pageSize", "sort", "q", "name", "isActive"];
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

    /// <summary>Only Assets of these Asset Types (repeat the parameter: <c>assetTypeId=1&amp;assetTypeId=2</c>).</summary>
    public int[]? AssetTypeId { get; init; }

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

    /// <summary>
    /// True: only Assets of Matters the caller manages (as Primary or Secondary, see <c>role</c>); the semi-join of the "My matters" scope (epic #758). False is the same as leaving it out. A Matter
    /// without a manager is never matched. It combines with every other filter and sort; the sensitive-matter rule applies on top.
    /// </summary>
    public bool? MatterManagedByMe { get; init; }

    /// <summary><c>primary</c>, <c>secondary</c> or <c>both</c> (default): which place of the Matter the caller holds. Only with <c>matterManagedByMe=true</c> (400 otherwise).</summary>
    [StringLength(10)]
    public string? Role { get; init; }

    /// <summary>Only Assets with one of these dispositions (repeat the parameter: <c>disposition=ACTIVE&amp;disposition=PENDING_DISPOSITION</c>); an unknown code is a 400.</summary>
    public string[]? Disposition { get; init; }

    /// <summary>True: only Assets that are not Active but still linked to an open task (the warning of the Data tab); needs <c>Task.View</c> (400 without it). False is the same as leaving it out.</summary>
    public bool? InactiveLinked { get; init; }

    internal static readonly string[] Keys = ["page", "pageSize", "sort", "matterId", "assetTypeId", "isActive", "q", "name", "externalReference", "matter", "matterManagedByMe", "role", "disposition", "inactiveLinked"];
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
/// <param name="LinkedTaskCount">Every Task linked to the Asset. Null, not 0, when the viewer lacks <c>Task.View</c>; a 0 is a real 0.</param>
/// <param name="OpenLinkedTaskCount">Of those, the Tasks that are New, In Progress or On Hold (the Task Queue's open states). Null without <c>Task.View</c>.</param>
/// <param name="SizeValue">The value of the type's designated size field; null when the type has none or the asset has no value.</param>
/// <param name="SizeUnit">Its unit (B, KB, MB, GB, TB or Items); null when <paramref name="SizeValue"/> is.</param>
/// <param name="SizeBytes">The size in bytes for the size family (1 KB = 1024 B); null for Items and when there is no size.</param>
/// <param name="DispositionCode">ACTIVE, INACTIVE, PENDING_DISPOSITION or DISPOSED; <paramref name="IsActive"/> is true exactly when it is ACTIVE.</param>
/// <param name="DispositionChangedAtUtc">When the disposition last changed (UTC); null when it never did.</param>
/// <param name="InactiveLinked">True when the asset is not Active but still linked to an open task (a warning, not a rule); null without <c>Task.View</c>.</param>
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
    DateTime? ModifiedAtUtc,
    int? LinkedTaskCount = null,
    int? OpenLinkedTaskCount = null,
    decimal? SizeValue = null,
    string? SizeUnit = null,
    long? SizeBytes = null,
    [property: Required] string DispositionCode = "ACTIVE",
    DateTime? DispositionChangedAtUtc = null,
    bool? InactiveLinked = null,
    string? AssetTypeIconKey = null,
    string? AssetTypeColourKey = null);

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
/// <param name="LinkedTaskCount">Every Task linked to the Asset. Null, not 0, when the viewer lacks <c>Task.View</c>; a 0 is a real 0.</param>
/// <param name="OpenLinkedTaskCount">Of those, the Tasks that are New, In Progress or On Hold (the Task Queue's open states). Null without <c>Task.View</c>.</param>
/// <param name="MatterCanOpen">False when the caller sees this Asset only through a task assigned to them and may not open its (sensitive) Matter: the screen shows the Matter as plain text with no link.</param>
/// <param name="SizeValue">The value of the type's designated size field; null when the type has none or the asset has no value.</param>
/// <param name="SizeUnit">Its unit (B, KB, MB, GB, TB or Items); null when <paramref name="SizeValue"/> is.</param>
/// <param name="SizeBytes">The size in bytes for the size family (1 KB = 1024 B); null for Items and when there is no size.</param>
/// <param name="DispositionCode">ACTIVE, INACTIVE, PENDING_DISPOSITION or DISPOSED; <paramref name="IsActive"/> is true exactly when it is ACTIVE.</param>
/// <param name="DispositionChangedAtUtc">When the disposition last changed (UTC); null when it never did.</param>
/// <param name="DispositionChangedByName">Who changed it; null when it never changed or the person is unknown.</param>
/// <param name="DispositionNote">The note given with the last change, if any.</param>
/// <param name="InactiveLinked">True when the asset is not Active but still linked to an open task (a warning, not a rule); null without <c>Task.View</c>.</param>
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
    DateTime? ModifiedAtUtc,
    int? LinkedTaskCount = null,
    int? OpenLinkedTaskCount = null,
    [property: Required] bool MatterCanOpen = true,
    decimal? SizeValue = null,
    string? SizeUnit = null,
    long? SizeBytes = null,
    [property: Required] string DispositionCode = "ACTIVE",
    DateTime? DispositionChangedAtUtc = null,
    string? DispositionChangedByName = null,
    string? DispositionNote = null,
    bool? InactiveLinked = null,
    string? AssetTypeIconKey = null,
    string? AssetTypeColourKey = null);

/// <summary>Sets or clears the default size field of an Asset Type.</summary>
public sealed class SetAssetTypeSizeFieldRequest
{
    /// <summary>Key of a NUMBER field of the type's published form; null (with a null unit) clears the designation.</summary>
    [StringLength(64)]
    public string? SizeFieldKey { get; init; }

    /// <summary>B, KB, MB, GB, TB or Items.</summary>
    [StringLength(10)]
    public string? SizeUnit { get; init; }

    /// <summary>The <c>rowVersion</c> last read.</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

/// <summary>Outcome of rebuilding the filter index of one Asset Type's values.</summary>
/// <param name="AssetsProcessed">Number of assets whose values were re-read and re-indexed.</param>
public sealed record AssetTypeReindexResponse([property: Required] int AssetsProcessed);

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

/// <summary>Moves an Asset to another disposition. Pending disposition and Disposed need <c>Asset.Dispose</c>; Active and Inactive need <c>Asset.Edit</c>.</summary>
public sealed class ChangeAssetDispositionRequest
{
    /// <summary>ACTIVE, INACTIVE, PENDING_DISPOSITION or DISPOSED.</summary>
    [Required, StringLength(20)]
    public string DispositionCode { get; init; } = string.Empty;

    /// <summary>Why (max 500). Required for DISPOSED and for moving a disposed asset back to INACTIVE.</summary>
    [StringLength(AssetDispositionRules.MaxNoteLength)]
    public string? Note { get; init; }

    /// <summary>The <c>rowVersion</c> last read.</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

/// <summary>Moves several Assets (of any matters the caller sees) to one disposition. Each Asset is an ordinary single change with its own rules and transaction.</summary>
public sealed class BulkChangeAssetDispositionRequest
{
    public const int MaxAssets = 100;

    [Required, MinLength(1), MaxLength(MaxAssets)]
    public List<int> AssetIds { get; init; } = [];

    [Required, StringLength(20)]
    public string DispositionCode { get; init; } = string.Empty;

    [StringLength(AssetDispositionRules.MaxNoteLength)]
    public string? Note { get; init; }
}

/// <summary>The outcome of one Asset of a bulk change. <c>Code</c> is null when it worked or was already in that state.</summary>
/// <param name="AssetId">The Asset.</param>
/// <param name="Ok">True when the Asset is now in the requested disposition.</param>
/// <param name="Changed">True when this request changed it (false when it already was there).</param>
/// <param name="Code">NOT_FOUND, NOTE_REQUIRED, DISPOSED_IS_FINAL, PERMISSION_DENIED or CONCURRENCY_CONFLICT when it failed.</param>
/// <param name="Message">English detail; not part of the contract.</param>
public sealed record BulkAssetDispositionResult(
    [property: Required] int AssetId,
    [property: Required] bool Ok,
    [property: Required] bool Changed,
    string? Code,
    string? Message);

/// <summary>The per-Asset results in request order, the counts and the one correlation id that groups every audit entry of the batch. There is no undo: reverse it with another change.</summary>
public sealed record BulkAssetDispositionResponse(
    [property: Required] Guid CorrelationId,
    [property: Required] int Changed,
    [property: Required] int Unchanged,
    [property: Required] int Failed,
    [property: Required] IReadOnlyList<BulkAssetDispositionResult> Results);

/// <summary>One disposition change of an Asset.</summary>
/// <param name="AuditEventId">Event id; the list is newest first.</param>
/// <param name="OccurredAtUtc">When (UTC).</param>
/// <param name="ActorName">Who changed it; null for the system.</param>
/// <param name="FromCode">The disposition before.</param>
/// <param name="ToCode">The disposition after.</param>
/// <param name="Note">The note given, if any.</param>
public sealed record AssetDispositionChange(
    [property: Required] long AuditEventId,
    [property: Required] DateTime OccurredAtUtc,
    string? ActorName,
    [property: Required] string FromCode,
    [property: Required] string ToCode,
    string? Note);

/// <summary>The disposition history of an Asset, newest first (at most 100); readable with <c>Asset.View</c>, without the audit browser.</summary>
public sealed record AssetDispositionHistoryResponse([property: Required] IReadOnlyList<AssetDispositionChange> Items);
