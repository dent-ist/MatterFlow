using MatterFlow.SharedKernel.Audit;
using MatterFlow.SharedKernel.Entities;

namespace MatterFlow.Assets.Domain;

/// <summary>
/// A kind of Asset (Document Set, Data Room, Source System, ...). Its own fields are the form definition of kind AssetType that is
/// created with it and edited in the form designer. Types are deactivated, not deleted.
/// </summary>
[Audited]
public class AssetType : AuditedEntity<int>
{
    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }

    public int SortOrder { get; set; }

    /// <summary>Key of the type's icon in the shared icon library (<c>contracts/task-type-icons.json</c>); null = the client derives a default from the id.</summary>
    public string? IconKey { get; set; }

    /// <summary>Name of the type's colour in the shared palette (<c>contracts/task-type-colours.json</c>); null = the client derives a default from the id.</summary>
    public string? ColourKey { get; set; }

    /// <summary>False hides the type from new Assets; existing Assets keep it.</summary>
    public bool IsActive { get; set; } = true;

    /// <summary>Key of the type's published NUMBER field that means size (the default; a project manager can pick another in a view or report). Null when none is designated.</summary>
    public string? SizeFieldKey { get; set; }

    /// <summary>Unit of that field, one of <see cref="AssetSize.Units"/>; set and cleared together with <see cref="SizeFieldKey"/>.</summary>
    public string? SizeUnit { get; set; }
}

/// <summary>
/// A thing a Matter's Tasks work on. Owned by exactly one Matter, which cannot change after create (database trigger and API rule),
/// and never hard-deleted: <see cref="IsActive"/> false is the only way to retire it, so its change history stays readable.
/// The values of the Asset Type's fields live in the forms value store under the form version captured at save time.
/// </summary>
[Audited]
public class Asset : AuditedEntity<int>, IAuditScoped
{
    public int MatterId { get; set; }

    public int AssetTypeId { get; set; }

    public string DisplayName { get; set; } = string.Empty;

    /// <summary>URL, workspace id or media label identifying the asset outside MatterFlow.</summary>
    public string? ExternalReference { get; set; }

    public string? Description { get; set; }

    /// <summary>
    /// Always equals <c>DispositionCode == Active</c> (database check <c>CK_Asset_IsActive_Disposition</c>): use <see cref="SetDisposition"/>
    /// instead of assigning it, so both columns change together.
    /// </summary>
    public bool IsActive { get; set; } = true;

    /// <summary>Retention state of the record, one of the <see cref="AssetDisposition"/> codes. Changes are written as <c>ASSET_DISPOSITION_CHANGED</c> events (from, to, note).</summary>
    [AuditExplicit]
    public string DispositionCode { get; set; } = AssetDisposition.Active;

    [AuditExplicit]
    public DateTime? DispositionChangedAtUtc { get; set; }

    [AuditExplicit]
    public int? DispositionChangedByUserId { get; set; }

    [AuditExplicit]
    public string? DispositionNote { get; set; }

    /// <summary>Sets the disposition and keeps <see cref="IsActive"/> in step (active only when the disposition is Active).</summary>
    public void SetDisposition(string code, DateTime? changedAtUtc = null, int? changedByUserId = null, string? note = null)
    {
        DispositionCode = code;
        IsActive = code == AssetDisposition.Active;
        DispositionChangedAtUtc = changedAtUtc;
        DispositionChangedByUserId = changedByUserId;
        DispositionNote = note;
    }

    int? IAuditScoped.AuditMatterId => MatterId;

    long? IAuditScoped.AuditTaskId => null;
}

/// <summary>The four disposition codes stored in the asset's <c>DispositionCode</c> column (the database check constraint lists the same values).</summary>
public static class AssetDisposition
{
    public const string Active = "ACTIVE";
    public const string Inactive = "INACTIVE";
    public const string PendingDisposition = "PENDING_DISPOSITION";
    public const string Disposed = "DISPOSED";

    public static readonly IReadOnlyList<string> All = [Active, Inactive, PendingDisposition, Disposed];

