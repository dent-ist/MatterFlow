using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>The Dashboard request: how many days back "created" and "completed" look.</summary>
public class DashboardQuery
{
    public static readonly IReadOnlyList<string> Keys = ["period", "from", "to", "periodDays", "fresh", "podScope"];

    /// <summary>Period keyword: <c>7d</c>, <c>30d</c> (default), <c>90d</c>, <c>this-month</c>, <c>last-month</c>, <c>6m</c>, <c>12m</c> or <c>custom</c> (with <c>from</c> and <c>to</c>). Resolved in the viewer's time zone.</summary>
    [FromQuery(Name = "period")]
    public string? Period { get; init; }

    /// <summary>First local day of a custom period (<c>yyyy-MM-dd</c>). Needs <c>to</c>; at most 366 days up to it.</summary>
    [FromQuery(Name = "from")]
    public DateOnly? From { get; init; }

    /// <summary>Last local day of a custom period, included. Needs <c>from</c>.</summary>
    [FromQuery(Name = "to")]
    public DateOnly? To { get; init; }

    /// <summary>Deprecated, kept for one release: a period of this many days ending today (1 to 366). <c>period</c>, <c>from</c> and <c>to</c> win.</summary>
    [FromQuery(Name = "periodDays"), Range(1, DashboardRules.MaxPeriodDays)]
    public int? PeriodDays { get; init; }

    /// <summary>True: skip the short server-side cache and compute the figures now (the Refresh button and a refresh after an edit on the page).</summary>
    [FromQuery(Name = "fresh")]
    public bool Fresh { get; init; }

    /// <summary>The page-wide scope (P1, #89): <c>all</c> (default), <c>mine</c> (the caller's active Pods, resolved on the server) or a Pod id. A Pod that does not exist is 400 <c>UNKNOWN_POD</c>; one the caller may not see is 403.</summary>
    [FromQuery(Name = "podScope"), StringLength(20)]
    public string? PodScope { get; init; }
}

/// <summary>
/// A number with the exact Task Queue query string (no leading <c>?</c>, for example <c>status=NEW&amp;unassigned=true</c>) that lists the counted Tasks.
/// </summary>
public sealed record DashboardCount([property: Required] int Count, [property: Required] string Query);

/// <summary>One row of an "open by ..." breakdown. <c>query</c> is null where the Task Queue has no equivalent filter (the combined "other" row).</summary>
/// <param name="Id">The Task Type or Priority id; null for the "other" row and for statuses.</param>
/// <param name="Code">The status code for the status breakdown; otherwise null.</param>
/// <param name="IconKey">The Task Type icon key for the task-type breakdown (not the "other" row); otherwise null.</param>
/// <param name="Overdue">How many of the <c>Count</c> open Tasks are overdue (the Overdue tile's definition: ASAP never is). The Task Queue lists them with <c>Query</c> plus <c>overdue=true</c>.</param>
public sealed record DashboardBreakdownItem(
    int? Id,
    string? Code,
    [property: Required] string Label,
    [property: Required] int Count,
    string? Query,
    [property: Required] bool IsOther,
    string? IconKey = null,
    [property: Required] int Overdue = 0);

/// <summary>An age band of open Tasks (calendar days since creation in the viewer's zone). Informational, not an SLA.</summary>
/// <param name="MaxDays">Null for the open-ended last band.</param>
/// <param name="Overdue">How many of the <c>Count</c> Tasks are overdue (list them with <c>Query</c> plus <c>overdue=true</c>).</param>
public sealed record DashboardAgingBucket(
    [property: Required] string Key,
    [property: Required] string Label,
    [property: Required] int MinDays,
    int? MaxDays,
    [property: Required] int Count,
    [property: Required] string Query,
    [property: Required] int Overdue = 0);

/// <summary>The period the "completed" and "created" counts cover (viewer's local dates, both inclusive). <c>Key</c> is the period keyword it was resolved from (<c>custom</c> for a date range).</summary>
public sealed record DashboardPeriod([property: Required] int Days, [property: Required] DateOnly From, [property: Required] DateOnly To, [property: Required] string Key);

