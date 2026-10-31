using MatterFlow.Organization.Application;
using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Organization.Api;

/// <summary>The fixed list of calendar event types (UI-05).</summary>
[ApiController]
[Route("api/v1/matter-event-types")]
public class MatterEventTypesController : ControllerBase
{
    /// <summary>The eight event types with their icon and colour keys, in display order.</summary>
    [HttpGet(Name = "ListMatterEventTypes")]
    [Authorize(Policy = OrganizationPolicies.MatterView)]
    [ProducesResponseType<IReadOnlyList<MatterEventTypeInfo>>(StatusCodes.Status200OK, "application/json")]
    public IActionResult List() => Ok(MatterEventTypes.All);
}

/// <summary>
/// Calendar events of one matter (UI-05). Everyone who can see the matter can read them (a sensitive matter the caller may not see is a 404); the matter's Primary and Secondary PM and
/// holders of <c>Matter.Edit</c> create, change and delete them (403 <c>NOT_MATTER_MANAGER</c> otherwise).
/// </summary>
[ApiController]
[Route("api/v1/matters/{matterId:int}/events")]
public class MatterEventsController(MatterEventService events) : ControllerBase
{
    /// <summary>The matter's events from <c>from</c> to <c>to</c> (default: today to 90 days ahead; at most 100 days), by date and time.</summary>
    [HttpGet(Name = "ListMatterEvents")]
    [Authorize(Policy = OrganizationPolicies.MatterView)]
    [ProducesResponseType<MatterEventList>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List(int matterId, [FromQuery] MatterEventListQuery query, CancellationToken cancellationToken)
    {
        if (ListFilters.UnknownFilter(Request, MatterEventListQuery.Keys) is { } unknown)
            return this.Problem(unknown);

        return this.ToActionResult(await events.ListForMatterAsync(matterId, query, cancellationToken));
    }

    /// <summary>Adds an event to the matter. Primary and Secondary PM and holders of <c>Matter.Edit</c> only; an archived matter gets no new events.</summary>
    [HttpPost(Name = "CreateMatterEvent")]
    [Authorize(Policy = OrganizationPolicies.MatterView)]
    [ProducesResponseType<MatterEventResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create(int matterId, [FromBody] MatterEventRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(
            await events.CreateAsync(matterId, request, cancellationToken),
            e => CreatedAtRoute("ListMatterEvents", new { matterId = e.MatterId, from = e.Date, to = e.Date }, e));
}

/// <summary>Change or delete one calendar event by id (UI-05); the same rule as <see cref="MatterEventsController"/>.</summary>
[ApiController]
[Route("api/v1/matter-events/{eventId:int}")]
public class MatterEventItemController(MatterEventService events) : ControllerBase
{
    /// <summary>Changes the event (type, title, date, time, note). Send the <c>rowVersion</c> last read; a stale one is a 409.</summary>
    [HttpPut(Name = "UpdateMatterEvent")]
    [Authorize(Policy = OrganizationPolicies.MatterView)]
    [ProducesResponseType<MatterEventResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(int eventId, [FromBody] UpdateMatterEventRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await events.UpdateAsync(eventId, request, cancellationToken));

    /// <summary>Deletes the event for good (audited). Send the <c>rowVersion</c> last read as a query parameter.</summary>
    [HttpDelete(Name = "DeleteMatterEvent")]
    [Authorize(Policy = OrganizationPolicies.MatterView)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int eventId, [FromQuery] string? rowVersion, CancellationToken cancellationToken)
    {
        var result = await events.DeleteAsync(eventId, rowVersion, cancellationToken);
        return result.IsFailure ? this.Problem(result.Error!) : NoContent();
    }
}
