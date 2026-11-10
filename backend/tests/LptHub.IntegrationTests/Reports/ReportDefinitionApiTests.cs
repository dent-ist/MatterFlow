using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;

namespace MatterFlow.IntegrationTests.Reports;

/// <summary>GET /api/v1/reports/{id}: the definition the run page needs, without SQL, and 404 for anything the person may not run (issue #719).</summary>
[Collection(SqlServerCollection.Name)]
public sealed class ReportDefinitionApiTests(SqlServerFixture sql)
{
    private const string SecretSql = "SELECT 424242 AS secret_marker_column";
    private const string SecretOptionSql = "SELECT 'secret_option_marker' AS Value, 'x' AS Label";

    private static string Url(int id) => $"/api/v1/reports/{id}";

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>();

    [Fact]
    public async Task Persona_cases_decide_who_gets_the_definition_and_everything_else_looks_like_not_found_or_forbidden()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (assigned, role) = await h.PersonAsync(@"KE\assigned", "Report.Run");
        var (unassigned, _) = await h.PersonAsync(@"KE\unassigned", "Report.Run");
        var (manager, managerRole) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var (assigner, assignerRole) = await h.PersonAsync(@"KE\assigner", "Report.Assign");
        var (nobody, nobodyRole) = await h.PersonAsync(@"KE\nobody", "Matter.View");
        var active = await h.AddReportAsync(SecretSql, roleIds: [role, managerRole, assignerRole, nobodyRole]);
        var inactive = await h.AddReportAsync("SELECT 2 AS two", active: false, roleIds: role);
        var noVersion = await h.AddReportAsync("SELECT 3 AS three", roleIds: role);
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"UPDATE dbo.ReportDefinition SET CurrentVersionId = NULL, IsActive = 0 WHERE ReportId = {noVersion}");

        (await assigned.GetAsync(Url(active))).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await assigned.GetAsync(Url(inactive))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await assigned.GetAsync(Url(noVersion))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await assigned.GetAsync(Url(9999))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await unassigned.GetAsync(Url(active))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await manager.GetAsync(Url(active))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await assigner.GetAsync(Url(active))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await nobody.GetAsync(Url(active))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await h.Factory.CreateClient().GetAsync(Url(active))).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task The_missing_report_the_inactive_report_and_the_unassigned_report_answer_the_same_404_byte_for_byte()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var (_, otherRole) = await h.PersonAsync(@"KE\other", "Report.Run");
        var inactive = await h.AddReportAsync("SELECT 1 AS one", active: false, roleIds: role);
        var foreign = await h.AddReportAsync("SELECT 2 AS two", roleIds: otherRole);

        var bodies = new List<string>();
        foreach (var id in new[] { 9999, inactive, foreign })
        {
            var response = await runner.GetAsync(Url(id));
            response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
            var problem = await ReadAsync(response);
            problem.GetProperty("code").GetString().ShouldBe("NOT_FOUND");
            bodies.Add(problem.GetProperty("detail").GetString()! + problem.GetProperty("title").GetString() + problem.GetProperty("status").GetInt32());
        }

        bodies.Distinct().Count().ShouldBe(1);
    }

    [Fact]
    public async Task The_definition_has_the_details_and_the_parameters_in_the_shape_the_form_needs()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        const string parameters = """
            [
              {"name":"SINCE","type":"date","label":"Since","isRequired":true,"default":"startOfMonth"},
              {"name":"KIND","type":"single","label":"Kind","valueType":"text","optionsKind":"fixed","options":[{"value":"a","label":"Alpha"}],"helpText":"Pick one."},
              {"name":"AREA","type":"multi","label":"Area","valueType":"int","optionsKind":"query","optionsSql":"SELECT 1 AS Value, 'secret_option_marker' AS Label"},
              {"name":"MATTER","type":"lookup","label":"Matter","lookupKind":"matter"},
              {"name":"PODS","type":"lookup","label":"Pods","lookupKind":"pod","lookupMulti":true,"default":"myPods"},
              {"name":"LIMIT","type":"number","label":"Limit","min":1,"max":100,"integerOnly":true},
              {"name":"OPEN","type":"yesNo","label":"Open only","default":true},
              {"name":"NOTE","type":"text","label":"Contains","maxLength":40},
              {"name":"NOT_USED","type":"text","label":"Not in the SQL"}
            ]
            """;
        var report = await h.AddReportAsync(
            "SELECT :SINCE AS since, :KIND AS kind, 1 AS area, :MATTER AS matter, :LIMIT AS lim, :OPEN AS o, :NOTE AS note WHERE 1 IN :PODS AND 1 IN :AREA",
            parameters,
            timeoutSeconds: 20,
            maxRows: 1000,
            roleIds: role);
        await SqlServerFixture.ExecuteAsync(
            h.AppConnection,
            $"UPDATE dbo.ReportDefinition SET Description = N'Short line.', HelpText = N'Long help text.', SortOrder = 3 WHERE ReportId = {report}");

        var definition = await ReadAsync(await runner.GetAsync(Url(report)));

        definition.GetProperty("reportId").GetInt32().ShouldBe(report);
        definition.GetProperty("name").GetString().ShouldBe("Report 1");
        definition.GetProperty("description").GetString().ShouldBe("Short line.");
        definition.GetProperty("helpText").GetString().ShouldBe("Long help text.");
        definition.GetProperty("categoryName").GetString().ShouldBe("Test");
        definition.GetProperty("versionNo").GetInt32().ShouldBe(1);
        definition.GetProperty("timeoutSeconds").GetInt32().ShouldBe(20);
        definition.GetProperty("maxRows").GetInt32().ShouldBe(1000);
        var list = definition.GetProperty("parameters").EnumerateArray().ToList();
        list.Select(p => p.GetProperty("name").GetString()).ShouldBe(["SINCE", "KIND", "AREA", "MATTER", "PODS", "LIMIT", "OPEN", "NOTE"]);

        JsonElement P(string name) => list.Single(p => p.GetProperty("name").GetString() == name);
        P("SINCE").GetProperty("type").GetString().ShouldBe("date");
        P("SINCE").GetProperty("required").GetBoolean().ShouldBeTrue();
        P("SINCE").GetProperty("default").GetString()!.ShouldMatch(@"^\d{4}-\d{2}-01$");
        P("KIND").GetProperty("choicesSource").GetString().ShouldBe("fixed");
        P("KIND").GetProperty("helpText").GetString().ShouldBe("Pick one.");
        P("KIND").GetProperty("options")[0].GetProperty("label").GetString().ShouldBe("Alpha");
        P("AREA").GetProperty("choicesSource").GetString().ShouldBe("query");
        P("AREA").GetProperty("options").GetArrayLength().ShouldBe(0);
        P("AREA").GetProperty("multiple").GetBoolean().ShouldBeTrue();
        P("MATTER").GetProperty("lookupKind").GetString().ShouldBe("matter");
        P("PODS").GetProperty("multiple").GetBoolean().ShouldBeTrue();
        P("PODS").GetProperty("default").ValueKind.ShouldBe(JsonValueKind.Array);
        P("LIMIT").GetProperty("min").GetDecimal().ShouldBe(1m);
        P("LIMIT").GetProperty("max").GetDecimal().ShouldBe(100m);
        P("LIMIT").GetProperty("integerOnly").GetBoolean().ShouldBeTrue();
        P("OPEN").GetProperty("default").GetBoolean().ShouldBeTrue();
        P("NOTE").GetProperty("maxLength").GetInt32().ShouldBe(40);
    }

    [Fact]
    public async Task A_report_without_parameters_has_an_empty_list_and_the_default_limits()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var report = await h.AddReportAsync("SELECT 1 AS one", roleIds: role);

        var definition = await ReadAsync(await runner.GetAsync(Url(report)));

        definition.GetProperty("parameters").GetArrayLength().ShouldBe(0);
        definition.GetProperty("description").ValueKind.ShouldBe(JsonValueKind.Null);
        definition.GetProperty("timeoutSeconds").GetInt32().ShouldBeGreaterThan(0);
        definition.GetProperty("maxRows").GetInt32().ShouldBeGreaterThan(0);
    }

    [Fact]
    public async Task The_body_never_contains_the_sql_the_option_sql_the_hash_or_connection_details()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var parameters = $$"""[{"name":"KIND","type":"single","label":"Kind","valueType":"text","optionsKind":"query","optionsSql":"{{SecretOptionSql}}"}]""";
        var report = await h.AddReportAsync($"{SecretSql}, :KIND AS kind", parameters, roleIds: role);

        var response = await runner.GetAsync(Url(report));
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = await response.Content.ReadAsStringAsync();

        body.ShouldNotContain("secret_marker_column");
        body.ShouldNotContain("424242");
        body.ShouldNotContain("secret_option_marker");
        body.ShouldNotContain("optionsSql", Case.Insensitive);
        body.ShouldNotContain("sqlText", Case.Insensitive);
        body.ShouldNotContain("sqlHash", Case.Insensitive);
        body.ShouldNotContain("Password", Case.Insensitive);
        body.ShouldNotContain("Server=", Case.Insensitive);
        body.ShouldNotContain("ReportsReadOnly", Case.Insensitive);
        JsonDocument.Parse(body).RootElement.EnumerateObject().Select(p => p.Name).Order().ShouldBe(
            ["categoryId", "categoryName", "description", "helpText", "maxRows", "name", "parameters", "reportId", "timeoutSeconds", "versionNo"]);
    }

    [Fact]
    public async Task The_default_the_definition_gives_is_accepted_by_a_run()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var report = await h.AddReportAsync("SELECT :N AS n", """[{"name":"N","type":"number","label":"Number","isRequired":true,"default":5}]""", roleIds: role);

        var definition = await ReadAsync(await runner.GetAsync(Url(report)));
        var parameter = definition.GetProperty("parameters")[0];
        var run = await runner.PostAsync($"/api/v1/reports/{report}/runs", ReportTestHarness.Parameters(new Dictionary<string, JsonElement> { [parameter.GetProperty("name").GetString()!] = parameter.GetProperty("default") }));

        run.StatusCode.ShouldBe(HttpStatusCode.OK, await run.Content.ReadAsStringAsync());
        definition.GetProperty("versionNo").GetInt32().ShouldBe(1);
    }

    [Fact]
    public async Task The_definition_is_readable_while_reports_are_off()
    {
        await using var h = await ReportTestHarness.StartAsync(sql, withLogin: false);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var report = await h.AddReportAsync("SELECT 1 AS one", roleIds: role);

        (await runner.GetAsync(Url(report))).StatusCode.ShouldBe(HttpStatusCode.OK);
    }
}
