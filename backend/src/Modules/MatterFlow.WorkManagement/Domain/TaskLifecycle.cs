using MatterFlow.SharedKernel.Results;

namespace MatterFlow.WorkManagement.Domain;

/// <summary>What initiated a status change.</summary>
public enum TransitionCause
{
    /// <summary>A user changed the status directly.</summary>
    Manual = 0,

    /// <summary>Assigning a user to a NEW Task (auto start). Only NEW to IN_PROGRESS.</summary>
    Assignment = 1,

    /// <summary>Reopening a step on a COMPLETED Task (auto reopen). Only COMPLETED to IN_PROGRESS.</summary>
    StepReopen = 2,
}

/// <summary>Facts the lifecycle needs from the caller; all computed by the application layer.</summary>
public sealed record TransitionContext(
    bool MatterActive = true,
    bool HasComment = false,
    bool CompletionReady = true,
    TransitionCause Cause = TransitionCause.Manual);

/// <summary>Side effects of an allowed transition, expressed as data.</summary>
public sealed record TransitionEffects(
    bool SetCompletedAt,
    bool ClearCompletedAt,
    bool UpdateStatusChangedAt,
    TaskCommentPurpose? RequiredCommentPurpose);

/// <summary>Outcome of <see cref="TaskLifecycle.Evaluate"/>.</summary>
public sealed record TransitionDecision(
    bool Allowed,
    string? ErrorCode,
    string? RequiredPermission,
    TransitionEffects? Effects)
{
    public static TransitionDecision Forbidden(string errorCode) => new(false, errorCode, null, null);
}

/// <summary>
/// The table-driven Task status matrix (architecture 8.3). Pure: callers supply the context facts and apply the effects.
/// </summary>
public static class TaskLifecycle
{
    public const string PermChangeStatus = "Task.ChangeStatus";
    public const string PermComplete = "Task.Complete";
    public const string PermCancel = "Task.Cancel";
    public const string PermReopen = "Task.Reopen";
    public const string PermAssign = "Task.Assign";
    public const string PermStepReopen = "Workflow.StepReopen";

    private enum Kind { None, Resume, Complete, Cancel, Hold, Reopen, Start }

    private static readonly Kind[,] Matrix = BuildMatrix();

    private static Kind[,] BuildMatrix()
    {
        var m = new Kind[5, 5];

        void Set(TaskStatusCode f, TaskStatusCode t, Kind k) => m[(int)f, (int)t] = k;

        Set(TaskStatusCode.New, TaskStatusCode.InProgress, Kind.Start);
        Set(TaskStatusCode.New, TaskStatusCode.OnHold, Kind.Hold);
        Set(TaskStatusCode.New, TaskStatusCode.Completed, Kind.Complete);
        Set(TaskStatusCode.New, TaskStatusCode.Cancelled, Kind.Cancel);

        Set(TaskStatusCode.InProgress, TaskStatusCode.OnHold, Kind.Hold);
        Set(TaskStatusCode.InProgress, TaskStatusCode.Completed, Kind.Complete);
        Set(TaskStatusCode.InProgress, TaskStatusCode.Cancelled, Kind.Cancel);

        Set(TaskStatusCode.OnHold, TaskStatusCode.InProgress, Kind.Resume);
        Set(TaskStatusCode.OnHold, TaskStatusCode.Cancelled, Kind.Cancel);

        Set(TaskStatusCode.Completed, TaskStatusCode.InProgress, Kind.Reopen);
        Set(TaskStatusCode.Completed, TaskStatusCode.Cancelled, Kind.Cancel);

        Set(TaskStatusCode.Cancelled, TaskStatusCode.InProgress, Kind.Reopen);
        return m;
    }

    /// <summary>True when the matrix has a non-forbidden cell for (from, to), ignoring context.</summary>
    public static bool IsStructurallyAllowed(TaskStatusCode from, TaskStatusCode to) =>
        from != to && Matrix[(int)from, (int)to] != Kind.None;

    public static TransitionDecision Evaluate(TaskStatusCode from, TaskStatusCode to, TransitionContext context)
    {
        var kind = Matrix[(int)from, (int)to];
        if (from == to || kind == Kind.None)
            return TransitionDecision.Forbidden(ErrorCodes.InvalidStatusTransition);

        // System-initiated causes are valid for exactly one cell each.
        if (context.Cause == TransitionCause.Assignment && !(from == TaskStatusCode.New && to == TaskStatusCode.InProgress))
            return TransitionDecision.Forbidden(ErrorCodes.InvalidStatusTransition);
        if (context.Cause == TransitionCause.StepReopen && !(from == TaskStatusCode.Completed && to == TaskStatusCode.InProgress))
            return TransitionDecision.Forbidden(ErrorCodes.InvalidStatusTransition);

        switch (kind)
        {
            case Kind.Reopen when !context.MatterActive:
                return TransitionDecision.Forbidden(ErrorCodes.MatterInactive);
            case Kind.Cancel when !context.HasComment:
                return TransitionDecision.Forbidden(ErrorCodes.CancelCommentRequired);
            case Kind.Hold when !context.HasComment:
                return TransitionDecision.Forbidden(ErrorCodes.HoldCommentRequired);
            case Kind.Complete when !context.CompletionReady:
                return TransitionDecision.Forbidden(ErrorCodes.CompletionBlocked);
        }

        var permission = kind switch
        {
            Kind.Complete => PermComplete,
            Kind.Cancel => PermCancel,
            Kind.Reopen => context.Cause == TransitionCause.StepReopen ? PermStepReopen : PermReopen,
            Kind.Start => context.Cause == TransitionCause.Assignment ? PermAssign : PermChangeStatus,
            _ => PermChangeStatus,
        };

        var effects = new TransitionEffects(
            SetCompletedAt: to == TaskStatusCode.Completed,
            ClearCompletedAt: from == TaskStatusCode.Completed,
            UpdateStatusChangedAt: true,
            RequiredCommentPurpose: kind switch
            {
                Kind.Cancel => TaskCommentPurpose.Cancel,
                Kind.Hold => TaskCommentPurpose.OnHold,
                _ => null,
            });

        return new TransitionDecision(true, null, permission, effects);
    }
}
