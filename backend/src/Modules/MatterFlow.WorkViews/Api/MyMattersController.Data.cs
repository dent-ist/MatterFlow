using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkViews.Application.Queries;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Api;

public partial class MyMattersController
{
    /// <summary>
    /// The Data tab (epic #851): assets and their size per matter and per asset type, counted by disposition (Active, Inactive, Pending disposition, Disposed), with the two warnings
    /// (not Active but still linked to open tasks; awaiting disposition with the age of the oldest) and, when sizes of different units meet, the units warning. Needs <c>Asset.View</c> as
    /// well. <c>scope=mine</c> (default) is the matters the caller manages (closed matters included), <c>scope=all</c> every matter the caller may see (needs
    /// <c>Matter.AssignManagers</c>). The default size field of each asset type is measured; with <c>assetTypeId</c> and <c>sizeField</c> (and <c>sizeUnit</c> for a field that is not the type's
    /// default) another number field is measured, without being stored. Each row and each warning carries the Assets list query that lists exactly the assets counted.
    /// </summary>
    [HttpGet("data", Name = "GetMyMattersData")]
    [Authorize(Policy = "Perm:" + Permissions.Asset.View)]
    [ProducesResponseType<AssetDataResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<AssetDataResponse>> GetData([FromQuery] AssetDataQuery query, [FromServices] AssetDataService data, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, AssetDataQuery.Keys).OrThrow();
        return (await data.GetAsync(query, cancellationToken)).OrThrow();
    }
}
