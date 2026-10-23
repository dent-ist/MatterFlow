using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using MatterFlow.Reports.Api;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

namespace MatterFlow.IntegrationTests.Reports;

/// <summary>
/// POST /api/v1/reports/{id}/runs against a real API, SQL Server and the read-only report login (epic #671, issue #702): the run itself, the
/// limits (time, rows, one per person, global, hourly), what errors reveal, and who may run what.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class ReportRunApiTests(SqlServerFixture sql)
{
    private static string RunUrl(int reportId) => $"/api/v1/reports/{reportId}/runs";

    private const string Slow = "SELECT COUNT_BIG(*) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b CROSS JOIN sys.all_objects c CROSS JOIN sys.all_objects d";

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage response) => await response.Content.ReadFromJsonAsync<JsonElement>();

    [Fact]
    public async Task A_run_returns_the_columns_and_row_count_and_is_logged()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var id = await h.AddReportAsync(
            "SELECT n, N'row ' + CAST(n AS nvarchar(10)) AS label, CAST(n AS decimal(9,2)) AS amount, CAST('2026-10-22' AS date) AS day FROM (VALUES (1),(2),(3)) v(n) WHERE n <= :MAX",
            "[{\"name\":\"MAX\",\"type\":\"number\",\"label\":\"Max\",\"integerOnly\":true,\"isRequired\":true}]",
            roleIds: role);

        var response = await runner.PostAsync(RunUrl(id), ReportTestHarness.Parameters(new { max = 2 }));

        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        var body = await ReadAsync(response);
        body.GetProperty("rowCount").GetInt32().ShouldBe(2);
        body.GetProperty("truncated").GetBoolean().ShouldBeFalse();
        body.GetProperty("columns").EnumerateArray().Select(c => $"{c.GetProperty("name").GetString()}:{c.GetProperty("type").GetString()}")
            .ShouldBe(["n:integer", "label:text", "amount:decimal", "day:date"]);
        Guid.TryParse(body.GetProperty("runId").GetString(), out _).ShouldBeTrue();

        var log = (await h.RunLogAsync(id)).EnumerateArray().ShouldHaveSingleItem();
        log.GetProperty("Status").GetString().ShouldBe("Succeeded");
        log.GetProperty("Kind").GetString().ShouldBe("Run");
        log.GetProperty("RowCount").GetInt32().ShouldBe(2);
        log.GetProperty("ParametersJson").GetString().ShouldBe("[\"MAX=2\"]");
        log.GetProperty("FinishedAt").ValueKind.ShouldNotBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task The_report_runs_as_the_report_login_never_as_the_application_login()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var id = await h.AddReportAsync("SELECT SUSER_SNAME() AS who, APP_NAME() AS app, IS_MEMBER('mf_report_reader') AS reader", roleIds: role);

        var response = await runner.PostAsync(RunUrl(id), ReportTestHarness.Parameters(new { }));

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var runId = Guid.Parse((await ReadAsync(response)).GetProperty("runId").GetString()!);
        var userId = await h.Tasks.UserIdAsync(@"KE\runner");
        var stored = h.Factory.Services.GetRequiredService<MatterFlow.Reports.Infrastructure.InMemoryResultStore>().Get(userId, runId)!;
        var row = stored.Rows.ShouldHaveSingleItem();
        row[0].ShouldBe(h.Login.Name);
        row[0].ShouldNotBe(new SqlConnectionStringBuilder(h.AppConnection).UserID);
        row[1].ShouldBe("MatterFlow.Reports");
        row[2].ShouldBe(1);
    }

    [Fact]
    public async Task A_query_over_the_time_limit_is_cancelled_and_logged_as_timed_out()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var id = await h.AddReportAsync(Slow, timeoutSeconds: 2, roleIds: role);

        var started = DateTime.UtcNow;
        var response = await runner.PostAsync(RunUrl(id), ReportTestHarness.Parameters(new { }));
        var took = DateTime.UtcNow - started;

        response.StatusCode.ShouldBe(HttpStatusCode.RequestTimeout);
        (await ReadAsync(response)).GetProperty("code").GetString().ShouldBe("REPORT_TIMEOUT");
        took.ShouldBeLessThan(TimeSpan.FromSeconds(15));
        (await h.RunLogAsync(id)).EnumerateArray().ShouldHaveSingleItem().GetProperty("Status").GetString().ShouldBe("TimedOut");

        // The statement is gone from the server too (no running request left by the report login).
        await Task.Delay(1500);
        (await SqlServerFixture.ScalarAsync(h.AppConnection, $"SELECT COUNT(*) FROM sys.dm_exec_requests r JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id WHERE s.login_name = N'{h.Login.Name}' AND r.session_id <> @@SPID"))
            .ShouldBe(0);
    }

    [Fact]
    public async Task A_result_over_the_row_cap_is_cut_off_and_flagged()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var id = await h.AddReportAsync("SELECT TOP (100) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b", maxRows: 10, roleIds: role);
        var exact = await h.AddReportAsync("SELECT TOP (10) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b", maxRows: 10, roleIds: role);

        var cut = await ReadAsync(await runner.PostAsync(RunUrl(id), ReportTestHarness.Parameters(new { })));
        var whole = await ReadAsync(await runner.PostAsync(RunUrl(exact), ReportTestHarness.Parameters(new { })));

        cut.GetProperty("rowCount").GetInt32().ShouldBe(10);
        cut.GetProperty("truncated").GetBoolean().ShouldBeTrue();
        cut.GetProperty("maxRows").GetInt32().ShouldBe(10);
        whole.GetProperty("rowCount").GetInt32().ShouldBe(10);
        whole.GetProperty("truncated").GetBoolean().ShouldBeFalse(); // exactly the cap is not a truncation
        var log = (await h.RunLogAsync(id)).EnumerateArray().ShouldHaveSingleItem();
        log.GetProperty("Status").GetString().ShouldBe("Truncated");
        log.GetProperty("Truncated").GetBoolean().ShouldBeTrue();
    }

    [Fact]
    public async Task A_second_run_by_the_same_person_gets_409_until_the_first_is_cancelled()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var slow = await h.AddReportAsync(Slow, timeoutSeconds: 60, roleIds: role);
        var quick = await h.AddReportAsync("SELECT 1 AS one", roleIds: role);

        var first = runner.PostAsync(RunUrl(slow), ReportTestHarness.Parameters(new { }));
        await Task.Delay(1500);
        var second = await runner.PostAsync(RunUrl(quick), ReportTestHarness.Parameters(new { }));

        second.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ReadAsync(second)).GetProperty("code").GetString().ShouldBe("REPORT_ALREADY_RUNNING");

        (await runner.DeleteAsync("/api/v1/reports/runs/current")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        var cancelled = await first;
        ((int)cancelled.StatusCode).ShouldBe(499);
        (await ReadAsync(cancelled)).GetProperty("code").GetString().ShouldBe("REPORT_CANCELLED");

        (await runner.PostAsync(RunUrl(quick), ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await h.RunLogAsync(slow)).EnumerateArray().ShouldHaveSingleItem().GetProperty("Status").GetString().ShouldBe("Cancelled");
    }

    [Fact]
    public async Task The_global_cap_answers_429_busy()
    {
        await using var h = await ReportTestHarness.StartAsync(sql, true, ("Reports:GlobalConcurrency", "1"));
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var (bo, _) = await h.PersonAsync(@"KE\bo", "Report.Run");
        var slow = await h.AddReportAsync(Slow, timeoutSeconds: 60, roleIds: role);
        var quick = await h.AddReportAsync("SELECT 1 AS one", roleIds: role);
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"INSERT dbo.UserRole (UserId, RoleId) SELECT u.UserId, {role} FROM dbo.UserIdentity u WHERE u.Username = N'KE\\bo' AND NOT EXISTS (SELECT 1 FROM dbo.UserRole x WHERE x.UserId = u.UserId AND x.RoleId = {role})");
        h.Factory.InvalidateAll();

        var first = ann.PostAsync(RunUrl(slow), ReportTestHarness.Parameters(new { }));
        await Task.Delay(1500);
        var busy = await bo.PostAsync(RunUrl(quick), ReportTestHarness.Parameters(new { }));

        busy.StatusCode.ShouldBe(HttpStatusCode.TooManyRequests);
        (await ReadAsync(busy)).GetProperty("code").GetString().ShouldBe("REPORT_BUSY");
        await ann.DeleteAsync("/api/v1/reports/runs/current");
        await first;
        (await bo.PostAsync(RunUrl(quick), ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task The_hourly_budget_answers_429_rate_limited()
    {
        await using var h = await ReportTestHarness.StartAsync(sql, true, ("Reports:RunsPerUserPerHour", "2"));
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var id = await h.AddReportAsync("SELECT 1 AS one", roleIds: role);

        (await runner.PostAsync(RunUrl(id), ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await runner.PostAsync(RunUrl(id), ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.OK);
        var third = await runner.PostAsync(RunUrl(id), ReportTestHarness.Parameters(new { }));

        third.StatusCode.ShouldBe(HttpStatusCode.TooManyRequests);
        (await ReadAsync(third)).GetProperty("code").GetString().ShouldBe("REPORT_RATE_LIMITED");
    }

    [Fact]
    public async Task A_failing_query_shows_the_caller_a_reference_and_never_SQL_text_or_server_messages()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var id = await h.AddReportAsync("SELECT 1 / 0 AS boom FROM dbo.AppUser UNION ALL SELECT 1 / 0", roleIds: role);
        var denied = await h.AddReportAsync("SELECT COUNT(*) AS n FROM dbo.AuditEvent", roleIds: role);

        foreach (var report in new[] { id, denied })
        {
            var response = await runner.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { }));
            var text = await response.Content.ReadAsStringAsync();

            response.StatusCode.ShouldBe(HttpStatusCode.InternalServerError);
            JsonDocument.Parse(text).RootElement.GetProperty("code").GetString().ShouldBe("REPORT_FAILED");
            text.ShouldContain("reference");
            foreach (var leak in new[] { "divide", "AuditEvent", "AppUser", "SELECT", "permission", "object", "dbo" })
                text.ShouldNotContain(leak, Case.Insensitive);
        }

        var log = (await h.RunLogAsync(id)).EnumerateArray().ShouldHaveSingleItem();
        log.GetProperty("Status").GetString().ShouldBe("Failed");
        log.GetProperty("ErrorCode").GetString().ShouldBe("SQL_8134");
        (await h.RunLogAsync(denied)).EnumerateArray().ShouldHaveSingleItem().GetProperty("ErrorCode").GetString().ShouldBe("SQL_229");
    }

    [Fact]
    public async Task Invalid_parameter_values_are_422_with_the_parameter_name_and_nothing_runs()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var id = await h.AddReportAsync(
            "SELECT :N AS n, :WHEN AS d",
            "[{\"name\":\"N\",\"type\":\"number\",\"label\":\"N\",\"isRequired\":true},{\"name\":\"WHEN\",\"type\":\"date\",\"label\":\"When\"}]",
            roleIds: role);

        var response = await runner.PostAsync(RunUrl(id), ReportTestHarness.Parameters(new { n = "1; DROP TABLE dbo.AppUser", when = "2026-02-30", CURRENT_USER_ID = 1 }));

        ((int)response.StatusCode).ShouldBe(422);
        var body = await ReadAsync(response);
        body.GetProperty("code").GetString().ShouldBe("REPORT_PARAMETERS_INVALID");
        var errors = body.GetProperty("errors");
        errors.GetProperty("parameters.N")[0].GetProperty("code").GetString().ShouldBe("INVALID_TYPE");
        errors.GetProperty("parameters.WHEN")[0].GetProperty("code").GetString().ShouldBe("INVALID_DATE");
        errors.GetProperty("parameters.CURRENT_USER_ID")[0].GetProperty("code").GetString().ShouldBe("BUILTIN_NOT_ALLOWED");
        var log = (await h.RunLogAsync(id)).EnumerateArray().ShouldHaveSingleItem();
        log.GetProperty("Status").GetString().ShouldBe("Rejected");
        log.GetProperty("ErrorCode").GetString().ShouldBe("PARAMETERS_INVALID");
        (await SqlServerFixture.ScalarAsync(h.AppConnection, "SELECT COUNT(*) FROM dbo.AppUser")).ShouldNotBeNull();
    }

    [Fact]
    public async Task Built_in_values_are_supplied_by_the_server()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var id = await h.AddReportAsync("SELECT :CURRENT_USER_ID AS me, :TODAY AS today, :FIRM_TIME_ZONE_OFFSET_MINUTES AS offset_minutes", roleIds: role);

        var response = await runner.PostAsync(RunUrl(id), ReportTestHarness.Parameters(new { }));

        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        (await ReadAsync(response)).GetProperty("rowCount").GetInt32().ShouldBe(1);
    }

    [Fact]
    public async Task A_stored_text_that_no_longer_matches_its_hash_or_the_validator_is_refused_and_logged()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var wrongHash = await h.AddReportAsync("SELECT 1 AS one", hashOverride: new byte[32], roleIds: role);
        var notAQuery = await h.AddReportAsync("DROP TABLE dbo.AppUser", roleIds: role);

        foreach (var (report, code) in new[] { (wrongHash, "HASH_MISMATCH"), (notAQuery, "VALIDATION_FAILED") })
        {
            var response = await runner.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { }));
            response.StatusCode.ShouldBe(HttpStatusCode.Conflict);
            (await ReadAsync(response)).GetProperty("code").GetString().ShouldBe("REPORT_INVALID");
            (await h.RunLogAsync(report)).EnumerateArray().ShouldHaveSingleItem().GetProperty("ErrorCode").GetString().ShouldBe(code);
        }

        (await SqlServerFixture.ScalarAsync(h.AppConnection, "SELECT COUNT(*) FROM sys.tables WHERE name = 'AppUser'")).ShouldBe(1);
    }

    [Fact]
    public async Task Reports_are_off_without_a_report_login()
    {
        await using var h = await ReportTestHarness.StartAsync(sql, withLogin: false);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var id = await h.AddReportAsync("SELECT 1 AS one", roleIds: role);

        var response = await runner.PostAsync(RunUrl(id), ReportTestHarness.Parameters(new { }));

        response.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable);
        var body = await ReadAsync(response);
        body.GetProperty("code").GetString().ShouldBe("REPORTS_UNAVAILABLE");
        (await response.Content.ReadAsStringAsync()).ShouldNotContain("ReportsReadOnly");
    }

    // ---- who may run what ----

    [Fact]
    public async Task Only_Report_Run_plus_an_assigned_role_may_run_and_everything_else_looks_like_not_found_or_forbidden()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (assigned, role) = await h.PersonAsync(@"KE\assigned", "Report.Run");
        var (unassigned, _) = await h.PersonAsync(@"KE\unassigned", "Report.Run");
        var (manager, managerRole) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var (assigner, assignerRole) = await h.PersonAsync(@"KE\assigner", "Report.Assign");
        var (nobody, nobodyRole) = await h.PersonAsync(@"KE\nobody", "Matter.View");
        var active = await h.AddReportAsync("SELECT 1 AS one", roleIds: [role, managerRole, assignerRole, nobodyRole]);
        var inactive = await h.AddReportAsync("SELECT 1 AS one", active: false, roleIds: role);
        var body = ReportTestHarness.Parameters(new { });

        (await assigned.PostAsync(RunUrl(active), body)).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await assigned.PostAsync(RunUrl(inactive), body)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await assigned.PostAsync(RunUrl(9999), body)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await unassigned.PostAsync(RunUrl(active), body)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await manager.PostAsync(RunUrl(active), body)).StatusCode.ShouldBe(HttpStatusCode.Forbidden); // Manage does not imply Run
        (await assigner.PostAsync(RunUrl(active), body)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await nobody.PostAsync(RunUrl(active), body)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await assigned.DeleteAsync("/api/v1/reports/runs/current")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await manager.DeleteAsync("/api/v1/reports/runs/current")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }
}
