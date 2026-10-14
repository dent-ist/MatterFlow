using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Identity.Application;

/// <summary>Read-only user lookups exposed to other modules through <see cref="IUserDirectory"/>.</summary>
public sealed class UserDirectory(DbContext db) : IUserDirectory
{
    public Task<UserInfo?> FindAsync(int userId, CancellationToken cancellationToken = default) =>
        db.Set<AppUser>().AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => new UserInfo(u.Id, u.DisplayName, u.Email, u.IsActive))
            .SingleOrDefaultAsync(cancellationToken);

    public async Task<IReadOnlyDictionary<int, UserInfo>> FindManyAsync(IReadOnlyCollection<int> userIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(userIds);
        if (userIds.Count == 0)
            return new Dictionary<int, UserInfo>();

        var ids = userIds.Distinct().ToList();
        var users = await db.Set<AppUser>().AsNoTracking()
            .Where(u => ids.Contains(u.Id))
            .Select(u => new UserInfo(u.Id, u.DisplayName, u.Email, u.IsActive))
            .ToListAsync(cancellationToken);
        return users.ToDictionary(u => u.UserId);
    }
}
