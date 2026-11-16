using LptHub.Identity.Authorization;
using LptHub.Identity.Contracts;
using LptHub.Identity.Domain;
using LptHub.Identity.PersonLists;
using LptHub.SharedKernel.Results;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace LptHub.Identity.Api;

// The two admin lists of a person (epic #1389, issue #1394): same shape as the matter pick lists. A used item is deactivated, never deleted.
// Reading needs User.View or User.Manage (the user dialog's pickers), changing needs User.Manage.

/// <summary>Offices: the admin-managed list a person's Office is picked from (optional on an internal person).</summary>
[ApiController]
[Route("api/v1/offices")]
[Produces("application/json")]
public class OfficesController(PersonListService<Office> items) : ControllerBase
{
    /// <summary>Lists all offices in their order, including inactive ones (pickers hide the inactive). Needs <c>User.View</c> or <c>User.Manage</c>.</summary>
    [HttpGet(Name = "ListOffices")]
    [RequirePermission(Permissions.User.View + "|" + Permissions.User.Manage)]
    [ProducesResponseType<IReadOnlyList<PersonListItemView>>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<IReadOnlyList<PersonListItemView>>> List(CancellationToken cancellationToken) =>
        Ok(await items.ListViewsAsync(cancellationToken));

    /// <summary>Adds an office at the end of the list. 409 <c>DUPLICATE_NAME</c> when the name exists.</summary>
    [HttpPost(Name = "CreateOffice")]
    [RequirePermission(Permissions.User.Manage)]
    [ProducesResponseType<PersonListItemView>(StatusCodes.Status201Created, "application/json")]
    public async Task<ActionResult<PersonListItemView>> Create([FromBody] CreatePersonListItemRequest request, CancellationToken cancellationToken)
    {
        var created = (await items.CreateAsync(request, cancellationToken)).OrThrow();
        return Created($"/api/v1/offices/{created.Id}", created);
    }

    /// <summary>Renames, activates or deactivates an office (the way to retire a used one).</summary>
    [HttpPut("{id:int}", Name = "UpdateOffice")]
    [RequirePermission(Permissions.User.Manage)]
    [ProducesResponseType<PersonListItemView>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<PersonListItemView>> Update(int id, [FromBody] UpdatePersonListItemRequest request, CancellationToken cancellationToken) =>
        (await items.UpdateAsync(id, request, cancellationToken)).OrThrow();

    /// <summary>Sets the order. The list must contain every item exactly once. Returns the full list.</summary>
    [HttpPut("order", Name = "ReorderOffices")]
    [RequirePermission(Permissions.User.Manage)]
    [ProducesResponseType<IReadOnlyList<PersonListItemView>>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<IReadOnlyList<PersonListItemView>>> Reorder([FromBody] ReorderPersonListRequest request, CancellationToken cancellationToken) =>
        Ok((await items.ReorderAsync(request.Ids, cancellationToken)).OrThrow());

    /// <summary>Deletes an office nobody uses (In Use 0). 409 <c>IN_USE</c> when people carry it: deactivate it instead.</summary>
    [HttpDelete("{id:int}", Name = "DeleteOffice")]
    [RequirePermission(Permissions.User.Manage)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        (await items.DeleteAsync(id, cancellationToken)).OrThrow();
        return NoContent();
    }
}

/// <summary>Employment Statuses: the admin-managed list a person's Employment Status is picked from (Active, On Leave, Departed to start with). The HR status of the person, not the account state of the user.</summary>
[ApiController]
[Route("api/v1/employment-statuses")]
[Produces("application/json")]
public class EmploymentStatusesController(PersonListService<EmploymentStatus> items) : ControllerBase
{
    /// <summary>Lists all employment statuses in their order, including inactive ones (pickers hide the inactive). Needs <c>User.View</c> or <c>User.Manage</c>.</summary>
    [HttpGet(Name = "ListEmploymentStatuses")]
    [RequirePermission(Permissions.User.View + "|" + Permissions.User.Manage)]
    [ProducesResponseType<IReadOnlyList<PersonListItemView>>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<IReadOnlyList<PersonListItemView>>> List(CancellationToken cancellationToken) =>
        Ok(await items.ListViewsAsync(cancellationToken));

    /// <summary>Adds an employment status at the end of the list. 409 <c>DUPLICATE_NAME</c> when the name exists.</summary>
    [HttpPost(Name = "CreateEmploymentStatus")]
    [RequirePermission(Permissions.User.Manage)]
    [ProducesResponseType<PersonListItemView>(StatusCodes.Status201Created, "application/json")]
    public async Task<ActionResult<PersonListItemView>> Create([FromBody] CreatePersonListItemRequest request, CancellationToken cancellationToken)
    {
        var created = (await items.CreateAsync(request, cancellationToken)).OrThrow();
        return Created($"/api/v1/employment-statuses/{created.Id}", created);
    }

    /// <summary>Renames, activates or deactivates an employment status (the way to retire a used one).</summary>
    [HttpPut("{id:int}", Name = "UpdateEmploymentStatus")]
    [RequirePermission(Permissions.User.Manage)]
    [ProducesResponseType<PersonListItemView>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<PersonListItemView>> Update(int id, [FromBody] UpdatePersonListItemRequest request, CancellationToken cancellationToken) =>
        (await items.UpdateAsync(id, request, cancellationToken)).OrThrow();

    /// <summary>Sets the order. The list must contain every item exactly once. Returns the full list.</summary>
    [HttpPut("order", Name = "ReorderEmploymentStatuses")]
    [RequirePermission(Permissions.User.Manage)]
    [ProducesResponseType<IReadOnlyList<PersonListItemView>>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<IReadOnlyList<PersonListItemView>>> Reorder([FromBody] ReorderPersonListRequest request, CancellationToken cancellationToken) =>
        Ok((await items.ReorderAsync(request.Ids, cancellationToken)).OrThrow());

    /// <summary>Deletes an employment status nobody uses (In Use 0). 409 <c>IN_USE</c> when people carry it: deactivate it instead.</summary>
    [HttpDelete("{id:int}", Name = "DeleteEmploymentStatus")]
    [RequirePermission(Permissions.User.Manage)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        (await items.DeleteAsync(id, cancellationToken)).OrThrow();
        return NoContent();
    }
}
