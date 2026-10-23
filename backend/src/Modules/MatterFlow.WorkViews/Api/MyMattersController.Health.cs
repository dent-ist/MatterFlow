using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkViews.Application.Queries;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Api;

public partial class MyMattersController
{
    /// <summary>
    /// Matter health: one row per matter of the scope with open, overdue, due this week, unassigned, % workflow complete, next deadline and the flag
    /// (Red: any overdue; Amber: unassigned, due in 3 days or on hold over 7 days; Green otherwise; no manager state ever enters it). Sorted by next deadline
    /// by default, paged (default 50).
    /// </summary>
    [HttpGet("health", Name = "GetMyMattersHealth")]
    [ProducesResponseType<MyMattersHealthPage>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MyMattersHealthPage>> GetHealth([FromQuery] MyMattersHealthQuery query, [FromServices] MyMattersHealthService health, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, MyMattersHealthQuery.Keys).OrThrow();
        return (await health.GetAsync(query, cancellationToken)).OrThrow();
    }
}
