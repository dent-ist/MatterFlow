using MatterFlow.Organization.Application;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkViews.Application.Queries;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Api;

public partial class MyMattersController
{
    /// <summary>
    /// The calendar items (hearings, depositions, deadlines) of the scope's matters from <c>from</c> to <c>to</c> (both required, inclusive, at most 100 days), by date, all-day first, then time. A matter the caller may not
    /// see contributes nothing. Creating and changing events is on <c>/matters/{id}/events</c> and <c>/matter-events/{id}</c>.
    /// </summary>
    [HttpGet("events", Name = "GetMyMattersEvents")]
    [ProducesResponseType<MatterEventList>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MatterEventList>> GetEvents([FromQuery] MyMattersEventsQuery query, [FromServices] MyMattersEventsService events, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, MyMattersEventsQuery.Keys).OrThrow();
        return (await events.ListAsync(query, cancellationToken)).OrThrow();
    }

    /// <summary>The next calendar items of the scope: from today (viewer's calendar) for <c>days</c> (default 14), the first <c>take</c> (default 10) and the <c>total</c> of the window (the count on the collapsed rail).</summary>
    [HttpGet("events/upcoming", Name = "GetMyMattersUpcomingEvents")]
    [ProducesResponseType<MyMattersUpcomingEvents>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MyMattersUpcomingEvents>> GetUpcomingEvents([FromQuery] MyMattersUpcomingEventsQuery query, [FromServices] MyMattersEventsService events, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, MyMattersUpcomingEventsQuery.Keys).OrThrow();
        return (await events.UpcomingAsync(query, cancellationToken)).OrThrow();
    }
}
