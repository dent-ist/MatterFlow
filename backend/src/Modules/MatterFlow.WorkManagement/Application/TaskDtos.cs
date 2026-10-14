using System.ComponentModel.DataAnnotations;
using System.Text.Json;

namespace MatterFlow.WorkManagement.Application;

// ---- references

/// <summary>The Matter of a Task, with both number parts and the combined reference.</summary>
public sealed record TaskMatterRef(
    [property: Required] int MatterId,
    [property: Required] int ClientId,
    [property: Required] string ClientNumber,
    [property: Required] string MatterNumber,
    [property: Required] string MatterRef,
    [property: Required] string Name,
    [property: Required] bool IsActive,
    [property: Required] bool IsSensitive);

/// <summary>The Project of a Task.</summary>
public sealed record TaskProjectRef([property: Required] int ProjectId, [property: Required] string Name, [property: Required] bool IsActive);

/// <summary>The Task Type of a Task.</summary>
public sealed record TaskTypeRef([property: Required] int TaskTypeId, [property: Required] string Name);

/// <summary>A Priority label (users see the label, never the sort order number).</summary>
public sealed record TaskPriorityRef([property: Required] int PriorityId, [property: Required] string Label, [property: Required] string Color, [property: Required] int SortOrder);

/// <summary>A Pod.</summary>
public sealed record TaskPodRef([property: Required] int PodId, [property: Required] string Name, [property: Required] bool IsActive);

/// <summary>A user (assignee, creator, comment author).</summary>
public sealed record TaskUserRef([property: Required] int UserId, [property: Required] string DisplayName, [property: Required] bool IsActive);

/// <summary>The stored reason of the latest Cancel or On Hold (the mandatory comment).</summary>
public sealed record TaskStatusReason(
    [property: Required] long CommentId,
    [property: Required] string Purpose,
    [property: Required] string BodyHtml,
    [property: Required] int AuthorUserId,
    [property: Required] string AuthorName,
    [property: Required] DateTime CreatedAtUtc);

// ---- workflow view

/// <summary>Progress counts of the Task's workflow.</summary>
public sealed record TaskWorkflowProgress(
    [property: Required] int Total,
    [property: Required] int Pending,
    [property: Required] int InProgress,
    [property: Required] int Completed,
    [property: Required] int Skipped,
    [property: Required] int Resolved,
    int? CurrentStepInstanceId,
    [property: Required] IReadOnlyList<int> ReopenedPrerequisiteStepInstanceIds);

/// <summary>One step of the Task's workflow: snapshot text, state and saved input values.</summary>
public sealed record TaskStepInstance(
    [property: Required] int StepInstanceId,
    [property: Required] int SequenceNo,
    [property: Required] string Title,
    string? Description,
    string? Instructions,
    string? DocumentationUrl,
    int? InputFormVersionId,
    [property: Required] bool IsSkippable,
    [property: Required] bool SkipCommentRequired,
    [property: Required] string Status,
    [property: Required] bool HasBeenResolved,
    [property: Required] bool IsCurrent,
    [property: Required] bool IsReopenedPrerequisite,
    [property: Required] bool RequiredInputsSatisfied,
    string? SkipComment,
    DateTime? FirstResolvedAtUtc,
    DateTime? ResolvedAtUtc,
    int? ResolvedByUserId,
    [property: Required] IReadOnlyDictionary<string, JsonElement> Values);

/// <summary>The Task's workflow instance with its steps in workflow order.</summary>
public sealed record TaskWorkflowResponse(
    [property: Required] long WorkflowInstanceId,
    [property: Required] int WorkflowDefinitionId,
    [property: Required] string WorkflowName,
    [property: Required] int WorkflowVersionId,
    [property: Required] int VersionNo,
    [property: Required] bool IsOrdered,
    [property: Required] string RowVersion,
    [property: Required] TaskWorkflowProgress Progress,
    [property: Required] IReadOnlyList<TaskStepInstance> Steps);

// ---- allowed actions

/// <summary>A status change that is structurally possible from the current status.</summary>
/// <param name="Action">START, RESUME, HOLD, COMPLETE, CANCEL or REOPEN.</param>
/// <param name="TargetStatus">The status code the action leads to.</param>
/// <param name="RequiresComment">True for HOLD and CANCEL: the request must carry a comment.</param>
/// <param name="RequiredPermission">The permission code the caller needs.</param>
/// <param name="Permitted">True when the caller holds the permission and nothing else blocks the action.</param>
/// <param name="BlockedReason">Why it is not permitted: PERMISSION_DENIED or MATTER_INACTIVE.</param>
public sealed record TaskTransitionOption(
    [property: Required] string Action,
    [property: Required] string TargetStatus,
    [property: Required] bool RequiresComment,
    [property: Required] string RequiredPermission,
    [property: Required] bool Permitted,
    string? BlockedReason);

