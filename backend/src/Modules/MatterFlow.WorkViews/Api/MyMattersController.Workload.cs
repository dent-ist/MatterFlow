using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkViews.Application.Queries;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Api;

public partial class MyMattersController
{
    /// <summary>
    /// Workload and capacity: open tasks on these matters by pod, then person (open, overdue, due this week, on hold), with the out-of-office state now and the away window that overlaps
    /// the next four weeks (dates and a reason code, never the note). People with no open task on these matters are not listed, away or not. <c>include=matters</c> adds each person's
    /// five matters with most open tasks. Alphabetical, never ranked.
    /// </summary>
    [HttpGet("workload", Name = "GetMyMattersWorkload")]
    [ProducesResponseType<MyMattersWorkload>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MyMattersWorkload>> GetWorkload([FromQuery] MyMattersWorkloadQuery query, [FromServices] MyMattersWorkloadService workload, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, MyMattersWorkloadQuery.Keys).OrThrow();
        return (await workload.GetAsync(query, cancellationToken)).OrThrow();
    }
}
