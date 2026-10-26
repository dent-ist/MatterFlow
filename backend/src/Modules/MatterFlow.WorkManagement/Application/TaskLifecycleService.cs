using MatterFlow.Audit.Contracts;
using MatterFlow.Configuration.Contracts;
using MatterFlow.Identity.Contracts;
using MatterFlow.Organization.Contracts;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Time;
using MatterFlow.WorkflowEngine.Contracts;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace MatterFlow.WorkManagement.Application;

/// <summary>
/// Task status changes (ticket 42): the lifecycle matrix with the permission each transition needs, the mandatory non-deletable comment for
/// Cancel and On Hold, reopen (needs an active Matter), and Complete with the all-or-nothing bulk completion of unresolved steps (addendum K).
/// Each command is one transaction: step completion, the comment, the status change and the audit rows commit together or not at all.
/// </summary>
public sealed class TaskLifecycleService(
    DbContext db,
    TaskTransactions tx,
    TaskPresenter presenter,
    IAuditWriter audit,
    IPermissionChecker permissions,
    ICurrentUser currentUser,
    IClock clock,
    IMatterDirectory matters,
    IWorkflowInstanceService workflows,
    TaskAccess access,
    IOnHoldReasonCatalog onHoldReasons,
    IConfiguration configuration)
{
    /// <summary>The Task's completion check: what is unresolved and what a bulk completion would do. Read-only.</summary>
    public async Task<Result<TaskCompletionCheck>> CheckCompletionAsync(long taskId, CancellationToken ct)
    {
        var instanceId = await access.Visible().Where(t => t.Id == taskId).Select(t => (long?)t.WorkflowInstanceId).SingleOrDefaultAsync(ct);
        if (instanceId is null)
            return TaskSupport.NotFound();

        var evaluation = await workflows.EvaluateCompletionAsync(instanceId.Value, ct);
        if (evaluation.IsFailure)
            return Result<TaskCompletionCheck>.Failure(evaluation.Error!);

        var e = evaluation.Value;
        static IReadOnlyList<TaskStepRef> Map(IReadOnlyList<StepRef> steps) => [.. steps.Select(s => new TaskStepRef(s.StepInstanceId, s.SequenceNo, s.Title))];
        return new TaskCompletionCheck(e.IsReady, e.CanBulkComplete, Map(e.Unresolved), Map(e.BulkCompletable), Map(e.Blocked), e.RowVersion);
    }

    /// <summary>
    /// Moves the Task to <paramref name="target"/> per the matrix. <paramref name="comment"/> is mandatory for ON_HOLD and CANCELLED.
    /// <paramref name="completeUnresolvedSteps"/> only matters for COMPLETED.
    /// </summary>
    /// <param name="onlyFrom">When set, the Task must currently be in one of these statuses (the reopen endpoint uses it).</param>
    public async Task<Result<TaskResponse>> ChangeStatusAsync(
        long taskId,
        TaskStatusCode target,
        string? comment,
        bool completeUnresolvedSteps,
        string rowVersion,
        CancellationToken ct,
        IReadOnlyCollection<TaskStatusCode>? onlyFrom = null,
        string? workflowRowVersion = null,
        int? onHoldReasonId = null)
    {
        var done = await tx.RunAsync(token => ChangeCoreAsync(taskId, target, comment, completeUnresolvedSteps, rowVersion, onlyFrom, workflowRowVersion, onHoldReasonId, token), ct);
        return done.IsFailure ? done.Error! : await presenter.GetAsync(taskId, done.Value, ct, afterWrite: true);
    }

    private async Task<Result<CommandNotes>> ChangeCoreAsync(
        long taskId,
        TaskStatusCode target,
        string? comment,
        bool completeUnresolvedSteps,
        string rowVersion,
        IReadOnlyCollection<TaskStatusCode>? onlyFrom,
        string? workflowRowVersion,
        int? onHoldReasonId,
        CancellationToken ct)
    {
        var task = await tx.LockTaskAsync(taskId, ct);
        if (task is null)
            return TaskSupport.NotFound();

        var version = TaskSupport.CheckRowVersion(task.RowVersion, rowVersion);
        if (version.IsFailure)
            return Result<CommandNotes>.Failure(version.Error!);

        var from = task.Status;
        if (onlyFrom is not null && !onlyFrom.Contains(from))
            return Error.Conflict(ErrorCodes.InvalidStatusTransition, $"Only a completed or cancelled task can be reopened; this one is {from.ToCode()}.");

        // 1. Structure and permission, with every contextual fact in the caller's favor.
        var probe = TaskLifecycle.Evaluate(from, target, new TransitionContext(MatterActive: true, HasComment: true, CompletionReady: true));
        if (!probe.Allowed)
            return Error.Conflict(probe.ErrorCode!, $"Cannot move a {from.ToCode()} task to {target.ToCode()}.");

        var allowed = permissions.Require(probe.RequiredPermission!);
        if (allowed.IsFailure)
            return Result<CommandNotes>.Failure(allowed.Error!);

        // 2. Context facts: Matter state for a reopen, the comment for Cancel / On Hold.
        var matterActive = true;
        var isReopen = from is TaskStatusCode.Completed or TaskStatusCode.Cancelled && target == TaskStatusCode.InProgress;
        if (isReopen)
        {
            await tx.LockMatterAsync(task.MatterId, ct);
            matterActive = (await matters.FindAsync(task.MatterId, ct))?.IsActive ?? false;
        }

        var hasComment = !string.IsNullOrWhiteSpace(comment);
        var decision = TaskLifecycle.Evaluate(from, target, new TransitionContext(MatterActive: matterActive, HasComment: hasComment, CompletionReady: true));
        if (!decision.Allowed)
            return DecisionError(decision.ErrorCode!, from, target);

        // The structured reason of a hold: optional unless the firm requires it, an active reason only, and only with ON_HOLD.
        OnHoldReasonInfo? holdReason = null;
        if (target == TaskStatusCode.OnHold)
        {
            if (onHoldReasonId is { } wanted)
            {
                holdReason = await onHoldReasons.GetAsync(wanted, ct);
                if (holdReason is not { IsActive: true })
                    return Error.Validation("onHoldReasonId", "UNKNOWN_ON_HOLD_REASON", "Choose a reason from the list.");
            }
            else if (bool.TryParse(configuration["Tasks:OnHoldReasonRequired"], out var required) && required)
            {
                return Error.Validation("onHoldReasonId", "ON_HOLD_REASON_REQUIRED", "Choose why the task is being put on hold.");
            }
        }
        else if (onHoldReasonId is not null)
        {
            return Error.Validation("onHoldReasonId", "ON_HOLD_REASON_NOT_ALLOWED", "A reason is only given when the task is put on hold.");
        }

        // 3. Completion rule and bulk completion (addendum K), in this transaction.
        IReadOnlyList<int> bulkCompleted = [];
        if (target == TaskStatusCode.Completed)
        {
            var completion = await CompletionAsync(task, completeUnresolvedSteps, workflowRowVersion, ct);
            if (completion.IsFailure)
                return Result<CommandNotes>.Failure(completion.Error!);

            bulkCompleted = completion.Value;
        }

        // 4. The mandatory reason comment, then the status change.
        long? commentId = null;
        var now = clock.UtcNow;
        if (decision.Effects!.RequiredCommentPurpose is { } purpose)
        {
            if (currentUser.UserId is not { } authorId)
                return Error.Unauthenticated("A signed-in user is required to comment.");

            var reason = new TaskComment { TaskId = task.Id, AuthorUserId = authorId, Purpose = purpose, BodyHtml = TaskSupport.ToSafeHtml(comment!) };
            db.Set<TaskComment>().Add(reason);
            await db.SaveChangesAsync(ct);
            commentId = reason.Id;
            TaskAudit.CommentAdded(audit, task, reason);
        }

        task.Status = target;
        task.OnHoldReasonId = holdReason?.Id; // set by a hold, cleared by any other change (a task leaving On Hold)
        if (decision.Effects.UpdateStatusChangedAt)
            task.StatusChangedAtUtc = now;
        if (decision.Effects.SetCompletedAt)
            task.CompletedAtUtc = now;
        else if (decision.Effects.ClearCompletedAt)
            task.CompletedAtUtc = null;

        task.ModifiedAtUtc = now;
        task.ModifiedByUserId = currentUser.UserId;
        db.Entry(task).Property(t => t.ModifiedAtUtc).IsModified = true;
        TaskSupport.TrackOriginalRowVersion(db, task, rowVersion);
        TaskAudit.StatusChanged(
            audit,
            task,
            from,
            target,
            "MANUAL",
            commentId,
            string.Join("; ", new[] { holdReason is null ? null : $"onHoldReason={holdReason.Name}", bulkCompleted.Count > 0 ? $"bulk completed {bulkCompleted.Count} step(s)" : null }.OfType<string>()) is { Length: > 0 } note ? note : null);

        await db.SaveChangesAsync(ct);
        return new CommandNotes([], [], bulkCompleted);
    }

    /// <summary>
    /// The completion rule: every step is resolved, or - when the caller confirmed - every unresolved step is bulk-completed first.
    /// Blocked (a step lacks required inputs) changes nothing: 409 COMPLETION_BLOCKED with the step ids in the meta.
    /// </summary>
    private async Task<Result<IReadOnlyList<int>>> CompletionAsync(WorkTask task, bool completeUnresolvedSteps, string? workflowRowVersion, CancellationToken ct)
    {
        var evaluation = await workflows.EvaluateCompletionAsync(task.WorkflowInstanceId, ct);
        if (evaluation.IsFailure)
            return Result<IReadOnlyList<int>>.Failure(evaluation.Error!);

        if (evaluation.Value.IsReady)
            return Result<IReadOnlyList<int>>.Success([]);

        if (!completeUnresolvedSteps)
            return Result<IReadOnlyList<int>>.Failure(evaluation.Value.ToBlockedError());

        var execute = permissions.Require(Permissions.Workflow.Execute);
        if (execute.IsFailure)
            return Result<IReadOnlyList<int>>.Failure(execute.Error!);

        // The user confirmed a list of steps they saw: complete only if the workflow is still in the state that list came from (SEC2-08).
        if (string.IsNullOrWhiteSpace(workflowRowVersion))
            return Error.Validation("workflowRowVersion", "REQUIRED", "Reload the task and confirm the list of steps again.");

        var outcome = await workflows.BulkCompleteUnresolvedAsync(task.WorkflowInstanceId, new StepActionContext(task.Status, task.Id, task.MatterId, workflowRowVersion), ct);
        return outcome.IsFailure
            ? Result<IReadOnlyList<int>>.Failure(outcome.Error!)
            : Result<IReadOnlyList<int>>.Success(outcome.Value.AffectedStepInstanceIds);
    }

    private static Error DecisionError(string code, TaskStatusCode from, TaskStatusCode target) => code switch
    {
        ErrorCodes.CancelCommentRequired => Error.Validation("comment", code, "Enter a comment saying why the task is being cancelled.", ErrorCodes.CancelCommentRequired),
        ErrorCodes.HoldCommentRequired => Error.Validation("comment", code, "Enter a comment saying why the task is being put on hold.", ErrorCodes.HoldCommentRequired),
        ErrorCodes.MatterInactive => Error.Conflict(ErrorCodes.MatterInactive, "The matter is inactive; reactivate it before reopening the task."),
        _ => Error.Conflict(code, $"Cannot move a {from.ToCode()} task to {target.ToCode()}."),
    };
}
