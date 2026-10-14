using System.Net;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Shouldly;

namespace MatterFlow.IntegrationTests;

/// <summary>Production hosting (ticket #60): the Angular build served from wwwroot, SPA fallback, cache headers, security headers on static responses. No database.</summary>
public sealed class SpaHostingTests : IDisposable
{
    private const string IndexHtml = "<!doctype html><html><head><title>MatterFlow</title></head><body><mf-root></mf-root></body></html>";
    private const string HashedScript = "main-KV7X2SA5.js";
    private readonly string _webRoot = Path.Combine(Path.GetTempPath(), "mf-wwwroot-" + Guid.NewGuid().ToString("N"));

    public SpaHostingTests()
    {
        Directory.CreateDirectory(_webRoot);
        File.WriteAllText(Path.Combine(_webRoot, "index.html"), IndexHtml);
        File.WriteAllText(Path.Combine(_webRoot, HashedScript), new string('x', 4000) + "\nconsole.log('app');");
        File.WriteAllText(Path.Combine(_webRoot, "favicon.ico"), "icon");
        File.WriteAllText(Path.Combine(_webRoot, "config.json"), "{}");
    }

    public void Dispose()
    {
        try
        {
            Directory.Delete(_webRoot, recursive: true);
        }
        catch (IOException)
        {
            // Best effort.
        }
    }

    private WebApplicationFactory<Program> Factory(string? serveSpa = "true", string environment = "Test", bool withWebRoot = true) =>
        new NoDatabaseApiFactory().WithWebHostBuilder(b =>
        {
            b.UseEnvironment(environment);
            b.UseSetting("Auth:Provider", "Dev");
            b.UseSetting("AllowedHosts", "*");
            if (serveSpa is not null)
                b.UseSetting("Hosting:ServeSpa", serveSpa);
            if (withWebRoot)
                b.UseWebRoot(_webRoot);
        });

    private static HttpClient Https(WebApplicationFactory<Program> factory) =>
        factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://matterflow.firm.test") });

    private static string Header(HttpResponseMessage response, string name) =>
        response.Headers.TryGetValues(name, out var values) ? string.Join(",", values)
        : response.Content.Headers.TryGetValues(name, out var contentValues) ? string.Join(",", contentValues)
        : string.Empty;

