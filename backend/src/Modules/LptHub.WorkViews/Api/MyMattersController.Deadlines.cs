using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkViews.Application.Queries;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Api;

public partial class MyMattersController
{
    /// <summary>Upcoming deadlines: open tasks due from today to 14 (default) or 28 days ahead, not overdue, soonest first, at most 25, with the total. <c>taskTypeId</c>, <c>sort</c> and <c>dir</c> work as on the attention list (the flat list is sorted; the day and matter groupings are only filtered).</summary>
    [HttpGet("deadlines", Name = "GetMyMattersDeadlines")]
    [ProducesResponseType<MyMattersDeadlines>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MyMattersDeadlines>> GetDeadlines([FromQuery] MyMattersDeadlinesQuery query, [FromServices] MyMattersAttentionService attention, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, MyMattersDeadlinesQuery.Keys).OrThrow();
        return (await attention.DeadlinesAsync(query, cancellationToken)).OrThrow();
    }

    /// <summary>
    /// The Calendar of the Overview, one month at a time (<c>month=yyyy-MM</c>, default the month of today in the viewer's zone): every day of the month with the number of open tasks due on it and the first five.
    /// Overdue tasks sit on their own due dates, also in past months (their <c>factCode</c> is <c>OVERDUE</c>). <c>show</c> is the pre-filter of the grid (open, overdue, atRisk, unassigned, onHold, dueSoon) and
    /// <c>taskTypeId</c> the Focus; the scope's Client, Matter and Role apply as everywhere. Every day carries the Task Queue query that lists exactly the tasks it counts.
    /// </summary>
    [HttpGet("calendar", Name = "GetMyMattersCalendar")]
    [ProducesResponseType<MyMattersCalendar>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MyMattersCalendar>> GetCalendar([FromQuery] MyMattersCalendarQuery query, [FromServices] MyMattersAttentionService attention, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, MyMattersCalendarQuery.Keys).OrThrow();
        return (await attention.CalendarAsync(query, cancellationToken)).OrThrow();
    }
}
