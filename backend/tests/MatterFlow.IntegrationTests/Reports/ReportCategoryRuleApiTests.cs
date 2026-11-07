using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;

namespace MatterFlow.IntegrationTests.Reports;

/// <summary>A report whose category is deactivated is hidden like an inactive report: not listed, not opened, not run, not exported, no views (one rule, <c>MayRun</c> in <c>ReportCatalog</c>).</summary>
[Collection(SqlServerCollection.Name)]
public sealed class ReportCategoryRuleApiTests(SqlServerFixture sql)
{
    private const string Rows = "SELECT * FROM (VALUES (1, N'a'), (2, N'b')) v(id, name)";

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>();

    private static string[] Names(JsonElement list) =>
        list.GetProperty("categories").EnumerateArray().SelectMany(c => c.GetProperty("reports").EnumerateArray()).Select(r => r.GetProperty("name").GetString()!).ToArray();

    private static Task SetCategoryActiveAsync(ReportTestHarness h, bool active) =>
        SqlServerFixture.ExecuteAsync(h.AppConnection, $"UPDATE dbo.ReportCategory SET IsActive = {(active ? 1 : 0)} WHERE Name = N'Test'");

    [Fact]
    public async Task A_report_in_a_deactivated_category_is_not_listed_opened_run_or_exported_and_comes_back_with_the_category()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var (outsider, _) = await h.PersonAsync(@"KE\outsider", "Report.Run"); // holds Report.Run but no assignment: the reference answer for "not available"
        var report = await h.AddReportAsync(Rows, roleIds: role);
        var other = await h.AddReportAsync("SELECT 1 AS one", roleIds: role);
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"INSERT dbo.ReportCategory (Name) VALUES (N'Other'); UPDATE dbo.ReportDefinition SET ReportCategoryId = (SELECT ReportCategoryId FROM dbo.ReportCategory WHERE Name = N'Other') WHERE ReportId = {other}");
        var runResponse = await runner.PostAsync($"/api/v1/reports/{report}/runs", ReportTestHarness.Parameters(new { }));
        runResponse.StatusCode.ShouldBe(HttpStatusCode.OK);
        var run = Guid.Parse((await ReadAsync(runResponse)).GetProperty("runId").GetString()!);
        Names(await ReadAsync(await runner.GetAsync("/api/v1/reports"))).Order().ShouldBe(["Report 1", "Report 2"]);

        await SetCategoryActiveAsync(h, false);

        Names(await ReadAsync(await runner.GetAsync("/api/v1/reports"))).ShouldBe(["Report 2"]);
        var open = await runner.GetAsync($"/api/v1/reports/{report}");
        open.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        var reference = await outsider.GetAsync($"/api/v1/reports/{report}");
        reference.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await ReadAsync(open)).GetProperty("detail").GetString().ShouldBe((await ReadAsync(reference)).GetProperty("detail").GetString());
        (await ReadAsync(open)).GetProperty("code").GetString().ShouldBe((await ReadAsync(reference)).GetProperty("code").GetString());
        (await runner.PostAsync($"/api/v1/reports/{report}/runs", ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await runner.PostAsync($"/api/v1/reports/{report}/choices/ANY", ReportTestHarness.Json(new { }))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await runner.GetAsync($"/api/v1/reports/{report}/views")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await runner.GetAsync($"/api/v1/reports/runs/{run}/export.csv")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        // The report in the other, active category is untouched.
        (await runner.GetAsync($"/api/v1/reports/{other}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await runner.PostAsync($"/api/v1/reports/{other}/runs", ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.OK);

        await SetCategoryActiveAsync(h, true);

        Names(await ReadAsync(await runner.GetAsync("/api/v1/reports"))).Order().ShouldBe(["Report 1", "Report 2"]);
        (await runner.GetAsync($"/api/v1/reports/{report}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await runner.PostAsync($"/api/v1/reports/{report}/runs", ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task The_administration_still_sees_the_report_of_a_deactivated_category()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var report = await h.AddReportAsync(Rows);
        await SetCategoryActiveAsync(h, false);

        var detail = await manager.GetAsync($"/api/v1/report-admin/reports/{report}");

        detail.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await ReadAsync(await manager.GetAsync("/api/v1/report-admin/reports"))).ToString().ShouldContain("Report 1");
    }
}
