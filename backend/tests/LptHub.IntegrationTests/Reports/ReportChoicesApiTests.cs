using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;

namespace MatterFlow.IntegrationTests.Reports;

/// <summary>Choice lists: fixed, SELECT through the same engine and validator, lookups, and the value re-check at run time (epic #671, issue #711).</summary>
[Collection(SqlServerCollection.Name)]
public sealed class ReportChoicesApiTests(SqlServerFixture sql)
{
    private const string Admin = "/api/v1/report-admin";

    private static StringContent Body(object value) => ReportTestHarness.Json(value);

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>();

    private static string Choices(int id, string parameter) => $"/api/v1/reports/{id}/choices/{parameter}";

    private const string QueryParameter =
        "[{\"name\":\"KIND\",\"type\":\"single\",\"label\":\"Kind\",\"isRequired\":true,\"optionsKind\":\"query\",\"optionsSql\":\"SELECT * FROM (VALUES ('a','Alpha'),('b','Beta'),('a','Again')) v(Value, Label)\"}]";

    private const string FixedParameter =
        "[{\"name\":\"KIND\",\"type\":\"single\",\"label\":\"Kind\",\"isRequired\":true,\"optionsKind\":\"fixed\",\"options\":[{\"value\":\"x\",\"label\":\"Ex\"},{\"value\":\"y\",\"label\":\"Why\"}]}]";

    private static async Task<int> CommandCountAsync(ReportTestHarness h) =>
        Convert.ToInt32(await SqlServerFixture.ScalarAsync(h.AppConnection, "SELECT COUNT(*) FROM dbo.ReportRun WHERE Kind = 'ChoiceQuery'"), System.Globalization.CultureInfo.InvariantCulture);

    [Fact]
    public async Task A_fixed_list_is_served_to_a_person_who_may_run_the_report()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var id = await h.AddReportAsync("SELECT :KIND AS k", FixedParameter, roleIds: role);

        var list = await ReadAsync(await runner.PostAsync(Choices(id, "kind"), null));

