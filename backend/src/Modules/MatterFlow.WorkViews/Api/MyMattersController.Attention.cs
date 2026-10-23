using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkViews.Application.Queries;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Api;

public partial class MyMattersController
{
    /// <summary>
    /// Needs my attention: overdue (oldest due first), due in 3 days, unassigned (due within 7 days first) and stuck on hold (longer than 7 days, oldest first),
    /// each with its total and the first 10 tasks.
    /// </summary>
    [HttpGet("attention", Name = "GetMyMattersAttention")]
    [ProducesResponseType<MyMattersAttention>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MyMattersAttention>> GetAttention([FromQuery] MyMattersQuery query, [FromServices] MyMattersAttentionService attention, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, MyMattersQuery.CommonKeys).OrThrow();
        return (await attention.GetAsync(query, cancellationToken)).OrThrow();
    }
}