/// <summary>What the caller can do next with the Task (permissions combined with the lifecycle rules).</summary>
public sealed record TaskAllowedActions(
    [property: Required] bool CanEdit,
    [property: Required] bool CanAssign,
    [property: Required] bool CanSetPriority,
    [property: Required] bool CanComment,
    [property: Required] bool CanExecuteSteps,
    [property: Required] bool CanReopenSteps,
    [property: Required] IReadOnlyList<TaskTransitionOption> Transitions);

// ---- task

/// <summary>A Task in full. <c>warnings</c>, <c>droppedFields</c> and <c>bulkCompletedStepInstanceIds</c> are filled only on the response to a write.</summary>
public sealed record TaskResponse(
    [property: Required] long TaskId,
    [property: Required] string TaskNumber,
    [property: Required] TaskMatterRef Matter,
    TaskProjectRef? Project,
    [property: Required] TaskTypeRef TaskType,
    [property: Required] string Title,
    string? Description,
    [property: Required] string RequestorName,
    string? RequestorEmail,
    DateTime? RequestedAtUtc,
    [property: Required] TaskPriorityRef Priority,
    [property: Required] string Status,
    [property: Required] string StatusLabel,
    TaskPodRef? AssignedPod,
    TaskUserRef? AssignedUser,
    DateOnly? DueDate,
    string? DueTime,
    DateTime? DueAtUtc,
    [property: Required] bool IsAsap,
    [property: Required] bool IsOverdue,
    [property: Required] string TimeZone,
    TaskUserRef? CreatedBy,
    [property: Required] DateTime CreatedAtUtc,
    DateTime? ModifiedAtUtc,
    [property: Required] DateTime StatusChangedAtUtc,
    DateTime? CompletedAtUtc,
    int? FormVersionId,
    int? FormVersionNo,
    [property: Required] IReadOnlyDictionary<string, JsonElement> FormValues,
    [property: Required] TaskWorkflowResponse Workflow,
    [property: Required] TaskAllowedActions AllowedActions,
    TaskStatusReason? StatusReason,
    [property: Required] string RowVersion,
    [property: Required] IReadOnlyList<string> Warnings,
    [property: Required] IReadOnlyList<string> DroppedFields,
    [property: Required] IReadOnlyList<int> BulkCompletedStepInstanceIds);

/// <summary>A Task in the minimal list.</summary>
public sealed record TaskListItem(
    [property: Required] long TaskId,
    [property: Required] string TaskNumber,
    [property: Required] string Title,
    [property: Required] int MatterId,
    [property: Required] string MatterRef,
    [property: Required] string MatterName,
    int? ProjectId,
    string? ProjectName,
    [property: Required] int TaskTypeId,
    [property: Required] string TaskTypeName,
    [property: Required] TaskPriorityRef Priority,
    [property: Required] string Status,
    [property: Required] string StatusLabel,
    TaskPodRef? AssignedPod,
    TaskUserRef? AssignedUser,
    DateOnly? DueDate,
    DateTime? DueAtUtc,
    [property: Required] bool IsAsap,
    [property: Required] bool IsOverdue,
    [property: Required] DateTime CreatedAtUtc,
    [property: Required] string RowVersion);

// ---- requests

/// <summary>Creates a Task in one transaction together with its workflow instance and request form values.</summary>
public sealed class CreateTaskRequest
{
    /// <summary>The Matter (must be active). Fixed for the life of the Task.</summary>
    [Required, Range(1, int.MaxValue)]
    public int MatterId { get; init; }

    /// <summary>Optional Project of the same Matter (must be active).</summary>
    public int? ProjectId { get; init; }

    /// <summary>The Task Type (must be usable). Fixed for the life of the Task.</summary>
    [Required, Range(1, int.MaxValue)]
    public int TaskTypeId { get; init; }

    /// <summary>Exactly one of the Task Type's eligible workflows. Its current published version is pinned.</summary>
    [Required, Range(1, int.MaxValue)]
    public int WorkflowDefinitionId { get; init; }

    /// <summary>Title (max 200).</summary>
    [Required, StringLength(200, MinimumLength = 1)]
    public string Title { get; init; } = string.Empty;

    /// <summary>Plain-text description (max 20000).</summary>
    [StringLength(20000)]
    public string? Description { get; init; }

    /// <summary>Who asked for the work (not an app user). Required.</summary>
    [Required, StringLength(200, MinimumLength = 1)]
    public string RequestorName { get; init; } = string.Empty;

    /// <summary>Optional requestor email address.</summary>
    [StringLength(254)]
    public string? RequestorEmail { get; init; }

