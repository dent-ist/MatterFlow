using MatterFlow.SharedKernel.Results;

namespace MatterFlow.WorkManagement.Domain;

/// <summary>Operations whose availability depends on Task status (architecture 8.3 rule 5).</summary>
public enum TaskOperation
{
    /// <summary>Details, form values, project, due date, requestor.</summary>
    EditDetails,

    /// <summary>Assign or unassign Pod or user; set priority.</summary>
    AssignOrPrioritize,

    LinkAssets,

    /// <summary>Step start, save, complete, skip.</summary>
    StepAction,

    StepReopen,

    /// <summary>Add a comment; edit or delete one's own comment.</summary>
    Comment,
}

public static class TaskEditability
{
    public static bool IsAllowed(TaskStatusCode status, TaskOperation operation) => operation switch
    {
        TaskOperation.EditDetails or TaskOperation.AssignOrPrioritize or TaskOperation.LinkAssets =>
            status is TaskStatusCode.New or TaskStatusCode.InProgress or TaskStatusCode.OnHold,
        TaskOperation.StepAction => status is TaskStatusCode.New or TaskStatusCode.InProgress,
        TaskOperation.StepReopen => status is TaskStatusCode.InProgress or TaskStatusCode.Completed,
        TaskOperation.Comment => true,
        _ => throw new ArgumentOutOfRangeException(nameof(operation)),
    };

    /// <summary>Null when allowed; otherwise the stable error code (TASK_NOT_EDITABLE).</summary>
    public static string? Check(TaskStatusCode status, TaskOperation operation) =>
        IsAllowed(status, operation) ? null : ErrorCodes.TaskNotEditable;
}
