using System.Net;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.Data.SqlClient;
using Shouldly;
using static MatterFlow.IntegrationTests.Reports.ReportSecurityKit;

namespace MatterFlow.IntegrationTests.Reports;

/// <summary>
/// The interim rule for sensitive matters (issue #808, owner decision 2, option A), pinned as it is documented in <c>docs/ux/reports-review/status-2026-11.md</c>
/// and the Reports Module wiki page: a report reads every matter, sensitive ones included, whatever the person's matter rights are, so <c>Report.Run</c> plus an
/// assignment is the only gate and assignment is meant for trusted roles; the run audit is neutral (no parameter value, no matter); the report login cannot call
/// the visibility functions or read the audit trail. These tests describe today's behaviour on purpose: when filtered views or trusted roles are decided, they
/// are the lines that must change together with the code.
/// </summary>
[Collection(SqlServerCollection.Name)]
[Trait("Suite", "ReportsSecurity")]
public sealed class ReportSensitiveMatterInterimTests(SqlServerFixture sql)
{
    private const string Sentinel = "SENTINEL_sensitive_matter_Z9";

    private static async Task<(ReportTestHarness H, int Sensitive, int Open)> StartAsync(SqlServerFixture sql)
    {
        var h = await ReportTestHarness.StartAsync(sql, true, ("Features:SensitiveMatterAccess", "true"));
        var sensitive = await h.Tasks.CreateMatterAsync("343", "12");
        var open = await h.Tasks.CreateMatterAsync("343", "13");
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"UPDATE dbo.Matter SET IsSensitive = 1, Name = N'{Sentinel}' WHERE MatterId = {sensitive}");
        h.Factory.InvalidateAll();
        return (h, sensitive, open);
    }

    [Fact]
    public async Task Option_A_as_documented_a_report_shows_a_sensitive_matter_to_a_person_who_cannot_open_it_any_other_way()
    {
        var (h, sensitive, open) = await StartAsync(sql);
        await using var _h = h;
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run", "Matter.View"); // no Matter.ViewSensitive, not a manager of the matter
        var report = await h.AddReportAsync("SELECT MatterId, Name, IsSensitive FROM dbo.Matter ORDER BY MatterId", roleIds: role);

        // Through the application the matter is hidden: a 404, like a matter that does not exist.
        (await runner.GetAsync($"/api/v1/matters/{open}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        var hidden = await runner.GetAsync($"/api/v1/matters/{sensitive}");
        hidden.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await hidden.Content.ReadAsStringAsync()).ShouldNotContain(Sentinel);
        (await ReadAsync(await runner.GetAsync("/api/v1/matters?q=SENTINEL"))).ToString().ShouldNotContain(Sentinel);

        // Through the report it is there: the report login reads the tables, not the application's visibility rule.
        var run = await RunOkAsync(runner, report);
        var page = await ReadAsync(await runner.GetAsync(Rows(run)));
        var rows = page.GetProperty("rows").EnumerateArray().Select(r => (Id: r[0].GetInt32(), Name: r[1].GetString(), Flag: r[2])).ToList();
        rows.Select(r => r.Id).ShouldBe([sensitive, open]);
        rows.Single(r => r.Id == sensitive).Name.ShouldBe(Sentinel, "option A: reports are not filtered by the sensitive-matter rule");
        (await DownloadCsvAsync(runner, Export(run))).Select(r => r[1]).ShouldContain(Sentinel);
    }

    [Fact]
    public async Task Assignment_is_the_gate_a_person_with_every_matter_right_but_no_assignment_gets_the_same_404_as_for_a_report_that_does_not_exist()
    {
        var (h, _, _) = await StartAsync(sql);
        await using var _h = h;
        var (trusted, role) = await h.PersonAsync(@"KE\trusted", "Report.Run");
        var (director, _) = await h.PersonAsync(@"KE\director2", "Report.Run", "Matter.View", "Matter.ViewSensitive");
        var report = await h.AddReportAsync("SELECT MatterId, Name FROM dbo.Matter", roleIds: role);

        (await director.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await director.GetAsync($"/api/v1/reports/{report}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await ReadAsync(await director.GetAsync("/api/v1/reports"))).GetProperty("totalReports").GetInt32().ShouldBe(0);
        (await trusted.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.OK);

        // Assigning the report is what opens it, and the assignment is audited with the roles by name.
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"DELETE dbo.RoleReport WHERE ReportId = {report}");
        (await trusted.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task The_run_audit_is_neutral_no_matter_no_value_no_scope_and_it_is_visible_to_an_auditor_who_may_not_see_the_matter()
    {
        var (h, sensitive, _) = await StartAsync(sql);
        await using var _h = h;
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var (auditor, _) = await h.PersonAsync(@"KE\auditor", "Audit.View"); // no Matter.ViewSensitive
        var report = await h.AddReportAsync(
            "SELECT m.MatterId, m.Name FROM dbo.Matter m WHERE m.MatterId = :MATTER",
            "[{\"name\":\"MATTER\",\"type\":\"lookup\",\"lookupKind\":\"matter\",\"label\":\"Matter\",\"isRequired\":true}]",
            roleIds: role);

        var run = await RunOkAsync(runner, report, new { matter = sensitive });
        (await ReadAsync(await runner.GetAsync(Rows(run)))).GetProperty("rows")[0][1].GetString().ShouldBe(Sentinel);
        (await DownloadCsvAsync(runner, Export(run))).Count.ShouldBe(2);

        var events = await h.AuditAsync(report);
        events.Count.ShouldBe(2);
        events.ShouldAllBe(e => !e.ToString().Contains(Sentinel, StringComparison.Ordinal));

        var run0 = JsonDocument.Parse(events[0].GetProperty("NewValue").GetString()!).RootElement;
        run0.GetProperty("parameterNames").EnumerateArray().Select(n => n.GetString()).ShouldBe(["MATTER"]);
        run0.GetProperty("parameterCount").GetInt32().ShouldBe(1);
        events[0].GetProperty("NewValue").GetString()!.ShouldNotContain("MATTER=");
        (await CountAsync(h.AppConnection, "SELECT COUNT(*) FROM dbo.AuditEvent WHERE EventType IN (N'REPORT_RUN', N'REPORT_EXPORT') AND (MatterId IS NOT NULL OR IsSensitiveScope = 1)")).ShouldBe(0);

        // Every Audit.View holder reads these events (they have no matter scope), and finds nothing sensitive in them.
        var browser = await auditor.GetAsync("/api/v1/audit/search?objectType=Report&pageSize=100");
        browser.StatusCode.ShouldBe(HttpStatusCode.OK);
        var shown = await browser.Content.ReadAsStringAsync();
        shown.ShouldContain("REPORT_RUN");
        shown.ShouldNotContain(Sentinel);
        shown.ShouldNotContain("MATTER=");

        // The value as bound is in the run log for authors only.
        var log = await manager.GetAsync($"/api/v1/report-admin/reports/{report}/runs");
        (await log.Content.ReadAsStringAsync()).ShouldContain($"MATTER={sensitive}");
        (await auditor.GetAsync($"/api/v1/report-admin/reports/{report}/runs")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await runner.GetAsync($"/api/v1/report-admin/reports/{report}/runs")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task The_report_login_cannot_call_the_visibility_functions_or_read_the_audit_scope_so_it_cannot_widen_or_probe_the_rule()
    {
        var (h, _, _) = await StartAsync(sql);
        await using var _h = h;

        foreach (var statement in new[]
                 {
                     "SELECT * FROM dbo.fnMatterVisible(1, 1)", "SELECT * FROM dbo.fnTaskVisible(1, 1)", "SELECT * FROM dbo.fnAssetVisible(1, 1)", "SELECT IsSensitiveScope FROM dbo.AuditEvent",
                     "SELECT COUNT(*) FROM dbo.AuditEvent WHERE IsSensitiveScope = 1",
                 })
        {
            var ex = await Should.ThrowAsync<SqlException>(() => SqlServerFixture.ScalarAsync(h.Login.ConnectionString, statement), statement);
            ex.Message.ShouldContain("permission was denied", Case.Insensitive, statement);
        }

        // And a report cannot ask for the person's own view of the matters either: there is no function to call and no table that says who may see what.
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var report = await h.AddReportAsync("SELECT * FROM dbo.fnMatterVisible(1, 0)", roleIds: role);
        var response = await runner.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { }));
        response.StatusCode.ShouldBe(HttpStatusCode.InternalServerError);
        var body = await response.Content.ReadAsStringAsync();
        body.ShouldContain("reference");
        ShouldHoldNoSqlTrace(body, "denied function");
        body.ShouldNotContain("fnMatterVisible");
    }
}
