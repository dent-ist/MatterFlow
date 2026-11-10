using System.ComponentModel.DataAnnotations;

namespace LptHub.Productions.Application;

/// <summary>Paging and sort parameters shared by the list endpoints of the module.</summary>
public class ProductionListQueryBase
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

// ---------------------------------------------------------------- production specs

/// <summary>List filters of production specs.</summary>
public sealed class ProductionSpecListQuery : ProductionListQueryBase
{
    /// <summary>The Matter whose specs are listed (required).</summary>
    public int? MatterId { get; init; }

    /// <summary><c>Active</c> or <c>Retired</c>; omitted = both.</summary>
    [StringLength(10)]
    public string? Status { get; init; }

    /// <summary>Fragment of the name, the source of the agreement or the description.</summary>
    [StringLength(200)]
    public string? Q { get; init; }

    internal static readonly string[] Keys = ["page", "pageSize", "sort", "matterId", "status", "q"];
}

/// <summary>The fields of a production spec that a person edits (create and update share them).</summary>
public abstract class ProductionSpecInput
{
    /// <summary>Spec name (max 200); unique among the active specs of the matter.</summary>
    [Required, StringLength(200, MinimumLength = 1)]
    public string Name { get; init; } = string.Empty;

    /// <summary>Where the agreement comes from: court order, ESI protocol, email (max 300).</summary>
    [StringLength(300)]
    public string? SourceOfAgreement { get; init; }

    /// <summary>What the spec is for (max 1000).</summary>
    [StringLength(1000)]
    public string? Description { get; init; }

    /// <summary>Image format, for example TIFF (Group IV, 300 dpi) (max 100).</summary>
    [StringLength(100)]
    public string? ImageFormat { get; init; }

    /// <summary>Colour handling (max 100).</summary>
    [StringLength(100)]
    public string? ColourMode { get; init; }

    /// <summary>Text handling, for example extracted text, OCR when none (max 100).</summary>
    [StringLength(100)]
    public string? TextMode { get; init; }

    /// <summary>Which files are produced natively (max 300).</summary>
    [StringLength(300)]
    public string? NativesRule { get; init; }

    /// <summary>Load file format, for example DAT + OPT (max 100).</summary>
    [StringLength(100)]
    public string? LoadFile { get; init; }

    /// <summary>Metadata field names in the load file (at most 100, each at most 100 characters; duplicates are dropped).</summary>
    public IReadOnlyList<string>? MetadataFields { get; init; }

    /// <summary>Redaction rule (max 300).</summary>
    [StringLength(300)]
    public string? RedactionRule { get; init; }

    /// <summary>Privilege rule (max 300).</summary>
    [StringLength(300)]
    public string? PrivilegeRule { get; init; }

    /// <summary>De-duplication rule (max 200).</summary>
    [StringLength(200)]
    public string? DedupRule { get; init; }

    /// <summary>Date and time format and zone (max 200).</summary>
    [StringLength(200)]
    public string? DateTimeRule { get; init; }

    /// <summary>Numbering rule (max 200).</summary>
    [StringLength(200)]
    public string? NumberingRule { get; init; }

    /// <summary>Encryption and delivery (max 300).</summary>
    [StringLength(300)]
    public string? DeliveryRule { get; init; }

    /// <summary>Free notes (max 2000).</summary>
    [StringLength(2000)]
    public string? Notes { get; init; }
}

/// <summary>Creates a production spec in an active matter.</summary>
public sealed class CreateProductionSpecRequest : ProductionSpecInput
{
    /// <summary>The Matter the spec belongs to; fixed from now on.</summary>
    [Required]
    public int MatterId { get; init; }
}

