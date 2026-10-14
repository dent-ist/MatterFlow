using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Identity.Pods;

/// <summary>Read-only Pod queries exposed to other modules through <see cref="IPodDirectory"/>.</summary>
public sealed class PodDirectory(DbContext db) : IPodDirectory
{
    public Task<PodInfo?> FindAsync(int podId, CancellationToken cancellationToken = default) =>
        db.Set<Pod>().AsNoTracking()
            .Where(p => p.Id == podId)
            .Select(p => new PodInfo(p.Id, p.Name, p.IsActive))
            .SingleOrDefaultAsync(cancellationToken);

    public Task<bool> IsAvailableForAssignmentAsync(int podId, CancellationToken cancellationToken = default) =>
        db.Set<Pod>().AsNoTracking().AnyAsync(p => p.Id == podId && p.IsActive, cancellationToken);

    public async Task<IReadOnlyList<UserPodInfo>> GetUserPodsAsync(int userId, bool includeInactive = false, CancellationToken cancellationToken = default) =>
        await db.Set<PodMember>().AsNoTracking()
            .Where(m => m.UserId == userId && (includeInactive || m.Pod.IsActive))
            .OrderBy(m => m.Pod.Name)
            .Select(m => new UserPodInfo(new PodInfo(m.PodId, m.Pod.Name, m.Pod.IsActive), m.IsPrimary))
            .ToListAsync(cancellationToken);

    public Task<PodInfo?> GetPrimaryPodAsync(int userId, CancellationToken cancellationToken = default) =>
        db.Set<PodMember>().AsNoTracking()
            .Where(m => m.UserId == userId && m.IsPrimary && m.Pod.IsActive)
            .Select(m => new PodInfo(m.PodId, m.Pod.Name, m.Pod.IsActive))
            .SingleOrDefaultAsync(cancellationToken);

    public async Task<IReadOnlyList<int>> GetMemberUserIdsAsync(int podId, CancellationToken cancellationToken = default) =>
        await db.Set<PodMember>().AsNoTracking()
            .Where(m => m.PodId == podId)
            .OrderBy(m => m.UserId)
            .Select(m => m.UserId)
            .ToListAsync(cancellationToken);
}
