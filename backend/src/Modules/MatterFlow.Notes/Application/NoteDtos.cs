using System.ComponentModel.DataAnnotations;

namespace MatterFlow.Notes.Application;

/// <summary>Paging and sort parameters shared by the list endpoints of the module.</summary>
public class NoteListQueryBase
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

// ---------------------------------------------------------------- tags

/// <summary>A firm-wide note tag.</summary>
/// <param name="ColourKey">A name of the ten-colour palette; null = neutral.</param>
/// <param name="VisibleNoteCount">Notes the caller can see that carry the tag.</param>
/// <param name="IsInUse">True when any note carries it (then it can only be deactivated).</param>
public sealed record NoteTagResponse(
    [property: Required] int NoteTagId,
    [property: Required] string Name,
    string? ColourKey,
    [property: Required] bool IsActive,
    [property: Required] int VisibleNoteCount,
    [property: Required] bool IsInUse,
    [property: Required] string RowVersion);

/// <summary>A tag as shown on a note or a template.</summary>
public sealed record NoteTagRef([property: Required] int NoteTagId, [property: Required] string Name, string? ColourKey, [property: Required] bool IsActive);

/// <summary>Creates a tag (administrators).</summary>
public sealed class CreateNoteTagRequest
{
    /// <summary>Unique name (max 60).</summary>
    [Required, StringLength(60, MinimumLength = 1)]
    public string Name { get; init; } = string.Empty;

    /// <summary>A name of the ten-colour palette; omitted = neutral (400 <c>UNKNOWN_COLOUR</c> otherwise).</summary>
    [StringLength(20)]
    public string? ColourKey { get; init; }
}

/// <summary>Changes a tag (administrators).</summary>
public sealed class UpdateNoteTagRequest
{
    [Required, StringLength(60, MinimumLength = 1)]
    public string Name { get; init; } = string.Empty;

    [StringLength(20)]
    public string? ColourKey { get; init; }

    /// <summary>False hides the tag from pickers; notes keep it.</summary>
    public bool IsActive { get; init; } = true;

    /// <summary>Concurrency token (base64) last read; a stale one is a 409.</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

// ---------------------------------------------------------------- notes

/// <summary>List filters of notes.</summary>
public sealed class NoteListQuery : NoteListQueryBase
{
    /// <summary>The Matter whose notes are listed (required).</summary>
    public int? MatterId { get; init; }

    /// <summary>Only notes with one of these tags (repeat the parameter).</summary>
    public int[]? TagId { get; init; }

    /// <summary>True: only locked notes; false: only unlocked ones.</summary>
    public bool? Locked { get; init; }

    /// <summary>Fragment of the title or the text.</summary>
    [StringLength(200)]
    public string? Q { get; init; }

    internal static readonly string[] Keys = ["page", "pageSize", "sort", "matterId", "tagId", "locked", "q"];
}

/// <summary>Creates a note in an active matter.</summary>
public sealed class CreateNoteRequest
{
    /// <summary>The Matter the note belongs to; fixed from now on.</summary>
    [Required]
    public int MatterId { get; init; }

    /// <summary>The body as html; the server sanitises it and derives the title from the first line.</summary>
    [StringLength(400_000)]
    public string? BodyHtml { get; init; }

    /// <summary>At most five active tags.</summary>
    public IReadOnlyList<int>? TagIds { get; init; }
}

/// <summary>Saves a note.</summary>
public sealed class UpdateNoteRequest
{
    [StringLength(400_000)]
    public string? BodyHtml { get; init; }

    /// <summary>At most five tags; a tag that is inactive now may stay if the note already had it.</summary>
    public IReadOnlyList<int>? TagIds { get; init; }

    /// <summary>Ids of the AI policy warnings the person saw and chose to save anyway (at most 20, each at most 64 characters). Written to the note history.</summary>
    public IReadOnlyList<string>? AckWarnings { get; init; }

    /// <summary>The reasons shown in those warnings (at most 20, each at most 300 characters), for the history.</summary>
    public IReadOnlyList<string>? AckWarningReasons { get; init; }

