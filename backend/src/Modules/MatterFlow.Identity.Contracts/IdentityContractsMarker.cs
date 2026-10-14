namespace MatterFlow.Identity.Contracts;

/// <summary>Marker type used by architecture tests. Public interfaces of the Identity module live in this project.</summary>
public sealed class IdentityContractsMarker;

/// <summary>
/// Lets other modules (for example role and user administration) drop cached effective permissions the moment roles,
/// role grants or user status change (architecture 6.1, "permission refresh policy").
/// </summary>
public interface IUserAccessInvalidator
{
    /// <summary>Forgets cached access for one user.</summary>
    void InvalidateUser(int userId);

    /// <summary>Forgets cached access for every user (use when a role's permissions or active flag change).</summary>
    void InvalidateAll();
}
