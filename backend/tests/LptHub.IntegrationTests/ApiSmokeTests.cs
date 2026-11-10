using System.Net;
using LptHub.IntegrationTests.Fixtures;
using Shouldly;

namespace LptHub.IntegrationTests;

public class ApiSmokeTests(NoDatabaseApiFactory factory) : IClassFixture<NoDatabaseApiFactory>
{
    [Fact]
    public async Task Liveness_endpoint_responds_ok()
    {
        var client = factory.CreateClient();
        var response = await client.GetAsync("/health/live");
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
    }
}
