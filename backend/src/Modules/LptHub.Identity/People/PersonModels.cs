using System.ComponentModel.DataAnnotations;

namespace LptHub.Identity.People;

/// <summary>A person of the shared People list.</summary>
/// <param name="PersonId">Person id.</param>
/// <param name="FirstName">First name.</param>
/// <param name="LastName">Last name; may be empty for a system user whose display name is one word.</param>
/// <param name="DisplayName">First and last name together, for lists and pickers.</param>
/// <param name="PersonType"><c>INTERNAL</c> or <c>EXTERNAL</c>.</param>
/// <param name="Title">Title or role (for example Partner).</param>
/// <param name="Email">E-mail address, if known.</param>
/// <param name="Comments">Free comments.</param>
/// <param name="CompanyName">External company name; always null for an internal person.</param>
/// <param name="UserId">The linked user of a system-user person, otherwise null. First name, last name, e-mail and type of such a person cannot be changed here (change the user).</param>
/// <param name="IsSystemUser">True when the person is linked to a user (read-only name, e-mail and type; it cannot be deactivated here).</param>
/// <param name="UserIsActive">For a system-user person: whether the user is active (the person stays when the user is deactivated); otherwise null.</param>
/// <param name="IsActive">False once deactivated (people are never deleted).</param>
/// <param name="RowVersion">Concurrency token (base64); send it back on update.</param>
public sealed record PersonDto(
    [property: Required] int PersonId,
    [property: Required] string FirstName,
    [property: Required] string LastName,
    [property: Required] string DisplayName,
    [property: Required] string PersonType,
    string? Title,
    string? Email,
    string? Comments,
    string? CompanyName,
    int? UserId,
    [property: Required] bool IsSystemUser,
    bool? UserIsActive,
    [property: Required] bool IsActive,
    [property: Required] string RowVersion);

/// <summary>A person in a picker: compact, for the Team and vendor-contact comboboxes.</summary>
/// <param name="PersonId">Person id.</param>
/// <param name="DisplayName">First and last name together.</param>
/// <param name="PersonType"><c>INTERNAL</c> or <c>EXTERNAL</c>.</param>
/// <param name="Title">Title or role.</param>
/// <param name="Email">E-mail address, if known.</param>
/// <param name="CompanyName">External company name.</param>
/// <param name="UserId">The linked user of a system-user person, otherwise null.</param>
/// <param name="IsSystemUser">True when the person is linked to a user.</param>
public sealed record PersonLookupItem(
    [property: Required] int PersonId,
    [property: Required] string DisplayName,
    [property: Required] string PersonType,
    string? Title,
    string? Email,
    string? CompanyName,
    int? UserId,
    [property: Required] bool IsSystemUser);

/// <summary>A person that resembles the one being typed.</summary>
/// <param name="Person">The existing person.</param>
/// <param name="IsActive">False for a deactivated person (still shown: reactivate it instead of adding a second one).</param>
/// <param name="Reason"><c>SAME_EMAIL</c>, <c>SAME_NAME</c> (same words, in either order) or <c>SIMILAR_NAME</c> (a typo or two apart).</param>
public sealed record PersonSimilarItem(
    [property: Required] PersonLookupItem Person,
    [property: Required] bool IsActive,
    [property: Required] string Reason);

/// <summary>Create a person (internal without a login, or external).</summary>
public sealed record CreatePersonRequest
{
    /// <summary>First name (required, max 100).</summary>
    [Required, StringLength(100)]
    public string FirstName { get; init; } = string.Empty;

    /// <summary>Last name (required, max 100).</summary>
    [Required, StringLength(100)]
    public string LastName { get; init; } = string.Empty;

    /// <summary><c>INTERNAL</c> or <c>EXTERNAL</c> (required).</summary>
    [Required, StringLength(10)]
    public string PersonType { get; init; } = string.Empty;

    /// <summary>Title or role (max 100).</summary>
    [StringLength(100)]
    public string? Title { get; init; }

    /// <summary>E-mail address (max 254; 400 <c>INVALID_EMAIL</c> when malformed).</summary>
    [StringLength(254)]
    public string? Email { get; init; }

    /// <summary>Comments (max 2000).</summary>
    [StringLength(2000)]
    public string? Comments { get; init; }

    /// <summary>External company name (max 200); only for an <c>EXTERNAL</c> person, otherwise 400.</summary>
    [StringLength(200)]
    public string? CompanyName { get; init; }
}

/// <summary>
/// Edit a person, including deactivation and reactivation. For a system-user person the name, e-mail, type and company are ignored when they equal
/// the current values and refused (409 <c>SYSTEM_PERSON_READ_ONLY</c>) when they differ; title and comments can be edited, and the person cannot be deactivated.
/// </summary>
public sealed record UpdatePersonRequest
{
    /// <summary>First name (required, max 100).</summary>
    [Required, StringLength(200)]
    public string FirstName { get; init; } = string.Empty;

    /// <summary>Last name (max 100; required unless the person is a system user).</summary>
    [StringLength(200)]
    public string LastName { get; init; } = string.Empty;

    /// <summary><c>INTERNAL</c> or <c>EXTERNAL</c> (required).</summary>
    [Required, StringLength(10)]
    public string PersonType { get; init; } = string.Empty;

    /// <summary>Title or role (max 100).</summary>
    [StringLength(100)]
    public string? Title { get; init; }

    /// <summary>E-mail address (max 254).</summary>
    [StringLength(320)]
    public string? Email { get; init; }

    /// <summary>Comments (max 2000).</summary>
    [StringLength(2000)]
    public string? Comments { get; init; }

    /// <summary>External company name (max 200); only for an <c>EXTERNAL</c> person.</summary>
    [StringLength(200)]
    public string? CompanyName { get; init; }

    /// <summary>False deactivates the person, true reactivates it.</summary>
    [Required]
    public bool? IsActive { get; init; }

    /// <summary>The row version last read (409 <c>CONCURRENCY_CONFLICT</c> when the person changed since).</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;
}
