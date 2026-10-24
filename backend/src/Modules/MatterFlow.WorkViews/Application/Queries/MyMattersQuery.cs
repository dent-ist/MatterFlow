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
    public static readonly IReadOnlyList<string> CommonKeys = ["scope", "role", "clientId", "from", "to", "managerId", "fresh"];

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
}

/// <summary>The health table: the common parameters plus sort and paging.</summary>
public sealed class MyMattersHealthQuery : MyMattersQuery
{
    public const int DefaultPageSize = 50;

    public static readonly IReadOnlyList<string> Keys = [.. CommonKeys, "sort", "dir", "page", "pageSize"];

    /// <summary><c>nextDeadline</c> (default, soonest first, matters with none last), <c>client</c>, <c>matter</c>, <c>open</c>, <c>overdue</c>, <c>dueThisWeek</c>, <c>unassigned</c> or <c>flag</c>.</summary>
    [FromQuery(Name = "sort"), StringLength(20)]
    public string? Sort { get; init; }

    /// <summary><c>asc</c> or <c>desc</c> (default: ascending, except the counts, which default to the largest first).</summary>
    [FromQuery(Name = "dir"), StringLength(4)]
    public string? Dir { get; init; }

    /// <summary>1-based page number.</summary>
    [FromQuery(Name = "page"), Range(1, int.MaxValue)]
    public int Page { get; init; } = 1;

    /// <summary>Rows per page (default 50, max 100).</summary>
    [FromQuery(Name = "pageSize"), Range(1, 100)]
    public int PageSize { get; init; } = DefaultPageSize;
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
public sealed class MyMattersDeadlinesQuery : MyMattersQuery
{
    public static readonly IReadOnlyList<string> Keys = [.. CommonKeys, "days", "groupBy"];

    /// <summary><c>14</c> (default) or <c>28</c>: how many days ahead, today included.</summary>
    [FromQuery(Name = "days")]
    public int? Days { get; init; }

    /// <summary>
    /// Absent: the flat list of today (25 rows). <c>day</c>: every day of the window with its count and first five tasks (the calendar). <c>matter</c>: the matters with deadlines in the window,
    /// soonest first, each with its total and next five tasks. Counts equal the Task Queue query each bucket carries.
    /// </summary>
    [FromQuery(Name = "groupBy"), StringLength(10)]
    public string? GroupBy { get; init; }
}

/// <summary>Recent activity: the common parameters plus the size.</summary>
public sealed class MyMattersActivityQuery : MyMattersQuery
{
    public const int DefaultTake = 30;

    public static readonly IReadOnlyList<string> Keys = [.. CommonKeys, "take"];

    /// <summary>How many events (default 30, max 100), newest first.</summary>
    [FromQuery(Name = "take"), Range(1, 100)]
    public int Take { get; init; } = DefaultTake;
}

/// <summary>Body of <c>POST /my-matters/activity/seen</c>.</summary>
public sealed class MarkActivitySeenRequest
{
    /// <summary>Mark everything up to and including this audit event id as read (opening one item). Omitted: everything up to now ("Mark all as read"). The marker only ever moves forward.</summary>
    [Range(1, long.MaxValue)]
    public long? UpToEventId { get; init; }
}
