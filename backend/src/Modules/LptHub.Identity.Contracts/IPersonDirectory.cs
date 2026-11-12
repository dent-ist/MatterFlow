namespace LptHub.Identity.Contracts;

/// <summary>A person of the shared People list as other modules see them (vendor contacts, pickers).</summary>
/// <param name="PersonId">Person id.</param>
/// <param name="DisplayName">First and last name together.</param>
/// <param name="PersonType"><c>INTERNAL</c> or <c>EXTERNAL</c>.</param>
/// <param name="Title">Title or role, if known.</param>
/// <param name="Email">E-mail address, if known.</param>
/// <param name="CompanyName">Company of an external person, if known.</param>
/// <param name="UserId">The linked user of a system-user person, otherwise null.</param>
/// <param name="IsActive">False once the person is deactivated (history keeps showing the name; new links are refused).</param>
public sealed record PersonSummary(int PersonId, string DisplayName, string PersonType, string? Title, string? Email, string? CompanyName, int? UserId, bool IsActive);

/// <summary>Read-only lookups of people for other modules (vendor contacts).</summary>
public interface IPersonDirectory
{
    /// <summary>The people with the given ids that exist (missing ids are skipped), keyed by id, in one statement.</summary>
    Task<IReadOnlyDictionary<int, PersonSummary>> FindManyAsync(IReadOnlyCollection<int> personIds, CancellationToken cancellationToken = default);
}
