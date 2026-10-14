using System.Net;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;

namespace MatterFlow.IntegrationTests;

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
