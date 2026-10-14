using System.ComponentModel.DataAnnotations;
using MatterFlow.Identity.Application;
using MatterFlow.Identity.Authorization;
using MatterFlow.Identity.Contracts;
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
    /// <summary>Lists users, pending access first, with search and paging.</summary>
    /// <param name="status"><c>all</c> (default), <c>pending</c>, <c>active</c> or <c>inactive</c>.</param>
    /// <param name="search">Matches display name, e-mail or Windows account.</param>
    /// <param name="page">1-based page.</param>
    /// <param name="pageSize">Items per page (default 25, max 100).</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet(Name = "ListUsers")]
    [RequirePermission(Permissions.User.View)]
    [ProducesResponseType<PagedResult<UserSummaryDto>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List(
        [FromQuery] string? status,
        [FromQuery, StringLength(200)] string? search,
        [FromQuery, Range(1, int.MaxValue)] int page = PageRequest.FirstPage,
        [FromQuery, Range(1, PageRequest.MaxPageSize)] int pageSize = PageRequest.DefaultPageSize,
        CancellationToken cancellationToken = default)
    {
        if (!UserListStatuses.IsValid(status))
            return this.Problem(Error.Validation("status", "INVALID", "status must be all, pending, active or inactive."));

        return Ok(await users.ListAsync(status, search, new PageRequest(page, pageSize), cancellationToken));
    }

    /// <summary>Tab counts (pending, active, inactive); the pending count drives the Administration badge.</summary>
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
