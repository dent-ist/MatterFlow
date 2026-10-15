using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkViews.Application.Queries;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Api;

/// <summary>
/// The operational Dashboard: department-wide counts for everyone with Task.View (Phase 1 has no per-record visibility, addendum E), breakdowns of
/// open Tasks, aging, recent Tasks and the caller's own numbers. Overdue and the period use the caller's time zone (<c>X-Time-Zone</c>, addendum M).
/// Every count carries the Task Queue query string that lists exactly the counted Tasks. No billing or productivity figures.
/// </summary>
[ApiController]
[Route("api/v1/dashboard")]
public class DashboardController(DashboardService dashboard) : ControllerBase
{
    /// <summary>Gets the Dashboard for a period (<c>periodDays</c>, default 30, max 365) that drives the "completed" and "created" counts.</summary>
    [HttpGet(Name = "GetDashboard")]
    [Authorize(Policy = "Perm:" + Permissions.Task.View)]
    [ProducesResponseType<DashboardSummary>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<DashboardSummary>> Get([FromQuery] DashboardQuery query, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, DashboardQuery.Keys).OrThrow();
        return (await dashboard.GetAsync(query, cancellationToken)).OrThrow();
    }
}

/// <summary>
/// The Dashboard Swimlane and Users (team workload) tabs. Both need <c>Dashboard.ViewDepartment</c>, are computed for the caller's time zone
/// (<c>X-Time-Zone</c>) and show operational capacity only: no completion statistics, speed or ranking of people.
/// </summary>
[ApiController]
[Route("api/v1/dashboard")]
public class DashboardBoardController(SwimlaneService swimlane, WorkloadService workload) : ControllerBase
{
    /// <summary>
    /// Every open Task plus the Tasks completed or cancelled in the last <c>completedDays</c> days as four lanes (<c>NEW</c>, <c>IN_PROGRESS</c>, <c>ON_HOLD</c>,
    /// <c>COMPLETED</c>) of cards, at most 200 per lane (<c>truncated</c> and <c>total</c> say when there are more; open the Task Queue for the rest).
    /// <c>groupBy</c> adds exact group metadata (a client &gt; matter tree for <c>clientMatter</c>).
    /// </summary>
    [HttpGet("swimlane", Name = "GetDashboardSwimlane")]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.ViewDepartment)]
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
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.ViewDepartment)]
    [ProducesResponseType<WorkloadBoard>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<WorkloadBoard>> GetWorkload([FromQuery] WorkloadQuery query, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, WorkloadQuery.Keys).OrThrow();
        return (await workload.GetAsync(query, cancellationToken)).OrThrow();
    }
}
