using MatterFlow.SharedKernel.Audit;
using MatterFlow.SharedKernel.Entities;

namespace MatterFlow.Identity.Domain;

/// <summary>
/// A working group of users. Pods are deactivated, never deleted. There is no lead flag: Pod Lead is a role (addendum E), and
/// membership never restricts Task assignment.
/// </summary>
[Audited]
public class Pod : AuditedEntity<int>
{
    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }

    public bool IsActive { get; set; } = true;

    public List<PodMember> Members { get; set; } = [];
}

/// <summary>A user's membership of a Pod. A user can be in many Pods; at most one membership is the user's primary Pod.</summary>
[Audited]
public class PodMember
{
    public int PodId { get; set; }

    public Pod Pod { get; set; } = null!;

    public int UserId { get; set; }

    public AppUser User { get; set; } = null!;

    /// <summary>Audited by explicit, readable events written by <c>PodService</c> ("Set Processing Pod as the primary pod of ...").</summary>
    [AuditExplicit]
    public bool IsPrimary { get; set; }
}
