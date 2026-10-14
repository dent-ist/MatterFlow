namespace MatterFlow.Identity.Access;

/// <summary>A resolved user with the effective permissions the authorization handler and <c>/me</c> use. Immutable, cached per request window.</summary>
public sealed record AccessSnapshot(
    int UserId,
    string DisplayName,
    string? Email,
    string? WindowsAccount,
    DateTime RegisteredAtUtc,
    bool IsActive,
    bool IsSystemAdmin,
    IReadOnlyList<string> Roles,
    IReadOnlySet<string> Permissions)
{
    /// <summary>Access Pending: active but with no effective permission at all (derived, never stored; baseline 6.4).</summary>
    public bool IsPending => IsActive && Permissions.Count == 0;

    /// <summary>System Admin holds every permission implicitly; everyone else needs the code in the effective set.</summary>
    public bool Has(string permissionCode) => IsActive && (IsSystemAdmin || Permissions.Contains(permissionCode));
}
