using MatterFlow.Configuration.Application.Lookups;
using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Authorization;
using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Configuration.Api;

/// <summary>
/// Policy names for the Configuration endpoints. Modules cannot reference the Identity module's <c>[RequirePermission]</c>, so the
/// equivalent <c>Perm:&lt;code&gt;</c> policy name is built from the catalog constants (see <see cref="PolicyNames"/>).
/// </summary>
internal static class ConfigurationPolicies
{
    private const string Prefix = "Perm:";

    /// <summary>Read the lookups on Task screens.</summary>
    public const string TaskView = Prefix + Permissions.Task.View;

    public const string TaskTypeManage = Prefix + Permissions.TaskType.Manage;

    /// <summary>Read Task Types: either <c>Task.View</c> or <c>TaskType.Manage</c> (the Task Types administration works without <c>Task.View</c>).</summary>
    public const string TaskTypeRead = Prefix + Permissions.Task.View + "|" + Permissions.TaskType.Manage;

    public const string PriorityManage = Prefix + Permissions.Priority.Manage;

    /// <summary>Read the priorities: <c>Task.View</c> or <c>Priority.Manage</c> (the Labels page works without <c>Task.View</c>).</summary>
    public const string PriorityRead = Prefix + Permissions.Task.View + "|" + Permissions.Priority.Manage;

    public const string OnHoldReasonManage = Prefix + Permissions.OnHoldReason.Manage;

    /// <summary>Read the on-hold reasons: <c>Task.View</c> or <c>OnHoldReason.Manage</c> (the Labels page works without <c>Task.View</c>).</summary>
    public const string OnHoldReasonRead = Prefix + Permissions.Task.View + "|" + Permissions.OnHoldReason.Manage;

    public const string StatusLabelManage = Prefix + Permissions.StatusLabel.Manage;

    /// <summary>Read the status labels: <c>Task.View</c> or <c>StatusLabel.Manage</c> (the Labels page works without <c>Task.View</c>).</summary>
    public const string StatusLabelRead = Prefix + Permissions.Task.View + "|" + Permissions.StatusLabel.Manage;

    /// <summary>The catalog groups asset link roles under asset types ("Manage asset types and asset link roles").</summary>
    public const string AssetLinkRoleManage = Prefix + Permissions.AssetType.Manage;

    /// <summary>Read the asset link roles: <c>Task.View</c> or <c>AssetType.Manage</c> (the Link Roles tab of the Asset Types page).</summary>
    public const string AssetLinkRoleRead = Prefix + Permissions.Task.View + "|" + Permissions.AssetType.Manage;
}

/// <summary>Task priorities: lookup for Task screens and admin maintenance (UX S18). Failures surface as problem+json with a stable code.</summary>
[ApiController]
[Route("api/v1/priorities")]
[Produces("application/json")]
public class PrioritiesController(PriorityService priorities) : ControllerBase
{
    /// <summary>Lists all priorities, most urgent first, including inactive ones (historical tasks still display them; pickers hide inactive).</summary>
    [HttpGet(Name = "ListPriorities")]
    [Authorize(Policy = ConfigurationPolicies.PriorityRead)]
    [ProducesResponseType<IReadOnlyList<PriorityView>>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<IReadOnlyList<PriorityView>>> List(CancellationToken cancellationToken) =>
        Ok(await priorities.ListViewsAsync(cancellationToken));

    /// <summary>Adds a priority as the least urgent. It is never the default; use the default action.</summary>
    [HttpPost(Name = "CreatePriority")]
    [Authorize(Policy = ConfigurationPolicies.PriorityManage)]
    [ProducesResponseType<PriorityView>(StatusCodes.Status201Created, "application/json")]
    public async Task<ActionResult<PriorityView>> Create([FromBody] CreatePriorityRequest request, CancellationToken cancellationToken)
    {
        var created = (await priorities.CreateAsync(request, cancellationToken)).OrThrow();
        return Created($"/api/v1/priorities/{created.Id}", created);
    }

    /// <summary>Renames, recolors, activates or deactivates a priority. The default priority cannot be deactivated.</summary>
    [HttpPut("{id:int}", Name = "UpdatePriority")]
    [Authorize(Policy = ConfigurationPolicies.PriorityManage)]
    [ProducesResponseType<PriorityView>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<PriorityView>> Update(int id, [FromBody] UpdatePriorityRequest request, CancellationToken cancellationToken) =>
        (await priorities.UpdateAsync(id, request, cancellationToken)).OrThrow();

    /// <summary>Makes an active priority the single default for new tasks. Returns the full list.</summary>
    [HttpPost("{id:int}/default", Name = "SetDefaultPriority")]
    [Authorize(Policy = ConfigurationPolicies.PriorityManage)]
    [ProducesResponseType<IReadOnlyList<PriorityView>>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<IReadOnlyList<PriorityView>>> SetDefault(int id, CancellationToken cancellationToken) =>
        Ok((await priorities.SetDefaultAsync(id, cancellationToken)).OrThrow());

    /// <summary>Sets the order from most to least urgent. The list must contain every priority exactly once. Returns the full list.</summary>
    [HttpPut("order", Name = "ReorderPriorities")]
    [Authorize(Policy = ConfigurationPolicies.PriorityManage)]
    [ProducesResponseType<IReadOnlyList<PriorityView>>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<IReadOnlyList<PriorityView>>> Reorder([FromBody] ReorderRequest request, CancellationToken cancellationToken) =>
        Ok((await priorities.ReorderAsync(request.Ids, cancellationToken)).OrThrow());

    /// <summary>Deletes an unused, non-default priority (409 <c>IN_USE</c> when tasks reference it: deactivate instead).</summary>
    [HttpDelete("{id:int}", Name = "DeletePriority")]
    [Authorize(Policy = ConfigurationPolicies.PriorityManage)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        (await priorities.DeleteAsync(id, cancellationToken)).OrThrow();
        return NoContent();
    }
}
