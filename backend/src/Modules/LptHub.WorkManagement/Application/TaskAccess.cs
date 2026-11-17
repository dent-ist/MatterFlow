using LptHub.SharedKernel.Visibility;
using LptHub.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace LptHub.WorkManagement.Application;

/// <summary>
/// The tasks the caller may see (epic #788, mode T): those of a visible matter and those currently assigned to the caller. Every read of a task
/// by id, every list and every command target in this module goes through here, so a hidden task is "not found" exactly like a missing one.
/// While the go-live switch is off this is the plain task set.
/// </summary>
public sealed class TaskAccess(DbContext db, IMatterVisibility visibility)
{
    /// <summary>The tasks the caller may see, read-only. Written as the join form of the rule (never <c>EXISTS ... OR assignee</c>).</summary>
    public IQueryable<WorkTask> Visible() => visibility.WhereTaskFlagVisible(db.Set<WorkTask>().AsNoTracking(), t => t.MatterId, t => t.IsMatterSensitive, t => t.AssignedUserId, t => t.TaskTypeId);

    /// <summary>Keeps the tasks whose type the caller may see (the Task Type term only, epic #1397), for readers that already know the matter or the assignee rule holds. A no-op while the switch is off.</summary>
    public IQueryable<WorkTask> WhereTypeVisible(IQueryable<WorkTask> tasks) => visibility.WhereTaskTypeVisible(tasks, t => t.TaskTypeId);

    /// <summary>True when the task exists and the caller may see it.</summary>
    public Task<bool> CanSeeAsync(long taskId, CancellationToken ct) => visibility.CanSeeTaskAsync(taskId, ct);

    /// <summary>True when the matter exists and the caller may see it as a whole (mode M). An assignee-only caller does not.</summary>
    public Task<bool> CanSeeMatterAsync(int matterId, CancellationToken ct) => visibility.CanSeeMatterAsync(matterId, ct);

    /// <summary>
    /// True when the caller may see the asset: its matter is visible, or it is linked to a task currently assigned to the caller (mode A, README section 1).
    /// </summary>
    public async Task<bool> CanSeeAssetAsync(int assetId, int assetMatterId, CancellationToken ct)
    {
        if (!visibility.Enabled || await visibility.CanSeeMatterAsync(assetMatterId, ct))
            return true;

        if (visibility.Current.UserId is not { } user)
            return false;

        // An assigned task opens the asset only when the caller may also see the task's type (epic #1397: no assignee exception for a hidden type).
        return await (from l in db.Set<TaskAsset>().AsNoTracking()
                      join t in WhereTypeVisible(db.Set<WorkTask>().AsNoTracking()) on l.TaskId equals t.Id
                      where l.AssetId == assetId && t.AssignedUserId == user
                      select l.AssetId).AnyAsync(ct);
    }
}
