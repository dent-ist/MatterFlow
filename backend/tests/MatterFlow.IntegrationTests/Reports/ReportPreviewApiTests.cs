using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.Data.SqlClient;
using Shouldly;

namespace MatterFlow.IntegrationTests.Reports;

/// <summary>Preview, activation gate and the save-version rule against SQL Server and the report login (epic #671, issue #709).</summary>
[Collection(SqlServerCollection.Name)]
public sealed class ReportPreviewApiTests(SqlServerFixture sql)
{
    private const string Hundred = "SELECT TOP (100) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b";
    private const string Slow = "SELECT COUNT_BIG(*) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b CROSS JOIN sys.all_objects c CROSS JOIN sys.all_objects d";

    private static string Url(int id, string action) => $"/api/v1/report-admin/reports/{id}/{action}";

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>();

    private static StringContent Body(object value) => ReportTestHarness.Json(value);

    private static async Task<(long? Last, long? Current, bool Active)> StateAsync(ReportTestHarness h, int id)
    {
        await using var c = new SqlConnection(h.AppConnection);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT LastPreviewOkVersionId, CurrentVersionId, IsActive FROM dbo.ReportDefinition WHERE ReportId = @r";
        cmd.Parameters.AddWithValue("@r", id);
        await using var r = await cmd.ExecuteReaderAsync();
        await r.ReadAsync();
        return (r.IsDBNull(0) ? null : r.GetInt32(0), r.IsDBNull(1) ? null : r.GetInt32(1), r.GetBoolean(2));
    }

    [Fact]
    public async Task A_preview_returns_twenty_rows_columns_and_marks_the_exact_saved_version()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var id = await h.AddReportAsync(Hundred, active: false);

