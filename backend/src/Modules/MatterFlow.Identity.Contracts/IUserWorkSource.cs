namespace MatterFlow.Identity.Contracts;

/// <summary>
/// Lets a module that owns work items tell Identity whether a user has open work, without Identity depending on it
/// (architecture 5.2). <c>GET /api/v1/me</c> combines every registered source with the user's Pod membership into <c>hasWork</c>.
/// </summary>
public interface IUserWorkSource
{
    /// <summary>True when at least one open item (for Tasks: New, In Progress or On Hold) is assigned to the user.</summary>
    Task<bool> HasOpenAssignedWorkAsync(int userId, CancellationToken cancellationToken = default);
}
