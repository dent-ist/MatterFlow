using LptHub.Configuration.Application.Lookups;
using LptHub.Configuration.Domain;
using LptHub.SharedKernel.Results;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace LptHub.Configuration.Api;

// The three admin pick lists of a matter (epic #1298): same shape as the on-hold reasons. A used item is deactivated, never deleted.

/// <summary>Matter Types: the admin-managed list a matter's Type is picked from (optional on a matter).</summary>
[ApiController]
[Route("api/v1/matter-types")]
[Produces("application/json")]
public class MatterTypesController(MatterListService<MatterType> items) : ControllerBase
{
    /// <summary>Lists all matter types in their order, including inactive ones (pickers hide the inactive). Needs <c>Matter.View</c> or <c>MatterList.Manage</c>.</summary>
    [HttpGet(Name = "ListMatterTypes")]
    [Authorize(Policy = ConfigurationPolicies.MatterListRead)]
    [ProducesResponseType<IReadOnlyList<MatterListItemView>>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<IReadOnlyList<MatterListItemView>>> List(CancellationToken cancellationToken) =>
        Ok(await items.ListViewsAsync(cancellationToken));

    /// <summary>Adds a matter type at the end of the list. 409 <c>DUPLICATE_NAME</c> when the name exists.</summary>
    [HttpPost(Name = "CreateMatterType")]
    [Authorize(Policy = ConfigurationPolicies.MatterListManage)]
    [ProducesResponseType<MatterListItemView>(StatusCodes.Status201Created, "application/json")]
    public async Task<ActionResult<MatterListItemView>> Create([FromBody] CreateMatterListItemRequest request, CancellationToken cancellationToken)
    {
        var created = (await items.CreateAsync(request, cancellationToken)).OrThrow();
        return Created($"/api/v1/matter-types/{created.Id}", created);
    }

    /// <summary>Renames, activates or deactivates a matter type (the way to retire a used one; there is no delete).</summary>
    [HttpPut("{id:int}", Name = "UpdateMatterType")]
    [Authorize(Policy = ConfigurationPolicies.MatterListManage)]
    [ProducesResponseType<MatterListItemView>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MatterListItemView>> Update(int id, [FromBody] UpdateMatterListItemRequest request, CancellationToken cancellationToken) =>
        (await items.UpdateAsync(id, request, cancellationToken)).OrThrow();

    /// <summary>Sets the order. The list must contain every item exactly once. Returns the full list.</summary>
    [HttpPut("order", Name = "ReorderMatterTypes")]
    [Authorize(Policy = ConfigurationPolicies.MatterListManage)]
    [ProducesResponseType<IReadOnlyList<MatterListItemView>>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<IReadOnlyList<MatterListItemView>>> Reorder([FromBody] ReorderRequest request, CancellationToken cancellationToken) =>
        Ok((await items.ReorderAsync(request.Ids, cancellationToken)).OrThrow());

    /// <summary>Deletes a matter type nobody uses (In Use 0). 409 <c>IN_USE</c> when matters or team members carry it: deactivate it instead.</summary>
    [HttpDelete("{id:int}", Name = "DeleteMatterType")]
    [Authorize(Policy = ConfigurationPolicies.MatterListManage)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        (await items.DeleteAsync(id, cancellationToken)).OrThrow();
        return NoContent();
    }
}

/// <summary>Current States: the admin-ordered list a matter's Current State is picked from (optional on a matter).</summary>
[ApiController]
[Route("api/v1/current-states")]
[Produces("application/json")]
public class CurrentStatesController(MatterListService<CurrentState> items) : ControllerBase
{
    /// <summary>Lists all current states in their order, including inactive ones (pickers hide the inactive). Needs <c>Matter.View</c> or <c>MatterList.Manage</c>.</summary>
    [HttpGet(Name = "ListCurrentStates")]
    [Authorize(Policy = ConfigurationPolicies.MatterListRead)]
    [ProducesResponseType<IReadOnlyList<MatterListItemView>>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<IReadOnlyList<MatterListItemView>>> List(CancellationToken cancellationToken) =>
        Ok(await items.ListViewsAsync(cancellationToken));

    /// <summary>Adds a current state at the end of the list. 409 <c>DUPLICATE_NAME</c> when the name exists.</summary>
    [HttpPost(Name = "CreateCurrentState")]
    [Authorize(Policy = ConfigurationPolicies.MatterListManage)]
    [ProducesResponseType<MatterListItemView>(StatusCodes.Status201Created, "application/json")]
    public async Task<ActionResult<MatterListItemView>> Create([FromBody] CreateMatterListItemRequest request, CancellationToken cancellationToken)
    {
        var created = (await items.CreateAsync(request, cancellationToken)).OrThrow();
        return Created($"/api/v1/current-states/{created.Id}", created);
    }

    /// <summary>Renames, activates or deactivates a current state (the way to retire a used one; there is no delete).</summary>
    [HttpPut("{id:int}", Name = "UpdateCurrentState")]
    [Authorize(Policy = ConfigurationPolicies.MatterListManage)]
    [ProducesResponseType<MatterListItemView>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MatterListItemView>> Update(int id, [FromBody] UpdateMatterListItemRequest request, CancellationToken cancellationToken) =>
        (await items.UpdateAsync(id, request, cancellationToken)).OrThrow();

    /// <summary>Sets the order. The list must contain every item exactly once. Returns the full list.</summary>
    [HttpPut("order", Name = "ReorderCurrentStates")]
    [Authorize(Policy = ConfigurationPolicies.MatterListManage)]
    [ProducesResponseType<IReadOnlyList<MatterListItemView>>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<IReadOnlyList<MatterListItemView>>> Reorder([FromBody] ReorderRequest request, CancellationToken cancellationToken) =>
        Ok((await items.ReorderAsync(request.Ids, cancellationToken)).OrThrow());

    /// <summary>Deletes a current state nobody uses (In Use 0). 409 <c>IN_USE</c> when matters or team members carry it: deactivate it instead.</summary>
    [HttpDelete("{id:int}", Name = "DeleteCurrentState")]
    [Authorize(Policy = ConfigurationPolicies.MatterListManage)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        (await items.DeleteAsync(id, cancellationToken)).OrThrow();
        return NoContent();
    }
}

/// <summary>Team Titles: the admin-managed list a matter team member's Title is picked from.</summary>
[ApiController]
[Route("api/v1/team-titles")]
[Produces("application/json")]
public class TeamTitlesController(MatterListService<TeamTitle> items) : ControllerBase
{
    /// <summary>Lists all team titles in their order, including inactive ones (pickers hide the inactive). Needs <c>Matter.View</c> or <c>MatterList.Manage</c>.</summary>
    [HttpGet(Name = "ListTeamTitles")]
    [Authorize(Policy = ConfigurationPolicies.MatterListRead)]
    [ProducesResponseType<IReadOnlyList<MatterListItemView>>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<IReadOnlyList<MatterListItemView>>> List(CancellationToken cancellationToken) =>
        Ok(await items.ListViewsAsync(cancellationToken));

    /// <summary>Adds a team title at the end of the list. 409 <c>DUPLICATE_NAME</c> when the name exists.</summary>
    [HttpPost(Name = "CreateTeamTitle")]
    [Authorize(Policy = ConfigurationPolicies.MatterListManage)]
    [ProducesResponseType<MatterListItemView>(StatusCodes.Status201Created, "application/json")]
    public async Task<ActionResult<MatterListItemView>> Create([FromBody] CreateMatterListItemRequest request, CancellationToken cancellationToken)
    {
        var created = (await items.CreateAsync(request, cancellationToken)).OrThrow();
        return Created($"/api/v1/team-titles/{created.Id}", created);
    }

    /// <summary>Renames, activates or deactivates a team title (the way to retire a used one; there is no delete).</summary>
    [HttpPut("{id:int}", Name = "UpdateTeamTitle")]
    [Authorize(Policy = ConfigurationPolicies.MatterListManage)]
    [ProducesResponseType<MatterListItemView>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MatterListItemView>> Update(int id, [FromBody] UpdateMatterListItemRequest request, CancellationToken cancellationToken) =>
        (await items.UpdateAsync(id, request, cancellationToken)).OrThrow();

    /// <summary>Sets the order. The list must contain every item exactly once. Returns the full list.</summary>
    [HttpPut("order", Name = "ReorderTeamTitles")]
    [Authorize(Policy = ConfigurationPolicies.MatterListManage)]
    [ProducesResponseType<IReadOnlyList<MatterListItemView>>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<IReadOnlyList<MatterListItemView>>> Reorder([FromBody] ReorderRequest request, CancellationToken cancellationToken) =>
        Ok((await items.ReorderAsync(request.Ids, cancellationToken)).OrThrow());

    /// <summary>Deletes a team title nobody uses (In Use 0). 409 <c>IN_USE</c> when matters or team members carry it: deactivate it instead.</summary>
    [HttpDelete("{id:int}", Name = "DeleteTeamTitle")]
    [Authorize(Policy = ConfigurationPolicies.MatterListManage)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        (await items.DeleteAsync(id, cancellationToken)).OrThrow();
        return NoContent();
    }
}
