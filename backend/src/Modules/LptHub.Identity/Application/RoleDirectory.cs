using LptHub.Identity.Contracts;
using LptHub.Identity.Domain;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Identity.Application;

/// <summary>Role lookup for other modules (<see cref="IRoleDirectory"/>): one statement for any number of ids.</summary>
public sealed class RoleDirectory(DbContext db) : IRoleDirectory
{
    public async Task<IReadOnlyDictionary<int, RoleInfo>> FindManyAsync(IReadOnlyCollection<int> roleIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(roleIds);
        if (roleIds.Count == 0)
            return new Dictionary<int, RoleInfo>();

        var ids = roleIds.Distinct().ToList();
        var rows = await db.Set<Role>().AsNoTracking()
            .Where(r => ids.Contains(r.Id))
            .Select(r => new RoleInfo(r.Id, r.Name, r.IsActive))
            .ToListAsync(cancellationToken);
        return rows.ToDictionary(r => r.RoleId);
    }
}
