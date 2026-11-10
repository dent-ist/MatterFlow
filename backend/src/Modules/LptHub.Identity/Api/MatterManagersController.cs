using System.ComponentModel.DataAnnotations;
using MatterFlow.Identity.Application;
using MatterFlow.Identity.Authorization;
using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Time;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Identity.Api;

/// <summary>One person who can be named a matter's project manager.</summary>
/// <param name="UserId">User id.</param>
/// <param name="DisplayName">Display name.</param>
/// <param name="Availability">Compact availability right now, so pickers can mark who is out of office. Informational: an away person can still be chosen.</param>
public sealed record MatterManagerItem([property: Required] int UserId, [property: Required] string DisplayName, [property: Required] UserAvailabilitySummary Availability);

/// <summary>Source of the project manager pickers (matter header dialog, bulk dialog) and of the Matters list's project manager column filters.</summary>
[ApiController]
[Route("api/v1/users/matter-managers")]
[Produces("application/json")]
public class MatterManagersController(MatterManagerEligibility eligibility, IUserAvailabilityReader availability, IClock clock) : ControllerBase
{
    /// <summary>
    /// Finds the active users who hold <c>Matter.BeManager</c>, ordered by display name. Needs <c>Matter.View</c> (everyone who can see a matter
    /// can see who manages it, so the column filter can offer the same people).
    /// </summary>
    /// <param name="q">Matches the display name.</param>
    /// <param name="take">Maximum items (default 25, max 50).</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet(Name = "LookupMatterManagers")]
    [RequirePermission(Permissions.Matter.View)]
    [ProducesResponseType<MatterManagerItem[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MatterManagerItem[]>> Lookup(
        [FromQuery, StringLength(100)] string? q,
        [FromQuery, Range(1, 50)] int take = 25,
        CancellationToken cancellationToken = default)
    {
        var query = eligibility.Eligible();
        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = q.Trim();
            query = query.Where(u => u.DisplayName.Contains(term));
        }

        var rows = await query.OrderBy(u => u.DisplayName).ThenBy(u => u.Id).Take(take)
            .Select(u => new { u.Id, u.DisplayName })
            .ToArrayAsync(cancellationToken);
        var states = await availability.EvaluateAsync(rows.Select(r => r.Id).ToArray(), clock.UtcNow, cancellationToken);
        return rows.Select(r => new MatterManagerItem(r.Id, r.DisplayName, UserAvailabilitySummary.From(states[r.Id]))).ToArray();
    }
}
