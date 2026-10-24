using System.ComponentModel.DataAnnotations;
using MatterFlow.Identity.Contracts;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// The count strip of My Matters (6.1). Every count carries the query string that lists exactly the counted records: the Task Queue for the task
/// counts, the Matters list for <c>Matters</c>. "Due in 3 days" is inside "due in 7 days"; the two are never summed. A matter with no manager is in nobody's
/// "mine" scope. Unassigned means no person (a pod may be set), the Task Queue's <c>unassigned=true</c>.
/// </summary>
/// <param name="Scope"><c>mine</c> or <c>all</c> as asked.</param>
/// <param name="Role"><c>both</c>, <c>primary</c> or <c>secondary</c>.</param>
/// <param name="Matters">Active matters in the scope; <c>Query</c> is for the Matters list.</param>
/// <param name="OnHold">Tasks On Hold; <c>Query</c> sorts the oldest hold first.</param>
/// <param name="OldestHoldDays">Whole days the longest-running hold has lasted; null with no task on hold.</param>
/// <param name="OldestHoldSinceUtc">When that hold started.</param>
public sealed record MyMattersSummary(
    [property: Required] string TimeZone,
    [property: Required] DateTime AsOfUtc,
    [property: Required] string Scope,
    [property: Required] string Role,
    [property: Required] DashboardCount Matters,
    [property: Required] DashboardCount OpenTasks,
    [property: Required] DashboardCount Overdue,
    [property: Required] DashboardCount DueIn3Days,
    [property: Required] DashboardCount DueIn7Days,
    [property: Required] DashboardCount Unassigned,
    [property: Required] DashboardCount OnHold,
    int? OldestHoldDays,
    DateTime? OldestHoldSinceUtc);

/// <summary>One row of the health table (6.3).</summary>
/// <param name="ClientNumber">The five-digit client number.</param>
/// <param name="DueThisWeek">Open tasks due in the next 7 days, today included, not overdue (the strip's "due in 7 days" for this matter).</param>
/// <param name="PercentComplete">Steps completed or skipped over all steps of the workflows of this matter's open tasks, whole percent; null with no open task.</param>
/// <param name="NextDeadline">The earliest explicit due date among open tasks that are not overdue; null if none.</param>
/// <param name="Flag"><c>RED</c>, <c>AMBER</c> or <c>GREEN</c> (see <see cref="MyMattersRules.Flag"/>); a label always travels with the colour in the UI.</param>
/// <param name="FlagReasons">Every reason that applies, most severe first: <c>OVERDUE</c>, <c>UNASSIGNED</c>, <c>DUE_SOON</c>, <c>LONG_HOLD</c>; a green matter with no open task has <c>NO_OPEN_TASKS</c>.</param>
/// <param name="Query">The Task Queue query for this matter's open tasks.</param>
public sealed record MyMattersHealthRow(
    [property: Required] int MatterId,
    [property: Required] string MatterRef,
    [property: Required] string MatterName,
    [property: Required] int ClientId,
    [property: Required] string ClientNumber,
    [property: Required] string ClientName,
    [property: Required] int Open,
    [property: Required] int Overdue,
    [property: Required] int DueThisWeek,
    [property: Required] int Unassigned,
    int? PercentComplete,
    DateOnly? NextDeadline,
    [property: Required] string Flag,
    [property: Required] IReadOnlyList<string> FlagReasons,
    [property: Required] string Query);

/// <summary>A page of the health table. The thresholds are echoed so the UI can spell the rule out.</summary>
public sealed record MyMattersHealthPage(
    [property: Required] IReadOnlyList<MyMattersHealthRow> Items,
    [property: Required] int Total,
    [property: Required] int Page,
    [property: Required] int PageSize,
    [property: Required] string Sort,
    [property: Required] string Dir,
    [property: Required] int AmberDueDays,
    [property: Required] int StuckOnHoldDays,
    [property: Required] string TimeZone);

