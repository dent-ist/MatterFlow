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
}

/// <summary>
/// A rich-text note of a matter. <see cref="BodyHtml"/> is the sanitised html (the only form that is stored or returned); <see cref="Title"/> is the first line of it and
/// <see cref="Snippet"/> the text after. Locked notes are read only for everybody. Changes are written to the audit trail by the application (object type Note).
/// </summary>
public class Note : AuditedEntity<int>
{
    public int MatterId { get; set; }

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
