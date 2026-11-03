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
[MatterFlow.SharedKernel.Visibility.PreparesViewer(Stamp = true)]
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
[MatterFlow.SharedKernel.Visibility.PreparesViewer]
public class DashboardBoardController(SwimlaneService swimlane, WorkloadService workload, CoverageService coverage, CapacityService capacity, UserHistoryService history, SkillsService skills) : ControllerBase
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
    /// The department capacity battery (Dashboard v4): the workers of the scope (<c>Workflow.Execute</c> holders who are active members of a Pod in the scope), how many can take work now, free slots, used percent and a count per state
    /// (Available, Occupied, Busy, Overloaded, Out of office, Off hours), plus how many Tasks were assigned in the last hour. Aggregates only; load is the true count of a worker's open Tasks (a bare number, also for hidden Matters). People
    /// out of office or outside their work hours are not counted as capacity; when nobody can take work now <c>state</c> is <c>AFTER_HOURS</c> and the percentages are null. Needs <c>Dashboard.View</c> and <c>Dashboard.ViewUsers</c>.
    /// </summary>
    [HttpGet("capacity", Name = "GetDashboardCapacity")]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.View)]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.ViewUsers)]
    [ProducesResponseType<DashboardCapacity>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<DashboardCapacity>> GetCapacity([FromQuery] CapacityQuery query, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, CapacityQuery.Keys).OrThrow();
        return (await capacity.GetAsync(query, cancellationToken)).OrThrow();
    }

    /// <summary>
    /// The People list behind the capacity battery: per worker of the scope the display name, state, load number, the last day out of office (date only) and the Pod names, most loaded first then by name, at most 200.
    /// Optional <c>q</c> (name fragment) and <c>state</c>. No Task, Matter or note data. Needs <c>Dashboard.View</c> and <c>Dashboard.ViewUsers</c>.
    /// </summary>
    [HttpGet("capacity/people", Name = "GetDashboardCapacityPeople")]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.View)]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.ViewUsers)]
    [ProducesResponseType<CapacityPerson[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<IReadOnlyList<CapacityPerson>>> GetCapacityPeople([FromQuery] CapacityPeopleQuery query, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, CapacityPeopleQuery.Keys).OrThrow();
        return Ok((await capacity.GetPeopleAsync(query, cancellationToken)).OrThrow());
    }

    /// <summary>
    /// One person's history for the user drawer: per task type the Tasks completed in the window (<c>months</c> 3 or 12, default 12), the person's median duration (Started to Completed, <c>durationUnit</c> in
    /// <c>durationBasis</c> working or clock time) next to the firm median of the same type and window and their ratio, each median only from a sample of 5 (else null with the sample size), the last 12 calendar months
    /// of completions and the on-time rate. Cancelled Tasks never count. Aggregates only; Tasks of hidden Matters are left out like everywhere. With a Pod scope the person must belong to it, else 404.
    /// Needs <c>Dashboard.View</c> and <c>Dashboard.ViewUsers</c>.
    /// </summary>
    [HttpGet("users/{userId:int}/history", Name = "GetDashboardUserHistory")]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.View)]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.ViewUsers)]
    [ProducesResponseType<UserHistory>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<UserHistory>> GetUserHistory(int userId, [FromQuery] UserHistoryQuery query, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, UserHistoryQuery.Keys).OrThrow();
        return (await history.GetAsync(userId, query, cancellationToken)).OrThrow();
    }

    /// <summary>
    /// The Skills matrix: the workers of the scope (<c>Workflow.Execute</c> holders who are active members of a Pod in the scope, as in the capacity battery) by task type, with the Tasks each completed in the last 3 and 12 months
    /// (non-zero cells only), each person's capacity state and load, and per type how many people are experienced (5 or more in 12 months) with <c>isThin</c> set for 0 to 2. Alphabetical, no ranking.
    /// Needs <c>Dashboard.View</c> and <c>Dashboard.ViewUsers</c>.
    /// </summary>
    [HttpGet("users/skills", Name = "GetDashboardSkills")]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.View)]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.ViewUsers)]
    [ProducesResponseType<SkillsMatrix>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<SkillsMatrix>> GetSkills([FromQuery] SkillsQuery query, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, SkillsQuery.Keys).OrThrow();
        return (await skills.GetAsync(query, cancellationToken)).OrThrow();
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
