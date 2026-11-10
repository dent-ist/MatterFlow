using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.WorkManagement.Application;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkManagement.Api;

/// <summary>Permission policy names for the Task endpoints ("Perm:" plus the permission code, resolved by the Identity module).</summary>
internal static class TaskPolicies
{
    private const string Prefix = "Perm:";

    public const string View = Prefix + Permissions.Task.View;
    public const string Create = Prefix + Permissions.Task.Create;
    public const string Edit = Prefix + Permissions.Task.Edit;
    public const string Assign = Prefix + Permissions.Task.Assign;
    public const string SetPriority = Prefix + Permissions.Task.SetPriority;
    public const string ChangeStatus = Prefix + Permissions.Task.ChangeStatus;
    public const string Complete = Prefix + Permissions.Task.Complete;
    public const string Cancel = Prefix + Permissions.Task.Cancel;
    public const string Reopen = Prefix + Permissions.Task.Reopen;
    public const string Execute = Prefix + Permissions.Workflow.Execute;
    public const string StepReopen = Prefix + Permissions.Workflow.StepReopen;
}

/// <summary>
/// Tasks: the unit of work. Created on an active Matter with exactly one eligible workflow, a Task Type request form, a required priority
/// and an optional due date, Pod and user. Matter, Task Type and Workflow never change; everything else is editable until the Task is
/// Completed or Cancelled (reopen it first). Writes return the whole updated Task with its new <c>rowVersion</c>.
/// </summary>
[ApiController]
[Route("api/v1/tasks")]
public class TasksController(TaskService tasks, TaskLifecycleService lifecycle) : ControllerBase
{
    /// <summary>
    /// Lists Tasks (minimal list; the full queue is a later feature). Filters: matterId, projectId, status (comma list), assigneeId, podId,
    /// taskTypeId, priorityId, q. Sort: <c>default</c> (priority, ASAP first, due, oldest), createdAt (default, newest first), dueAt, title, taskNumber, priority.
    /// </summary>
    [HttpGet(Name = "ListTasks")]
    [Authorize(Policy = TaskPolicies.View)]
    [ProducesResponseType<PagedResult<TaskListItem>>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<PagedResult<TaskListItem>>> List([FromQuery] TaskListQuery query, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, TaskListQuery.Keys).OrThrow();
        return (await tasks.ListAsync(query, cancellationToken)).OrThrow();
    }

