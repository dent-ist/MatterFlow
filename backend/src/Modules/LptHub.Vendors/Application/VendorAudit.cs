using LptHub.Audit.Contracts;

namespace LptHub.Vendors.Application;

/// <summary>Event codes the Vendors module writes (the generic field events of the vendor and contact records are written by the Data layer).</summary>
public static class VendorAuditEvents
{
    /// <summary>The services chosen for a vendor changed (field key <c>Services</c>; old and new value are the names).</summary>
    public const string ServicesChanged = "VENDOR_SERVICES_CHANGED";

    /// <summary>The areas chosen for a vendor changed (field key <c>Areas</c>).</summary>
    public const string AreasChanged = "VENDOR_AREAS_CHANGED";

    /// <summary>The Tech AI list of a vendor changed (field key <c>TechAi</c>).</summary>
    public const string TechAiChanged = "VENDOR_TECH_AI_CHANGED";

    /// <summary>A vendor was linked to a matter. Scoped to the matter (sensitive-matter rule); object type <c>Vendor</c>, new value is the vendor name.</summary>
    public const string Linked = "VENDOR_LINKED";

    /// <summary>A vendor was unlinked from a matter. Scoped to the matter; old value is the vendor name.</summary>
    public const string Unlinked = "VENDOR_UNLINKED";
}

/// <summary>Builds the explicit audit entries about vendors. These are administration records without a matter; the entries that concern a matter (link, unlink) are written by <c>VendorMatterService</c> with the matter.</summary>
internal static class VendorAudit
{
    public static AuditEntry About(string eventType, Func<string> vendorId, string? fieldKey, string? oldValue, string? newValue, string? summary = null) =>
        new AuditEntry
        {
            EventType = eventType,
            ObjectType = "Vendor",
            ObjectIdFactory = vendorId,
            FieldKey = fieldKey,
            OldValue = Truncate(oldValue),
            NewValue = Truncate(newValue),
            Summary = summary,
        };

    private static string? Truncate(string? value) => value is { Length: > 500 } ? value[..500] : value;
}
