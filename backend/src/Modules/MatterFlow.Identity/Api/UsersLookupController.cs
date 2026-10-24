using System.ComponentModel.DataAnnotations;
using MatterFlow.Identity.Authorization;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using MatterFlow.SharedKernel.Availability;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Time;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Identity.Api;

/// <summary>One active user for an assignee picker: id, display name, availability and Task load.</summary>
/// <param name="UserId">User id.</param>
/// <param name="DisplayName">Display name.</param>
/// <param name="Availability">Compact availability right now (state, out until, note) so pickers can mark who is out of office.</param>
/// <param name="OpenTaskCount">Open Tasks (New, In Progress, On Hold) assigned to the person.</param>
/// <param name="LastAssignedUtc">When a Task was last assigned to the person; null when never.</param>
/// <param name="Suggested">True when the ranking offers the person as a suggestion (available, and within the suggestion limit when <c>suggest=true</c>).</param>
/// <param name="Reason">Why the person ranks where they do, as a short sentence.</param>
public sealed record UserLookupItem(
    [property: Required] int UserId,
    [property: Required] string DisplayName,
    [property: Required] UserAvailabilitySummary Availability,
    [property: Required] int OpenTaskCount,
    DateTime? LastAssignedUtc,
    [property: Required] bool Suggested,
    [property: Required] string Reason);

/// <summary>
/// User lookup for assignee pickers (inline grid picker, Edit task, Create task). Unlike <c>GET /users</c> (User.View, administration data) it only
/// exposes the name, availability and Task load of active users that hold a role, to anyone who may assign Tasks. The order of Pod members and of
/// suggestions comes from the one <see cref="IAssigneeRanker"/>; the clients do not rank (#757).
/// </summary>
[ApiController]
[Route("api/v1/users/lookup")]
[Produces("application/json")]
public class UsersLookupController(DbContext db, IUserAvailabilityReader availability, IAssigneeLoadReader loads, IAssigneeRanker ranker, IClock clock) : ControllerBase
{
    /// <summary>
    /// Finds active users that hold a role. Plain (default): matches by name, ordered by name. With <paramref name="podId"/>: only that Pod's members,
    /// ranked. With <paramref name="suggest"/>: only people who are not out of office, ranked, at most <paramref name="limit"/>.
    /// </summary>
    /// <param name="q">Matches the display name.</param>
    /// <param name="limit">Maximum items (default 25, max 50).</param>
    /// <param name="podId">Narrow to the active members of this Pod and rank them (fewest open Tasks, least recently assigned, name).</param>
    /// <param name="taskTypeId">The Task Type being assigned; passed to the ranking, which may use it.</param>
    /// <param name="suggest">Return the ranked Suggested list: out of office people are left out.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet(Name = "LookupUsers")]
    [RequirePermission(Permissions.Task.Assign)]
    [ProducesResponseType<UserLookupItem[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<UserLookupItem[]>> Lookup(
        [FromQuery, StringLength(100)] string? q,
        [FromQuery, Range(1, 50)] int limit = 25,
        [FromQuery] int? podId = null,
        [FromQuery] int? taskTypeId = null,
        [FromQuery] bool suggest = false,
        CancellationToken cancellationToken = default)
    {
        var now = clock.UtcNow;
        // Access Pending users (active, no role) cannot open Tasks, so they are not offered as assignees (SEC2-14).
        var query = db.Set<AppUser>().AsNoTracking().Where(u => u.IsActive && db.Set<UserRole>().Any(r => r.UserId == u.Id));
        if (podId is { } pod)
            query = query.Where(u => db.Set<PodMember>().Any(m => m.PodId == pod && m.UserId == u.Id));
        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = q.Trim();
            query = query.Where(u => u.DisplayName.Contains(term));
        }

        var ranked = podId is not null || suggest;
        var rows = await (ranked ? query.OrderBy(u => u.DisplayName) : query.OrderBy(u => u.DisplayName).Take(limit))
            .Select(u => new { u.Id, u.DisplayName })
            .ToArrayAsync(cancellationToken);
        var ids = rows.Select(r => r.Id).ToArray();
        var states = await availability.EvaluateAsync(ids, now, cancellationToken);
        var load = await loads.ReadAsync(ids, cancellationToken);

        var candidates = rows.Select(r =>
        {
            var l = load.GetValueOrDefault(r.Id);
            var state = states[r.Id];
            return new AssigneeCandidate(r.Id, r.DisplayName, l?.OpenTaskCount ?? 0, l?.LastAssignedUtc, state.State != AvailabilityStates.OutOfOffice, state.OutUntilUtc,
                l?.Visible is { } shown ? new AssigneeCandidateDisplay(shown.OpenTaskCount, shown.LastAssignedUtc) : null);
        }).ToArray();

        if (!ranked)
        {
            return candidates.Select(c => Item(c, states[c.UserId], suggested: false, reason: string.Empty)).ToArray();
        }

        var order = ranker.Rank(new AssigneeRankingRequest(candidates, podId, taskTypeId, now));
        if (suggest)
            order = order.Where(r => r.Suggestable).ToArray();
        return order.Take(limit)
            .Select(r => Item(r.Candidate, states[r.Candidate.UserId], r.Suggestable && suggest, r.Reason))
            .ToArray();
    }

    private static UserLookupItem Item(AssigneeCandidate c, AvailabilityEvaluation state, bool suggested, string reason) =>
        new(c.UserId, c.DisplayName, UserAvailabilitySummary.From(state), c.ShownOpenTaskCount, c.ShownLastAssignedUtc, suggested, reason);
}
