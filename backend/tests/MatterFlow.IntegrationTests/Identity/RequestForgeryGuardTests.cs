using System.Net;
using System.Net.Http.Json;
using System.Text;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

namespace MatterFlow.IntegrationTests.Identity;

/// <summary>CSRF protection (architecture 6.6) and the "Dev provider never runs in Production" guard. No database needed.</summary>
public class RequestForgeryGuardTests(NoDatabaseApiFactory factory) : IClassFixture<NoDatabaseApiFactory>
{
    private static HttpRequestMessage Post(string path, bool header = true, string contentType = "application/json", string? fetchSite = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = new StringContent("{}", Encoding.UTF8, contentType),
        };
        if (header)
            request.Headers.Add("X-MatterFlow-Client", "web");
        if (fetchSite is not null)
            request.Headers.Add("Sec-Fetch-Site", fetchSite);
        return request;
    }

    [Fact]
    public async Task State_changing_request_without_the_client_header_is_rejected_before_routing()
    {
        var response = await factory.CreateClient().SendAsync(Post("/api/v1/anything", header: false));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("code").GetString().ShouldBe("VALIDATION_FAILED");
    }

    [Fact]
    public async Task State_changing_request_with_a_form_content_type_is_rejected()
    {
        var response = await factory.CreateClient().SendAsync(Post("/api/v1/anything", contentType: "application/x-www-form-urlencoded"));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Theory]
    [InlineData("cross-site")]
    [InlineData("same-site")]
    public async Task Cross_site_fetch_metadata_is_forbidden(string site)
    {
        var response = await factory.CreateClient().SendAsync(Post("/api/v1/anything", fetchSite: site));

        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Theory]
    [InlineData("same-origin")]
    [InlineData(null)]
    public async Task Compliant_request_passes_the_guard(string? site)
    {
        var response = await factory.CreateClient().SendAsync(Post("/api/v1/anything", fetchSite: site));

        response.StatusCode.ShouldNotBe(HttpStatusCode.BadRequest);
        response.StatusCode.ShouldNotBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Safe_methods_do_not_need_the_header()
    {
        var response = await factory.CreateClient().GetAsync("/api/v1/system/ping");

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public void Dev_provider_cannot_be_enabled_in_production()
    {
        using var production = new NoDatabaseApiFactory().WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Production");
            b.UseSetting("Auth:Provider", "Dev");
        });

        Should.Throw<Exception>(() => production.CreateClient())
            .ToString().ShouldContain("not allowed in the Production");
    }

    [Fact]
    public async Task Production_defaults_to_windows_negotiate_without_a_dev_scheme()
    {
        using var production = new NoDatabaseApiFactory().WithWebHostBuilder(b => b.UseEnvironment("Production"));

        var schemes = await production.Services.GetRequiredService<IAuthenticationSchemeProvider>().GetAllSchemesAsync();

        schemes.Select(x => x.Name).ShouldContain("Negotiate");
        schemes.Select(x => x.Name).ShouldNotContain("Dev");
    }
}