/// <summary>The fact an attention row states: <c>OVERDUE</c> (days), <c>DUE_TODAY</c>, <c>DUE_IN_DAYS</c> (days), <c>NO_ASSIGNEE</c>, <c>ON_HOLD_DAYS</c> (days).</summary>
public static class AttentionFacts
{
    public const string Overdue = "OVERDUE";
    public const string DueToday = "DUE_TODAY";
    public const string DueInDays = "DUE_IN_DAYS";
    public const string NoAssignee = "NO_ASSIGNEE";
    public const string OnHoldDays = "ON_HOLD_DAYS";
}

/// <summary>One task in the attention list or the upcoming deadlines.</summary>
/// <param name="TaskNumber">The task reference (<c>TSK-1042</c>).</param>
/// <param name="FactCode">See <see cref="AttentionFacts"/>.</param>
/// <param name="FactDays">The number of days the fact names (days overdue, days until due, days on hold); null when it has none.</param>
/// <param name="DueDate">The explicit due date; null for ASAP.</param>
/// <param name="DueAtUtc">The due instant when a time was chosen.</param>
/// <param name="AssigneeName">The assigned person; null while unassigned.</param>
public sealed record MyMattersTaskItem(
    [property: Required] long TaskId,
    [property: Required] string TaskNumber,
    [property: Required] string Title,
    [property: Required] int MatterId,
    [property: Required] string MatterRef,
    [property: Required] string MatterName,
    [property: Required] string ClientName,
    [property: Required] string FactCode,
    int? FactDays,
    DateOnly? DueDate,
    DateTime? DueAtUtc,
    int? AssigneeId,
    string? AssigneeName);

/// <summary>One group of the attention list: the total in the group, the first rows and the Task Queue query behind "View all".</summary>
/// <param name="Kind"><c>overdue</c>, <c>dueSoon</c>, <c>unassigned</c> or <c>stuckOnHold</c>.</param>
/// <param name="Total">All tasks of the group (the rows are capped at 10).</param>
/// <param name="Query">For <c>stuckOnHold</c> the list shows every task on hold, oldest hold first (the Task Queue has no "longer than 7 days" filter), so its total can be larger than <c>Total</c>.</param>
public sealed record MyMattersAttentionGroup(
    [property: Required] string Kind,
    [property: Required] int Total,
    [property: Required] string Query,
    [property: Required] IReadOnlyList<MyMattersTaskItem> Items);

/// <summary>Needs my attention (6.2): four groups in this order, each capped at 10 rows. Matters and tasks nobody manages never appear.</summary>
public sealed record MyMattersAttention(
    [property: Required] string TimeZone,
    [property: Required] DateTime AsOfUtc,
    [property: Required] int StuckOnHoldDays,
    [property: Required] IReadOnlyList<MyMattersAttentionGroup> Groups);

/// <summary>
/// Upcoming deadlines (6.5): open, not overdue, due from today to the last day of the window, soonest first, capped at 25. With <c>groupBy=day</c> or <c>groupBy=matter</c>
/// (epic #758) the flat list is empty and <c>ByDay</c> (every day of the window, for the calendar) or <c>ByMatter</c> (the matters with the soonest deadlines) is filled.
/// </summary>
/// <param name="GroupBy">The grouping asked for (<c>day</c>, <c>matter</c>); null for the flat list.</param>
/// <param name="ByDay">One entry per calendar day from today to the last day (days without a deadline have a count of 0), only with <c>groupBy=day</c>.</param>
/// <param name="ByMatter">The matters that have a deadline in the window, soonest first, at most <see cref="MyMattersAttentionService.MatterGroupSize"/>, only with <c>groupBy=matter</c>.</param>
/// <param name="MatterTotal">How many matters have a deadline in the window (more than <c>ByMatter</c> holds when it was cut), only with <c>groupBy=matter</c>.</param>
public sealed record MyMattersDeadlines(
    [property: Required] string TimeZone,
    [property: Required] DateTime AsOfUtc,
    [property: Required] int Days,
    [property: Required] DateOnly FromDate,
    [property: Required] DateOnly ToDate,
    [property: Required] int Total,
    [property: Required] string Query,
    [property: Required] IReadOnlyList<MyMattersTaskItem> Items,
    string? GroupBy = null,
    IReadOnlyList<MyMattersDeadlineDay>? ByDay = null,
    IReadOnlyList<MyMattersDeadlineMatter>? ByMatter = null,
    int? MatterTotal = null);

