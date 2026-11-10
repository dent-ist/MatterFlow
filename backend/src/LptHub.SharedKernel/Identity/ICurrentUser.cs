namespace MatterFlow.SharedKernel.Identity;

/// <summary>The acting user of the current request/operation. Implemented by the Identity module; consumed everywhere else.</summary>
public interface ICurrentUser
{
    /// <summary>AppUser.UserId of the caller; null for anonymous or system (background) operations.</summary>
    int? UserId { get; }

    bool IsAuthenticated { get; }

    /// <summary>Display name of the caller; null for anonymous or system operations.</summary>
    string? DisplayName => null;

    /// <summary>True when the caller holds the built-in System Admin role (implicitly every permission).</summary>
    bool IsSystemAdmin => false;
}

/// <summary>Checks the caller's effective permissions inside application services (multi-permission endpoints, architecture 6.5).</summary>
public interface IPermissionChecker
{
    /// <summary>True when the caller holds <paramref name="permissionCode"/> (System Admin holds all).</summary>
    bool Has(string permissionCode);

    /// <summary>Success, or a 403 <c>PERMISSION_DENIED</c> failure naming the missing code in its meta.</summary>
    Results.Result Require(string permissionCode);
}

/// <summary>Fallback used until the Identity module registers the real implementation (and for background work).</summary>
public sealed class SystemCurrentUser : ICurrentUser
{
    public int? UserId => null;

    public bool IsAuthenticated => false;
}
