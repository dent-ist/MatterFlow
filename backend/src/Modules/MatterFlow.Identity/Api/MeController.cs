using System.ComponentModel.DataAnnotations;
using MatterFlow.Identity.Access;
using MatterFlow.Identity.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Identity.Api;

/// <summary>The signed-in user's own profile. The only endpoint an Access Pending user may call (architecture 6.5).</summary>
[ApiController]
[Route("api/v1/me")]
[Produces("application/json")]
[AllowAuthenticated]
public class MeController(CurrentUser currentUser) : ControllerBase
{
    /// <summary>Returns the caller's profile, roles and effective permissions. Pending users get <c>status = ACCESS_PENDING</c> with no roles or permissions.</summary>
    [HttpGet(Name = "GetMe")]
    [ProducesResponseType<MeResponse>(StatusCodes.Status200OK, "application/json")]
    public ActionResult<MeResponse> Get()
    {
        // The authorization handler resolved the caller before we run; a missing snapshot would have been a 401/403.
        var me = currentUser.Snapshot!;
        var permissions = me.IsPending ? [] : me.Permissions.Order(StringComparer.Ordinal).ToArray();
        return new MeResponse(
            me.UserId,
            me.DisplayName,
            me.IsPending ? MeStatuses.AccessPending : MeStatuses.Active,
            me.IsPending,
            me.WindowsAccount,
            me.Email,
            me.RegisteredAtUtc,
            me.IsPending ? [] : me.Roles.ToArray(),
            permissions,
            me.IsSystemAdmin);
    }
}

/// <summary>Values of <see cref="MeResponse.Status"/>.</summary>
public static class MeStatuses
{
    public const string Active = "ACTIVE";
    public const string AccessPending = "ACCESS_PENDING";
}

/// <summary>Response of <c>GET /api/v1/me</c>.</summary>
/// <param name="UserId">Application user id (AppUser.UserId).</param>
/// <param name="DisplayName">Name shown in the UI; <c>DOMAIN\sam</c> until an admin or the directory lookup supplies a better one.</param>
/// <param name="Status"><c>ACTIVE</c> or <c>ACCESS_PENDING</c> (no effective permissions). Disabled users receive 403 <c>ACCOUNT_DISABLED</c> instead.</param>
/// <param name="IsPending">True when <paramref name="Status"/> is <c>ACCESS_PENDING</c>.</param>
/// <param name="WindowsAccount">The signed-in account, for example <c>KE\kekim</c>.</param>
/// <param name="Email">E-mail from the directory or an admin, if known.</param>
/// <param name="RegisteredAtUtc">When the user was first provisioned (UTC).</param>
/// <param name="Roles">Names of the user's active roles.</param>
/// <param name="Permissions">Effective permission codes (union of the roles; the full catalog for System Admin).</param>
/// <param name="IsSystemAdmin">True when the user holds the built-in System Admin role.</param>
public sealed record MeResponse(
    [property: Required] int UserId,
    [property: Required] string DisplayName,
    [property: Required] string Status,
    [property: Required] bool IsPending,
    string? WindowsAccount,
    string? Email,
    DateTime RegisteredAtUtc,
    [property: Required] string[] Roles,
    [property: Required] string[] Permissions,
    [property: Required] bool IsSystemAdmin);
