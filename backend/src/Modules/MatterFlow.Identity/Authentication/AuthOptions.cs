using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace MatterFlow.Identity.Authentication;

/// <summary>Which authentication provider the host uses (<c>Auth:Provider</c>).</summary>
public enum AuthProvider
{
    /// <summary>Windows Integrated Authentication through the Negotiate handler (production).</summary>
    Windows,

    /// <summary>Development provider: the caller picks the user by header or query. Never allowed in Production.</summary>
    Dev,
}

/// <summary>Settings of the Dev provider (<c>Auth:Dev:*</c>).</summary>
public sealed class DevAuthOptions
{
    public const string SchemeName = "Dev";

    /// <summary>Request header carrying the user name (for example <c>KE\alice</c>).</summary>
    public string HeaderName { get; set; } = "X-Dev-User";

    /// <summary>Query-string parameter carrying the user name; empty disables the query form.</summary>
    public string QueryName { get; set; } = "devUser";

    /// <summary>User used when the request names none; empty means anonymous (401).</summary>
    public string? DefaultUser { get; set; }
}

public static class AuthProviderSelection
{
    public const string ConfigKey = "Auth:Provider";

    /// <summary>
    /// Resolves the provider: explicit <c>Auth:Provider</c>, otherwise <c>Dev</c> in Development and <c>Windows</c> elsewhere.
    /// Throws when Dev is requested outside a non-production environment, so a Dev provider can never run in Production.
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

        if (provider == AuthProvider.Dev && environment.IsProduction())
            throw new InvalidOperationException($"{ConfigKey}=Dev is not allowed in the Production environment.");

        return provider;
    }
}
