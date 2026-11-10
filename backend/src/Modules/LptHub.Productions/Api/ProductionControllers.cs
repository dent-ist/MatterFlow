using MatterFlow.Identity.Contracts;
using MatterFlow.Productions.Application;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Productions.Api;

/// <summary>Permission policy names for the Productions endpoints ("Perm:" plus the permission code, resolved by the Identity module).</summary>
internal static class ProductionPolicies
{
    private const string Prefix = "Perm:";

    public const string ProductionView = Prefix + Permissions.Production.View;
    public const string ProductionEdit = Prefix + Permissions.Production.Edit;
    public const string ProductionComment = Prefix + Permissions.Production.Comment;
    public const string SpecView = Prefix + Permissions.ProductionSpec.View;
    public const string SpecEdit = Prefix + Permissions.ProductionSpec.Edit;
}

internal static class ListFilters
{
    /// <summary>Unknown query parameters are a 400 (architecture section 11).</summary>
    public static Error? UnknownFilter(HttpRequest request, IReadOnlyCollection<string> allowed) =>
        FilterParsing.EnsureKnown(request.Query.Keys, allowed).Error;
}

/// <summary>
/// Production specs: the agreed format of the productions of a matter. Never deleted; retire instead. A matter the caller may not see (sensitive-matter rule) is a 404 on every endpoint.
/// </summary>
[ApiController]
[Route("api/v1/production-specs")]
public class ProductionSpecsController(ProductionSpecService specs) : ControllerBase
{
    /// <summary>Lists the specs of a matter (<c>matterId</c> is required). <c>status</c> Active or Retired; <c>q</c> searches name, source and description. Sort: name (default), status, updatedAt, createdAt.</summary>
    [HttpGet(Name = "ListProductionSpecs")]
    [Authorize(Policy = ProductionPolicies.SpecView)]
    [ProducesResponseType<PagedResult<ProductionSpecResponse>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List([FromQuery] ProductionSpecListQuery query, CancellationToken cancellationToken)
    {
        if (ListFilters.UnknownFilter(Request, ProductionSpecListQuery.Keys) is { } unknown)
            return this.Problem(unknown);

        return this.ToActionResult(await specs.ListAsync(query, cancellationToken));
    }

    /// <summary>Gets one spec with the productions that use it.</summary>
    [HttpGet("{specId:int}", Name = "GetProductionSpec")]
    [Authorize(Policy = ProductionPolicies.SpecView)]
    [ProducesResponseType<ProductionSpecResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(int specId, CancellationToken cancellationToken) =>
        this.ToActionResult(await specs.GetAsync(specId, cancellationToken));

    /// <summary>Creates a spec in an active matter. The name must be unused among the matter's active specs (409 DUPLICATE_NAME).</summary>
    [HttpPost(Name = "CreateProductionSpec")]
    [Authorize(Policy = ProductionPolicies.SpecEdit)]
    [ProducesResponseType<ProductionSpecResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create([FromBody] CreateProductionSpecRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await specs.CreateAsync(request, cancellationToken), s => CreatedAtRoute("GetProductionSpec", new { specId = s.ProductionSpecId }, s));

    /// <summary>Updates an active spec (409 SPEC_RETIRED for a retired one). Send the <c>rowVersion</c> last read.</summary>
    [HttpPut("{specId:int}", Name = "UpdateProductionSpec")]
    [Authorize(Policy = ProductionPolicies.SpecEdit)]
    [ProducesResponseType<ProductionSpecResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(int specId, [FromBody] UpdateProductionSpecRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await specs.UpdateAsync(specId, request, cancellationToken));

    /// <summary>Copies a spec into a new active spec of the same matter; the name defaults to "Copy of {name}".</summary>
    [HttpPost("{specId:int}/duplicate", Name = "DuplicateProductionSpec")]
    [Authorize(Policy = ProductionPolicies.SpecEdit)]
    [ProducesResponseType<ProductionSpecResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Duplicate(int specId, [FromBody] DuplicateProductionSpecRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await specs.DuplicateAsync(specId, request, cancellationToken), s => CreatedAtRoute("GetProductionSpec", new { specId = s.ProductionSpecId }, s));

    /// <summary>Retires a spec: it stays on the productions that use it but cannot be chosen for new or changed ones.</summary>
    [HttpPost("{specId:int}/retire", Name = "RetireProductionSpec")]
    [Authorize(Policy = ProductionPolicies.SpecEdit)]
    [ProducesResponseType<ProductionSpecResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Retire(int specId, [FromBody] ChangeProductionSpecStatusRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await specs.RetireAsync(specId, request, cancellationToken));

    /// <summary>Reinstates a retired spec (409 DUPLICATE_NAME when an active spec has its name now).</summary>
    [HttpPost("{specId:int}/unretire", Name = "UnretireProductionSpec")]
    [Authorize(Policy = ProductionPolicies.SpecEdit)]
    [ProducesResponseType<ProductionSpecResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Unretire(int specId, [FromBody] ChangeProductionSpecStatusRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await specs.ReinstateAsync(specId, request, cancellationToken));

    /// <summary>Who changed the spec and when (newest first), from the audit trail.</summary>
    [HttpGet("{specId:int}/history", Name = "GetProductionSpecHistory")]
    [Authorize(Policy = ProductionPolicies.SpecView)]
    [ProducesResponseType<ProductionHistoryResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> History(int specId, [FromQuery] ProductionHistoryQuery query, CancellationToken cancellationToken)
    {
        if (ListFilters.UnknownFilter(Request, ProductionHistoryQuery.Keys) is { } unknown)
            return this.Problem(unknown);

        return this.ToActionResult(await specs.HistoryAsync(specId, query, cancellationToken));
    }
}

/// <summary>Productions of a matter: a simple managed list with comments and a history. A matter the caller may not see is a 404 on every endpoint.</summary>
[ApiController]
[Route("api/v1/productions")]
public class ProductionsController(ProductionService productions) : ControllerBase
{
    /// <summary>Lists the productions of a matter (<c>matterId</c> is required). <c>direction</c> OUT or IN, <c>productionSpecId</c>, <c>q</c>. Sort: name, volume, direction, party, bates, docs, pages, date, updatedAt, createdAt (default: newest date first).</summary>
    [HttpGet(Name = "ListProductions")]
    [Authorize(Policy = ProductionPolicies.ProductionView)]
    [ProducesResponseType<PagedResult<ProductionResponse>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List([FromQuery] ProductionListQuery query, CancellationToken cancellationToken)
    {
        if (ListFilters.UnknownFilter(Request, ProductionListQuery.Keys) is { } unknown)
            return this.Problem(unknown);

        return this.ToActionResult(await productions.ListAsync(query, cancellationToken));
    }

    /// <summary>The counts behind the Productions tab: productions and active specs of the matter.</summary>
    [HttpGet("/api/v1/matters/{matterId:int}/productions/summary", Name = "GetMatterProductionsSummary")]
    [Authorize(Policy = ProductionPolicies.ProductionView)]
    [ProducesResponseType<ProductionSummaryResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Summary(int matterId, CancellationToken cancellationToken) =>
        this.ToActionResult(await productions.SummaryAsync(matterId, cancellationToken));

    /// <summary>Gets one production.</summary>
    [HttpGet("{productionId:int}", Name = "GetProduction")]
    [Authorize(Policy = ProductionPolicies.ProductionView)]
    [ProducesResponseType<ProductionResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(int productionId, CancellationToken cancellationToken) =>
        this.ToActionResult(await productions.GetAsync(productionId, cancellationToken));

    /// <summary>Creates a production in an active matter. A spec, when given, must be an active spec of the same matter.</summary>
    [HttpPost(Name = "CreateProduction")]
    [Authorize(Policy = ProductionPolicies.ProductionEdit)]
    [ProducesResponseType<ProductionResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create([FromBody] CreateProductionRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await productions.CreateAsync(request, cancellationToken), p => CreatedAtRoute("GetProduction", new { productionId = p.ProductionId }, p));

    /// <summary>Updates a production. Send the <c>rowVersion</c> last read; a retired spec that was already set may stay, a new one must be active.</summary>
    [HttpPut("{productionId:int}", Name = "UpdateProduction")]
    [Authorize(Policy = ProductionPolicies.ProductionEdit)]
    [ProducesResponseType<ProductionResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(int productionId, [FromBody] UpdateProductionRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await productions.UpdateAsync(productionId, request, cancellationToken));

    /// <summary>Deletes a production and its comments for good (audited). Send the <c>rowVersion</c> last read as a query parameter.</summary>
    [HttpDelete("{productionId:int}", Name = "DeleteProduction")]
    [Authorize(Policy = ProductionPolicies.ProductionEdit)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int productionId, [FromQuery] string? rowVersion, CancellationToken cancellationToken)
    {
        var result = await productions.DeleteAsync(productionId, rowVersion, cancellationToken);
        return result.IsFailure ? this.Problem(result.Error!) : NoContent();
    }

    /// <summary>Who changed the production and when, field by field (newest first), from the audit trail; comments appear as events too.</summary>
    [HttpGet("{productionId:int}/history", Name = "GetProductionHistory")]
    [Authorize(Policy = ProductionPolicies.ProductionView)]
    [ProducesResponseType<ProductionHistoryResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> History(int productionId, [FromQuery] ProductionHistoryQuery query, CancellationToken cancellationToken)
    {
        if (ListFilters.UnknownFilter(Request, ProductionHistoryQuery.Keys) is { } unknown)
            return this.Problem(unknown);

        return this.ToActionResult(await productions.HistoryAsync(productionId, query, cancellationToken));
    }

    /// <summary>The comments of a production, oldest first.</summary>
    [HttpGet("{productionId:int}/comments", Name = "ListProductionComments")]
    [Authorize(Policy = ProductionPolicies.ProductionView)]
    [ProducesResponseType<IReadOnlyList<ProductionCommentResponse>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> ListComments(int productionId, CancellationToken cancellationToken) =>
        this.ToActionResult(await productions.ListCommentsAsync(productionId, cancellationToken));

    /// <summary>Adds a comment (needs <c>Production.Comment</c>).</summary>
    [HttpPost("{productionId:int}/comments", Name = "AddProductionComment")]
    [Authorize(Policy = ProductionPolicies.ProductionComment)]
    [ProducesResponseType<ProductionCommentResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> AddComment(int productionId, [FromBody] CreateProductionCommentRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await productions.AddCommentAsync(productionId, request, cancellationToken), c => StatusCode(StatusCodes.Status201Created, c));
}

/// <summary>Edit or delete a comment of one's own (needs <c>Production.Comment</c>).</summary>
[ApiController]
[Route("api/v1/production-comments/{commentId:int}")]
public class ProductionCommentsController(ProductionService productions) : ControllerBase
{
    /// <summary>Changes the text of your own comment. Send the <c>rowVersion</c> last read.</summary>
    [HttpPut(Name = "UpdateProductionComment")]
    [Authorize(Policy = ProductionPolicies.ProductionComment)]
    [ProducesResponseType<ProductionCommentResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(int commentId, [FromBody] UpdateProductionCommentRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await productions.UpdateCommentAsync(commentId, request, cancellationToken));

    /// <summary>Deletes your own comment. Send the <c>rowVersion</c> last read as a query parameter.</summary>
    [HttpDelete(Name = "DeleteProductionComment")]
    [Authorize(Policy = ProductionPolicies.ProductionComment)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int commentId, [FromQuery] string? rowVersion, CancellationToken cancellationToken)
    {
        var result = await productions.DeleteCommentAsync(commentId, rowVersion, cancellationToken);
        return result.IsFailure ? this.Problem(result.Error!) : NoContent();
    }
}
