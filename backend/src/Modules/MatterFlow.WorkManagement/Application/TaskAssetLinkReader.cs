using MatterFlow.Assets.Contracts;
using MatterFlow.Configuration.Contracts;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkManagement.Application;

/// <summary>
/// The Task side of Task-Asset links for other modules: the Tasks an Asset is linked to (<see cref="IAssetTaskLinkReader"/>, shown as "Linked Tasks"
/// on the Asset detail) and whether a link role is in use, so it can only be deactivated, not deleted (<see cref="IAssetLinkRoleUsage"/>).
/// </summary>
internal sealed class TaskAssetLinkReader(DbContext db, IAssetLinkRoleCatalog roles) : IAssetTaskLinkReader
{
    /// <summary>The one definition of the link counts: all linked Tasks and the open ones (New, In Progress, On Hold), grouped by Asset.</summary>
    public IQueryable<AssetTaskCountRow> Grouped() =>
        from l in db.Set<TaskAsset>().AsNoTracking()
        join t in db.Set<WorkTask>().AsNoTracking() on l.TaskId equals t.Id
        group t by l.AssetId into g
        select new AssetTaskCountRow
        {
            AssetId = g.Key,
            Linked = g.Count(),
            Open = g.Count(t => t.Status == TaskStatusCode.New || t.Status == TaskStatusCode.InProgress || t.Status == TaskStatusCode.OnHold),
        };

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
            join t in db.Set<WorkTask>().AsNoTracking() on l.TaskId equals t.Id
            where l.AssetId == assetId
            orderby l.CreatedAtUtc descending, t.Id descending
            select new { l.TaskId, t.Number, t.Title, t.Status, l.AssetLinkRoleId, l.CreatedAtUtc })
            .ToListAsync(cancellationToken);
        if (rows.Count == 0)
            return [];

        var roleNames = (await roles.ListAsync(true, cancellationToken)).ToDictionary(r => r.Id, r => r.Name);
        return
        [
            .. rows.Select(r => new AssetTaskLink(
                r.TaskId,
                r.Number,
                r.Title,
                r.Status.ToCode(),
                r.AssetLinkRoleId,
                r.AssetLinkRoleId is { } id && roleNames.TryGetValue(id, out var name) ? name : null,
                TaskSupport.Utc(r.CreatedAtUtc))),
        ];
    }

}

/// <summary>Whether an Asset Link Role is used by a link. A separate class: the role catalog itself depends on the usage probes.</summary>
internal sealed class TaskAssetLinkRoleUsage(DbContext db) : IAssetLinkRoleUsage
{
    public Task<bool> IsInUseAsync(int assetLinkRoleId, CancellationToken cancellationToken = default) =>
        db.Set<TaskAsset>().AnyAsync(l => l.AssetLinkRoleId == assetLinkRoleId, cancellationToken);

    public async Task<IReadOnlyDictionary<int, int>> CountLinksAsync(IReadOnlyCollection<int> assetLinkRoleIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(assetLinkRoleIds);
        if (assetLinkRoleIds.Count == 0)
            return new Dictionary<int, int>();

        var ids = assetLinkRoleIds.Distinct().Select(id => (int?)id).ToList();
        var rows = await db.Set<TaskAsset>().AsNoTracking()
            .Where(l => ids.Contains(l.AssetLinkRoleId))
            .GroupBy(l => l.AssetLinkRoleId)
            .Select(g => new { Key = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        return rows.Where(r => r.Key is not null).ToDictionary(r => r.Key!.Value, r => r.Count);
    }
}
