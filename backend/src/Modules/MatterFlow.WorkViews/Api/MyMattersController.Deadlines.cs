using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkViews.Application.Queries;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Api;

public partial class MyMattersController
{
    /// <summary>Upcoming deadlines: open tasks due from today to 14 (default) or 28 days ahead, not overdue, soonest first, at most 25, with the total.</summary>
    [HttpGet("deadlines", Name = "GetMyMattersDeadlines")]
    [ProducesResponseType<MyMattersDeadlines>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MyMattersDeadlines>> GetDeadlines([FromQuery] MyMattersDeadlinesQuery query, [FromServices] MyMattersAttentionService attention, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, MyMattersDeadlinesQuery.Keys).OrThrow();
        return (await attention.DeadlinesAsync(query, cancellationToken)).OrThrow();
    }
}
