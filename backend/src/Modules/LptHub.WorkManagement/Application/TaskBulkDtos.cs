using System.ComponentModel.DataAnnotations;

namespace LptHub.WorkManagement.Application;

/// <summary>Where the selected tasks go: a person, a pod or both. A person alone keeps each task's pod; a pod alone moves the task to that pod's queue and clears its person.</summary>
public sealed class BulkReassignTo
{
    [Range(1, int.MaxValue)]
    public int? UserId { get; init; }

    [Range(1, int.MaxValue)]
    public int? PodId { get; init; }
}

/// <summary>
/// Re-assign and/or re-prioritise tasks of one matter in one request (epic #667, issue #685). At most <see cref="MaxTasks"/> tasks. Each task is an
/// ordinary single-task change (its own transaction, rules, audit entries and notifications); nothing is partly applied to one task.
/// </summary>
public sealed class BulkTasksRequest
{
    public const int MaxTasks = 100;

    /// <summary>The tasks, all of the matter in the route.</summary>
    [Required, MinLength(1), MaxLength(MaxTasks)]
    public List<long> TaskIds { get; init; } = [];

    /// <summary>The new assignee; needs <c>Task.Assign</c>.</summary>
    public BulkReassignTo? ReassignTo { get; init; }

    /// <summary>The new priority; needs <c>Task.SetPriority</c>.</summary>
    [Range(1, int.MaxValue)]
    public int? PriorityId { get; init; }
}

/// <summary>
/// The outcome of one task. <c>Code</c> is null when it worked; otherwise <c>NOT_FOUND</c>, <c>NOT_IN_MATTER</c>, <c>TASK_NOT_EDITABLE</c> (completed or cancelled),
/// <c>CONCURRENCY_CONFLICT</c> (changed meanwhile) or another code of the single-task rules. <c>Warnings</c> carry <c>USER_NOT_IN_POD</c>.
/// </summary>
public sealed record BulkTaskResult(
    [property: Required] long TaskId,
    [property: Required] bool Ok,
    string? Code,
    string? Message,
    [property: Required] IReadOnlyList<string> Warnings);

/// <summary>The per-task results in request order, the counts and the one correlation id that groups every audit entry of the batch. There is no undo: reverse it with another bulk change.</summary>
public sealed record BulkTasksResponse(
    [property: Required] Guid CorrelationId,
    [property: Required] int Changed,
    [property: Required] int Failed,
    [property: Required] IReadOnlyList<BulkTaskResult> Results);

/// <summary>
/// Puts tasks of one matter into a project of that matter, or takes them out (MD-05, epic #1001). A task belongs to at most one project: linking a task that is
/// in another project moves it (the answer says so in the audit trail, not as an error). At most <see cref="BulkTasksRequest.MaxTasks"/> tasks.
/// </summary>
public sealed class SetTasksProjectRequest
{
    /// <summary>The tasks, all of the matter in the route.</summary>
    [Required, MinLength(1), MaxLength(BulkTasksRequest.MaxTasks)]
    public List<long> TaskIds { get; init; } = [];

    /// <summary>The project to link to (active, of the same matter), or null to take the tasks out of their project.</summary>
    [Range(1, int.MaxValue)]
    public int? ProjectId { get; init; }
}
