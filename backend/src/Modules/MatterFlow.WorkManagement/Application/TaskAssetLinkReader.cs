using MatterFlow.Assets.Contracts;
using MatterFlow.Configuration.Contracts;
using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Time;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkManagement.Application;

/// <summary>
/// The Task side of Task-Asset links for other modules: the Tasks an Asset is linked to (<see cref="IAssetTaskLinkReader"/>, shown as "Linked Tasks"
/// on the Asset detail) and whether a link role is in use, so it can only be deactivated, not deleted (<see cref="IAssetLinkRoleUsage"/>).
/// </summary>
internal sealed class TaskAssetLinkReader(
    DbContext db,
    IAssetLinkRoleCatalog roles,
    TaskAccess access,
    IPriorityCatalog priorities,
    IUserDirectory users,
    IUserTimeZone timeZone,
    IClock clock) : IAssetTaskLinkReader
{
    /// <summary>The one definition of the link counts: all linked Tasks and the open ones (New, In Progress, On Hold), grouped by Asset.</summary>
    public IQueryable<AssetTaskCountRow> Grouped() =>
        from l in db.Set<TaskAsset>().AsNoTracking()
        join t in access.Visible() on l.TaskId equals t.Id
        group t by l.AssetId into g
        select new AssetTaskCountRow
        {
            AssetId = g.Key,
            Linked = g.Count(),
            Open = g.Count(t => t.Status == TaskStatusCode.New || t.Status == TaskStatusCode.InProgress || t.Status == TaskStatusCode.OnHold),
        };

    // The prepared ids (see IAssetTaskLinkReader.PrepareAsync), dropped when the request saves anything.
    private const int MaxPrepared = 500;
    private (int User, int[] Ids)? _prepared;
    private bool _subscribed;

    public async Task PrepareAsync(int userId, CancellationToken cancellationToken = default)
    {
        if (_prepared is { } current && current.User == userId)
            return;

        var ids = await (
            from l in db.Set<TaskAsset>().AsNoTracking()
            join t in db.Set<WorkTask>().AsNoTracking() on l.TaskId equals t.Id
            where t.AssignedUserId == userId && t.IsMatterSensitive
            select l.AssetId).Distinct().Take(MaxPrepared + 1).ToArrayAsync(cancellationToken);
        if (!_subscribed)
        {
            db.SavedChanges += (_, _) => _prepared = null;
            _subscribed = true;
        }

        _prepared = ids.Length > MaxPrepared ? null : (userId, ids);
    }

    public IReadOnlyList<int>? PreparedAssetIdsOfTasksAssignedTo(int userId) => _prepared is { } p && p.User == userId ? p.Ids : null;

    public IQueryable<int> AssetIdsOfTasksAssignedTo(int userId) =>
        from l in db.Set<TaskAsset>().AsNoTracking()
        join t in db.Set<WorkTask>().AsNoTracking() on l.TaskId equals t.Id
        where t.AssignedUserId == userId
        select l.AssetId;

    public async Task<IReadOnlyDictionary<int, AssetTaskCounts>> CountForAssetsAsync(IReadOnlyCollection<int> assetIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(assetIds);
        if (assetIds.Count == 0)
            return new Dictionary<int, AssetTaskCounts>();

        var ids = assetIds.Distinct().ToList();
        var rows = await Grouped().Where(r => ids.Contains(r.AssetId)).ToListAsync(cancellationToken);
        return rows.ToDictionary(r => r.AssetId, r => new AssetTaskCounts(r.Linked, r.Open));
    }

    public async Task<IReadOnlyList<AssetTaskLink>> ListForAssetAsync(int assetId, CancellationToken cancellationToken = default)
    {
        var rows = await (
            from l in db.Set<TaskAsset>().AsNoTracking()
            join t in access.Visible() on l.TaskId equals t.Id
            where l.AssetId == assetId
            select new { l.TaskId, t.Number, t.Title, t.Status, t.DueDate, t.DueAtUtc, t.PriorityId, t.AssignedUserId, l.AssetLinkRoleId, l.CreatedAtUtc })
            .ToListAsync(cancellationToken);
        if (rows.Count == 0)
            return [];

        // A dozen links at most: the order (due date ascending, none last, then the newest link) is made here, from the one effective due day.
        var ordered = rows
            .OrderBy(r => r.DueDate is null && r.DueAtUtc is null ? 1 : 0)
            .ThenBy(r => r.DueDate?.ToDateTime(TimeOnly.MinValue) ?? r.DueAtUtc ?? DateTime.MaxValue)
            .ThenByDescending(r => r.CreatedAtUtc)
            .ThenByDescending(r => r.TaskId)
            .ToList();

        // Three lookups for the whole list, never one per row.
        var roleNames = (await roles.ListAsync(true, cancellationToken)).ToDictionary(r => r.Id, r => r.Name);
        var priorityMap = (await priorities.ListAsync(includeInactive: true, cancellationToken)).ToDictionary(p => p.Id);
        var userMap = await users.FindManyAsync([.. ordered.Select(r => r.AssignedUserId).OfType<int>().Distinct()], cancellationToken);
        var now = clock.UtcNow;
        return
        [
            .. ordered.Select(r =>
            {
                var due = TaskDue.FromStored(r.DueDate, r.DueAtUtc);
                priorityMap.TryGetValue(r.PriorityId, out var priority);
                return new AssetTaskLink(
                    r.TaskId,
                    r.Number,
                    r.Title,
                    r.Status.ToCode(),
                    r.AssetLinkRoleId,
                    r.AssetLinkRoleId is { } id && roleNames.TryGetValue(id, out var name) ? name : null,
                    TaskSupport.Utc(r.CreatedAtUtc),
                    r.DueDate,
                    TaskSupport.Utc(r.DueAtUtc),
                    due.IsAsap,
                    due.IsOverdue(r.Status, now, timeZone.Zone),
                    r.Status.IsOpen(),
                    r.AssignedUserId,
                    r.AssignedUserId is { } uid && userMap.TryGetValue(uid, out var user) ? user.DisplayName : null,
                    priority?.Label,
                    priority?.Color);
            }),
        ];
    }

}

/// <summary>Whether an Asset Link Role is used by a link. A separate class: the role catalog itself depends on the usage probes.</summary>
internal sealed class TaskAssetLinkRoleUsage(DbContext db, TaskAccess access) : IAssetLinkRoleUsage
{
    public Task<bool> IsInUseAsync(int assetLinkRoleId, CancellationToken cancellationToken = default) =>
        db.Set<TaskAsset>().AnyAsync(l => l.AssetLinkRoleId == assetLinkRoleId, cancellationToken);

    public async Task<IReadOnlyDictionary<int, int>> CountLinksAsync(IReadOnlyCollection<int> assetLinkRoleIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(assetLinkRoleIds);
        if (assetLinkRoleIds.Count == 0)
            return new Dictionary<int, int>();

        var ids = assetLinkRoleIds.Distinct().Select(id => (int?)id).ToList();
        // Only the links of tasks the caller may see (sensitive-matter rule); IsInUseAsync above stays unfiltered so a role used only by hidden tasks still cannot be deleted.
        var rows = await (from l in db.Set<TaskAsset>().AsNoTracking()
                          join t in access.Visible() on l.TaskId equals t.Id
                          where ids.Contains(l.AssetLinkRoleId)
                          select l)
            .GroupBy(l => l.AssetLinkRoleId)
            .Select(g => new { Key = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        return rows.Where(r => r.Key is not null).ToDictionary(r => r.Key!.Value, r => r.Count);
    }
}