    /// <summary>Concurrency token (base64) last read; a stale one is a 409.</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

/// <summary>Pins or unpins a note (allowed on a locked note).</summary>
public sealed class SetNotePinnedRequest
{
    public bool Pinned { get; init; }

    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

/// <summary>Locks a note.</summary>
public sealed class LockNoteRequest
{
    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

/// <summary>Unlocks a note (the person who locked it, or an administrator).</summary>
public sealed class UnlockNoteRequest
{
    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

/// <summary>A note in the list.</summary>
/// <param name="Title">The first line of the body; "Untitled note" while there is none.</param>
public sealed record NoteListItem(
    [property: Required] int NoteId,
    [property: Required] int MatterId,
    [property: Required] string Title,
    [property: Required] string Snippet,
    [property: Required] IReadOnlyList<NoteTagRef> Tags,
    [property: Required] bool IsPinned,
    [property: Required] bool IsLocked,
    int? LockedByUserId,
    string? LockedByName,
    DateTime? LockedAtUtc,
    [property: Required] DateTime UpdatedAtUtc,
    int? UpdatedByUserId,
    string? UpdatedByName,
    int? CreatedByUserId,
    string? CreatedByName);

/// <summary>A reference found in the body.</summary>
/// <param name="Kind"><c>asset</c>, <c>project</c>, <c>matter</c>, <c>note</c> or <c>user</c>.</param>
public sealed record NoteReferenceRef([property: Required] string Kind, [property: Required] int Id);

/// <summary>A note with its body.</summary>
/// <param name="BodyHtml">The sanitised html.</param>
/// <param name="References">What the body refers to (see <c>POST /notes/resolve-references</c> for names and states).</param>
/// <param name="RowVersion">Concurrency token (base64); send it back on save, pin, lock and unlock.</param>
public sealed record NoteResponse(
    [property: Required] int NoteId,
    [property: Required] int MatterId,
    [property: Required] string Title,
    [property: Required] string Snippet,
    [property: Required] string BodyHtml,
    [property: Required] IReadOnlyList<NoteTagRef> Tags,
    [property: Required] IReadOnlyList<NoteReferenceRef> References,
    [property: Required] bool IsPinned,
    [property: Required] bool IsLocked,
    int? LockedByUserId,
    string? LockedByName,
    DateTime? LockedAtUtc,
    [property: Required] DateTime CreatedAtUtc,
    int? CreatedByUserId,
    string? CreatedByName,
    [property: Required] DateTime UpdatedAtUtc,
    int? UpdatedByUserId,
    string? UpdatedByName,
    [property: Required] string RowVersion);

/// <summary>The numbers of the Notes tab.</summary>
public sealed record NoteSummaryResponse([property: Required] int NoteCount, [property: Required] int LockedCount);

// ---------------------------------------------------------------- references

/// <summary>One reference to resolve.</summary>
public sealed class NoteReferenceQuery
{
    /// <summary><c>asset</c>, <c>project</c>, <c>matter</c>, <c>note</c>, <c>embed</c> (a note shown inline) or <c>user</c>.</summary>
    [Required, StringLength(10)]
    public string Kind { get; init; } = string.Empty;

    [Required]
    public int Id { get; init; }
}

/// <summary>Resolves the references of a note for the person asking.</summary>
public sealed class ResolveNoteReferencesRequest
{
    /// <summary>The matter of the note that holds the references (assets, projects and notes of that matter resolve; others are Restricted).</summary>
    [Required]
    public int MatterId { get; init; }

    /// <summary>At most 200 references.</summary>
    [Required]
    public IReadOnlyList<NoteReferenceQuery> References { get; init; } = [];
}

/// <summary>What a reference means to the person asking.</summary>
/// <param name="State"><c>Ok</c>, <c>Inactive</c> (the asset, project or person is no longer active), <c>Restricted</c> (the person may not see it) or <c>Removed</c> (it no longer exists).</param>
/// <param name="Label">The name to show; null for Restricted and Removed.</param>
/// <param name="Detail">A short second line (the asset type, the matter reference, ...).</param>
/// <param name="BodyHtml">For <c>embed</c> only: the sanitised body of the note to show read only.</param>
public sealed record NoteReferenceResolution(
    [property: Required] string Kind,
    [property: Required] int Id,
    [property: Required] string State,
    string? Label,
    string? Detail,
    string? BodyHtml);

/// <summary>The resolved references, in the order asked.</summary>
public sealed record ResolveNoteReferencesResponse([property: Required] IReadOnlyList<NoteReferenceResolution> Items);

// ---------------------------------------------------------------- history

/// <summary>History paging: the cursor of the previous page.</summary>
public sealed class NoteHistoryQuery
{
    /// <summary>Return only events older than this event id (the <c>nextBeforeId</c> of the previous page).</summary>
    public long? BeforeId { get; init; }

    /// <summary>Events per page (default 50, max 200).</summary>
    [Range(1, 200)]
    public int Limit { get; init; } = 50;

