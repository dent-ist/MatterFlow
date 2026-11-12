using System.ComponentModel.DataAnnotations;

namespace LptHub.Vendors.Application;

/// <summary>A chosen item of the Services or Areas list as a vendor shows it.</summary>
/// <param name="Id">Item id.</param>
/// <param name="Name">Display name.</param>
/// <param name="IsActive">False for a deactivated item: it still shows on vendors that already have it but is not offered for new choices.</param>
public sealed record VendorOptionRef(
    [property: Required] int Id,
    [property: Required] string Name,
    [property: Required] bool IsActive);

/// <summary>A vendor with its lists and counts, for the Vendors list and the vendor dialog.</summary>
/// <param name="VendorId">Vendor id.</param>
/// <param name="Name">Vendor name (unique, any case).</param>
/// <param name="Website">Website address, or null.</param>
/// <param name="Category"><c>PREFERRED</c> or <c>BLACKLISTED</c>.</param>
/// <param name="Note">Free-text note, or null.</param>
/// <param name="Services">Services chosen for the vendor, in list order.</param>
/// <param name="Areas">Areas chosen for the vendor, in list order.</param>
/// <param name="TechAi">AI systems or services the vendor uses, in the order entered.</param>
/// <param name="ContactCount">People linked to the vendor as contacts.</param>
/// <param name="DoNotHireCount">Contacts flagged <c>DO_NOT_HIRE</c> (the list shows a warning when above 0).</param>
/// <param name="MatterCount">Matters linked to the vendor that the caller may see (a sensitive matter the caller cannot see is not counted).</param>
/// <param name="ModifiedAt">When the vendor record was last changed (UTC).</param>
/// <param name="RowVersion">Optimistic-concurrency token (base64); send it back on update.</param>
public sealed record VendorResponse(
    [property: Required] int VendorId,
    [property: Required] string Name,
    string? Website,
    [property: Required] string Category,
    string? Note,
    [property: Required] IReadOnlyList<VendorOptionRef> Services,
    [property: Required] IReadOnlyList<VendorOptionRef> Areas,
    [property: Required] IReadOnlyList<string> TechAi,
    [property: Required] int ContactCount,
    [property: Required] int DoNotHireCount,
    [property: Required] int MatterCount,
    [property: Required] DateTime ModifiedAt,
    [property: Required] string RowVersion);

/// <summary>A vendor as the combobox offers it (and the matter Vendors panel shows it).</summary>
/// <param name="VendorId">Vendor id.</param>
/// <param name="Name">Vendor name.</param>
/// <param name="Website">Website address, or null.</param>
/// <param name="Category"><c>PREFERRED</c> or <c>BLACKLISTED</c>: a Blacklisted vendor is never hidden, the screen warns and asks for a confirming tick when it is linked.</param>
/// <param name="Services">Names of the vendor's services.</param>
/// <param name="HasDoNotHireContact">True when a contact of the vendor is flagged Do Not Hire.</param>
public sealed record VendorLookupItem(
    [property: Required] int VendorId,
    [property: Required] string Name,
    string? Website,
    [property: Required] string Category,
    [property: Required] IReadOnlyList<string> Services,
    [property: Required] bool HasDoNotHireContact);

/// <summary>Body to create a vendor.</summary>
public sealed class CreateVendorRequest
{
    /// <summary>Vendor name, 1 to 200 characters, unique in any case.</summary>
    [Required, StringLength(200)]
    public string Name { get; init; } = string.Empty;

    /// <summary>Website address (http or https; a bare address such as <c>example.com</c> is stored as typed), at most 300 characters.</summary>
    [StringLength(300)]
    public string? Website { get; init; }

    /// <summary><c>PREFERRED</c> or <c>BLACKLISTED</c>.</summary>
    [Required, StringLength(12)]
    public string Category { get; init; } = string.Empty;

    /// <summary>Free-text note, at most 2000 characters.</summary>
    [StringLength(2000)]
    public string? Note { get; init; }

    /// <summary>Ids of the Services list items (active ones; a deactivated item the vendor already has may stay).</summary>
    public IReadOnlyList<int>? ServiceIds { get; init; }

    /// <summary>Ids of the Areas list items.</summary>
    public IReadOnlyList<int>? AreaIds { get; init; }

