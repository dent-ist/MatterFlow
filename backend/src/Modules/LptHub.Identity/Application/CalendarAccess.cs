using LptHub.Identity.Contracts;
using LptHub.Identity.Domain;
using LptHub.SharedKernel.Identity;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Identity.Application;

/// <summary>See <see cref="ICalendarAccess"/>.</summary>
public sealed class CalendarAccess(DbContext db, ICurrentUser currentUser, IPermissionChecker permissions) : ICalendarAccess
{
    private IReadOnlySet<int>? ownPods;

    public bool SeesAllPods => permissions.Has(Permissions.User.View);

    public async Task<IReadOnlySet<int>> OwnPodIdsAsync(CancellationToken cancellationToken = default)
    {
        if (ownPods is not null)
            return ownPods;
        if (currentUser.UserId is not { } me)
            return ownPods = new HashSet<int>();
        var ids = await db.Set<PodMember>().AsNoTracking().Where(m => m.UserId == me && m.Pod.IsActive).Select(m => m.PodId).ToListAsync(cancellationToken);
        return ownPods = ids.ToHashSet();
    }

    public async Task<bool> CanEditAbsencesOfAsync(int userId, CancellationToken cancellationToken = default)
    {
        if (currentUser.UserId is not { } me)
            return false;
        if (me == userId)
            return permissions.Has(Permissions.Task.View);
        if (!permissions.Has(Permissions.User.ManageAvailability))
            return false;
        if (SeesAllPods)
            return true;

        var mine = await OwnPodIdsAsync(cancellationToken);
        if (mine.Count == 0)
            return false;
        var podIds = mine.ToList();
        return await db.Set<PodMember>().AsNoTracking().AnyAsync(m => m.UserId == userId && podIds.Contains(m.PodId) && m.Pod.IsActive, cancellationToken);
    }
}
