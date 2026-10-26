using System.ComponentModel.DataAnnotations;
using System.Text.Json;

namespace MatterFlow.Identity.Views;

/// <summary>One stored view of the signed-in person: the remembered state of a surface (<c>name</c> null) or a named saved view.</summary>
/// <param name="Id">Row id (named views are changed and deleted by it).</param>
/// <param name="Surface">The screen section the state belongs to (for example <c>my-matters.attention</c>).</param>
/// <param name="Name">The view's name; null for the remembered state of the surface.</param>
/// <param name="IsDefault">True for the named view applied when the surface opens without an explicit address.</param>
/// <param name="State">The state: a JSON object the client defines (filters, sort, Focus, scope), opaque to the server, at most 4 KB.</param>
/// <param name="ModifiedAtUtc">When the row last changed.</param>
/// <param name="RowVersion">Send back when renaming or replacing a named view.</param>
public sealed record UserViewDto(
    [property: Required] long Id,
    [property: Required] string Surface,
    string? Name,
    [property: Required] bool IsDefault,
    [property: Required] JsonElement State,
    [property: Required] DateTime ModifiedAtUtc,
    [property: Required] string RowVersion);

/// <summary>The caller's stored views, remembered state first, named views by name.</summary>
public sealed record UserViewListResponse([property: Required] IReadOnlyList<UserViewDto> Items);

/// <summary>Replaces the remembered state of one surface (<c>PUT /me/views/{surface}</c>); creates the row on first use. Last write wins.</summary>
/// <param name="State">A JSON object of at most 4 KB.</param>
public sealed record SaveRememberedViewRequest([Required] JsonElement State);

/// <summary>Creates a named saved view (<c>POST /me/views</c>).</summary>
/// <param name="Surface">One of the known surfaces.</param>
/// <param name="Name">1 to 80 characters, unique per person and surface (case-insensitive).</param>
/// <param name="State">A JSON object of at most 4 KB.</param>
/// <param name="IsDefault">True makes it the surface's default (any other default of the surface is cleared).</param>
public sealed record CreateUserViewRequest(
    [Required, StringLength(40)] string Surface,
    [Required, StringLength(80)] string Name,
    [Required] JsonElement State,
    bool IsDefault = false);

/// <summary>Changes a named saved view (<c>PUT /me/views/{id}</c>): rename, replace the state, set or clear the default. Omitted fields stay.</summary>
/// <param name="Name">New name; omitted keeps the current one.</param>
/// <param name="State">New state; omitted keeps the current one.</param>
/// <param name="IsDefault">New default flag; omitted keeps the current one.</param>
/// <param name="RowVersion">The row version read with the view (409 <c>CONCURRENCY_CONFLICT</c> when it moved).</param>
public sealed record UpdateUserViewRequest(
    [StringLength(80)] string? Name,
    JsonElement? State,
    bool? IsDefault,
    [Required] string RowVersion);
