using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;

namespace MatterFlow.IntegrationTests.Reports;

/// <summary>GET /api/v1/reports: the reports a person may run, grouped by category, with no SQL and nothing about reports the person may not run (issue #718).</summary>
[Collection(SqlServerCollection.Name)]
public sealed class ReportListApiTests(SqlServerFixture sql)
{
    private const string List = "/api/v1/reports";

    // Recognisable text that must never be in a response body.
    private const string SecretSql = "SELECT 424242 AS secret_marker_column";
    private const string SecretOptionSql = "SELECT 'secret_option_marker' AS Value, 'x' AS Label";

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>();

    private static string[] Names(JsonElement list) =>
        list.GetProperty("categories").EnumerateArray().SelectMany(c => c.GetProperty("reports").EnumerateArray()).Select(r => r.GetProperty("name").GetString()!).ToArray();

    private static async Task<string> BodyAsync(HttpResponseMessage response)
    {
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return await response.Content.ReadAsStringAsync();
    }

    [Fact]
    public async Task Persona_cases_decide_who_gets_the_list_and_what_is_in_it()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (assigned, role) = await h.PersonAsync(@"KE\assigned", "Report.Run");
        var (unassigned, _) = await h.PersonAsync(@"KE\unassigned", "Report.Run");
        var (manager, managerRole) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var (assigner, assignerRole) = await h.PersonAsync(@"KE\assigner", "Report.Assign");
        var (nobody, nobodyRole) = await h.PersonAsync(@"KE\nobody", "Matter.View");
        await h.AddReportAsync(SecretSql, roleIds: [role, managerRole, assignerRole, nobodyRole]);

        var mine = await BodyAsync(await assigned.GetAsync(List));
        var none = await BodyAsync(await unassigned.GetAsync(List));