/// <summary>
/// The operational Dashboard (baseline 12.2). Department-wide (addendum E) but redacted by the caller's Dashboard tab permissions: the headline counts
/// (Open ... Created) need <c>Dashboard.ViewSummary</c> (<c>Dashboard.ViewUnassigned</c> alone gets only the Unassigned count: the size of the queue), ByTaskType, ByPriority, ByStatus and Aging need <c>Dashboard.ViewBreakdowns</c>; what the caller may not see is zero or an empty list.
/// <c>OverdueCritical</c> and <c>OverdueHigh</c> are the overdue Tasks whose Priority carries the <c>critical</c> or <c>high</c> badge token (zero without Dashboard.ViewSummary), each with the Task Queue query that lists them.
/// The Trends tab reads its series from <c>GET /api/v1/dashboard/trend</c> (<c>Dashboard.ViewTrends</c>). Overdue and the period are evaluated in the viewer's time zone (addendum M). Counts are operational facts, never billing or staff productivity measures.
/// </summary>
public sealed record DashboardSummary(
    [property: Required] DashboardPeriod Period,
    [property: Required] string TimeZone,
    [property: Required] DateTime GeneratedAtUtc,
    [property: Required] DashboardCount Open,
    [property: Required] DashboardCount Unassigned,
    [property: Required] DashboardCount Overdue,
    [property: Required] DashboardCount OnHold,
    [property: Required] DashboardCount DueSoon,
    [property: Required] DashboardCount AsapOpen,
    [property: Required] DashboardCount Completed,
    [property: Required] DashboardCount Created,
    [property: Required] IReadOnlyList<DashboardBreakdownItem> ByTaskType,
    [property: Required] IReadOnlyList<DashboardBreakdownItem> ByPriority,
    [property: Required] IReadOnlyList<DashboardBreakdownItem> ByStatus,
    [property: Required] IReadOnlyList<DashboardAgingBucket> Aging,
    [property: Required] DashboardCount OverdueCritical,
    [property: Required] DashboardCount OverdueHigh,
    [property: Required] DashboardScopeInfo Scope);


/// <summary>The request of the Trends tab: the period, the Task Types to draw a line for (at most <see cref="DashboardRules.MaxTrendTypes"/>) and optionally one metric.</summary>
public class DashboardTrendQuery
{
    public static readonly IReadOnlyList<string> Keys = ["period", "from", "to", "periodDays", "taskTypeIds", "metric", "fresh", "podScope"];

    /// <summary>Period keyword: <c>7d</c>, <c>30d</c> (default), <c>90d</c>, <c>this-month</c>, <c>last-month</c>, <c>6m</c>, <c>12m</c> or <c>custom</c> (with <c>from</c> and <c>to</c>). Resolved in the viewer's time zone.</summary>
    [FromQuery(Name = "period")]
    public string? Period { get; init; }

    /// <summary>First local day of a custom period (<c>yyyy-MM-dd</c>). Needs <c>to</c>; at most 366 days up to it.</summary>
    [FromQuery(Name = "from")]
    public DateOnly? From { get; init; }

    /// <summary>Last local day of a custom period, included. Needs <c>from</c>.</summary>
    [FromQuery(Name = "to")]
    public DateOnly? To { get; init; }

    /// <summary>Deprecated, kept for one release: a period of this many days ending today (1 to 366). <c>period</c>, <c>from</c> and <c>to</c> win.</summary>
    [FromQuery(Name = "periodDays"), Range(1, DashboardRules.MaxPeriodDays)]
    public int? PeriodDays { get; init; }

    /// <summary>Task Type ids to return a series for (repeat the parameter, at most 8, active or inactive). The <c>all</c> series and the <c>types</c> legend are always returned.</summary>
    [FromQuery(Name = "taskTypeIds")]
    public int[]? TaskTypeIds { get; init; }

