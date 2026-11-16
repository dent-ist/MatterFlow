using LptHub.SharedKernel.Results;

namespace LptHub.Integrations.Contracts;

/// <summary>The stable codes of <c>dbo.Integration.TypeCode</c> (also the API values).</summary>
public static class IntegrationTypes
{
    /// <summary>The firm's matter system: looks up a client or matter by number. At most one.</summary>
    public const string MatterLookup = "MATTER_LOOKUP";

    /// <summary>The ethical wall (conflicts) service. At most one. No feature uses it yet; only the entry and the token exist.</summary>
    public const string EthicalWall = "ETHICAL_WALL";

    /// <summary>Any other API. Any number.</summary>
    public const string Other = "OTHER";

    public static readonly string[] All = [MatterLookup, EthicalWall, Other];

    public static bool IsValid(string? value) => value is MatterLookup or EthicalWall or Other;

    /// <summary>True for the two types of which at most one may exist.</summary>
    public static bool IsSingle(string? value) => value is MatterLookup or EthicalWall;
}

/// <summary>The status of an integration as the list shows it (<c>CONNECTED</c>, <c>NOT_SET_UP</c>, <c>NOT_TESTED</c>, <c>FAILED</c>, <c>DISABLED</c>).</summary>
public static class IntegrationStatuses
{
    public const string Connected = "CONNECTED";
    public const string NotSetUp = "NOT_SET_UP";
    public const string NotTested = "NOT_TESTED";
    public const string Failed = "FAILED";
    public const string Disabled = "DISABLED";
}

/// <summary>An access token for one integration's scope. <see cref="ToString"/> never shows the token: a token must not reach a log or a message by accident.</summary>
/// <param name="Value">The bearer token. Held in memory only, never stored.</param>
/// <param name="ExpiresAtUtc">When Entra ID stops accepting it.</param>
public sealed record AccessToken(string Value, DateTime ExpiresAtUtc)
{
    public override string ToString() => $"AccessToken(expires {ExpiresAtUtc:O})";
}

/// <summary>
/// Hands other modules an access token for an integration (Matter Lookup, Ethical Wall, ...). LPT Hub has ONE Microsoft Entra ID app registration and asks for a different scope per integration
/// (OAuth2 client credentials). A token is cached in memory and refreshed shortly before it expires; it is never written anywhere. A failure carries the stable code
/// <c>INTEGRATION_NOT_AVAILABLE</c> (not set up or disabled) or <c>INTEGRATION_TOKEN_FAILED</c> with the plain outcome in <c>meta.outcome</c>; never a secret.
/// </summary>
public interface IIntegrationTokenProvider
{
    /// <summary>A token for the integration with this id.</summary>
    Task<Result<AccessToken>> GetTokenAsync(int integrationId, CancellationToken cancellationToken = default);

    /// <summary>A token for the one integration of a fixed type (<see cref="IntegrationTypes.MatterLookup"/>, <see cref="IntegrationTypes.EthicalWall"/>).</summary>
    Task<Result<AccessToken>> GetTokenForTypeAsync(string typeCode, CancellationToken cancellationToken = default);
}

/// <summary>An integration as other modules see it.</summary>
/// <param name="IntegrationId">Integration id.</param>
/// <param name="Name">Display name.</param>
/// <param name="TypeCode">See <see cref="IntegrationTypes"/>.</param>
/// <param name="BaseUrl">The https address of the API, or null while not set up.</param>
/// <param name="IsEnabled">False when an administrator turned it off.</param>
/// <param name="Status">See <see cref="IntegrationStatuses"/>.</param>
public sealed record IntegrationInfo(int IntegrationId, string Name, string TypeCode, string? BaseUrl, bool IsEnabled, string Status);

/// <summary>Read-only look at the configured integrations for other modules (for example to show or hide a feature that needs one).</summary>
public interface IIntegrationRegistry
{
    /// <summary>The integration of a fixed type, or null when its row was deleted.</summary>
    Task<IntegrationInfo?> FindByTypeAsync(string typeCode, CancellationToken cancellationToken = default);

    /// <summary>Every integration.</summary>
    Task<IReadOnlyList<IntegrationInfo>> ListAsync(CancellationToken cancellationToken = default);
}
