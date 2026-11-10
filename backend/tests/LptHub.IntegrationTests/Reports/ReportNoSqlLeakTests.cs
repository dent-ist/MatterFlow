using System.Net;
using System.Text;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.Reports.Domain;
using Shouldly;
using static MatterFlow.IntegrationTests.Reports.ReportSecurityKit;

namespace MatterFlow.IntegrationTests.Reports;

/// <summary>
/// No SQL text for people who only run reports (issue #725, spec 6.8 and 16.3 i, threat 7.8): a report whose definition, choice query and error messages are full
/// of recognisable markers is used through every endpoint a runner, an assigner or a stranger can call, on the happy path and on every error path. No status
/// line, header or body may contain a marker, the hash of the text, SQL keywords from the definition or any word of SQL Server's own messages.
/// </summary>
[Collection(SqlServerCollection.Name)]
[Trait("Suite", "ReportsSecurity")]
public sealed class ReportNoSqlLeakTests(SqlServerFixture sql)
{
    private const string MarkerSql = "leak_marker_sql_8f3a";
    private const string MarkerOptions = "leak_marker_options_77c1";
    private const string MarkerFail = "leak_marker_fail_99ab";
    private const string MarkerValue = "leak_marker_val_55d2";
    private const string MarkerTampered = "leak_marker_tampered_c3d4";

    private sealed record Seen(string Label, int Status, string Headers, string Body, bool IsData);

    private static async Task<Seen> CallAsync(HttpClient client, string label, HttpMethod method, string url, HttpContent? content = null, bool isData = false)
    {
        using var request = new HttpRequestMessage(method, url) { Content = content };
        using var response = await client.SendAsync(request);
        var headers = new StringBuilder();
        foreach (var header in response.Headers.Concat(response.Content.Headers))
            headers.Append(header.Key).Append(": ").AppendJoin(", ", header.Value).Append('\n');
        return new Seen(label, (int)response.StatusCode, headers.ToString(), await response.Content.ReadAsStringAsync(), isData);
    }

    private static void ShouldBeClean(IEnumerable<Seen> seen, string[] secrets)
    {
        foreach (var s in seen)
        {
            foreach (var secret in secrets)
            {
                s.Body.ShouldNotContain(secret, Case.Insensitive, $"{s.Label} body");
                s.Headers.ShouldNotContain(secret, Case.Insensitive, $"{s.Label} headers");
            }

            if (!s.IsData)
                ShouldHoldNoSqlTrace(s.Body, s.Label);
            ShouldHoldNoServerTrace(s.Headers, s.Label + " headers");
        }
    }

    [Fact]
    public async Task No_endpoint_a_runner_an_assigner_or_a_stranger_can_call_shows_SQL_on_success_or_on_failure()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var (assigner, _) = await h.PersonAsync(@"KE\assigner", "Report.Assign");
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var (stranger, _) = await h.PersonAsync(@"KE\stranger", "Report.Run"); // can run reports, none assigned
        var query = $"SELECT n, CAST(:T AS nvarchar(50)) AS t, :KIND AS kind FROM (VALUES (1),(2)) v(n) /* {MarkerSql} */";
        var parameters = $$"""
            [{"name":"T","type":"text","label":"T","maxLength":50},
             {"name":"KIND","type":"single","label":"Kind","optionsKind":"query","optionsSql":"SELECT * FROM (VALUES ('a','Alpha')) v(Value, Label) /* {{MarkerOptions}} */"}]
            """;
        var report = await h.AddReportAsync(query, parameters, roleIds: role);
        var failing = await h.AddReportAsync($"SELECT CAST(N'{MarkerValue}' AS int) AS x /* {MarkerFail} */", roleIds: role);
        var wrongHash = await h.AddReportAsync($"SELECT 1 AS one /* {MarkerTampered} */", hashOverride: new byte[32], roleIds: role);
        var notAQuery = await h.AddReportAsync($"DROP TABLE dbo.AppUser /* {MarkerTampered} */", roleIds: role);
        var secrets = new[]
        {
            MarkerSql, MarkerOptions, MarkerFail, MarkerValue, MarkerTampered, "Conversion failed", "leak_marker",
            Convert.ToHexString(SqlValidator.Hash(query)), Convert.ToHexString(SqlValidator.Hash(query)).ToLowerInvariant(), Convert.ToHexString(SqlValidator.Hash(query))[..16],
        };
        var seen = new List<Seen>();
        static StringContent Body() => ReportTestHarness.Parameters(new { t = "hello", kind = "a" });

