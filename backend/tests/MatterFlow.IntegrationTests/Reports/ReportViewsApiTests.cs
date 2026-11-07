using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;

namespace MatterFlow.IntegrationTests.Reports;

/// <summary>Saved views of the result grid: /api/v1/reports/{id}/views (issue #722). Per person and report; other people get 404.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class ReportViewsApiTests(SqlServerFixture sql)
{
    private const string Query = "SELECT * FROM (VALUES (1, N'a', 2.0), (2, N'b', 3.5)) v(id, name, [Total, USD])";

    private static string Views(int report, string suffix = "") => $"/api/v1/reports/{report}/views{suffix}";

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>();

    private static object Layout(string column = "name", int pageSize = 100) => new
    {
        columns = new object[] { new { name = column, hidden = false, width = 160 }, new { name = "id", hidden = true } },
        sort = new object[] { new { column, descending = true } },
        filters = new object[] { new { column, op = "contains", value = "a" } },
        pageSize,
    };

    private static async Task<JsonElement> CreateAsync(HttpClient client, int report, string name, bool isDefault = false, object? layout = null)
    {
        var response = await client.PostAsync(Views(report), ReportTestHarness.Json(new { name, layout = layout ?? Layout(), isDefault }));
        response.StatusCode.ShouldBe(HttpStatusCode.Created, await response.Content.ReadAsStringAsync());
        return await ReadAsync(response);
    }

    [Fact]
    public async Task A_person_saves_lists_renames_and_deletes_views_and_the_layout_comes_back_as_saved()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var report = await h.AddReportAsync(Query, roleIds: role);

        var empty = await ReadAsync(await ann.GetAsync(Views(report)));
        empty.GetProperty("views").GetArrayLength().ShouldBe(0);
        empty.GetProperty("limit").GetInt32().ShouldBe(25);

        var created = await CreateAsync(ann, report, "  Mine  ", layout: Layout("Total, USD"));
        var viewId = created.GetProperty("viewId").GetInt32();
        created.GetProperty("name").GetString().ShouldBe("Mine");
        created.GetProperty("isDefault").GetBoolean().ShouldBeFalse();
        created.GetProperty("layout").GetProperty("sort")[0].GetProperty("column").GetString().ShouldBe("Total, USD");

        var list = await ReadAsync(await ann.GetAsync(Views(report)));
        var only = list.GetProperty("views").EnumerateArray().ShouldHaveSingleItem();
        only.GetProperty("layout").GetProperty("pageSize").GetInt32().ShouldBe(100);
        only.GetProperty("layout").GetProperty("columns")[0].GetProperty("width").GetInt32().ShouldBe(160);
        only.GetProperty("layout").GetProperty("columns")[1].GetProperty("hidden").GetBoolean().ShouldBeTrue();
        only.GetProperty("layout").GetProperty("filters")[0].GetProperty("op").GetString().ShouldBe("contains");

        var renamed = await ann.PutAsync(Views(report, $"/{viewId}"), ReportTestHarness.Json(new { name = "Renamed" }));
        renamed.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await ReadAsync(renamed)).GetProperty("layout").GetProperty("pageSize").GetInt32().ShouldBe(100); // the layout is left as it was
        var relaid = await ann.PutAsync(Views(report, $"/{viewId}"), ReportTestHarness.Json(new { layout = Layout("name", 25) }));
        var after = await ReadAsync(relaid);
        after.GetProperty("name").GetString().ShouldBe("Renamed");
        after.GetProperty("layout").GetProperty("pageSize").GetInt32().ShouldBe(25);
        after.GetProperty("modifiedAtUtc").ValueKind.ShouldBe(JsonValueKind.String);

        (await ann.DeleteAsync(Views(report, $"/{viewId}"))).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await ReadAsync(await ann.GetAsync(Views(report)))).GetProperty("views").GetArrayLength().ShouldBe(0);
        (await ann.DeleteAsync(Views(report, $"/{viewId}"))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task There_is_one_default_per_person_and_report_and_it_can_be_moved_and_removed()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var report = await h.AddReportAsync(Query, roleIds: role);
        var first = (await CreateAsync(ann, report, "First", isDefault: true)).GetProperty("viewId").GetInt32();
        var second = (await CreateAsync(ann, report, "Second")).GetProperty("viewId").GetInt32();

        async Task<string[]> Defaults() => (await ReadAsync(await ann.GetAsync(Views(report)))).GetProperty("views").EnumerateArray().Where(v => v.GetProperty("isDefault").GetBoolean()).Select(v => v.GetProperty("name").GetString()!).ToArray();

        (await Defaults()).ShouldBe(["First"]);
        (await ann.PostAsync(Views(report, $"/{second}/default"), null)).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await Defaults()).ShouldBe(["Second"]);
        var created = await CreateAsync(ann, report, "Third", isDefault: true);
        (await Defaults()).ShouldBe(["Third"]);
        (await ann.DeleteAsync(Views(report, $"/{created.GetProperty("viewId").GetInt32()}/default"))).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await Defaults()).ShouldBeEmpty();
        // The list puts the default first.
        await ann.PostAsync(Views(report, $"/{first}/default"), null);
        (await ReadAsync(await ann.GetAsync(Views(report)))).GetProperty("views")[0].GetProperty("name").GetString().ShouldBe("First");
        // Removing the default of a view that is not the default changes nothing.
        (await ann.DeleteAsync(Views(report, $"/{second}/default"))).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await Defaults()).ShouldBe(["First"]);
    }

    [Fact]
    public async Task Nobody_sees_edits_deletes_or_defaults_another_persons_view_and_the_answer_is_404_exactly_like_for_an_unknown_id()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var (bo, boRole) = await h.PersonAsync(@"KE\bo", "Report.Run");
        var report = await h.AddReportAsync(Query, roleIds: [role, boRole]);
        var annView = (await CreateAsync(ann, report, "Ann private", isDefault: true)).GetProperty("viewId").GetInt32();

        (await ReadAsync(await bo.GetAsync(Views(report)))).GetProperty("views").GetArrayLength().ShouldBe(0);
        var responses = new[]
        {
            await bo.PutAsync(Views(report, $"/{annView}"), ReportTestHarness.Json(new { name = "hijack" })),
            await bo.DeleteAsync(Views(report, $"/{annView}")),
            await bo.PostAsync(Views(report, $"/{annView}/default"), null),
            await bo.DeleteAsync(Views(report, $"/{annView}/default")),
        };
        var unknown = await bo.DeleteAsync(Views(report, "/99999"));
        foreach (var r in responses)
        {
            r.StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await r.Content.ReadAsStringAsync()).ShouldNotContain("Ann private");
        }

        unknown.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await ReadAsync(responses[0])).GetProperty("detail").GetString().ShouldBe((await ReadAsync(unknown)).GetProperty("detail").GetString());

        // The same name is free for another person, and Ann's view is untouched.
        await CreateAsync(bo, report, "Ann private");
        var annList = (await ReadAsync(await ann.GetAsync(Views(report)))).GetProperty("views");
        annList.GetArrayLength().ShouldBe(1);
        annList[0].GetProperty("isDefault").GetBoolean().ShouldBeTrue();
        // A view of one report is not reachable through another report's address.
        var other = await h.AddReportAsync(Query, roleIds: role);
        (await ann.DeleteAsync(Views(other, $"/{annView}"))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await ReadAsync(await ann.GetAsync(Views(other)))).GetProperty("views").GetArrayLength().ShouldBe(0);
    }

    [Fact]
    public async Task Names_are_checked_unique_per_person_and_report_ignoring_case_and_limited_to_25_views()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var report = await h.AddReportAsync(Query, roleIds: role);
        await CreateAsync(ann, report, "Mine");

        var duplicate = await ann.PostAsync(Views(report), ReportTestHarness.Json(new { name = "mINE", layout = Layout(), isDefault = false }));
        duplicate.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ReadAsync(duplicate)).GetProperty("code").GetString().ShouldBe("VIEW_NAME_EXISTS");

        foreach (var name in new[] { "", "   ", new string('x', 81) })
        {
            var bad = await ann.PostAsync(Views(report), ReportTestHarness.Json(new { name, layout = Layout(), isDefault = false }));
            bad.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
            var problem = await ReadAsync(bad);
            problem.GetProperty("code").GetString().ShouldBe("REPORT_VIEW_INVALID");
            problem.GetProperty("errors").GetProperty("name")[0].GetProperty("message").GetString().ShouldNotBeNullOrWhiteSpace();
        }

        var second = await CreateAsync(ann, report, "Second");
        var rename = await ann.PutAsync(Views(report, $"/{second.GetProperty("viewId").GetInt32()}"), ReportTestHarness.Json(new { name = "MINE" }));
        rename.StatusCode.ShouldBe(HttpStatusCode.Conflict);

        for (var i = 2; i < 25; i++)
            await CreateAsync(ann, report, "View " + i);
        var over = await ann.PostAsync(Views(report), ReportTestHarness.Json(new { name = "One too many", layout = Layout(), isDefault = false }));
        over.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ReadAsync(over)).GetProperty("code").GetString().ShouldBe("VIEW_LIMIT_REACHED");
        (await ReadAsync(await ann.GetAsync(Views(report)))).GetProperty("views").GetArrayLength().ShouldBe(25);

        // The limit is per report: another report still takes views.
        var other = await h.AddReportAsync(Query, roleIds: role);
        await CreateAsync(ann, other, "Mine");
    }

    [Fact]
    public async Task A_bad_layout_is_422_and_unknown_columns_of_the_live_result_are_left_out_and_reported()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var report = await h.AddReportAsync(Query, roleIds: role);

        foreach (var layout in new object?[]
        {
            new { pageSize = 7 },
            new { filters = new object[] { new { column = "name", op = "drop table", value = "x" } } },
            new { sort = new object[] { new { column = "a" }, new { column = "b" }, new { column = "c" }, new { column = "d" } } },
            new { columns = new object[] { new { name = "name", hidden = false, width = 5 } } },
            null,
        })
        {
            var response = await ann.PostAsync(Views(report), ReportTestHarness.Json(new { name = "Bad", layout, isDefault = false }));
            response.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
            (await ReadAsync(response)).GetProperty("code").GetString().ShouldBe("REPORT_VIEW_INVALID");
        }

        // Without a live result nothing can be checked against the columns: the layout is stored as sent.
        var blind = await CreateAsync(ann, report, "Blind", layout: Layout("Whatever"));
        blind.GetProperty("ignoredColumns").GetArrayLength().ShouldBe(0);

        // With a live result of this report, columns it does not have are dropped.
        var run = await ann.PostAsync($"/api/v1/reports/{report}/runs", ReportTestHarness.Parameters(new { }));
        run.StatusCode.ShouldBe(HttpStatusCode.OK);
        var checkedView = await CreateAsync(ann, report, "Checked", layout: new
        {
            columns = new object[] { new { name = "NAME", hidden = false }, new { name = "ghost", hidden = false }, new { name = "Total, USD", hidden = true } },
            sort = new object[] { new { column = "ghost", descending = false }, new { column = "total, usd", descending = true } },
            filters = new object[] { new { column = "ghost", op = "eq", value = "1" } },
        });
        checkedView.GetProperty("ignoredColumns").EnumerateArray().Select(c => c.GetString()).ShouldBe(["ghost"]);
        var layoutBack = checkedView.GetProperty("layout");
        layoutBack.GetProperty("columns").EnumerateArray().Select(c => c.GetProperty("name").GetString()).ShouldBe(["name", "Total, USD"]);
        layoutBack.GetProperty("sort").EnumerateArray().Select(c => c.GetProperty("column").GetString()).ShouldBe(["Total, USD"]);
        layoutBack.GetProperty("filters").GetArrayLength().ShouldBe(0);

        // Another report's result does not decide what a view of this report keeps.
        var (bo, boRole) = await h.PersonAsync(@"KE\bo", "Report.Run");
        var report2 = await h.AddReportAsync("SELECT 1 AS only_column", roleIds: boRole);
        (await bo.PostAsync($"/api/v1/reports/{report2}/runs", ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.OK);
        var report3 = await h.AddReportAsync(Query, roleIds: boRole);
        (await CreateAsync(bo, report3, "Other", layout: Layout("whatever"))).GetProperty("ignoredColumns").GetArrayLength().ShouldBe(0);
    }

    [Fact]
    public async Task A_stored_view_is_plain_text_data_and_hostile_strings_come_back_unchanged()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var report = await h.AddReportAsync(Query, roleIds: role);
        const string hostile = "'; DROP TABLE dbo.SavedReportView; -- <script>alert(1)</script>";

        var created = await CreateAsync(ann, report, hostile.Length > 80 ? hostile[..80] : hostile, layout: new { filters = new object[] { new { column = hostile[..30], op = "contains", value = hostile } } });

        created.GetProperty("layout").GetProperty("filters")[0].GetProperty("value").GetString().ShouldBe(hostile);
        (await SqlServerFixture.ScalarAsync(h.AppConnection, "SELECT COUNT(*) FROM dbo.SavedReportView")).ShouldBe(1);
    }

    [Fact]
    public async Task Views_follow_the_report_rule_a_report_the_person_may_not_run_has_no_views_and_the_answer_is_the_same_404()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var assigned = await h.AddReportAsync(Query, roleIds: role);
        var unassigned = await h.AddReportAsync(Query);
        var inactive = await h.AddReportAsync(Query, active: false, roleIds: role);
        var viewId = (await CreateAsync(ann, assigned, "Mine")).GetProperty("viewId").GetInt32();

        foreach (var id in new[] { unassigned, inactive, 99999 })
        {
            var get = await ann.GetAsync(Views(id));
            get.StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await ReadAsync(get)).GetProperty("detail").GetString().ShouldBe("This report does not exist or is not available to you.");
            (await ann.PostAsync(Views(id), ReportTestHarness.Json(new { name = "x", layout = Layout(), isDefault = false }))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        }

        // Deactivating the report hides its views (they are kept), reactivating brings them back.
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"UPDATE dbo.ReportDefinition SET IsActive = 0 WHERE ReportId = {assigned}");
        (await ann.GetAsync(Views(assigned))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await ann.DeleteAsync(Views(assigned, $"/{viewId}"))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"UPDATE dbo.ReportDefinition SET IsActive = 1 WHERE ReportId = {assigned}");
        (await ReadAsync(await ann.GetAsync(Views(assigned)))).GetProperty("views").GetArrayLength().ShouldBe(1);
    }

    [Fact]
    public async Task Without_Report_Run_every_view_endpoint_is_forbidden_and_without_a_login_unauthorized()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var report = await h.AddReportAsync(Query, roleIds: role);
        var viewId = (await CreateAsync(ann, report, "Mine")).GetProperty("viewId").GetInt32();
        foreach (var account in new[] { (@"KE\manager", "Report.Manage"), (@"KE\assigner", "Report.Assign") })
        {
            var (client, _) = await h.PersonAsync(account.Item1, account.Item2);
            (await client.GetAsync(Views(report))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await client.PostAsync(Views(report), ReportTestHarness.Json(new { name = "x", layout = Layout(), isDefault = false }))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await client.PutAsync(Views(report, $"/{viewId}"), ReportTestHarness.Json(new { name = "x" }))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await client.DeleteAsync(Views(report, $"/{viewId}"))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await client.PostAsync(Views(report, $"/{viewId}/default"), null)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await client.DeleteAsync(Views(report, $"/{viewId}/default"))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        }

        using var anonymous = h.Factory.CreateClient();
        (await anonymous.GetAsync(Views(report))).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }
}
