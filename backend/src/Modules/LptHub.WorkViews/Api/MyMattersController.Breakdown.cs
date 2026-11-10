using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkViews.Application.Queries;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Api;

public partial class MyMattersController
{
    /// <summary>
    /// Breakdown (PM v2, #861): open tasks per matter and task type with open, overdue, on hold and at risk numbers, the totals of the whole scope, the average days to completion against the target of each type
    /// (completed in the last 90 days) and links (Task Queue queries) that list exactly what a number counts. <c>view=matrix</c> (default) pages the matters 50 at a time, overdue first; <c>view=types</c> returns only
    /// the per type totals. <c>taskTypeId</c> (repeatable) and <c>status</c> (<c>open</c>, <c>onHold</c>) narrow it. A sensitive matter the caller cannot see contributes to no cell and no total.
    /// </summary>
    [HttpGet("breakdown", Name = "GetMyMattersBreakdown")]
    [ProducesResponseType<MyMattersBreakdown>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MyMattersBreakdown>> GetBreakdown([FromQuery] MyMattersBreakdownQuery query, [FromServices] MyMattersBreakdownService breakdown, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, MyMattersBreakdownQuery.Keys).OrThrow();
        return (await breakdown.GetAsync(query, cancellationToken)).OrThrow();
    }
}
