using MatterFlow.Identity.Application;
using MatterFlow.Identity.Authorization;
using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Identity.Api;

/// <summary>
/// The signed-in user's own availability (time zone, work hours, Out of office entries and holidays; profile page). Any user who can work Tasks (<c>Task.View</c>) may edit their own.
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
    /// Replaces the caller's time zone and work hours (Out of office entries have their own endpoints). The row version is required (<c>NEW</c> for the first save).
    /// Errors: 400 <c>WORK_HOURS_INVALID</c>, <c>TIMEZONE_UNKNOWN</c>; 409 <c>CONCURRENCY_CONFLICT</c>.
    /// </summary>
    [HttpPut(Name = "SaveMyAvailability")]
    [RequirePermission(Permissions.Task.View)]
    [ProducesResponseType<UserAvailabilityDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Put([FromBody] SaveAvailabilityRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await availability.SaveAsync(currentUser.UserId!.Value, request, cancellationToken));
}

/// <summary>
/// Availability of another user. Reading needs <c>User.Manage</c> or <c>User.ManageAvailability</c> (a Pod Lead: members of their own pods); changing the time zone and work hours
/// needs <c>User.Manage</c>. A user's own availability is <c>GET /api/v1/me/availability</c>.
/// </summary>
[ApiController]
[Route("api/v1/users/{userId:int}/availability")]
[Produces("application/json")]
public class UserAvailabilityController(UserAvailabilityService availability, ICalendarAccess access, IPermissionChecker permissions, ICurrentUser currentUser) : ControllerBase
{
    /// <summary>Gets a user's availability, Out of office entries, holiday calendar and next holidays.</summary>
    [HttpGet(Name = "GetUserAvailability")]
    [RequirePermission(Permissions.User.Manage + "|" + Permissions.User.ManageAvailability + "|" + Permissions.Task.View)]
    [ProducesResponseType<UserAvailabilityDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(int userId, CancellationToken cancellationToken)
    {
        var allowed = currentUser.UserId == userId
            ? permissions.Has(Permissions.Task.View)
            : permissions.Has(Permissions.User.Manage) || await access.CanEditAbsencesOfAsync(userId, cancellationToken);
        if (!allowed)
            return this.Problem(Error.Forbidden("You cannot see this person's availability."));
        return this.ToActionResult(await availability.GetAsync(userId, cancellationToken));
    }

    /// <summary>Replaces a user's time zone and work hours on their behalf. Audited with the editor as actor.</summary>
    [HttpPut(Name = "SaveUserAvailability")]
    [RequirePermission(Permissions.User.Manage)]
    [ProducesResponseType<UserAvailabilityDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Put(int userId, [FromBody] SaveAvailabilityRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await availability.SaveAsync(userId, request, cancellationToken));
}

/// <summary>
/// The Out of office entries of a person (Dashboard Calendar, decision AT). The person themselves needs <c>Task.View</c>; someone else needs <c>User.ManageAvailability</c> and, as a Pod Lead,
/// a shared pod with the person (403 otherwise). Errors: 400 <c>ABSENCE_TYPE_INVALID</c>, <c>ABSENCE_RANGE_INVALID</c>, <c>ABSENCE_IN_PAST</c>, <c>ABSENCE_OPEN_ENDED_NOT_TODAY</c>,
/// <c>ABSENCE_READ_ONLY</c>, <c>NOTE_TOO_LONG</c>; 409 <c>ABSENCE_OVERLAP</c> (the other entry is in <c>meta.overlapsWith</c>) and <c>CONCURRENCY_CONFLICT</c>.
/// </summary>
[ApiController]
[Route("api/v1/users/{userId:int}/absences")]
[Produces("application/json")]
public class AbsencesController(AbsenceService absences) : ControllerBase
{
    private const string AnyAccess = Permissions.Task.View + "|" + Permissions.User.ManageAvailability;

    /// <summary>Lists the entries, earliest first: current and upcoming ones, with <c>includePast</c> also the finished ones.</summary>
    [HttpGet(Name = "ListAbsences")]
    [RequirePermission(AnyAccess)]
    [ProducesResponseType<AbsenceDto[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List(int userId, [FromQuery] bool includePast, CancellationToken cancellationToken) =>
        this.ToActionResult(await absences.ListAsync(userId, includePast, cancellationToken));

    /// <summary>Adds an entry.</summary>
    [HttpPost(Name = "CreateAbsence")]
    [RequirePermission(AnyAccess)]
    [ProducesResponseType<AbsenceDto>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create(int userId, [FromBody] SaveAbsenceRequest request, CancellationToken cancellationToken)
    {
        var result = await absences.CreateAsync(userId, request, cancellationToken);
        return result.IsFailure ? this.Problem(result.Error!) : StatusCode(StatusCodes.Status201Created, result.Value);
    }

    /// <summary>Changes an entry that has not ended (the row version is required).</summary>
    [HttpPut("{absenceId:int}", Name = "UpdateAbsence")]
    [RequirePermission(AnyAccess)]
    [ProducesResponseType<AbsenceDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(int userId, int absenceId, [FromBody] SaveAbsenceRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await absences.UpdateAsync(userId, absenceId, request, cancellationToken));

    /// <summary>Deletes an entry that has not ended.</summary>
    [HttpDelete("{absenceId:int}", Name = "DeleteAbsence")]
    [RequirePermission(AnyAccess)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int userId, int absenceId, [FromQuery] string? rowVersion, CancellationToken cancellationToken) =>
        this.ToActionResult(await absences.DeleteAsync(userId, absenceId, rowVersion, cancellationToken));

    /// <summary>"I'm back": ends the entry yesterday, or deletes it when it has not started.</summary>
    [HttpPost("{absenceId:int}/back", Name = "EndAbsenceToday")]
    [RequirePermission(AnyAccess)]
    [ProducesResponseType<AbsenceBackResult>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Back(int userId, int absenceId, CancellationToken cancellationToken) =>
        this.ToActionResult(await absences.BackAsync(userId, absenceId, cancellationToken));
}
