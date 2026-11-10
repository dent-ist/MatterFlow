using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace MatterFlow.Identity.Authentication;

/// <summary>Which authentication provider the host uses (<c>Auth:Provider</c>).</summary>
public enum AuthProvider
{
    /// <summary>Windows Integrated Authentication through the Negotiate handler (production).</summary>
    Windows,

    /// <summary>Development provider: the caller picks the user by header or query. Only allowed in the Development and Test environments.</summary>
    Dev,
}

/// <summary>Settings of the Dev provider (<c>Auth:Dev:*</c>).</summary>
public sealed class DevAuthOptions
{
    public const string SchemeName = "Dev";

    /// <summary>Request header carrying the user name (for example <c>KE\alice</c>).</summary>
    public string HeaderName { get; set; } = "X-Dev-User";

    /// <summary>Query-string parameter carrying the user name; empty disables the query form. The query form works in Development only (it would make a login-CSRF link possible elsewhere).</summary>
    public string QueryName { get; set; } = "devUser";

    /// <summary>User used when the request names none; empty means anonymous (401).</summary>
    public string? DefaultUser { get; set; }
}

public static class AuthProviderSelection
{
    public const string ConfigKey = "Auth:Provider";

    /// <summary>
    /// Resolves the provider: explicit <c>Auth:Provider</c>, otherwise <c>Dev</c> in Development and <c>Windows</c> elsewhere.
    /// Throws when Dev is requested outside the Development and Test environments (allow-list), so a Dev provider can never run anywhere else.
    /// </summary>
    public static AuthProvider Resolve(IConfiguration configuration, IHostEnvironment environment)
    {
        var configured = configuration[ConfigKey];
        AuthProvider provider;
        if (string.IsNullOrWhiteSpace(configured))
        {
            provider = environment.IsDevelopment() ? AuthProvider.Dev : AuthProvider.Windows;
        }
        else if (!Enum.TryParse(configured, ignoreCase: true, out provider))
        {
            throw new InvalidOperationException($"{ConfigKey} '{configured}' is not valid. Use 'Windows' or 'Dev'.");
        }

        if (provider == AuthProvider.Dev && !IsDevAllowed(environment))
        {
            throw new InvalidOperationException(
                $"{ConfigKey}=Dev is only allowed in the Development and Test environments; it is not allowed in the {environment.EnvironmentName} environment.");
        }

        return provider;
    }

    /// <summary>
    /// Allow-list (security review SEC-10): the Dev provider lets the caller choose any identity by header, so it may only run where the
    /// environment name says "developer machine or automated test". Any other name (Production, Staging, UAT, a typo) is refused.
    /// </summary>
    public static bool IsDevAllowed(IHostEnvironment environment) =>
        environment.IsDevelopment() || environment.IsEnvironment("Test");
}