        var response = await manager.PostAsync(Url(id, "preview"), Body(new { }));

        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        var body = await ReadAsync(response);
        body.GetProperty("success").GetBoolean().ShouldBeTrue();
        body.GetProperty("rows").GetArrayLength().ShouldBe(20);
        body.GetProperty("rowCount").GetInt32().ShouldBe(100);
        body.GetProperty("exceedsCap").GetBoolean().ShouldBeFalse();
        body.GetProperty("countsForActivation").GetBoolean().ShouldBeTrue();
        body.GetProperty("columns")[0].GetProperty("name").GetString().ShouldBe("n");
        body.GetProperty("rowVersion").GetString().ShouldNotBeNullOrEmpty();
        var state = await StateAsync(h, id);
        state.Last.ShouldBe(state.Current);
        var log = (await h.RunLogAsync(id)).EnumerateArray().ShouldHaveSingleItem();
        log.GetProperty("Kind").GetString().ShouldBe("Preview");
        log.GetProperty("Status").GetString().ShouldBe("Succeeded");
    }

    [Fact]
    public async Task Activation_needs_a_successful_preview_of_the_current_version()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var id = await h.AddReportAsync(Hundred, active: false);

        var refused = await manager.PostAsync(Url(id, "activate"), null);
        refused.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ReadAsync(refused)).GetProperty("code").GetString().ShouldBe("PREVIEW_REQUIRED");
        (await StateAsync(h, id)).Active.ShouldBeFalse();

        (await manager.PostAsync(Url(id, "preview"), Body(new { }))).StatusCode.ShouldBe(HttpStatusCode.OK);
        var ok = await manager.PostAsync(Url(id, "activate"), null);
        ok.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await ReadAsync(ok)).GetProperty("isActive").GetBoolean().ShouldBeTrue();
        (await StateAsync(h, id)).Active.ShouldBeTrue();

        var off = await manager.PostAsync(Url(id, "deactivate"), null);
        (await ReadAsync(off)).GetProperty("isActive").GetBoolean().ShouldBeFalse();
        (await manager.PostAsync(Url(id, "activate"), null)).StatusCode.ShouldBe(HttpStatusCode.OK); // the version is still the previewed one
        (await manager.PostAsync(Url(9999, "activate"), null)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task A_preview_of_unsaved_edits_never_counts_for_activation()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var id = await h.AddReportAsync(Hundred, active: false);

        var edited = await manager.PostAsync(Url(id, "preview"), Body(new { sql = "SELECT 1 AS one" }));

        (await ReadAsync(edited)).GetProperty("countsForActivation").GetBoolean().ShouldBeFalse();
        var state = await StateAsync(h, id);
        state.Last.ShouldBeNull();
        (await manager.PostAsync(Url(id, "activate"), null)).StatusCode.ShouldBe(HttpStatusCode.Conflict);

        // Previewing the saved text with different parameter definitions is not the saved version either.
        var otherParams = await manager.PostAsync(Url(id, "preview"), Body(new { parameters = new[] { new { name = "X", type = "text", label = "X" } } }));
        (await ReadAsync(otherParams)).GetProperty("countsForActivation").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task Validation_errors_and_sql_errors_are_shown_to_the_administrator_in_full()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var id = await h.AddReportAsync(Hundred, active: false);

        var rejected = await ReadAsync(await manager.PostAsync(Url(id, "preview"), Body(new { sql = "SELECT 1;\nDROP TABLE dbo.Pod" })));
        rejected.GetProperty("success").GetBoolean().ShouldBeFalse();
        rejected.GetProperty("status").GetString().ShouldBe("Rejected");
        rejected.GetProperty("validationErrors")[0].GetProperty("code").GetString().ShouldBe("MULTIPLE_STATEMENTS");
        rejected.GetProperty("validationErrors")[0].GetProperty("line").GetInt32().ShouldBe(2);

        var failed = await ReadAsync(await manager.PostAsync(Url(id, "preview"), Body(new { sql = "SELECT 1 AS ok\nUNION ALL SELECT 1 / 0" })));
        failed.GetProperty("success").GetBoolean().ShouldBeFalse();
        failed.GetProperty("status").GetString().ShouldBe("Failed");
        failed.GetProperty("sqlError").GetString()!.ShouldContain("Divide by zero");

        var denied = await ReadAsync(await manager.PostAsync(Url(id, "preview"), Body(new { sql = "SELECT COUNT(*) FROM dbo.AuditEvent" })));
        denied.GetProperty("sqlError").GetString()!.ShouldContain("permission");

        (await h.RunLogAsync(id)).EnumerateArray().Select(r => r.GetProperty("Status").GetString()).ShouldBe(["Rejected", "Failed", "Failed"]);
    }

    [Fact]
    public async Task Required_parameters_get_samples_and_bad_typed_values_are_listed_by_name()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        const string parameters = "[{\"name\":\"N\",\"type\":\"number\",\"label\":\"N\",\"isRequired\":true,\"min\":5},{\"name\":\"WHEN\",\"type\":\"date\",\"label\":\"When\",\"isRequired\":true},{\"name\":\"COLOR\",\"type\":\"single\",\"label\":\"Color\",\"isRequired\":true,\"optionsKind\":\"fixed\",\"options\":[{\"value\":\"red\",\"label\":\"Red\"}]}]";
        var id = await h.AddReportAsync("SELECT :N AS n, :WHEN AS d, :COLOR AS c", parameters, active: false);

        var sampled = await ReadAsync(await manager.PostAsync(Url(id, "preview"), Body(new { })));
        sampled.GetProperty("success").GetBoolean().ShouldBeTrue();
        sampled.GetProperty("rows")[0][0].GetDecimal().ShouldBe(5m);
        sampled.GetProperty("rows")[0][2].GetString().ShouldBe("red");

        var bad = await ReadAsync(await manager.PostAsync(Url(id, "preview"), Body(new { sampleValues = new { n = 1, color = "blue" } })));
        bad.GetProperty("success").GetBoolean().ShouldBeFalse();
        bad.GetProperty("parameterErrors").EnumerateArray().Select(e => $"{e.GetProperty("name").GetString()}:{e.GetProperty("code").GetString()}").ShouldBe(["N:OUT_OF_RANGE", "COLOR:NOT_IN_OPTIONS"]);
    }

    [Fact]
    public async Task A_preview_that_would_exceed_the_row_cap_says_so_and_counts_only_up_to_the_cap()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var id = await h.AddReportAsync(Hundred, maxRows: 30, active: false);

        var body = await ReadAsync(await manager.PostAsync(Url(id, "preview"), Body(new { })));

        body.GetProperty("rows").GetArrayLength().ShouldBe(20);
        body.GetProperty("rowCount").GetInt32().ShouldBe(30);
        body.GetProperty("exceedsCap").GetBoolean().ShouldBeTrue();
    }

    [Fact]
    public async Task A_preview_uses_the_one_running_report_lock_and_its_own_time_limit()
    {
        await using var h = await ReportTestHarness.StartAsync(sql, true, ("Reports:PreviewTimeoutSeconds", "2"));
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var id = await h.AddReportAsync(Slow, timeoutSeconds: 120, active: false);

        var timedOut = await ReadAsync(await manager.PostAsync(Url(id, "preview"), Body(new { })));
        timedOut.GetProperty("status").GetString().ShouldBe("TimedOut");
        timedOut.GetProperty("sqlError").GetString()!.ShouldContain("2 seconds");

        await using var h2 = await ReportTestHarness.StartAsync(sql, true, ("Reports:PreviewTimeoutSeconds", "20"));
        var (manager2, _) = await h2.PersonAsync(@"KE\manager", "Report.Manage");
        var id2 = await h2.AddReportAsync(Slow, active: false);
        var first = manager2.PostAsync(Url(id2, "preview"), Body(new { }));
        await Task.Delay(1500);
        var second = await manager2.PostAsync(Url(id2, "preview"), Body(new { }));
        second.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ReadAsync(second)).GetProperty("code").GetString().ShouldBe("REPORT_ALREADY_RUNNING");
        await manager2.DeleteAsync("/api/v1/reports/runs/current");
        _ = await first;
    }

    [Fact]
    public async Task Only_Report_Manage_may_preview_activate_or_deactivate()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var id = await h.AddReportAsync(Hundred, active: false);
        var people = new[]
        {
            (await h.PersonAsync(@"KE\run", "Report.Run")).Client,
            (await h.PersonAsync(@"KE\assign", "Report.Assign")).Client,
            (await h.PersonAsync(@"KE\both", "Report.Run", "Report.Assign")).Client,
            (await h.PersonAsync(@"KE\none", "Matter.View")).Client,
        };

        foreach (var person in people)
        {
            (await person.PostAsync(Url(id, "preview"), Body(new { }))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await person.PostAsync(Url(id, "activate"), null)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await person.PostAsync(Url(id, "deactivate"), null)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await person.PostAsync(Url(id, "versions"), Body(new { sql = "SELECT 1" }))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        }

        (await h.Tasks.Admin.PostAsync(Url(id, "preview"), Body(new { }))).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await StateAsync(h, id)).Last.ShouldNotBeNull();
    }

    [Fact]
    public async Task Without_a_report_login_a_preview_is_503()
    {
        await using var h = await ReportTestHarness.StartAsync(sql, withLogin: false);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var id = await h.AddReportAsync(Hundred, active: false);

        var response = await manager.PostAsync(Url(id, "preview"), Body(new { }));

        response.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable);
    }

    // ---- saving a version ----

    [Fact]
    public async Task Saving_new_sql_for_an_active_report_deactivates_it_unless_it_was_previewed_in_the_same_action()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var id = await h.AddReportAsync(Hundred);
        (await manager.PostAsync(Url(id, "preview"), Body(new { }))).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await StateAsync(h, id)).Active.ShouldBeTrue();

        // 1) Plain save: new version, report deactivated until previewed.
        var plain = await ReadAsync(await manager.PostAsync(Url(id, "versions"), Body(new { sql = "SELECT 2 AS two", changeNote = "second", keepActive = false })));
        plain.GetProperty("versionNo").GetInt32().ShouldBe(2);
        plain.GetProperty("isActive").GetBoolean().ShouldBeFalse();
        plain.GetProperty("deactivated").GetBoolean().ShouldBeTrue();
        var afterPlain = await StateAsync(h, id);
        afterPlain.Active.ShouldBeFalse();
        afterPlain.Last.ShouldNotBe(afterPlain.Current);
        (await manager.PostAsync(Url(id, "activate"), null)).StatusCode.ShouldBe(HttpStatusCode.Conflict);

        // 2) Preview then activate, then "save and keep active" with text that passes: stays active, version previewed.
        (await manager.PostAsync(Url(id, "preview"), Body(new { }))).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await manager.PostAsync(Url(id, "activate"), null)).StatusCode.ShouldBe(HttpStatusCode.OK);
        var kept = await ReadAsync(await manager.PostAsync(Url(id, "versions"), Body(new { sql = "SELECT 3 AS three", keepActive = true })));
        kept.GetProperty("versionNo").GetInt32().ShouldBe(3);
        kept.GetProperty("isActive").GetBoolean().ShouldBeTrue();
        kept.GetProperty("deactivated").GetBoolean().ShouldBeFalse();
        kept.GetProperty("preview").GetProperty("success").GetBoolean().ShouldBeTrue();
        var afterKeep = await StateAsync(h, id);
        (afterKeep.Active, afterKeep.Last).ShouldBe((true, afterKeep.Current));

        // 3) "Keep active" with text that fails its preview: saved, but the report is deactivated.
        var failed = await ReadAsync(await manager.PostAsync(Url(id, "versions"), Body(new { sql = "SELECT 1 / 0 AS boom", keepActive = true })));
        failed.GetProperty("versionNo").GetInt32().ShouldBe(4);
        failed.GetProperty("isActive").GetBoolean().ShouldBeFalse();
        failed.GetProperty("deactivated").GetBoolean().ShouldBeTrue();
        failed.GetProperty("preview").GetProperty("success").GetBoolean().ShouldBeFalse();

        // 4) The same text again writes nothing.
        var same = await ReadAsync(await manager.PostAsync(Url(id, "versions"), Body(new { sql = "SELECT 1 / 0 AS boom" })));
        same.GetProperty("unchanged").GetBoolean().ShouldBeTrue();
        same.GetProperty("versionNo").GetInt32().ShouldBe(4);
        (await SqlServerFixture.ScalarAsync(h.AppConnection, $"SELECT COUNT(*) FROM dbo.ReportVersion WHERE ReportId = {id}")).ShouldBe(4);
    }

    [Fact]
    public async Task Saving_an_inactive_report_never_activates_it_and_old_versions_are_kept()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var id = await h.AddReportAsync(Hundred, active: false);

        var saved = await ReadAsync(await manager.PostAsync(Url(id, "versions"), Body(new { sql = "SELECT 5 AS five", keepActive = true })));

        saved.GetProperty("isActive").GetBoolean().ShouldBeFalse();
        saved.GetProperty("deactivated").GetBoolean().ShouldBeFalse(); // it was not active
        saved.TryGetProperty("preview", out var preview).ShouldBeTrue();
        preview.ValueKind.ShouldBe(JsonValueKind.Null); // nothing to keep active, so no preview ran
        (await SqlServerFixture.ScalarAsync(h.AppConnection, $"SELECT COUNT(*) FROM dbo.ReportVersion WHERE ReportId = {id}")).ShouldBe(2);
        (await SqlServerFixture.ScalarAsync(h.AppConnection, $"SELECT COUNT(*) FROM dbo.ReportVersion WHERE ReportId = {id} AND SqlText = N'{Hundred}'")).ShouldBe(1);
    }
}
