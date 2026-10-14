namespace MatterFlow.WorkManagement.Domain;

/// <summary>Result of applying an assignment change to a Task.</summary>
public sealed record AssignmentOutcome(TaskStatusCode Status, bool AutoStarted, bool UserNotInPodWarning);

public static class TaskAssignment
{
    /// <summary>
    /// Assigning a user (not Pod-only) to a NEW Task starts it. Unassigning never reverts the status. A user outside the Pod is allowed
    /// but flagged as a non-blocking warning. Callers must have checked <see cref="TaskEditability"/> first.
    /// </summary>
    /// <param name="currentStatus">The Task's status before the change.</param>
    /// <param name="newUserId">The assigned user after the change (null = unassigned or Pod-only).</param>
    /// <param name="podId">The Pod after the change, if any.</param>
    /// <param name="userInPod">Whether the user belongs to the Pod; null when unknown or not applicable.</param>
    public static AssignmentOutcome Apply(TaskStatusCode currentStatus, int? newUserId, int? podId, bool? userInPod)
    {
        var autoStart = newUserId is not null && currentStatus == TaskStatusCode.New;
        var warning = newUserId is not null && podId is not null && userInPod == false;
        return new AssignmentOutcome(autoStart ? TaskStatusCode.InProgress : currentStatus, autoStart, warning);
    }
}
