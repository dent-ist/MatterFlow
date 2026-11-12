using LptHub.SharedKernel.Audit;
using LptHub.SharedKernel.Entities;

namespace LptHub.Identity.Domain;

/// <summary>Stable codes of <see cref="Person.PersonType"/> (also the API values).</summary>
public static class PersonTypes
{
    public const string Internal = "INTERNAL";

    public const string External = "EXTERNAL";

    public static bool IsValid(string? value) => value is Internal or External;
}

/// <summary>
/// A person in the shared People list (epic #1373), used by the matter Team and by vendor contacts. Internal people work at the firm, external people
/// elsewhere (<see cref="CompanyName"/>). Every user has one linked person (<see cref="UserId"/>): its name and e-mail are kept in step with the user by
/// <c>PersonUserSyncInterceptor</c>, in the same transaction, and it stays when the user is deactivated. People are deactivated, never deleted.
/// </summary>
[Audited(ObjectType = "Person")]
public class Person : AuditedEntity<int>
{
    public string FirstName { get; set; } = string.Empty;

    /// <summary>May be empty (a user whose display name is a single word).</summary>
    public string LastName { get; set; } = string.Empty;

    /// <summary>See <see cref="PersonTypes"/>.</summary>
    public string PersonType { get; set; } = PersonTypes.Internal;

    /// <summary>Title or role, for example Partner or Paralegal.</summary>
    public string? Title { get; set; }

    public string? Email { get; set; }

    public string? Comments { get; set; }

    /// <summary>External people only.</summary>
    public string? CompanyName { get; set; }

    /// <summary>The linked user of a system-user person; null for people added by hand. Name, e-mail and type are read-only when set.</summary>
    public int? UserId { get; set; }

    public AppUser? User { get; set; }

    public bool IsActive { get; set; } = true;
}
