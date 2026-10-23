using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.Reports.Infrastructure;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Shouldly;

namespace MatterFlow.IntegrationTests.Reports;

/// <summary>The run log, its audit events, the definition-change events and the retention (epic #671, issue #707).</summary>
[Collection(SqlServerCollection.Name)]
public sealed class ReportAuditApiTests(SqlServerFixture sql)
{
    private static string RunUrl(int id) => $"/api/v1/reports/{id}/runs";

    private static string Admin(int id, string action) => $"/api/v1/report-admin/reports/{id}/{action}";

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>();

    /// <summary>All audit rows about reports, oldest first.</summary>
    private static async Task<List<JsonElement>> AuditAsync(ReportTestHarness h, int? reportId = null)
    {
        await using var c = new SqlConnection(h.AppConnection);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT AuditEventId, ActorUserId, EventType, ObjectType, ObjectId, FieldKey, OldValue, NewValue, Summary, CorrelationId FROM dbo.AuditEvent WHERE ObjectType = 'Report' AND (@r IS NULL OR ObjectId = CAST(@r AS varchar(40))) ORDER BY AuditEventId FOR JSON PATH";
        cmd.Parameters.AddWithValue("@r", (object?)reportId ?? DBNull.Value);
        var json = await ReportTestHarness.ReadJsonAsync(cmd);
        return JsonDocument.Parse(json).RootElement.EnumerateArray().Select(e => e.Clone()).ToList();
    }

    private static string?[] Types(IEnumerable<JsonElement> events) => events.Select(e => e.GetProperty("EventType").GetString()).ToArray();

    [Fact]
    public async Task A_run_writes_one_compact_audit_event_with_the_parameters_and_never_the_sql()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        const string query = "SELECT n FROM (VALUES (1),(2),(3)) v(n) WHERE n <= :MAX /* very_secret_marker */";
        var id = await h.AddReportAsync(query, "[{\"name\":\"MAX\",\"type\":\"number\",\"label\":\"Max\",\"integerOnly\":true}]", roleIds: role);
        var userId = await h.Tasks.UserIdAsync(@"KE\runner");

        (await runner.PostAsync(RunUrl(id), ReportTestHarness.Parameters(new { max = 2 }))).StatusCode.ShouldBe(HttpStatusCode.OK);

