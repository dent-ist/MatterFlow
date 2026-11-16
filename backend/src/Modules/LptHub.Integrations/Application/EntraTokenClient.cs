using System.Text.Json;
using LptHub.Integrations.Domain;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace LptHub.Integrations.Application;

/// <summary>The answer of one token request: <see cref="Outcome"/> is <c>OK</c> or a failure code of <see cref="TestOutcomes"/>; <see cref="Token"/> only when OK. Never printed (the token is a credential).</summary>
public sealed record TokenAttempt(string Outcome, string? Token, int ExpiresInSeconds)
{
    public bool Succeeded => Outcome == TestOutcomes.Ok && Token is not null;

    public override string ToString() => $"TokenAttempt({Outcome})";
}

/// <summary>
/// Asks Microsoft Entra ID for an access token (OAuth2 client credentials: <c>POST {authority}/{tenant}/oauth2/v2.0/token</c>). Answers with a plain outcome; the secret, the token and Entra's own
/// error text never leave this class (not in a result, not in a log line: only the outcome code is logged).
/// </summary>
public sealed class EntraTokenClient(IHttpClientFactory httpFactory, IOptions<IntegrationsOptions> options, ILogger<EntraTokenClient> log)
{
    public const string ClientName = "lpt-hub-entra";

    // Entra ID error codes (AADSTS) that name a cause. Anything else on a 4xx is a refusal of the credentials.
    private static readonly HashSet<int> ExpiredSecret = [7000222];
    private static readonly HashSet<int> ScopeProblem = [70011, 500011, 500021, 650053, 65001, 650057, 70001];

    public async Task<TokenAttempt> RequestAsync(string tenantId, string clientId, string secret, string scope, DateOnly? secretExpiresOn, DateOnly today, CancellationToken ct)
    {
        var settings = options.Value;
        var address = $"{settings.AuthorityHost.TrimEnd('/')}/{Uri.EscapeDataString(tenantId)}/oauth2/v2.0/token";
        using var request = new HttpRequestMessage(HttpMethod.Post, address)
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "client_credentials",
                ["client_id"] = clientId,
                ["client_secret"] = secret,
                ["scope"] = scope,
            }),
        };

        try
        {
            using var http = httpFactory.CreateClient(ClientName);
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseContentRead, ct);
            var body = await response.Content.ReadAsStringAsync(ct);
            if (response.IsSuccessStatusCode)
                return ReadToken(body);

            if ((int)response.StatusCode >= 500)
                return Failed(TestOutcomes.EntraUnreachable);

            return Failed(ClassifyRefusal(body, secretExpiresOn, today));
        }
        catch (HttpRequestException)
        {
            return Failed(TestOutcomes.EntraUnreachable);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return Failed(TestOutcomes.EntraUnreachable); // the timeout
        }
    }

    private TokenAttempt ReadToken(string body)
    {
        try
        {
            using var json = JsonDocument.Parse(body);
            var root = json.RootElement;
            var token = root.TryGetProperty("access_token", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString() : null;
            var seconds = root.TryGetProperty("expires_in", out var e) && e.TryGetInt32(out var n) ? n : 0;
            if (string.IsNullOrWhiteSpace(token))
                return Failed(TestOutcomes.EntraUnreachable);

            return new TokenAttempt(TestOutcomes.Ok, token, seconds > 0 ? seconds : 3600);
        }
        catch (JsonException)
        {
            return Failed(TestOutcomes.EntraUnreachable);
        }
    }

    /// <summary>Maps Entra's refusal to a plain outcome using the numeric error codes and the standard error name; the text of the answer is never kept.</summary>
    internal static string ClassifyRefusal(string body, DateOnly? secretExpiresOn, DateOnly today)
    {
        var error = string.Empty;
        var codes = new List<int>();
        try
        {
            using var json = JsonDocument.Parse(body);
            if (json.RootElement.TryGetProperty("error", out var e) && e.ValueKind == JsonValueKind.String)
                error = e.GetString() ?? string.Empty;
            if (json.RootElement.TryGetProperty("error_codes", out var list) && list.ValueKind == JsonValueKind.Array)
                codes.AddRange(list.EnumerateArray().Where(c => c.ValueKind == JsonValueKind.Number).Select(c => c.GetInt32()));
        }
        catch (JsonException)
        {
            return TestOutcomes.CredentialsRefused;
        }

        if (codes.Any(ExpiredSecret.Contains))
            return TestOutcomes.SecretExpired;
        if (codes.Any(ScopeProblem.Contains) || error == "invalid_scope")
            return TestOutcomes.ScopeRefused;
        if (error == "invalid_client" && secretExpiresOn is { } expires && expires < today)
            return TestOutcomes.SecretExpired;

        return TestOutcomes.CredentialsRefused;
    }

    private TokenAttempt Failed(string outcome)
    {
        log.LogInformation("Entra ID token request did not succeed: {Outcome}", outcome);
        return new TokenAttempt(outcome, null, 0);
    }
}
