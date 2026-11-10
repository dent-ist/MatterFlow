using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkViews.Application.Queries;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Api;

public partial class MyMattersController
{
    /// <summary>
    /// Tasks per status and per Show filter for the scope (the Overview's chips and the workflow bar of the chosen client or matter). <c>byStatus</c> respects <c>show</c>, <c>byShow</c> respects <c>status</c>
    /// (default: the open statuses), so every number equals the Task Queue total of the same two filters. Overdue, At risk and Due in 7 days only count New and In Progress tasks.
    /// </summary>
    [HttpGet("task-counts", Name = "GetMyMattersTaskCounts")]
    [ProducesResponseType<MyMattersTaskCounts>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MyMattersTaskCounts>> GetTaskCounts([FromQuery] MyMattersTaskCountsQuery query, [FromServices] MyMattersTaskCountsService counts, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, MyMattersTaskCountsQuery.Keys).OrThrow();
        return (await counts.GetAsync(query, cancellationToken)).OrThrow();
    }
}
