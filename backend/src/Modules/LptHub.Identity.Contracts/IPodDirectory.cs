namespace MatterFlow.Identity.Contracts;

/// <summary>A Pod as other modules see it.</summary>
/// <param name="PodId">Pod id.</param>
/// <param name="Name">Unique Pod name.</param>
/// <param name="IsActive">False once deactivated: existing history keeps the Pod, but it is unavailable for new assignment.</param>
public sealed record PodInfo(int PodId, string Name, bool IsActive);

/// <summary>A user's Pod membership.</summary>
/// <param name="Pod">The Pod.</param>
/// <param name="IsPrimary">True when this is the user's primary Pod (the default Pod Work filter).</param>
public sealed record UserPodInfo(PodInfo Pod, bool IsPrimary);

/// <summary>
/// Read-only Pod queries for other modules (assignment validation, My Work, Pod Work). Pod membership never restricts who a Task
/// can be assigned to (addendum E); modules use this to validate that a Pod exists and is active, and to list a user's Pods.
/// </summary>
public interface IPodDirectory
{
    /// <summary>Returns the Pod, or null when it does not exist.</summary>
    Task<PodInfo?> FindAsync(int podId, CancellationToken cancellationToken = default);

    /// <summary>True when the Pod exists and is active, so it may be chosen for a new assignment.</summary>
    Task<bool> IsAvailableForAssignmentAsync(int podId, CancellationToken cancellationToken = default);

    /// <summary>The Pods a user belongs to, by Pod name. Inactive Pods are left out unless <paramref name="includeInactive"/> is set.</summary>
    Task<IReadOnlyList<UserPodInfo>> GetUserPodsAsync(int userId, bool includeInactive = false, CancellationToken cancellationToken = default);

    /// <summary>The user's primary Pod, or null when none is set (or it has since been deactivated).</summary>
    Task<PodInfo?> GetPrimaryPodAsync(int userId, CancellationToken cancellationToken = default);

    /// <summary>The ids of the users who belong to a Pod.</summary>
    Task<IReadOnlyList<int>> GetMemberUserIdsAsync(int podId, CancellationToken cancellationToken = default);

    /// <summary>
    /// The active users who lead a Pod: its members who hold the active "Pod Lead" role (Pod Lead is a role, not a flag; addendum E).
    /// One indexed query. The default says nobody, so test doubles need not implement it.
    /// </summary>
    Task<IReadOnlyList<int>> GetLeadUserIdsAsync(int podId, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<int>>([]);
}
