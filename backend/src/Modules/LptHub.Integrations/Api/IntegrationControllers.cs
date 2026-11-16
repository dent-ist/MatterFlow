using LptHub.Identity.Contracts;
using LptHub.Integrations.Application;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace LptHub.Integrations.Api;

/// <summary>Permission policy names for the Integrations endpoints ("Perm:" plus the permission code, resolved by the Identity module).</summary>
internal static class IntegrationPolicies
{
    private const string Prefix = "Perm:";

    public const string Manage = Prefix + Permissions.Integrations.Manage;

    /// <summary>The Lookup button serves everyone who can create a client or a matter.</summary>
    public const string Lookup = Prefix + Permissions.Client.Create + "|" + Permissions.Matter.Create;
}

/// <summary>
/// The Microsoft Entra ID connection (epic #1389, issue #1395; <c>Integrations.Manage</c>, System Admin by default). One row: Tenant ID, Client ID and the client secret. The secret is write-only: it is
/// encrypted, never returned and never written to a log or an audit entry; the answers only say whether it is set and when it expires.
/// </summary>
[ApiController]
[Route("api/v1/admin/entra-connection")]
[Authorize(Policy = IntegrationPolicies.Manage)]
public class EntraConnectionController(EntraConnectionService service) : ControllerBase
{
    /// <summary>Gets the connection (never the secret).</summary>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet(Name = "GetEntraConnection")]
    [ProducesResponseType<EntraConnectionResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(CancellationToken cancellationToken) => Ok(await service.GetAsync(cancellationToken));

    /// <summary>Saves the Tenant ID and Client ID. Changing either clears the last test result of the connection and of every integration. 409 <c>CONCURRENCY_CONFLICT</c> when the record changed meanwhile.</summary>
    /// <param name="request">The two IDs and the concurrency token.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPut(Name = "UpdateEntraConnection")]
    [ProducesResponseType<EntraConnectionResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update([FromBody] UpdateEntraConnectionRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await service.UpdateAsync(request, cancellationToken));

    /// <summary>
    /// Sets or replaces the client secret and its expiry date. Saves at once (it is not part of Save Changes), encrypts the value, and clears every last test result. 409 <c>SECRET_STORE_UNAVAILABLE</c> when
    /// this server has no key store for the encryption (<c>DataProtection:KeysPath</c>). Audited as <c>ENTRA_SECRET_REPLACED</c> without the value.
    /// </summary>
    /// <param name="request">The secret value and the expiry date.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPut("secret", Name = "SetEntraClientSecret")]
    [ProducesResponseType<EntraConnectionResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> SetSecret([FromBody] SetClientSecretRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await service.SetSecretAsync(request, cancellationToken));

    /// <summary>Tests the connection: Entra ID answers and accepts the credentials. Answers 200 with the outcome, also when the test failed.</summary>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPost("test", Name = "TestEntraConnection")]
    [ProducesResponseType<TestResultResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Test(CancellationToken cancellationToken) => this.ToActionResult(await service.TestAsync(cancellationToken));
}

/// <summary>
/// The integrations (Administration > Settings > Integrations; <c>Integrations.Manage</c>): each is one external API called with the shared Entra ID connection and its own scope. At most one Matter Lookup
/// and one Ethical Wall (409 <c>INTEGRATION_TYPE_EXISTS</c>); a Base URL must be https. Changes are audited (<c>INTEGRATION_CREATED</c>, <c>_UPDATED</c>, <c>_DELETED</c>, <c>_ENABLED</c>, <c>_DISABLED</c>).
/// </summary>
[ApiController]
[Route("api/v1/admin/integrations")]
[Authorize(Policy = IntegrationPolicies.Manage)]
public class IntegrationsController(IntegrationService service) : ControllerBase
{
    /// <summary>Lists the integrations: Matter Lookup, Ethical Wall, then the Other ones by name.</summary>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet(Name = "ListIntegrations")]
    [ProducesResponseType<IReadOnlyList<IntegrationResponse>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List(CancellationToken cancellationToken) => Ok(await service.ListAsync(cancellationToken));

    /// <summary>Adds an integration.</summary>
    /// <param name="request">Name, type, Base URL, scope and whether it is enabled.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPost(Name = "CreateIntegration")]
    [ProducesResponseType<IntegrationResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create([FromBody] CreateIntegrationRequest request, CancellationToken cancellationToken)
    {
        var result = await service.CreateAsync(request, cancellationToken);
        return this.ToActionResult(result, created => Created($"/api/v1/admin/integrations/{created.IntegrationId}", created));
    }

    /// <summary>Changes an integration. Changing its type, Base URL or scope clears its last test result.</summary>
    /// <param name="integrationId">Integration id.</param>
    /// <param name="request">The new values and the concurrency token.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPut("{integrationId:int}", Name = "UpdateIntegration")]
    [ProducesResponseType<IntegrationResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(int integrationId, [FromBody] UpdateIntegrationRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await service.UpdateAsync(integrationId, request, cancellationToken));

    /// <summary>Deletes an integration.</summary>
    /// <param name="integrationId">Integration id.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpDelete("{integrationId:int}", Name = "DeleteIntegration")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int integrationId, CancellationToken cancellationToken)
    {
        var result = await service.DeleteAsync(integrationId, cancellationToken);
        return result.IsFailure ? this.Problem(result.Error!) : NoContent();
    }

    /// <summary>Turns an integration on.</summary>
    /// <param name="integrationId">Integration id.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPost("{integrationId:int}/enable", Name = "EnableIntegration")]
    [ProducesResponseType<IntegrationResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Enable(int integrationId, CancellationToken cancellationToken) =>
        this.ToActionResult(await service.SetEnabledAsync(integrationId, true, cancellationToken));

    /// <summary>Turns an integration off. Nothing is deleted; the Lookup button and any other use stop until it is turned on again.</summary>
    /// <param name="integrationId">Integration id.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPost("{integrationId:int}/disable", Name = "DisableIntegration")]
    [ProducesResponseType<IntegrationResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Disable(int integrationId, CancellationToken cancellationToken) =>
        this.ToActionResult(await service.SetEnabledAsync(integrationId, false, cancellationToken));

    /// <summary>
    /// Tests an integration: asks Entra ID for a token with this integration's scope and calls its Base URL once with the token. Answers 200 with the outcome and the steps, also when the test failed; the
    /// answer and the logs never contain a token or a secret.
    /// </summary>
    /// <param name="integrationId">Integration id.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPost("{integrationId:int}/test", Name = "TestIntegration")]
    [ProducesResponseType<TestResultResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Test(int integrationId, CancellationToken cancellationToken) =>
        this.ToActionResult(await service.TestAsync(integrationId, cancellationToken));
}

/// <summary>
/// The Lookup button of New Client and New Matter. Open to everyone who can create a client or a matter. The button state comes from <c>status</c>; <c>search</c> calls the Matter Lookup API through the
/// integration and always answers 200 with a plain outcome (found, nothing found, not available, failed), so the form never loses what the person typed.
/// </summary>
[ApiController]
[Route("api/v1/matter-lookup")]
[Authorize(Policy = IntegrationPolicies.Lookup)]
public class MatterLookupController(MatterLookupService service) : ControllerBase
{
    /// <summary>Whether Lookup can be used: <c>READY</c>, <c>NOT_SET_UP</c>, <c>DISABLED</c> or <c>FAILED</c>.</summary>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet("status", Name = "GetMatterLookupStatus")]
    [ProducesResponseType<MatterLookupStatusResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Status(CancellationToken cancellationToken) => Ok(await service.StatusAsync(cancellationToken));

    /// <summary>Looks up a client (client number) or a matter (client number and matter number). Returns only the fields LPT Hub can use, numbers padded to five digits.</summary>
    /// <param name="request">The numbers to look up.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPost("search", Name = "SearchMatterLookup")]
    [ProducesResponseType<MatterLookupResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Search([FromBody] MatterLookupRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await service.SearchAsync(request, cancellationToken));
}
