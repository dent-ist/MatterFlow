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
