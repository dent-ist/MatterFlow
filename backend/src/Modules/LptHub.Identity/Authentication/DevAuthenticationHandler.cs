using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace MatterFlow.Identity.Authentication;

/// <summary>Scheme options carrier for the Dev handler (the real settings are <see cref="DevAuthOptions"/>).</summary>
public sealed class DevSchemeOptions : AuthenticationSchemeOptions;

/// <summary>
/// Development authentication: the user is named by a configurable header (default <c>X-Dev-User</c>) or query parameter
/// (default <c>devUser</c>), else <c>Auth:Dev:DefaultUser</c>. Registered only outside Production so integration tests and local
/// runs work off-domain. Unknown names are accepted and provisioned like any first login; <c>Dev:Users</c> adds display names and roles.
/// </summary>
public sealed class DevAuthenticationHandler(
    IOptionsMonitor<DevSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    IOptions<DevAuthOptions> devOptions)
    : AuthenticationHandler<DevSchemeOptions>(options, logger, encoder)
{
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var settings = devOptions.Value;
        var name = Request.Headers[settings.HeaderName].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(name) && !string.IsNullOrWhiteSpace(settings.QueryName))
            name = Request.Query[settings.QueryName].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(name))
            name = settings.DefaultUser;
        if (string.IsNullOrWhiteSpace(name))
            return Task.FromResult(AuthenticateResult.NoResult());

        name = name.Trim();
        var identity = new ClaimsIdentity(
            [
                new Claim(ClaimTypes.Name, name),
                new Claim(ExternalIdentityAccessor.ProviderClaim, DevAuthOptions.SchemeName),
                new Claim(ExternalIdentityAccessor.SubjectClaim, name.ToLowerInvariant()),
            ],
            DevAuthOptions.SchemeName);
        var ticket = new AuthenticationTicket(new ClaimsPrincipal(identity), DevAuthOptions.SchemeName);
        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
