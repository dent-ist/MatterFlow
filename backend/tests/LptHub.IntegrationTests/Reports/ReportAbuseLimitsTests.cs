using System.Net;
using LptHub.IntegrationTests.Fixtures;
using Shouldly;
using static LptHub.IntegrationTests.Reports.ReportSecurityKit;

namespace LptHub.IntegrationTests.Reports;

/// <summary>
/// Abuse of the runner (issue #725, spec 6.5 and threat 7.4): concurrent runs of one person and of many, cancel and client disconnect, the row cap and its
/// ceiling, huge parameter lists and texts, oversized SQL in every place a text can enter, and the budget per hour. <c>ReportRunApiTests</c> already covers
/// one limit at a time (time limit, row cap, 409, the global 429 and the hourly 429, each in its simplest form); these tests make the limits meet.
/// </summary>
[Collection(SqlServerCollection.Name)]
[Trait("Suite", "ReportsSecurity")]
public sealed class ReportAbuseLimitsTests(SqlServerFixture sql)
{
    private const string Slow = "SELECT COUNT_BIG(*) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b CROSS JOIN sys.all_objects c CROSS JOIN sys.all_objects d";

    private static async Task<long> RunningRequestsOfLoginAsync(ReportTestHarness h) =>
        await CountAsync(h.AppConnection, $"SELECT COUNT(*) FROM sys.dm_exec_requests r JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id WHERE s.login_name = N'{h.Login.Name}' AND r.session_id <> @@SPID");

    private static async Task WaitUntilNoRequestAsync(ReportTestHarness h)
    {
        for (var i = 0; i < 40 && await RunningRequestsOfLoginAsync(h) > 0; i++)
            await Task.Delay(250);
        (await RunningRequestsOfLoginAsync(h)).ShouldBe(0, "no statement of the report login is left on the server");
    }

