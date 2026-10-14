using System.ComponentModel.DataAnnotations;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>A Priority on a queue row. Users see the label; <c>SortOrder</c> only drives the level-bar glyph (lower is more urgent).</summary>
public sealed record QueuePriority([property: Required] int PriorityId, [property: Required] string Label, [property: Required] string Color, [property: Required] int SortOrder);

/// <summary>A Pod on a queue row.</summary>
public sealed record QueuePod([property: Required] int PodId, [property: Required] string Name, [property: Required] bool IsActive);

/// <summary>A person (assignee, creator) on a queue row; inactive users stay visible.</summary>
public sealed record QueueUser([property: Required] int UserId, [property: Required] string DisplayName, [property: Required] bool IsActive);

/// <summary>
/// One Task in the Task Queue, My Work or Pod Work. Due is returned as stored (<c>dueDate</c> floating date, <c>dueAtUtc</c> instant when a
/// time was set); <c>isAsap</c> and <c>isOverdue</c> are computed for the requesting user's time zone (addendum M).
/// </summary>
public sealed record TaskQueueRow(
    [property: Required] long TaskId,
    [property: Required] string TaskNumber,
    [property: Required] string Title,
    [property: Required] int MatterId,
    [property: Required] string MatterRef,
    [property: Required] string MatterName,
    [property: Required] bool MatterIsSensitive,
    [property: Required] bool MatterIsActive,
    [property: Required] int ClientId,
    [property: Required] string ClientName,
    int? ProjectId,
    string? ProjectName,
    [property: Required] int TaskTypeId,
    [property: Required] string TaskTypeName,
    [property: Required] int WorkflowDefinitionId,
    [property: Required] string WorkflowName,
    [property: Required] QueuePriority Priority,
    [property: Required] string Status,
    [property: Required] string StatusLabel,
    QueuePod? AssignedPod,
    QueueUser? AssignedUser,
    QueueUser? CreatedBy,
    [property: Required] string RequestorName,
    DateOnly? DueDate,
    DateTime? DueAtUtc,
    [property: Required] bool IsAsap,
    [property: Required] bool IsOverdue,
    [property: Required] DateTime CreatedAtUtc,
    DateTime? UpdatedAtUtc,
    DateTime? CompletedAtUtc,
    [property: Required] DateTime StatusChangedAtUtc,
    [property: Required] WorkflowProgress Workflow,
    [property: Required] string RowVersion);

/// <summary>Where the Task's workflow stands: the current (first unresolved) step and how many steps are resolved (completed or skipped).</summary>
/// <param name="StepsTotal">Number of steps.</param>
/// <param name="StepsResolved">Completed plus skipped steps.</param>
/// <param name="CurrentStepNumber">Position (1-based sequence number) of the first unresolved step; null when all steps are resolved.</param>
/// <param name="CurrentStepName">Title of that step; null when all steps are resolved.</param>
public sealed record WorkflowProgress(
    [property: Required] int StepsTotal,
    [property: Required] int StepsResolved,
    int? CurrentStepNumber,
    string? CurrentStepName);

/// <summary>A page of the Task Queue. <c>timeZone</c> is the zone used for the overdue evaluation.</summary>
public sealed record TaskQueuePage(
    [property: Required] IReadOnlyList<TaskQueueRow> Items,
    [property: Required] int Total,
    [property: Required] int Page,
    [property: Required] int PageSize,
    [property: Required] string TimeZone);

/// <summary>Tab counts of My Work (filters applied).</summary>
public sealed record MyWorkCounts(
    [property: Required] int Active,
    [property: Required] int DueSoon,
    [property: Required] int Completed,
    [property: Required] int CreatedByMe);

/// <summary>A page of My Work for one tab with the counts of every tab.</summary>
public sealed record MyWorkPage(
    [property: Required] IReadOnlyList<TaskQueueRow> Items,
    [property: Required] int Total,
    [property: Required] int Page,
    [property: Required] int PageSize,
    [property: Required] string TimeZone,
    [property: Required] string View,
    [property: Required] MyWorkCounts Counts);

/// <summary>A Pod in the Pod Work selector: the user's own Pods first (primary flagged), then the others.</summary>
public sealed record PodChoice(
    [property: Required] int PodId,
    [property: Required] string Name,
    [property: Required] bool IsMember,
    [property: Required] bool IsPrimary);

/// <summary>Pod Work header numbers (open Tasks of the Pod).</summary>
public sealed record PodWorkSummary(
    [property: Required] int UnassignedToPerson,
    [property: Required] int Assigned,
    [property: Required] int Overdue,
    [property: Required] int OnHold);

/// <summary>Tab counts of Pod Work.</summary>
public sealed record PodWorkCounts(
    [property: Required] int Queue,
    [property: Required] int Members,
    [property: Required] int Attention,
    [property: Required] int All);

/// <summary>Open work of one person in a Pod: a workload fact, not a score.</summary>
public sealed record PodMemberLoad(
    [property: Required] int UserId,
    [property: Required] string DisplayName,
    [property: Required] bool IsActive,
    [property: Required] bool IsMember,
    [property: Required] int Open,
    [property: Required] int Overdue,
    [property: Required] int OnHold);

/// <summary>
/// A page of Pod Work. <c>pod</c> is null when the user has no Pod and none was requested. Views: <c>queue</c> (Pod Tasks not assigned to a person),
/// <c>members</c> (Pod Tasks assigned to a person; <c>memberLoads</c> lists the workload per person), <c>attention</c> (overdue or on hold),
/// <c>all</c> (all open Pod Tasks).
/// </summary>
public sealed record PodWorkPage(
    [property: Required] IReadOnlyList<TaskQueueRow> Items,
    [property: Required] int Total,
    [property: Required] int Page,
    [property: Required] int PageSize,
    [property: Required] string TimeZone,
    [property: Required] string View,
    QueuePod? Pod,
    [property: Required] IReadOnlyList<PodChoice> Pods,
    [property: Required] PodWorkSummary Summary,
    [property: Required] PodWorkCounts Counts,
    [property: Required] IReadOnlyList<PodMemberLoad> MemberLoads);
