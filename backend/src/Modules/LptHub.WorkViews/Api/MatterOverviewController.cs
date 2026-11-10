using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkViews.Application.Queries;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Api;

/// <summary>The matter record Overview (epic #758, PX-11).</summary>
[ApiController]
[Route("api/v1/matters/{matterId:int}/overview")]
[Authorize(Policy = "Perm:" + Permissions.Matter.View)]
[MatterFlow.SharedKernel.Visibility.PreparesViewer]
public sealed class MatterOverviewController : ControllerBase
{
    /// <summary>
    /// Everything the matter record Overview shows, in one call: the header with its managers, tasks by status, the next five deadlines, the people working on it (with their away window),
    /// the first five active assets, the last ten events and the health flag with its reasons in words. A section the caller may not use is null: tasks need <c>Task.View</c>, assets need
    /// <c>Asset.View</c>. A matter the caller may not see (sensitive matters) answers 404. No warning for a missing manager.
    /// </summary>
    [HttpGet(Name = "GetMatterOverview")]
    [ProducesResponseType<MatterOverview>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<MatterOverview>> Get(int matterId, [FromServices] MatterOverviewService overview, CancellationToken cancellationToken) =>
        (await overview.GetAsync(matterId, cancellationToken)).OrThrow();
}