    [Fact]
    public async Task One_person_firing_many_runs_at_once_gets_exactly_one_through_and_nothing_stays_locked()
    {
        await using var h = await ReportTestHarness.StartAsync(sql, true, ("Reports:RunsPerUserPerHour", "1000"));
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var slow = await h.AddReportAsync(Slow, timeoutSeconds: 3, roleIds: role);
        var quick = await h.AddReportAsync("SELECT 1 AS one", roleIds: role);

        var responses = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => runner.PostAsync(RunUrl(slow), ReportTestHarness.Parameters(new { }))));

        responses.Count(r => r.StatusCode == HttpStatusCode.RequestTimeout).ShouldBe(1, "exactly one run reached the server and hit its time limit");
        responses.Count(r => r.StatusCode == HttpStatusCode.Conflict).ShouldBe(7);
        responses.ShouldNotContain(r => (int)r.StatusCode >= 500);
        (await h.RunLogAsync(slow)).GetArrayLength().ShouldBe(1, "a refused request leaves no run behind");
        await WaitUntilNoRequestAsync(h);
        (await runner.PostAsync(RunUrl(quick), ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.OK); // the lease was released
    }

    [Fact]
    public async Task Many_people_running_at_once_never_exceed_the_global_cap_and_the_rest_are_told_to_come_back()
    {
        await using var h = await ReportTestHarness.StartAsync(sql, true, ("Reports:GlobalConcurrency", "2"));
        var (first, role) = await h.PersonAsync(@"KE\p1", "Report.Run");
        var clients = new List<HttpClient> { first };
        foreach (var n in new[] { 2, 3, 4, 5 })
            clients.Add((await h.PersonAsync($@"KE\p{n}", "Report.Run")).Client);
        var slow = await h.AddReportAsync(Slow, timeoutSeconds: 3, roleIds: role);
        foreach (var n in new[] { 2, 3, 4, 5 })
            await SqlServerFixture.ExecuteAsync(h.AppConnection, $"INSERT dbo.UserRole (UserId, RoleId) SELECT u.UserId, {role} FROM dbo.UserIdentity u WHERE u.Username = N'KE\\p{n}' AND NOT EXISTS (SELECT 1 FROM dbo.UserRole x WHERE x.UserId = u.UserId AND x.RoleId = {role})");
        h.Factory.InvalidateAll();

        var responses = await Task.WhenAll(clients.Select(c => c.PostAsync(RunUrl(slow), ReportTestHarness.Parameters(new { }))));

        responses.Count(r => r.StatusCode == HttpStatusCode.RequestTimeout).ShouldBe(2, "at most two ran");
        responses.Count(r => r.StatusCode == HttpStatusCode.TooManyRequests).ShouldBe(3);
        responses.ShouldNotContain(r => (int)r.StatusCode >= 500);
        foreach (var busy in responses.Where(r => r.StatusCode == HttpStatusCode.TooManyRequests))
            (await ReadAsync(busy)).GetProperty("code").GetString().ShouldBe("REPORT_BUSY");
        await WaitUntilNoRequestAsync(h);
        (await first.PostAsync(RunUrl(slow), ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.RequestTimeout); // capacity is back
    }

    [Fact]
    public async Task Cancel_stops_only_my_own_run_and_does_nothing_when_nothing_runs()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var (bo, _) = await h.PersonAsync(@"KE\bo", "Report.Run");
        var slow = await h.AddReportAsync(Slow, timeoutSeconds: 4, roleIds: role);

        (await bo.DeleteAsync("/api/v1/reports/runs/current")).StatusCode.ShouldBe(HttpStatusCode.NoContent); // nothing running: harmless
        var running = ann.PostAsync(RunUrl(slow), ReportTestHarness.Parameters(new { }));
        await Task.Delay(1200);
        (await bo.DeleteAsync("/api/v1/reports/runs/current")).StatusCode.ShouldBe(HttpStatusCode.NoContent); // bo's cancel does not reach ann's run
        (await bo.DeleteAsync($"/api/v1/reports/runs/{Guid.NewGuid()}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        (await running).StatusCode.ShouldBe(HttpStatusCode.RequestTimeout, "ann's run went on to its own time limit");
        (await h.RunLogAsync(slow)).EnumerateArray().ShouldHaveSingleItem().GetProperty("Status").GetString().ShouldBe("TimedOut");
        await WaitUntilNoRequestAsync(h);
    }

    [Fact]
    public async Task A_client_that_goes_away_cancels_its_query_on_the_server()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var slow = await h.AddReportAsync(Slow, timeoutSeconds: 60, roleIds: role);
        using var gone = new CancellationTokenSource();

        var call = ann.PostAsync(RunUrl(slow), ReportTestHarness.Parameters(new { }), gone.Token);
        await Task.Delay(1500);
        (await RunningRequestsOfLoginAsync(h)).ShouldBeGreaterThan(0, "the query is running");
        await gone.CancelAsync();
        try
        {
            await call;
            Assert.Fail("the cancelled request cannot complete normally");
        }
        catch (OperationCanceledException)
        {
            // the client gave up
        }

        await WaitUntilNoRequestAsync(h);
        for (var i = 0; i < 40 && (await h.RunLogAsync(slow)).EnumerateArray().Any(r => r.GetProperty("Status").GetString() == "Running"); i++)
            await Task.Delay(250);
        (await h.RunLogAsync(slow)).EnumerateArray().ShouldHaveSingleItem().GetProperty("Status").GetString().ShouldBe("Cancelled");
        var quick = await h.AddReportAsync("SELECT 1 AS one", roleIds: role);
        (await ann.PostAsync(RunUrl(quick), ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task The_default_row_cap_is_fifty_thousand_and_a_cut_off_result_exports_only_what_it_holds()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var report = await h.AddReportAsync("SELECT TOP (50010) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b", roleIds: role);

        var run = await ReadAsync(await ann.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { })));

        run.GetProperty("rowCount").GetInt32().ShouldBe(50_000);
        run.GetProperty("maxRows").GetInt32().ShouldBe(50_000);
        run.GetProperty("truncated").GetBoolean().ShouldBeTrue();
        var export = await ann.GetAsync(Export(Guid.Parse(run.GetProperty("runId").GetString()!)));
        export.StatusCode.ShouldBe(HttpStatusCode.OK);
        export.Content.Headers.ContentDisposition!.FileName!.Trim('"').ShouldEndWith("-truncated.csv");
        export.Headers.GetValues("X-Export-Rows").ShouldBe(["50000"]);
        export.Headers.GetValues("X-Export-Truncated").ShouldBe(["true"]);
    }

    [Fact]
    public async Task A_lower_ceiling_in_the_settings_wins_over_what_a_report_asks_for_in_rows_and_in_time()
    {
        await using var h = await ReportTestHarness.StartAsync(sql, true, ("Reports:MaxRowsCeiling", "300"), ("Reports:MaxTimeoutSeconds", "2"));
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var many = await h.AddReportAsync("SELECT TOP (1000) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b", maxRows: 200_000, roleIds: role);
        var slow = await h.AddReportAsync(Slow, timeoutSeconds: 300, roleIds: role);

        var rows = await ReadAsync(await ann.PostAsync(RunUrl(many), ReportTestHarness.Parameters(new { })));
        var started = DateTime.UtcNow;
        var timedOut = await ann.PostAsync(RunUrl(slow), ReportTestHarness.Parameters(new { }));

        rows.GetProperty("rowCount").GetInt32().ShouldBe(300);
        rows.GetProperty("maxRows").GetInt32().ShouldBe(300);
        rows.GetProperty("truncated").GetBoolean().ShouldBeTrue();
        timedOut.StatusCode.ShouldBe(HttpStatusCode.RequestTimeout);
        (DateTime.UtcNow - started).ShouldBeLessThan(TimeSpan.FromSeconds(15), "the report asked for 300 seconds and got 2");
        await WaitUntilNoRequestAsync(h);
    }

    [Fact]
    public async Task Huge_parameter_values_are_refused_by_name_before_any_query_runs()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        const string parameters = """
            [{"name":"T","type":"text","label":"T"},{"name":"IDS","type":"lookup","lookupKind":"matter","lookupMulti":true,"label":"Ids","maxSelected":1000},
             {"name":"M","type":"multi","label":"M","optionsKind":"fixed","options":[{"value":"a","label":"A"}]}]
            """;
        var report = await h.AddReportAsync("SELECT :T AS t, (SELECT COUNT(*) FROM :IDS) AS ids, (SELECT COUNT(*) FROM :M) AS m", parameters, roleIds: role);

        var longText = await ann.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { t = new string('x', 240_000) }));
        var manyIds = await ann.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { ids = Enumerable.Range(1, 30_000) }));
        var oneOver = await ann.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { ids = Enumerable.Range(1, 1001) }));
        var manyChoices = await ann.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { m = Enumerable.Repeat("a", 30_000) }));
        var nested = await ann.PostAsync(RunUrl(report), Raw("{\"parameters\":{\"t\":" + new string('[', 200) + new string(']', 200) + "}}"));
        var notJson = await ann.PostAsync(RunUrl(report), Raw("{\"parameters\":"));

        ((int)longText.StatusCode).ShouldBe(422);
        (await ReadAsync(longText)).GetProperty("errors").GetProperty("parameters.T")[0].GetProperty("code").GetString().ShouldBe("TOO_LONG");
        ((int)manyIds.StatusCode).ShouldBe(422);
        (await ReadAsync(manyIds)).GetProperty("errors").GetProperty("parameters.IDS")[0].GetProperty("code").GetString().ShouldBe("TOO_MANY");
        ((int)oneOver.StatusCode).ShouldBe(422);
        ((int)manyChoices.StatusCode).ShouldBe(422);
        new[] { 400, 422 }.ShouldContain((int)nested.StatusCode, "a deeply nested value is refused, not parsed");
        notJson.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await h.RunLogAsync(report)).EnumerateArray().Count(r => r.GetProperty("Status").GetString() == "Rejected").ShouldBeGreaterThanOrEqualTo(4);
        (await CountAsync(h.AppConnection, $"SELECT COUNT(*) FROM dbo.ReportRun WHERE ReportId = {report} AND Status NOT IN ('Rejected')")).ShouldBe(0, "no query ran");
        // The longest log value is cut to fit the column.
        (await CountAsync(h.AppConnection, $"SELECT ISNULL(MAX(LEN(ParametersJson)), 0) FROM dbo.ReportRun WHERE ReportId = {report}")).ShouldBeLessThanOrEqualTo(4000);

        // Exactly the ceiling is fine: a thousand ids bind as one parameter and run.
        var thousand = await ann.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { ids = Enumerable.Range(1, 1000) }));
        thousand.StatusCode.ShouldBe(HttpStatusCode.OK, await thousand.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Oversized_sql_is_refused_wherever_a_text_can_enter_and_a_stored_oversized_text_never_runs()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var category = (await ReadAsync(await manager.PostAsync("/api/v1/report-admin/categories", ReportTestHarness.Json(new { name = "Big", sortOrder = 1, isActive = true })))).GetProperty("categoryId").GetInt32();
        var huge = "SELECT 1 AS one /*" + new string('x', 70_000) + "*/";

        var analyze = await manager.PostAsync("/api/v1/report-admin/analyze", ReportTestHarness.Json(new { sql = huge }));
        var create = await manager.PostAsync("/api/v1/report-admin/reports", ReportTestHarness.Json(new { name = "Huge", categoryId = category, sortOrder = 1, sql = huge, parameters = Array.Empty<object>() }));
        var tooBig = await manager.PostAsync("/api/v1/report-admin/analyze", ReportTestHarness.Json(new { sql = new string('y', 1_000_000) }));

        analyze.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await ReadAsync(analyze)).GetProperty("validation").GetProperty("isValid").GetBoolean().ShouldBeFalse();
        ((int)create.StatusCode).ShouldBe(422);
        (await ReadAsync(create)).GetProperty("code").GetString().ShouldBe("REPORT_DEFINITION_INVALID");
        new[] { 200, 413 }.ShouldContain((int)tooBig.StatusCode, "a megabyte of SQL is either refused by size or reported as too long");
        (await CountAsync(h.AppConnection, "SELECT COUNT(*) FROM dbo.ReportDefinition WHERE Name = N'Huge'")).ShouldBe(0);

        // Even a text that reached the table behind the API's back is re-validated at run time and refused.
        var stored = await h.AddReportAsync(huge, roleIds: role);
        var response = await ann.PostAsync(RunUrl(stored), ReportTestHarness.Parameters(new { }));

        response.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ReadAsync(response)).GetProperty("code").GetString().ShouldBe("REPORT_INVALID");
        (await h.RunLogAsync(stored)).EnumerateArray().ShouldHaveSingleItem().GetProperty("ErrorCode").GetString().ShouldBe("VALIDATION_FAILED");
    }

    [Fact]
    public async Task Refused_requests_do_not_use_up_the_hourly_budget_and_the_budget_is_per_person()
    {
        await using var h = await ReportTestHarness.StartAsync(sql, true, ("Reports:RunsPerUserPerHour", "2"));
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var (bo, _) = await h.PersonAsync(@"KE\bo", "Report.Run");
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"INSERT dbo.UserRole (UserId, RoleId) SELECT u.UserId, {role} FROM dbo.UserIdentity u WHERE u.Username = N'KE\\bo' AND NOT EXISTS (SELECT 1 FROM dbo.UserRole x WHERE x.UserId = u.UserId AND x.RoleId = {role})");
        h.Factory.InvalidateAll();
        var report = await h.AddReportAsync("SELECT :N AS n", "[{\"name\":\"N\",\"type\":\"number\",\"label\":\"N\",\"isRequired\":true}]", roleIds: role);

        for (var i = 0; i < 6; i++)
            ((int)(await ann.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { n = "abc" }))).StatusCode).ShouldBe(422); // refused before the gate
        (await ann.PostAsync(RunUrl(9999), ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        (await ann.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { n = 1 }))).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await ann.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { n = 2 }))).StatusCode.ShouldBe(HttpStatusCode.OK);
        var third = await ann.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { n = 3 }));
        third.StatusCode.ShouldBe(HttpStatusCode.TooManyRequests);
        (await ReadAsync(third)).GetProperty("code").GetString().ShouldBe("REPORT_RATE_LIMITED");

        (await bo.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { n = 1 }))).StatusCode.ShouldBe(HttpStatusCode.OK); // somebody else is not affected
        // Reading a result, exporting it and listing do not count as runs.
        var run = Guid.Parse((await ReadAsync(await bo.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { n = 5 })))).GetProperty("runId").GetString()!);
        for (var i = 0; i < 5; i++)
            (await bo.GetAsync(Rows(run))).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await bo.GetAsync(Export(run))).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await bo.GetAsync("/api/v1/reports")).StatusCode.ShouldBe(HttpStatusCode.OK);
    }
}
