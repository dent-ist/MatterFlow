using LptHub.Integrations.Contracts;
using LptHub.Integrations.Domain;
using LptHub.SharedKernel.Results;
using LptHub.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Integrations.Application;

/// <summary>
/// <see cref="IIntegrationTokenProvider"/>: one Entra ID app registration, a different scope per integration. Asks Entra ID (OAuth2 client credentials) with the integration's own scope, keeps the token
/// in memory (<see cref="TokenCache"/>) and refreshes it shortly before it expires. Fails with <c>INTEGRATION_NOT_AVAILABLE</c> for an integration that is turned off or not set up.
/// </summary>
public sealed class IntegrationTokenProvider(DbContext db, ConnectionAccess connection, EntraTokenClient entra, TokenCache cache, IClock clock) : IIntegrationTokenProvider
{
    public async Task<Result<AccessToken>> GetTokenAsync(int integrationId, CancellationToken ct = default)
    {
        var integration = await db.Set<Integration>().AsNoTracking().SingleOrDefaultAsync(i => i.Id == integrationId, ct);
        return integration is null ? Error.NotFound("Integration not found.") : await TokenForAsync(integration, forceNew: false, ct);
    }

    public async Task<Result<AccessToken>> GetTokenForTypeAsync(string typeCode, CancellationToken ct = default)
    {
        var integration = await db.Set<Integration>().AsNoTracking().SingleOrDefaultAsync(i => i.TypeCode == typeCode, ct);
        return integration is null ? NotAvailable("No integration of this type is configured.") : await TokenForAsync(integration, forceNew: false, ct);
    }

    internal async Task<Result<AccessToken>> TokenForAsync(Integration integration, bool forceNew, CancellationToken ct, bool ignoreDisabled = false)
    {
        if (!integration.IsEnabled && !ignoreDisabled)
            return NotAvailable($"The {integration.Name} integration is turned off.");
        if (string.IsNullOrWhiteSpace(integration.Scope) || string.IsNullOrWhiteSpace(integration.BaseUrl))
            return NotAvailable($"The {integration.Name} integration is not set up yet.");

        var credentials = await connection.CredentialsAsync(ct);
        if (credentials.IsFailure)
            return credentials.Error!;
        if (credentials.Value is not { } c)
            return NotAvailable("The Microsoft Entra ID connection is not set up yet.");

        var key = TokenCache.KeyOf(c.TenantId, c.ClientId, integration.Scope, c.SecretSetAtUtc);
        return await cache.GetAsync(key, async token =>
        {
            var attempt = await entra.RequestAsync(c.TenantId, c.ClientId, c.Secret, integration.Scope, c.SecretExpiresOn, DateOnly.FromDateTime(clock.UtcNow), token);
            return attempt.Succeeded
                ? new AccessToken(attempt.Token!, clock.UtcNow.AddSeconds(attempt.ExpiresInSeconds))
                : Error.Conflict(ErrorCodes.IntegrationTokenFailed, "Could not get an access token for this integration.", new Dictionary<string, object?> { ["outcome"] = attempt.Outcome });
        }, forceNew, ct);
    }

    private static Error NotAvailable(string message) => Error.Conflict(ErrorCodes.IntegrationNotAvailable, message);
}
