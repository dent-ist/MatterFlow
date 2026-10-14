using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Shouldly;

namespace MatterFlow.IntegrationTests;

public class ApiSmokeTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Liveness_endpoint_responds_ok()
    {
        var client = factory.CreateClient();
        var response = await client.GetAsync("/health/live");
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
    }
}
