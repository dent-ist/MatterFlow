namespace LptHub.SharedKernel.Visibility;

/// <summary>
/// Whose eyes a read is for (sensitive-matter rule, docs/ux/sensitive-matters/README.md section 4). <see cref="UserId"/> is null for a system or
/// background operation without a person; such a viewer sees non-sensitive matters only and is never "see all". <see cref="SeeAll"/> is true for the
/// System Admin and for holders of <c>Matter.ViewSensitive</c>. <see cref="IsSystemAdmin"/> is true for the System Admin only: the Task Type access rule (epic #1397) is lifted
/// by it and by nothing else (<c>Matter.ViewSensitive</c> does not lift it).
/// </summary>
public readonly record struct Viewer(int? UserId, bool SeeAll, bool IsSystemAdmin = false)
{
    /// <summary>No person and no see-all: only non-sensitive matters.</summary>
    public static Viewer Nobody => new(null, false);
}
