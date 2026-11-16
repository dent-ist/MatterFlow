using LptHub.SharedKernel.Entities;

namespace LptHub.Integrations.Domain;

/// <summary>
/// The outcome codes of a Test Connection (also the API values and the stored <c>LastTestOutcome</c>). The four steps of a test are: reach Entra ID, credentials accepted, token issued for the scope, the API answers.
/// </summary>
public static class TestOutcomes
{
    public const string Ok = "OK";
    public const string NotSetUp = "NOT_SET_UP";
    public const string EntraUnreachable = "ENTRA_UNREACHABLE";
    public const string CredentialsRefused = "CREDENTIALS_REFUSED";
    public const string SecretExpired = "SECRET_EXPIRED";
    public const string ScopeRefused = "SCOPE_REFUSED";
    public const string ApiUnreachable = "API_UNREACHABLE";

    /// <summary>The API answered but refused the token (HTTP 401 or 403).</summary>
    public const string ApiRefused = "API_REFUSED";

    /// <summary>The index of the step that failed (0 reach Entra ID, 1 credentials, 2 token for the scope, 3 the API); -1 for success.</summary>
    public static int FailedStep(string outcome) => outcome switch
    {
        Ok => -1,
        NotSetUp or EntraUnreachable => 0,
        CredentialsRefused or SecretExpired => 1,
        ScopeRefused => 2,
        _ => 3,
    };
}

/// <summary>
/// The ONE Microsoft Entra ID connection of LPT Hub (single row, id 1): Tenant ID, Client ID and the client secret. The secret is stored encrypted (<see cref="ClientSecretProtected"/>) and is
/// write-only: no API returns it, no log or audit row contains it. Not <c>[Audited]</c> on purpose: the generic field audit would copy the encrypted value; the service writes explicit events.
/// </summary>
public class EntraConnection : AuditedEntity<int>
{
    public const int SingleId = 1;

    public string? TenantId { get; set; }

    public string? ClientId { get; set; }

    /// <summary>The secret, encrypted with Data Protection (base64 text). Never returned by any API.</summary>
    public string? ClientSecretProtected { get; set; }

    public DateOnly? SecretExpiresOn { get; set; }

    public DateTime? SecretUpdatedAtUtc { get; set; }

    public int? SecretUpdatedByUserId { get; set; }

    public DateTime? LastTestAtUtc { get; set; }

    public int? LastTestByUserId { get; set; }

    /// <summary>See <see cref="TestOutcomes"/>; null when never tested or cleared by a credential change.</summary>
    public string? LastTestOutcome { get; set; }

    public int? LastTestTokenSeconds { get; set; }
}

/// <summary>One external API LPT Hub calls with the shared Entra connection and its own scope. Not <c>[Audited]</c>: the service writes explicit, named events.</summary>
public class Integration : AuditedEntity<int>
{
    public string Name { get; set; } = string.Empty;

    /// <summary>See <c>IntegrationTypes</c>.</summary>
    public string TypeCode { get; set; } = string.Empty;

    public string? BaseUrl { get; set; }

    public string? Scope { get; set; }

    public bool IsEnabled { get; set; } = true;

    public DateTime? LastTestAtUtc { get; set; }

    public int? LastTestByUserId { get; set; }

    public string? LastTestOutcome { get; set; }

    public int? LastTestTokenSeconds { get; set; }
}