    [Theory]
    [InlineData("/")]
    [InlineData("/tasks/new")]
    [InlineData("/admin/users-roles")]
    [InlineData("/matters/00000000-0000-0000-0000-000000000001/edit")]
    public async Task Client_routes_fall_back_to_index_html_that_is_never_cached(string path)
    {
        using var factory = Factory();
        var response = await Https(factory).GetAsync(path);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await response.Content.ReadAsStringAsync()).ShouldBe(IndexHtml);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("text/html");
        Header(response, "Cache-Control").ShouldBe("no-cache");
    }

    [Fact]
    public async Task Head_on_a_client_route_returns_the_headers_only()
    {
        using var factory = Factory();
        var response = await Https(factory).SendAsync(new HttpRequestMessage(HttpMethod.Head, "/tasks/new"));

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await response.Content.ReadAsStringAsync()).ShouldBeEmpty();
    }

    [Theory]
    [InlineData("/api/v1/does-not-exist")]
    [InlineData("/api")]
    [InlineData("/health/unknown")]
    [InlineData("/openapi/v1.json")]
    public async Task Server_paths_never_fall_back_and_unknown_api_routes_stay_problem_details(string path)
    {
        using var factory = Factory();
        var client = Https(factory);
        client.DefaultRequestHeaders.Accept.ParseAdd("application/json");
        var response = await client.GetAsync(path);

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        var body = await response.Content.ReadAsStringAsync();
        body.ShouldNotContain("mf-root");
        if (path.StartsWith("/api/", StringComparison.Ordinal))
        {
            response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
            using var json = JsonDocument.Parse(body);
            json.RootElement.GetProperty("status").GetInt32().ShouldBe(404);
            json.RootElement.TryGetProperty("code", out _).ShouldBeTrue();
        }
    }

    [Fact]
    public async Task A_missing_file_is_a_404_not_the_index_page()
    {
        using var factory = Factory();
        var response = await Https(factory).GetAsync("/main-MISSING1.js");

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await response.Content.ReadAsStringAsync()).ShouldNotContain("mf-root");
    }

    [Fact]
    public async Task Post_to_a_client_route_does_not_get_the_index_page()
    {
        using var factory = Factory();
        var response = await Https(factory).PostAsync("/tasks/new", new StringContent("{}"));

        response.StatusCode.ShouldNotBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Hashed_assets_are_cached_for_a_year_and_other_files_are_revalidated()
    {
        using var factory = Factory();
        var client = Https(factory);

        var script = await client.GetAsync("/" + HashedScript);
        var favicon = await client.GetAsync("/favicon.ico");
        var config = await client.GetAsync("/config.json");
        var index = await client.GetAsync("/index.html");

        script.StatusCode.ShouldBe(HttpStatusCode.OK);
        Header(script, "Cache-Control").ShouldBe("public, max-age=31536000, immutable");
        Header(favicon, "Cache-Control").ShouldBe("no-cache");
        Header(config, "Cache-Control").ShouldBe("no-cache");
        Header(index, "Cache-Control").ShouldBe("no-cache");
    }

    [Fact]
    public async Task Static_responses_carry_the_app_csp_and_the_other_security_headers()
    {
        using var factory = Factory();
        var client = Https(factory);

        foreach (var path in new[] { "/", "/tasks/new", "/" + HashedScript, "/favicon.ico", "/main-MISSING1.js" })
        {
            var response = await client.GetAsync(path);
            Header(response, "Content-Security-Policy").ShouldContain("script-src 'self'", customMessage: path);
            Header(response, "Content-Security-Policy").ShouldContain("style-src 'self' 'unsafe-inline'", customMessage: path);
            Header(response, "Content-Security-Policy").ShouldNotContain("default-src 'none'", customMessage: path);
            Header(response, "Content-Security-Policy").ShouldNotContain("unsafe-eval", customMessage: path);
            Header(response, "X-Content-Type-Options").ShouldBe("nosniff", path);
            Header(response, "X-Frame-Options").ShouldBe("DENY", path);
            Header(response, "Referrer-Policy").ShouldBe("no-referrer", path);
            Header(response, "Strict-Transport-Security").ShouldContain("max-age=", customMessage: path);
        }
    }

    [Fact]
    public async Task Api_responses_keep_the_strict_policy_and_no_store_when_the_spa_is_served()
    {
        using var factory = Factory();
        var response = await Https(factory).GetAsync("/api/v1/system/ping");

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        Header(response, "Content-Security-Policy").ShouldContain("default-src 'none'");
        Header(response, "Cache-Control").ShouldBe("no-store");
    }

    [Fact]
    public async Task Text_assets_are_compressed_and_api_json_is_not()
    {
        using var factory = Factory();
        var client = Https(factory);

        var script = await SendAsync(client, "/" + HashedScript);
        var api = await SendAsync(client, "/api/v1/system/ping");

        Header(script, "Content-Encoding").ShouldBe("br");
        Header(api, "Content-Encoding").ShouldBeEmpty();
    }

    private static Task<HttpResponseMessage> SendAsync(HttpClient client, string path)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.AcceptEncoding.ParseAdd("br, gzip");
        return client.SendAsync(request);
    }

    [Fact]
    public async Task Health_endpoints_are_not_shadowed_by_the_spa()
    {
        using var factory = Factory();
        var client = Https(factory);

        var live = await client.GetAsync("/health/live");
        var ready = await client.GetAsync("/health/ready");

        live.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await live.Content.ReadAsStringAsync()).ShouldBe("Healthy");
        ready.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable); // no database in this fixture
    }

    [Fact]
    public async Task Without_ServeSpa_a_wwwroot_with_index_html_is_served_outside_Development()
    {
        using var factory = Factory(serveSpa: null);
        var response = await Https(factory).GetAsync("/tasks/new");

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await response.Content.ReadAsStringAsync()).ShouldBe(IndexHtml);
    }

    [Fact]
    public async Task Development_serves_no_spa_unless_asked_to()
    {
        using var factory = Factory(serveSpa: null, environment: "Development");
        var response = await Https(factory).GetAsync("/tasks/new");

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task ServeSpa_false_turns_hosting_off_even_with_a_build_present()
    {
        using var factory = Factory(serveSpa: "false");
        var response = await Https(factory).GetAsync("/");

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Without_a_build_the_api_alone_runs_as_before()
    {
        using var factory = Factory(serveSpa: null, withWebRoot: false);
        var client = Https(factory);

        (await client.GetAsync("/")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await client.GetAsync("/api/v1/system/ping")).StatusCode.ShouldBe(HttpStatusCode.OK);
    }
}
