namespace MatterFlow.WorkManagement.Domain;

/// <summary>Fixed internal Task lifecycle states (architecture 8.3). Labels are configurable; these codes are stable.</summary>
public enum TaskStatusCode
{
    New = 0,
    InProgress = 1,
    OnHold = 2,
    Completed = 3,
    Cancelled = 4,
}

public static class TaskStatusCodeExtensions
{
    /// <summary>The persisted/API string code (<c>NEW</c>, <c>IN_PROGRESS</c>, ...).</summary>
    public static string ToCode(this TaskStatusCode status) => status switch
    {
        TaskStatusCode.New => "NEW",
        TaskStatusCode.InProgress => "IN_PROGRESS",
        TaskStatusCode.OnHold => "ON_HOLD",
        TaskStatusCode.Completed => "COMPLETED",
        TaskStatusCode.Cancelled => "CANCELLED",
        _ => throw new ArgumentOutOfRangeException(nameof(status)),
    };

    public static bool TryParse(string? code, out TaskStatusCode status)
    {
        switch (code)
        {
            case "NEW": status = TaskStatusCode.New; return true;
            case "IN_PROGRESS": status = TaskStatusCode.InProgress; return true;
            case "ON_HOLD": status = TaskStatusCode.OnHold; return true;
            case "COMPLETED": status = TaskStatusCode.Completed; return true;
            case "CANCELLED": status = TaskStatusCode.Cancelled; return true;
            default: status = default; return false;
        }
    }

    /// <summary>Open states count toward overdue and block deactivating a Matter (NEW, IN_PROGRESS, ON_HOLD).</summary>
    public static bool IsOpen(this TaskStatusCode status) =>
        status is TaskStatusCode.New or TaskStatusCode.InProgress or TaskStatusCode.OnHold;
}
