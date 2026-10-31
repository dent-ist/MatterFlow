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
/// <param name="AtRisk">Open tasks that are At risk (<see cref="AtRiskRules"/>, PM v2 #878); <c>Query</c> is the Task Queue query with <c>atRisk=true</c>.</param>
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
    [property: Required] DashboardCount AtRisk,
    int? OldestHoldDays,
    DateTime? OldestHoldSinceUtc);

/// <summary>The fact an attention row states: <c>OVERDUE</c> (days), <c>AT_RISK</c>, <c>DUE_TODAY</c>, <c>DUE_IN_DAYS</c> (days), <c>NO_ASSIGNEE</c>, <c>ON_HOLD_DAYS</c> (days).</summary>
public static class AttentionFacts
{
    public const string Overdue = "OVERDUE";
    public const string DueToday = "DUE_TODAY";
    public const string DueInDays = "DUE_IN_DAYS";
    public const string NoAssignee = "NO_ASSIGNEE";
    public const string OnHoldDays = "ON_HOLD_DAYS";
    public const string AtRisk = "AT_RISK";
}

/// <summary>One task in the attention list or the upcoming deadlines.</summary>
/// <param name="TaskNumber">The task reference (<c>TSK-1042</c>).</param>
/// <param name="FactCode">See <see cref="AttentionFacts"/>.</param>
/// <param name="FactDays">The number of days the fact names (days overdue, days until due, days on hold); null when it has none.</param>
/// <param name="DueDate">The explicit due date; null for ASAP.</param>
/// <param name="DueAtUtc">The due instant when a time was chosen.</param>
/// <param name="AssigneeName">The assigned person; null while unassigned.</param>
/// <param name="TaskTypeId">The task's type (PM v2): with the name, icon and colour it is what a row shows as its badge.</param>
/// <param name="TaskTypeName">The type's name (the badge's accessible name and tooltip).</param>
/// <param name="TaskTypeIconKey">The type's icon key (<c>contracts/task-type-icons.json</c>).</param>
/// <param name="TaskTypeColourKey">The type's palette colour (<c>contracts/task-type-colours.json</c>); null = neutral default.</param>
/// <param name="PriorityName">The priority's label.</param>
/// <param name="PriorityRank">The priority's sort order (1 = most urgent), for drawing the level.</param>
/// <param name="StatusCode">The status code (<c>NEW</c>, <c>IN_PROGRESS</c>, <c>ON_HOLD</c>, ...).</param>
/// <param name="AgeDays">Whole days since the task was created.</param>
/// <param name="OnHold">While the task is On Hold: the reason (when one was chosen) and the whole days on hold; otherwise null.</param>
/// <param name="AtRisk">True when the task is open, not overdue and has used at least 80 percent of its type's target days (<see cref="AtRiskRules"/>).</param>
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
    string? AssigneeName,
    [property: Required] int TaskTypeId,
    [property: Required] string TaskTypeName,
    [property: Required] string TaskTypeIconKey,
    string? TaskTypeColourKey,
    [property: Required] string PriorityName,
    [property: Required] int PriorityRank,
    [property: Required] string StatusCode,
    [property: Required] int AgeDays,
    MyMattersOnHold? OnHold,
    [property: Required] bool AtRisk);

/// <summary>The hold of a task that is On Hold: the structured reason (null when none was chosen) and for how many whole days.</summary>
public sealed record MyMattersOnHold(string? ReasonName, [property: Required] int Days);

/// <summary>
/// Needs my attention (6.2, reworked in epic #893 issue #905): ONE ranked list. Each task is listed once under its most urgent reason: overdue (oldest first), at risk,
/// due today, unassigned with a due date within 7 days, on hold for more than 7 days; the row's <c>FactCode</c> is that reason. <c>Items</c> are the first five;
/// <c>Total</c> counts every task that needs attention (each once) and <c>Query</c> is the Task Queue query that lists exactly those tasks (<c>needsAttention=true</c>).
/// Matters and tasks nobody manages never appear.
/// </summary>
/// <param name="Total">All tasks that need attention, each counted once (the rows are capped at five).</param>
/// <param name="Query">The Task Queue query behind "View all": the scope's open tasks with <c>needsAttention=true</c> (and the type filter, if one was asked).</param>
/// <param name="TotalUnfiltered">With a <c>taskTypeId</c> filter: the total without it; null without a filter.</param>
public sealed record MyMattersAttention(
    [property: Required] string TimeZone,
    [property: Required] DateTime AsOfUtc,
    [property: Required] int StuckOnHoldDays,
    [property: Required] int Total,
    [property: Required] string Query,
    [property: Required] IReadOnlyList<MyMattersTaskItem> Items,
    int? TotalUnfiltered = null);

