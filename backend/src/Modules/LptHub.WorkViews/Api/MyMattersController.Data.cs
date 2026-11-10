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
    /// The Data Area (epics #851 and #893): assets and their size per matter and per asset type, counted by disposition (Active, Inactive, Pending disposition, Disposed), with the two warnings
    /// (not Active but still linked to open tasks; awaiting disposition with the age of the oldest) and, when sizes of different units meet, the units warning. Needs <c>Asset.View</c> as
    /// well. <c>scope=mine</c> (default) is the matters the caller manages (closed matters included), <c>scope=all</c> every matter the caller may see (needs
    /// <c>Matter.AssignManagers</c>). One selection narrows it: <c>matterIds</c> (only matters the caller may see count; any other id is left out without a word), <c>assetTypeIds</c>, <c>sizeFields</c>
    /// (the number fields that mean size, <c>typeId:key[:unit]</c>; a type without chosen fields keeps its default size field) and a period (<c>from</c>, <c>to</c>: when the assets were added).
    /// Each row and each warning carries the Assets list query that lists exactly the assets counted, when no matter or period narrows the view further than that list can.
    /// </summary>
    [HttpGet("data", Name = "GetMyMattersData")]
    [Authorize(Policy = "Perm:" + Permissions.Asset.View)]
    [ProducesResponseType<AssetDataResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<AssetDataResponse>> GetData([FromQuery] AssetDataQuery query, [FromServices] AssetDataService data, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, AssetDataQuery.Keys).OrThrow();
        return (await data.GetAsync(query, cancellationToken)).OrThrow();
    }

    /// <summary>
    /// Data volume over time (epic #851, issue #871): the cumulative size of the selection's assets by the month they were created (their current size placed at that month; disposed assets
    /// leave in the month their disposition changed), for the last <c>months</c> months (default 24, 1 to 60). Same selection as <c>data</c> (scope, role, matters, asset types, size fields, period). Derived, not recorded: the response states the limit. Needs <c>Asset.View</c> as well.
    /// </summary>
    [HttpGet("data/volume", Name = "GetMyMattersDataVolume")]
    [Authorize(Policy = "Perm:" + Permissions.Asset.View)]
    [ProducesResponseType<AssetVolumeResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<AssetVolumeResponse>> GetDataVolume([FromQuery] AssetVolumeQuery query, [FromServices] AssetVolumeService volume, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, AssetVolumeQuery.Keys).OrThrow();
        return (await volume.GetAsync(query, cancellationToken)).OrThrow();
    }
}