    internal static readonly string[] Keys = ["beforeId", "limit"];
}

/// <summary>One line of the note history.</summary>
/// <param name="EventType"><c>NOTE_CREATED</c>, <c>NOTE_EDITED</c>, <c>NOTE_TAGS_CHANGED</c>, <c>NOTE_LOCKED</c>, <c>NOTE_UNLOCKED</c>, <c>NOTE_PINNED</c>, <c>NOTE_UNPINNED</c> or <c>NOTE_SAVED_AFTER_AI_WARNING</c>.</param>
/// <param name="OldValue">For tag changes: the tags before (comma separated).</param>
/// <param name="NewValue">For tag changes: the tags after; for the AI warning: the acknowledged warning ids.</param>
/// <param name="Summary">For the AI warning: the reasons shown.</param>
public sealed record NoteHistoryEntry(
    [property: Required] long AuditEventId,
    [property: Required] DateTime OccurredAtUtc,
    int? ActorUserId,
    string? ActorName,
    [property: Required] string EventType,
    string? OldValue,
    string? NewValue,
    string? Summary);

/// <summary>A page of the note history, newest first.</summary>
public sealed record NoteHistoryResponse([property: Required] IReadOnlyList<NoteHistoryEntry> Items, long? NextBeforeId);

// ---------------------------------------------------------------- templates

/// <summary>List filters of note templates.</summary>
public sealed class NoteTemplateListQuery
{
    /// <summary>The Matter whose templates are listed together with the firm-wide ones (required).</summary>
    public int? MatterId { get; init; }

    /// <summary>Fragment of the name or description.</summary>
    [StringLength(200)]
    public string? Q { get; init; }

    internal static readonly string[] Keys = ["matterId", "q"];
}

/// <summary>The fields of a template that a person edits.</summary>
public abstract class NoteTemplateInput
{
    /// <summary>Unique name (max 100).</summary>
    [Required, StringLength(100, MinimumLength = 1)]
    public string Name { get; init; } = string.Empty;

    /// <summary>What it is for (max 160).</summary>
    [StringLength(160)]
    public string? Description { get; init; }

    /// <summary>The title the first line gets; may hold <c>{{date}}</c>, <c>{{time}}</c>, <c>{{matter}}</c>, <c>{{author}}</c> or other placeholders (max 300).</summary>
    [StringLength(300)]
    public string? TitleTemplate { get; init; }

    /// <summary>The body as html with the same placeholders; sanitised by the server, references removed.</summary>
    [StringLength(400_000)]
    public string? BodyHtml { get; init; }

    /// <summary>Tags the template offers (active tags, at most five).</summary>
    public IReadOnlyList<int>? TagIds { get; init; }
}

/// <summary>Creates a template.</summary>
public sealed class CreateNoteTemplateRequest : NoteTemplateInput
{
    /// <summary><c>FIRM</c> (administrators only) or <c>MATTER</c>.</summary>
    [Required, StringLength(6)]
    public string Scope { get; init; } = string.Empty;

    /// <summary>The matter, required for <c>MATTER</c>.</summary>
    public int? MatterId { get; init; }
}

/// <summary>Changes a template; the scope and matter do not change.</summary>
public sealed class UpdateNoteTemplateRequest : NoteTemplateInput
{
    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

/// <summary>Copies a template.</summary>
public sealed class DuplicateNoteTemplateRequest
{
    /// <summary>The matter for the copy; required unless an administrator copies a firm template as firm-wide.</summary>
    public int? MatterId { get; init; }

    /// <summary>Name of the copy (max 100); omitted = "{name} (copy)".</summary>
    [StringLength(100)]
    public string? Name { get; init; }

    /// <summary>True (administrators): keep a firm template firm-wide; otherwise the copy belongs to <c>matterId</c>.</summary>
    public bool KeepFirmScope { get; init; }
}

/// <summary>A note template.</summary>
/// <param name="Scope"><c>FIRM</c> or <c>MATTER</c>.</param>
/// <param name="UsedCount">How many times it was used.</param>
/// <param name="CanEdit">True when the caller may change or delete it.</param>
public sealed record NoteTemplateResponse(
    [property: Required] int NoteTemplateId,
    [property: Required] string Scope,
    int? MatterId,
    [property: Required] string Name,
    string? Description,
    string? TitleTemplate,
    [property: Required] string BodyHtml,
    [property: Required] IReadOnlyList<NoteTagRef> Tags,
    [property: Required] int UsedCount,
    [property: Required] bool CanEdit,
    [property: Required] DateTime UpdatedAtUtc,
    int? UpdatedByUserId,
    string? UpdatedByName,
    [property: Required] string RowVersion);
