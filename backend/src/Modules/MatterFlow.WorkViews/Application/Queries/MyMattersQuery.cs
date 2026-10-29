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

    public static readonly IReadOnlyList<string> Keys = [.. CommonKeys, "take", "kind", "unread", "cursor"];

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

    /// <summary>Paging: the <c>nextCursor</c> of the previous page. Returns the events older than that event id, still newest first.</summary>
    [FromQuery(Name = "cursor"), Range(1, long.MaxValue)]
    public long? Cursor { get; init; }
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