    /// <summary>When the request was sent (for example the email's sent time), UTC.</summary>
    public DateTime? RequestedAtUtc { get; init; }

    /// <summary>Priority; the default priority when omitted. Setting another one needs Task.SetPriority.</summary>
    public int? PriorityId { get; init; }

    /// <summary>Due date (yyyy-MM-dd); omit for ASAP.</summary>
    public DateOnly? DueDate { get; init; }

    /// <summary>Optional due time (HH:mm) in the caller's time zone (X-Time-Zone header, default America/New_York). Requires dueDate.</summary>
    [StringLength(8)]
    public string? DueTime { get; init; }

    /// <summary>Optional Pod. Assigning needs Task.Assign.</summary>
    public int? AssignedPodId { get; init; }

    /// <summary>Optional user. Assigning a user starts the Task (In Progress). Needs Task.Assign.</summary>
    public int? AssignedUserId { get; init; }

    /// <summary>Request form values keyed by field key, validated against the Task Type's published form.</summary>
    public Dictionary<string, JsonElement>? FormValues { get; init; }
}

/// <summary>
/// Updates the editable details of a Task (not Completed or Cancelled). Matter, Task Type and Workflow cannot change (409 IMMUTABLE_FIELD if they
/// are sent and differ). Details are replaced as sent (omitted optional fields are cleared, an omitted dueDate means ASAP); <c>formValues</c> is a
/// patch (a JSON null clears a key) and only the changed fields are validated.
/// </summary>
public sealed class UpdateTaskRequest
{
    /// <summary>The <c>rowVersion</c> last read.</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;

    /// <summary>Optional echo of the Matter; a different value is 409 IMMUTABLE_FIELD.</summary>
    public int? MatterId { get; init; }

    /// <summary>Optional echo of the Task Type; a different value is 409 IMMUTABLE_FIELD.</summary>
    public int? TaskTypeId { get; init; }

    /// <summary>Optional echo of the workflow definition; a different value is 409 IMMUTABLE_FIELD.</summary>
    public int? WorkflowDefinitionId { get; init; }

    /// <summary>Project of the same Matter, or null for none.</summary>
    public int? ProjectId { get; init; }

    [Required, StringLength(200, MinimumLength = 1)]
    public string Title { get; init; } = string.Empty;

    [StringLength(20000)]
    public string? Description { get; init; }

    [Required, StringLength(200, MinimumLength = 1)]
    public string RequestorName { get; init; } = string.Empty;

    [StringLength(254)]
    public string? RequestorEmail { get; init; }

    public DateTime? RequestedAtUtc { get; init; }

    /// <summary>New priority; omit to keep it. Changing it needs Task.SetPriority.</summary>
    public int? PriorityId { get; init; }

    public DateOnly? DueDate { get; init; }

    [StringLength(8)]
    public string? DueTime { get; init; }

    /// <summary>Patch of the request form values.</summary>
    public Dictionary<string, JsonElement>? FormValues { get; init; }
}

/// <summary>Sets the Pod and the user as sent (null clears). A user outside the Pod is allowed and flagged with a warning.</summary>
public sealed class AssignTaskRequest
{
    [Required]
    public string RowVersion { get; init; } = string.Empty;

    public int? PodId { get; init; }

    public int? UserId { get; init; }
}

/// <summary>Sets the priority.</summary>
public sealed class SetTaskPriorityRequest
{
    [Required]
    public string RowVersion { get; init; } = string.Empty;

    [Required, Range(1, int.MaxValue)]
    public int PriorityId { get; init; }
}

/// <summary>Changes the status per the lifecycle matrix. ON_HOLD and CANCELLED need a comment.</summary>
public sealed class ChangeTaskStatusRequest
{
    [Required]
    public string RowVersion { get; init; } = string.Empty;

    /// <summary>Target status code: NEW is never a target; IN_PROGRESS starts, resumes or reopens; ON_HOLD, COMPLETED, CANCELLED.</summary>
    [Required]
    public string Status { get; init; } = string.Empty;

    /// <summary>Plain-text reason; mandatory for ON_HOLD and CANCELLED (stored as a non-deletable comment).</summary>
    [StringLength(4000)]
    public string? Comment { get; init; }
}

/// <summary>Completes the Task, optionally bulk-completing unresolved steps first (all or nothing).</summary>
public sealed class CompleteTaskRequest
{
    [Required]
    public string RowVersion { get; init; } = string.Empty;

    /// <summary>When true, every unresolved step with all required inputs is completed in the same transaction. Needs Workflow.Execute.</summary>
    public bool CompleteUnresolvedSteps { get; init; }
}

/// <summary>Cancels the Task with the mandatory comment.</summary>
public sealed class CancelTaskRequest
{
    [Required]
    public string RowVersion { get; init; } = string.Empty;

