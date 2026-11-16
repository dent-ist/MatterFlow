using System.ComponentModel.DataAnnotations;

namespace LptHub.Integrations.Application;

/// <summary>One step of a test: what was checked and how it went.</summary>
/// <param name="Key"><c>ENTRA_REACHED</c>, <c>CREDENTIALS_ACCEPTED</c>, <c>TOKEN_ISSUED</c> or <c>API_ANSWERED</c>.</param>
/// <param name="State"><c>PASSED</c>, <c>FAILED</c> or <c>NOT_REACHED</c> (an earlier step failed).</param>
public sealed record TestStep([property: Required] string Key, [property: Required] string State);

/// <summary>
/// The result of a Test Connection. It names a plain outcome and the steps; it never contains a token, a secret or Entra's own error text.
/// </summary>
/// <param name="Outcome"><c>OK</c>, <c>NOT_SET_UP</c>, <c>ENTRA_UNREACHABLE</c>, <c>CREDENTIALS_REFUSED</c>, <c>SECRET_EXPIRED</c>, <c>SCOPE_REFUSED</c>, <c>API_UNREACHABLE</c> or <c>API_REFUSED</c>.</param>
/// <param name="Steps">The steps of this kind of test, in order: two for the Entra ID connection, four for an integration.</param>
/// <param name="TokenSeconds">On success, how long the issued token lives (seconds).</param>
/// <param name="TestedAt">When the test ran (UTC).</param>
/// <param name="TestedBy">Display name of who ran it, or null.</param>
/// <param name="RowVersion">Only on the answer of a test that just ran: the new concurrency token of the tested record (a test changes it), so an open form can keep saving.</param>
public sealed record TestResultResponse(
    [property: Required] string Outcome,
    [property: Required] IReadOnlyList<TestStep> Steps,
    int? TokenSeconds,
    [property: Required] DateTime TestedAt,
    string? TestedBy,
    string? RowVersion = null);

/// <summary>The Microsoft Entra ID connection. The client secret is write-only: only whether it is set and when it expires are returned, never the value.</summary>
/// <param name="TenantId">Directory (tenant) ID, or null while not set.</param>
/// <param name="ClientId">Application (client) ID, or null while not set.</param>
/// <param name="SecretIsSet">True when a client secret is stored (encrypted).</param>
/// <param name="SecretExpiresOn">The date the secret stops working (as entered when it was set), or null.</param>
/// <param name="SecretUpdatedAt">When the secret was last set (UTC).</param>
/// <param name="SecretUpdatedBy">Who set it.</param>
/// <param name="LastTest">The last test of the connection; cleared when a credential changes.</param>
/// <param name="UpdatedAt">When the connection was last changed (UTC); a test does not count.</param>
/// <param name="UpdatedBy">Who changed it last.</param>
/// <param name="RowVersion">Optimistic-concurrency token (base64); send it back on update.</param>
public sealed record EntraConnectionResponse(
    string? TenantId,
    string? ClientId,
    [property: Required] bool SecretIsSet,
    DateOnly? SecretExpiresOn,
    DateTime? SecretUpdatedAt,
    string? SecretUpdatedBy,
    TestResultResponse? LastTest,
    DateTime? UpdatedAt,
    string? UpdatedBy,
    [property: Required] string RowVersion);

/// <summary>Body to change the Tenant ID and Client ID (the secret has its own call).</summary>
public sealed class UpdateEntraConnectionRequest
{
    /// <summary>Directory (tenant) ID: a GUID or a verified domain name. Empty clears it.</summary>
    [StringLength(100)]
    public string? TenantId { get; init; }

    /// <summary>Application (client) ID: a GUID. Empty clears it.</summary>
    [StringLength(100)]
    public string? ClientId { get; init; }

    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

/// <summary>Body to set or replace the client secret. Write-only: the value is encrypted and never returned.</summary>
public sealed class SetClientSecretRequest
{
    /// <summary>The secret VALUE from the app registration (not the Secret ID).</summary>
    [Required, StringLength(512, MinimumLength = 1)]
    public string Secret { get; init; } = string.Empty;

