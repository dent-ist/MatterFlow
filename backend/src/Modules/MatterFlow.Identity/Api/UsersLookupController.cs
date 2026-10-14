using System.ComponentModel.DataAnnotations;
using MatterFlow.Identity.Authorization;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Identity.Api;

/// <summary>One active user for an assignee typeahead: id and display name only.</summary>
/// <param name="UserId">User id.</param>
/// <param name="DisplayName">Display name.</param>
public sealed record UserLookupItem([property: Required] int UserId, [property: Required] string DisplayName);

/// <summary>
/// Lightweight user lookup for pickers (Create Task assignee). Unlike <c>GET /users</c> (User.View, administration data) it only exposes
/// id and display name of active users, to anyone who may assign Tasks.
/// </summary>
[ApiController]
[Route("api/v1/users/lookup")]
[Produces("application/json")]
public class UsersLookupController(DbContext db) : ControllerBase
{
    /// <summary>Finds active users by display name, ordered by name (at most <paramref name="limit"/>).</summary>
    /// <param name="q">Matches the display name.</param>
    /// <param name="limit">Maximum items (default 25, max 50).</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet(Name = "LookupUsers")]
    [RequirePermission(Permissions.Task.Assign)]
    [ProducesResponseType<UserLookupItem[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<UserLookupItem[]>> Lookup(
        [FromQuery, StringLength(100)] string? q,
        [FromQuery, Range(1, 50)] int limit = 25,
        CancellationToken cancellationToken = default)
    {
        var query = db.Set<AppUser>().AsNoTracking().Where(u => u.IsActive);
        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = q.Trim();
            query = query.Where(u => u.DisplayName.Contains(term));
        }

        return await query.OrderBy(u => u.DisplayName).Take(limit)
            .Select(u => new UserLookupItem(u.Id, u.DisplayName))
            .ToArrayAsync(cancellationToken);
    }
}
