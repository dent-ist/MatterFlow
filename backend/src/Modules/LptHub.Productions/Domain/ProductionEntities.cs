using LptHub.SharedKernel.Entities;

namespace LptHub.Productions.Domain;

/// <summary>Lifecycle of a <see cref="ProductionSpec"/>: Active specs can be chosen for productions, Retired ones stay on the productions that already use them.</summary>
public static class SpecStatus
{
    public const string Active = "Active";
    public const string Retired = "Retired";

    public static readonly string[] All = [Active, Retired];
}

/// <summary>Direction of a <see cref="Production"/>: produced by us (OUT) or received from another party (IN).</summary>
public static class ProductionDirection
{
    public const string Out = "OUT";
    public const string In = "IN";

    public static readonly string[] All = [Out, In];
}

/// <summary>
/// The agreed format of productions of one matter (images, text, natives, load file, metadata fields, redaction, privilege, de-duplication, dates, numbering, delivery).
/// Fixed to its matter at create, never deleted: retiring keeps it on the productions that use it. Changes are written to the audit trail by the application (object type
/// ProductionSpec), not by the field interceptor, so a created spec is one event instead of one per field.
/// </summary>
public class ProductionSpec : AuditedEntity<int>
{
    public int MatterId { get; set; }

    public string Name { get; set; } = string.Empty;

    public string StatusCode { get; set; } = SpecStatus.Active;

    public string? SourceOfAgreement { get; set; }

    public string? Description { get; set; }

    public string? ImageFormat { get; set; }

    public string? ColourMode { get; set; }

    public string? TextMode { get; set; }

    public string? NativesRule { get; set; }

    public string? LoadFile { get; set; }

    /// <summary>JSON array of the metadata field names in the load file (null = none chosen).</summary>
    public string? MetadataFieldsJson { get; set; }

    public string? RedactionRule { get; set; }

    public string? PrivilegeRule { get; set; }

    public string? DedupRule { get; set; }

    public string? DateTimeRule { get; set; }

    public string? NumberingRule { get; set; }

    public string? DeliveryRule { get; set; }

    public string? Notes { get; set; }

    public bool IsRetired => StatusCode == SpecStatus.Retired;
}

/// <summary>
/// One production of a matter: a simple managed list entry (name, volume, direction, party, spec, Bates begin and end, documents, pages, delivered or due date, notes).
/// By owner decision there is no status workflow, no QC and no Bates overlap check.
/// </summary>
public class Production : AuditedEntity<int>
{
    public int MatterId { get; set; }

    public string Name { get; set; } = string.Empty;

    public string? VolumeNo { get; set; }

    public string DirectionCode { get; set; } = ProductionDirection.Out;

    public string? PartyName { get; set; }

    public int? ProductionSpecId { get; set; }

    public string? BatesBegin { get; set; }

    public string? BatesEnd { get; set; }

    public int? DocCount { get; set; }

    public int? PageCount { get; set; }

    public DateOnly? DeliveredOrDueOn { get; set; }

    public string? Notes { get; set; }
}

/// <summary>A comment on a production. <see cref="MatterId"/> repeats the production's matter so the sensitive-matter rule needs no join.</summary>
public class ProductionComment : AuditedEntity<int>
{
    public int ProductionId { get; set; }

    public int MatterId { get; set; }

    public string Body { get; set; } = string.Empty;
}
