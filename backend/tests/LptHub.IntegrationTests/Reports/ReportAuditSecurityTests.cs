using System.Net;
using System.Text.Json;
using LptHub.IntegrationTests.Fixtures;
using Microsoft.Data.SqlClient;
using Shouldly;
using static LptHub.IntegrationTests.Reports.ReportSecurityKit;

namespace LptHub.IntegrationTests.Reports;

/// <summary>
/// The audit trail of Reports as a security control (issue #725, spec 13 and 16.3, issue #808 decision 2): one event per run and export and none for refused
/// requests, written for the right person, and never holding a value somebody typed. Every holder of <c>Audit.View</c> reads these events, so a parameter value
/// there would be a leak; the values stay in the run log, which only <c>Report.Manage</c> reads.
/// </summary>
[Collection(SqlServerCollection.Name)]
[Trait("Suite", "ReportsSecurity")]
public sealed class ReportAuditSecurityTests(SqlServerFixture sql)
{
    private const string Slow = "SELECT COUNT_BIG(*) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b CROSS JOIN sys.all_objects c CROSS JOIN sys.all_objects d";

    private static async Task<string> AllAuditTextAsync(string connectionString)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT * FROM dbo.AuditEvent FOR JSON PATH, INCLUDE_NULL_VALUES";
        return await ReportTestHarness.ReadJsonAsync(command);
    }

    private static async Task<string[]> EventsAsync(ReportTestHarness h, int report) => ReportTestHarness.EventTypes(await h.AuditAsync(report)).Select(e => e!).ToArray();

    [Fact]
    public async Task No_value_a_person_typed_reaches_any_audit_row_or_the_audit_browser_but_the_run_log_keeps_it_for_authors_only()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        const string parameters = """
            [{"name":"T","type":"text","label":"T"},{"name":"N","type":"number","label":"N"},{"name":"IDS","type":"lookup","lookupKind":"matter","lookupMulti":true,"label":"Ids"},
             {"name":"D","type":"date","label":"D"},{"name":"S","type":"single","label":"S","optionsKind":"fixed","options":[{"value":"secretchoice_K4","label":"K"}]},
             {"name":"R","type":"dateRange","label":"R"}]
            """;
        var report = await h.AddReportAsync("SELECT :T AS t, :N AS n, (SELECT COUNT(*) FROM :IDS) AS ids, :D AS d, :S AS s, :R_FROM AS rf", parameters, roleIds: role);
        var failing = await h.AddReportAsync("SELECT CAST(:T AS int) AS x", "[{\"name\":\"T\",\"type\":\"text\",\"label\":\"T\"}]", roleIds: role);
        var slow = await h.AddReportAsync(Slow + " WHERE LEN(:T) > 0", "[{\"name\":\"T\",\"type\":\"text\",\"label\":\"T\"}]", timeoutSeconds: 2, roleIds: role);
        string[] secrets = ["secret_text_Q7Z", "424242.5", "777001", "777002", "2031-02-03", "2032-04-05", "secretchoice_K4", "secret_filter_ZZ", "secret_bad_number_H9", "secret_timeout_W3"];

        var run = await RunOkAsync(runner, report, new { t = "secret_text_Q7Z", n = 424242.5, ids = new[] { 777001, 777002 }, d = "2031-02-03", s = "secretchoice_K4", r = new { from = "2032-04-05", to = "2033-01-01" } });
        ((int)(await runner.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { n = "secret_bad_number_H9" }))).StatusCode).ShouldBe(422);
        (await runner.PostAsync(RunUrl(failing), ReportTestHarness.Parameters(new { t = "secret_text_Q7Z" }))).StatusCode.ShouldBe(HttpStatusCode.InternalServerError);
        (await runner.PostAsync(RunUrl(slow), ReportTestHarness.Parameters(new { t = "secret_timeout_W3" }))).StatusCode.ShouldBe(HttpStatusCode.RequestTimeout);
        var filter = Uri.EscapeDataString("[{\"column\":\"t\",\"op\":\"contains\",\"value\":\"secret_filter_ZZ\"}]");
        (await runner.GetAsync(Export(run, "?filter=" + filter))).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await runner.GetAsync(Rows(run, "?filter=" + filter))).StatusCode.ShouldBe(HttpStatusCode.OK);

        var audit = await AllAuditTextAsync(h.AppConnection);
        foreach (var secret in secrets)
            audit.ShouldNotContain(secret, Case.Insensitive, "audit rows");
        audit.ShouldContain("REPORT_RUN");
        audit.ShouldContain("REPORT_EXPORT");

        // What an Audit.View holder reads through the application.
        foreach (var url in new[] { $"/api/v1/audit/events?objectType=Report&objectId={report}", $"/api/v1/audit/events?objectType=Report&objectId={failing}", "/api/v1/audit/search?objectType=Report&pageSize=100", "/api/v1/audit/search?eventType=REPORT_RUN&pageSize=100", "/api/v1/audit/search?eventType=REPORT_EXPORT&pageSize=100" })
        {
            var response = await h.Tasks.Admin.GetAsync(url);
            response.StatusCode.ShouldBe(HttpStatusCode.OK, url);
            var text = await response.Content.ReadAsStringAsync();
            text.ShouldContain("REPORT_");
            foreach (var secret in secrets)
                text.ShouldNotContain(secret, Case.Insensitive, url);
        }

        foreach (var secret in new[] { "secret_text_Q7Z", "777001", "secret_filter_ZZ" })
        {
            var hits = await ReadAsync(await h.Tasks.Admin.GetAsync("/api/v1/audit/search?q=" + secret));
            hits.GetProperty("items").GetArrayLength().ShouldBe(0, $"searching the audit trail for a typed value ({secret}) finds nothing");
        }

        // The run log is where the values are, and only for authors.
        var (nobody, _) = await h.PersonAsync(@"KE\nobody", "Matter.View", "Audit.View");
        var log = await manager.GetAsync($"/api/v1/report-admin/reports/{report}/runs");
        log.StatusCode.ShouldBe(HttpStatusCode.OK);
        var logText = await log.Content.ReadAsStringAsync();
        logText.ShouldContain("secret_text_Q7Z");
        foreach (var url in new[] { $"/api/v1/report-admin/reports/{report}/runs", "/api/v1/report-admin/runs" })
        {
            (await runner.GetAsync(url)).StatusCode.ShouldBe(HttpStatusCode.Forbidden, url);
            (await nobody.GetAsync(url)).StatusCode.ShouldBe(HttpStatusCode.Forbidden, url);
        }
    }

    [Fact]
    public async Task One_event_per_run_and_export_for_the_right_person_and_none_for_a_request_that_was_refused()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var (stranger, _) = await h.PersonAsync(@"KE\stranger", "Report.Run");
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var report = await h.AddReportAsync("SELECT :N AS n", "[{\"name\":\"N\",\"type\":\"number\",\"label\":\"N\"}]", roleIds: role);
        var slow = await h.AddReportAsync(Slow, timeoutSeconds: 4, roleIds: role);
        var failing = await h.AddReportAsync("SELECT 1 / 0 AS x", roleIds: role);
        var runnerId = await h.Tasks.UserIdAsync(@"KE\runner");

        // Refused before anything ran: no event.
        ((int)(await runner.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { n = "abc" }))).StatusCode).ShouldBe(422);
        (await stranger.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await manager.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await runner.PostAsync(RunUrl(987_654), ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await EventsAsync(h, report)).ShouldBeEmpty();

        // One run, one event, whatever the outcome.
        var run = await RunOkAsync(runner, report, new { n = 1 });
        (await EventsAsync(h, report)).ShouldBe(["REPORT_RUN"]);
        (await runner.GetAsync(Rows(run))).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await runner.GetAsync(Rows(run, "?sort=nope:asc"))).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await runner.GetAsync(Export(run, "?sort=nope:asc"))).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await stranger.GetAsync(Export(run))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await manager.GetAsync(Export(run))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await EventsAsync(h, report)).ShouldBe(["REPORT_RUN"]); // reading, refused sorts and other people's attempts write nothing

        (await runner.GetAsync(Export(run))).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await runner.GetAsync(Export(run, "?sort=n:desc"))).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await EventsAsync(h, report)).ShouldBe(["REPORT_RUN", "REPORT_EXPORT", "REPORT_EXPORT"]);
        (await runner.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { n = 2 }))).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await runner.GetAsync(Export(run))).StatusCode.ShouldBe(HttpStatusCode.Gone); // replaced
        (await EventsAsync(h, report)).ShouldBe(["REPORT_RUN", "REPORT_EXPORT", "REPORT_EXPORT", "REPORT_RUN"]);

        // Failed, timed out and cancelled runs are events too, with their outcome, and a refused second run is not.
        (await runner.PostAsync(RunUrl(failing), ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.InternalServerError);
        var cancelled = runner.PostAsync(RunUrl(slow), ReportTestHarness.Parameters(new { }));
        await Task.Delay(1200);
        (await runner.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await runner.DeleteAsync("/api/v1/reports/runs/current")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        ((int)(await cancelled).StatusCode).ShouldBe(499);
        (await runner.PostAsync(RunUrl(slow), ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.RequestTimeout);

        (await EventsAsync(h, failing)).ShouldBe(["REPORT_RUN"]);
        var slowEvents = await h.AuditAsync(slow);
        slowEvents.Select(e => JsonDocument.Parse(e.GetProperty("NewValue").GetString()!).RootElement.GetProperty("status").GetString()).ShouldBe(["Cancelled", "TimedOut"]);
        JsonDocument.Parse((await h.AuditAsync(failing)).Single().GetProperty("NewValue").GetString()!).RootElement.GetProperty("error").GetString().ShouldBe("SQL_8134");
        (await EventsAsync(h, report)).ShouldBe(["REPORT_RUN", "REPORT_EXPORT", "REPORT_EXPORT", "REPORT_RUN"], "the 409 left nothing");

        // Everything is attributed to the person who did it, never to the application's own identity or to somebody else.
        var all = (await h.AuditAsync(report)).Concat(slowEvents).Concat(await h.AuditAsync(failing)).ToList();
        all.ShouldAllBe(e => e.GetProperty("ActorUserId").GetInt32() == runnerId);
        all.ShouldAllBe(e => e.GetProperty("ObjectType").GetString() == "Report");
        (await CountAsync(h.AppConnection, "SELECT COUNT(*) FROM dbo.AuditEvent WHERE EventType LIKE N'REPORT[_]%' AND MatterId IS NOT NULL")).ShouldBe(0, "Reports events carry no matter scope (issue #808, option A)");
    }
}
