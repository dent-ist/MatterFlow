namespace MatterFlow.SharedKernel.Identity;

/// <summary>The acting user of the current request/operation. Implemented by the Identity module; consumed everywhere else.</summary>
public interface ICurrentUser
{
    /// <summary>AppUser.UserId of the caller; null for anonymous or system (background) operations.</summary>
    int? UserId { get; }

    bool IsAuthenticated { get; }
}

/// <summary>Fallback used until the Identity module registers the real implementation (and for background work).</summary>
public sealed class SystemCurrentUser : ICurrentUser
{
    public int? UserId => null;

    public bool IsAuthenticated => false;
}
