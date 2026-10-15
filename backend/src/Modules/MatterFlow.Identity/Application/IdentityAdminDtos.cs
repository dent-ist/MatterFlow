using System.ComponentModel.DataAnnotations;
using MatterFlow.Identity.Contracts;

namespace MatterFlow.Identity.Application;

/// <summary>One row of the users list.</summary>
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
    UserAvailabilitySummary? Availability = null);

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
    [property: Required] string RowVersion);

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

/// <summary>One row of the roles list.</summary>
public sealed record RoleSummaryDto(
    [property: Required] int RoleId,
    [property: Required] string Name,
    string? Description,
    [property: Required] bool IsSystemAdmin,
    [property: Required] int MemberCount,
    [property: Required] int PermissionCount);

public sealed record RoleDetailDto(
    [property: Required] int RoleId,
    [property: Required] string Name,
    string? Description,
    [property: Required] bool IsSystemAdmin,
    [property: Required] int MemberCount,
    [property: Required] string[] PermissionCodes,
    [property: Required] string RowVersion);

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
