using System.Net;
using System.Net.Http.Headers;
using LptHub.Identity.Contracts;
using LptHub.Integrations.Domain;
using LptHub.SharedKernel.Identity;
using LptHub.SharedKernel.Results;
using LptHub.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace LptHub.Integrations.Application;

/// <summary>
/// Test Connection. The Entra ID connection test checks that Entra ID answers and accepts the credentials. An integration test also asks for a token with that integration's own scope and, when it has a
/// Base URL, calls it once with the token. The answer is a plain outcome plus the steps; no token, secret or Entra error text is kept or logged. The result is stored on the row (not audited: a test
/// changes no setting) so the page shows it after a reload; a test does not move the record's "Last Updated".
/// </summary>
public sealed class IntegrationTester(
    DbContext db,
    ConnectionAccess connection,
    EntraTokenClient entra,
    IntegrationTokenProvider tokens,
    IHttpClientFactory httpFactory,
    IClock clock,
    ICurrentUser currentUser,
    IUserDirectory users,
    IOptions<IntegrationsOptions> options,
    ILogger<IntegrationTester> log)
{
    public const string ApiClientName = "lpt-hub-integration-api";

    public async Task<Result<TestResultResponse>> TestEntraAsync(CancellationToken ct)
    {
        var credentials = await connection.CredentialsAsync(ct);
        string outcome;
        int? seconds = null;
        if (credentials.IsFailure)
            outcome = TestOutcomes.CredentialsRefused; // the stored secret cannot be read: the same fix (set it again)
        else if (credentials.Value is not { } c)
            outcome = TestOutcomes.NotSetUp;
        else
        {
            var attempt = await entra.RequestAsync(c.TenantId, c.ClientId, c.Secret, options.Value.ConnectionTestScope, c.SecretExpiresOn, Today(), ct);
            outcome = attempt.Outcome;
            seconds = attempt.Succeeded ? attempt.ExpiresInSeconds : null;
        }

        var now = clock.UtcNow;
        var by = currentUser.UserId;
        await db.Set<EntraConnection>().Where(e => e.Id == EntraConnection.SingleId).ExecuteUpdateAsync(
            s => s.SetProperty(e => e.LastTestAtUtc, now).SetProperty(e => e.LastTestByUserId, by).SetProperty(e => e.LastTestOutcome, outcome).SetProperty(e => e.LastTestTokenSeconds, seconds), ct);
        var version = await db.Set<EntraConnection>().AsNoTracking().Where(e => e.Id == EntraConnection.SingleId).Select(e => e.RowVersion).SingleAsync(ct);
        log.LogInformation("Entra ID connection tested: {Outcome}", outcome);
        return Build(outcome, seconds, now, currentUser.DisplayName, forIntegration: false, IntegrationSupport.Encode(version));
    }

    public async Task<Result<TestResultResponse>> TestIntegrationAsync(int integrationId, CancellationToken ct)
    {
        var integration = await db.Set<Integration>().AsNoTracking().SingleOrDefaultAsync(i => i.Id == integrationId, ct);
        if (integration is null)
            return Error.NotFound("Integration not found.");

        var outcome = TestOutcomes.NotSetUp;
        int? seconds = null;
        var credentials = await connection.CredentialsAsync(ct);
        if (credentials.IsFailure)
            outcome = TestOutcomes.CredentialsRefused;
        else if (credentials.Value is not null && !string.IsNullOrWhiteSpace(integration.Scope) && !string.IsNullOrWhiteSpace(integration.BaseUrl))
        {
            // A fresh token every time (the cache would hide a changed scope or a revoked secret); a successful one is cached for the callers.
            var token = await tokens.TokenForAsync(integration, forceNew: true, ct, ignoreDisabled: true);
            if (token.IsFailure)
                outcome = token.Error!.Meta?.GetValueOrDefault("outcome") as string ?? TestOutcomes.EntraUnreachable;
            else
            {
                seconds = Math.Max(1, (int)(token.Value.ExpiresAtUtc - clock.UtcNow).TotalSeconds);
                outcome = await CallApiAsync(integration.BaseUrl, token.Value.Value, ct);
            }
        }

        var now = clock.UtcNow;
        var by = currentUser.UserId;
        var keepSeconds = outcome == TestOutcomes.Ok ? seconds : null;
        await db.Set<Integration>().Where(i => i.Id == integrationId).ExecuteUpdateAsync(
            s => s.SetProperty(i => i.LastTestAtUtc, now).SetProperty(i => i.LastTestByUserId, by).SetProperty(i => i.LastTestOutcome, outcome).SetProperty(i => i.LastTestTokenSeconds, keepSeconds), ct);
        var version = await db.Set<Integration>().AsNoTracking().Where(i => i.Id == integrationId).Select(i => i.RowVersion).SingleAsync(ct);
        log.LogInformation("Integration {IntegrationId} tested: {Outcome}", integrationId, outcome);
        return Build(outcome, keepSeconds, now, currentUser.DisplayName, forIntegration: true, IntegrationSupport.Encode(version));
    }

    /// <summary>The API step: any answer counts as "the API answered" except a refusal of the token (401, 403) and a gateway failure (502, 503, 504); no answer at all is "not reachable".</summary>
    private async Task<string> CallApiAsync(string baseUrl, string token, CancellationToken ct)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, baseUrl);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var http = httpFactory.CreateClient(ApiClientName);
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
            return response.StatusCode switch
            {
                HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => TestOutcomes.ApiRefused,
                HttpStatusCode.BadGateway or HttpStatusCode.ServiceUnavailable or HttpStatusCode.GatewayTimeout => TestOutcomes.ApiUnreachable,
                _ => TestOutcomes.Ok,
            };
        }
        catch (HttpRequestException)
        {
            return TestOutcomes.ApiUnreachable;
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return TestOutcomes.ApiUnreachable; // the timeout
        }
    }

    private DateOnly Today() => DateOnly.FromDateTime(clock.UtcNow);

    internal static TestResultResponse Build(string outcome, int? tokenSeconds, DateTime testedAtUtc, string? testedBy, bool forIntegration, string? rowVersion = null) =>
        new(outcome, IntegrationSupport.StepsOf(outcome, forIntegration), tokenSeconds, IntegrationSupport.Utc(testedAtUtc), testedBy, rowVersion);

    /// <summary>The stored last test of a row as the response shows it.</summary>
    public async Task<IReadOnlyDictionary<int, string>> NamesAsync(IEnumerable<int?> userIds, CancellationToken ct)
    {
        var ids = userIds.OfType<int>().Distinct().ToList();
        if (ids.Count == 0)
            return new Dictionary<int, string>();

        var found = await users.FindManyAsync(ids, ct);
        return found.ToDictionary(kv => kv.Key, kv => kv.Value.DisplayName);
    }
}
