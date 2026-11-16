using System.Net;
using System.Text;
using Microsoft.Extensions.Options;

namespace LptHub.Integrations.Application;

/// <summary>
/// A built-in stand-in for Microsoft Entra ID and the integration APIs, for Development and Test ONLY (the module refuses to register it anywhere else): it lets the screens and the Playwright specs run without a
/// network. Nothing here is real and no real credential is ever checked. The rules are deliberately simple and written on the Integrations page of the wiki:
/// <list type="bullet">
/// <item>Token request: a tenant containing "unreachable" does not answer; a secret containing "refused" is refused; a secret containing "expired" is reported expired; a scope containing "refused" is refused; anything else gets a token (valid 3599 seconds).</item>
/// <item>API call: a host containing "unreachable" does not answer; a host containing "refusing" answers 401; <c>/clients/99999</c> and a matter number 99999 answer 404, 55555 answers 500; any other client or matter is found; every other address answers 200.</item>
/// </list>
/// </summary>
internal sealed class SimulatedEndpointsHandler(IOptions<IntegrationsOptions> options) : HttpMessageHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var uri = request.RequestUri!;
        var authority = new Uri(options.Value.AuthorityHost);
        if (uri.Host.Equals(authority.Host, StringComparison.OrdinalIgnoreCase) && uri.AbsolutePath.EndsWith("/oauth2/v2.0/token", StringComparison.Ordinal))
            return await TokenAsync(request, uri, cancellationToken);

        return Api(uri);
    }

    private static async Task<HttpResponseMessage> TokenAsync(HttpRequestMessage request, Uri uri, CancellationToken ct)
    {
        var tenant = Uri.UnescapeDataString(uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries)[0]);
        if (tenant.Contains("unreachable", StringComparison.OrdinalIgnoreCase))
            throw new HttpRequestException("Simulated: Entra ID is not reachable.");

        var form = (await request.Content!.ReadAsStringAsync(ct)).Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(p => p.Split('=', 2))
            .ToDictionary(p => Uri.UnescapeDataString(p[0].Replace('+', ' ')), p => p.Length > 1 ? Uri.UnescapeDataString(p[1].Replace('+', ' ')) : string.Empty);
        var secret = form.GetValueOrDefault("client_secret", string.Empty);
        var scope = form.GetValueOrDefault("scope", string.Empty);
        if (secret.Contains("expired", StringComparison.OrdinalIgnoreCase))
            return Json(HttpStatusCode.Unauthorized, """{"error":"invalid_client","error_codes":[7000222]}""");
        if (secret.Contains("refused", StringComparison.OrdinalIgnoreCase))
            return Json(HttpStatusCode.Unauthorized, """{"error":"invalid_client","error_codes":[7000215]}""");
        if (scope.Contains("refused", StringComparison.OrdinalIgnoreCase))
            return Json(HttpStatusCode.BadRequest, """{"error":"invalid_scope","error_codes":[70011]}""");

        return Json(HttpStatusCode.OK, $$"""{"token_type":"Bearer","expires_in":3599,"access_token":"simulated.{{Guid.NewGuid():N}}"}""");
    }

    private static HttpResponseMessage Api(Uri uri)
    {
        if (uri.Host.Contains("unreachable", StringComparison.OrdinalIgnoreCase))
            throw new HttpRequestException("Simulated: the API is not reachable.");
        if (uri.Host.Contains("refusing", StringComparison.OrdinalIgnoreCase))
            return Json(HttpStatusCode.Unauthorized, "{}");

        var parts = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var at = Array.FindIndex(parts, p => p is "clients" or "matters");
        if (at < 0 || at + 1 >= parts.Length)
            return Json(HttpStatusCode.OK, "{}");

        var client = parts[at + 1];
        var matter = parts[at] == "matters" && at + 2 < parts.Length ? parts[at + 2] : null;
        var key = matter ?? client;
        if (key.TrimStart('0') == "99999")
            return Json(HttpStatusCode.NotFound, "{}");
        if (key.TrimStart('0') == "55555")
            return Json(HttpStatusCode.InternalServerError, "{}");

        var body = matter is null
            ? $$"""{"clientNumber":"{{client}}","clientName":"Simulated Client {{client}}"}"""
            : $$"""{"clientNumber":"{{client}}","clientName":"Simulated Client {{client}}","matterNumber":"{{matter}}","matterName":"Simulated Matter {{matter}}"}""";
        return Json(HttpStatusCode.OK, body);
    }

    private static HttpResponseMessage Json(HttpStatusCode status, string body) =>
        new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
}
