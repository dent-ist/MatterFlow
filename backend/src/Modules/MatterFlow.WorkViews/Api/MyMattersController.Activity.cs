using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkViews.Application.Queries;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Api;

public partial class MyMattersController
{
    /// <summary>
    /// Recent activity of the last 30 days (or the date range): task created, status changed, reassigned, commented (the event only, never the text) and
    /// manager changed, newest first, as structured fields. Filters: <c>matterId</c>, <c>kind</c> (repeatable; also <c>COMPLETED</c> and <c>ON_HOLD</c>) and <c>unread=true</c>;
    /// paged by <c>cursor</c> (the previous page's <c>nextCursor</c>). The first call of a person creates their read marker, so nothing is unread on the first visit.
    /// </summary>
    [HttpGet("activity", Name = "GetMyMattersActivity")]
    [ProducesResponseType<MyMattersActivity>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MyMattersActivity>> GetActivity([FromQuery] MyMattersActivityQuery query, [FromServices] MyMattersActivityService activity, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, MyMattersActivityQuery.Keys).OrThrow();
        return (await activity.GetAsync(query, cancellationToken)).OrThrow();
    }

    /// <summary>
    /// "Since your last visit": what changed on these matters since the person's marker (the last "Mark as read"), or in the last 7 days without one: new tasks, completed, became overdue,
    /// reassigned, put on hold and comments (each with the query that opens it), and up to five most important items, overdue first. Opening the page does not move the marker. Comment text is never returned.
    /// </summary>
    [HttpGet("since-last-visit", Name = "GetMyMattersSinceLastVisit")]
    [ProducesResponseType<MyMattersSinceLastVisit>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MyMattersSinceLastVisit>> GetSinceLastVisit([FromQuery] MyMattersSinceQuery query, [FromServices] MyMattersSinceLastVisitService since, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, MyMattersSinceQuery.Keys).OrThrow();
        return (await since.GetAsync(query, cancellationToken)).OrThrow();
    }
}
