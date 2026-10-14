using System.Net;
using MatterFlow.Api.Http;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc.Testing;
using Shouldly;

namespace MatterFlow.IntegrationTests;

/// <summary>Security review SEC-08 (response headers, HSTS) and SEC-19 (request body cap), through the real pipeline without a database.</summary>
public class SecurityHeadersTests
{
    private static WebApplicationFactory<Program> Factory(string environment) =>
        new NoDatabaseApiFactory().WithWebHostBuilder(b =>
        {
            b.UseEnvironment(environment);
            b.UseSetting("Auth:Provider", "Dev"); // outside Development the default is Windows/Negotiate, which TestServer cannot run
            b.UseSetting("AllowedHosts", "*"); // the shipped default is the local host names only; see Unknown_host_names_are_refused
        });

    private static HttpClient Https(WebApplicationFactory<Program> factory) =>
        factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://matterflow.firm.test") });

    private static string Header(HttpResponseMessage response, string name) =>
        response.Headers.TryGetValues(name, out var values) ? string.Join(",", values) : string.Empty;

    private static void AssertCommonHeaders(HttpResponseMessage response)
    {
        Header(response, "X-Content-Type-Options").ShouldBe("nosniff");
        Header(response, "X-Frame-Options").ShouldBe("DENY");
        Header(response, "Referrer-Policy").ShouldBe("no-referrer");
        Header(response, "Permissions-Policy").ShouldContain("camera=()");
        Header(response, "Permissions-Policy").ShouldContain("microphone=()");
        Header(response, "Cross-Origin-Opener-Policy").ShouldBe("same-origin");
        Header(response, "Content-Security-Policy").ShouldContain("frame-ancestors 'none'");
    }

    [Theory]
    [InlineData("Development")]
    [InlineData("Test")]
    public async Task Every_response_carries_the_security_headers_including_errors(string environment)
    {
        using var factory = Factory(environment);
        var client = Https(factory);

        var ok = await client.GetAsync("/api/v1/system/ping");
        var unauthenticated = await client.GetAsync("/api/v1/me");
        var notFound = await client.GetAsync("/no/such/page");
        var health = await client.GetAsync("/health/live");

        ok.StatusCode.ShouldBe(HttpStatusCode.OK);
        unauthenticated.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        notFound.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        foreach (var response in new[] { ok, unauthenticated, notFound, health })
            AssertCommonHeaders(response);
    }

    [Fact]
    public async Task Api_responses_are_not_cacheable_and_get_the_strictest_policy()
    {
        using var factory = Factory("Development");

        var api = await factory.CreateClient().GetAsync("/api/v1/system/ping");
        var other = await factory.CreateClient().GetAsync("/no/such/page");

        Header(api, "Cache-Control").ShouldContain("no-store");
        Header(api, "Content-Security-Policy").ShouldBe(SecurityHeadersMiddleware.ApiContentSecurityPolicy);
        Header(other, "Cache-Control").ShouldNotContain("no-store");
        var app = Header(other, "Content-Security-Policy");
        app.ShouldBe(SecurityHeadersMiddleware.AppContentSecurityPolicy);
        app.ShouldContain("default-src 'self'");
        app.ShouldContain("script-src 'self'");
        app.ShouldContain("object-src 'none'");
        app.ShouldNotContain("unsafe-eval");
        app.Replace("style-src 'self' 'unsafe-inline'", string.Empty, StringComparison.Ordinal).ShouldNotContain("unsafe-inline"); // inline only for styles
    }

    [Fact]
    public async Task Hsts_is_sent_over_https_outside_development_only()
    {
        using var production = Factory("Test"); // any non-Development environment; a Production host needs Negotiate, which TestServer cannot provide
        using var development = Factory("Development");

        var prod = await Https(production).GetAsync("/api/v1/system/ping");
        var dev = await Https(development).GetAsync("/api/v1/system/ping");

        Header(prod, "Strict-Transport-Security").ShouldContain("max-age=31536000");
        Header(dev, "Strict-Transport-Security").ShouldBeEmpty();
    }

    [Fact]
    public async Task Unknown_host_names_are_refused_by_the_shipped_default()
    {
        using var factory = new NoDatabaseApiFactory();
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("http://evil.example") });

        (await client.GetAsync("/api/v1/system/ping")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await factory.CreateClient().GetAsync("/api/v1/system/ping")).StatusCode.ShouldBe(HttpStatusCode.OK); // localhost
    }

    [Fact]
    public async Task Request_bodies_are_capped_at_two_megabytes_unless_an_endpoint_raises_the_limit()
    {
        var feature = new FakeBodySizeFeature { MaxRequestBodySize = 30_000_000 };
        var context = new DefaultHttpContext();
        context.Features.Set<IHttpMaxRequestBodySizeFeature>(feature);
        var called = false;

        await new RequestBodyLimitMiddleware(_ =>
        {
            called = true;
            return Task.CompletedTask;
        }).InvokeAsync(context);

        called.ShouldBeTrue();
        feature.MaxRequestBodySize.ShouldBe(2 * 1024 * 1024);
    }

    private sealed class FakeBodySizeFeature : IHttpMaxRequestBodySizeFeature
    {
        public bool IsReadOnly => false;

        public long? MaxRequestBodySize { get; set; }
    }
}
