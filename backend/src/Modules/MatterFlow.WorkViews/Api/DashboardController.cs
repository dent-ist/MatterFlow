using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkViews.Application.Queries;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Api;

/// <summary>
/// The operational Dashboard: department-wide counts (Phase 1 has no per-record visibility, addendum E), breakdowns of open Tasks, aging and trend.
/// The Dashboard is not for everyone: it needs <c>Dashboard.View</c> plus at least one tab permission, and the payload only carries the sections
/// the caller's tab permissions allow (Summary, the unassigned queue alone with <c>Dashboard.ViewUnassigned</c>, Breakdowns, Trends; the rest is empty). Overdue and the period use the caller's time zone
/// (<c>X-Time-Zone</c>, addendum M). Every count carries the Task Queue query string that lists exactly the counted Tasks. No billing or productivity figures.
/// </summary>
[ApiController]
[Route("api/v1/dashboard")]
public class DashboardController(DashboardService dashboard, DashboardTrendService trend) : ControllerBase
{
    /// <summary>Gets the Dashboard for a period (<c>period</c>, default 30 days) that drives the "completed" and "created" counts, for the Tasks of the <c>podScope</c> (<c>all</c> by default).</summary>
    [HttpGet(Name = "GetDashboard")]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.View)]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.ViewSummary + "|" + Permissions.Dashboard.ViewUnassigned + "|" + Permissions.Dashboard.ViewBreakdowns + "|" + Permissions.Dashboard.ViewTrends)]
    [ProducesResponseType<DashboardSummary>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<DashboardSummary>> Get([FromQuery] DashboardQuery query, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, DashboardQuery.Keys).OrThrow();
        return (await dashboard.GetAsync(query, cancellationToken)).OrThrow();
    }

    /// <summary>
    /// What the page-wide Scope select offers the caller (P1): the default scope (<c>mine</c> for a member of at least one active Pod, otherwise <c>all</c>),
    /// whether "My pods" is offered, and the Pods: the caller's own first, then (with <c>Pod.View</c>) the other active Pods. Needs <c>Dashboard.View</c> and any Dashboard tab permission.
    /// </summary>
    [HttpGet("scopes", Name = "GetDashboardScopes")]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.View)]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.ViewSummary + "|" + Permissions.Dashboard.ViewUnassigned + "|" + Permissions.Dashboard.ViewBreakdowns + "|" + Permissions.Dashboard.ViewTrends
        + "|" + Permissions.Dashboard.ViewSwimlane + "|" + Permissions.Dashboard.ViewUsers + "|" + Permissions.Dashboard.ViewCoverage)]
    [ProducesResponseType<DashboardScopeChoices>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<DashboardScopeChoices>> GetScopes([FromServices] DashboardScopeResolver scopes, CancellationToken cancellationToken) =>
        (await scopes.ChoicesAsync(cancellationToken)).OrThrow();

    /// <summary>
    /// The Trends tab: created, completed, overdue and open (snapshots at the end of each local day), on time and late per local day (per week, Monday to Sunday, for periods over 31 days) (the viewer's time zone) for all
    /// task types (<c>all</c>) and for each <c>taskTypeIds</c> (repeat the parameter, at most 8: 400 <c>TOO_MANY_TYPES</c>; an unknown id: 400 <c>UNKNOWN_TASK_TYPE</c>),
    /// plus <c>types</c>, the legend of every task type with Tasks in the period or still active with its totals and the Task Queue queries that list them.
    /// <c>metric</c> computes only that count. Needs <c>Dashboard.View</c> and <c>Dashboard.ViewTrends</c>.
    /// </summary>
    [HttpGet("trend", Name = "GetDashboardTrend")]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.View)]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.ViewTrends)]
    [ProducesResponseType<DashboardTrend>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<DashboardTrend>> GetTrend([FromQuery] DashboardTrendQuery query, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, DashboardTrendQuery.Keys).OrThrow();
        return (await trend.GetAsync(query, cancellationToken)).OrThrow();
    }
}

/// <summary>
/// The Dashboard Swimlane and Users (team workload) tabs. Both need <c>Dashboard.View</c> plus their own tab permission (<c>Dashboard.ViewSwimlane</c>, <c>Dashboard.ViewUsers</c>), are computed for the caller's time zone
/// (<c>X-Time-Zone</c>) and show operational capacity only: no completion statistics, speed or ranking of people.
/// </summary>
[ApiController]
[Route("api/v1/dashboard")]
public class DashboardBoardController(SwimlaneService swimlane, WorkloadService workload, CoverageService coverage) : ControllerBase
{
    /// <summary>
    /// Every open Task plus the Tasks completed or cancelled in the last <c>completedDays</c> days as four lanes (<c>NEW</c>, <c>IN_PROGRESS</c>, <c>ON_HOLD</c>,
    /// <c>COMPLETED</c>) of cards, at most 200 per lane (<c>truncated</c> and <c>total</c> say when there are more; open the Task Queue for the rest).
    /// <c>groupBy</c> adds exact group metadata (a client &gt; matter tree for <c>clientMatter</c>).
    /// </summary>
    [HttpGet("swimlane", Name = "GetDashboardSwimlane")]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.View)]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.ViewSwimlane)]
    [ProducesResponseType<SwimlaneBoard>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<SwimlaneBoard>> GetSwimlane([FromQuery] SwimlaneQuery query, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, SwimlaneQuery.Keys).OrThrow();
        return (await swimlane.GetAsync(query, cancellationToken)).OrThrow();
    }

    /// <summary>
    /// One entry per active user who can hold work: availability, open Tasks per Priority (all active priorities in rank order), overdue, due soon, on hold,
    /// top priority, next due date and a load level (<c>IDLE</c>, <c>LIGHT</c>, <c>NORMAL</c>, <c>HEAVY</c>), plus team totals. Default order: available first, then lighter load.
    /// </summary>
    [HttpGet("workload", Name = "GetDashboardWorkload")]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.View)]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.ViewUsers)]
    [ProducesResponseType<WorkloadBoard>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<WorkloadBoard>> GetWorkload([FromQuery] WorkloadQuery query, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, WorkloadQuery.Keys).OrThrow();
        return (await workload.GetAsync(query, cancellationToken)).OrThrow();
    }

    /// <summary>
    /// How many Tasks each person completed per task type in a period (<c>from</c> and <c>to</c>, or <c>periodDays</c>, default 30), for training and
    /// cross-coverage planning (addendum Q). Needs its own permission, <c>Dashboard.ViewCoverage</c> (with <c>Dashboard.View</c>). Cells list only non-zero counts; the matrix fills in zeros. <c>groupBy=type</c> answers per task type the people who handled it (alphabetical, no counts ranking) instead of the people and cells.
    /// </summary>
    [HttpGet("coverage", Name = "GetDashboardCoverage")]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.View)]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.ViewCoverage)]
    [ProducesResponseType<CoverageBoard>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<CoverageBoard>> GetCoverage([FromQuery] CoverageQuery query, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, CoverageQuery.Keys).OrThrow();
        return (await coverage.GetAsync(query, cancellationToken)).OrThrow();
    }
}
