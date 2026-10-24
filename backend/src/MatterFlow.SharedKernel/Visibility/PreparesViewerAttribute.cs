namespace MatterFlow.SharedKernel.Visibility;

/// <summary>
/// Marks a controller or action that reads whole sets of tasks under the sensitive-matter rule (queue, My Work, dashboard, search): before it runs, the request loads the short
/// id lists the rule needs (the sensitive matters the caller manages), so the rule becomes tests on the task's own columns instead of a subquery (issue #810). Leaving the mark
/// off never changes an answer, it only costs the slower subquery form.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = false, Inherited = true)]
public sealed class PreparesViewerAttribute : Attribute
{
    /// <summary>True for an endpoint that keys a cache by <see cref="IMatterVisibility.AccessStampAsync"/>: the same statement then also yields the stamp, so the request makes one round trip, not two.</summary>
    public bool Stamp { get; init; }
}
