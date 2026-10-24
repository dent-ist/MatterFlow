using System.Text.Json;
using MatterFlow.Audit.Contracts;
using MatterFlow.Organization.Contracts;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Time;
using MatterFlow.WorkflowEngine.Contracts;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkManagement.Application;

/// <summary>Which step action to run.</summary>
public enum StepOperation
{
    Start,
    Values,
    Complete,
    Skip,
    Reopen,
}

/// <summary>
/// The Task side of workflow step actions (part of ticket 39): runs the workflow engine under the per-Task lock with the Task's status in the
/// <see cref="StepActionContext"/> and applies the returned <see cref="TaskEffect"/> (a step reopen on a Completed Task moves it to In Progress) in
/// the same transaction, so the step change, the Task change and both audit trails are all-or-nothing.
/// </summary>
public sealed class TaskWorkflowService(
    DbContext db,
    TaskTransactions tx,
    TaskPresenter presenter,
    IAuditWriter audit,
    ICurrentUser currentUser,
    IClock clock,
    IMatterDirectory matters,
    IWorkflowInstanceService workflows)
{
    /// <summary>One step action's input, whichever action it is.</summary>
    public sealed record StepInput(
        string? WorkflowRowVersion,
        IReadOnlyDictionary<string, JsonElement>? Values = null,
        string? Comment = null);

    private sealed record Done(IReadOnlyList<int> Affected, IReadOnlyList<string> Dropped, bool TaskMoved);

    public async Task<Result<StepActionResponse>> RunAsync(long taskId, int stepInstanceId, StepOperation operation, StepInput input, CancellationToken ct)
    {
        var done = await tx.RunAsync(token => RunCoreAsync(taskId, stepInstanceId, operation, input, token), ct);
        if (done.IsFailure)
            return done.Error!;

        var task = await presenter.GetAsync(taskId, new CommandNotes([], done.Value.Dropped, []), ct, afterWrite: true);
        return task.IsFailure
            ? task.Error!
            : new StepActionResponse(task.Value, done.Value.Affected, done.Value.Dropped, done.Value.TaskMoved);
    }

    private async Task<Result<Done>> RunCoreAsync(long taskId, int stepInstanceId, StepOperation operation, StepInput input, CancellationToken ct)
    {
        var task = await tx.LockTaskAsync(taskId, ct);
        if (task is null)
            return TaskSupport.NotFound();

        // A step reopen on a Completed Task is also a Task status change: it needs an active Matter (architecture 8.3 rule 3).
        if (operation == StepOperation.Reopen && task.Status == TaskStatusCode.Completed)
        {
            await tx.LockMatterAsync(task.MatterId, ct);
            if (!((await matters.FindAsync(task.MatterId, ct))?.IsActive ?? false))
                return Error.Conflict(ErrorCodes.MatterInactive, "The matter is inactive; reactivate it before reopening a step of a completed task.");
        }

        var context = new StepActionContext(task.Status, task.Id, task.MatterId, input.WorkflowRowVersion);
        var instanceId = task.WorkflowInstanceId;
        var outcome = operation switch
        {
            StepOperation.Start => await workflows.StartStepAsync(instanceId, stepInstanceId, context, ct),
            StepOperation.Values => await workflows.SaveStepValuesAsync(instanceId, stepInstanceId, input.Values, input.Comment, context, ct),
            StepOperation.Complete => await workflows.CompleteStepAsync(instanceId, stepInstanceId, input.Values, context, ct),
            StepOperation.Skip => await workflows.SkipStepAsync(instanceId, stepInstanceId, input.Comment, context, ct),
            StepOperation.Reopen => await workflows.ReopenStepAsync(instanceId, stepInstanceId, context, ct),
            _ => throw new ArgumentOutOfRangeException(nameof(operation)),
        };
        if (outcome.IsFailure)
            return Result<Done>.Failure(outcome.Error!);

        var moved = false;
        if (outcome.Value.Effect == TaskEffect.MoveTaskToInProgress)
        {
            var decision = TaskLifecycle.Evaluate(
                task.Status,
                TaskStatusCode.InProgress,
                new TransitionContext(MatterActive: true, Cause: TransitionCause.StepReopen));
            if (!decision.Allowed)
                return Error.Conflict(decision.ErrorCode!, "The task cannot be moved back to In Progress.");

            var from = task.Status;
            var now = clock.UtcNow;
            task.Status = TaskStatusCode.InProgress;
            task.StatusChangedAtUtc = now;
            task.CompletedAtUtc = null;
            task.ModifiedAtUtc = now;
            task.ModifiedByUserId = currentUser.UserId;
            db.Entry(task).Property(t => t.ModifiedAtUtc).IsModified = true;
            TaskAudit.StatusChanged(audit, task, from, TaskStatusCode.InProgress, "STEP_REOPEN");
            await db.SaveChangesAsync(ct);
            moved = true;
        }

        return new Done(outcome.Value.AffectedStepInstanceIds, outcome.Value.DroppedFields, moved);
    }
}