    public static bool IsValid(string? code) => code is not null && All.Contains(code);
}

/// <summary>
/// A saved asset report of the built-in report builder (epic #851, docs/ux/pm-v2-review section 9.7): only a small versioned definition, personal to
/// <see cref="OwnerUserId"/>. Each run recomputes with the viewer's current visibility; nothing here is shared or scheduled.
/// </summary>
public class AssetReport : AuditedEntity<int>
{
    public int OwnerUserId { get; set; }

    public string Name { get; set; } = string.Empty;

    /// <summary>The definition as JSON (<c>v</c> = 1), at most 4096 bytes.</summary>
    public string DefinitionJson { get; set; } = "{}";
}

/// <summary>The rules for moving an asset between dispositions (docs/ux/pm-v2-review section 9.1, decisions addendum section AN).</summary>
public static class AssetDispositionRules
{
    /// <summary>The event type of a disposition change in the audit trail (field key <c>disposition</c>, old and new value are the codes, the summary is the note).</summary>
    public const string ChangedEvent = "ASSET_DISPOSITION_CHANGED";

    public const int MaxNoteLength = 500;

    public const string InvalidCode = "INVALID_DISPOSITION";
    public const string NoteRequiredCode = "NOTE_REQUIRED";
    public const string DisposedIsFinalCode = "DISPOSED_IS_FINAL";
    public const string NeedsDisposeCode = "PERMISSION_DENIED";

    /// <summary>The outcome of a check: null means the move is allowed.</summary>
    public sealed record Refusal(string Code, string Field, string Message, bool Forbidden = false, bool Conflict = false);

    /// <summary>True when the target is a retention state that needs <c>Asset.Dispose</c> (Pending disposition and Disposed).</summary>
    public static bool NeedsDispose(string target) => target is AssetDisposition.PendingDisposition or AssetDisposition.Disposed;

    /// <summary>
    /// Whether an asset may move from <paramref name="from"/> to <paramref name="to"/>. Any of Active, Inactive and Pending disposition can move to any other.
    /// Moving to Pending disposition or Disposed needs <c>Asset.Dispose</c>, moving to Active or Inactive needs <c>Asset.Edit</c>. Disposed is final except for a holder of
    /// <c>Asset.Dispose</c>, who can move it back to Inactive as a correction. A note is required for Disposed and for that correction. Moving to the state it is in is allowed (nothing changes).
    /// </summary>
    public static Refusal? Check(string from, string to, bool canEdit, bool canDispose, string? note)
    {
        if (!AssetDisposition.IsValid(to))
            return new Refusal(InvalidCode, "dispositionCode", "The disposition must be ACTIVE, INACTIVE, PENDING_DISPOSITION or DISPOSED.");
        if (note is { Length: > MaxNoteLength })
            return new Refusal("TOO_LONG", "note", $"The note can have at most {MaxNoteLength} characters.");
        if (from == to)
            return null;

        if (from == AssetDisposition.Disposed)
        {
            if (to != AssetDisposition.Inactive)
                return new Refusal(DisposedIsFinalCode, "dispositionCode", "A disposed asset can only be moved back to Inactive, as a correction.", Conflict: true);
            if (!canDispose)
                return new Refusal(NeedsDisposeCode, "dispositionCode", "Moving a disposed asset back needs the permission to dispose assets.", Forbidden: true);

            return string.IsNullOrWhiteSpace(note) ? new Refusal(NoteRequiredCode, "note", "Say why the disposal is corrected.") : null;
        }

        if (NeedsDispose(to))
        {
            if (!canDispose)
                return new Refusal(NeedsDisposeCode, "dispositionCode", "Moving an asset to Pending disposition or Disposed needs the permission to dispose assets.", Forbidden: true);

            return to == AssetDisposition.Disposed && string.IsNullOrWhiteSpace(note) ? new Refusal(NoteRequiredCode, "note", "Say why the asset is disposed.") : null;
        }

        return canEdit ? null : new Refusal(NeedsDisposeCode, "dispositionCode", "Changing an asset needs the permission to edit assets.", Forbidden: true);
    }
}
