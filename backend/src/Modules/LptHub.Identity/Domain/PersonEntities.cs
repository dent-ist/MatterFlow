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

    /// <summary>Office of an internal person (admin list <see cref="Office"/>, epic #1389, issue #1394). Changes are audited by <c>PERSON_OFFICE_CHANGED</c> with the names.</summary>
    [AuditExplicit]
    public int? OfficeId { get; set; }

    /// <summary>Employment Status of an internal person (admin list <see cref="EmploymentStatus"/>: Active, On Leave, Departed). The HR status, not the account state of the user. Audited by <c>PERSON_EMPLOYMENT_STATUS_CHANGED</c>.</summary>
    [AuditExplicit]
    public int? EmploymentStatusId { get; set; }

    /// <summary>When the person started working in this industry: month and year only, stored as the first day of the month. Audited by <c>PERSON_INDUSTRY_JOIN_CHANGED</c>.</summary>
    [AuditExplicit]
    public DateOnly? IndustryJoinDate { get; set; }

    /// <summary>The linked user of a system-user person; null for people added by hand. Name, e-mail and type are read-only when set.</summary>
    public int? UserId { get; set; }

    public AppUser? User { get; set; }

    public bool IsActive { get; set; } = true;
}

/// <summary>Common shape of the two admin lists of a person (Office, Employment Status): a name, an order and an active flag. A used item is deactivated, never deleted.</summary>
public abstract class PersonListEntity : AuditedEntity<int>
{
    public string Name { get; set; } = string.Empty;

    public int SortOrder { get; set; }

    public bool IsActive { get; set; } = true;
}

/// <summary>An Office of the firm (a person's <see cref="Person.OfficeId"/> references it).</summary>
[Audited(ObjectType = "Office")]
public class Office : PersonListEntity;

/// <summary>An Employment Status (Active, On Leave, Departed; a person's <see cref="Person.EmploymentStatusId"/> references it).</summary>
[Audited(ObjectType = "EmploymentStatus")]
public class EmploymentStatus : PersonListEntity;