        // The runner's happy path, endpoint by endpoint.
        seen.Add(await CallAsync(runner, "list", HttpMethod.Get, "/api/v1/reports"));
        seen.Add(await CallAsync(runner, "definition", HttpMethod.Get, $"/api/v1/reports/{report}"));
        seen.Add(await CallAsync(runner, "choices", HttpMethod.Post, $"/api/v1/reports/{report}/choices/KIND"));
        var run = await CallAsync(runner, "run", HttpMethod.Post, RunUrl(report), Body());
        seen.Add(run);
        run.Status.ShouldBe(200, run.Body);
        var runId = Guid.Parse(System.Text.Json.JsonDocument.Parse(run.Body).RootElement.GetProperty("runId").GetString()!);
        seen.Add(await CallAsync(runner, "rows", HttpMethod.Get, Rows(runId), isData: true));
        seen.Add(await CallAsync(runner, "export", HttpMethod.Get, Export(runId), isData: true));
        var view = await CallAsync(runner, "view create", HttpMethod.Post, $"/api/v1/reports/{report}/views", ReportTestHarness.Json(new { name = "Mine", layout = new { columns = new[] { new { name = "n", hidden = false, width = 100 } }, sort = Array.Empty<object>(), filters = Array.Empty<object>(), pageSize = 50 }, isDefault = true }));
        seen.Add(view);
        view.Status.ShouldBe(201, view.Body);
        var viewId = System.Text.Json.JsonDocument.Parse(view.Body).RootElement.GetProperty("viewId").GetInt32();
        seen.Add(await CallAsync(runner, "view list", HttpMethod.Get, $"/api/v1/reports/{report}/views"));
        seen.Add(await CallAsync(runner, "view update", HttpMethod.Put, $"/api/v1/reports/{report}/views/{viewId}", ReportTestHarness.Json(new { name = "Renamed" })));
        seen.Add(await CallAsync(runner, "view clear default", HttpMethod.Delete, $"/api/v1/reports/{report}/views/{viewId}/default"));
        seen.Add(await CallAsync(runner, "view default", HttpMethod.Post, $"/api/v1/reports/{report}/views/{viewId}/default"));
        seen.Add(await CallAsync(runner, "view delete", HttpMethod.Delete, $"/api/v1/reports/{report}/views/{viewId}"));
        seen.Add(await CallAsync(runner, "cancel", HttpMethod.Delete, "/api/v1/reports/runs/current"));

        // The runner's error paths.
        seen.Add(await CallAsync(runner, "run: bad parameter", HttpMethod.Post, RunUrl(report), ReportTestHarness.Parameters(new { t = new string('x', 80), kind = "zzz", extra = 1 })));
        seen.Add(await CallAsync(runner, "run: built-in", HttpMethod.Post, RunUrl(report), ReportTestHarness.Parameters(new { current_user_id = 5 })));
        seen.Add(await CallAsync(runner, "run: bad json", HttpMethod.Post, RunUrl(report), Raw("{\"parameters\":")));
        var failure = await CallAsync(runner, "run: sql error", HttpMethod.Post, RunUrl(failing), ReportTestHarness.Parameters(new { }));
        seen.Add(failure);
        failure.Status.ShouldBe(500);
        failure.Body.ShouldContain("reference");
        var tampered = await CallAsync(runner, "run: hash mismatch", HttpMethod.Post, RunUrl(wrongHash), ReportTestHarness.Parameters(new { }));
        seen.Add(tampered);
        tampered.Status.ShouldBe(409);
        var invalid = await CallAsync(runner, "run: stored text fails the validator", HttpMethod.Post, RunUrl(notAQuery), ReportTestHarness.Parameters(new { }));
        seen.Add(invalid);
        invalid.Status.ShouldBe(409);
        seen.Add(await CallAsync(runner, "run: unknown report", HttpMethod.Post, RunUrl(987_654), ReportTestHarness.Parameters(new { })));
        seen.Add(await CallAsync(runner, "definition: unknown report", HttpMethod.Get, "/api/v1/reports/987654"));
        seen.Add(await CallAsync(runner, "choices: not a list parameter", HttpMethod.Post, $"/api/v1/reports/{report}/choices/T"));
        seen.Add(await CallAsync(runner, "choices: unknown parameter", HttpMethod.Post, $"/api/v1/reports/{report}/choices/NOPE"));
        seen.Add(await CallAsync(runner, "rows: bad sort", HttpMethod.Get, Rows(runId, "?sort=nope:asc")));
        seen.Add(await CallAsync(runner, "rows: bad filter", HttpMethod.Get, Rows(runId, "?filter=%7Bbroken")));
        seen.Add(await CallAsync(runner, "export: bad column", HttpMethod.Get, Export(runId, "?columns=nope")));
        seen.Add(await CallAsync(runner, "rows: unknown result", HttpMethod.Get, Rows(Guid.NewGuid())));
        await RunOkAsync(runner, report, new { t = "again", kind = "a" }); // replaces the first result
        seen.Add(await CallAsync(runner, "rows: replaced result", HttpMethod.Get, Rows(runId)));
        seen.Add(await CallAsync(runner, "export: replaced result", HttpMethod.Get, Export(runId)));
        seen.Add(await CallAsync(runner, "view: unknown", HttpMethod.Get, $"/api/v1/reports/{report}/views/987654"));
        seen.Add(await CallAsync(runner, "view: bad layout", HttpMethod.Post, $"/api/v1/reports/{report}/views", Raw("{\"name\":\"\",\"layout\":{\"pageSize\":-1}}")));

