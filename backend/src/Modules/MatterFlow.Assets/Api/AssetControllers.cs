using MatterFlow.Assets.Application;
using MatterFlow.Assets.Contracts;
using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Assets.Api;

/// <summary>Permission policy names for the Assets endpoints ("Perm:" plus the permission code, resolved by the Identity module).</summary>
internal static class AssetPolicies
{
    private const string Prefix = "Perm:";

    public const string AssetView = Prefix + Permissions.Asset.View;
    public const string AssetCreate = Prefix + Permissions.Asset.Create;
    public const string AssetEdit = Prefix + Permissions.Asset.Edit;
    public const string AssetTypeManage = Prefix + Permissions.AssetType.Manage;

    /// <summary>Change a disposition: <c>Asset.Edit</c> or <c>Asset.Dispose</c>; the service then asks for the permission the target state needs (Pending disposition and Disposed need <c>Asset.Dispose</c>).</summary>
    public const string AssetDisposition = Prefix + Permissions.Asset.Edit + "|" + Permissions.Asset.Dispose;

    /// <summary>Read Asset Types: <c>Asset.View</c> or <c>AssetType.Manage</c> (the Asset Types administration works without <c>Asset.View</c>).</summary>
    public const string AssetTypeRead = Prefix + Permissions.Asset.View + "|" + Permissions.AssetType.Manage;
}

internal static class ListFilters
{
    /// <summary>Unknown query parameters are a 400 (architecture section 11).</summary>
    public static Error? UnknownFilter(HttpRequest request, IReadOnlyCollection<string> allowed) =>
        FilterParsing.EnsureKnown(request.Query.Keys, allowed).Error;
}