        list.GetProperty("options").EnumerateArray().Select(o => $"{o.GetProperty("value").GetString()}={o.GetProperty("label").GetString()}").ShouldBe(["x=Ex", "y=Why"]);
        (await CommandCountAsync(h)).ShouldBe(0);
    }

    [Fact]
    public async Task A_SELECT_list_runs_on_the_report_login_is_deduplicated_and_cached_for_five_minutes()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var id = await h.AddReportAsync("SELECT :KIND AS k", QueryParameter, roleIds: role);

        var first = await ReadAsync(await runner.PostAsync(Choices(id, "KIND"), null));
        var second = await ReadAsync(await runner.PostAsync(Choices(id, "KIND"), null));

        first.GetProperty("options").EnumerateArray().Select(o => o.GetProperty("value").GetString()).ShouldBe(["a", "b"]);
        first.GetProperty("options")[0].GetProperty("label").GetString().ShouldBe("Alpha");
        second.ToString().ShouldBe(first.ToString());
        (await CommandCountAsync(h)).ShouldBe(1);
    }

    [Fact]
    public async Task A_submitted_value_that_is_not_in_the_list_gives_422_and_a_listed_one_runs()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var fixedId = await h.AddReportAsync("SELECT :KIND AS k", FixedParameter, roleIds: role);
        var queryId = await h.AddReportAsync("SELECT :KIND AS k", QueryParameter, roleIds: role);

        foreach (var (id, good, bad) in new[] { (fixedId, "x", "z"), (queryId, "b", "c") })
        {
            var ok = await runner.PostAsync($"/api/v1/reports/{id}/runs", ReportTestHarness.Parameters(new { kind = good }));
            ok.StatusCode.ShouldBe(HttpStatusCode.OK, await ok.Content.ReadAsStringAsync());
            var refused = await runner.PostAsync($"/api/v1/reports/{id}/runs", ReportTestHarness.Parameters(new { kind = bad }));
            refused.StatusCode.ShouldBe((HttpStatusCode)422);
            var body = await ReadAsync(refused);
            body.GetProperty("code").GetString().ShouldBe("REPORT_PARAMETERS_INVALID");
            body.GetProperty("errors").GetProperty("parameters.KIND")[0].GetProperty("code").GetString().ShouldBe("NOT_IN_OPTIONS");
        }
    }

    [Fact]
    public async Task A_multi_choice_SELECT_list_with_whole_number_values_binds_through_the_json_parameter()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        const string parameters = "[{\"name\":\"IDS\",\"type\":\"multi\",\"valueType\":\"int\",\"label\":\"Ids\",\"optionsKind\":\"query\",\"optionsSql\":\"SELECT * FROM (VALUES (1,'One'),(2,'Two'),(3,'Three')) v(Value, Label)\"}]";
        var id = await h.AddReportAsync("SELECT n FROM (VALUES (1),(2),(3),(4)) t(n) WHERE n IN (:IDS) ORDER BY n", parameters, roleIds: role);

        var run = await ReadAsync(await runner.PostAsync($"/api/v1/reports/{id}/runs", ReportTestHarness.Parameters(new { ids = new[] { 1, 3 } })));
        run.GetProperty("rowCount").GetInt32().ShouldBe(2);

        var refused = await runner.PostAsync($"/api/v1/reports/{id}/runs", ReportTestHarness.Parameters(new { ids = new[] { 1, 4 } }));
        refused.StatusCode.ShouldBe((HttpStatusCode)422);
    }

    [Fact]
    public async Task A_lookup_parameter_has_no_list_here_and_binds_whole_numbers_single_and_multi()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        const string parameters = "[{\"name\":\"POD\",\"type\":\"lookup\",\"lookupKind\":\"pod\",\"label\":\"Pod\"},{\"name\":\"CLIENTS\",\"type\":\"lookup\",\"lookupKind\":\"client\",\"lookupMulti\":true,\"label\":\"Clients\"}]";
        var id = await h.AddReportAsync("SELECT :POD AS pod, (SELECT COUNT(*) FROM (SELECT 1 AS x WHERE 1 IN (:CLIENTS)) q) AS hit", parameters, roleIds: role);

        var noList = await runner.PostAsync(Choices(id, "POD"), null);
        noList.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await ReadAsync(noList)).GetProperty("code").GetString().ShouldBe("NO_CHOICE_LIST");

        var run = await runner.PostAsync($"/api/v1/reports/{id}/runs", ReportTestHarness.Parameters(new { pod = 7, clients = new[] { 1, 2 } }));
        run.StatusCode.ShouldBe(HttpStatusCode.OK, await run.Content.ReadAsStringAsync());
        (await runner.PostAsync($"/api/v1/reports/{id}/runs", ReportTestHarness.Parameters(new { pod = "7; DROP TABLE dbo.Pod" }))).StatusCode.ShouldBe((HttpStatusCode)422);
    }

    [Fact]
    public async Task The_choices_endpoint_follows_the_run_rules_permission_assignment_and_active()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var (outsider, _) = await h.PersonAsync(@"KE\outsider", "Report.Run");
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var (assigner, _) = await h.PersonAsync(@"KE\assigner", "Report.Assign");
        var id = await h.AddReportAsync("SELECT :KIND AS k", FixedParameter, roleIds: role);
        var inactive = await h.AddReportAsync("SELECT :KIND AS k", FixedParameter, active: false, roleIds: role);

        (await runner.PostAsync(Choices(id, "KIND"), null)).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await outsider.PostAsync(Choices(id, "KIND"), null)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await runner.PostAsync(Choices(inactive, "KIND"), null)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await runner.PostAsync(Choices(id, "NOPE"), null)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await manager.PostAsync(Choices(id, "KIND"), null)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await assigner.PostAsync(Choices(id, "KIND"), null)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task A_failing_choice_query_shows_the_author_the_reason_and_a_runner_only_a_reference()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        const string parameters = "[{\"name\":\"KIND\",\"type\":\"single\",\"label\":\"Kind\",\"optionsKind\":\"query\",\"optionsSql\":\"SELECT EventType AS Value, Summary AS Label FROM dbo.AuditEvent\"}]";
        var id = await h.AddReportAsync("SELECT :KIND AS k", parameters, roleIds: role);

        var forRunner = await runner.PostAsync(Choices(id, "KIND"), null);
        forRunner.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable);
        var text = await forRunner.Content.ReadAsStringAsync();
        text.ShouldNotContain("AuditEvent");
        text.ShouldNotContain("permission");
        (await runner.PostAsync($"/api/v1/reports/{id}/runs", ReportTestHarness.Parameters(new { kind = "x" }))).StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable);

        var test = await ReadAsync(await manager.PostAsync($"{Admin}/reports/{id}/choices/test", Body(new { sql = "SELECT EventType AS Value, Summary AS Label FROM dbo.AuditEvent", valueType = "text" })));
        test.GetProperty("success").GetBoolean().ShouldBeFalse();
        test.GetProperty("errorCode").GetString().ShouldBe("CHOICE_QUERY_FAILED");
        test.GetProperty("error").GetString()!.ShouldContain("permission");
    }

    [Fact]
    public async Task The_author_can_test_a_choice_query_and_bad_ones_are_refused_by_the_same_validator()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var id = await h.AddReportAsync("SELECT 1 AS one", active: false);
        async Task<JsonElement> Test(string text, string type = "text") => await ReadAsync(await manager.PostAsync($"{Admin}/reports/{id}/choices/test", Body(new { sql = text, valueType = type })));

        var ok = await Test("SELECT TOP (150) CAST(n AS nvarchar(10)) AS Value, 'Item ' + CAST(n AS nvarchar(10)) AS Label FROM (SELECT ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b) t");
        ok.GetProperty("success").GetBoolean().ShouldBeTrue();
        ok.GetProperty("total").GetInt32().ShouldBe(150);
        ok.GetProperty("options").GetArrayLength().ShouldBe(100);

        var cap = await Test("SELECT TOP (1500) CAST(n AS nvarchar(10)) AS Value, 'x' AS Label FROM (SELECT ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b) t");
        cap.GetProperty("total").GetInt32().ShouldBe(1000);
        cap.GetProperty("truncated").GetBoolean().ShouldBeTrue();

        (await Test("SELECT 1 AS Wrong, 2 AS Columns")).GetProperty("errorCode").GetString().ShouldBe("CHOICE_COLUMNS");
        (await Test("DELETE dbo.Pod")).GetProperty("errorCode").GetString().ShouldBe("CHOICE_QUERY_REJECTED");
        (await Test("SELECT 'a' AS Value, 'A' AS Label; SELECT 1")).GetProperty("errorCode").GetString().ShouldBe("CHOICE_QUERY_REJECTED");
        (await Test("SELECT :X AS Value, 'A' AS Label")).GetProperty("errorCode").GetString().ShouldBe("CHOICE_QUERY_REJECTED");
        (await Test("SELECT 'a' AS Value, 'A' AS Label", "int")).GetProperty("errorCode").GetString().ShouldBe("CHOICE_QUERY_FAILED");
        (await Test("SELECT CAST(:CURRENT_USER_ID AS nvarchar(10)) AS Value, 'Me' AS Label")).GetProperty("success").GetBoolean().ShouldBeTrue();
        (await manager.PostAsync($"{Admin}/reports/{id}/choices/test", Body(new { sql = "" }))).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await manager.PostAsync($"{Admin}/reports/9999/choices/test", Body(new { sql = "SELECT 1" }))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task A_preview_takes_its_sample_value_from_the_real_SELECT_list_and_an_edited_query_shows_at_once()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var id = await h.AddReportAsync("SELECT :KIND AS k", QueryParameter, active: false);

        var preview = await ReadAsync(await manager.PostAsync($"{Admin}/reports/{id}/preview", Body(new { })));
        preview.GetProperty("success").GetBoolean().ShouldBeTrue(preview.ToString());
        preview.GetProperty("rows")[0][0].GetString().ShouldBe("a");

        var edited = "[{\"name\":\"KIND\",\"type\":\"single\",\"label\":\"Kind\",\"isRequired\":true,\"optionsKind\":\"query\",\"optionsSql\":\"SELECT 'z' AS Value, 'Zed' AS Label\"}]";
        var after = await ReadAsync(await manager.PostAsync($"{Admin}/reports/{id}/preview", Body(new { parameters = JsonDocument.Parse(edited).RootElement })));
        after.GetProperty("rows")[0][0].GetString().ShouldBe("z");
        after.GetProperty("countsForActivation").GetBoolean().ShouldBeFalse();

        var broken = "[{\"name\":\"KIND\",\"type\":\"single\",\"label\":\"Kind\",\"isRequired\":true,\"optionsKind\":\"query\",\"optionsSql\":\"SELECT 1/0 AS Value, 'Zed' AS Label\"}]";
        var failed = await ReadAsync(await manager.PostAsync($"{Admin}/reports/{id}/preview", Body(new { parameters = JsonDocument.Parse(broken).RootElement })));
        failed.GetProperty("success").GetBoolean().ShouldBeFalse();
        failed.GetProperty("parameterErrors")[0].GetProperty("message").GetString()!.ShouldContain("Divide by zero");
    }
}
