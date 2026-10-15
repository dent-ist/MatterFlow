using MatterFlow.Identity.Application;
using MatterFlow.Identity.Authorization;
using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Identity;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Identity.Api;

/// <summary>
/// The signed-in user's own availability and work hours (profile page). Any user who can work Tasks (<c>Task.View</c>) may edit their own.
/// Operational capacity information only: it is never used to rank or evaluate people.
/// </summary>
[ApiController]
[Route("api/v1/me/availability")]
[Produces("application/json")]
public class MyAvailabilityController(UserAvailabilityService availability, ICurrentUser currentUser) : ControllerBase
{
    /// <summary>Gets the caller's availability and schedule (defaults and <c>rowVersion = NEW</c> until the first save).</summary>
    [HttpGet(Name = "GetMyAvailability")]
    [RequirePermission(Permissions.Task.View)]
    [ProducesResponseType<UserAvailabilityDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(CancellationToken cancellationToken) =>
        this.ToActionResult(await availability.GetAsync(currentUser.UserId!.Value, cancellationToken));

    /// <summary>
    /// Replaces the caller's availability, time zone and work hours. The row version is required (<c>NEW</c> for the first save).
    /// Errors: 400 <c>OOO_RANGE_INVALID</c>, <c>WORK_HOURS_INVALID</c>, <c>TIMEZONE_UNKNOWN</c>, <c>NOTE_TOO_LONG</c>, <c>STATUS_INVALID</c>; 409 <c>CONCURRENCY_CONFLICT</c>.
    /// </summary>
    [HttpPut(Name = "SaveMyAvailability")]
    [RequirePermission(Permissions.Task.View)]
    [ProducesResponseType<UserAvailabilityDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Put([FromBody] SaveAvailabilityRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await availability.SaveAsync(currentUser.UserId!.Value, request, cancellationToken));
}

/// <summary>Availability of another user, for administrators who cover for someone (<c>User.Manage</c>).</summary>
[ApiController]
[Route("api/v1/users/{userId:int}/availability")]
[Produces("application/json")]
public class UserAvailabilityController(UserAvailabilityService availability) : ControllerBase
{
    /// <summary>Gets a user's availability and schedule.</summary>
    [HttpGet(Name = "GetUserAvailability")]
    [RequirePermission(Permissions.User.Manage)]
    [ProducesResponseType<UserAvailabilityDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(int userId, CancellationToken cancellationToken) =>
        this.ToActionResult(await availability.GetAsync(userId, cancellationToken));

    /// <summary>Replaces a user's availability on their behalf (for example sick leave). Audited with the editor as actor.</summary>
    [HttpPut(Name = "SaveUserAvailability")]
    [RequirePermission(Permissions.User.Manage)]
    [ProducesResponseType<UserAvailabilityDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Put(int userId, [FromBody] SaveAvailabilityRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await availability.SaveAsync(userId, request, cancellationToken));
}
