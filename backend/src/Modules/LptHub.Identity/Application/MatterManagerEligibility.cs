using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Identity.Application;

/// <summary>Implements <see cref="IMatterManagerEligibility"/> and the query behind <c>GET /users/matter-managers</c>.</summary>
public sealed class MatterManagerEligibility(DbContext db) : IMatterManagerEligibility
{
    /// <summary>
    /// Active users holding <c>Matter.BeManager</c> through an active role (a System Admin role counts: it holds every permission). Users without a
    /// role (Access Pending) hold nothing and are not offered.
    /// </summary>
    public IQueryable<AppUser> Eligible() =>
        db.Set<AppUser>().AsNoTracking().Where(u => u.IsActive
            && db.Set<UserRole>().Any(ur => ur.UserId == u.Id && ur.Role.IsActive
                && (ur.Role.IsSystemAdmin
                    || ur.Role.Permissions.Any(rp => rp.Permission.IsActive && rp.Permission.Code == Permissions.Matter.BeManager))));

    public async Task<IReadOnlySet<int>> EligibleAsync(IReadOnlyCollection<int> userIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(userIds);
        if (userIds.Count == 0)
            return new HashSet<int>();

        var ids = userIds.Distinct().ToList();
        var found = await Eligible().Where(u => ids.Contains(u.Id)).Select(u => u.Id).ToListAsync(cancellationToken);
        return found.ToHashSet();
    }
}
