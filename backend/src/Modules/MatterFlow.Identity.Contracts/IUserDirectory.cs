namespace MatterFlow.Identity.Contracts;

/// <summary>A user as other modules see them (assignee and author display).</summary>
/// <param name="UserId">AppUser id.</param>
/// <param name="DisplayName">Name shown in the UI.</param>
/// <param name="Email">Email address, if known.</param>
/// <param name="IsActive">False once the user is disabled: history keeps the name, but the user cannot be newly assigned work.</param>
public sealed record UserInfo(int UserId, string DisplayName, string? Email, bool IsActive);

/// <summary>Read-only user lookups for other modules (assignment validation, names on Tasks and comments).</summary>
public interface IUserDirectory
{
    /// <summary>Returns the user, or null when it does not exist.</summary>
    Task<UserInfo?> FindAsync(int userId, CancellationToken cancellationToken = default);

    /// <summary>The users with the given ids that exist (missing ids are skipped), keyed by id.</summary>
    Task<IReadOnlyDictionary<int, UserInfo>> FindManyAsync(IReadOnlyCollection<int> userIds, CancellationToken cancellationToken = default);
}