    /// <summary>AI systems or services the vendor uses, at most 30, each up to 200 characters; duplicates (any case) are ignored.</summary>
    public IReadOnlyList<string>? TechAi { get; init; }
}

/// <summary>Body to replace the data of a vendor (the full value: omitted lists are cleared).</summary>
public sealed class UpdateVendorRequest
{
    /// <summary>Vendor name, 1 to 200 characters, unique in any case.</summary>
    [Required, StringLength(200)]
    public string Name { get; init; } = string.Empty;

    /// <summary>Website address, at most 300 characters; null clears it.</summary>
    [StringLength(300)]
    public string? Website { get; init; }

    /// <summary><c>PREFERRED</c> or <c>BLACKLISTED</c>.</summary>
    [Required, StringLength(12)]
    public string Category { get; init; } = string.Empty;

    /// <summary>Free-text note, at most 2000 characters; null clears it.</summary>
    [StringLength(2000)]
    public string? Note { get; init; }

    /// <summary>Ids of the Services list items; the full selection.</summary>
    public IReadOnlyList<int>? ServiceIds { get; init; }

    /// <summary>Ids of the Areas list items; the full selection.</summary>
    public IReadOnlyList<int>? AreaIds { get; init; }

    /// <summary>AI systems or services the vendor uses; the full list.</summary>
    public IReadOnlyList<string>? TechAi { get; init; }

    /// <summary>The row version last read (base64).</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

/// <summary>A person at a vendor with the flag, who reported it, when, and the note.</summary>
/// <param name="ContactId">Contact id.</param>
/// <param name="VendorId">Vendor id.</param>
/// <param name="PersonId">The person in the People list.</param>
/// <param name="PersonName">First and last name.</param>
/// <param name="PersonType"><c>INTERNAL</c> or <c>EXTERNAL</c>.</param>
/// <param name="PersonTitle">Title or role, or null.</param>
/// <param name="PersonEmail">E-mail address, or null.</param>
/// <param name="PersonCompany">Company name of an external person, or null.</param>
/// <param name="PersonIsActive">False once the person is deactivated in People (the contact stays).</param>
/// <param name="Flag"><c>NONE</c> (No note), <c>RECOMMENDED</c> or <c>DO_NOT_HIRE</c>.</param>
/// <param name="ReportedOn">Date the flag was reported; null when the flag is <c>NONE</c>.</param>
/// <param name="ReportedByUserId">User who reported it; null when the flag is <c>NONE</c>.</param>
/// <param name="ReportedByName">Name of that user.</param>
/// <param name="Note">Note about the flag, or null.</param>
/// <param name="RowVersion">Optimistic-concurrency token (base64).</param>
public sealed record VendorContactResponse(
    [property: Required] int ContactId,
    [property: Required] int VendorId,
    [property: Required] int PersonId,
    [property: Required] string PersonName,
    [property: Required] string PersonType,
    string? PersonTitle,
    string? PersonEmail,
    string? PersonCompany,
    [property: Required] bool PersonIsActive,
    [property: Required] string Flag,
    DateOnly? ReportedOn,
    int? ReportedByUserId,
    string? ReportedByName,
    string? Note,
    [property: Required] string RowVersion);

/// <summary>Body to add a person from People as a contact of a vendor.</summary>
public sealed class CreateVendorContactRequest
{
    /// <summary>An active person of the People list.</summary>
    [Range(1, int.MaxValue)]
    public int PersonId { get; init; }

    /// <summary><c>NONE</c> (default), <c>RECOMMENDED</c> or <c>DO_NOT_HIRE</c>.</summary>
    [StringLength(12)]
    public string? Flag { get; init; }

    /// <summary>Date reported; required with a flag other than <c>NONE</c>, not in the future.</summary>
    public DateOnly? ReportedOn { get; init; }

    /// <summary>Note about the flag, at most 2000 characters; only with a flag other than <c>NONE</c>.</summary>
    [StringLength(2000)]
    public string? Note { get; init; }
}

/// <summary>Body to change the flag, date and note of a contact. The person cannot be changed (remove the contact and add another).</summary>
public sealed class UpdateVendorContactRequest
{
    /// <summary><c>NONE</c>, <c>RECOMMENDED</c> or <c>DO_NOT_HIRE</c>. Changing the flag makes the caller the reporter.</summary>
    [Required, StringLength(12)]
    public string Flag { get; init; } = string.Empty;

