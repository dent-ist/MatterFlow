using System.ComponentModel.DataAnnotations;
using MatterFlow.Identity.Contracts;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>A Priority on a queue row. Users see the label; <c>SortOrder</c> only drives the level-bar glyph (lower is more urgent).</summary>
public sealed record QueuePriority([property: Required] int PriorityId, [property: Required] string Label, [property: Required] string Color, [property: Required] int SortOrder);

/// <summary>A Pod on a queue row.</summary>
public sealed record QueuePod([property: Required] int PodId, [property: Required] string Name, [property: Required] bool IsActive);

/// <summary>A person (assignee, creator) on a queue row; inactive users stay visible.</summary>
public sealed record QueueUser([property: Required] int UserId, [property: Required] string DisplayName, [property: Required] bool IsActive);

/// <summary>
/// One Task in the Task Queue, My Work or Pod Work. Due is returned as stored (<c>dueDate</c> floating date, <c>dueAtUtc</c> instant when a
/// time was set); <c>closedAtUtc</c> is the instant the Task last entered Completed or Cancelled (null while it is open); <c>isAsap</c> and <c>isOverdue</c> are computed for the requesting user's time zone (addendum M).
/// <c>matterCanOpen</c> is false when the caller sees the Task but not its (sensitive) Matter, so the screen shows the Matter as plain text with no link (epic #788 mode H).
/// <c>taskTypeColourKey</c> is the type's palette colour (null = neutral); <c>onHoldReasonId</c> and <c>onHoldReasonName</c> are the structured reason of the current hold; <c>atRisk</c> is the At risk rule of <see cref="AtRiskRules"/>.
/// <c>holdReason</c> is the plain text of the latest hold comment, only while the status is On Hold (null when there is none), cut to 200 characters; <c>holdReasonTruncated</c> tells that it was cut.
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
    [property: Required] string TaskTypeIconKey,
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
    DateTime? AssignedAtUtc,
    DateTime? UpdatedAtUtc,
    DateTime? CompletedAtUtc,
    [property: Required] DateTime StatusChangedAtUtc,
    DateTime? ClosedAtUtc,
    [property: Required] WorkflowProgress Workflow,
    [property: Required] string RowVersion,
    string? HoldReason = null,
    [property: Required] bool HoldReasonTruncated = false,
    [property: Required] bool MatterCanOpen = true,
    string? TaskTypeColourKey = null,
    int? OnHoldReasonId = null,
    string? OnHoldReasonName = null,
    [property: Required] bool AtRisk = false);

/// <summary>Where the Task's workflow stands: the current (first unresolved) step and how many steps are resolved (completed or skipped).</summary>
/// <param name="StepsTotal">Number of steps.</param>
/// <param name="StepsResolved">Completed plus skipped steps.</param>
/// <param name="CurrentStepNumber">Position (1-based sequence number) of the first unresolved step; null when all steps are resolved.</param>
/// <param name="CurrentStepName">Title of that step; null when all steps are resolved.</param>
/// <param name="CurrentStepId">Id of that step instance (the <c>?step=</c> value of the Task page); null when all steps are resolved.</param>
public sealed record WorkflowProgress(
    [property: Required] int StepsTotal,
    [property: Required] int StepsResolved,
    int? CurrentStepNumber,
    string? CurrentStepName,
    int? CurrentStepId = null);

/// <summary>A page of the Task Queue. <c>timeZone</c> is the zone used for the overdue evaluation; <c>views</c> are the sizes of the quick views.</summary>
public sealed record TaskQueuePage(
    [property: Required] IReadOnlyList<TaskQueueRow> Items,
    [property: Required] int Total,
    [property: Required] int Page,
    [property: Required] int PageSize,
    [property: Required] string TimeZone,
    [property: Required] TaskQueueViewCounts Views,
    TaskQueueBucketCounts? BucketCounts = null);

/// <summary>
/// The size of each due bucket of the whole filtered Task Queue set (not just the page), returned with <c>group=due</c> and <c>sort=due</c>. The
/// open buckets are My Work's (ASAP, Overdue and Today use the strip's and the Dashboard's predicates); <c>Closed</c> is every Completed or Cancelled
/// Task, which is never overdue. The seven buckets sum to the total.
/// </summary>
public sealed record TaskQueueBucketCounts(
    [property: Required] int Asap,
    [property: Required] int Overdue,
    [property: Required] int Today,
    [property: Required] int Tomorrow,
    [property: Required] int ThisWeek,
    [property: Required] int Later,
    [property: Required] int Closed);

/// <summary>
/// The size of each Task Queue quick view, over the whole Task set the viewer may see and never narrowed by the filters of the request (like My Work's
/// attention strip). Each equals the grid total of the same view's filters and the Dashboard tile for the same query. <c>OnHold</c> is the status On Hold
/// (always open); <c>DueSoon</c> excludes the overdue Tasks (the Dashboard's tile); <c>MyPod</c> is open Tasks in the viewer's primary Pod and is null
/// (absent) for a viewer without one; <c>RecentlyCompleted</c> is Completed in the last 30 days of the viewer's calendar, today included (the Dashboard tile's window); <c>CreatedByMe</c> is open Tasks only, like My Work's Created by me.
/// </summary>
public sealed record TaskQueueViewCounts(
    [property: Required] int Open,
    [property: Required] int Unassigned,
    [property: Required] int Overdue,
    [property: Required] int DueSoon,
    [property: Required] int Asap,
    [property: Required] int OnHold,
    int? MyPod,
    [property: Required] int RecentlyCompleted,
    [property: Required] int CreatedByMe);