/// <summary>Updates an active production spec.</summary>
public sealed class UpdateProductionSpecRequest : ProductionSpecInput
{
    /// <summary>Concurrency token (base64) last read; a stale one is a 409.</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

/// <summary>Duplicates a production spec as a new active spec of the same matter.</summary>
public sealed class DuplicateProductionSpecRequest
{
    /// <summary>Name of the copy (max 200); omitted = "Copy of {name}", numbered when that name is taken.</summary>
    [StringLength(200)]
    public string? Name { get; init; }
}

/// <summary>Retires or reinstates a production spec.</summary>
public sealed class ChangeProductionSpecStatusRequest
{
    /// <summary>Concurrency token (base64) last read; a stale one is a 409.</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

/// <summary>A production that uses a spec (the "Used by" list of the spec panel).</summary>
public sealed record ProductionSpecUse(
    [property: Required] int ProductionId,
    [property: Required] string Name,
    string? VolumeNo,
    string? BatesBegin,
    string? BatesEnd);

/// <summary>A production spec.</summary>
/// <param name="Status"><c>Active</c> or <c>Retired</c>.</param>
/// <param name="UsedByCount">Productions of the matter that use the spec.</param>
/// <param name="UsedBy">The first productions that use it (at most 50); empty in lists.</param>
/// <param name="RowVersion">Concurrency token (base64); send it back on update.</param>
public sealed record ProductionSpecResponse(
    [property: Required] int ProductionSpecId,
    [property: Required] int MatterId,
    [property: Required] string Name,
    [property: Required] string Status,
    string? SourceOfAgreement,
    string? Description,
    string? ImageFormat,
    string? ColourMode,
    string? TextMode,
    string? NativesRule,
    string? LoadFile,
    [property: Required] IReadOnlyList<string> MetadataFields,
    string? RedactionRule,
    string? PrivilegeRule,
    string? DedupRule,
    string? DateTimeRule,
    string? NumberingRule,
    string? DeliveryRule,
    string? Notes,
    [property: Required] int UsedByCount,
    [property: Required] IReadOnlyList<ProductionSpecUse> UsedBy,
    [property: Required] string RowVersion,
    [property: Required] DateTime CreatedAtUtc,
    int? CreatedByUserId,
    string? CreatedByName,
    DateTime? ModifiedAtUtc,
    int? ModifiedByUserId,
    string? ModifiedByName);

// ---------------------------------------------------------------- productions

/// <summary>List filters of productions.</summary>
public sealed class ProductionListQuery : ProductionListQueryBase
{
    /// <summary>The Matter whose productions are listed (required).</summary>
    public int? MatterId { get; init; }

    /// <summary><c>OUT</c> (produced by us) or <c>IN</c> (received); omitted = both.</summary>
    [StringLength(3)]
    public string? Direction { get; init; }

    /// <summary>Only productions made with this spec.</summary>
    public int? ProductionSpecId { get; init; }

    /// <summary>Fragment of the name, volume, party, Bates numbers or notes.</summary>
    [StringLength(200)]
    public string? Q { get; init; }

    internal static readonly string[] Keys = ["page", "pageSize", "sort", "matterId", "direction", "productionSpecId", "q"];
}

/// <summary>The fields of a production that a person edits (create and update share them).</summary>
public abstract class ProductionInput
{
    /// <summary>Production name (max 200).</summary>
    [Required, StringLength(200, MinimumLength = 1)]
    public string Name { get; init; } = string.Empty;

    /// <summary>Volume number or label, for example VOL001 (max 50).</summary>
    [StringLength(50)]
    public string? VolumeNo { get; init; }

    /// <summary><c>OUT</c> (produced by us) or <c>IN</c> (received).</summary>
    [Required, StringLength(3)]
    public string Direction { get; init; } = string.Empty;

    /// <summary>The other party: who we produced to, or who produced to us (max 200).</summary>
    [StringLength(200)]
    public string? PartyName { get; init; }

    /// <summary>The production spec (an active spec of the same matter); none for a received production.</summary>
    public int? ProductionSpecId { get; init; }

    /// <summary>First Bates number as text, for example ABC000001 (max 50).</summary>
    [StringLength(50)]
    public string? BatesBegin { get; init; }

    /// <summary>Last Bates number as text (max 50).</summary>
    [StringLength(50)]
    public string? BatesEnd { get; init; }

    /// <summary>Documents in the production.</summary>
    [Range(0, int.MaxValue)]
    public int? DocCount { get; init; }

    /// <summary>Pages in the production.</summary>
    [Range(0, int.MaxValue)]
    public int? PageCount { get; init; }

    /// <summary>The date it was delivered or received, or is due (a calendar date).</summary>
    public DateOnly? DeliveredOrDueOn { get; init; }