    /// <summary>Date reported; required with a flag other than <c>NONE</c>, not in the future.</summary>
    public DateOnly? ReportedOn { get; init; }

    /// <summary>Note about the flag, at most 2000 characters; cleared with the flag <c>NONE</c>.</summary>
    [StringLength(2000)]
    public string? Note { get; init; }

    /// <summary>The row version last read (base64).</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

/// <summary>A matter linked to a vendor, as the vendor's Matters tab shows it.</summary>
/// <param name="MatterId">Matter id.</param>
/// <param name="MatterRef">Display reference such as <c>00343-00012</c>.</param>
/// <param name="MatterName">Matter name.</param>
/// <param name="ClientName">Name of the matter's client, or null.</param>
/// <param name="IsActive">False for an inactive matter.</param>
/// <param name="LinkedAt">When the vendor was linked (UTC).</param>
/// <param name="LinkedByName">Who linked it, or null.</param>
public sealed record VendorMatterResponse(
    [property: Required] int MatterId,
    [property: Required] string MatterRef,
    [property: Required] string MatterName,
    string? ClientName,
    [property: Required] bool IsActive,
    [property: Required] DateTime LinkedAt,
    string? LinkedByName);

/// <summary>A vendor linked to a matter, as the matter's Vendors panel shows it.</summary>
/// <param name="VendorId">Vendor id.</param>
/// <param name="Name">Vendor name.</param>
/// <param name="Website">Website address, or null.</param>
/// <param name="Category"><c>PREFERRED</c> or <c>BLACKLISTED</c>.</param>
/// <param name="Services">Names of the vendor's services.</param>
/// <param name="HasDoNotHireContact">True when a contact of the vendor is flagged Do Not Hire.</param>
/// <param name="LinkedAt">When the vendor was linked (UTC).</param>
/// <param name="LinkedByName">Who linked it, or null.</param>
public sealed record MatterVendorResponse(
    [property: Required] int VendorId,
    [property: Required] string Name,
    string? Website,
    [property: Required] string Category,
    [property: Required] IReadOnlyList<string> Services,
    [property: Required] bool HasDoNotHireContact,
    [property: Required] DateTime LinkedAt,
    string? LinkedByName);

/// <summary>Body to link a vendor to a matter.</summary>
public sealed class LinkVendorRequest
{
    /// <summary>The vendor to link.</summary>
    [Range(1, int.MaxValue)]
    public int VendorId { get; init; }

    /// <summary>Must be true to link a <c>BLACKLISTED</c> vendor (the "I have read this and still want to link it" tick); 409 <c>VENDOR_BLACKLISTED_CONFIRMATION_REQUIRED</c> otherwise.</summary>
    public bool ConfirmBlacklisted { get; init; }
}

/// <summary>An item of the Services or Areas list for the admin screens and the vendor form.</summary>
/// <param name="Id">Item id.</param>
/// <param name="Name">Display name (unique within the list, any case).</param>
/// <param name="SortOrder">Position in pickers.</param>
/// <param name="IsActive">False = not offered for new choices; vendors that already have it, and history, keep showing it.</param>
/// <param name="RowVersion">Optimistic-concurrency token (base64); send it back on update.</param>
/// <param name="InUseCount">Vendors that carry the item. Only an item with 0 can be deleted.</param>
public sealed record VendorOptionView(
    [property: Required] int Id,
    [property: Required] string Name,
    [property: Required] int SortOrder,
    [property: Required] bool IsActive,
    [property: Required] string RowVersion,
    [property: Required] int InUseCount);

/// <summary>Body to add an item to the Services or Areas list (appended at the end).</summary>
public sealed record CreateVendorOptionRequest([Required, StringLength(100)] string Name, bool IsActive = true);

/// <summary>Body to rename, activate or deactivate an item of the Services or Areas list.</summary>
public sealed record UpdateVendorOptionRequest(
    [Required, StringLength(100)] string Name,
    [Required] bool IsActive,
    [Required] string RowVersion);

/// <summary>Body to set the order of the Services or Areas list: every item exactly once.</summary>
public sealed record ReorderVendorOptionsRequest([Required] IReadOnlyList<int> Ids);