    [Required, StringLength(4000, MinimumLength = 1)]
    public string Comment { get; init; } = string.Empty;
}

/// <summary>Moves a Completed or Cancelled Task back to In Progress (the Matter must be active).</summary>
public sealed class ReopenTaskRequest
{
    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

/// <summary>Task list filters. Unknown parameters are a 400.</summary>
public sealed class TaskListQuery
{
    /// <summary>1-based page number.</summary>
    [Range(1, int.MaxValue)]
    public int Page { get; init; } = 1;

    /// <summary>Items per page (default 25, max 100).</summary>
    [Range(1, 100)]
    public int PageSize { get; init; } = 25;

    /// <summary>
    /// Sort: <c>default</c> (priority, ASAP first, due, oldest), or comma-separated fields <c>createdAt</c>, <c>dueAt</c>, <c>title</c>,
    /// <c>taskNumber</c>, <c>status</c>, <c>priority</c>; prefix <c>-</c> for descending. Without a sort, newest first.
    /// </summary>
    [StringLength(200)]
    public string? Sort { get; init; }

    /// <summary>Only Tasks of this Matter.</summary>
    public int? MatterId { get; init; }

    /// <summary>Only Tasks of this Project.</summary>
    public int? ProjectId { get; init; }

    /// <summary>Comma-separated status codes, for example <c>NEW,IN_PROGRESS</c>.</summary>
    [StringLength(200)]
    public string? Status { get; init; }

    /// <summary>Only Tasks assigned to this user (inactive users included).</summary>
    public int? AssigneeId { get; init; }

    /// <summary>Only Tasks assigned to this Pod.</summary>
    public int? PodId { get; init; }

    /// <summary>Only Tasks of this Task Type.</summary>
    public int? TaskTypeId { get; init; }

    /// <summary>Only Tasks with this priority.</summary>
    public int? PriorityId { get; init; }

    /// <summary>Fragment of the title, the Task number or the requestor name.</summary>
    [StringLength(200)]
    public string? Q { get; init; }

    internal static readonly string[] Keys = ["page", "pageSize", "sort", "matterId", "projectId", "status", "assigneeId", "podId", "taskTypeId", "priorityId", "q"];
}

// ---- completion check

/// <summary>A workflow step named in a completion check.</summary>
public sealed record TaskStepRef([property: Required] int StepInstanceId, [property: Required] int SequenceNo, [property: Required] string Title);

/// <summary>The data of the "N steps not completed, mark them all completed?" dialog (addendum K).</summary>
public sealed record TaskCompletionCheck(
    [property: Required] bool IsReady,
    [property: Required] bool CanBulkComplete,
    [property: Required] IReadOnlyList<TaskStepRef> Unresolved,
    [property: Required] IReadOnlyList<TaskStepRef> BulkCompletable,
    [property: Required] IReadOnlyList<TaskStepRef> Blocked);

// ---- step actions

/// <summary>Starts a step. <c>rowVersion</c> is the workflow's, optional.</summary>
public sealed class StartStepRequest
{
    /// <summary>The workflow <c>rowVersion</c> last read (from the Task's workflow); a mismatch is 409 CONCURRENCY_CONFLICT. Omit to skip the early check.</summary>
    public string? RowVersion { get; init; }
}

/// <summary>Saves draft values and/or the skip comment of an unresolved step.</summary>
public sealed class SaveStepValuesRequest
{
    public string? RowVersion { get; init; }

    /// <summary>Patch of the step's input values keyed by field key (type-checked, required not enforced).</summary>
    public Dictionary<string, JsonElement>? Values { get; init; }

    /// <summary>The skip comment to remember (max 2000).</summary>
    [StringLength(2000)]
    public string? SkipComment { get; init; }
}

/// <summary>Completes a step, saving optional values first. All required inputs must be present.</summary>
public sealed class CompleteStepRequest
{
    public string? RowVersion { get; init; }

    public Dictionary<string, JsonElement>? Values { get; init; }
}

/// <summary>Skips a skippable step; a comment is required when the step says so.</summary>
public sealed class SkipStepRequest
{
    public string? RowVersion { get; init; }

    [StringLength(2000)]
    public string? Comment { get; init; }
}

/// <summary>Reopens a completed or skipped step.</summary>
public sealed class ReopenStepRequest
{
    public string? RowVersion { get; init; }
}

/// <summary>Result of a step action: the whole updated Task (status, allowed actions, workflow).</summary>
public sealed record StepActionResponse(
    [property: Required] TaskResponse Task,
    [property: Required] IReadOnlyList<int> AffectedStepInstanceIds,
    [property: Required] IReadOnlyList<string> DroppedFields,
    [property: Required] bool TaskStatusChanged);
