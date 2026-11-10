using MatterFlow.Configuration.Application.Lookups;
using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Configuration.Api;

/// <summary>Task-to-Asset link roles (Source, Destination, Subject, Result, ...): lookup for Task screens and admin maintenance.</summary>
[ApiController]
[Route("api/v1/asset-link-roles")]
[Produces("application/json")]
public class AssetLinkRolesController(AssetLinkRoleService roles) : ControllerBase
{
    /// <summary>Lists all link roles in order, including inactive ones (existing links still display them; pickers hide inactive).</summary>
    [HttpGet(Name = "ListAssetLinkRoles")]
    [Authorize(Policy = ConfigurationPolicies.AssetLinkRoleRead)]
    [ProducesResponseType<IReadOnlyList<AssetLinkRoleView>>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<IReadOnlyList<AssetLinkRoleView>>> List(CancellationToken cancellationToken) =>
        Ok(await roles.ListViewsAsync(cancellationToken));

    /// <summary>Adds a link role at the end of the list.</summary>
    [HttpPost(Name = "CreateAssetLinkRole")]
    [Authorize(Policy = ConfigurationPolicies.AssetLinkRoleManage)]
    [ProducesResponseType<AssetLinkRoleView>(StatusCodes.Status201Created, "application/json")]
    public async Task<ActionResult<AssetLinkRoleView>> Create([FromBody] CreateAssetLinkRoleRequest request, CancellationToken cancellationToken)
    {
        var created = (await roles.CreateAsync(request, cancellationToken)).OrThrow();
        return Created($"/api/v1/asset-link-roles/{created.Id}", created);
    }

    /// <summary>Renames, activates or deactivates a link role.</summary>
    [HttpPut("{id:int}", Name = "UpdateAssetLinkRole")]
    [Authorize(Policy = ConfigurationPolicies.AssetLinkRoleManage)]
    [ProducesResponseType<AssetLinkRoleView>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<AssetLinkRoleView>> Update(int id, [FromBody] UpdateAssetLinkRoleRequest request, CancellationToken cancellationToken) =>
        (await roles.UpdateAsync(id, request, cancellationToken)).OrThrow();

    /// <summary>Sets the order. The list must contain every link role exactly once. Returns the full list.</summary>
    [HttpPut("order", Name = "ReorderAssetLinkRoles")]
    [Authorize(Policy = ConfigurationPolicies.AssetLinkRoleManage)]
    [ProducesResponseType<IReadOnlyList<AssetLinkRoleView>>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<IReadOnlyList<AssetLinkRoleView>>> Reorder([FromBody] ReorderRequest request, CancellationToken cancellationToken) =>
        Ok((await roles.ReorderAsync(request.Ids, cancellationToken)).OrThrow());

    /// <summary>Deletes an unused link role (409 <c>IN_USE</c> when links reference it: deactivate instead).</summary>
    [HttpDelete("{id:int}", Name = "DeleteAssetLinkRole")]
    [Authorize(Policy = ConfigurationPolicies.AssetLinkRoleManage)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        (await roles.DeleteAsync(id, cancellationToken)).OrThrow();
        return NoContent();
    }
}
