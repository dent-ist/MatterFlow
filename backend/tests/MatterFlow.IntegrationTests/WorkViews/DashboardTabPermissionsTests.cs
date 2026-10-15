using System.Net;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Shouldly;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// The Dashboard permission model on every endpoint: Dashboard.View is needed for everything, each tab adds its own permission, a tab permission
/// without Dashboard.View is worth nothing, and Swimlane and Users do not open the shared summary payload.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class DashboardTabPermissionsTests(SqlServerFixture sql)
{
    private const string Summary = "/api/v1/dashboard";
    private const string Swimlane = "/api/v1/dashboard/swimlane";
    private const string Workload = "/api/v1/dashboard/workload";
    private static readonly string[] Endpoints = [Summary, Swimlane, Workload];

    [Fact]
    public async Task Every_endpoint_needs_Dashboard_View_and_its_own_tab_permission()
    {
        await using var factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        var h = new TaskHarness(factory);
        await h.CreateWorldAsync();

        // Each case: the permissions, and the status of the summary, swimlane and workload endpoints.
        (string[] Permissions, HttpStatusCode[] Expected)[] cases =
        [
            (["Task.View"], [HttpStatusCode.Forbidden, HttpStatusCode.Forbidden, HttpStatusCode.Forbidden]),
            (["Dashboard.View"], [HttpStatusCode.Forbidden, HttpStatusCode.Forbidden, HttpStatusCode.Forbidden]),
            (["Dashboard.ViewSummary", "Dashboard.ViewBreakdowns", "Dashboard.ViewTrends", "Dashboard.ViewSwimlane", "Dashboard.ViewUsers"],
                [HttpStatusCode.Forbidden, HttpStatusCode.Forbidden, HttpStatusCode.Forbidden]),
            (["Dashboard.View", "Dashboard.ViewSummary"], [HttpStatusCode.OK, HttpStatusCode.Forbidden, HttpStatusCode.Forbidden]),
            (["Dashboard.View", "Dashboard.ViewBreakdowns"], [HttpStatusCode.OK, HttpStatusCode.Forbidden, HttpStatusCode.Forbidden]),
            (["Dashboard.View", "Dashboard.ViewTrends"], [HttpStatusCode.OK, HttpStatusCode.Forbidden, HttpStatusCode.Forbidden]),
            (["Dashboard.View", "Dashboard.ViewSwimlane"], [HttpStatusCode.Forbidden, HttpStatusCode.OK, HttpStatusCode.Forbidden]),
            (["Dashboard.View", "Dashboard.ViewUsers"], [HttpStatusCode.Forbidden, HttpStatusCode.Forbidden, HttpStatusCode.OK]),
        ];

        var n = 0;
        foreach (var (permissions, expected) in cases)
        {
            var client = await h.UserWithAsync($@"KE\tab{n++}", permissions);
            for (var i = 0; i < Endpoints.Length; i++)
                (await client.GetAsync(Endpoints[i])).StatusCode.ShouldBe(expected[i], $"{string.Join("+", permissions)} -> {Endpoints[i]}");
        }
    }
}
