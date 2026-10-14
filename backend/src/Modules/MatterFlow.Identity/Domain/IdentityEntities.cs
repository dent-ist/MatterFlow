using MatterFlow.SharedKernel.Audit;
using MatterFlow.SharedKernel.Entities;

namespace MatterFlow.Identity.Domain;

/// <summary>The application-owned user. Every actor/assignee foreign key in the system references <see cref="Entity{TKey}.Id"/> (UserId).</summary>
[Audited(ObjectType = "User")]
public class AppUser : AuditedEntity<int>
{
    public string DisplayName { get; set; } = string.Empty;

    public string? Email { get; set; }

    public bool IsActive { get; set; } = true;

    /// <summary>Set once when <c>Bootstrap:SystemAdmins</c> granted System Admin, so an admin can later revoke it without it re-granting.</summary>
    public DateTime? BootstrapAppliedAt { get; set; }

    public DateTime? LastLoginAt { get; set; }

    public List<UserIdentity> Identities { get; set; } = [];

    public List<UserRole> Roles { get; set; } = [];
}

/// <summary>An external login (Windows SID, Dev user, later Entra tid+oid) linked to one <see cref="AppUser"/>.</summary>
public class UserIdentity : AuditedEntity<int>
{
    public int UserId { get; set; }

    public AppUser User { get; set; } = null!;

    public string Provider { get; set; } = string.Empty;

    /// <summary>Empty string for Windows and Dev (keeps the unique index effective).</summary>
    public string TenantId { get; set; } = string.Empty;

    public string ProviderSubject { get; set; } = string.Empty;

    /// <summary>Display/diagnostic name, for example <c>KE\kekim</c>.</summary>
    public string Username { get; set; } = string.Empty;

    public bool IsActive { get; set; } = true;

    public DateTime? VerifiedAt { get; set; }
}

[Audited(ObjectType = "Role")]
public class Role : AuditedEntity<int>
{
    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }

    /// <summary>The built-in System Admin role: implicitly holds every permission and cannot be edited or deleted.</summary>
    public bool IsSystemAdmin { get; set; }

    public bool IsActive { get; set; } = true;

    public List<RolePermission> Permissions { get; set; } = [];
}

/// <summary>A row of the permission catalog (synced from <c>contracts/permissions.json</c>).</summary>
public class Permission : Entity<int>
{
    public string Code { get; set; } = string.Empty;

    public string GroupName { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;

    public bool IsActive { get; set; } = true;
}

public class RolePermission
{
    public int RoleId { get; set; }

    public Role Role { get; set; } = null!;

    public int PermissionId { get; set; }

    public Permission Permission { get; set; } = null!;
}

public class UserRole
{
    public int UserId { get; set; }

    public AppUser User { get; set; } = null!;

    public int RoleId { get; set; }

    public Role Role { get; set; } = null!;

    public DateTime GrantedAt { get; set; }

    public int? GrantedByUserId { get; set; }
}
