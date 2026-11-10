using LptHub.Identity.Authorization;
using LptHub.Identity.Contracts;
using LptHub.Identity.LandingPages;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace LptHub.Identity.Api;

/// <summary>
/// Landing pages (epic #1330, issue #1332): which page a person sees after sign-in. A role has an optional default page; a person may choose their own;
/// the fallback chain is the choice if the person can still open it, else the first role's default if openable, else nothing (the frontend applies its own rule).
/// The personal endpoints work for every signed-in person who is not Access Pending and only ever touch the caller's own record.
/// </summary>
[ApiController]
[Route("api/v1")]
[Produces("application/json")]
public class LandingPagesController(LandingPageService landing) : ControllerBase
{
    /// <summary>The pages the signed-in person can open now, in navigation order (the choices of the My Landing Page picker). Evaluated on the server from the effective permissions.</summary>
    [HttpGet("me/landing-pages", Name = "ListMyLandingPages")]
    [RequireAnyPermission]
    [ProducesResponseType<LandingPageListResponse>(StatusCodes.Status200OK, "application/json")]
    public ActionResult<LandingPageListResponse> ListMine() => Ok(landing.ListMine());

    /// <summary>
    /// Where the signed-in person lands: the stored choice (and whether it is still allowed), the first role and its default, and the page the chain resolved
    /// (<c>resolved</c> null = apply the frontend's own landing rule). A stored key that is not a page any more is treated as not set.
    /// </summary>
    [HttpGet("me/landing-page", Name = "GetMyLandingPage")]
    [RequireAnyPermission]
    [ProducesResponseType<MyLandingPageDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MyLandingPageDto>> GetMine(CancellationToken cancellationToken) => Ok(await landing.GetMineAsync(cancellationToken));

    /// <summary>
    /// Sets the signed-in person's choice, or clears it with a null <c>landingPage</c> ("Use my role's default"). 400 <c>VALIDATION_FAILED</c> with field code
    /// <c>UNKNOWN_PAGE</c> for a key that is not in the catalogue. A known page the person cannot open now is stored (kept in case access returns) and skipped by the chain.
    /// </summary>
    [HttpPut("me/landing-page", Name = "SetMyLandingPage")]
    [RequireAnyPermission]
    [ProducesResponseType<MyLandingPageDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> SetMine([FromBody] SetMyLandingPageRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await landing.SetMineAsync(request, cancellationToken));

    /// <summary>A role's default page and the pages that role can open with its saved permissions (the Role Setup dropdown). 404 for an unknown role.</summary>
    [HttpGet("roles/{roleId:int}/landing-page", Name = "GetRoleLandingPage")]
    [RequirePermission(RolesController.ReadAccess)]
    [ProducesResponseType<RoleLandingPageDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> GetRole(int roleId, CancellationToken cancellationToken) =>
        this.ToActionResult(await landing.GetRoleAsync(roleId, cancellationToken));

    /// <summary>
    /// Sets or clears a role's default page (null = Automatic). The change is audited. 400 <c>VALIDATION_FAILED</c> with field code <c>UNKNOWN_PAGE</c>, or
    /// <c>PAGE_NOT_OPENABLE</c> when the role's permissions do not let a person open that page ("This role can't open &lt;Page&gt;. Choose another landing page.");
    /// 404 unknown role; 409 <c>IMMUTABLE_FIELD</c> for the System Admin role; 409 <c>CONCURRENCY_CONFLICT</c> for a stale <c>rowVersion</c> (required).
    /// </summary>
    [HttpPut("roles/{roleId:int}/landing-page", Name = "SetRoleLandingPage")]
    [RequirePermission(Permissions.Role.Manage)]
    [ProducesResponseType<RoleLandingPageDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> SetRole(int roleId, [FromBody] SetRoleLandingPageRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await landing.SetRoleAsync(roleId, request, cancellationToken));
}
