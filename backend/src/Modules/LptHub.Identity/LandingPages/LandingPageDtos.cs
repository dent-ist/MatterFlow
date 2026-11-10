using System.ComponentModel.DataAnnotations;

namespace LptHub.Identity.LandingPages;

/// <summary>One page of the catalogue: the stable key the API stores and returns, its name as the navigation shows it and its address.</summary>
public sealed record LandingPageDto([property: Required] string Key, [property: Required] string Label, [property: Required] string Path);

/// <summary>The pages the signed-in person can open now (<c>GET /me/landing-pages</c>), in navigation order.</summary>
public sealed record LandingPageListResponse([property: Required] LandingPageDto[] Pages);

/// <summary>
/// Where the signed-in person lands, and why (<c>GET</c> and <c>PUT /me/landing-page</c>).
/// </summary>
/// <param name="Choice">The person's own stored choice (a key of the catalogue), or null for "Use my role's default". Kept even when the person cannot open the page now.</param>
/// <param name="ChoiceAllowed">False when <paramref name="Choice"/> is set but the person cannot open that page now (the My Profile banner); true otherwise.</param>
/// <param name="RoleName">The first role in the person's role list (alphabetical), the one that decides the role default; null for a person with no active role.</param>
/// <param name="RoleDefault">The default page of that first role (a key), or null when it has none ("Automatic") or the stored key is not a page any more.</param>
/// <param name="RoleDefaultAllowed">False when <paramref name="RoleDefault"/> is set but the person cannot open that page now.</param>
/// <param name="Resolved">The key the chain picked: the choice if openable, else the first role's default if openable, else null (the frontend then applies its own landing rule).</param>
/// <param name="ResolvedPath">The address of <paramref name="Resolved"/>, or null.</param>
/// <param name="Source"><c>CHOICE</c>, <c>ROLE_DEFAULT</c> or null.</param>
public sealed record MyLandingPageDto(
    string? Choice,
    [property: Required] bool ChoiceAllowed,
    string? RoleName,
    string? RoleDefault,
    [property: Required] bool RoleDefaultAllowed,
    string? Resolved,
    string? ResolvedPath,
    string? Source);

/// <summary>Sets or clears the signed-in person's choice: a key of the catalogue, or null/absent for "Use my role's default".</summary>
public sealed record SetMyLandingPageRequest([StringLength(40)] string? LandingPage);

/// <summary>A role's landing page and the pages that role can open with its saved permissions (the Role Setup dropdown).</summary>
/// <param name="LandingPage">The role's default page (a key), or null for "Automatic" (the application's own landing rule).</param>
/// <param name="Pages">The pages a person holding only this role could open, in navigation order.</param>
/// <param name="RowVersion">The role's row version after the change, to send with the next role edit.</param>
public sealed record RoleLandingPageDto(
    [property: Required] int RoleId,
    string? LandingPage,
    [property: Required] LandingPageDto[] Pages,
    [Required] string RowVersion);

/// <summary>Sets or clears a role's default page (null = Automatic). The role's row version is mandatory like on every role edit; a stale one is 409 <c>CONCURRENCY_CONFLICT</c>.</summary>
public sealed record SetRoleLandingPageRequest([StringLength(40)] string? LandingPage, [Required] string RowVersion);