        var events = await AuditAsync(h, id);
        var run = events.ShouldHaveSingleItem();
        run.GetProperty("EventType").GetString().ShouldBe("REPORT_RUN");
        run.GetProperty("ActorUserId").GetInt32().ShouldBe(userId);
        run.GetProperty("Summary").GetString().ShouldBe("Ran report 'Report 1' (version 1): Succeeded, 2 rows");
        var details = JsonDocument.Parse(run.GetProperty("NewValue").GetString()!).RootElement;
        details.GetProperty("rows").GetInt32().ShouldBe(2);
        details.GetProperty("parameters")[0].GetString().ShouldBe("MAX=2");
        var everything = string.Join(" ", events.Select(e => e.ToString()));
        everything.ShouldNotContain("very_secret_marker");
        everything.ShouldNotContain("SELECT");
        // The audit event and the run log row share the correlation id.
        var log = (await h.RunLogAsync(id)).EnumerateArray().ShouldHaveSingleItem();
        (await SqlServerFixture.ScalarAsync(h.AppConnection, $"SELECT COUNT(*) FROM dbo.ReportRun r JOIN dbo.AuditEvent a ON a.CorrelationId = r.CorrelationId WHERE r.ReportRunId = {log.GetProperty("ReportRunId").GetInt64()}")).ShouldBe(1);
    }

    [Fact]
    public async Task Previews_and_bad_parameters_are_in_the_run_log_only_but_a_tampered_text_is_audited()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var good = await h.AddReportAsync("SELECT :N AS n", "[{\"name\":\"N\",\"type\":\"number\",\"label\":\"N\",\"isRequired\":true}]", roleIds: role);
        var tampered = await h.AddReportAsync("SELECT 1 AS one", hashOverride: new byte[32], roleIds: role);

        await manager.PostAsync(Admin(good, "preview"), ReportTestHarness.Json(new { }));
        await runner.PostAsync(RunUrl(good), ReportTestHarness.Parameters(new { n = "x" }));
        await runner.PostAsync(RunUrl(tampered), ReportTestHarness.Parameters(new { }));

        (await AuditAsync(h, good)).ShouldBeEmpty();
        var events = await AuditAsync(h, tampered);
        var tamper = events.ShouldHaveSingleItem();
        tamper.GetProperty("EventType").GetString().ShouldBe("REPORT_RUN");
        tamper.GetProperty("Summary").GetString()!.ShouldContain("Rejected");
        JsonDocument.Parse(tamper.GetProperty("NewValue").GetString()!).RootElement.GetProperty("error").GetString().ShouldBe("HASH_MISMATCH");
        (await h.RunLogAsync(good)).EnumerateArray().Select(r => r.GetProperty("Kind").GetString() + ":" + r.GetProperty("Status").GetString()).ShouldBe(["Preview:Succeeded", "Run:Rejected"]);
    }

    [Fact]
    public async Task Definition_changes_are_audited_without_the_sql_text()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var id = await h.AddReportAsync("SELECT 1 AS one /* original_marker */", active: false);

        await manager.PostAsync(Admin(id, "preview"), ReportTestHarness.Json(new { }));
        await manager.PostAsync(Admin(id, "activate"), null);
        await manager.PostAsync(Admin(id, "activate"), null); // already active: nothing new
        await manager.PostAsync(Admin(id, "versions"), ReportTestHarness.Json(new { sql = "SELECT 2 AS two /* changed_marker */", parameters = new[] { new { name = "X", type = "text", label = "X" } }, changeNote = "n" }));
        await manager.PostAsync(Admin(id, "preview"), ReportTestHarness.Json(new { }));
        await manager.PostAsync(Admin(id, "activate"), null);
        await manager.PostAsync(Admin(id, "deactivate"), null);
        await manager.PostAsync(Admin(id, "deactivate"), null); // already off: nothing new

        var events = await AuditAsync(h, id);
        Types(events).ShouldBe(["REPORT_ACTIVATED", "REPORT_UPDATED", "REPORT_PARAMETERS_CHANGED", "REPORT_DEACTIVATED", "REPORT_ACTIVATED", "REPORT_DEACTIVATED"]);
        var updated = events[1];
        updated.GetProperty("OldValue").GetString()!.ShouldStartWith("v1 ");
        updated.GetProperty("NewValue").GetString()!.ShouldStartWith("v2 ");
        updated.GetProperty("Summary").GetString().ShouldBe("Report 'Report 1': SQL saved as version 2");
        events[2].GetProperty("NewValue").GetString().ShouldBe("X");
        events[3].GetProperty("Summary").GetString()!.ShouldContain("not previewed");
        events[0].GetProperty("ActorUserId").GetInt32().ShouldBe(await h.Tasks.UserIdAsync(@"KE\manager"));
        var everything = string.Join(" ", events.Select(e => e.ToString()));
        everything.ShouldNotContain("original_marker");
        everything.ShouldNotContain("changed_marker");
    }

    [Fact]
    public async Task Report_events_show_up_in_the_audit_browser_and_its_filters()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var id = await h.AddReportAsync("SELECT 1 AS one", roleIds: role);
        await runner.PostAsync(RunUrl(id), ReportTestHarness.Parameters(new { }));

        var search = await ReadAsync(await h.Tasks.Admin.GetAsync("/api/v1/audit/search?objectType=Report"));
        var facets = await ReadAsync(await h.Tasks.Admin.GetAsync("/api/v1/audit/facets"));

        var item = search.GetProperty("items").EnumerateArray().ShouldHaveSingleItem();
        item.GetProperty("eventType").GetString().ShouldBe("REPORT_RUN");
        item.GetProperty("object").GetProperty("type").GetString().ShouldBe("Report");
        facets.GetProperty("objectTypes").EnumerateArray().Select(e => e.GetString()).ShouldContain("Report");
        facets.GetProperty("eventTypes").EnumerateArray().Select(e => e.GetString()).ShouldContain("REPORT_RUN");
    }

    [Fact]
    public async Task Long_parameter_values_are_shortened_to_fit_the_log_and_the_audit_columns()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var names = Enumerable.Range(1, 14).Select(i => "T" + i).ToArray();
        var defs = "[" + string.Join(",", names.Select(n => $"{{\"name\":\"{n}\",\"type\":\"text\",\"label\":\"{n}\"}}")) + "]";
        var id = await h.AddReportAsync("SELECT LEN(" + string.Join(" + ", names.Select(n => ":" + n)) + ") AS total", defs, roleIds: role);
        var values = names.ToDictionary(n => n, _ => new string('x', 390));

        var response = await runner.PostAsync(RunUrl(id), ReportTestHarness.Parameters(values));

        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        var log = (await h.RunLogAsync(id)).EnumerateArray().ShouldHaveSingleItem();
        var stored = log.GetProperty("ParametersJson").GetString()!;
        stored.Length.ShouldBeLessThanOrEqualTo(4000);
        JsonDocument.Parse(stored); // still valid JSON
        var audit = (await AuditAsync(h, id)).ShouldHaveSingleItem();
        audit.GetProperty("NewValue").GetString()!.Length.ShouldBeLessThanOrEqualTo(4000);
        audit.GetProperty("Summary").GetString()!.Length.ShouldBeLessThanOrEqualTo(500);
    }

    // ---- run log endpoint ----

    [Fact]
    public async Task The_run_log_endpoint_lists_runs_newest_first_with_filters_paging_and_names()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var a = await h.AddReportAsync("SELECT :N AS n", "[{\"name\":\"N\",\"type\":\"number\",\"label\":\"N\"}]", roleIds: role);
        var b = await h.AddReportAsync("SELECT 1 / 0 AS boom", roleIds: role);
        foreach (var n in new[] { 1, 2, 3 })
            await runner.PostAsync(RunUrl(a), ReportTestHarness.Parameters(new { n }));
        await runner.PostAsync(RunUrl(b), ReportTestHarness.Parameters(new { }));
        await manager.PostAsync(Admin(a, "preview"), ReportTestHarness.Json(new { }));

        var all = await ReadAsync(await manager.GetAsync("/api/v1/report-admin/runs"));
        var items = all.GetProperty("items");
        items.GetArrayLength().ShouldBe(5);
        items[0].GetProperty("kind").GetString().ShouldBe("Preview");
        items[1].GetProperty("status").GetString().ShouldBe("Failed");
        items[1].GetProperty("errorCode").GetString().ShouldBe("SQL_8134");
        items[2].GetProperty("userName").GetString().ShouldNotBeNullOrEmpty();
        items[2].GetProperty("parameters")[0].GetString().ShouldBe("N=3");
        items[2].GetProperty("reportName").GetString().ShouldBe("Report 1");

        var failedOnly = await ReadAsync(await manager.GetAsync("/api/v1/report-admin/runs?status=Failed"));
        failedOnly.GetProperty("items").GetArrayLength().ShouldBe(1);
        var ofReport = await ReadAsync(await manager.GetAsync($"/api/v1/report-admin/reports/{a}/runs?pageSize=2"));
        ofReport.GetProperty("items").GetArrayLength().ShouldBe(2);
        var next = ofReport.GetProperty("nextBefore").GetInt64();
        var older = await ReadAsync(await manager.GetAsync($"/api/v1/report-admin/reports/{a}/runs?pageSize=2&before={next + 1}"));
        older.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("runId").GetInt64()).ShouldNotContain(0);
        older.GetProperty("items").GetArrayLength().ShouldBeGreaterThan(0);
        (await ReadAsync(await manager.GetAsync("/api/v1/report-admin/runs?kind=Preview"))).GetProperty("items").GetArrayLength().ShouldBe(1);
    }

    [Fact]
    public async Task Only_Report_Manage_may_read_the_run_log()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var id = await h.AddReportAsync("SELECT 1 AS one");
        foreach (var (client, _) in new[]
                 {
                     await h.PersonAsync(@"KE\run", "Report.Run"),
                     await h.PersonAsync(@"KE\assign", "Report.Assign"),
                     await h.PersonAsync(@"KE\none", "Matter.View"),
                 })
        {
            (await client.GetAsync("/api/v1/report-admin/runs")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await client.GetAsync($"/api/v1/report-admin/reports/{id}/runs")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        }

        (await h.Tasks.Admin.GetAsync("/api/v1/report-admin/runs")).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    // ---- retention ----

    [Fact]
    public async Task The_retention_job_deletes_runs_older_than_two_years_and_nothing_else()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var id = await h.AddReportAsync("SELECT 1 AS one", roleIds: role);
        await runner.PostAsync(RunUrl(id), ReportTestHarness.Parameters(new { }));
        var userId = await h.Tasks.UserIdAsync(@"KE\runner");
        await SqlServerFixture.ExecuteAsync(h.AppConnection,
            $"INSERT dbo.ReportRun (ReportId, ReportVersionId, UserId, StartedAt, FinishedAt, Status, Kind, CorrelationId) VALUES ({id}, 1, {userId}, DATEADD(YEAR, -2, DATEADD(DAY, -1, SYSUTCDATETIME())), SYSUTCDATETIME(), 'Succeeded', 'Run', NEWID()), ({id}, 1, {userId}, DATEADD(YEAR, -2, DATEADD(DAY, 3, SYSUTCDATETIME())), SYSUTCDATETIME(), 'Succeeded', 'Run', NEWID())");
        var job = h.Factory.Services.GetServices<IHostedService>().OfType<ReportRunRetentionService>().Single();

        var purged = await job.PurgeAsync(CancellationToken.None);

        purged.ShouldBe(1);
        (await SqlServerFixture.ScalarAsync(h.AppConnection, $"SELECT COUNT(*) FROM dbo.ReportRun WHERE ReportId = {id}")).ShouldBe(2);
        (await job.PurgeAsync(CancellationToken.None)).ShouldBe(0);
    }
}