/// <summary>
/// Upcoming deadlines (6.5): open, not overdue, due from today to the last day of the window, soonest first, capped at 25. With <c>groupBy=day</c> or <c>groupBy=matter</c>
/// (epic #758) the flat list is empty and <c>ByDay</c> (every day of the window, for the calendar) or <c>ByMatter</c> (the matters with the soonest deadlines) is filled.
/// </summary>
/// <param name="GroupBy">The grouping asked for (<c>day</c>, <c>matter</c>); null for the flat list.</param>
/// <param name="ByDay">One entry per calendar day from today to the last day (days without a deadline have a count of 0), only with <c>groupBy=day</c>.</param>
/// <param name="ByMatter">The matters that have a deadline in the window, soonest first, at most <see cref="MyMattersAttentionService.MatterGroupSize"/>, only with <c>groupBy=matter</c>.</param>
/// <param name="TotalUnfiltered">With a <c>taskTypeId</c> filter: the total of the window without it ("4 of 13"); null without a filter.</param>
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
    int? MatterTotal = null,
    int? TotalUnfiltered = null);

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

/// <summary>
/// One month of the Overview's Calendar (issue #944): every day of the month with the number of open tasks due on it and the first five of them. Overdue tasks sit on their own due
/// dates, in past months too; each item's <c>FactCode</c> says <c>OVERDUE</c> for them. Tasks with no due date are not on a calendar.
/// </summary>
/// <param name="Month"><c>yyyy-MM</c>.</param>
/// <param name="Total">Tasks due in the month (the sum of the days' counts).</param>
/// <param name="Overdue">Of those, overdue now.</param>
/// <param name="Days">One entry per day of the month, in order; <c>Query</c> of a day is the Task Queue query that lists exactly the tasks it counts.</param>
public sealed record MyMattersCalendar(
    [property: Required] string TimeZone,
    [property: Required] DateTime AsOfUtc,
    [property: Required] string Month,
    [property: Required] DateOnly FromDate,
    [property: Required] DateOnly ToDate,
    [property: Required] DateOnly Today,
    [property: Required] int Total,
    [property: Required] int Overdue,
    [property: Required] IReadOnlyList<MyMattersDeadlineDay> Days);

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

/// <summary>Recent activity of the last 30 days (or the date range), newest first, filtered by matter and kind, paged by cursor.</summary>
/// <param name="SeenEventId">The person's marker: events up to this id are read.</param>
/// <param name="LatestEventId">The newest event of the answer (0 if none).</param>
/// <param name="UnreadCount">Unread events in the window (not only in the rows returned, and whatever the matter / kind filter says: the badge is for all of them).</param>
/// <param name="Total">How many events the matter, kind and unread filters match in the window (the grid's "of N"; the badge is <c>UnreadCount</c>).</param>
/// <param name="HasMore">More events exist than <c>take</c>.</param>
/// <param name="NextCursor">When <c>HasMore</c>: pass it as <c>cursor</c> to get the next, older page; null otherwise.</param>
public sealed record MyMattersActivity(
    [property: Required] string TimeZone,
    [property: Required] DateTime AsOfUtc,
    [property: Required] DateTime SinceUtc,
    [property: Required] long SeenEventId,
    [property: Required] long LatestEventId,
    [property: Required] int UnreadCount,
    [property: Required] int Total,
    [property: Required] bool HasMore,
    [property: Required] IReadOnlyList<MyMattersActivityItem> Items,
    long? NextCursor = null);