    /// <summary>
    /// Gets a Task with everything the detail screen needs: resolved names, request form values and version, the workflow with progress and
    /// reopened-prerequisite flags, the allowed next actions for the caller, and the stored reason of a Cancel or On Hold.
    /// </summary>
    [HttpGet("{taskId:long}", Name = "GetTask")]
    [Authorize(Policy = TaskPolicies.View)]
    [ProducesResponseType<TaskResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<TaskResponse>> Get(long taskId, CancellationToken cancellationToken) =>
        (await tasks.GetAsync(taskId, cancellationToken)).OrThrow();

    /// <summary>
    /// Creates a Task in one transaction: validates the Matter (active), Project (same Matter, active), Task Type, the chosen eligible workflow
    /// and the request form values, instantiates the workflow, numbers the Task (TSK-n) and applies assignment. Assigning a user starts the Task.
    /// Assigning needs Task.Assign and a non-default priority needs Task.SetPriority (all of, or nothing is created).
    /// </summary>
    [HttpPost(Name = "CreateTask")]
    [Authorize(Policy = TaskPolicies.Create)]
    [ProducesResponseType<TaskResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<ActionResult<TaskResponse>> Create([FromBody] CreateTaskRequest request, CancellationToken cancellationToken)
    {
        var task = (await tasks.CreateAsync(request, cancellationToken)).OrThrow();
        return CreatedAtRoute("GetTask", new { taskId = task.TaskId }, task);
    }

    /// <summary>
    /// Edits details, project, due date, requestor and request form values of a Task that is New, In Progress or On Hold. Changing the priority
    /// also needs Task.SetPriority. Only changed form fields are validated; hidden values are dropped and listed in <c>droppedFields</c>.
    /// </summary>
    [HttpPut("{taskId:long}", Name = "UpdateTask")]
    [Authorize(Policy = TaskPolicies.Edit)]
    [ProducesResponseType<TaskResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<TaskResponse>> Update(long taskId, [FromBody] UpdateTaskRequest request, CancellationToken cancellationToken) =>
        (await tasks.UpdateAsync(taskId, request, cancellationToken)).OrThrow();

    /// <summary>
    /// Sets the Pod and the user (null clears). Assigning a user to a New Task starts it; unassigning never reverts the status. A user who is
    /// not in the Pod is allowed and reported in <c>warnings</c> (USER_NOT_IN_POD).
    /// </summary>
    [HttpPost("{taskId:long}/assignment", Name = "AssignTask")]
    [Authorize(Policy = TaskPolicies.Assign)]
    [ProducesResponseType<TaskResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<TaskResponse>> Assign(long taskId, [FromBody] AssignTaskRequest request, CancellationToken cancellationToken) =>
        (await tasks.AssignAsync(taskId, request, cancellationToken)).OrThrow();

    /// <summary>
    /// Assigns at most 10 tasks to one user in one request (the Users tab's "Assign the next 3" and checked rows). Every task is an ordinary
    /// assignment with its own audit entries and auto-start; the response lists the result per task and a failed task does not undo the others.
    /// </summary>
    [HttpPost("assign-batch", Name = "AssignTasksBatch")]
    [Authorize(Policy = TaskPolicies.Assign)]
    [ProducesResponseType<AssignTasksBatchResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<AssignTasksBatchResponse>> AssignBatch([FromBody] AssignTasksBatchRequest request, CancellationToken cancellationToken) =>
        (await tasks.AssignBatchAsync(request, cancellationToken)).OrThrow();

    /// <summary>Sets the priority of a Task that is New, In Progress or On Hold.</summary>
    [HttpPost("{taskId:long}/priority", Name = "SetTaskPriority")]
    [Authorize(Policy = TaskPolicies.SetPriority)]
    [ProducesResponseType<TaskResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<TaskResponse>> SetPriority(long taskId, [FromBody] SetTaskPriorityRequest request, CancellationToken cancellationToken) =>
        (await tasks.SetPriorityAsync(taskId, request, cancellationToken)).OrThrow();

    /// <summary>
    /// Changes the status per the lifecycle matrix: IN_PROGRESS (start, resume or reopen), ON_HOLD (comment required), COMPLETED, CANCELLED (comment
    /// required). The permission needed depends on the transition (Task.ChangeStatus, Task.Complete, Task.Cancel, Task.Reopen); the dedicated
    /// complete, cancel and reopen endpoints are the same operations with their own policy.
    /// </summary>
    [HttpPost("{taskId:long}/status", Name = "ChangeTaskStatus")]
    [Authorize(Policy = TaskPolicies.ChangeStatus)]
    [ProducesResponseType<TaskResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<TaskResponse>> ChangeStatus(long taskId, [FromBody] ChangeTaskStatusRequest request, CancellationToken cancellationToken)
    {
        if (!TaskStatusCodeExtensions.TryParse(request.Status?.Trim().ToUpperInvariant(), out var target))
            throw new ErrorException(Error.Validation("status", "UNKNOWN_STATUS", "Status must be one of NEW, IN_PROGRESS, ON_HOLD, COMPLETED, CANCELLED."));

        return (await lifecycle.ChangeStatusAsync(taskId, target, request.Comment, false, request.RowVersion, cancellationToken, onHoldReasonId: request.OnHoldReasonId)).OrThrow();
    }

    /// <summary>
    /// Completes the Task. With unresolved steps: 409 COMPLETION_BLOCKED (meta.unresolvedStepIds, meta.stepsMissingInputs), unless
    /// <c>completeUnresolvedSteps</c> is true (needs Workflow.Execute too): then every unresolved step with all required inputs is completed
    /// (as Completed, never Skipped) and the Task completed in the same transaction. If a step lacks required inputs nothing changes.
    /// </summary>
    [HttpPost("{taskId:long}/complete", Name = "CompleteTask")]
    [Authorize(Policy = TaskPolicies.Complete)]
    [ProducesResponseType<TaskResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<TaskResponse>> Complete(long taskId, [FromBody] CompleteTaskRequest request, CancellationToken cancellationToken) =>
        (await lifecycle.ChangeStatusAsync(taskId, TaskStatusCode.Completed, null, request.CompleteUnresolvedSteps, request.RowVersion, cancellationToken, workflowRowVersion: request.WorkflowRowVersion)).OrThrow();

    /// <summary>What completing would do: the unresolved steps, the ones a bulk completion can finish and the ones missing required inputs.</summary>
    [HttpGet("{taskId:long}/completion", Name = "GetTaskCompletionCheck")]
    [Authorize(Policy = TaskPolicies.View)]
    [ProducesResponseType<TaskCompletionCheck>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<TaskCompletionCheck>> CompletionCheck(long taskId, CancellationToken cancellationToken) =>
        (await lifecycle.CheckCompletionAsync(taskId, cancellationToken)).OrThrow();

    /// <summary>Cancels the Task at any time (even Completed) with a mandatory comment, stored as a comment that can never be deleted. Unresolved steps do not block.</summary>
    [HttpPost("{taskId:long}/cancel", Name = "CancelTask")]
    [Authorize(Policy = TaskPolicies.Cancel)]
    [ProducesResponseType<TaskResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<TaskResponse>> Cancel(long taskId, [FromBody] CancelTaskRequest request, CancellationToken cancellationToken) =>
        (await lifecycle.ChangeStatusAsync(taskId, TaskStatusCode.Cancelled, request.Comment, false, request.RowVersion, cancellationToken)).OrThrow();

    /// <summary>Moves a Completed or Cancelled Task back to In Progress. The Matter must be active (409 MATTER_INACTIVE).</summary>
    [HttpPost("{taskId:long}/reopen", Name = "ReopenTask")]
    [Authorize(Policy = TaskPolicies.Reopen)]
    [ProducesResponseType<TaskResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<TaskResponse>> Reopen(long taskId, [FromBody] ReopenTaskRequest request, CancellationToken cancellationToken) =>
        (await lifecycle.ChangeStatusAsync(
            taskId,
            TaskStatusCode.InProgress,
            null,
            false,
            request.RowVersion,
            cancellationToken,
            [TaskStatusCode.Completed, TaskStatusCode.Cancelled])).OrThrow();
}

/// <summary>
/// The Task's workflow and its step actions. A step action is blocked while the Task is On Hold or closed (409 TASK_NOT_EDITABLE); reopening a
/// step of a Completed Task moves the Task back to In Progress in the same transaction. <c>rowVersion</c> in the requests is the workflow's
/// (from the workflow view) and optional.
/// </summary>
[ApiController]
[Route("api/v1/tasks/{taskId:long}/workflow")]
public class TaskWorkflowController(TaskService tasks, TaskWorkflowService workflow) : ControllerBase
{
    /// <summary>The Task's workflow instance: steps in order, their states and saved values, progress, current step and reopened prerequisites.</summary>
    [HttpGet(Name = "GetTaskWorkflow")]
    [Authorize(Policy = TaskPolicies.View)]
    [ProducesResponseType<TaskWorkflowResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<TaskWorkflowResponse>> Get(long taskId, CancellationToken cancellationToken) =>
        (await tasks.GetWorkflowAsync(taskId, cancellationToken)).OrThrow();

    /// <summary>Starts a pending step (ordering guard applies in ordered workflows).</summary>
    [HttpPost("steps/{stepInstanceId:int}/start", Name = "StartTaskStep")]
    [Authorize(Policy = TaskPolicies.Execute)]
    [ProducesResponseType<StepActionResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<StepActionResponse>> Start(long taskId, int stepInstanceId, [FromBody] StartStepRequest request, CancellationToken cancellationToken) =>
        (await workflow.RunAsync(taskId, stepInstanceId, StepOperation.Start, new TaskWorkflowService.StepInput(request.RowVersion), cancellationToken)).OrThrow();

    /// <summary>Saves draft input values (a patch; required fields are not enforced yet) and/or the skip comment of an unresolved step.</summary>
    [HttpPost("steps/{stepInstanceId:int}/values", Name = "SaveTaskStepValues")]
    [Authorize(Policy = TaskPolicies.Execute)]
    [ProducesResponseType<StepActionResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<StepActionResponse>> SaveValues(long taskId, int stepInstanceId, [FromBody] SaveStepValuesRequest request, CancellationToken cancellationToken) =>
        (await workflow.RunAsync(taskId, stepInstanceId, StepOperation.Values, new TaskWorkflowService.StepInput(request.RowVersion, request.Values, request.SkipComment), cancellationToken)).OrThrow();

    /// <summary>Completes a step, saving optional values first. Every required input must be present (400 FORM_VALIDATION_FAILED otherwise).</summary>
    [HttpPost("steps/{stepInstanceId:int}/complete", Name = "CompleteTaskStep")]
    [Authorize(Policy = TaskPolicies.Execute)]
    [ProducesResponseType<StepActionResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<StepActionResponse>> Complete(long taskId, int stepInstanceId, [FromBody] CompleteStepRequest request, CancellationToken cancellationToken) =>
        (await workflow.RunAsync(taskId, stepInstanceId, StepOperation.Complete, new TaskWorkflowService.StepInput(request.RowVersion, request.Values), cancellationToken)).OrThrow();

    /// <summary>Skips a skippable step (409 STEP_NOT_SKIPPABLE), with a comment when the step requires one (400 SKIP_COMMENT_REQUIRED).</summary>
    [HttpPost("steps/{stepInstanceId:int}/skip", Name = "SkipTaskStep")]
    [Authorize(Policy = TaskPolicies.Execute)]
    [ProducesResponseType<StepActionResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<StepActionResponse>> Skip(long taskId, int stepInstanceId, [FromBody] SkipStepRequest request, CancellationToken cancellationToken) =>
        (await workflow.RunAsync(taskId, stepInstanceId, StepOperation.Skip, new TaskWorkflowService.StepInput(request.RowVersion, Comment: request.Comment), cancellationToken)).OrThrow();

    /// <summary>
    /// Reopens a completed or skipped step; later steps keep their state. On a Completed Task the Task moves back to In Progress in the same
    /// transaction (response <c>taskStatusChanged</c>). Needs an active Matter in that case. Not allowed on a Cancelled Task.
    /// </summary>
    [HttpPost("steps/{stepInstanceId:int}/reopen", Name = "ReopenTaskStep")]
    [Authorize(Policy = TaskPolicies.StepReopen)]
    [ProducesResponseType<StepActionResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<StepActionResponse>> Reopen(long taskId, int stepInstanceId, [FromBody] ReopenStepRequest request, CancellationToken cancellationToken) =>
        (await workflow.RunAsync(taskId, stepInstanceId, StepOperation.Reopen, new TaskWorkflowService.StepInput(request.RowVersion), cancellationToken)).OrThrow();
}
