using LptHub.Identity.Contracts;
using LptHub.SharedKernel.Paging;
using LptHub.SharedKernel.Results;
using LptHub.WorkViews.Application.Queries;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace LptHub.WorkViews.Api;

/// <summary>
/// The Dashboard Calendar (epic #1074, decision AT): who can work on each day and where coverage is thin. Needs <c>Dashboard.View</c> and <c>Dashboard.ViewCalendar</c> (Director and Pod Lead by default; a Pod Lead sees only the pods they
/// belong to: <c>podScope=all</c> means those pods and another pod is 403). The coverage level is computed on the server. The answers carry people and availability only, plus each person's open-task count as a bare number and the
/// forecast as numbers; no task, matter name or id. The absence type is present only with <c>Dashboard.ViewAbsenceReasons</c>; the note never appears.
/// </summary>
[ApiController]
[Route("api/v1/dashboard/calendar")]
[Produces("application/json")]
public class DashboardCalendarController(CalendarService calendar) : ControllerBase
{
    /// <summary>One cell per day from <c>from</c> to <c>to</c> (at most 62 days after <c>from</c>): counts, coverage percent, level, holidays and the coverage of each pod; plus the roles for the filter.</summary>
    [HttpGet("days", Name = "GetDashboardCalendarDays")]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.View)]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.ViewCalendar)]
    [ProducesResponseType<CalendarDays>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<CalendarDays>> GetDays([FromQuery] CalendarDaysQuery query, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, CalendarDaysQuery.Keys).OrThrow();
        return (await calendar.GetDaysAsync(query, cancellationToken)).OrThrow();
    }

    /// <summary>The right panel of one day: counts, holidays, pods, the Available people (lightest load first) and the Unavailable people (heaviest load first), each grouped by primary role.</summary>
    [HttpGet("day", Name = "GetDashboardCalendarDay")]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.View)]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.ViewCalendar)]
    [ProducesResponseType<CalendarDay>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<CalendarDay>> GetDay([FromQuery] CalendarDayQuery query, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, CalendarDayQuery.Keys).OrThrow();
        return (await calendar.GetDayAsync(query, cancellationToken)).OrThrow();
    }

    /// <summary>The thresholds in force, the 30-day coverage-risk banner and the free-capacity forecast of the next four weeks.</summary>
    [HttpGet("summary", Name = "GetDashboardCalendarSummary")]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.View)]
    [Authorize(Policy = "Perm:" + Permissions.Dashboard.ViewCalendar)]
    [ProducesResponseType<CalendarSummary>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<CalendarSummary>> GetSummary([FromQuery] CalendarSummaryQuery query, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, CalendarSummaryQuery.Keys).OrThrow();
        return (await calendar.GetSummaryAsync(query, cancellationToken)).OrThrow();
    }
}

/// <summary>The advisory coverage check of an Out of office entry; it never blocks a save.</summary>
[ApiController]
[Route("api/v1/users/{userId:int}/absences/check")]
[Produces("application/json")]
public class AbsenceCheckController(CalendarService calendar) : ControllerBase
{
    /// <summary>Which pods of the person would fall below their minimum on which days if the person were out between the two dates. The same right as adding the entry (own: <c>Task.View</c>; others: <c>User.ManageAvailability</c> in scope).</summary>
    [HttpPost(Name = "CheckAbsenceCoverage")]
    [Authorize(Policy = "Perm:" + Permissions.Task.View + "|" + Permissions.User.ManageAvailability)]
    [ProducesResponseType<AbsenceCheckResult>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Check(int userId, [FromBody] AbsenceCheckRequest request, CancellationToken cancellationToken)
    {
        return Ok((await calendar.CheckAsync(userId, request, cancellationToken)).OrThrow());
    }
}
