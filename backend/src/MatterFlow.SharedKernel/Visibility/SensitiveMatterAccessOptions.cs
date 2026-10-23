namespace MatterFlow.SharedKernel.Visibility;

/// <summary>
/// The go-live switch of the sensitive-matter rule (<c>Features:SensitiveMatterAccess</c>, default false). While it is off every visibility
/// predicate lets everything through and behaviour is exactly the behaviour before epic #788. The owner turns it on after assigning managers to the
/// existing sensitive matters. Read in one place only: the <see cref="IMatterVisibility"/> implementation.
/// </summary>
public sealed class SensitiveMatterAccessOptions
{
    public const string Section = "Features";

    /// <summary>True when the rule is enforced.</summary>
    public bool SensitiveMatterAccess { get; set; }
}
