using MatterFlow.Assets.Application;
using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkViews.Application.Queries;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Api;

/// <summary>
/// Running asset reports (epic #851): the aggregate side of the report builder. A run starts from the assets of the matters the caller may see (the sensitive-matter rule), takes the
/// scope <c>mine</c> (matters the caller manages) or <c>all</c> (needs <c>Matter.AssignManagers</c>, 403 otherwise) and groups in the database. Needs <c>Asset.View</c>.
/// </summary>
[ApiController]
[Route("api/v1/asset-reports")]
[Authorize(Policy = "Perm:" + Permissions.Asset.View)]
public class AssetReportRunController : ControllerBase
{
    /// <summary>Runs a definition that has not been saved (the builder's Run button). The definition is validated like a saved one.</summary>
    [HttpPost("run", Name = "RunAssetReport")]
    [ProducesResponseType<AssetReportResult>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<AssetReportResult>> Run([FromBody] AssetReportDefinition definition, [FromServices] AssetReportRunService runner, CancellationToken cancellationToken) =>
        (await runner.RunAsync(definition, cancellationToken)).OrThrow();

    /// <summary>Runs one of the caller's saved reports with the caller's current visibility (another person's id is a 404).</summary>
    [HttpGet("{assetReportId:int}/run", Name = "RunSavedAssetReport")]
    [ProducesResponseType<AssetReportResult>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<AssetReportResult>> RunSaved(int assetReportId, [FromServices] AssetReportRunService runner, CancellationToken cancellationToken) =>
        (await runner.RunSavedAsync(assetReportId, cancellationToken)).OrThrow();
}
