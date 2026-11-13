using LptHub.SharedKernel.Audit;
using LptHub.SharedKernel.Entities;

namespace LptHub.Vendors.Domain;

/// <summary>Stable codes of <see cref="Vendor.CategoryCode"/> (also the API values).</summary>
public static class VendorCategories
{
    public const string Preferred = "PREFERRED";

    /// <summary>A plain, unflagged vendor; the default of a new vendor (issue #1385).</summary>
    public const string Neutral = "NEUTRAL";

    public const string Blacklisted = "BLACKLISTED";

    public static readonly string[] All = [Preferred, Neutral, Blacklisted];

    public static bool IsValid(string? value) => value is Preferred or Neutral or Blacklisted;
}

/// <summary>Stable codes of <see cref="VendorContact.FlagCode"/> (also the API values): the one current opinion about a person at a vendor.</summary>
public static class ContactFlags
{
    /// <summary>No flag ("No note").</summary>
    public const string None = "NONE";

    public const string Recommended = "RECOMMENDED";

    public const string DoNotHire = "DO_NOT_HIRE";

    public static readonly string[] All = [None, Recommended, DoNotHire];

    public static bool IsValid(string? value) => value is None or Recommended or DoNotHire;
}

/// <summary>
/// A vendor (epic #1373): name, website, category (Preferred, Neutral or Blacklisted), Tech AI list, services and areas (multi-select, admin lists) and a note.
/// Field changes are audited by the generic interceptor (object type <c>Vendor</c>); changes to services, areas and Tech AI by explicit events.
/// A vendor linked to a matter cannot be deleted.
/// </summary>
[Audited(ObjectType = "Vendor")]
public class Vendor : AuditedEntity<int>
{
    public string Name { get; set; } = string.Empty;

    public string? Website { get; set; }

    /// <summary>See <see cref="VendorCategories"/>.</summary>
    public string CategoryCode { get; set; } = VendorCategories.Neutral;

    public string? Note { get; set; }
}

/// <summary>Common shape of the two vendor pick lists (Services and Areas). A used item is deactivated, never deleted.</summary>
public abstract class VendorOption : AuditedEntity<int>
{
    public string Name { get; set; } = string.Empty;

    public int SortOrder { get; set; }

    public bool IsActive { get; set; } = true;
}

/// <summary>A Service a vendor can offer (eDiscovery, Forensic, ...), maintained on the Admin Lists page.</summary>
[Audited(ObjectType = "VendorServiceOption")]
public class VendorServiceOption : VendorOption;

/// <summary>An Area a vendor works in (US, EU, ...), maintained on the Admin Lists page.</summary>
[Audited(ObjectType = "VendorAreaOption")]
public class VendorAreaOption : VendorOption;

/// <summary>One service chosen for a vendor.</summary>
public class VendorServiceChoice
{
    public int VendorId { get; set; }

    public int VendorServiceOptionId { get; set; }
}

/// <summary>One area chosen for a vendor.</summary>
public class VendorAreaChoice
{
    public int VendorId { get; set; }

    public int VendorAreaOptionId { get; set; }
}

/// <summary>One AI system or service a vendor uses (free text), in the order entered.</summary>
public class VendorTechAi
{
    public int Id { get; set; }

    public int VendorId { get; set; }

    public string Name { get; set; } = string.Empty;

    public int SortOrder { get; set; }
}

/// <summary>
/// A person of the People list at a vendor, with one current flag (None, Recommended or Do Not Hire), the date it was reported, who reported it and a note.
/// Every field change is audited by the generic interceptor (object type <c>VendorContact</c>), so an earlier flag and note stay in the history.
/// </summary>
[Audited(ObjectType = "VendorContact")]
public class VendorContact : AuditedEntity<int>
{
    public int VendorId { get; set; }

    public int PersonId { get; set; }

    /// <summary>See <see cref="ContactFlags"/>.</summary>
    public string FlagCode { get; set; } = ContactFlags.None;

    public DateOnly? ReportedOn { get; set; }

    public int? ReportedByUserId { get; set; }

    public string? Note { get; set; }
}

/// <summary>A vendor linked to a matter. Written and removed only by <c>VendorMatterService</c>, which audits both with the matter as scope.</summary>
public class VendorMatter : IAuditScoped
{
    public int VendorId { get; set; }

    public int MatterId { get; set; }

    public DateTime LinkedAtUtc { get; set; }

    public int? LinkedByUserId { get; set; }

    public int? AuditMatterId => MatterId;

    public long? AuditTaskId => null;
}
