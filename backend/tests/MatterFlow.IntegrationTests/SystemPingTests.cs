using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;

namespace MatterFlow.IntegrationTests;

/// <summary>Pipeline proof for GET /api/v1/system/ping: success shape, X-Time-Zone handling and the ProblemDetails error model. No database needed.</summary>
public class SystemPingTests(NoDatabaseApiFactory factory) : IClassFixture<NoDatabaseApiFactory>
{
    [Fact]
    public async Task Ping_returns_ok_with_firm_zone_when_no_header()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/v1/system/ping?message=hello");

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("status").GetString().ShouldBe("ok");
        body.GetProperty("echo").GetString().ShouldBe("hello");
        body.GetProperty("timeZoneId").GetString().ShouldBe("America/New_York");
        body.GetProperty("timeZoneFromRequest").GetBoolean().ShouldBeFalse();
        body.GetProperty("serverTimeUtc").GetString().ShouldEndWith("Z");
    }

    [Fact]
    public async Task Ping_uses_the_valid_x_time_zone_header()
    {
        var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/system/ping");
        request.Headers.Add("X-Time-Zone", "America/Chicago");

        var body = await (await client.SendAsync(request)).Content.ReadFromJsonAsync<JsonElement>();

        body.GetProperty("timeZoneId").GetString().ShouldBe("America/Chicago");
        body.GetProperty("timeZoneFromRequest").GetBoolean().ShouldBeTrue();
        body.GetProperty("timeZoneAbbreviation").GetString().ShouldBeOneOf("CST", "CDT");
    }

    [Fact]
    public async Task Ping_falls_back_to_the_firm_zone_for_an_invalid_header()
    {
        var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/system/ping");
        request.Headers.Add("X-Time-Zone", "Mars/Olympus");

        var body = await (await client.SendAsync(request)).Content.ReadFromJsonAsync<JsonElement>();

        body.GetProperty("timeZoneId").GetString().ShouldBe("America/New_York");
        body.GetProperty("timeZoneFromRequest").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task Validation_error_returns_problem_details_with_stable_code_and_field_errors()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/v1/system/ping?message=" + new string('x', 51));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        problem.GetProperty("status").GetInt32().ShouldBe(400);
        problem.GetProperty("code").GetString().ShouldBe("VALIDATION_FAILED");
        problem.GetProperty("type").GetString().ShouldBe("urn:matterflow:error:validation-failed");
        problem.GetProperty("title").GetString().ShouldNotBeNullOrWhiteSpace();
        problem.GetProperty("traceId").GetString().ShouldNotBeNullOrWhiteSpace();
        var fieldErrors = problem.GetProperty("errors").GetProperty("message");
        fieldErrors.GetArrayLength().ShouldBe(1);
        fieldErrors[0].GetProperty("code").GetString().ShouldBe("INVALID");
        fieldErrors[0].GetProperty("message").GetString().ShouldNotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task Unknown_route_returns_not_found_problem_details()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/v1/does-not-exist");

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        problem.GetProperty("code").GetString().ShouldBe("NOT_FOUND");
        problem.GetProperty("traceId").GetString().ShouldNotBeNullOrWhiteSpace();
    }
}