/// <summary>One calendar day of the deadlines window: its tasks (first five) and the Task Queue query that lists exactly the counted tasks.</summary>
/// <param name="Count">Open, not overdue tasks due on this day; equals the list the <c>Query</c> opens.</param>
/// <param name="IsWeekend">Saturday or Sunday (muted in the calendar; weekends are included).</param>
public sealed record MyMattersDeadlineDay(
    [property: Required] DateOnly Date,
    [property: Required] bool IsWeekend,
    [property: Required] bool IsToday,
    [property: Required] int Count,
    [property: Required] string Query,
    [property: Required] IReadOnlyList<MyMattersTaskItem> Items);

/// <summary>One matter with deadlines in the window: how many, the soonest date and its next five tasks.</summary>
/// <param name="Total">All open, not overdue tasks of the matter due inside the window (the rows are capped at 5).</param>
/// <param name="NextDueDate">The soonest due date among them.</param>
public sealed record MyMattersDeadlineMatter(
    [property: Required] int MatterId,
    [property: Required] string MatterRef,
    [property: Required] string MatterName,
    [property: Required] string ClientName,
    [property: Required] int Total,
    DateOnly? NextDueDate,
    [property: Required] string Query,
    [property: Required] IReadOnlyList<MyMattersTaskItem> Items);

/// <summary>An out-of-office period that overlaps the next four weeks (epic #758): whole calendar days, never the free-text note.</summary>
/// <param name="From">First day away; null when it began before the window started being tracked (open start).</param>
/// <param name="To">Last day away; null when open-ended.</param>
/// <param name="ReasonCode">A code, never free text: <c>OUT_OF_OFFICE</c> (the only reason the availability profile records).</param>
public sealed record MyMattersAwayWindow(DateOnly? From, DateOnly? To, [property: Required] string ReasonCode);

/// <summary>One matter inside a person's row: how many of their open tasks sit on it.</summary>
public sealed record MyMattersWorkloadMatter(
    [property: Required] int MatterId,
    [property: Required] string MatterRef,
    [property: Required] string MatterName,
    [property: Required] int Open,
    [property: Required] int Overdue,
    [property: Required] string Query);

/// <summary>A person's open work split by matter (<c>include=matters</c>): the five matters with most open tasks and the rest as one count.</summary>
/// <param name="OtherMatters">How many more matters the person has open tasks on.</param>
/// <param name="OtherOpen">Open tasks on those other matters.</param>
public sealed record MyMattersWorkloadMatters(
    [property: Required] IReadOnlyList<MyMattersWorkloadMatter> Top,
    [property: Required] int OtherMatters,
    [property: Required] int OtherOpen);

/// <summary>
/// One person (or the "not assigned to a person" row, <c>UserId</c> null) inside a pod group. <c>Overdue</c> and <c>Away</c> are two facts side by side; nothing here judges the combination.
/// </summary>
/// <param name="Availability">Only while the person is out of office; null otherwise.</param>
/// <param name="Query">The Task Queue query for these tasks (open, this person or unassigned, this pod).</param>
/// <param name="DueThisWeek">Open, not overdue tasks due today or within 7 days (the "due in 7 days" figure of the strip).</param>
/// <param name="Away">The out-of-office period that overlaps today and the next 28 days; null for a person who is not away in that range.</param>
/// <param name="Matters">The split by matter; only with <c>include=matters</c>.</param>
public sealed record MyMattersWorkloadPerson(
    int? UserId,
    string? DisplayName,
    [property: Required] bool IsActive,
    [property: Required] int Open,
    [property: Required] int Overdue,
    [property: Required] int OnHold,
    UserAvailabilitySummary? Availability,
    [property: Required] string Query,
    [property: Required] int DueThisWeek,
    MyMattersAwayWindow? Away = null,
    MyMattersWorkloadMatters? Matters = null);

