using LptHub.Audit.Contracts;

namespace LptHub.Integrations.Application;

/// <summary>Event codes the Integrations module writes. Object type <c>Integration</c> (id = integration id) or <c>EntraConnection</c> (id 1). Names, never secrets: no entry ever holds the client secret, a token or Entra's error text.</summary>
public static class IntegrationAuditEvents
{
    public const string Created = "INTEGRATION_CREATED";
    public const string Updated = "INTEGRATION_UPDATED";
    public const string Deleted = "INTEGRATION_DELETED";
    public const string Enabled = "INTEGRATION_ENABLED";
    public const string Disabled = "INTEGRATION_DISABLED";

    /// <summary>The Tenant ID or Client ID changed.</summary>
    public const string EntraConnectionChanged = "ENTRA_CONNECTION_CHANGED";

    /// <summary>The client secret was set or replaced. The entry says only that, and the new expiry date.</summary>
    public const string EntraSecretReplaced = "ENTRA_SECRET_REPLACED";
}

internal static class IntegrationAudit
{
    public const string IntegrationType = "Integration";
    public const string EntraType = "EntraConnection";

    public static AuditEntry About(string eventType, string objectType, Func<string> objectId, string summary) =>
        new()
        {
            EventType = eventType,
            ObjectType = objectType,
            ObjectIdFactory = objectId,
            Summary = summary.Length > 500 ? summary[..500] : summary,
        };
}
