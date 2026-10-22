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

    /// <summary>Names of the Roles that exist (inactive ones too: history keeps their names), keyed by Role id. The default resolves nothing.</summary>
    Task<IReadOnlyDictionary<int, string>> RoleNamesAsync(IReadOnlyCollection<int> roleIds, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyDictionary<int, string>>(new Dictionary<int, string>());

    /// <summary>Every user's id and display name as a query, so another module can order or join a list by a person's name inside one statement (for example the Matters list sorted by project manager). The default is empty.</summary>
    IQueryable<UserNameKey> NameKeys() => Enumerable.Empty<UserNameKey>().AsQueryable();
}