/// <summary>One figure of "Since your last visit": the number and the query that opens the list behind it.</summary>
/// <param name="Count">How many.</param>
/// <param name="Query">Where to look: a Task Queue query string, or (<c>Target</c> = <c>activity</c>) the query string of <c>GET /my-matters/activity</c> (<c>kind=...&amp;unread=true</c>).</param>
/// <param name="Target"><c>taskQueue</c> or <c>activity</c>.</param>
public sealed record MyMattersSinceCount(
    [property: Required] int Count,
    [property: Required] string Query,
    [property: Required] string Target);

/// <summary>The figures of the summary. The Overview line draws the four that need a decision (<c>BecameOverdue</c>, <c>PutOnHold</c>, <c>Completed</c>, <c>NewUnassigned</c>); the others stay for the Activity tab.</summary>
/// <param name="NewUnassigned">Open tasks of the scope with nobody assigned that were created on or after the day of the period's start; <c>Query</c> is the Task Queue query that lists them.</param>
public sealed record MyMattersSinceCounts(
    [property: Required] MyMattersSinceCount NewTasks,
    [property: Required] MyMattersSinceCount Completed,
    [property: Required] MyMattersSinceCount BecameOverdue,
    [property: Required] MyMattersSinceCount Reassigned,
    [property: Required] MyMattersSinceCount PutOnHold,
    [property: Required] MyMattersSinceCount Comments,
    [property: Required] MyMattersSinceCount NewUnassigned);

/// <summary>One of the (at most five) most important items: a task that became overdue, then holds and reassignments, newest first. Exactly one of <c>Task</c> and <c>Event</c> is set.</summary>
/// <param name="Kind"><c>BECAME_OVERDUE</c>, <c>ON_HOLD</c> or <c>REASSIGNED</c>.</param>
public sealed record MyMattersSinceItem(
    [property: Required] string Kind,
    MyMattersTaskItem? Task,
    MyMattersActivityItem? Event);

/// <summary>
/// "Since your last visit" (epic #758): what changed on my matters since the person's marker (the last "Mark as read"), or in the last 7 days when they have no marker yet. Opening the page does not
/// move the marker; only <c>POST /my-matters/activity/seen</c> does. The person's own actions are not counted once they have a marker. Comment text is never returned.
/// </summary>
/// <param name="SinceUtc">The start of the period: the time of the last mark as read, or 7 days ago without a marker.</param>
/// <param name="HasMarker">False when the person never marked anything and the last 7 days are used.</param>
/// <param name="SeenEventId">The marker (0 without one).</param>
public sealed record MyMattersSinceLastVisit(
    [property: Required] string TimeZone,
    [property: Required] DateTime AsOfUtc,
    [property: Required] DateTime SinceUtc,
    [property: Required] bool HasMarker,
    [property: Required] long SeenEventId,
    [property: Required] MyMattersSinceCounts Counts,
    [property: Required] IReadOnlyList<MyMattersSinceItem> Items);

/// <summary>The marker after <c>POST /my-matters/activity/seen</c>.</summary>
public sealed record MyMattersActivitySeen(
    [property: Required] long SeenEventId,
    [property: Required] DateTime SeenAtUtc);

/// <summary>
/// One task type of the Breakdown: a column of the matrix, with its totals over <b>all</b> the matters of the scope (not just the page).
/// </summary>
/// <param name="Open">Open tasks of the type (the counted status set of the call).</param>
/// <param name="Overdue">Of those, overdue in the viewer's zone.</param>
/// <param name="OnHold">Of those, On Hold.</param>
/// <param name="AtRisk">Of those, At risk (<see cref="AtRiskRules"/>).</param>
/// <param name="Query">The Task Queue query that lists the open tasks counted in <c>Open</c>.</param>
/// <param name="OverdueQuery">The Task Queue query for the <c>Overdue</c> number.</param>
public sealed record BreakdownType(
    [property: Required] int TaskTypeId,
    [property: Required] string Name,
    [property: Required] string IconKey,
    string? ColourKey,
    [property: Required] int Open,
    [property: Required] int Overdue,
    [property: Required] int OnHold,
    [property: Required] int AtRisk,
    [property: Required] string Query,
    [property: Required] string OverdueQuery);

