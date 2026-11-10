using MatterFlow.Identity.Authorization;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Views;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Identity.Api;

/// <summary>
/// The signed-in person's remembered screen state (filters, sort, Focus: one automatic row per surface) and named saved views, stored on the
/// server so they follow the person between workstations (PM v2, #856). Always the caller's own rows; another person's id is a 404.
/// Available to everyone who works with tasks, matters or assets.
/// </summary>
[ApiController]
[Route("api/v1/me/views")]
[Produces("application/json")]
public class UserViewsController(UserViewService views) : ControllerBase
{
    /// <summary>Permission alternatives: any screen that remembers state belongs to a person who may see tasks, matters or assets.</summary>
    private const string WorkPermissions = Permissions.Task.View + "|" + Permissions.Matter.View + "|" + Permissions.Asset.View;

    /// <summary>
    /// Lists the caller's remembered states and named views, optionally for one <c>surface</c>. 400 <c>UNKNOWN_SURFACE</c> for a surface the
    /// application does not know.
    /// </summary>
    [HttpGet(Name = "ListMyViews")]
    [RequirePermission(WorkPermissions)]
    [ProducesResponseType<UserViewListResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List([FromQuery] string? surface, CancellationToken cancellationToken) =>
        this.ToActionResult(await views.ListAsync(surface, cancellationToken));

    /// <summary>
    /// Replaces the remembered state of a surface (creates it on first use; the last write wins). 400 <c>STATE_INVALID</c> (not a JSON object),
    /// <c>STATE_TOO_LARGE</c> (over 4 KB), <c>UNKNOWN_SURFACE</c>.
    /// </summary>
    [HttpPut("{surface}", Name = "SaveMyRememberedView")]
    [RequirePermission(WorkPermissions)]
    [ProducesResponseType<UserViewDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> SaveRemembered(string surface, [FromBody] SaveRememberedViewRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await views.SaveRememberedAsync(surface, request, cancellationToken));

    /// <summary>
    /// Creates a named saved view (at most 30 per person). 400 <c>LIMIT_REACHED</c>, <c>REQUIRED</c>, <c>TOO_LONG</c>, <c>STATE_INVALID</c>,
    /// <c>STATE_TOO_LARGE</c>, <c>UNKNOWN_SURFACE</c>; 409 <c>DUPLICATE_NAME</c> (per surface).
    /// </summary>
    [HttpPost(Name = "CreateMyView")]
    [RequirePermission(WorkPermissions)]
    [ProducesResponseType<UserViewDto>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create([FromBody] CreateUserViewRequest request, CancellationToken cancellationToken)
    {
        var result = await views.CreateAsync(request, cancellationToken);
        return result.IsFailure ? this.Problem(result.Error!) : Created($"/api/v1/me/views/{result.Value!.Id}", result.Value);
    }

    /// <summary>Renames a named view, replaces its state or sets/clears its default flag. 404 for a view that is not the caller's; 409 <c>CONCURRENCY_CONFLICT</c>, <c>DUPLICATE_NAME</c>.</summary>
    [HttpPut("{id:long}", Name = "UpdateMyView")]
    [RequirePermission(WorkPermissions)]
    [ProducesResponseType<UserViewDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(long id, [FromBody] UpdateUserViewRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await views.UpdateAsync(id, request, cancellationToken));

    /// <summary>Deletes a named view. 404 for a view that is not the caller's.</summary>
    [HttpDelete("{id:long}", Name = "DeleteMyView")]
    [RequirePermission(WorkPermissions)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(long id, CancellationToken cancellationToken) =>
        this.ToActionResult(await views.DeleteAsync(id, cancellationToken));
}
