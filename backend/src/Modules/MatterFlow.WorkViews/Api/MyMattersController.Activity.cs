using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkViews.Application.Queries;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Api;

public partial class MyMattersController
{
    /// <summary>
    /// Recent activity of the last 7 days (or the date range): task created, status changed, reassigned, commented (the event only, never the text) and
    /// manager changed, newest first, as structured fields. The first call of a person creates their read marker, so nothing is unread on the first visit.
    /// </summary>
    [HttpGet("activity", Name = "GetMyMattersActivity")]
    [ProducesResponseType<MyMattersActivity>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MyMattersActivity>> GetActivity([FromQuery] MyMattersActivityQuery query, [FromServices] MyMattersActivityService activity, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, MyMattersActivityQuery.Keys).OrThrow();
        return (await activity.GetAsync(query, cancellationToken)).OrThrow();
    }
}