/// <summary>One cell of the matrix: the tasks of one type on one matter. Cells with no open task are left out.</summary>
/// <param name="Query">The Task Queue query that lists exactly the <c>Open</c> tasks of the cell.</param>
/// <param name="OverdueQuery">The Task Queue query for the <c>Overdue</c> number of the cell.</param>
public sealed record BreakdownCell(
    [property: Required] int TaskTypeId,
    [property: Required] int Open,
    [property: Required] int Overdue,
    [property: Required] int OnHold,
    [property: Required] int AtRisk,
    [property: Required] string Query,
    [property: Required] string OverdueQuery);

/// <summary>One matter row of the matrix: its totals (the row total) and the cells for the types it has tasks of.</summary>
public sealed record BreakdownRow(
    [property: Required] int MatterId,
    [property: Required] string MatterRef,
    [property: Required] string MatterName,
    [property: Required] string ClientName,
    [property: Required] int Open,
    [property: Required] int Overdue,
    [property: Required] int OnHold,
    [property: Required] int AtRisk,
    [property: Required] IReadOnlyList<BreakdownCell> Cells);

/// <summary>The figures over every matter of the scope and every type: they equal the strip counts and the Task Queue counts of the linked queries.</summary>
public sealed record BreakdownTotals(
    [property: Required] int Open,
    [property: Required] int Overdue,
    [property: Required] int OnHold,
    [property: Required] int AtRisk,
    [property: Required] string Query,
    [property: Required] string OverdueQuery);

/// <summary>
/// The Breakdown (PM v2, #861): open work per matter and task type. <c>Types</c> are the columns (at most 40, the types with the most open tasks; <c>TypeTotal</c> says how many types have open tasks), with the totals of
/// the whole scope; <c>Rows</c> are one page of matters sorted by overdue, then open tasks (empty with <c>view=types</c>); <c>Totals</c> and the type totals are over all matters, not the page.
/// </summary>
/// <param name="View"><c>matrix</c> or <c>types</c>.</param>
/// <param name="Status"><c>open</c> or <c>onHold</c>: which tasks are counted.</param>
/// <param name="MatterTotal">How many matters have at least one counted task (the rows are paged 50 at a time).</param>
public sealed record MyMattersBreakdown(
    [property: Required] string TimeZone,
    [property: Required] DateTime AsOfUtc,
    [property: Required] string View,
    [property: Required] string Status,
    [property: Required] IReadOnlyList<BreakdownType> Types,
    [property: Required] int TypeTotal,
    [property: Required] IReadOnlyList<BreakdownRow> Rows,
    [property: Required] int MatterTotal,
    [property: Required] int Page,
    [property: Required] int PageSize,
    [property: Required] BreakdownTotals Totals);

/// <summary>Tasks per status for a scope with the Show filter applied; <c>AllOpen</c> is New + In Progress + On Hold.</summary>
public sealed record TaskStatusCounts(
    [property: Required] int AllOpen,
    [property: Required] int New,
    [property: Required] int InProgress,
    [property: Required] int OnHold,
    [property: Required] int Completed,
    [property: Required] int Cancelled);

/// <summary>Tasks per Show filter for a scope with the status selection applied (<c>Everything</c> is the selection itself).</summary>
public sealed record TaskShowCounts(
    [property: Required] int Everything,
    [property: Required] int Overdue,
    [property: Required] int Risk,
    [property: Required] int Unassigned,
    [property: Required] int Critical,
    [property: Required] int Due7);

/// <summary>
/// The numbers of the Status chips and the Show chips of the Overview, and of the stacked workflow bar of the chosen client or matter (UI-04, #957). <c>ByStatus</c> respects the
/// Show filter, <c>ByShow</c> respects the status selection, so each number equals the Task Queue total of the same two filters.
/// </summary>
public sealed record MyMattersTaskCounts(
    [property: Required] string TimeZone,
    [property: Required] DateTime AsOfUtc,
    [property: Required] TaskStatusCounts ByStatus,
    [property: Required] TaskShowCounts ByShow);

