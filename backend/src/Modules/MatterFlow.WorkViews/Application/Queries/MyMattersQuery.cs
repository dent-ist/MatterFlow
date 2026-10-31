using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// The parameters every <c>/my-matters/*</c> call accepts (epic #667, docs/ux/pm-review/README.md section 5). "My matters" is a default view,
/// not access control: nothing here hides a matter from anybody who may view tasks.
/// </summary>
public class MyMattersQuery
{
    /// <summary>The parameters the common part accepts (unknown parameters are a 400).</summary>
    public static readonly IReadOnlyList<string> CommonKeys = ["scope", "role", "clientId", "from", "to", "managerId", "fresh", "matterId"];

    /// <summary><c>mine</c> (default): matters where the caller is Primary and/or Secondary manager. <c>all</c>: every active matter; needs <c>Matter.AssignManagers</c> (403 otherwise).</summary>
    [FromQuery(Name = "scope"), StringLength(10)]
    public string? Scope { get; init; }

    /// <summary><c>both</c> (default), <c>primary</c> or <c>secondary</c>: which place of the matter the manager holds. With <c>scope=all</c> it applies to <c>managerId</c>.</summary>
    [FromQuery(Name = "role"), StringLength(10)]
    public string? Role { get; init; }

    /// <summary>Only matters of this client.</summary>
    [FromQuery(Name = "clientId")]
    public int? ClientId { get; init; }

    /// <summary>
    /// First day (<c>yyyy-MM-dd</c>, viewer's calendar) of the date range. On task data it keeps the open tasks with an explicit due date on or after
    /// it (ASAP tasks have no date and are left out while a range is set; the Task Queue link carries <c>dueFrom</c>), on the activity panel it is the
    /// start of the time window.
    /// </summary>
    [FromQuery(Name = "from")]
    public DateOnly? From { get; init; }

    /// <summary>Last day of the date range (see <c>from</c>).</summary>
    [FromQuery(Name = "to")]
    public DateOnly? To { get; init; }

    /// <summary>Only with <c>scope=all</c>: the matters this person manages (Primary and/or Secondary, see <c>role</c>).</summary>
    [FromQuery(Name = "managerId")]
    public int? ManagerId { get; init; }

    /// <summary>True skips the short server-side cache of the summary.</summary>
    [FromQuery(Name = "fresh")]
    public bool? Fresh { get; init; }

    /// <summary>
    /// Only this one matter (the Matter filter of the page, issue #941). It narrows the scope after everything else: a matter outside the scope (not managed in the "mine" scope,
    /// not visible to the caller) gives an empty scope, never an error that would tell it exists.
    /// </summary>
    [FromQuery(Name = "matterId"), Range(1, int.MaxValue)]
    public int? MatterId { get; init; }
}

/// <summary>The counts of the Overview's pre-filter (issue #942): the common parameters plus the task types of the person's Focus, so a count equals the grid total.</summary>
public sealed class MyMattersSummaryQuery : MyMattersQuery
{
    public static readonly IReadOnlyList<string> Keys = [.. CommonKeys, "taskTypeId"];

    /// <summary>Only tasks of these task types (repeatable, OR): the Focus of the page.</summary>
    [FromQuery(Name = "taskTypeId")]
    public int[]? TaskTypeId { get; init; }
}

/// <summary>
/// The sections that list tasks (Needs my attention, Upcoming deadlines): the common parameters plus the task type filter and the sort, both done on the server
/// because a section returns only its first 10 or 25 rows (PM v2, #855). Unknown sort keys and directions are a 400.
/// </summary>
public class MyMattersSectionQuery : MyMattersQuery
{
    public static readonly IReadOnlyList<string> SectionKeys = [.. CommonKeys, "taskTypeId", "sort", "dir"];

    /// <summary>Only tasks of these task types (repeatable, OR). The totals, the rows and the "View all" link follow the filter; <c>unfilteredTotal</c> keeps the total without it.</summary>
    [FromQuery(Name = "taskTypeId")]
    public int[]? TaskTypeId { get; init; }

    /// <summary><c>type</c> (task type name), <c>due</c> (soonest first), <c>priority</c> (most urgent first), <c>matter</c> (matter reference) or <c>age</c> (oldest first). Absent: the section's own order. Ties follow the due date, then the task id.</summary>
    [FromQuery(Name = "sort"), StringLength(20)]
    public string? Sort { get; init; }

    /// <summary><c>asc</c> (default) or <c>desc</c>: reverses the sort key only.</summary>
    [FromQuery(Name = "dir"), StringLength(4)]
    public string? Dir { get; init; }
}

/// <summary>Workload: the common parameters plus the optional split by matter.</summary>
public sealed class MyMattersWorkloadQuery : MyMattersQuery
{
    public static readonly IReadOnlyList<string> Keys = [.. CommonKeys, "include"];

