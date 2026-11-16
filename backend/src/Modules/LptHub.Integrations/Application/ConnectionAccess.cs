using LptHub.Integrations.Domain;
using LptHub.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Integrations.Application;

/// <summary>The decrypted credentials of the Entra ID connection, in memory for one call. <see cref="ToString"/> hides the secret.</summary>
public sealed record ConnectionCredentials(string TenantId, string ClientId, string Secret, DateOnly? SecretExpiresOn, DateTime? SecretSetAtUtc)
{
    public override string ToString() => "ConnectionCredentials(secret hidden)";
}

/// <summary>Reads the one Entra ID connection row and decrypts its secret for the code that needs a token.</summary>
public sealed class ConnectionAccess(DbContext db, ISecretProtector protector)
{
    public Task<EntraConnection> LoadAsync(CancellationToken ct) =>
        db.Set<EntraConnection>().AsNoTracking().SingleAsync(c => c.Id == EntraConnection.SingleId, ct);

    /// <summary>Success with null when the connection is not complete yet; a failure when the stored secret cannot be decrypted.</summary>
    public async Task<Result<ConnectionCredentials?>> CredentialsAsync(CancellationToken ct)
    {
        var row = await LoadAsync(ct);
        if (!IntegrationSupport.IsComplete(row))
            return Result<ConnectionCredentials?>.Success(null);

        var secret = protector.Unprotect(row.ClientSecretProtected!);
        if (secret.IsFailure)
            return secret.Error!;

        return Result<ConnectionCredentials?>.Success(new ConnectionCredentials(row.TenantId!, row.ClientId!, secret.Value, row.SecretExpiresOn, row.SecretUpdatedAtUtc));
    }
}
