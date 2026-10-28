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

/// <summary>One row of the health table (6.3).</summary>
/// <param name="ClientNumber">The five-digit client number.</param>
/// <param name="AtRisk">Open tasks of the matter that are At risk (<see cref="AtRiskRules"/>).</param>
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
    [property: Required] int AtRisk,
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
/// <param name="HasMore">More events exist than <c>take</c>.</param>
/// <param name="NextCursor">When <c>HasMore</c>: pass it as <c>cursor</c> to get the next, older page; null otherwise.</param>
public sealed record MyMattersActivity(
    [property: Required] string TimeZone,
    [property: Required] DateTime AsOfUtc,
    [property: Required] DateTime SinceUtc,
    [property: Required] long SeenEventId,
    [property: Required] long LatestEventId,
    [property: Required] int UnreadCount,
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

/// <summary>One week (Monday to Sunday in the viewer's zone) of the trends.</summary>
/// <param name="WeekStart">The Monday.</param>
/// <param name="WeekEnd">The Sunday.</param>
/// <param name="IsCurrent">The week that contains today: it is not over, "at week end" means now.</param>
/// <param name="Created">Tasks created in the week (<c>CreatedAt</c>).</param>
/// <param name="Closed">Tasks completed in the week (the moment of the completion).</param>
/// <param name="OverdueAtWeekEnd">Tasks that were open at the end of the week (now, for the current week) with a due moment before it. Derived, see <see cref="MyMattersTrends.Limitations"/>.</param>
/// <param name="CreatedQuery">The Task Queue query that lists the created tasks.</param>
/// <param name="ClosedQuery">The Task Queue query that lists the completed tasks.</param>
public sealed record MyMattersTrendWeek(
    [property: Required] DateOnly WeekStart,
    [property: Required] DateOnly WeekEnd,
    [property: Required] bool IsCurrent,
    [property: Required] int Created,
    [property: Required] int Closed,
    [property: Required] int OverdueAtWeekEnd,
    [property: Required] string CreatedQuery,
    [property: Required] string ClosedQuery);

/// <summary>The figures of today next to the weekly series.</summary>
/// <param name="Open">Open tasks now.</param>
/// <param name="AverageAgeDays">Average age of the open tasks (now minus <c>CreatedAt</c>), one decimal; null with no open task.</param>
/// <param name="OnHold">Tasks on hold now.</param>
/// <param name="OldestOnHoldDays">Whole days the longest-waiting task has been on hold; null when none is.</param>
public sealed record MyMattersTrendNow(
    [property: Required] int Open,
    double? AverageAgeDays,
    [property: Required] int OnHold,
    int? OldestOnHoldDays,
    [property: Required] string OpenQuery,
    [property: Required] string OnHoldQuery,
    [property: Required] string OverdueQuery);

/// <summary>
/// Trends of the matters in scope, week by week (epic #758, PX-09). Approximate on purpose: the schema keeps no history of due dates or statuses, so the series are derived from the current columns.
/// </summary>
/// <param name="Weeks">8, 12 or 26.</param>
/// <param name="Approximate">Always true: the figures are derived, not recorded. Show <c>Limitations</c> next to them.</param>
/// <param name="Limitations">Codes of what makes the figures approximate: <c>CURRENT_DUE_DATES</c> (a task that was re-dated is counted by its current due date), <c>CURRENT_STATUS</c> (a task that was re-opened is counted by its current status and last status change), <c>CURRENT_MATTER_SET</c> (the matters are those in scope now, with their tasks of all times).</param>
public sealed record MyMattersTrends(
    [property: Required] string TimeZone,
    [property: Required] DateTime AsOfUtc,
    [property: Required] int Weeks,
    [property: Required] bool Approximate,
    [property: Required] IReadOnlyList<string> Limitations,
    [property: Required] IReadOnlyList<MyMattersTrendWeek> Points,
    [property: Required] MyMattersTrendNow Now);

/// <summary>
/// One task type of the Breakdown: a column of the matrix, with its totals over <b>all</b> the matters of the scope (not just the page).
/// </summary>
/// <param name="TargetDays">The type's target turnaround in calendar days; null = none.</param>
/// <param name="Open">Open tasks of the type (the counted status set of the call).</param>
/// <param name="Overdue">Of those, overdue in the viewer's zone.</param>
/// <param name="OnHold">Of those, On Hold.</param>
/// <param name="AtRisk">Of those, At risk (<see cref="AtRiskRules"/>).</param>
/// <param name="AvgDaysDone">Average calendar days from creation to completion of the tasks of this type completed in the last 90 days (one decimal); null when none completed.</param>
/// <param name="DoneCount">How many tasks that average is over.</param>
/// <param name="Query">The Task Queue query that lists the open tasks counted in <c>Open</c>.</param>
/// <param name="OverdueQuery">The Task Queue query for the <c>Overdue</c> number.</param>
public sealed record BreakdownType(
    [property: Required] int TaskTypeId,
    [property: Required] string Name,
    [property: Required] string IconKey,
    string? ColourKey,
    int? TargetDays,
    [property: Required] int Open,
    [property: Required] int Overdue,
    [property: Required] int OnHold,
    [property: Required] int AtRisk,
    double? AvgDaysDone,
    [property: Required] int DoneCount,
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
/// <param name="AvgWindowDays">The window of <c>AvgDaysDone</c>: 90.</param>
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
    [property: Required] BreakdownTotals Totals,
    [property: Required] int AvgWindowDays);
