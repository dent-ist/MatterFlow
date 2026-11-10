using System.ComponentModel.DataAnnotations;
using LptHub.Identity.Application;
using LptHub.Identity.Authorization;
using LptHub.Identity.Contracts;
using LptHub.Identity.Domain;
using LptHub.SharedKernel.Availability;
using LptHub.SharedKernel.Tasks;
using LptHub.SharedKernel.Time;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Identity.Api;

/// <summary>One active user for an assignee picker: id, display name, availability and Task load.</summary>
/// <param name="UserId">User id.</param>
/// <param name="DisplayName">Display name.</param>
/// <param name="Availability">Compact availability right now (state, out until, note) so pickers can mark who is out of office.</param>
/// <param name="OpenTaskCount">Open Tasks (New, In Progress, On Hold) assigned to the person.</param>
/// <param name="LastAssignedUtc">When a Task was last assigned to the person; null when never.</param>
/// <param name="Suggested">True when the ranking offers the person as a suggestion (available, and within the suggestion limit when <c>suggest=true</c>).</param>
/// <param name="Reason">Why the person ranks where they do, as a short sentence.</param>
/// <param name="CapacityState"><c>AVAILABLE</c>, <c>OCCUPIED</c>, <c>BUSY</c>, <c>OVERLOADED</c>, <c>OUT_OF_OFFICE</c> or <c>OFF_HOURS</c>: the Dashboard capacity state, from the load and the availability by the one shared rule.</param>
/// <param name="Load">Open Tasks that are New or In progress (On hold does not count): the number the capacity state is built from. A bare integer, the true count whatever the sensitive-matter rule (decision AS item 12).</param>
public sealed record UserLookupItem(
    [property: Required] int UserId,
    [property: Required] string DisplayName,
    [property: Required] UserAvailabilitySummary Availability,
    [property: Required] int OpenTaskCount,
    DateTime? LastAssignedUtc,
    [property: Required] bool Suggested,
    [property: Required] string Reason,
    [property: Required] string CapacityState,
    [property: Required] int Load);

/// <summary>
/// User lookup for assignee pickers (inline grid picker, Edit task, Create task). Unlike <c>GET /users</c> (User.View, administration data) it only
/// exposes the name, availability and Task load of active users that hold a role, to anyone who may assign Tasks. The order of Pod members and of
/// suggestions comes from the one <see cref="IAssigneeRanker"/>; the clients do not rank (#757).
/// </summary>
[ApiController]
[Route("api/v1/users/lookup")]
[Produces("application/json")]
public class UsersLookupController(DbContext db, IUserAvailabilityReader availability, IAssigneeLoadReader loads, IAssigneeExperienceReader experience, IAssigneeRanker ranker, IClock clock) : ControllerBase
{
    /// <summary>
    /// Finds active users that hold a role. Plain (default): matches by name, ordered by name. With <paramref name="podId"/>: only that Pod's members,
    /// ranked. With <paramref name="suggest"/>: only people who are not out of office, ranked, at most <paramref name="limit"/>. With <paramref name="assignable"/>
    /// (the assignee pickers): only people who can be assigned Tasks, that is hold <c>Workflow.Execute</c> and are not out of office, in every mode.
    /// </summary>
    /// <param name="q">Matches the display name.</param>
    /// <param name="limit">Maximum items (default 25, max 50).</param>
    /// <param name="podId">Narrow to the active members of this Pod and rank them (least load, fewest completed Tasks of the type in 3 months, longest since last assigned, name, id).</param>
    /// <param name="taskTypeId">The Task Type being assigned; the ranking counts the Tasks of this type each person completed in the last 3 months. Without it that step is skipped.</param>
    /// <param name="suggest">Return the ranked Suggested list: out of office people are left out.</param>
    /// <param name="assignable">For assignee pickers: only people who hold <c>Workflow.Execute</c>, and nobody who is out of office (also in a Pod list and in a name search).</param>
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
        [FromQuery] bool assignable = false,
        CancellationToken cancellationToken = default)
    {
        var now = clock.UtcNow;
        // Access Pending users (active, no role) cannot open Tasks, so they are not offered as assignees (SEC2-14).
        var query = db.Set<AppUser>().AsNoTracking().Where(u => u.IsActive && db.Set<UserRole>().Any(r => r.UserId == u.Id));
        if (assignable)
            query = query.WhereHoldsExecute();
        if (podId is { } pod)
            query = query.Where(u => db.Set<PodMember>().Any(m => m.PodId == pod && m.UserId == u.Id));
        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = q.Trim();
            query = query.Where(u => u.DisplayName.Contains(term));
        }

        var ranked = podId is not null || suggest;
        // Out of office people are only known after the availability check, so an assignable name search takes the limit after leaving them out.
        var rows = await (ranked || assignable ? query.OrderBy(u => u.DisplayName) : query.OrderBy(u => u.DisplayName).Take(limit))
            .Select(u => new { u.Id, u.DisplayName })
            .ToArrayAsync(cancellationToken);
        var states = await availability.EvaluateAsync(rows.Select(r => r.Id).ToArray(), now, cancellationToken);
        if (assignable)
            rows = rows.Where(r => states[r.Id].State != AvailabilityStates.OutOfOffice).ToArray();
        var ids = rows.Select(r => r.Id).ToArray();
        var load = await loads.ReadAsync(ids, cancellationToken);
        // Experience (completed Tasks of the type in the last 3 months) only matters to the ranking, and only when the Task has a type.
        IReadOnlyDictionary<int, AssigneeExperience> done = ranked && taskTypeId is { } type
            ? await experience.ReadAsync(ids, type, now.AddMonths(-LoadBalancedAssigneeRanker.ExperienceMonths), cancellationToken)
            : new Dictionary<int, AssigneeExperience>();

        var candidates = rows.Select(r =>
        {
            var l = load.GetValueOrDefault(r.Id);
            var x = done.GetValueOrDefault(r.Id);
            var state = states[r.Id];
            // The display facts are the viewer's view only when the sensitive-matter rule is on (the load reader says so); the experience then carries its own visible count.
            var display = l?.Visible is { } shown ? new AssigneeCandidateDisplay(shown.OpenTaskCount, shown.ActiveCount, shown.LastAssignedUtc, x?.Visible ?? 0) : null;
            return new AssigneeCandidate(r.Id, r.DisplayName, l?.OpenTaskCount ?? 0, l?.ActiveCount ?? 0, x?.Completed ?? 0, l?.LastAssignedUtc, state.State != AvailabilityStates.OutOfOffice, state.OutUntilUtc, display);
        }).ToArray();

        if (!ranked)
        {
            return candidates.Take(limit).Select(c => Item(c, states[c.UserId], suggested: false, reason: string.Empty, load)).ToArray();
        }

        var order = ranker.Rank(new AssigneeRankingRequest(candidates, podId, taskTypeId, now));
        if (suggest)
            order = order.Where(r => r.Suggestable).ToArray();
        return order.Take(limit)
            .Select(r => Item(r.Candidate, states[r.Candidate.UserId], r.Suggestable && suggest, r.Reason, load))
            .ToArray();
    }

    private static UserLookupItem Item(AssigneeCandidate c, AvailabilityEvaluation state, bool suggested, string reason, IReadOnlyDictionary<int, AssigneeLoad> loads)
    {
        var active = loads.TryGetValue(c.UserId, out var l) ? l.ActiveCount : 0;
        return new(c.UserId, c.DisplayName, UserAvailabilitySummary.From(state), c.ShownOpenTaskCount, c.ShownLastAssignedUtc, suggested, reason, CapacityRules.State(active, state.State), active);
    }
}
