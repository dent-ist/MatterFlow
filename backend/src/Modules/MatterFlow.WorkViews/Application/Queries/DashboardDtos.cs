using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>The Dashboard request: how many days back "created" and "completed" look.</summary>
public class DashboardQuery
{
    public static readonly IReadOnlyList<string> Keys = ["periodDays"];

    /// <summary>Length of the period in days, counting today (default 30, 1 to 365).</summary>
    [FromQuery(Name = "periodDays"), Range(1, DashboardRules.MaxPeriodDays)]
    public int PeriodDays { get; init; } = DashboardRules.DefaultPeriodDays;
}

/// <summary>
/// A number with the exact Task Queue query string (no leading <c>?</c>, for example <c>status=NEW&amp;unassigned=true</c>) that lists the counted Tasks.
/// </summary>
public sealed record DashboardCount([property: Required] int Count, [property: Required] string Query);

/// <summary>One row of an "open by ..." breakdown. <c>query</c> is null where the Task Queue has no equivalent filter (no Pod, the combined "other" row).</summary>
/// <param name="Id">The Pod, Task Type or Priority id; null for the "no Pod" and "other" rows and for statuses.</param>
/// <param name="Code">The status code for the status breakdown; otherwise null.</param>
public sealed record DashboardBreakdownItem(
    int? Id,
    string? Code,
    [property: Required] string Label,
    [property: Required] int Count,
    string? Query,
    [property: Required] bool IsOther);

/// <summary>An age band of open Tasks (calendar days since creation in the viewer's zone). Informational, not an SLA.</summary>
/// <param name="MaxDays">Null for the open-ended last band.</param>
public sealed record DashboardAgingBucket(
    [property: Required] string Key,
    [property: Required] string Label,
    [property: Required] int MinDays,
    int? MaxDays,
    [property: Required] int Count,
    [property: Required] string Query);

/// <summary>A Task in the recently created or recently completed list. <c>atUtc</c> is the creation or completion time.</summary>
public sealed record DashboardRecentTask(
    [property: Required] long TaskId,
    [property: Required] string TaskNumber,
    [property: Required] string Title,
    [property: Required] int MatterId,
    [property: Required] string MatterRef,
    [property: Required] string MatterName,
    [property: Required] string Status,
    [property: Required] string StatusLabel,
    [property: Required] DateTime AtUtc);

/// <summary>The period the "completed" and "created" counts cover (viewer's local dates, both inclusive).</summary>
public sealed record DashboardPeriod([property: Required] int Days, [property: Required] DateOnly From, [property: Required] DateOnly To);

/// <summary>The signed-in user's own numbers (My Work).</summary>
public sealed record DashboardMine(
    [property: Required] DashboardCount Open,
    [property: Required] DashboardCount Overdue,
    [property: Required] DashboardCount DueSoon,
    [property: Required] DashboardCount CreatedByMe);

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
    [property: Required] IReadOnlyList<DashboardBreakdownItem> ByPod,
    [property: Required] IReadOnlyList<DashboardBreakdownItem> ByTaskType,
    [property: Required] IReadOnlyList<DashboardBreakdownItem> ByPriority,
    [property: Required] IReadOnlyList<DashboardBreakdownItem> ByStatus,
    [property: Required] IReadOnlyList<DashboardAgingBucket> Aging,
    [property: Required] IReadOnlyList<DashboardRecentTask> RecentlyCreated,
    [property: Required] IReadOnlyList<DashboardRecentTask> RecentlyCompleted,
    [property: Required] DashboardMine Mine);
