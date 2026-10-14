using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.WorkManagement.Domain;

namespace MatterFlow.WorkManagement.Application;

/// <summary>
/// What the caller can do next with a Task: the lifecycle rules (status matrix and editability table) combined with the caller's permissions.
/// Pure, so it is unit-tested; the same rules back the command endpoints.
/// </summary>
public static class TaskActionRules
{
    private static readonly TaskStatusCode[] Targets =
        [TaskStatusCode.InProgress, TaskStatusCode.OnHold, TaskStatusCode.Completed, TaskStatusCode.Cancelled];

    public static TaskAllowedActions Compute(TaskStatusCode status, bool matterActive, Func<string, bool> has)
    {
        ArgumentNullException.ThrowIfNull(has);
        var transitions = new List<TaskTransitionOption>();
        foreach (var target in Targets)
        {
            if (!TaskLifecycle.IsStructurallyAllowed(status, target))
                continue;

            // Ask the matrix with every fact in the user's favor to learn the action and the permission it needs.
            var decision = TaskLifecycle.Evaluate(status, target, new TransitionContext(MatterActive: true, HasComment: true, CompletionReady: true));
            if (!decision.Allowed)
                continue;

            var permission = decision.RequiredPermission!;
            var isReopen = status is TaskStatusCode.Completed or TaskStatusCode.Cancelled && target == TaskStatusCode.InProgress;
            string? blocked = null;
            if (!has(permission))
                blocked = ErrorCodes.PermissionDenied;
            else if (isReopen && !matterActive)
                blocked = ErrorCodes.MatterInactive;

            transitions.Add(new TaskTransitionOption(
                ActionFor(status, target),
                target.ToCode(),
                decision.Effects!.RequiredCommentPurpose is not null,
                permission,
                blocked is null,
                blocked));
        }

        var editable = TaskEditability.IsAllowed(status, TaskOperation.EditDetails);
        var canStepReopen = TaskEditability.IsAllowed(status, TaskOperation.StepReopen) && has(Permissions.Workflow.StepReopen)
            && (status != TaskStatusCode.Completed || matterActive);
        return new TaskAllowedActions(
            editable && has(Permissions.Task.Edit),
            TaskEditability.IsAllowed(status, TaskOperation.AssignOrPrioritize) && has(Permissions.Task.Assign),
            TaskEditability.IsAllowed(status, TaskOperation.AssignOrPrioritize) && has(Permissions.Task.SetPriority),
            has(Permissions.Task.Comment),
            TaskEditability.IsAllowed(status, TaskOperation.StepAction) && has(Permissions.Workflow.Execute),
            canStepReopen,
            transitions);
    }

    private static string ActionFor(TaskStatusCode from, TaskStatusCode to) => (from, to) switch
    {
        (TaskStatusCode.New, TaskStatusCode.InProgress) => "START",
        (TaskStatusCode.OnHold, TaskStatusCode.InProgress) => "RESUME",
        (_, TaskStatusCode.InProgress) => "REOPEN",
        (_, TaskStatusCode.OnHold) => "HOLD",
        (_, TaskStatusCode.Completed) => "COMPLETE",
        _ => "CANCEL",
    };
}
