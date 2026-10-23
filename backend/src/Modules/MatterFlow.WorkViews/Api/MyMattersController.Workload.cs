using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkViews.Application.Queries;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Api;

public partial class MyMattersController
{
    /// <summary>Workload and capacity: open tasks on these matters by pod, then person, with the out-of-office state. Alphabetical, never ranked.</summary>
    [HttpGet("workload", Name = "GetMyMattersWorkload")]
    [ProducesResponseType<MyMattersWorkload>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MyMattersWorkload>> GetWorkload([FromQuery] MyMattersQuery query, [FromServices] MyMattersWorkloadService workload, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, MyMattersQuery.CommonKeys).OrThrow();
        return (await workload.GetAsync(query, cancellationToken)).OrThrow();
    }
}