        // A person with nothing assigned, a person with only the assignment or the manage right, and no login at all.
        foreach (var (label, client) in new[] { ("stranger", stranger), ("assigner", assigner), ("manager", manager) })
        {
            seen.Add(await CallAsync(client, label + ": definition", HttpMethod.Get, $"/api/v1/reports/{report}"));
            seen.Add(await CallAsync(client, label + ": run", HttpMethod.Post, RunUrl(report), Body()));
            seen.Add(await CallAsync(client, label + ": rows of another's result", HttpMethod.Get, Rows(runId)));
            seen.Add(await CallAsync(client, label + ": choices", HttpMethod.Post, $"/api/v1/reports/{report}/choices/KIND"));
            seen.Add(await CallAsync(client, label + ": views", HttpMethod.Get, $"/api/v1/reports/{report}/views"));
        }

        seen.Add(await CallAsync(assigner, "assigner: assignment matrix", HttpMethod.Get, "/api/v1/report-admin/assignment-matrix"));
        seen.Add(await CallAsync(assigner, "assigner: roles of the report", HttpMethod.Get, $"/api/v1/report-admin/reports/{report}/roles"));
        seen.Add(await CallAsync(assigner, "assigner: reports of the role", HttpMethod.Get, $"/api/v1/report-admin/roles/{role}/reports"));
        seen.Add(await CallAsync(assigner, "assigner: report details", HttpMethod.Get, $"/api/v1/report-admin/reports/{report}"));
        seen.Add(await CallAsync(assigner, "assigner: versions", HttpMethod.Get, $"/api/v1/report-admin/reports/{report}/versions/1"));
        seen.Add(await CallAsync(runner, "runner: report details", HttpMethod.Get, $"/api/v1/report-admin/reports/{report}"));
        seen.Add(await CallAsync(runner, "runner: versions", HttpMethod.Get, $"/api/v1/report-admin/reports/{report}/versions/1"));
        seen.Add(await CallAsync(runner, "runner: run log", HttpMethod.Get, $"/api/v1/report-admin/reports/{report}/runs"));
        seen.Add(await CallAsync(runner, "runner: schema", HttpMethod.Get, "/api/v1/report-admin/schema"));
        using var anonymous = h.Factory.CreateClient();
        seen.Add(await CallAsync(anonymous, "anonymous: list", HttpMethod.Get, "/api/v1/reports"));
        seen.Add(await CallAsync(anonymous, "anonymous: run", HttpMethod.Post, RunUrl(report), Body()));

        seen.Count.ShouldBeGreaterThan(50);
        seen.Select(s => s.Status).ShouldNotContain(s => s >= 500 && s != 500, "only the one deliberate failing run is a 500");
        seen.Count(s => s.Status == 500).ShouldBe(1);
        ShouldBeClean(seen, secrets);

        // The data itself is data: the export holds the cell values and no definition.
        var csv = seen.Single(s => s.Label == "export").Body;
        csv.ShouldContain("hello");
        (await CallAsync(manager, "manager: details", HttpMethod.Get, $"/api/v1/report-admin/reports/{report}")).Body.ShouldContain(MarkerSql); // authors are meant to see the text: the control that the check above can fail
    }

    [Fact]
    public async Task While_reports_are_off_the_answers_say_so_without_naming_the_connection_or_the_login()
    {
        await using var h = await ReportTestHarness.StartAsync(sql, withLogin: false);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var report = await h.AddReportAsync($"SELECT 1 AS one /* {MarkerSql} */", "[{\"name\":\"KIND\",\"type\":\"single\",\"label\":\"Kind\",\"optionsKind\":\"query\",\"optionsSql\":\"SELECT 'a' AS Value, 'A' AS Label\"}]", roleIds: role);
        var seen = new List<Seen>
        {
            await CallAsync(runner, "run", HttpMethod.Post, RunUrl(report), ReportTestHarness.Parameters(new { })),
            await CallAsync(runner, "choices", HttpMethod.Post, $"/api/v1/reports/{report}/choices/KIND"),
            await CallAsync(runner, "list", HttpMethod.Get, "/api/v1/reports"),
            await CallAsync(runner, "definition", HttpMethod.Get, $"/api/v1/reports/{report}"),
        };

        seen[0].Status.ShouldBe((int)HttpStatusCode.ServiceUnavailable);
        ShouldBeClean(seen, [MarkerSql, "ReportsReadOnly", "ConnectionStrings", "mf_report_reader", "mf_reports", "Password", "Server=", "Data Source", h.Login.Name]);
    }
}