/// <summary>One pod group (<c>PodId</c> null: tasks with no pod). Never ranked, no thresholds: alphabetical.</summary>
public sealed record MyMattersWorkloadPod(
    int? PodId,
    string? PodName,
    [property: Required] int Open,
    [property: Required] int Overdue,
    [property: Required] int OnHold,
    [property: Required] string Query,
    [property: Required] IReadOnlyList<MyMattersWorkloadPerson> People);

/// <summary>Workload and capacity (6.4): open tasks on my matters by pod, then person. People and pods without open work on these matters are not listed.</summary>
public sealed record MyMattersWorkload(
    [property: Required] string TimeZone,
    [property: Required] DateTime AsOfUtc,
    [property: Required] int Open,
    [property: Required] IReadOnlyList<MyMattersWorkloadPod> Pods);

/// <summary>Kinds of activity events.</summary>
public static class ActivityKinds
{
    public const string TaskCreated = "TASK_CREATED";
    public const string StatusChanged = "STATUS_CHANGED";
    public const string Reassigned = "REASSIGNED";
    public const string Commented = "COMMENTED";
    public const string ManagerChanged = "MANAGER_CHANGED";
}

/// <summary>
/// One event of Recent activity (6.6), as structured fields; the UI composes the sentence. A comment is only ever "commented on a task": its text is
/// never read (privilege).
/// </summary>
/// <param name="EventId">The audit event id; the unread marker is an id too.</param>
/// <param name="Kind">See <see cref="ActivityKinds"/>.</param>
/// <param name="From">STATUS_CHANGED: the old status code. REASSIGNED: the old assignee (a name, or the pod). MANAGER_CHANGED: the old manager's name.</param>
/// <param name="To">STATUS_CHANGED: the new status code. REASSIGNED: the new assignee. MANAGER_CHANGED: the new manager's name.</param>
/// <param name="ManagerPlace">MANAGER_CHANGED: <c>primary</c> or <c>secondary</c>.</param>
/// <param name="IsUnread">Newer than the person's marker and not their own action.</param>
public sealed record MyMattersActivityItem(
    [property: Required] long EventId,
    [property: Required] DateTime OccurredAtUtc,
    [property: Required] string Kind,
    int? ActorId,
    string? ActorName,
    [property: Required] int MatterId,
    [property: Required] string MatterRef,
    [property: Required] string MatterName,
    [property: Required] string ClientName,
    long? TaskId,
    string? TaskNumber,
    string? TaskTitle,
    string? From,
    string? To,
    string? ManagerPlace,
    [property: Required] bool IsUnread);

/// <summary>Recent activity of the last 7 days (or the date range), newest first.</summary>
/// <param name="SeenEventId">The person's marker: events up to this id are read.</param>
/// <param name="LatestEventId">The newest event of the answer (0 if none).</param>
/// <param name="UnreadCount">Unread events in the window (not only in the rows returned).</param>
/// <param name="HasMore">More events exist than <c>take</c>.</param>
public sealed record MyMattersActivity(
    [property: Required] string TimeZone,
    [property: Required] DateTime AsOfUtc,
    [property: Required] DateTime SinceUtc,
    [property: Required] long SeenEventId,
    [property: Required] long LatestEventId,
    [property: Required] int UnreadCount,
    [property: Required] bool HasMore,
    [property: Required] IReadOnlyList<MyMattersActivityItem> Items);

/// <summary>The marker after <c>POST /my-matters/activity/seen</c>.</summary>
public sealed record MyMattersActivitySeen(
    [property: Required] long SeenEventId,
    [property: Required] DateTime SeenAtUtc);
