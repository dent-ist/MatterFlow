using MatterFlow.Assets.Contracts;
using MatterFlow.Audit.Contracts;
using MatterFlow.Configuration.Contracts;
using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkManagement.Application;

/// <summary>
/// Task-Asset links with relationship roles (ticket 45). An Asset can only be linked to a Task of its own Matter (409 CROSS_MATTER_REFERENCE;
/// two composite foreign keys enforce it in the database too), once (409 ASSET_ALREADY_LINKED), and only while it is active (409 ASSET_INACTIVE).
/// Links change only while the Task is New, In Progress or On Hold (409 TASK_NOT_EDITABLE). Changes are audited in the same transaction.
/// </summary>
public sealed class TaskAssetService(
    DbContext db,
    TaskTransactions tx,
    IAuditWriter audit,
    IPermissionChecker permissions,
    IAssetDirectory assets,
    IAssetLinkRoleCatalog roles,
    IUserDirectory users)
{
    public async Task<Result<TaskAssetLinkListResponse>> ListAsync(long taskId, CancellationToken ct)
    {
        var task = await db.Set<WorkTask>().AsNoTracking().Where(t => t.Id == taskId).Select(t => new { t.Status }).SingleOrDefaultAsync(ct);
        if (task is null)
            return TaskSupport.NotFound();

        var rows = await db.Set<TaskAsset>().AsNoTracking().Where(l => l.TaskId == taskId)
            .OrderByDescending(l => l.CreatedAtUtc).ThenByDescending(l => l.AssetId).ToListAsync(ct);
        var items = await ToResponsesAsync(rows, ct);
        var canEdit = TaskEditability.IsAllowed(task.Status, TaskOperation.LinkAssets) && permissions.Has(Permissions.Task.Edit) && permissions.Has(Permissions.Asset.Link);
        return new TaskAssetLinkListResponse(items, canEdit);
    }

    public async Task<Result<TaskAssetLinkResponse>> LinkAsync(long taskId, LinkTaskAssetRequest request, CancellationToken ct)
    {
        var allowed = RequireEditPermissions();
        if (allowed.IsFailure)
            return Result<TaskAssetLinkResponse>.Failure(allowed.Error!);

        var done = await tx.RunAsync<int>(
            async token =>
            {
                var task = await tx.LockTaskAsync(taskId, token);
                if (task is null)
                    return TaskSupport.NotFound();
                if (TaskEditability.Check(task.Status, TaskOperation.LinkAssets) is { } notEditable)
                    return TaskService.NotEditable(task.Status, notEditable);

                var asset = await assets.FindAsync(request.AssetId, token);
                if (asset is null)
                    return Error.Validation("assetId", "NOT_FOUND", "Select an asset to link.");
                if (asset.MatterId != task.MatterId)
                    return Error.Conflict(ErrorCodes.CrossMatterReference, "That asset belongs to a different matter than the task. Link an asset of the task's matter.");
                if (!asset.IsActive)
                    return Error.Conflict(ErrorCodes.AssetInactive, permissions.Has(Permissions.Asset.View) ? $"'{asset.DisplayName}' is inactive and can't be linked to a task." : "That asset is inactive and can't be linked to a task.");

                string? roleName = null;
                if (request.AssetLinkRoleId is { } roleId)
                {
                    var role = await RoleAsync(roleId, token);
                    if (role is null || !role.IsActive)
                        return Error.Validation("assetLinkRoleId", "NOT_AVAILABLE", "Select an active relationship.");

                    roleName = role.Name;
                }

                if (await db.Set<TaskAsset>().AnyAsync(l => l.TaskId == taskId && l.AssetId == asset.AssetId, token))
                    return Error.Conflict(TaskSupport.AlreadyLinkedCode, $"'{asset.DisplayName}' is already linked to this task.");

                db.Set<TaskAsset>().Add(new TaskAsset { TaskId = taskId, AssetId = asset.AssetId, MatterId = task.MatterId, AssetLinkRoleId = request.AssetLinkRoleId });
                TaskAudit.AssetLinked(audit, task, asset.AssetId, asset.DisplayName, roleName);
                await db.SaveChangesAsync(token);
                return asset.AssetId;
            },
            ct);
        return done.IsFailure ? Result<TaskAssetLinkResponse>.Failure(done.Error!) : await GetAsync(taskId, done.Value, ct);
    }

    public async Task<Result<TaskAssetLinkResponse>> ChangeRoleAsync(long taskId, int assetId, ChangeTaskAssetRoleRequest request, CancellationToken ct)
    {
        var allowed = RequireEditPermissions();
        if (allowed.IsFailure)
            return Result<TaskAssetLinkResponse>.Failure(allowed.Error!);

        var done = await tx.RunAsync<int>(
            async token =>
            {
                var task = await tx.LockTaskAsync(taskId, token);
                if (task is null)
                    return TaskSupport.NotFound();
                if (TaskEditability.Check(task.Status, TaskOperation.LinkAssets) is { } notEditable)
                    return TaskService.NotEditable(task.Status, notEditable);

                var link = await db.Set<TaskAsset>().SingleOrDefaultAsync(l => l.TaskId == taskId && l.AssetId == assetId, token);
                if (link is null)
                    return LinkNotFound();
                if (!string.IsNullOrEmpty(request.RowVersion))
                {
                    var version = TaskSupport.CheckRowVersion(link.RowVersion, request.RowVersion);
                    if (version.IsFailure)
                        return Result<int>.Failure(version.Error!);
                }

                if (link.AssetLinkRoleId == request.AssetLinkRoleId)
                    return assetId;

                string? newName = null;
                if (request.AssetLinkRoleId is { } roleId)
                {
                    var role = await RoleAsync(roleId, token);
                    if (role is null || !role.IsActive)
                        return Error.Validation("assetLinkRoleId", "NOT_AVAILABLE", "Select an active relationship.");

                    newName = role.Name;
                }

                var oldRole = link.AssetLinkRoleId is { } oldId ? await RoleAsync(oldId, token) : null;
                var asset = await assets.FindAsync(assetId, token);
                link.AssetLinkRoleId = request.AssetLinkRoleId;
                TaskAudit.AssetRoleChanged(audit, task, assetId, asset?.DisplayName ?? $"#{assetId}", oldRole?.Name, newName);
                await db.SaveChangesAsync(token);
                return assetId;
            },
            ct);
        return done.IsFailure ? Result<TaskAssetLinkResponse>.Failure(done.Error!) : await GetAsync(taskId, done.Value, ct);
    }

    public async Task<Result> UnlinkAsync(long taskId, int assetId, CancellationToken ct)
    {
        var allowed = RequireEditPermissions();
        if (allowed.IsFailure)
            return allowed;

        var done = await tx.RunAsync<bool>(
            async token =>
            {
                var task = await tx.LockTaskAsync(taskId, token);
                if (task is null)
                    return TaskSupport.NotFound();
                if (TaskEditability.Check(task.Status, TaskOperation.LinkAssets) is { } notEditable)
                    return TaskService.NotEditable(task.Status, notEditable);

                var link = await db.Set<TaskAsset>().SingleOrDefaultAsync(l => l.TaskId == taskId && l.AssetId == assetId, token);
                if (link is null)
                    return LinkNotFound();

                var role = link.AssetLinkRoleId is { } roleId ? await RoleAsync(roleId, token) : null;
                var asset = await assets.FindAsync(assetId, token);
                db.Set<TaskAsset>().Remove(link);
                TaskAudit.AssetUnlinked(audit, task, assetId, asset?.DisplayName ?? $"#{assetId}", role?.Name);
                await db.SaveChangesAsync(token);
                return true;
            },
            ct);
        return done.IsFailure ? Result.Failure(done.Error!) : Result.Success();
    }

    private Result RequireEditPermissions()
    {
        var link = permissions.Require(Permissions.Asset.Link);
        return link.IsFailure ? link : permissions.Require(Permissions.Task.Edit);
    }

    private static Error LinkNotFound() => Error.NotFound("That asset is not linked to this task.");

    private async Task<AssetLinkRoleInfo?> RoleAsync(int roleId, CancellationToken ct) =>
        (await roles.ListAsync(true, ct)).FirstOrDefault(r => r.Id == roleId);

    private async Task<Result<TaskAssetLinkResponse>> GetAsync(long taskId, int assetId, CancellationToken ct)
    {
        var row = await db.Set<TaskAsset>().AsNoTracking().SingleOrDefaultAsync(l => l.TaskId == taskId && l.AssetId == assetId, ct);
        if (row is null)
            return LinkNotFound();

        return (await ToResponsesAsync([row], ct))[0];
    }

    private async Task<IReadOnlyList<TaskAssetLinkResponse>> ToResponsesAsync(IReadOnlyList<TaskAsset> rows, CancellationToken ct)
    {
        if (rows.Count == 0)
            return [];

        var assetMap = (await assets.FindManyAsync([.. rows.Select(r => r.AssetId)], ct)).ToDictionary(a => a.AssetId);
        var roleMap = (await roles.ListAsync(true, ct)).ToDictionary(r => r.Id);
        var people = await users.FindManyAsync([.. rows.Select(r => r.CreatedByUserId).OfType<int>().Distinct()], ct);
        var canViewAssets = permissions.Has(Permissions.Asset.View);
        return
        [
            .. rows.Select(r =>
            {
                assetMap.TryGetValue(r.AssetId, out var asset);
                AssetLinkRoleInfo? role = null;
                if (r.AssetLinkRoleId is { } roleId)
                    roleMap.TryGetValue(roleId, out role);

                // Names, types and external references are Asset.View data: a caller with Task.View only sees the link, not the asset (SEC2-11).
                return new TaskAssetLinkResponse(
                    r.AssetId,
                    canViewAssets ? asset?.DisplayName ?? $"Asset {r.AssetId}" : $"Asset {r.AssetId}",
                    canViewAssets ? asset?.AssetTypeName ?? string.Empty : string.Empty,
                    canViewAssets ? asset?.ExternalReference : null,
                    asset?.IsActive ?? false,
                    r.AssetLinkRoleId,
                    role?.Name,
                    TaskSupport.Utc(r.CreatedAtUtc),
                    r.CreatedByUserId is { } by && people.TryGetValue(by, out var u) ? new TaskUserRef(u.UserId, u.DisplayName, u.IsActive) : null,
                    TaskSupport.Encode(r.RowVersion));
            }),
        ];
    }
}