    /// <summary><c>created</c>, <c>completed</c>, <c>overdue</c>, <c>ontime</c>, <c>late</c> or <c>open</c>: compute only that count (the others are 0 in every point). Omitted: all.</summary>
    [FromQuery(Name = "metric")]
    public string? Metric { get; init; }

    /// <summary>True: skip the short server-side cache and compute the figures now.</summary>
    [FromQuery(Name = "fresh")]
    public bool Fresh { get; init; }

    /// <summary>The page-wide scope (P1, #89): <c>all</c> (default), <c>mine</c> (the caller's active Pods, resolved on the server) or a Pod id. A Pod that does not exist is 400 <c>UNKNOWN_POD</c>; one the caller may not see is 403.</summary>
    [FromQuery(Name = "podScope"), StringLength(20)]
    public string? PodScope { get; init; }
}

/// <summary>
/// One point of the Trends tab: a local day, or a week (Monday to Sunday) when the trend's <c>Granularity</c> is <c>week</c> (then <c>Date</c> is the Monday). <c>Overdue</c> and <c>Open</c> are snapshots
/// (Tasks overdue / created and not yet closed at the end of that day or week, or now for today and the current week); the other counts are events of the day (summed over the week). <c>OnTime</c> and <c>Late</c> are Tasks with a due date completed that day on or before / after it.
/// </summary>
public sealed record DashboardTrendDay(
    [property: Required] DateOnly Date,
    [property: Required] int Created,
    [property: Required] int Completed,
    [property: Required] int Overdue,
    [property: Required] int OnTime,
    [property: Required] int Late,
    [property: Required] int Open);

/// <summary>The daily series of one Task Type (same days, same bucketing as <see cref="DashboardTrend.All"/>).</summary>
public sealed record DashboardTypeSeries([property: Required] int TaskTypeId, [property: Required] IReadOnlyList<DashboardTrendDay> Points);

/// <summary>One Task Type of the Trends legend with its totals for the period and the Task Queue queries that list exactly those Tasks.</summary>
/// <param name="IconKey">Key of the type's icon in the icon library.</param>
public sealed record DashboardTrendType(
    [property: Required] int Id,
    [property: Required] string Name,
    [property: Required] string IconKey,
    [property: Required] bool IsActive,
    [property: Required] int Created,
    [property: Required] int Completed,
    [property: Required] int Overdue,
    [property: Required] int OnTime,
    [property: Required] int Late,
    [property: Required] int Open,
    [property: Required] string CreatedQuery,
    [property: Required] string CompletedQuery,
    [property: Required] string OverdueQuery,
    [property: Required] string OpenQuery);

/// <summary>
/// Created, completed, overdue, open, on-time and late per local day (per week, Monday to Sunday, when the period is longer than 31 days: <c>Granularity</c>) for the whole department (<c>all</c>; its created and completed totals equal the Created and Completed counts of the summary) and for each requested Task Type,
/// plus the legend: every Task Type that has Tasks in the period or is active, largest first. Counts only, never per person.
/// </summary>
/// <param name="Metric">The metric asked for or null for all; the other counts are 0 when set.</param>
/// <param name="Granularity"><c>day</c> (periods up to 31 days) or <c>week</c>: every point of every series is then a week and its <c>Date</c> the Monday.</param>
public sealed record DashboardTrend(
    [property: Required] DashboardPeriod Period,
    [property: Required] string TimeZone,
    [property: Required] DateTime GeneratedAtUtc,
    string? Metric,
    [property: Required] string Granularity,
    [property: Required] IReadOnlyList<DashboardTrendDay> All,
    [property: Required] IReadOnlyList<DashboardTypeSeries> ByTaskType,
    [property: Required] IReadOnlyList<DashboardTrendType> Types,
    [property: Required] string CreatedQuery,
    [property: Required] string CompletedQuery,
    [property: Required] string OverdueQuery,
    [property: Required] string OpenQuery);
