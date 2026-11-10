namespace MatterFlow.Identity.Contracts;

/// <summary>
/// Who may be named as the Primary or Secondary project manager of a matter (epic #667): active users who hold the marker permission
/// <c>Matter.BeManager</c> through an active role (the built-in System Admin role holds every permission implicitly). Lives in Identity because
/// roles and grants do; the Organization module asks through this contract.
/// </summary>
public interface IMatterManagerEligibility
{
    /// <summary>The users among <paramref name="userIds"/> who are eligible right now (unknown, inactive and non-holding users are left out).</summary>
    Task<IReadOnlySet<int>> EligibleAsync(IReadOnlyCollection<int> userIds, CancellationToken cancellationToken = default);
}

/// <summary>A user's id and display name for sorting and joining inside a query (see <see cref="IUserDirectory.NameKeys"/>). A class with initialisers, not a positional record, so a query can join it.</summary>
public sealed class UserNameKey
{
    public int UserId { get; init; }

    public string DisplayName { get; init; } = string.Empty;
}
