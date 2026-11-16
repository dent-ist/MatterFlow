using System.ComponentModel.DataAnnotations;
using LptHub.Identity.Contracts;
using LptHub.Identity.Pods;

namespace LptHub.Identity.Application;

/// <summary>One row of the users list. <c>FirstName</c>, <c>LastName</c>, <c>Title</c>, <c>OfficeName</c> and <c>EmploymentStatusName</c> come from the linked person record (empty or null when the user has none, or has a one-word name for the last name; the Employment Status is the HR status of the person, not the account state). <c>Pods</c> are all of the person's Pods (inactive ones too), by name, with the primary one flagged.</summary>
public sealed record UserSummaryDto(
    [property: Required] int UserId,
    [property: Required] string DisplayName,
    string? Email,
    string? WindowsAccount,
    [property: Required] bool IsActive,
    [property: Required] bool IsPending,
    [property: Required] bool IsSystemAdmin,
    [property: Required] bool IsSeededAdmin,
    [property: Required] string[] Roles,
    [property: Required] DateTime RegisteredAtUtc,
    DateTime? LastLoginAtUtc,
    [property: Required] UserPodDto[] Pods,
    UserAvailabilitySummary? Availability = null,
    int? OpenTaskCount = null,
    string FirstName = "",
    string LastName = "",
    string? Title = null,
    string? OfficeName = null,
    string? EmploymentStatusName = null);

/// <summary>A user with the data of the detail drawer. Pod membership belongs to the Organization module and is added by that ticket.</summary>
public sealed record UserDetailDto(
    [property: Required] int UserId,
    [property: Required] string DisplayName,
    string? Email,
    string? WindowsAccount,
    [property: Required] bool IsActive,
    [property: Required] bool IsPending,
    [property: Required] bool IsSystemAdmin,
    [property: Required] bool IsSeededAdmin,
    [property: Required] int[] RoleIds,
    [property: Required] string[] Roles,
    [property: Required] string[] EffectivePermissions,
    [property: Required] DateTime RegisteredAtUtc,
    DateTime? LastLoginAtUtc,
    [property: Required] string RowVersion,
    int? OpenTaskCount = null,
    string? Title = null,
    string? Notes = null,
    int? OfficeId = null,
    string? OfficeName = null,
    int? EmploymentStatusId = null,
    string? EmploymentStatusName = null,
    string? IndustryJoinMonth = null,
    string? PersonRowVersion = null);

/// <summary>Counts for the tabs of the users screen.</summary>
public sealed record UserCountsDto([property: Required] int Pending, [property: Required] int Active, [property: Required] int Inactive);

public sealed record SetUserRolesRequest(
    [Required] int[] RoleIds,
    [Required] string RowVersion);

public sealed record SetUserActiveRequest(
    [Required] bool IsActive,
    [Required] string RowVersion);

public sealed record UpdateUserProfileRequest(
    [Required, StringLength(200, MinimumLength = 1)] string DisplayName,
    [StringLength(320), EmailAddress] string? Email,
    [Required] string RowVersion);

/// <summary>
/// The person fields of a user (epic #1389, issue #1394): Title, Notes, Office, Employment Status and Industry Join Date. Every field is replaced: a field left out is cleared. <c>RowVersion</c> is the <c>personRowVersion</c> of the last read of the user (the person row has its own token).
/// </summary>
public sealed record UpdateUserPersonDetailsRequest(
    [StringLength(100)] string? Title,
    [StringLength(2000)] string? Notes,
    int? OfficeId,
    int? EmploymentStatusId,
    [StringLength(7), RegularExpression(@"^\d{4}-(0[1-9]|1[0-2])$")] string? IndustryJoinMonth,
    [Required] string RowVersion);

/// <summary>One row of the roles list.</summary>
public sealed record RoleSummaryDto(
    [property: Required] int RoleId,
    [property: Required] string Name,
    string? Description,
    [property: Required] bool IsSystemAdmin,
    [property: Required] int MemberCount,
    [property: Required] int PermissionCount,
    string? LandingPage = null);

public sealed record RoleDetailDto(
    [property: Required] int RoleId,
    [property: Required] string Name,
    string? Description,
    [property: Required] bool IsSystemAdmin,
    [property: Required] int MemberCount,
    [property: Required] string[] PermissionCodes,
    [property: Required] string RowVersion,
    string? LandingPage = null);

/// <summary>Creates a role (a new record has no row version yet).</summary>
public sealed record CreateRoleRequest(
    [Required, StringLength(100, MinimumLength = 1)] string Name,
    [StringLength(500)] string? Description,
    [Required] string[] PermissionCodes);

/// <summary>Edits a role; the row version is mandatory so two administrators cannot silently overwrite each other (SEC-09).</summary>
public sealed record UpdateRoleRequest(
    [Required, StringLength(100, MinimumLength = 1)] string Name,
    [StringLength(500)] string? Description,
    [Required] string[] PermissionCodes,
    [Required] string RowVersion);

public sealed record PermissionItemDto([property: Required] string Code, [property: Required] string Description);

public sealed record PermissionGroupDto([property: Required] string Group, [property: Required] PermissionItemDto[] Permissions);