    /// <summary>Free notes (max 4000).</summary>
    [StringLength(4000)]
    public string? Notes { get; init; }
}

/// <summary>Creates a production in an active matter.</summary>
public sealed class CreateProductionRequest : ProductionInput
{
    /// <summary>The Matter the production belongs to; fixed from now on.</summary>
    [Required]
    public int MatterId { get; init; }
}

/// <summary>Updates a production.</summary>
public sealed class UpdateProductionRequest : ProductionInput
{
    /// <summary>Concurrency token (base64) last read; a stale one is a 409.</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

/// <summary>A production of a matter.</summary>
/// <param name="Direction"><c>OUT</c> (produced by us) or <c>IN</c> (received).</param>
/// <param name="ProductionSpecName">Name of the spec (also when it is retired).</param>
/// <param name="ProductionSpecStatus"><c>Active</c> or <c>Retired</c> when a spec is set.</param>
/// <param name="CommentCount">Comments on the production.</param>
public sealed record ProductionResponse(
    [property: Required] int ProductionId,
    [property: Required] int MatterId,
    [property: Required] string Name,
    string? VolumeNo,
    [property: Required] string Direction,
    string? PartyName,
    int? ProductionSpecId,
    string? ProductionSpecName,
    string? ProductionSpecStatus,
    string? BatesBegin,
    string? BatesEnd,
    int? DocCount,
    int? PageCount,
    DateOnly? DeliveredOrDueOn,
    string? Notes,
    [property: Required] int CommentCount,
    [property: Required] string RowVersion,
    [property: Required] DateTime CreatedAtUtc,
    int? CreatedByUserId,
    string? CreatedByName,
    DateTime? ModifiedAtUtc,
    int? ModifiedByUserId,
    string? ModifiedByName);

/// <summary>The numbers of the Productions tab badge.</summary>
/// <param name="ProductionCount">Productions of the matter.</param>
/// <param name="SpecCount">Active specs of the matter.</param>
public sealed record ProductionSummaryResponse([property: Required] int ProductionCount, [property: Required] int SpecCount);

// ---------------------------------------------------------------- comments

/// <summary>Adds a comment to a production.</summary>
public sealed class CreateProductionCommentRequest
{
    /// <summary>Plain text (max 4000).</summary>
    [Required, StringLength(4000, MinimumLength = 1)]
    public string Body { get; init; } = string.Empty;
}

/// <summary>Edits a comment of one's own.</summary>
public sealed class UpdateProductionCommentRequest
{
    /// <summary>Plain text (max 4000).</summary>
    [Required, StringLength(4000, MinimumLength = 1)]
    public string Body { get; init; } = string.Empty;

    /// <summary>Concurrency token (base64) last read; a stale one is a 409.</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

/// <summary>A comment on a production.</summary>
/// <param name="CanEdit">True for the author (who may edit and delete it).</param>
public sealed record ProductionCommentResponse(
    [property: Required] int ProductionCommentId,
    [property: Required] int ProductionId,
    [property: Required] string Body,
    [property: Required] DateTime CreatedAtUtc,
    int? CreatedByUserId,
    string? CreatedByName,
    DateTime? ModifiedAtUtc,
    [property: Required] bool CanEdit,
    [property: Required] string RowVersion);

// ---------------------------------------------------------------- history

/// <summary>History paging: the cursor of the previous page.</summary>
public sealed class ProductionHistoryQuery
{
    /// <summary>Return only events older than this event id (the <c>nextBeforeId</c> of the previous page).</summary>
    public long? BeforeId { get; init; }

    /// <summary>Events per page (default 50, max 200).</summary>
    [Range(1, 200)]
    public int Limit { get; init; } = 50;

    internal static readonly string[] Keys = ["beforeId", "limit"];
}

/// <summary>One line of the history: who changed what and when.</summary>
/// <param name="EventType">For example <c>FIELD_CHANGED</c>, <c>PRODUCTION_CREATED</c>, <c>PRODUCTION_COMMENT_ADDED</c>.</param>
/// <param name="FieldKey">The changed field for a field change, for example <c>BatesEnd</c>.</param>
public sealed record ProductionHistoryEntry(
    [property: Required] long AuditEventId,
    [property: Required] DateTime OccurredAtUtc,
    int? ActorUserId,
    string? ActorName,
    [property: Required] string EventType,
    string? FieldKey,
    string? OldValue,
    string? NewValue,
    string? Summary);

/// <summary>A page of history, newest first.</summary>
public sealed record ProductionHistoryResponse([property: Required] IReadOnlyList<ProductionHistoryEntry> Items, long? NextBeforeId);