    /// <summary>The date the secret expires, as shown in the app registration.</summary>
    [Required]
    public DateOnly? ExpiresOn { get; init; }
}

/// <summary>An integration as the list and the dialog show it.</summary>
/// <param name="IntegrationId">Integration id.</param>
/// <param name="Name">Display name (unique).</param>
/// <param name="TypeCode"><c>MATTER_LOOKUP</c>, <c>ETHICAL_WALL</c> or <c>OTHER</c>.</param>
/// <param name="BaseUrl">The https address of the API, or null.</param>
/// <param name="Scope">The scope asked of Entra ID for this API (<c>api://&lt;app-id&gt;/.default</c>), or null.</param>
/// <param name="IsEnabled">False when turned off.</param>
/// <param name="Status"><c>CONNECTED</c>, <c>NOT_SET_UP</c>, <c>NOT_TESTED</c>, <c>FAILED</c> or <c>DISABLED</c>.</param>
/// <param name="LastTest">The last test of this integration, or null.</param>
/// <param name="RowVersion">Optimistic-concurrency token (base64).</param>
public sealed record IntegrationResponse(
    [property: Required] int IntegrationId,
    [property: Required] string Name,
    [property: Required] string TypeCode,
    string? BaseUrl,
    string? Scope,
    [property: Required] bool IsEnabled,
    [property: Required] string Status,
    TestResultResponse? LastTest,
    [property: Required] string RowVersion);

/// <summary>Body to add an integration.</summary>
public sealed class CreateIntegrationRequest
{
    [Required, StringLength(100, MinimumLength = 1)]
    public string Name { get; init; } = string.Empty;

    /// <summary><c>MATTER_LOOKUP</c>, <c>ETHICAL_WALL</c> or <c>OTHER</c>. At most one of the first two exist.</summary>
    [Required]
    public string TypeCode { get; init; } = string.Empty;

    /// <summary>An https address, or empty while not known yet.</summary>
    [StringLength(500)]
    public string? BaseUrl { get; init; }

    [StringLength(300)]
    public string? Scope { get; init; }

    public bool IsEnabled { get; init; } = true;
}

/// <summary>Body to change an integration.</summary>
public sealed class UpdateIntegrationRequest
{
    [Required, StringLength(100, MinimumLength = 1)]
    public string Name { get; init; } = string.Empty;

    [Required]
    public string TypeCode { get; init; } = string.Empty;

    [StringLength(500)]
    public string? BaseUrl { get; init; }

    [StringLength(300)]
    public string? Scope { get; init; }

    public bool IsEnabled { get; init; } = true;

    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

/// <summary>Whether the Lookup button may be used. <c>READY</c>, <c>NOT_SET_UP</c>, <c>DISABLED</c> or <c>FAILED</c> (the last test of Matter Lookup failed).</summary>
/// <param name="State">One of the four states.</param>
public sealed record MatterLookupStatusResponse([property: Required] string State);

/// <summary>Body of a Matter Lookup call: a client number alone finds the client; a client number and a matter number find the matter.</summary>
public sealed class MatterLookupRequest
{
    /// <summary>1 to 5 digits.</summary>
    [Required, StringLength(10, MinimumLength = 1)]
    public string ClientNumber { get; init; } = string.Empty;

    /// <summary>1 to 5 digits; empty looks up the client only.</summary>
    [StringLength(10)]
    public string? MatterNumber { get; init; }
}

/// <summary>What the Matter Lookup API found. Only fields LPT Hub can use; numbers are padded to five digits.</summary>
/// <param name="Outcome"><c>FOUND</c>, <c>NOT_FOUND</c>, <c>NOT_AVAILABLE</c> (not set up, turned off or its last test failed) or <c>FAILED</c> (the call did not work now).</param>
/// <param name="ClientNumber">Client number as five digits, when the answer had one.</param>
/// <param name="ClientName">Client name.</param>
/// <param name="MatterNumber">Matter number as five digits.</param>
/// <param name="MatterName">Matter name.</param>
public sealed record MatterLookupResponse(
    [property: Required] string Outcome,
    string? ClientNumber,
    string? ClientName,
    string? MatterNumber,
    string? MatterName);
