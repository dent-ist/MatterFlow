using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>The Dashboard request: how many days back "created" and "completed" look.</summary>
public class DashboardQuery
{
    public static readonly IReadOnlyList<string> Keys = ["periodDays", "fresh"];

    /// <summary>Length of the period in days, counting today (default 30, 1 to 365).</summary>
    [FromQuery(Name = "periodDays"), Range(1, DashboardRules.MaxPeriodDays)]
    public int PeriodDays { get; init; } = DashboardRules.DefaultPeriodDays;

    /// <summary>True: skip the short server-side cache and compute the figures now (the Refresh button and a refresh after an edit on the page).</summary>
    [FromQuery(Name = "fresh")]
    public bool Fresh { get; init; }
}

/// <summary>
/// A number with the exact Task Queue query string (no leading <c>?</c>, for example <c>status=NEW&amp;unassigned=true</c>) that lists the counted Tasks.
/// </summary>
public sealed record DashboardCount([property: Required] int Count, [property: Required] string Query);

/// <summary>One row of an "open by ..." breakdown. <c>query</c> is null where the Task Queue has no equivalent filter (the combined "other" row).</summary>
/// <param name="Id">The Task Type or Priority id; null for the "other" row and for statuses.</param>
/// <param name="Code">The status code for the status breakdown; otherwise null.</param>
/// <param name="IconKey">The Task Type icon key for the task-type breakdown (not the "other" row); otherwise null.</param>
public sealed record DashboardBreakdownItem(
    int? Id,
    string? Code,
    [property: Required] string Label,
    [property: Required] int Count,
    string? Query,
    [property: Required] bool IsOther,
    string? IconKey = null);

/// <summary>One local calendar day of the period: Tasks created that day and Tasks completed that day (counts only, never per person).</summary>
public sealed record DashboardTrendPoint([property: Required] DateOnly Date, [property: Required] int Created, [property: Required] int Completed);

/// <summary>An age band of open Tasks (calendar days since creation in the viewer's zone). Informational, not an SLA.</summary>
/// <param name="MaxDays">Null for the open-ended last band.</param>
public sealed record DashboardAgingBucket(
    [property: Required] string Key,
    [property: Required] string Label,
    [property: Required] int MinDays,
    int? MaxDays,
    [property: Required] int Count,
    [property: Required] string Query);

/// <summary>The period the "completed" and "created" counts cover (viewer's local dates, both inclusive).</summary>
public sealed record DashboardPeriod([property: Required] int Days, [property: Required] DateOnly From, [property: Required] DateOnly To);

/// <summary>
/// The operational Dashboard (baseline 12.2). Department-wide for everyone with Task.View (addendum E); overdue and the period are evaluated in
/// the viewer's time zone (addendum M). Counts are operational facts, never billing or staff productivity measures.
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
    [property: Required] IReadOnlyList<DashboardTrendPoint> Trend);