/// <summary>Tab counts of My Work (filters applied).</summary>
public sealed record MyWorkCounts(
    [property: Required] int Active,
    [property: Required] int DueSoon,
    [property: Required] int Completed,
    [property: Required] int CreatedByMe);

/// <summary>
/// The needs-attention strip of My Work (M1): counts over the person's whole open assigned set, never narrowed by the grid's filters. Overdue and
/// DueToday do not overlap; Asap is never overdue or due today; OnHold is the status On Hold. Each equals the Active tab's total under the matching filter.
/// <c>New</c> is null unless the request names <c>newSince</c>; then it counts the open Tasks assigned after it.
/// </summary>
public sealed record MyWorkAttention(
    [property: Required] int Overdue,
    [property: Required] int DueToday,
    [property: Required] int Asap,
    [property: Required] int OnHold,
    int? New = null);

/// <summary>
/// The size of each due bucket of the whole filtered Active set (not just the page), so a group header can say "Overdue (9)" when the group spans pages.
/// ASAP, Overdue and Today use the strip's predicates; the six buckets sum to the Active total.
/// </summary>
public sealed record MyWorkBucketCounts(
    [property: Required] int Asap,
    [property: Required] int Overdue,
    [property: Required] int Today,
    [property: Required] int Tomorrow,
    [property: Required] int ThisWeek,
    [property: Required] int Later);

/// <summary>A page of My Work for one tab with the counts of every tab.</summary>
public sealed record MyWorkPage(
    [property: Required] IReadOnlyList<TaskQueueRow> Items,
    [property: Required] int Total,
    [property: Required] int Page,
    [property: Required] int PageSize,
    [property: Required] string TimeZone,
    [property: Required] string View,
    [property: Required] MyWorkCounts Counts,
    [property: Required] MyWorkAttention Attention,
    MyWorkBucketCounts? BucketCounts = null);

/// <summary>
/// A Pod in the Pod Work selector: the user's own Pods first (primary flagged), then the others. The numbers come from one grouped query for
/// all Pods and use the same open-Task definition as <see cref="PodWorkSummary"/>: <c>MemberCount</c> counts active members, <c>OpenCount</c>
/// the open Tasks of the Pod, <c>UnassignedCount</c> those no person holds and <c>OverdueCount</c> the overdue ones.
/// </summary>
public sealed record PodChoice(
    [property: Required] int PodId,
    [property: Required] string Name,
    [property: Required] bool IsMember,
    [property: Required] bool IsPrimary,
    [property: Required] int MemberCount = 0,
    [property: Required] int OpenCount = 0,
    [property: Required] int UnassignedCount = 0,
    [property: Required] int OverdueCount = 0);

/// <summary>
/// Pod Work header numbers (open Tasks of the Pod, never the grid filters). <c>DueToday</c> (due on the viewer's local date, not yet overdue)
/// and <c>Asap</c> (open, no due date) are My Work's definitions.
/// </summary>
public sealed record PodWorkSummary(
    [property: Required] int UnassignedToPerson,
    [property: Required] int Assigned,
    [property: Required] int Overdue,
    [property: Required] int OnHold,
    [property: Required] int DueToday = 0,
    [property: Required] int Asap = 0);

/// <summary>
/// Tab counts of Pod Work. <c>Members</c> is the number of assigned open Tasks (the By member tab's grid total); <c>MembersWithWork</c> is the
/// number of people who hold at least one open Task of the Pod (what the By member tab shows as its count).
/// </summary>
public sealed record PodWorkCounts(
    [property: Required] int Queue,
    [property: Required] int Members,
    [property: Required] int Attention,
    [property: Required] int All,
    [property: Required] int MembersWithWork = 0);

/// <summary>Open work of one person in a Pod: a workload fact, not a score. <c>Availability</c> is null while the person is available.</summary>
public sealed record PodMemberLoad(
    [property: Required] int UserId,
    [property: Required] string DisplayName,
    [property: Required] bool IsActive,
    [property: Required] bool IsMember,
    [property: Required] int Open,
    [property: Required] int Overdue,
    [property: Required] int OnHold,
    UserAvailabilitySummary? Availability = null);

/// <summary>
/// A page of Pod Work. <c>pod</c> is null when the user has no Pod and none was requested. Views: <c>queue</c> (Pod Tasks not assigned to a person),
/// <c>members</c> (Pod Tasks assigned to a person; <c>memberLoads</c> lists the workload per person), <c>attention</c> (overdue or on hold),
/// <c>all</c> (all open Pod Tasks). <c>Unassigned</c> is the number of open Pod Tasks no person holds (the Unassigned tab's total without filters).
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
    [property: Required] IReadOnlyList<PodMemberLoad> MemberLoads,
    [property: Required] int Unassigned = 0);
