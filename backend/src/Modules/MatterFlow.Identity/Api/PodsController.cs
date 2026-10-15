using System.ComponentModel.DataAnnotations;
using MatterFlow.Identity.Access;
using MatterFlow.Identity.Authorization;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Pods;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Identity.Api;

/// <summary>
/// Pods and membership (UX S13). Pods are deactivated, never deleted. Pod Lead is a role, so there is no lead flag, and membership
/// never restricts Task assignment. Changes are audited field by field in the same transaction.
/// </summary>
[ApiController]
[Route("api/v1/pods")]
[Produces("application/json")]
public class PodsController(PodService pods, CurrentUser currentUser) : ControllerBase
{
    private const string Sorts = "name, -name, memberCount, -memberCount";

    /// <summary>Lists Pods by name, optionally filtered by a search term and active state.</summary>
    /// <param name="q">Matches the name or description.</param>
    /// <param name="active">Only active (true) or only inactive (false) Pods; omit for both.</param>
    /// <param name="page">1-based page number.</param>
    /// <param name="pageSize">Items per page (default 25, max 100).</param>
    /// <param name="sort">One of <c>name</c> (default), <c>-name</c>, <c>memberCount</c>, <c>-memberCount</c>.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet(Name = "ListPods")]
    [RequirePermission(Permissions.Pod.View)]
    [ProducesResponseType<PagedResult<PodSummary>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List(
        [FromQuery, StringLength(100)] string? q,
        [FromQuery] bool? active,
        [FromQuery, Range(1, int.MaxValue)] int page = PageRequest.FirstPage,
        [FromQuery, Range(1, PageRequest.MaxPageSize)] int pageSize = PageRequest.DefaultPageSize,
        [FromQuery, StringLength(30)] string? sort = null,
        CancellationToken cancellationToken = default)
    {
        if (sort is not null && !Sorts.Split(", ").Contains(sort))
            return PodResults.Failure(Error.Validation("sort", "INVALID", $"sort must be one of: {Sorts}."));

        return Ok(await pods.ListAsync(q, active, sort, new PageRequest(page, pageSize), cancellationToken));
    }

    /// <summary>Gets a Pod with its members and their roles.</summary>
    /// <param name="podId">Pod id.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet("{podId:int}", Name = "GetPod")]
    [RequirePermission(Permissions.Pod.View)]
    [ProducesResponseType<PodDetail>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(int podId, CancellationToken cancellationToken) =>
        PodResults.From(await pods.GetAsync(podId, cancellationToken));

    /// <summary>Creates a Pod. The name must be unique.</summary>
    /// <param name="request">Name and description.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPost(Name = "CreatePod")]
    [RequirePermission(Permissions.Pod.Manage)]
    [ProducesResponseType<PodDetail>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create([FromBody] CreatePodRequest request, CancellationToken cancellationToken)
    {
        var result = await pods.CreateAsync(request.Name, request.Description, cancellationToken);
        return PodResults.From(result, detail => CreatedAtAction(nameof(Get), new { podId = detail.Pod.PodId }, detail));
    }

    /// <summary>Edits a Pod, including deactivating or reactivating it. A deactivated Pod keeps its history and members.</summary>
    /// <param name="podId">Pod id.</param>
    /// <param name="request">New values and the row version last read.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPut("{podId:int}", Name = "UpdatePod")]
    [RequirePermission(Permissions.Pod.Manage)]
    [ProducesResponseType<PodDetail>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(int podId, [FromBody] UpdatePodRequest request, CancellationToken cancellationToken) =>
        PodResults.From(await pods.UpdateAsync(podId, request.Name, request.Description, request.IsActive!.Value, request.RowVersion, cancellationToken));

    /// <summary>Adds users to an active Pod. Users already in the Pod are ignored.</summary>
    /// <param name="podId">Pod id.</param>
    /// <param name="request">Ids of the users to add.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPost("{podId:int}/members", Name = "AddPodMembers")]
    [RequirePermission(Permissions.Pod.ManageMembers)]
    [ProducesResponseType<PodDetail>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> AddMembers(int podId, [FromBody] AddPodMembersRequest request, CancellationToken cancellationToken) =>
        PodResults.From(await pods.AddMembersAsync(podId, request.UserIds, cancellationToken));

    /// <summary>Removes a user from a Pod. Removing someone who is not a member succeeds.</summary>
    /// <param name="podId">Pod id.</param>
    /// <param name="userId">User id.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpDelete("{podId:int}/members/{userId:int}", Name = "RemovePodMember")]
    [RequirePermission(Permissions.Pod.ManageMembers)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> RemoveMember(int podId, int userId, CancellationToken cancellationToken) =>
        PodResults.From(await pods.RemoveMemberAsync(podId, userId, cancellationToken));

    /// <summary>Makes a Pod the member's primary Pod (clearing any other), or clears it. A user has at most one primary Pod.</summary>
    /// <param name="podId">Pod id.</param>
    /// <param name="userId">User id; must already be a member.</param>
    /// <param name="request">Whether this Pod is the primary one.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPut("{podId:int}/members/{userId:int}", Name = "SetPrimaryPod")]
    [RequirePermission(Permissions.Pod.ManageMembers)]
    [ProducesResponseType<PodDetail>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> SetPrimary(int podId, int userId, [FromBody] SetPrimaryPodRequest request, CancellationToken cancellationToken) =>
        PodResults.From(await pods.SetPrimaryAsync(podId, userId, request.IsPrimary!.Value, cancellationToken));

    /// <summary>Lists active users that can be added to Pods (typeahead source), by display name.</summary>
    /// <param name="q">Matches display name or e-mail.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet("member-candidates", Name = "FindPodMemberCandidates")]
    [RequirePermission(Permissions.Pod.ManageMembers)]
    [ProducesResponseType<PodMemberCandidate[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> FindCandidates([FromQuery, StringLength(100)] string? q, CancellationToken cancellationToken) =>
        Ok((await pods.FindCandidatesAsync(q, cancellationToken)).ToArray());

    /// <summary>Lists the Pods a user belongs to (used by My Work and Pod Work), by Pod name.</summary>
    /// <param name="userId">User id.</param>
    /// <param name="includeInactive">Also return deactivated Pods.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet("~/api/v1/users/{userId:int}/pods", Name = "ListUserPods")]
    [RequirePermission(Permissions.Pod.View)]
    [ProducesResponseType<UserPodDto[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> ListUserPods(int userId, [FromQuery] bool includeInactive = false, CancellationToken cancellationToken = default) =>
        PodResults.From(await pods.GetUserPodsAsync(userId, includeInactive, cancellationToken), r => Ok(r.ToArray()));

    /// <summary>
    /// Replaces the Pods a user belongs to and the primary Pod in one transaction (the inline editor of the Users grid). Pods the user is
    /// already in may be inactive and stay; only active Pods can be newly assigned or made primary. One primary at most. Returns all of the
    /// user's Pods (including inactive ones).
    /// </summary>
    /// <param name="userId">User id.</param>
    /// <param name="request">The Pods the user should belong to, the primary one, and optionally the state last read (409 when it changed).</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPut("~/api/v1/users/{userId:int}/pods", Name = "SetUserPods")]
    [RequirePermission(Permissions.Pod.ManageMembers)]
    [ProducesResponseType<UserPodDto[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> SetUserPods(int userId, [FromBody] SetUserPodsRequest request, CancellationToken cancellationToken) =>
        PodResults.From(
            await pods.SetUserPodsAsync(userId, request.PodIds, request.PrimaryPodId, request.ExpectedPodIds, request.ExpectedPrimaryPodId, cancellationToken),
            r => Ok(r.ToArray()));

    /// <summary>Lists the signed-in user's own Pods (active only), primary Pod flagged.</summary>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet("~/api/v1/me/pods", Name = "ListMyPods")]
    [RequirePermission(Permissions.Pod.View)]
    [ProducesResponseType<UserPodDto[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> ListMyPods(CancellationToken cancellationToken) =>
        PodResults.From(await pods.GetUserPodsAsync(currentUser.UserId!.Value, false, cancellationToken), r => Ok(r.ToArray()));
}
