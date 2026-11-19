using LptHub.SharedKernel.Entities;

namespace LptHub.Notes.Domain;

/// <summary>What a note can refer to. The stored codes of <c>NoteLink.TargetType</c>.</summary>
public static class NoteLinkTarget
{
    public const string Asset = "ASSET";
    public const string Project = "PROJECT";
    public const string Matter = "MATTER";
    public const string Note = "NOTE";
    public const string User = "USER";

    /// <summary>An image of the note (<c>&lt;img data-image-id&gt;</c>), id of a <see cref="NoteImage"/>. Not a reference the person sees: it only says which images a saved note uses.</summary>
    public const string Image = "IMAGE";
}

/// <summary>
/// A rich-text note of a matter. <see cref="BodyHtml"/> is the sanitised html (the only form that is stored or returned); <see cref="Title"/> is the first line of it and
/// <see cref="Snippet"/> the text after. Locked notes are read only for everybody. Changes are written to the audit trail by the application (object type Note).
/// </summary>
public class Note : AuditedEntity<int>
{
    public int MatterId { get; set; }

    /// <summary>The folder the note is in; null = "No Folder" (the top level). Always a folder of the note's own matter (composite foreign key).</summary>
    public int? FolderId { get; set; }

    public string Title { get; set; } = string.Empty;

    public string Snippet { get; set; } = string.Empty;

    public string BodyHtml { get; set; } = string.Empty;

    /// <summary>The visible text of <see cref="BodyHtml"/>, for search.</summary>
    public string BodyText { get; set; } = string.Empty;

    public bool IsPinned { get; set; }

    public int? LockedByUserId { get; set; }

    public DateTime? LockedAtUtc { get; set; }

    /// <summary>"Last updated": the last save of content, title or tags (not a pin or a lock).</summary>
    public DateTime ContentUpdatedAtUtc { get; set; }

    public int? ContentUpdatedByUserId { get; set; }

    public bool IsLocked => LockedByUserId is not null;
}

/// <summary>
/// A folder of a matter's notes. Folders nest (up to <see cref="NoteFolderRules.MaxDepth"/> levels, <see cref="NoteFolderRules.MaxPerMatter"/> per matter); a name is unique inside its parent.
/// A note is in one folder or none. Folders have no access list of their own: they follow the matter.
/// </summary>
public class NoteFolder : AuditedEntity<int>
{
    public int MatterId { get; set; }

    /// <summary>Null for a top-level folder.</summary>
    public int? ParentFolderId { get; set; }

    public string Name { get; set; } = string.Empty;
}

/// <summary>
/// An image pasted into a note: PNG or JPEG bytes (at most 2 MB, 8,000 px on a side) stored in the database, owned by the matter, outside the note body. The body holds <c>&lt;img data-image-id&gt;</c>;
/// which notes use the image is the <see cref="NoteLink"/> rows of type <see cref="NoteLinkTarget.Image"/>. An image nothing refers to is "pending" (uploaded, not saved yet) and is deleted by the
/// save that drops its last reference, by Cancel (<c>DELETE</c>), with its note, or by the nightly crash sweep after 48 hours.
/// </summary>
public class NoteImage : Entity<int>
{
    public int MatterId { get; set; }

    /// <summary><c>image/png</c> or <c>image/jpeg</c>, found by the bytes, never by what the client declared.</summary>
    public string ContentType { get; set; } = string.Empty;

    public int Width { get; set; }

    public int Height { get; set; }

    public int ByteSize { get; set; }

    /// <summary>SHA-256 of <see cref="Content"/>; the ETag of the read endpoint.</summary>
    public byte[] ContentSha256 { get; set; } = [];

    /// <summary>The image bytes. Never selected by list queries.</summary>
    public byte[] Content { get; set; } = [];

    public DateTime UploadedAtUtc { get; set; }

    public int? UploadedByUserId { get; set; }
}

/// <summary>A firm-wide tag an administrator manages; people only pick them. Deactivated, not deleted, once used.</summary>
public class NoteTag : AuditedEntity<int>
{
    public string Name { get; set; } = string.Empty;

    /// <summary>A name of the ten-colour palette (<c>contracts/task-type-colours.json</c>); null = neutral.</summary>
    public string? ColourKey { get; set; }

    public bool IsActive { get; set; } = true;
}

/// <summary>A tag on a note.</summary>
public class NoteTagLink
{
    public int NoteId { get; set; }

    public int NoteTagId { get; set; }
}

/// <summary>What a note refers to, rebuilt from the saved body.</summary>
public class NoteLink
{
    public int NoteId { get; set; }

    public string TargetType { get; set; } = string.Empty;

    public int TargetId { get; set; }
}

/// <summary>Scope of a <see cref="NoteTemplate"/>.</summary>
public static class TemplateScope
{
    /// <summary>System Level: every matter (was "firm-wide").</summary>
    public const string System = "SYSTEM";

    /// <summary>Client Level: every matter of one client.</summary>
    public const string Client = "CLIENT";

    /// <summary>Matter Level: one matter.</summary>
    public const string Matter = "MATTER";
}

/// <summary>A starting text for a note at System Level (administrators), Client Level (Client.Edit holders) or Matter Level. Using it copies it: no link is kept.</summary>
public class NoteTemplate : AuditedEntity<int>
{
    public string ScopeCode { get; set; } = TemplateScope.Matter;

    public int? MatterId { get; set; }

    /// <summary>Set for a Client Level template.</summary>
    public int? ClientId { get; set; }

    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }

    public string? TitleTemplate { get; set; }

    public string BodyHtml { get; set; } = string.Empty;

    public int UsedCount { get; set; }
}

/// <summary>A tag a template offers.</summary>
public class NoteTemplateTag
{
    public int NoteTemplateId { get; set; }

    public int NoteTagId { get; set; }
}
