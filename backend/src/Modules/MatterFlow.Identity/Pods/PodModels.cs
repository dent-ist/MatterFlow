using System.ComponentModel.DataAnnotations;

namespace MatterFlow.Identity.Pods;

/// <summary>A Pod in a list.</summary>
/// <param name="PodId">Pod id.</param>
/// <param name="Name">Unique name.</param>
/// <param name="Description">Optional description.</param>
/// <param name="IsActive">False once deactivated (Pods are never deleted).</param>
/// <param name="MemberCount">Number of members.</param>
/// <param name="RowVersion">Concurrency token (base64); send it back on update.</param>
public sealed record PodSummary(
    [property: Required] int PodId,
    [property: Required] string Name,
    string? Description,
    [property: Required] bool IsActive,
    [property: Required] int MemberCount,
    [property: Required] string RowVersion);

/// <summary>A Pod with its members.</summary>
/// <param name="Pod">The Pod.</param>
/// <param name="Members">Members by display name. Pod Lead is a role: each member carries the role names, not a lead flag.</param>
public sealed record PodDetail(
    [property: Required] PodSummary Pod,
    [property: Required] PodMemberDto[] Members);

/// <summary>A member of a Pod.</summary>
/// <param name="UserId">Application user id.</param>
/// <param name="DisplayName">Display name.</param>
/// <param name="Email">E-mail, if known; null for callers without <c>User.View</c> or <c>Pod.Manage</c>.</param>
/// <param name="IsActive">False for a disabled user.</param>
/// <param name="IsPrimary">True when this Pod is the user's primary Pod.</param>
/// <param name="Roles">Names of the user's active roles (read-only chips; a Pod Lead holds the Pod Lead role); empty for callers without <c>User.View</c> or <c>Pod.Manage</c>.</param>
public sealed record PodMemberDto(
    [property: Required] int UserId,
    [property: Required] string DisplayName,
    string? Email,
    [property: Required] bool IsActive,
    [property: Required] bool IsPrimary,
    [property: Required] string[] Roles);

/// <summary>One Pod a user belongs to.</summary>
/// <param name="PodId">Pod id.</param>
/// <param name="Name">Pod name.</param>
/// <param name="IsActive">False for a deactivated Pod (only returned on request).</param>
/// <param name="IsPrimary">True for the user's primary Pod.</param>
public sealed record UserPodDto(
    [property: Required] int PodId,
    [property: Required] string Name,
    [property: Required] bool IsActive,
    [property: Required] bool IsPrimary);

/// <summary>An active user who can be added to a Pod.</summary>
/// <param name="UserId">Application user id.</param>
/// <param name="DisplayName">Display name.</param>
/// <param name="Email">E-mail, if known.</param>
public sealed record PodMemberCandidate(
    [property: Required] int UserId,
    [property: Required] string DisplayName,
    string? Email);

/// <summary>Create a Pod.</summary>
public sealed record CreatePodRequest
{
    /// <summary>Unique name (required, max 100).</summary>
    [Required, StringLength(100)]
    public string Name { get; init; } = string.Empty;

    /// <summary>Optional description (max 500).</summary>
    [StringLength(500)]
    public string? Description { get; init; }
}

/// <summary>Edit a Pod, including deactivation and reactivation.</summary>
public sealed record UpdatePodRequest
{
    /// <summary>Unique name (required, max 100).</summary>
    [Required, StringLength(100)]
    public string Name { get; init; } = string.Empty;

    /// <summary>Optional description (max 500).</summary>
    [StringLength(500)]
    public string? Description { get; init; }

    /// <summary>False deactivates the Pod: it keeps its history and members but is unavailable for new assignment.</summary>
    [Required]
    public bool? IsActive { get; init; }

    /// <summary>The <c>rowVersion</c> last read; a mismatch is a 409 <c>CONCURRENCY_CONFLICT</c>.</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

/// <summary>Add users to a Pod. Users already in the Pod are ignored.</summary>
public sealed record AddPodMembersRequest
{
    /// <summary>Ids of active users to add (1 to 200).</summary>
    [Required, MinLength(1), MaxLength(200)]
    public int[] UserIds { get; init; } = [];
}

/// <summary>Set or clear a member's primary-Pod flag.</summary>
public sealed record SetPrimaryPodRequest
{
    /// <summary>True makes this the user's only primary Pod; false clears it.</summary>
    [Required]
    public bool? IsPrimary { get; init; }
}
