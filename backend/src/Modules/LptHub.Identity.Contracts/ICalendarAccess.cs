namespace LptHub.Identity.Contracts;

/// <summary>
/// Who may see and change what in the Dashboard Calendar (decision AT, items 1 to 3). A Director (anyone who holds <c>User.View</c>, which the System Admin holds implicitly) works with every
/// pod; everybody else, a Pod Lead, only with the people of the active pods they are a member of ("pods they lead": Pod Lead is a role, not a flag, addendum E).
/// </summary>
public interface ICalendarAccess
{
    /// <summary>True when the caller works with every pod.</summary>
    bool SeesAllPods { get; }

    /// <summary>The active pods of the caller (their own pods), the pods a Pod Lead may use.</summary>
    Task<IReadOnlySet<int>> OwnPodIdsAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// True when the caller may create, change or delete the Out of office entries of <paramref name="userId"/>: the person themselves (needs <c>Task.View</c>), or someone who holds
    /// <c>User.ManageAvailability</c> and (for a Pod Lead) shares an active pod with the person.
    /// </summary>
    Task<bool> CanEditAbsencesOfAsync(int userId, CancellationToken cancellationToken = default);
}
