namespace LptHub.Integrations.Application;

/// <summary>
/// Settings of the Integrations module (configuration section <c>Integrations</c>; docs/runbook.md, Wiki Configuration Reference). Every value has a safe default; a firm normally changes none of them.
/// </summary>
public sealed class IntegrationsOptions
{
    public const string SectionName = "Integrations";

    /// <summary>The Microsoft identity platform address. The token address is <c>{AuthorityHost}/{tenant}/oauth2/v2.0/token</c>. Sovereign clouds use another host.</summary>
    public string AuthorityHost { get; set; } = "https://login.microsoftonline.com";

    /// <summary>The scope requested by the Entra ID connection test itself (any scope the app registration may ask for proves the credentials; the Microsoft Graph default needs no consent).</summary>
    public string ConnectionTestScope { get; set; } = "https://graph.microsoft.com/.default";

    /// <summary>Seconds to wait for Entra ID before the test or the token request counts as "not reachable".</summary>
    public int TokenTimeoutSeconds { get; set; } = 15;

    /// <summary>Seconds to wait for an integration API (Test Connection and the Matter Lookup call).</summary>
    public int ApiTimeoutSeconds { get; set; } = 10;

    /// <summary>A cached token is replaced this many seconds before it expires.</summary>
    public int RefreshBeforeExpirySeconds { get; set; } = 300;

    /// <summary>
    /// Development and Test only: answers Entra ID and the integration APIs from a built-in simulator, so the screens and the Playwright specs can be driven without a network (docs/dev-environment.md).
    /// Ignored (and logged) in any other environment.
    /// </summary>
    public SimulatorOptions Simulator { get; set; } = new();

    /// <summary>The provisional request and response mapping of the Matter Lookup API (the real contract is not known yet; adapt it here, or replace <c>IMatterLookupClient</c>).</summary>
    public MatterLookupOptions MatterLookup { get; set; } = new();
}

public sealed class SimulatorOptions
{
    public bool Enabled { get; set; }
}

/// <summary>
/// The PROVISIONAL contract of the Matter Lookup API. LPT Hub assumes: <c>GET {BaseUrl}/clients/{clientNumber}</c> answers <c>{"clientNumber":"00343","clientName":"Acme Corp"}</c> and
/// <c>GET {BaseUrl}/matters/{clientNumber}/{matterNumber}</c> answers <c>{"clientNumber":"00343","clientName":"Acme Corp","matterNumber":"00012","matterName":"Merger Review"}</c>;
/// 404 (or 204) means "nothing found"; the call carries <c>Authorization: Bearer</c>. An array answer uses its first item. Every path and field name below can be changed without code.
/// </summary>
public sealed class MatterLookupOptions
{
    /// <summary>Path (relative to the Base URL) that finds a client; <c>{clientNumber}</c> is replaced.</summary>
    public string ClientPath { get; set; } = "clients/{clientNumber}";

    /// <summary>Path (relative to the Base URL) that finds a matter; <c>{clientNumber}</c> and <c>{matterNumber}</c> are replaced.</summary>
    public string MatterPath { get; set; } = "matters/{clientNumber}/{matterNumber}";

    /// <summary>Send the numbers padded to five digits (<c>00343</c>), as LPT Hub stores them; false sends the digits as typed without the leading zeros.</summary>
    public bool PadNumbersInRequest { get; set; } = true;

    public string ClientNumberField { get; set; } = "clientNumber";

    public string ClientNameField { get; set; } = "clientName";

    public string MatterNumberField { get; set; } = "matterNumber";

    public string MatterNameField { get; set; } = "matterName";
}
