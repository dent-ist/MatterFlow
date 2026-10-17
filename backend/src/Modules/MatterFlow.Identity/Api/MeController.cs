using System.ComponentModel.DataAnnotations;
using MatterFlow.Identity.Access;
using MatterFlow.Identity.Authorization;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Identity.Api;

/// <summary>The signed-in user's own profile. The only endpoint an Access Pending user may call (architecture 6.5).</summary>
[ApiController]
[Route("api/v1/me")]
[Produces("application/json")]
[AllowAuthenticated]
public class MeController(CurrentUser currentUser, DbContext db, IEnumerable<IUserWorkSource> workSources) : ControllerBase
{
    /// <summary>Returns the caller's profile, roles and effective permissions. Pending users get <c>status = ACCESS_PENDING</c> with no roles or permissions.</summary>
    [HttpGet(Name = "GetMe")]
    [ProducesResponseType<MeResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MeResponse>> Get(CancellationToken cancellationToken)
    {
        // The authorization handler resolved the caller before we run; a missing snapshot would have been a 401/403.
        var me = currentUser.Snapshot!;
        var permissions = me.IsPending ? [] : me.Permissions.Order(StringComparer.Ordinal).ToArray();
        var hasWork = !me.IsPending && await HasWorkAsync(me.UserId, cancellationToken);
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
            me.IsSystemAdmin,
            hasWork);
    }

    /// <summary>
    /// Active Pod member, or at least one open Task assigned. Tasks created by the user alone do not count (PM decision, #142).
    /// Two EXISTS probes on indexed columns (PodMember key, IX_Task_AssignedUser).
    /// </summary>
    private async Task<bool> HasWorkAsync(int userId, CancellationToken cancellationToken)
    {
        if (await db.Set<PodMember>().AsNoTracking().AnyAsync(m => m.UserId == userId && m.Pod.IsActive, cancellationToken))
            return true;
        foreach (var source in workSources)
        {
            if (await source.HasOpenAssignedWorkAsync(userId, cancellationToken))
                return true;
        }

        return false;
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
/// <param name="HasWork">True when the user is an active member of at least one Pod or has an open Task assigned (drives the default landing page, My Work). Tasks created by the user alone do not count. Always false for Access Pending users.</param>
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
    [property: Required] bool IsSystemAdmin,
    [property: Required] bool HasWork);
