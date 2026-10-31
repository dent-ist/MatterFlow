using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkViews.Application.Queries;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Api;

public partial class MyMattersController
{
    /// <summary>
    /// The client/matter tree of the scope: clients with the matters the caller may see, per matter the open, overdue (New or In Progress, past due), unassigned and critical counts, the sensitive flag and the
    /// <c>isActive</c> flag (an open task, or an asset created or updated in the last <c>activeDays</c> days; default 7). <c>q</c> searches, <c>activeOnly=true</c> hides inactive matters.
    /// </summary>
    [HttpGet("tree", Name = "GetMyMattersTree")]
    [ProducesResponseType<MyMattersTree>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MyMattersTree>> GetTree([FromQuery] MyMattersTreeQuery query, [FromServices] MyMattersTreeService tree, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, MyMattersTreeQuery.Keys).OrThrow();
        return (await tree.GetAsync(query, cancellationToken)).OrThrow();
    }

    /// <summary>
    /// The assets of the scope's matters: client, matter, type, created, updated and status (the disposition), with server-side column filters (<c>name</c>, <c>assetTypeId</c>, <c>status</c>, created and updated ranges), <c>sort</c>
    /// (default <c>updated</c> descending) and paging. Assets have no comments; the linked tasks and their latest comment are on the detail.
    /// </summary>
    [HttpGet("assets", Name = "GetMyMattersAssets")]
    [ProducesResponseType<PagedResult<MyMattersAssetRow>>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<PagedResult<MyMattersAssetRow>>> GetAssets([FromQuery] MyMattersAssetsQuery query, [FromServices] MyMattersAssetsService assets, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, MyMattersAssetsQuery.Keys).OrThrow();
        return (await assets.ListAsync(query, cancellationToken)).OrThrow();
    }

    /// <summary>One asset of the scope with the tasks linked to it and, per task, the latest ordinary task comment (plain-text excerpt). 404 when the asset is missing or its matter is not visible.</summary>
    [HttpGet("assets/{assetId:int}", Name = "GetMyMattersAsset")]
    [ProducesResponseType<MyMattersAssetDetail>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MyMattersAssetDetail>> GetAsset(int assetId, [FromQuery] MyMattersQuery query, [FromServices] MyMattersAssetsService assets, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, MyMattersQuery.CommonKeys).OrThrow();
        return (await assets.GetAsync(assetId, query, cancellationToken)).OrThrow();
    }
}
