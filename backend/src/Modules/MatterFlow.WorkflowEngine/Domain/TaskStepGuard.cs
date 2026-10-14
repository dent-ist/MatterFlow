using MatterFlow.SharedKernel.Results;

namespace MatterFlow.WorkflowEngine.Domain;

public enum StepAction
{
    Start,
    Save,
    Complete,
    Skip,
    Reopen,
    BulkComplete,
}

/// <summary>Domain effect a permitted step action has on the Task.</summary>
public enum TaskEffect
{
    None,

    /// <summary>Reopening a step on a COMPLETED Task moves it to IN_PROGRESS in the same transaction (cause STEP_REOPEN).</summary>
    MoveTaskToInProgress,
}

/// <summary>Task-level guard for step actions (architecture 8.3 rule 5).</summary>
public static class TaskStepGuard
{
    /// <summary>
    /// NEW and IN_PROGRESS allow every step action (no status change, assumption A-5); ON_HOLD blocks all (resume first);
    /// COMPLETED allows only reopen (effect <see cref="TaskEffect.MoveTaskToInProgress"/>); CANCELLED blocks all.
    /// Blocked actions fail with 409 TASK_NOT_EDITABLE. Matter-active checks for the COMPLETED reopen are the caller's.
    /// </summary>
    public static Result<TaskEffect> StepActionsAllowed(TaskStatusCode status, StepAction action) =>
        status switch
        {
            TaskStatusCode.New or TaskStatusCode.InProgress => TaskEffect.None,
            TaskStatusCode.Completed when action == StepAction.Reopen => TaskEffect.MoveTaskToInProgress,
            TaskStatusCode.OnHold or TaskStatusCode.Completed or TaskStatusCode.Cancelled =>
                Error.Conflict(
                    ErrorCodes.TaskNotEditable,
                    $"Step action {action} is not allowed while the task is {status}.",
                    new Dictionary<string, object?> { ["taskStatus"] = status.ToString(), ["action"] = action.ToString() }),
            _ => throw new ArgumentOutOfRangeException(nameof(status), status, null),
        };
}