/// <summary>
/// Asset Types. Reading needs <c>Asset.View</c> (every Asset screen shows the type) or <c>AssetType.Manage</c>; changing needs <c>AssetType.Manage</c>.
/// A type's own fields are its form (see <c>/api/v1/forms</c>, owner kind AssetType).
/// </summary>
[ApiController]
[Route("api/v1/asset-types")]
public class AssetTypesController(AssetTypeService types) : ControllerBase
{
    /// <summary>Lists Asset Types. <c>name</c> is the column filter (fragment of the name). Sort: sortOrder (default), name, createdAt.</summary>
    [HttpGet(Name = "ListAssetTypes")]
    [Authorize(Policy = AssetPolicies.AssetTypeRead)]
    [ProducesResponseType<PagedResult<AssetTypeResponse>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List([FromQuery] AssetTypeListQuery query, CancellationToken cancellationToken)
    {
        if (ListFilters.UnknownFilter(Request, AssetTypeListQuery.Keys) is { } unknown)
            return this.Problem(unknown);

        return this.ToActionResult(await types.ListAsync(query, cancellationToken));
    }

    /// <summary>Gets one Asset Type with the status of its field form.</summary>
    [HttpGet("{assetTypeId:int}", Name = "GetAssetType")]
    [Authorize(Policy = AssetPolicies.AssetTypeRead)]
    [ProducesResponseType<AssetTypeResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(int assetTypeId, CancellationToken cancellationToken) =>
        this.ToActionResult(await types.GetAsync(assetTypeId, cancellationToken));

    /// <summary>Creates an Asset Type together with its empty field form.</summary>
    [HttpPost(Name = "CreateAssetType")]
    [Authorize(Policy = AssetPolicies.AssetTypeManage)]
    [ProducesResponseType<AssetTypeResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create([FromBody] CreateAssetTypeRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(
            await types.CreateAsync(request, cancellationToken),
            t => CreatedAtRoute("GetAssetType", new { assetTypeId = t.AssetTypeId }, t));

    /// <summary>Updates an Asset Type's name, description, order and active flag. Deactivating keeps existing Assets.</summary>
    [HttpPut("{assetTypeId:int}", Name = "UpdateAssetType")]
    [Authorize(Policy = AssetPolicies.AssetTypeManage)]
    [ProducesResponseType<AssetTypeResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(int assetTypeId, [FromBody] UpdateAssetTypeRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await types.UpdateAsync(assetTypeId, request, cancellationToken));

    /// <summary>
    /// Sets or clears the default size field and unit of an Asset Type (a NUMBER field of the published form; B, KB, MB, GB, TB or Items). Stored values are not rewritten.
    /// </summary>
    [HttpPut("{assetTypeId:int}/size-field", Name = "SetAssetTypeSizeField")]
    [Authorize(Policy = AssetPolicies.AssetTypeManage)]
    [ProducesResponseType<AssetTypeResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> SetSizeField(int assetTypeId, [FromBody] SetAssetTypeSizeFieldRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await types.SetSizeFieldAsync(assetTypeId, request, cancellationToken));

    /// <summary>Rebuilds the filter index of all assets of the type from their stored values (idempotent). Needed after the indexing rule changes; the API also fills missing rows at startup.</summary>
    [HttpPost("{assetTypeId:int}/reindex", Name = "ReindexAssetType")]
    [Authorize(Policy = AssetPolicies.AssetTypeManage)]
    [ProducesResponseType<AssetTypeReindexResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Reindex(int assetTypeId, CancellationToken cancellationToken) =>
        this.ToActionResult(await types.ReindexAsync(assetTypeId, cancellationToken));
}

/// <summary>Assets: Matter-owned records Tasks work on. Never deleted; deactivate instead.</summary>
[ApiController]
[Route("api/v1/assets")]
public class AssetsController(AssetService assets, IEnumerable<IAssetTaskLinkReader> taskLinks, IPermissionChecker permissions) : ControllerBase
{
    /// <summary>The Tasks this Asset is linked to ("Linked Tasks" on the Asset detail), with the relationship of the link, the due date, the assignee, the priority and the open and overdue flags, due date ascending (no due date last). Empty without <c>Task.View</c>.</summary>
    [HttpGet("{assetId:int}/linked-tasks", Name = "ListAssetLinkedTasks")]
    [Authorize(Policy = AssetPolicies.AssetView)]
    [ProducesResponseType<AssetLinkedTasksResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> LinkedTasks(int assetId, CancellationToken cancellationToken)
    {
        if (!await assets.CanSeeAsync(assetId, cancellationToken))
            return this.Problem(AssetSupport.NotFound("Asset"));

        var reader = taskLinks.FirstOrDefault();
        // Task titles, assignees and due dates are Task data: without Task.View the list is empty, never the titles (#504).
        IReadOnlyList<AssetTaskLink> items = reader is null || !permissions.Has(Permissions.Task.View) ? [] : await reader.ListForAssetAsync(assetId, cancellationToken);
        return Ok(new AssetLinkedTasksResponse(items));
    }

    /// <summary>
    /// Lists Assets, usually of one Matter (<c>matterId</c>). <c>q</c> searches the display name, the Asset Type name and the external
    /// reference. The column filters <c>name</c>, <c>externalReference</c> (fragments of that column only), <c>matter</c> (fragment of the Matter
    /// reference, the typed pair such as <c>343-12</c>, or the Matter name) and <c>assetTypeId</c> (repeatable: any of the given Asset Types) combine with AND. Sort: displayName (default),
    /// assetType, createdAt, matter (the Matter reference, then the name), linkedTaskCount (the number of linked Tasks; a constant without <c>Task.View</c>), disposition (Active, Inactive, Pending disposition, Disposed) and size (bytes of the type's size field; Items and assets without a value last). <c>disposition</c> (repeatable) keeps the given dispositions and <c>inactiveLinked=true</c> the assets that are not Active but still linked to an open task. The counts <c>linkedTaskCount</c> and <c>openLinkedTaskCount</c> are null without <c>Task.View</c>.
    /// </summary>
    [HttpGet(Name = "ListAssets")]
    [Authorize(Policy = AssetPolicies.AssetView)]
    [ProducesResponseType<PagedResult<AssetListItem>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List([FromQuery] AssetListQuery query, CancellationToken cancellationToken)
    {
        if (ListFilters.UnknownFilter(Request, AssetListQuery.Keys) is { } unknown)
            return this.Problem(unknown);

        return this.ToActionResult(await assets.ListAsync(query, cancellationToken));
    }

    /// <summary>Picker lookup: the Matter's active Assets matching <c>q</c>, ordered by name, at most <c>limit</c> (Matter-scoped by design).</summary>
    [HttpGet("lookup", Name = "LookupAssets")]
    [Authorize(Policy = AssetPolicies.AssetView)]
    [ProducesResponseType<IReadOnlyList<AssetLookupItem>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Lookup([FromQuery] AssetLookupQuery query, CancellationToken cancellationToken)
    {
        if (ListFilters.UnknownFilter(Request, AssetLookupQuery.Keys) is { } unknown)
            return this.Problem(unknown);

        return this.ToActionResult(await assets.LookupAsync(query, cancellationToken));
    }

    /// <summary>Gets one Asset with its stored values and the form versions to render them (stored) and to edit them (published).</summary>
    [HttpGet("{assetId:int}", Name = "GetAsset")]
    [Authorize(Policy = AssetPolicies.AssetView)]
    [ProducesResponseType<AssetResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(int assetId, CancellationToken cancellationToken) =>
        this.ToActionResult(await assets.GetAsync(assetId, cancellationToken));

    /// <summary>Creates an Asset in an active Matter. The Matter and the type are fixed from now on; values are validated against the published form.</summary>
    [HttpPost(Name = "CreateAsset")]
    [Authorize(Policy = AssetPolicies.AssetCreate)]
    [ProducesResponseType<AssetResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create([FromBody] CreateAssetRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(
            await assets.CreateAsync(request, cancellationToken),
            a => CreatedAtRoute("GetAsset", new { assetId = a.AssetId }, a));

    /// <summary>Updates an active Asset. The Matter and the type cannot change (409 IMMUTABLE_FIELD); <c>formValues</c> is a patch.</summary>
    [HttpPut("{assetId:int}", Name = "UpdateAsset")]
    [Authorize(Policy = AssetPolicies.AssetEdit)]
    [ProducesResponseType<AssetResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(int assetId, [FromBody] UpdateAssetRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await assets.UpdateAsync(assetId, request, cancellationToken));

    /// <summary>
    /// Moves an Asset to Active, Inactive, Pending disposition or Disposed, with a note (required for Disposed). Pending disposition and Disposed need <c>Asset.Dispose</c>; Active and Inactive
    /// need <c>Asset.Edit</c>; Disposed is final except for a correction back to Inactive by a holder of <c>Asset.Dispose</c> with a note. Open linked tasks do not block it (the screen states the impact).
    /// </summary>
    [HttpPut("{assetId:int}/disposition", Name = "ChangeAssetDisposition")]
    [Authorize(Policy = AssetPolicies.AssetDisposition)]
    [ProducesResponseType<AssetResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> ChangeDisposition(int assetId, [FromBody] ChangeAssetDispositionRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await assets.ChangeDispositionAsync(assetId, request, cancellationToken));

    /// <summary>Moves up to 100 Assets to one disposition. Each Asset is its own change; the response lists every Asset with its outcome (no failure is hidden).</summary>
    [HttpPost("disposition", Name = "BulkChangeAssetDisposition")]
    [Authorize(Policy = AssetPolicies.AssetDisposition)]
    [ProducesResponseType<BulkAssetDispositionResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> BulkChangeDisposition([FromBody] BulkChangeAssetDispositionRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await assets.BulkChangeDispositionAsync(request, cancellationToken));

    /// <summary>The disposition changes of an Asset (who, when, from, to, note), newest first, readable with <c>Asset.View</c> without the audit browser.</summary>
    [HttpGet("{assetId:int}/disposition-history", Name = "GetAssetDispositionHistory")]
    [Authorize(Policy = AssetPolicies.AssetView)]
    [ProducesResponseType<AssetDispositionHistoryResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> DispositionHistory(int assetId, CancellationToken cancellationToken) =>
        this.ToActionResult(await assets.DispositionHistoryAsync(assetId, cancellationToken));

    /// <summary>Deactivates or reactivates an Asset (Active or Inactive; the same as changing the disposition to one of those). History is kept; there is no delete.</summary>
    [HttpPost("{assetId:int}/active", Name = "SetAssetActive")]
    [Authorize(Policy = AssetPolicies.AssetEdit)]
    [ProducesResponseType<AssetResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> SetActive(int assetId, [FromBody] SetAssetActiveRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await assets.SetActiveAsync(assetId, request, cancellationToken));
}

/// <summary>
/// Saved asset reports of the built-in report builder (epic #851): personal definitions (name, asset type, measure, number field, group-by). Everything needs
/// <c>Asset.View</c>; a report is visible only to its owner (another person's id is a 404). Running a report is a separate step that applies the viewer's
/// matter visibility.
/// </summary>
[ApiController]
[Route("api/v1/asset-reports")]
public class AssetReportsController(AssetReportService reports) : ControllerBase
{
    /// <summary>Lists the caller's saved reports by name (at most 50).</summary>
    [HttpGet(Name = "ListAssetReports")]
    [Authorize(Policy = AssetPolicies.AssetView)]
    [ProducesResponseType<IReadOnlyList<AssetReportResponse>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List(CancellationToken cancellationToken) =>
        this.ToActionResult(await reports.ListAsync(cancellationToken));

    /// <summary>What the report builder can offer for an asset type (number fields, group-by choices, the default size field); without <c>assetTypeId</c> for all asset types.</summary>
    [HttpGet("fields", Name = "GetAssetReportFields")]
    [Authorize(Policy = AssetPolicies.AssetView)]
    [ProducesResponseType<AssetReportFieldsResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Fields([FromQuery] int? assetTypeId, CancellationToken cancellationToken)
    {
        if (ListFilters.UnknownFilter(Request, ["assetTypeId"]) is { } unknown)
            return this.Problem(unknown);

        return this.ToActionResult(await reports.FieldsAsync(assetTypeId, cancellationToken));
    }

    /// <summary>Gets one of the caller's saved reports.</summary>
    [HttpGet("{assetReportId:int}", Name = "GetAssetReport")]
    [Authorize(Policy = AssetPolicies.AssetView)]
    [ProducesResponseType<AssetReportResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(int assetReportId, CancellationToken cancellationToken) =>
        this.ToActionResult(await reports.GetAsync(assetReportId, cancellationToken));

    /// <summary>Saves a report (name unique per person, at most 50 reports, definition version 1 and at most 4 KB).</summary>
    [HttpPost(Name = "CreateAssetReport")]
    [Authorize(Policy = AssetPolicies.AssetView)]
    [ProducesResponseType<AssetReportResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create([FromBody] CreateAssetReportRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(
            await reports.CreateAsync(request, cancellationToken),
            r => CreatedAtRoute("GetAssetReport", new { assetReportId = r.AssetReportId }, r));

    /// <summary>Renames a saved report and replaces its definition.</summary>
    [HttpPut("{assetReportId:int}", Name = "UpdateAssetReport")]
    [Authorize(Policy = AssetPolicies.AssetView)]
    [ProducesResponseType<AssetReportResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(int assetReportId, [FromBody] UpdateAssetReportRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await reports.UpdateAsync(assetReportId, request, cancellationToken));

    /// <summary>Deletes a saved report (only the definition; no asset is touched).</summary>
    [HttpDelete("{assetReportId:int}", Name = "DeleteAssetReport")]
    [Authorize(Policy = AssetPolicies.AssetView)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int assetReportId, CancellationToken cancellationToken)
    {
        var result = await reports.DeleteAsync(assetReportId, cancellationToken);
        return result.IsFailure ? this.Problem(result.Error!) : NoContent();
    }
}
