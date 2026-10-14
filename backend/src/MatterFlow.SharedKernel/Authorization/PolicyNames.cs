namespace MatterFlow.SharedKernel.Authorization;

/// <summary>Names of authorization policies referenced by controllers. The policy handlers live in the Identity module.</summary>
public static class PolicyNames
{
    /// <summary>Read access to the audit browser (architecture section 6.3, oversight permissions).</summary>
    public const string AuditView = "Audit.View";
}
