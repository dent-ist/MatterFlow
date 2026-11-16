using System.Globalization;
using System.Text.RegularExpressions;
using LptHub.Audit.Contracts;
using LptHub.Integrations.Domain;
using LptHub.SharedKernel.Identity;
using LptHub.SharedKernel.Results;
using LptHub.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Integrations.Application;

/// <summary>
/// The one Microsoft Entra ID connection (Administration > Settings > Integrations). Tenant ID and Client ID are saved together; the client secret has its own call and is write-only: it is encrypted
/// before it reaches the database and no response, log line or audit entry contains it. Changing any credential clears the last test result of the connection and of every integration.
/// </summary>
public sealed partial class EntraConnectionService(
    DbContext db,
    ConnectionAccess connection,
    ISecretProtector protector,
    TokenCache cache,
    IAuditWriter audit,
    IntegrationTester tester,
    ICurrentUser currentUser,
    IClock clock)
{
    public async Task<EntraConnectionResponse> GetAsync(CancellationToken ct) => await ToResponseAsync(await connection.LoadAsync(ct), ct);

    public async Task<Result<EntraConnectionResponse>> UpdateAsync(UpdateEntraConnectionRequest request, CancellationToken ct)
    {
        var row = await db.Set<EntraConnection>().SingleAsync(c => c.Id == EntraConnection.SingleId, ct);
        var version = IntegrationSupport.CheckRowVersion(row.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;

        var tenant = IntegrationSupport.Clean(request.TenantId);
        var client = IntegrationSupport.Clean(request.ClientId);
        var fields = new FieldErrors();
        if (tenant is not null && !TenantPattern().IsMatch(tenant))
            fields.Add("tenantId", "INVALID", "Enter the Directory (tenant) ID: a GUID such as 00000000-0000-0000-0000-000000000000, or your verified domain name.");
        if (client is not null && !Guid.TryParse(client, out _))
            fields.Add("clientId", "INVALID", "Enter the Application (client) ID: a GUID such as 00000000-0000-0000-0000-000000000000.");
        if (fields.ToError() is { } invalid)
            return invalid;

        var changed = new List<string>();
        if (!string.Equals(row.TenantId, tenant, StringComparison.Ordinal))
            changed.Add("Tenant ID");
        if (!string.Equals(row.ClientId, client, StringComparison.Ordinal))
            changed.Add("Client ID");
        if (changed.Count == 0)
            return await ToResponseAsync(row, ct);

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        row.TenantId = tenant;
        row.ClientId = client;
        ClearTests(row);
        audit.Write(IntegrationAudit.About(IntegrationAuditEvents.EntraConnectionChanged, IntegrationAudit.EntraType, () => "1", $"Changed the Microsoft Entra ID connection: {string.Join(" and ", changed)}"));
        IntegrationSupport.TrackOriginalRowVersion(db, row, request.RowVersion);
        var failure = await SaveAsync(ct);
        if (failure is not null)
            return failure;

        await ClearIntegrationTestsAsync(ct);
        await transaction.CommitAsync(ct);
        cache.Clear();
        return await ToResponseAsync(await connection.LoadAsync(ct), ct);
    }

    public async Task<Result<EntraConnectionResponse>> SetSecretAsync(SetClientSecretRequest request, CancellationToken ct)
    {
        var secret = request.Secret.Trim();
        var fields = new FieldErrors();
        if (secret.Length == 0)
            fields.Add("secret", "REQUIRED", "Enter the client secret.");
        else if (Guid.TryParse(secret, out _))
            fields.Add("secret", "LOOKS_LIKE_ID", "That looks like the Secret ID. Paste the Value of the secret instead (shown once when the secret is created).");
        if (request.ExpiresOn is not { } expires)
            fields.Add("expiresOn", "REQUIRED", "Enter the date the secret expires.");
        else if (expires.Year < 2000 || expires > DateOnly.FromDateTime(clock.UtcNow).AddYears(100))
            fields.Add("expiresOn", "INVALID", "Enter the expiry date shown in the app registration.");
        if (fields.ToError() is { } invalid)
            return invalid;

        var protectedSecret = protector.Protect(secret);
        if (protectedSecret.IsFailure)
            return protectedSecret.Error!;

        var row = await db.Set<EntraConnection>().SingleAsync(c => c.Id == EntraConnection.SingleId, ct);
        var hadSecret = !string.IsNullOrEmpty(row.ClientSecretProtected);
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        row.ClientSecretProtected = protectedSecret.Value;
        row.SecretExpiresOn = request.ExpiresOn;
        row.SecretUpdatedAtUtc = clock.UtcNow;
        row.SecretUpdatedByUserId = currentUser.UserId;
        ClearTests(row);
        audit.Write(IntegrationAudit.About(
            IntegrationAuditEvents.EntraSecretReplaced,
            IntegrationAudit.EntraType,
            () => "1",
            $"{(hadSecret ? "Replaced" : "Set")} the client secret; new expiry {request.ExpiresOn!.Value.ToString("MM/dd/yyyy", CultureInfo.InvariantCulture)}"));
        var failure = await SaveAsync(ct);
        if (failure is not null)
            return failure;

        await ClearIntegrationTestsAsync(ct);
        await transaction.CommitAsync(ct);
        cache.Clear();
        return await ToResponseAsync(await connection.LoadAsync(ct), ct);
    }

    public Task<Result<TestResultResponse>> TestAsync(CancellationToken ct) => tester.TestEntraAsync(ct);

    private static void ClearTests(EntraConnection row)
    {
        row.LastTestAtUtc = null;
        row.LastTestByUserId = null;
        row.LastTestOutcome = null;
        row.LastTestTokenSeconds = null;
    }

    /// <summary>The integrations were tested with the old credentials: they read "Not Tested" until tested again. Does not move their "modified" stamp.</summary>
    private Task ClearIntegrationTestsAsync(CancellationToken ct) =>
        db.Set<Integration>().ExecuteUpdateAsync(
            s => s.SetProperty(i => i.LastTestAtUtc, (DateTime?)null).SetProperty(i => i.LastTestByUserId, (int?)null).SetProperty(i => i.LastTestOutcome, (string?)null).SetProperty(i => i.LastTestTokenSeconds, (int?)null),
            ct);

    private async Task<Error?> SaveAsync(CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
            return null;
        }
        catch (DbUpdateConcurrencyException)
        {
            audit.DiscardPending();
            return IntegrationSupport.ConcurrencyError();
        }
    }

    private async Task<EntraConnectionResponse> ToResponseAsync(EntraConnection row, CancellationToken ct)
    {
        var names = await tester.NamesAsync([row.SecretUpdatedByUserId, row.ModifiedByUserId, row.LastTestByUserId], ct);
        string? Name(int? id) => id is { } i && names.TryGetValue(i, out var n) ? n : null;
        var last = row.LastTestAtUtc is { } at && row.LastTestOutcome is { } outcome
            ? IntegrationTester.Build(outcome, row.LastTestTokenSeconds, at, Name(row.LastTestByUserId), forIntegration: false)
            : null;
        return new EntraConnectionResponse(
            row.TenantId,
            row.ClientId,
            !string.IsNullOrEmpty(row.ClientSecretProtected),
            row.SecretExpiresOn,
            IntegrationSupport.Utc(row.SecretUpdatedAtUtc),
            Name(row.SecretUpdatedByUserId),
            last,
            IntegrationSupport.Utc(row.ModifiedAtUtc),
            Name(row.ModifiedByUserId),
            IntegrationSupport.Encode(row.RowVersion));
    }

    /// <summary>A GUID, or a domain name (letters, digits, dots and hyphens): nothing that could change the token address.</summary>
    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9.\-]{0,98}[A-Za-z0-9]$", RegexOptions.CultureInvariant)]
    private static partial Regex TenantPattern();
}
