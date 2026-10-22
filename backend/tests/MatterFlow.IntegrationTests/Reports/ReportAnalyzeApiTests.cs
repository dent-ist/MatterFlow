using System.Net;
using System.Net.Http.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using MatterFlow.Reports.Api;
using Shouldly;

namespace MatterFlow.IntegrationTests.Reports;

/// <summary>POST /api/v1/report-admin/analyze: placeholders with positions, permission variants (issue #687).</summary>
[Collection(SqlServerCollection.Name)]
public sealed class ReportAnalyzeApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private const string Analyze = "/api/v1/report-admin/analyze";

    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    [Fact]
    public async Task A_manager_gets_placeholders_with_positions_built_ins_and_issues()
    {
        var manager = await _h.UserWithAsync(@"KE\manager", "Report.Manage");
        const string sql = "SELECT 1\nWHERE d >= :Period_From AND d <= :PERIOD_TO AND u = :CURRENT_USER_ID AND x = ':skip' AND y = @bad";

        var response = await manager.PostAsJsonAsync(Analyze, new AnalyzeRequest(sql));

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = (await response.Content.ReadFromJsonAsync<AnalyzeResponse>())!;
        body.Placeholders.Select(p => p.Name).ShouldBe(["PERIOD_FROM", "PERIOD_TO", "CURRENT_USER_ID"]);
        body.Placeholders[0].DisplayName.ShouldBe("Period_From");
        (body.Placeholders[0].Line, body.Placeholders[0].Column).ShouldBe((2, 12));
        body.Placeholders.Single(p => p.Name == "CURRENT_USER_ID").IsBuiltIn.ShouldBeTrue();
        body.Occurrences.Count.ShouldBe(3);
        body.Issues.Select(i => i.Code).ShouldBe(["AT_SIGN_NOT_ALLOWED"]);
        body.DateRangeCandidates.ShouldBe(["PERIOD"]);
    }

    [Fact]
    public async Task An_empty_or_missing_text_is_analysed_as_empty()
    {
        var manager = await _h.UserWithAsync(@"KE\manager", "Report.Manage");

        var body = (await (await manager.PostAsJsonAsync(Analyze, new AnalyzeRequest(null))).Content.ReadFromJsonAsync<AnalyzeResponse>())!;

        body.Placeholders.ShouldBeEmpty();
        body.Issues.ShouldBeEmpty();
    }

    [Theory]
    [InlineData("none")]
    [InlineData("Report.Run")]
    [InlineData("Report.Assign")]
    [InlineData("Report.Run,Report.Assign")]
    public async Task Everyone_without_Report_Manage_is_refused(string permissions)
    {
        var user = permissions == "none"
            ? await _h.UserWithAsync(@"KE\nobody", "Matter.View")
            : await _h.UserWithAsync(@"KE\" + permissions.Replace(',', '_').Replace('.', '_'), permissions.Split(','));

        (await user.PostAsJsonAsync(Analyze, new AnalyzeRequest("SELECT :A"))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task A_text_over_64_kilobytes_is_reported_not_scanned()
    {
        var manager = await _h.UserWithAsync(@"KE\manager", "Report.Manage");

        var response = await manager.PostAsJsonAsync(Analyze, new AnalyzeRequest(new string('a', 300 * 1024)));

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = (await response.Content.ReadFromJsonAsync<AnalyzeResponse>())!;
        body.Issues.Select(i => i.Code).ShouldBe(["TEXT_TOO_LONG"]);
        body.Placeholders.ShouldBeEmpty();
    }

    [Fact]
    public async Task The_system_administrator_may_analyse()
    {
        var admin = _h.Admin;

        (await admin.PostAsJsonAsync(Analyze, new AnalyzeRequest("SELECT :A"))).StatusCode.ShouldBe(HttpStatusCode.OK);
    }
}
