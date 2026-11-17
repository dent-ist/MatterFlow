using LptHub.Identity.Domain;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Identity.Access;

/// <summary>
/// The active roles a person holds (<c>dbo.UserRole</c> joined to an active <c>dbo.Role</c>), as a query the visibility port can embed in the Task Type access rule (epic #1397, README section 4.2).
/// A seam so the rule can be unit tested over in-memory rows; the one implementation reads the database.
/// </summary>
public interface IActiveRoleSource
{
    /// <summary>The ids of the active roles <paramref name="userId"/> holds. Never cached: a role change is effective on the next request.</summary>
    IQueryable<int> RoleIdsOf(int userId);

    /// <summary>Every (person, active role) pair with the role's System Admin flag: the set-wide form of <see cref="RoleIdsOf"/>, for "who may be assigned" (issue #1401).</summary>
    IQueryable<ActiveUserRoleRow> ActiveUserRoles();
}

/// <summary>A person and one active role they hold; <see cref="IsSystemAdmin"/> is the role's flag.</summary>
public sealed class ActiveUserRoleRow
{
    public int UserId { get; init; }

    public int RoleId { get; init; }

    public bool IsSystemAdmin { get; init; }
}

/// <summary>The database implementation of <see cref="IActiveRoleSource"/>.</summary>
internal sealed class ActiveRoleSource(DbContext db) : IActiveRoleSource
{
    public IQueryable<int> RoleIdsOf(int userId) =>
        db.Set<UserRole>().Where(ur => ur.UserId == userId && ur.Role.IsActive).Select(ur => ur.RoleId);

    public IQueryable<ActiveUserRoleRow> ActiveUserRoles() =>
        db.Set<UserRole>().Where(ur => ur.Role.IsActive).Select(ur => new ActiveUserRoleRow { UserId = ur.UserId, RoleId = ur.RoleId, IsSystemAdmin = ur.Role.IsSystemAdmin });
}