/// <summary>The six kinds of the recent activity feed (UI-03).</summary>
public static class FeedKinds
{
    public const string NewAssets = "NEW_ASSETS";
    public const string NewComments = "NEW_COMMENTS";
    public const string NewStatusUpdates = "NEW_STATUS_UPDATES";
    public const string OnHold = "ON_HOLD";
    public const string Overdue = "OVERDUE";
    public const string DueDateUpdated = "DUE_DATE_UPDATED";

    /// <summary>All kinds in the order they win a tie of time.</summary>
    public static readonly IReadOnlyList<string> All = [Overdue, OnHold, DueDateUpdated, NewStatusUpdates, NewComments, NewAssets];
}

/// <summary>
/// One item of the feed. Fields that do not apply to the kind are null. A comment is only ever "a comment was added to a task": its text is never read here.
/// </summary>
/// <param name="ItemKey">Unique and stable within an answer (<c>KIND:id</c>); use it as the track key.</param>
/// <param name="OccurredAtUtc">Asset created, comment created, status or due date changed, put on hold, or the due moment of an overdue task.</param>
/// <param name="ActorName">Who did it; null for the states On hold and Overdue.</param>
/// <param name="OnHoldReason">The structured reason of the current hold (kind <c>ON_HOLD</c>), when one was chosen.</param>
/// <param name="OnHoldDays">Whole days on hold (kind <c>ON_HOLD</c>).</param>
/// <param name="DaysOverdue">Whole days past the due date (kind <c>OVERDUE</c>).</param>
/// <param name="OldDueDate">The due date before (kind <c>DUE_DATE_UPDATED</c>); null = it was ASAP.</param>
/// <param name="NewDueDate">The due date now; null = it became ASAP.</param>
/// <param name="TypeId">The task type of a task item, or the asset type of an asset item (UI-22, #973); with <c>TypeName</c>, <c>TypeIconKey</c> (closed icon library) and <c>TypeColourKey</c> (palette name; null = derive a default from the id). Null for items without a type.</param>
public sealed record MyMattersFeedItem(
    [property: Required] string ItemKey,
    [property: Required] string Kind,
    [property: Required] DateTime OccurredAtUtc,
    [property: Required] bool IsUnread,
    string? ActorName,
    [property: Required] int MatterId,
    [property: Required] string MatterRef,
    [property: Required] string MatterName,
    [property: Required] int ClientId,
    [property: Required] string ClientName,
    long? TaskId,
    string? TaskNumber,
    string? TaskTitle,
    int? AssetId,
    string? AssetName,
    string? AssetTypeName,
    string? FromStatus,
    string? ToStatus,
    string? OnHoldReason,
    int? OnHoldDays,
    int? DaysOverdue,
    DateOnly? OldDueDate,
    DateOnly? NewDueDate,
    int? TypeId = null,
    string? TypeName = null,
    string? TypeIconKey = null,
    string? TypeColourKey = null);

/// <summary>
/// The recent activity feed of the scope, newest first (UI-03, #956; docs/ux/ui-update/api-contract.md section 3).
/// </summary>
/// <param name="Since">Start of the window of the event kinds.</param>
/// <param name="SeenAtUtc">The person's read marker: items after it, done by somebody else, are unread.</param>
/// <param name="UnreadCount">Unread items of all six kinds (ignores the kind and unread filters).</param>
/// <param name="Total">Items matching the kind and unread filters (the pager's "of N").</param>
/// <param name="CountsByKind">Items per kind (ignores the kind and unread filters); every kind is present.</param>
public sealed record MyMattersFeed(
    [property: Required] DateTime AsOfUtc,
    [property: Required] string TimeZone,
    [property: Required] DateTime Since,
    [property: Required] DateTime SeenAtUtc,
    [property: Required] int UnreadCount,
    [property: Required] int Total,
    [property: Required] int Page,
    [property: Required] int PageSize,
    [property: Required] IReadOnlyDictionary<string, int> CountsByKind,
    [property: Required] IReadOnlyList<MyMattersFeedItem> Items);

