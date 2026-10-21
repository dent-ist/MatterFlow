using System.ComponentModel.DataAnnotations;
using MatterFlow.Identity.Application;
using MatterFlow.Identity.Authorization;
using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Availability;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Identity.Api;

/// <summary>Users queue (Access Pending admin) and role assignment (UX S12). Viewing needs <c>User.View</c>, changes need <c>User.Manage</c>.</summary>
[ApiController]
[Route("api/v1/users")]
[Produces("application/json")]
public class UsersController(UserAdministration users) : ControllerBase
{
    /// <summary>
    /// Lists users, pending access first, with search and paging. The column filters <c>name</c>, <c>account</c> and <c>email</c> (fragments of
    /// that column only), <c>roleId</c> (repeat it: people holding any of the roles), <c>availability</c> and the first-seen days
    /// <c>registeredFrom</c> / <c>registeredTo</c> (viewer's zone, inclusive) combine with AND.
    /// </summary>
    /// <param name="status"><c>all</c> (default), <c>pending</c>, <c>active</c> (with access; people waiting for access are listed under <c>pending</c>) or <c>inactive</c>.</param>
    /// <param name="search">Matches display name, e-mail or Windows account.</param>
    /// <param name="name">Fragment of the display name.</param>
    /// <param name="account">Fragment of the Windows account.</param>
    /// <param name="email">Fragment of the e-mail.</param>
    /// <param name="roleId">Role ids; repeat the parameter for several (any of them).</param>
    /// <param name="availability"><c>AVAILABLE</c>, <c>OUT_OF_OFFICE</c> or <c>OFF_HOURS</c>, as of now.</param>
    /// <param name="registeredFrom">First day (viewer's zone), <c>yyyy-MM-dd</c>.</param>
    /// <param name="registeredTo">Last day (viewer's zone, inclusive), <c>yyyy-MM-dd</c>.</param>
    /// <param name="page">1-based page.</param>
    /// <param name="pageSize">Items per page (default 25, max 100).</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet(Name = "ListUsers")]
    [RequirePermission(Permissions.User.View)]
    [ProducesResponseType<PagedResult<UserSummaryDto>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List(
        [FromQuery] string? status,
        [FromQuery, StringLength(200)] string? search,
        [FromQuery, StringLength(200)] string? name,
        [FromQuery, StringLength(200)] string? account,
        [FromQuery, StringLength(200)] string? email,
        [FromQuery] int[]? roleId,
        [FromQuery, StringLength(20)] string? availability,
        [FromQuery, StringLength(10)] string? registeredFrom,
        [FromQuery, StringLength(10)] string? registeredTo,
        [FromQuery, Range(1, int.MaxValue)] int page = PageRequest.FirstPage,
        [FromQuery, Range(1, PageRequest.MaxPageSize)] int pageSize = PageRequest.DefaultPageSize,
        CancellationToken cancellationToken = default)
    {
        if (!UserListStatuses.IsValid(status))
            return this.Problem(Error.Validation("status", "INVALID", "status must be all, pending, active or inactive."));
        if (availability is not null and not (AvailabilityStates.Available or AvailabilityStates.OutOfOffice or AvailabilityStates.OffHours))
            return this.Problem(Error.Validation("availability", "INVALID", "availability must be AVAILABLE, OUT_OF_OFFICE or OFF_HOURS."));
        if (!TryDay(registeredFrom, "registeredFrom", out var from, out var fromError))
            return this.Problem(fromError!);
        if (!TryDay(registeredTo, "registeredTo", out var to, out var toError))
            return this.Problem(toError!);
        if (from is not null && to is not null && from > to)
            return this.Problem(Error.Validation("registeredFrom", "INVALID", "The start date must not be after the end date."));

        var filter = new UserListFilter(status, search, name, account, email, roleId, availability, from, to);
        return Ok(await users.ListAsync(filter, new PageRequest(page, pageSize), cancellationToken));
    }

    private static bool TryDay(string? text, string field, out DateOnly? day, out Error? error)
    {
        day = null;
        error = null;
        if (string.IsNullOrWhiteSpace(text))
            return true;
        if (DateOnly.TryParseExact(text.Trim(), "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var parsed))
        {
            day = parsed;
            return true;
        }

        error = Error.Validation(field, "INVALID", $"{field} must be a date such as 2026-10-16.");
        return false;
    }

    /// <summary>Counts of the three groups that never overlap: pending access, active (with access) and inactive. The pending count drives the Administration badge.</summary>
    [HttpGet("counts", Name = "GetUserCounts")]
    [RequirePermission(Permissions.User.View)]
    [ProducesResponseType<UserCountsDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<UserCountsDto>> Counts(CancellationToken cancellationToken) =>
        await users.CountsAsync(cancellationToken);

    /// <summary>Gets one user with roles and effective permissions.</summary>
    [HttpGet("{userId:int}", Name = "GetUser")]
    [RequirePermission(Permissions.User.View)]
    [ProducesResponseType<UserDetailDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(int userId, CancellationToken cancellationToken) =>
        this.ToActionResult(await users.GetAsync(userId, cancellationToken));

    /// <summary>Replaces the user's roles (grants new ones, revokes missing ones). Revoking System Admin from the last active admin returns 409 <c>LAST_ADMIN</c>.</summary>
    [HttpPut("{userId:int}/roles", Name = "SetUserRoles")]
    [RequirePermission(Permissions.User.Manage)]
    [ProducesResponseType<UserDetailDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> SetRoles(int userId, [FromBody] SetUserRolesRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await users.SetRolesAsync(userId, request.RoleIds, request.RowVersion, cancellationToken));

    /// <summary>Activates or deactivates a user. You cannot deactivate yourself or the last active System Admin.</summary>
    [HttpPut("{userId:int}/status", Name = "SetUserActive")]
    [RequirePermission(Permissions.User.Manage)]
    [ProducesResponseType<UserDetailDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> SetActive(int userId, [FromBody] SetUserActiveRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await users.SetActiveAsync(userId, request.IsActive, request.RowVersion, cancellationToken));

    /// <summary>Edits the display name and e-mail (used when the directory lookup is off).</summary>
    [HttpPut("{userId:int}", Name = "UpdateUserProfile")]
    [RequirePermission(Permissions.User.Manage)]
    [ProducesResponseType<UserDetailDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> UpdateProfile(int userId, [FromBody] UpdateUserProfileRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await users.UpdateProfileAsync(userId, request.DisplayName, request.Email, request.RowVersion, cancellationToken));
}