        Names(JsonDocument.Parse(mine).RootElement).ShouldBe(["Report 1"]);
        JsonDocument.Parse(none).RootElement.GetProperty("categories").GetArrayLength().ShouldBe(0);
        JsonDocument.Parse(none).RootElement.GetProperty("totalReports").GetInt32().ShouldBe(0);
        // Report.Manage and Report.Assign do not imply Report.Run, and a person without any Report permission is refused as well, assigned or not.
        (await manager.GetAsync(List)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await assigner.GetAsync(List)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await nobody.GetAsync(List)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await h.Factory.CreateClient().GetAsync(List)).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Inactive_reports_reports_without_a_current_version_and_reports_of_other_roles_are_left_out()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var (_, otherRole) = await h.PersonAsync(@"KE\other", "Report.Run");
        await h.AddReportAsync("SELECT 1 AS one", roleIds: role);
        await h.AddReportAsync("SELECT 2 AS one", active: false, roleIds: role);
        var noVersion = await h.AddReportAsync("SELECT 3 AS one", roleIds: role);
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"UPDATE dbo.ReportDefinition SET CurrentVersionId = NULL, IsActive = 0 WHERE ReportId = {noVersion}");
        await h.AddReportAsync("SELECT 4 AS one", roleIds: otherRole);
        await h.AddReportAsync("SELECT 5 AS one");

        Names(await ReadAsync(await runner.GetAsync(List))).ShouldBe(["Report 1"]);
    }

    [Fact]
    public async Task A_report_held_only_by_an_inactive_role_is_left_out()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, _) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var holder = await h.Factory.CreateRoleAsync("Holder", ["Matter.View"]);
        await h.Factory.GrantRoleAsync(@"KE\runner", holder);
        await h.AddReportAsync("SELECT 1 AS one", roleIds: holder);
        Names(await ReadAsync(await runner.GetAsync(List))).ShouldBe(["Report 1"]);

        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"UPDATE dbo.Role SET IsActive = 0 WHERE RoleId = {holder}");

        Names(await ReadAsync(await runner.GetAsync(List))).ShouldBeEmpty();
    }

    [Fact]
    public async Task A_report_comes_back_when_its_assignment_returns_and_a_second_role_does_not_duplicate_it()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var report = await h.AddReportAsync("SELECT 1 AS one", roleIds: role);
        // Same person, a second role that also holds the report: still one row.
        var second = await h.Factory.CreateRoleAsync("Second", ["Matter.View"]);
        await h.Factory.GrantRoleAsync(@"KE\runner", second);
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"INSERT dbo.RoleReport (RoleId, ReportId) VALUES ({second}, {report})");

        Names(await ReadAsync(await runner.GetAsync(List))).ShouldBe(["Report 1"]);

        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"DELETE dbo.RoleReport WHERE ReportId = {report}");
        Names(await ReadAsync(await runner.GetAsync(List))).ShouldBeEmpty();
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"INSERT dbo.RoleReport (RoleId, ReportId) VALUES ({role}, {report})");
        Names(await ReadAsync(await runner.GetAsync(List))).ShouldBe(["Report 1"]);
    }

    [Fact]
    public async Task The_list_is_grouped_by_category_in_the_administrators_order_with_the_data_the_screen_needs()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        const string parameters = """[{"name":"SINCE","type":"date","label":"From"},{"name":"POD","type":"lookup","label":"Pod","lookupKind":"pod"}]""";
        var tasksLate = await h.AddReportAsync("SELECT :SINCE AS f, :POD AS p", parameters, roleIds: role);
        var tasksFirst = await h.AddReportAsync("SELECT 1 AS one", roleIds: role);
        var billing = await h.AddReportAsync("SELECT 2 AS one", roleIds: role);
        await SqlServerFixture.ExecuteAsync(
            h.AppConnection,
            $"""
            INSERT dbo.ReportCategory (Name, SortOrder) VALUES (N'Tasks', 1), (N'Billing', 2);
            UPDATE dbo.ReportCategory SET SortOrder = 9 WHERE Name = N'Test';
            UPDATE dbo.ReportDefinition SET ReportCategoryId = (SELECT ReportCategoryId FROM dbo.ReportCategory WHERE Name = N'Tasks'), SortOrder = 5, Description = N'Late tasks' WHERE ReportId = {tasksLate};
            UPDATE dbo.ReportDefinition SET ReportCategoryId = (SELECT ReportCategoryId FROM dbo.ReportCategory WHERE Name = N'Tasks'), SortOrder = 1 WHERE ReportId = {tasksFirst};
            UPDATE dbo.ReportDefinition SET ReportCategoryId = (SELECT ReportCategoryId FROM dbo.ReportCategory WHERE Name = N'Billing') WHERE ReportId = {billing};
            """);

        var list = await ReadAsync(await runner.GetAsync(List));

        list.GetProperty("totalReports").GetInt32().ShouldBe(3);
        var categories = list.GetProperty("categories").EnumerateArray().ToList();
        categories.Select(c => c.GetProperty("name").GetString()).ShouldBe(["Tasks", "Billing"]);
        categories.Select(c => c.GetProperty("sortOrder").GetInt32()).ShouldBe([1, 2]);
        categories[0].GetProperty("categoryId").GetInt32().ShouldBeGreaterThan(0);
        var tasks = categories[0].GetProperty("reports").EnumerateArray().ToList();
        tasks.Select(r => r.GetProperty("reportId").GetInt32()).ShouldBe([tasksFirst, tasksLate]);
        tasks[0].GetProperty("parameterCount").GetInt32().ShouldBe(0);
        tasks[0].GetProperty("hasParameters").GetBoolean().ShouldBeFalse();
        tasks[0].GetProperty("lastRunAtUtc").ValueKind.ShouldBe(JsonValueKind.Null);
        tasks[1].GetProperty("description").GetString().ShouldBe("Late tasks");
        tasks[1].GetProperty("parameterCount").GetInt32().ShouldBe(2);
        tasks[1].GetProperty("hasParameters").GetBoolean().ShouldBeTrue();
        tasks[1].GetProperty("parameterLabels").EnumerateArray().Select(l => l.GetString()).ShouldBe(["From", "Pod"]);
        categories[1].GetProperty("reports")[0].GetProperty("reportId").GetInt32().ShouldBe(billing);
    }

    [Fact]
    public async Task The_last_run_shown_is_the_callers_own_successful_run_only()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, annRole) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var (bo, boRole) = await h.PersonAsync(@"KE\bo", "Report.Run");
        var report = await h.AddReportAsync("SELECT 1 AS one", roleIds: [annRole, boRole]);

        (await ann.PostAsync($"/api/v1/reports/{report}/runs", ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.OK);

        var annEntry = (await ReadAsync(await ann.GetAsync(List))).GetProperty("categories")[0].GetProperty("reports")[0];
        var boEntry = (await ReadAsync(await bo.GetAsync(List))).GetProperty("categories")[0].GetProperty("reports")[0];
        annEntry.GetProperty("lastRunAtUtc").GetDateTime().ShouldBeGreaterThan(DateTime.UtcNow.AddMinutes(-5));
        annEntry.GetProperty("lastRunAtUtc").GetString().ShouldEndWith("Z");
        boEntry.GetProperty("lastRunAtUtc").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task A_failed_run_and_a_preview_do_not_count_as_the_last_run()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var report = await h.AddReportAsync("SELECT 1 / 0 AS boom", roleIds: role);

        (await runner.PostAsync($"/api/v1/reports/{report}/runs", ReportTestHarness.Parameters(new { }))).IsSuccessStatusCode.ShouldBeFalse();

        var entry = (await ReadAsync(await runner.GetAsync(List))).GetProperty("categories")[0].GetProperty("reports")[0];
        entry.GetProperty("lastRunAtUtc").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task The_body_never_contains_the_sql_option_sql_or_connection_details()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var parameters = $$"""[{"name":"KIND","type":"single","label":"Kind","valueType":"text","optionsKind":"query","optionsSql":"{{SecretOptionSql}}"}]""";
        await h.AddReportAsync($"{SecretSql}, :KIND AS kind", parameters, roleIds: role);

        var body = await BodyAsync(await runner.GetAsync(List));

        body.ShouldNotContain("secret_marker_column");
        body.ShouldNotContain("424242");
        body.ShouldNotContain("secret_option_marker");
        body.ShouldNotContain("optionsSql", Case.Insensitive);
        body.ShouldNotContain("sqlText", Case.Insensitive);
        body.ShouldNotContain("Password", Case.Insensitive);
        body.ShouldNotContain("Server=", Case.Insensitive);
        body.ShouldNotContain("ReportsReadOnly", Case.Insensitive);
        // Exactly the documented members, nothing else.
        var report = JsonDocument.Parse(body).RootElement.GetProperty("categories")[0].GetProperty("reports")[0];
        report.EnumerateObject().Select(p => p.Name).Order().ShouldBe(["description", "hasParameters", "lastRunAtUtc", "name", "parameterCount", "parameterLabels", "reportId", "sortOrder"]);
    }

    [Fact]
    public async Task The_list_works_while_reports_are_off_because_it_reads_only_the_definitions()
    {
        await using var h = await ReportTestHarness.StartAsync(sql, withLogin: false);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        await h.AddReportAsync("SELECT 1 AS one", roleIds: role);

        Names(await ReadAsync(await runner.GetAsync(List))).ShouldBe(["Report 1"]);
    }
}