    /// <summary>Absent: people with their counts. <c>matters</c>: each person also carries their five matters with most open tasks and the rest as one count.</summary>
    [FromQuery(Name = "include"), StringLength(20)]
    public string? Include { get; init; }
}

/// <summary>Upcoming deadlines: the common parameters plus the window.</summary>
public sealed class MyMattersDeadlinesQuery : MyMattersSectionQuery
{
    public static readonly IReadOnlyList<string> Keys = [.. SectionKeys, "days", "groupBy"];

    /// <summary><c>14</c> (default) or <c>28</c>: how many days ahead, today included.</summary>
    [FromQuery(Name = "days")]
    public int? Days { get; init; }

    /// <summary>
    /// Absent: the flat list of today (25 rows; <c>sort</c> and <c>dir</c> apply to it only). <c>day</c>: every day of the window with its count and first five tasks (the calendar). <c>matter</c>: the matters with deadlines in the window,
    /// soonest first, each with its total and next five tasks. Counts equal the Task Queue query each bucket carries.
    /// </summary>
    [FromQuery(Name = "groupBy"), StringLength(10)]
    public string? GroupBy { get; init; }
}

/// <summary>The Overview's Calendar (issue #944): the common parameters plus the month, the pre-filter and the Focus.</summary>
public sealed class MyMattersCalendarQuery : MyMattersQuery
{
    public static readonly IReadOnlyList<string> Keys = [.. CommonKeys, "month", "show", "taskTypeId"];

    /// <summary>The month, <c>yyyy-MM</c> in the viewer's calendar; absent: the month of today.</summary>
    [FromQuery(Name = "month"), StringLength(7)]
    public string? Month { get; init; }

    /// <summary><c>open</c> (default), <c>overdue</c>, <c>atRisk</c>, <c>unassigned</c>, <c>onHold</c> or <c>dueSoon</c> (due within 7 days): the pre-filter of the Overview's grid, so the calendar shows the tasks the grid does.</summary>
    [FromQuery(Name = "show"), StringLength(10)]
    public string? Show { get; init; }

    /// <summary>Only tasks of these task types (repeatable, OR): the Focus of the page.</summary>
    [FromQuery(Name = "taskTypeId")]
    public int[]? TaskTypeId { get; init; }
}

/// <summary>Recent activity: the common parameters plus the size, the filters and the cursor.</summary>
public sealed class MyMattersActivityQuery : MyMattersQuery
{
    public const int DefaultTake = 30;

    public static readonly IReadOnlyList<string> Keys = [.. CommonKeys, "take", "kind", "unread", "cursor", "dir", "page"];

    /// <summary>How many events (default 30, max 100), newest first.</summary>
    [FromQuery(Name = "take"), Range(1, 100)]
    public int Take { get; init; } = DefaultTake;

    /// <summary>
    /// Only these kinds (repeatable): <c>TASK_CREATED</c>, <c>STATUS_CHANGED</c> (every status change), <c>COMPLETED</c> and <c>ON_HOLD</c> (the status changes to that status), <c>REASSIGNED</c>,
    /// <c>COMMENTED</c>, <c>MANAGER_CHANGED</c>. Several kinds are an OR.
    /// </summary>
    [FromQuery(Name = "kind")]
    public string[]? Kind { get; init; }

    /// <summary>True: only the events newer than the person's marker that they did not do themselves (what <c>isUnread</c> says).</summary>
    [FromQuery(Name = "unread")]
    public bool? Unread { get; init; }

    /// <summary>Paging: the <c>nextCursor</c> of the previous page. Returns the events older than that event id (newer with <c>dir=asc</c>), in the order asked for.</summary>
    [FromQuery(Name = "cursor"), Range(1, long.MaxValue)]
    public long? Cursor { get; init; }

    /// <summary>The order by When: <c>desc</c> (default, newest first) or <c>asc</c> (oldest first). Issue #946.</summary>
    [FromQuery(Name = "dir"), StringLength(4)]
    public string? Dir { get; init; }

    /// <summary>1-based page of <c>take</c> events (the Activity grid's pager). A <c>cursor</c> wins when both are sent. Issue #946.</summary>
    [FromQuery(Name = "page"), Range(1, int.MaxValue)]
    public int Page { get; init; } = 1;
}

/// <summary>Summary since the person's last visit: the common parameters only.</summary>
public sealed class MyMattersSinceQuery : MyMattersQuery
{
    public static readonly IReadOnlyList<string> Keys = [.. CommonKeys];
}

