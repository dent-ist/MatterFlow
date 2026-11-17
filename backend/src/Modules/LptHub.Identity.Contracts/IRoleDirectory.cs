namespace LptHub.Identity.Contracts;

/// <summary>A role (<c>dbo.Role</c>) as other modules see it.</summary>
/// <param name="RoleId">Role id.</param>
/// <param name="Name">Unique role name.</param>
/// <param name="IsActive">False = deactivated; a deactivated role grants nothing.</param>
public sealed record RoleInfo(int RoleId, string Name, bool IsActive);

/// <summary>Read-only lookup of roles for other modules (the Task Type access lists name roles).</summary>
public interface IRoleDirectory
{
    /// <summary>The roles with the given ids that exist (missing ids are skipped), keyed by id, in one statement.</summary>
    Task<IReadOnlyDictionary<int, RoleInfo>> FindManyAsync(IReadOnlyCollection<int> roleIds, CancellationToken cancellationToken = default);
}

/// <summary>
/// Which Task Types name a role in one of their access lists (epic #1397). The Identity module asks before it deletes a role: a role that is still in a list
/// must not disappear, because dropping the last Can View role would silently open the type to everyone. The Configuration module implements it.
/// </summary>
public interface ITaskTypeRoleUsage
{
    /// <summary>Names of the Task Types that list the role in Can View, Can Edit or Can Be Assigned, by name.</summary>
    Task<IReadOnlyList<string>> TaskTypeNamesUsingRoleAsync(int roleId, CancellationToken cancellationToken = default);
}

/// <summary>Default <see cref="ITaskTypeRoleUsage"/> until the Configuration module registers the real one: no Task Type uses any role.</summary>
public sealed class NoTaskTypeRoleUsage : ITaskTypeRoleUsage
{
    public Task<IReadOnlyList<string>> TaskTypeNamesUsingRoleAsync(int roleId, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<string>>([]);
}
