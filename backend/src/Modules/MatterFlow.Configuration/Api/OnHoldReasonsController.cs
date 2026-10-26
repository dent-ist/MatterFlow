using MatterFlow.Configuration.Application.Lookups;
using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Configuration.Api;

/// <summary>
/// On-hold reasons (PM v2, #876): the admin-managed list a person picks from when putting a task On Hold. A reason is never deleted, only
/// deactivated, so history keeps its name. Failures surface as problem+json with a stable code.
/// </summary>
[ApiController]
[Route("api/v1/on-hold-reasons")]
[Produces("application/json")]
public class OnHoldReasonsController(OnHoldReasonService reasons) : ControllerBase
{
    /// <summary>Lists all on-hold reasons in their order, including inactive ones (pickers hide the inactive).</summary>
    [HttpGet(Name = "ListOnHoldReasons")]
    [Authorize(Policy = ConfigurationPolicies.OnHoldReasonRead)]
    [ProducesResponseType<IReadOnlyList<OnHoldReasonView>>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<IReadOnlyList<OnHoldReasonView>>> List(CancellationToken cancellationToken) =>
        Ok(await reasons.ListViewsAsync(cancellationToken));

    /// <summary>Adds an on-hold reason at the end of the list. 409 <c>DUPLICATE_NAME</c> when the name exists.</summary>
    [HttpPost(Name = "CreateOnHoldReason")]
    [Authorize(Policy = ConfigurationPolicies.OnHoldReasonManage)]
    [ProducesResponseType<OnHoldReasonView>(StatusCodes.Status201Created, "application/json")]
    public async Task<ActionResult<OnHoldReasonView>> Create([FromBody] CreateOnHoldReasonRequest request, CancellationToken cancellationToken)
    {
        var created = (await reasons.CreateAsync(request, cancellationToken)).OrThrow();
        return Created($"/api/v1/on-hold-reasons/{created.Id}", created);
    }

    /// <summary>Renames, activates or deactivates an on-hold reason (the way to retire a used one).</summary>
    [HttpPut("{id:int}", Name = "UpdateOnHoldReason")]
    [Authorize(Policy = ConfigurationPolicies.OnHoldReasonManage)]
    [ProducesResponseType<OnHoldReasonView>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<OnHoldReasonView>> Update(int id, [FromBody] UpdateOnHoldReasonRequest request, CancellationToken cancellationToken) =>
        (await reasons.UpdateAsync(id, request, cancellationToken)).OrThrow();

    /// <summary>Sets the order. The list must contain every reason exactly once. Returns the full list.</summary>
    [HttpPut("order", Name = "ReorderOnHoldReasons")]
    [Authorize(Policy = ConfigurationPolicies.OnHoldReasonManage)]
    [ProducesResponseType<IReadOnlyList<OnHoldReasonView>>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<IReadOnlyList<OnHoldReasonView>>> Reorder([FromBody] ReorderRequest request, CancellationToken cancellationToken) =>
        Ok((await reasons.ReorderAsync(request.Ids, cancellationToken)).OrThrow());
}
