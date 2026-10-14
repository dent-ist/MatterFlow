using MatterFlow.Assets.Application;
using MatterFlow.Identity.Contracts;
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
}

internal static class ListFilters
{
    /// <summary>Unknown query parameters are a 400 (architecture section 11).</summary>
    public static Error? UnknownFilter(HttpRequest request, IReadOnlyCollection<string> allowed) =>
        FilterParsing.EnsureKnown(request.Query.Keys, allowed).Error;
}

/// <summary>
/// Asset Types. Reading needs <c>Asset.View</c> (every Asset screen shows the type); changing needs <c>AssetType.Manage</c>.
/// A type's own fields are its form (see <c>/api/v1/forms</c>, owner kind AssetType).
/// </summary>
[ApiController]
[Route("api/v1/asset-types")]
public class AssetTypesController(AssetTypeService types) : ControllerBase
{
    /// <summary>Lists Asset Types. Sort: sortOrder (default), name, createdAt.</summary>
    [HttpGet(Name = "ListAssetTypes")]
    [Authorize(Policy = AssetPolicies.AssetView)]
    [ProducesResponseType<PagedResult<AssetTypeResponse>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List([FromQuery] AssetTypeListQuery query, CancellationToken cancellationToken)
    {
        if (ListFilters.UnknownFilter(Request, AssetTypeListQuery.Keys) is { } unknown)
            return this.Problem(unknown);

        return this.ToActionResult(await types.ListAsync(query, cancellationToken));
    }

    /// <summary>Gets one Asset Type with the status of its field form.</summary>
    [HttpGet("{assetTypeId:int}", Name = "GetAssetType")]
    [Authorize(Policy = AssetPolicies.AssetView)]
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
}

/// <summary>Assets: Matter-owned records Tasks work on. Never deleted; deactivate instead.</summary>
[ApiController]
[Route("api/v1/assets")]
public class AssetsController(AssetService assets) : ControllerBase
{
    /// <summary>
    /// Lists Assets, usually of one Matter (<c>matterId</c>). <c>q</c> searches the display name, the Asset Type name and the external
    /// reference. Sort: displayName (default), assetType, createdAt.
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

    /// <summary>Deactivates or reactivates an Asset. History is kept; there is no delete.</summary>
    [HttpPost("{assetId:int}/active", Name = "SetAssetActive")]
    [Authorize(Policy = AssetPolicies.AssetEdit)]
    [ProducesResponseType<AssetResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> SetActive(int assetId, [FromBody] SetAssetActiveRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await assets.SetActiveAsync(assetId, request, cancellationToken));
}