/// <summary>One matter of the tree. Counts: open = New + In Progress + On Hold; overdue = New or In Progress past due; unassigned = open with nobody assigned; critical = open with priority Critical.</summary>
/// <param name="IsActive">Has an open task, or an asset created or updated in the last N days (the tree's <c>activeDays</c>).</param>
/// <param name="LastAssetChangeUtc">When an asset of the matter was last created or updated; null when it has none.</param>
public sealed record MyMattersTreeMatter(
    [property: Required] int MatterId,
    [property: Required] string MatterRef,
    [property: Required] string Name,
    [property: Required] bool IsSensitive,
    [property: Required] bool IsActive,
    [property: Required] int OpenTasks,
    [property: Required] int Overdue,
    [property: Required] int Unassigned,
    [property: Required] int Critical,
    DateTime? LastAssetChangeUtc);

/// <summary>A client with its visible matters in the scope; the counts are the sums of its matters.</summary>
public sealed record MyMattersTreeClient(
    [property: Required] int ClientId,
    [property: Required] string ClientNumber,
    [property: Required] string Name,
    [property: Required] int MatterCount,
    [property: Required] int ActiveMatterCount,
    [property: Required] int OpenTasks,
    [property: Required] int Overdue,
    [property: Required] int Unassigned,
    [property: Required] int Critical,
    [property: Required] IReadOnlyList<MyMattersTreeMatter> Matters);

/// <summary>The client/matter tree of My Matters (UI-03, #956; api-contract section 1).</summary>
public sealed record MyMattersTree(
    [property: Required] DateTime AsOfUtc,
    [property: Required] string TimeZone,
    [property: Required] int ActiveDays,
    [property: Required] int ClientCount,
    [property: Required] int MatterCount,
    [property: Required] IReadOnlyList<MyMattersTreeClient> Clients);

/// <summary>One row of the PM's asset list. <c>StatusCode</c> is the disposition.</summary>
public sealed record MyMattersAssetRow(
    [property: Required] int AssetId,
    [property: Required] string Name,
    [property: Required] int ClientId,
    [property: Required] string ClientName,
    [property: Required] int MatterId,
    [property: Required] string MatterRef,
    [property: Required] string MatterName,
    [property: Required] int AssetTypeId,
    [property: Required] string AssetTypeName,
    [property: Required] DateTime CreatedAtUtc,
    DateTime? UpdatedAtUtc,
    [property: Required] string StatusCode,
    [property: Required] int LinkedTaskCount,
    [property: Required] int OpenLinkedTaskCount,
    string? AssetTypeIconKey = null,
    string? AssetTypeColourKey = null);

/// <summary>The latest ordinary comment of a task: author, time and a plain-text excerpt (never a hold or cancel reason comment).</summary>
public sealed record MyMattersLatestComment(
    [property: Required] long CommentId,
    [property: Required] string AuthorName,
    [property: Required] DateTime CreatedAtUtc,
    [property: Required] string Excerpt);

/// <summary>A task linked to an asset, with its latest task comment (assets have no comments of their own).</summary>
public sealed record MyMattersLinkedTask(
    [property: Required] long TaskId,
    [property: Required] string TaskNumber,
    [property: Required] string Title,
    [property: Required] string StatusCode,
    [property: Required] string StatusLabel,
    DateOnly? DueDate,
    [property: Required] bool IsOverdue,
    string? AssigneeName,
    MyMattersLatestComment? LatestComment);

/// <summary>An asset with the tasks linked to it (UI-03, #956; api-contract section 5.2).</summary>
public sealed record MyMattersAssetDetail(
    [property: Required] int AssetId,
    [property: Required] string Name,
    [property: Required] int ClientId,
    [property: Required] string ClientName,
    [property: Required] int MatterId,
    [property: Required] string MatterRef,
    [property: Required] string MatterName,
    [property: Required] int AssetTypeId,
    [property: Required] string AssetTypeName,
    string? Description,
    string? ExternalReference,
    [property: Required] DateTime CreatedAtUtc,
    string? CreatedByName,
    DateTime? UpdatedAtUtc,
    [property: Required] string StatusCode,
    [property: Required] IReadOnlyList<MyMattersLinkedTask> LinkedTasks,
    string? AssetTypeIconKey = null,
    string? AssetTypeColourKey = null);
