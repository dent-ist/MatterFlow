using MatterFlow.Audit.Contracts;
using MatterFlow.Configuration.Contracts;
using MatterFlow.Identity.Contracts;
using MatterFlow.Organization.Contracts;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkManagement.Application;

/// <summary>
/// Bulk re-assign and re-prioritise inside ONE matter (epic #667, issue #685). The request is checked as a whole first (matter, permissions per field,
/// assignee, priority, size: a bad request is a 400/403/404 and nothing is touched); then every task goes through the single-task commands
/// (<see cref="TaskService.AssignCoreAsync"/> and <see cref="TaskService.SetPriorityCoreAsync"/>) in its own transaction, so a task never ends
/// half-changed and one failure does not undo the others. The response lists every task, so no failure is hidden; the audit entries of the whole batch share the request's correlation id.
/// </summary>
public sealed class TaskBulkService(
    DbContext db,
    TaskService tasks,
    TaskTransactions tx,
    IPermissionChecker permissions,
    IMatterDirectory matters,
    IPriorityCatalog priorities,
    IPodDirectory pods,
    IUserDirectory users,
    IAuditCorrelation correlation,
    TaskAccess access)
{
    public async Task<Result<BulkTasksResponse>> ChangeAsync(int matterId, BulkTasksRequest request, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.TaskIds.Count is < 1 or > BulkTasksRequest.MaxTasks)
            return Error.Validation("taskIds", "OUT_OF_RANGE", $"Select between 1 and {BulkTasksRequest.MaxTasks} tasks.");
        if (request.TaskIds.Distinct().Count() != request.TaskIds.Count)
            return Error.Validation("taskIds", "DUPLICATE", "A task can appear only once.");
        var reassign = request.ReassignTo;
        if (reassign is null && request.PriorityId is null)
            return Error.Validation("reassignTo", "NOTHING_TO_CHANGE", "Choose a new assignee, a new priority, or both.");
        if (reassign is not null && reassign.UserId is null && reassign.PodId is null)
            return Error.Validation("reassignTo", "NOTHING_TO_CHANGE", "Choose a person, a pod, or both.");

        // A matter the caller may not see as a whole (sensitive-matter rule, mode M) answers exactly like one that does not exist.
        if (!await access.CanSeeMatterAsync(matterId, ct) || await matters.FindAsync(matterId, ct) is null)
            return Error.NotFound("The matter does not exist.");

        if (reassign is not null)
        {
            var allowed = permissions.Require(Permissions.Task.Assign);
            if (allowed.IsFailure)
                return allowed.Error!;
        }

        if (request.PriorityId is { } priorityId)
        {
            var allowed = permissions.Require(Permissions.Task.SetPriority);
            if (allowed.IsFailure)
                return allowed.Error!;
            if (!await priorities.IsAssignableAsync(priorityId, ct))
                return Error.Validation("priorityId", "NOT_AVAILABLE", "Select an active priority.");
        }

        if (reassign?.UserId is { } userId)
        {
            var user = await users.FindAsync(userId, ct);
            if (user is null)
                return Error.Validation("reassignTo.userId", "NOT_FOUND", "Select a user.");
            if (!user.IsActive)
                return Error.Validation("reassignTo.userId", "USER_INACTIVE", $"{user.DisplayName} is disabled and can't be assigned work.");
        }

        if (reassign?.PodId is { } podId)
        {
            var pod = await pods.FindAsync(podId, ct);
            if (pod is null)
                return Error.Validation("reassignTo.podId", "NOT_FOUND", "Select a pod.");
            if (!pod.IsActive)
                return Error.Conflict(ErrorCodes.PodInactive, $"Pod '{pod.Name}' is inactive; choose another.");
        }

        var ids = request.TaskIds;
        var known = await access.Visible().Where(t => ids.Contains(t.Id))
            .Select(t => new { t.Id, t.MatterId, t.AssignedPodId, t.RowVersion })
            .ToDictionaryAsync(t => t.Id, ct);

        var results = new List<BulkTaskResult>(ids.Count);
        foreach (var id in ids)
        {
            if (!known.TryGetValue(id, out var task))
            {
                results.Add(new BulkTaskResult(id, false, ErrorCodes.NotFound, "The task does not exist.", []));
                continue;
            }

            if (task.MatterId != matterId)
            {
                results.Add(new BulkTaskResult(id, false, "NOT_IN_MATTER", "The task belongs to a different matter.", []));
                continue;
            }

            var done = await tx.RunAsync(token => ChangeOneAsync(id, task.AssignedPodId, Convert.ToBase64String(task.RowVersion), request, token), ct);
            results.Add(done.IsFailure
                ? new BulkTaskResult(id, false, done.Error!.Code, done.Error.Message, [])
                : new BulkTaskResult(id, true, null, null, done.Value));
        }

        var changed = results.Count(r => r.Ok);
        return new BulkTasksResponse(correlation.Id, changed, results.Count - changed, results);
    }

    private async Task<Result<IReadOnlyList<string>>> ChangeOneAsync(long taskId, int? currentPodId, string rowVersion, BulkTasksRequest request, CancellationToken ct)
    {
        IReadOnlyList<string> warnings = [];
        if (request.ReassignTo is { } to)
        {
            // A person alone keeps the task's pod; a pod alone moves the task to the pod's queue (no person).
            var assigned = await tasks.AssignCoreAsync(
                taskId,
                new AssignTaskRequest { RowVersion = rowVersion, PodId = to.PodId ?? (to.UserId is null ? null : currentPodId), UserId = to.UserId },
                ct);
            if (assigned.IsFailure)
                return Result<IReadOnlyList<string>>.Failure(assigned.Error!);
            warnings = assigned.Value.Warnings;

            // The assignment moved the row version; the priority change must present the new one.
            rowVersion = Convert.ToBase64String(await db.Set<WorkTask>().AsNoTracking().Where(t => t.Id == taskId).Select(t => t.RowVersion).SingleAsync(ct));
        }

        if (request.PriorityId is { } priorityId)
        {
            var set = await tasks.SetPriorityCoreAsync(taskId, new SetTaskPriorityRequest { RowVersion = rowVersion, PriorityId = priorityId }, ct);
            if (set.IsFailure)
                return Result<IReadOnlyList<string>>.Failure(set.Error!);
        }

        return Result<IReadOnlyList<string>>.Success(warnings);
    }
}
