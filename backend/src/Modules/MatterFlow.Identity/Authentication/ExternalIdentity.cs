using System.Security.Claims;

namespace MatterFlow.Identity.Authentication;

/// <summary>The authenticated external login as the provider reports it (architecture 6.1). Nothing outside the Identity module sees this type.</summary>
/// <param name="Provider">'Windows', 'Dev' or later 'Entra'.</param>
/// <param name="TenantId">Empty for Windows and Dev.</param>
/// <param name="Subject">Immutable provider key: the Windows SID, or the lower-cased user name for Dev.</param>
/// <param name="Username">Display/diagnostic name, for example <c>KE\kekim</c>.</param>
public sealed record ExternalIdentity(string Provider, string TenantId, string Subject, string Username, string? DisplayName = null, string? Email = null)
{
    public string CacheKey => $"{Provider}|{TenantId}|{Subject}";
}

/// <summary>Turns an authenticated <see cref="ClaimsPrincipal"/> into an <see cref="ExternalIdentity"/>.</summary>
public static class ExternalIdentityAccessor
{
    public const string ProviderClaim = "mf:provider";
    public const string SubjectClaim = "mf:subject";
    public const string DisplayNameClaim = "mf:display-name";
    public const string EmailClaim = "mf:email";

    public static ExternalIdentity? From(ClaimsPrincipal principal)
    {
        if (principal.Identity?.IsAuthenticated != true)
            return null;

        var name = principal.Identity.Name;
        if (string.IsNullOrWhiteSpace(name))
            return null;

        var provider = principal.FindFirstValue(ProviderClaim);
        if (provider is DevAuthOptions.SchemeName)
        {
            return new ExternalIdentity(
                DevAuthOptions.SchemeName,
                string.Empty,
                principal.FindFirstValue(SubjectClaim) ?? name.ToLowerInvariant(),
                name,
                principal.FindFirstValue(DisplayNameClaim),
                principal.FindFirstValue(EmailClaim));
        }

        // Windows: the SID is the immutable subject (WindowsIdentity exposes it as the primary-SID claim). Fall back to the
        // upper-cased account name where no SID is available (Negotiate on non-Windows hosts), which is stable enough for diagnostics.
        var sid = principal.FindFirstValue(ClaimTypes.PrimarySid) ?? principal.FindFirstValue(ClaimTypes.Sid);
        return new ExternalIdentity("Windows", string.Empty, sid ?? name.ToUpperInvariant(), name);
    }
}