/// <summary>Body of <c>POST /my-matters/activity/seen</c>.</summary>
public sealed class MarkActivitySeenRequest
{
    /// <summary>Mark everything up to and including this audit event id as read (opening one item). Omitted: everything up to now ("Mark all as read"). The marker only ever moves forward.</summary>
    [Range(1, long.MaxValue)]
    public long? UpToEventId { get; init; }
}

/// <summary>The Breakdown (PM v2, #861): the common parameters plus the view, the status, the type filter and the matter paging.</summary>
public sealed class MyMattersBreakdownQuery : MyMattersQuery
{
    public const int DefaultPageSize = 50;

    public static readonly IReadOnlyList<string> Keys = [.. CommonKeys, "view", "status", "taskTypeId", "page", "pageSize"];

    /// <summary><c>matrix</c> (default): one row per matter with a cell per task type and the totals. <c>types</c>: only the per task type totals ("all matters").</summary>
    [FromQuery(Name = "view"), StringLength(10)]
    public string? View { get; init; }

    /// <summary><c>open</c> (default: New, In Progress and On Hold) or <c>onHold</c> (only the tasks On Hold).</summary>
    [FromQuery(Name = "status"), StringLength(10)]
    public string? Status { get; init; }

    /// <summary>Only these task types (repeatable). A type with no task in the scope is not a column.</summary>
    [FromQuery(Name = "taskTypeId")]
    public int[]? TaskTypeId { get; init; }

    /// <summary>1-based page of matters (50 per page, sorted by overdue, then open tasks).</summary>
    [FromQuery(Name = "page"), Range(1, int.MaxValue)]
    public int Page { get; init; } = 1;

    /// <summary>Matters per page (default 50, max 50).</summary>
    [FromQuery(Name = "pageSize"), Range(1, 50)]
    public int PageSize { get; init; } = DefaultPageSize;
}

/// <summary>The status and Show counts of the Overview (UI-04, #957): the scope plus the other filter, so every number equals the grid total after the click.</summary>
public sealed class MyMattersTaskCountsQuery : MyMattersQuery
{
    public static readonly IReadOnlyList<string> Keys = [.. CommonKeys, "status", "show"];

    /// <summary>Status codes (<c>NEW</c>, <c>IN_PROGRESS</c>, <c>ON_HOLD</c>, <c>COMPLETED</c>, <c>CANCELLED</c>), repeatable or comma separated. They narrow the <c>byShow</c> counts; absent = the open statuses (New, In Progress, On Hold).</summary>
    [FromQuery(Name = "status")]
    public string[]? Status { get; init; }

    /// <summary>One of <c>overdue</c>, <c>risk</c>, <c>due7</c>, <c>critical</c>, <c>unassigned</c> (see the Task Queue's <c>show</c>). It narrows the <c>byStatus</c> counts; absent = every task.</summary>
    [FromQuery(Name = "show"), StringLength(12)]
    public string? Show { get; init; }
}

/// <summary>The Calendar tab's events (UI-05, #958): the scope plus the required day range (<c>from</c>, <c>to</c>, inclusive, at most 100 days) and optional types.</summary>
public sealed class MyMattersEventsQuery : MyMattersQuery
{
    public static readonly IReadOnlyList<string> Keys = [.. CommonKeys, "typeCode"];

    /// <summary>Only these event types (repeatable); see <c>GET /matter-event-types</c>.</summary>
    [FromQuery(Name = "typeCode")]
    public string[]? TypeCode { get; init; }
}

/// <summary>The side panel's Upcoming events: the scope plus the window from today and the number of rows.</summary>
public sealed class MyMattersUpcomingEventsQuery : MyMattersQuery
{
    public const int DefaultDays = 14;
    public const int DefaultTake = 10;

    public static readonly IReadOnlyList<string> Keys = [.. CommonKeys.Where(k => k is not ("from" or "to")), "days", "take"];

    /// <summary>Days from today, today included (default 14, max 60), in the viewer's calendar.</summary>
    [FromQuery(Name = "days"), Range(1, 60)]
    public int Days { get; init; } = DefaultDays;

    /// <summary>Rows returned (default 10, max 50); <c>total</c> counts the whole window.</summary>
    [FromQuery(Name = "take"), Range(1, 50)]
    public int Take { get; init; } = DefaultTake;
}

/// <summary>The six-kind recent activity feed (UI-03, #956): the scope plus the kinds, the window, the unread filter and the page.</summary>
public sealed class MyMattersFeedQuery : MyMattersQuery
{
    public const int DefaultDays = 30;
    public const int DefaultPageSize = 25;
    public const int MaxItems = 500;

    public static readonly IReadOnlyList<string> Keys = [.. CommonKeys.Where(k => k is not ("from" or "to")), "kind", "days", "unread", "page", "pageSize"];

