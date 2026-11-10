using System.Net;
using System.Net.Http.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using MatterFlow.Reports.Api;
using Shouldly;

namespace MatterFlow.IntegrationTests.Reports;

/// <summary>The Reports module is composed into the host and its endpoints are permission-guarded (epic #671, issue #680).</summary>
[Collection(SqlServerCollection.Name)]
public sealed class ReportsModuleTests(SqlServerFixture sql) : IAsyncLifetime
{
    private const string Status = "/api/v1/report-admin/status";

    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    [Theory]
    [InlineData("Report.Run")]
    [InlineData("Report.Assign")]
    [InlineData("Matter.View")]
    public async Task The_status_endpoint_needs_Report_Manage(string permission)
    {
        var client = await _h.UserWithAsync(@"KE\someone", permission);

        (await client.GetAsync(Status)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task A_manager_sees_the_reports_state()
    {
        var manager = await _h.UserWithAsync(@"KE\manager", "Report.Manage");

        var response = await manager.GetAsync(Status);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = (await response.Content.ReadFromJsonAsync<ReportsStatusResponse>())!;
        body.Message.ShouldNotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task The_system_administrator_holds_the_report_permissions_implicitly()
    {
        var admin = _factory.CreateClient();
        admin.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);

        (await admin.GetAsync(Status)).StatusCode.ShouldBe(HttpStatusCode.OK);
    }
}