    /// <summary>Only these kinds (repeatable): <c>NEW_ASSETS</c>, <c>NEW_COMMENTS</c>, <c>NEW_STATUS_UPDATES</c>, <c>ON_HOLD</c>, <c>OVERDUE</c>, <c>DUE_DATE_UPDATED</c>. Absent: all six.</summary>
    [FromQuery(Name = "kind")]
    public string[]? Kind { get; init; }

    /// <summary>The window of the event kinds in days (default 30, max 90). Overdue and On hold are states and are not limited by it.</summary>
    [FromQuery(Name = "days"), Range(1, 90)]
    public int Days { get; init; } = DefaultDays;

    /// <summary>True: only items newer than the person's marker that they did not cause themselves.</summary>
    [FromQuery(Name = "unread")]
    public bool? Unread { get; init; }

    [FromQuery(Name = "page"), Range(1, int.MaxValue)]
    public int Page { get; init; } = 1;

    /// <summary>Items per page (default 25, max 100); <c>page</c> times <c>pageSize</c> may not exceed 500.</summary>
    [FromQuery(Name = "pageSize"), Range(1, 100)]
    public int PageSize { get; init; } = DefaultPageSize;
}

/// <summary>The matter tree (UI-03, #956): the scope plus the "active" window and a search.</summary>
public sealed class MyMattersTreeQuery : MyMattersQuery
{
    public const int DefaultActiveDays = 7;

    public static readonly IReadOnlyList<string> Keys = [.. CommonKeys.Where(k => k is not ("from" or "to")), "activeDays", "q", "activeOnly"];

    /// <summary>A matter is active when it has an open task or an asset created or updated in the last N days (default: the setting <c>MyMatters:ActiveDays</c>, else 7; 1 to 90).</summary>
    [FromQuery(Name = "activeDays"), Range(1, 90)]
    public int? ActiveDays { get; init; }

    /// <summary>Fragment of the client name or number, or the matter name or reference. A client whose own name matches keeps all its matters.</summary>
    [FromQuery(Name = "q"), StringLength(200)]
    public string? Q { get; init; }

    /// <summary>True: only active matters (a client without one is left out).</summary>
    [FromQuery(Name = "activeOnly")]
    public bool? ActiveOnly { get; init; }
}

/// <summary>The PM's asset list (UI-03, #956): the scope plus column filters, sort and paging.</summary>
public sealed class MyMattersAssetsQuery : MyMattersQuery
{
    public static readonly IReadOnlyList<string> SortFields = ["name", "client", "matter", "assetType", "created", "updated", "status", "linkedTasks"];

    public static readonly IReadOnlyList<string> Keys =
    [
        .. CommonKeys.Where(k => k is not ("from" or "to")),
        "q", "name", "assetTypeId", "status", "createdFrom", "createdTo", "updatedFrom", "updatedTo", "sort", "dir", "page", "pageSize",
    ];

    /// <summary>Fragment of the asset name, external reference, asset type or matter name.</summary>
    [FromQuery(Name = "q"), StringLength(200)]
    public string? Q { get; init; }

    /// <summary>Column filter: fragment of the asset name.</summary>
    [FromQuery(Name = "name"), StringLength(200)]
    public string? Name { get; init; }

    [FromQuery(Name = "assetTypeId")]
    public int[]? AssetTypeId { get; init; }

    /// <summary>Disposition codes, repeatable: <c>ACTIVE</c>, <c>INACTIVE</c>, <c>PENDING_DISPOSITION</c>, <c>DISPOSED</c>.</summary>
    [FromQuery(Name = "status")]
    public string[]? Status { get; init; }

    [FromQuery(Name = "createdFrom")]
    public DateOnly? CreatedFrom { get; init; }

    [FromQuery(Name = "createdTo")]
    public DateOnly? CreatedTo { get; init; }

    /// <summary>Updated on or after this day; an asset never updated does not match.</summary>
    [FromQuery(Name = "updatedFrom")]
    public DateOnly? UpdatedFrom { get; init; }

    [FromQuery(Name = "updatedTo")]
    public DateOnly? UpdatedTo { get; init; }

    /// <summary><c>name</c>, <c>client</c>, <c>matter</c>, <c>assetType</c>, <c>created</c>, <c>updated</c> (default), <c>status</c>, <c>linkedTasks</c>.</summary>
    [FromQuery(Name = "sort"), StringLength(20)]
    public string? Sort { get; init; }

    /// <summary><c>asc</c> or <c>desc</c> (default: descending for created and updated, else ascending).</summary>
    [FromQuery(Name = "dir"), StringLength(4)]
    public string? Dir { get; init; }

    [FromQuery(Name = "page"), Range(1, int.MaxValue)]
    public int Page { get; init; } = 1;

    [FromQuery(Name = "pageSize"), Range(1, 100)]
    public int PageSize { get; init; } = 25;
}
