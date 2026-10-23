using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;

namespace MatterFlow.IntegrationTests.Reports;

/// <summary>The schema browser API: only what the report login can read, with column details, search and paging (epic #671, issue #710).</summary>
[Collection(SqlServerCollection.Name)]
public sealed class ReportSchemaApiTests(SqlServerFixture sql)
{
    private const string Url = "/api/v1/report-admin/schema";

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>();

    private static string[] Names(JsonElement page) => page.GetProperty("tables").EnumerateArray().Select(t => t.GetProperty("fullName").GetString()!).ToArray();

    [Fact]
    public async Task Readable_tables_are_listed_with_column_details_and_denied_tables_never_appear()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");

        var page = await ReadAsync(await manager.GetAsync($"{Url}?pageSize=200"));

        var names = Names(page);
        names.ShouldContain("dbo.Task");
        names.ShouldContain("dbo.Pod");
        foreach (var denied in new[] { "AuditEvent", "AuditEventGuard", "UserIdentity", "SeedMarker", "ReportDefinition", "ReportVersion", "ReportRun", "RoleReport", "Permission", "Notification", "SchemaMigration" })
            names.ShouldNotContain("dbo." + denied);
        var task = page.GetProperty("tables").EnumerateArray().Single(t => t.GetProperty("fullName").GetString() == "dbo.Task");
        var id = task.GetProperty("columns").EnumerateArray().Single(c => c.GetProperty("name").GetString() == "TaskId");
        id.GetProperty("isPrimaryKey").GetBoolean().ShouldBeTrue();
        id.GetProperty("isNullable").GetBoolean().ShouldBeFalse();
        id.GetProperty("type").GetString().ShouldNotBeNullOrEmpty();
        var title = task.GetProperty("columns").EnumerateArray().Single(c => c.GetProperty("name").GetString() == "Title");
        title.GetProperty("type").GetString()!.ShouldStartWith("nvarchar(");
        title.GetProperty("isPrimaryKey").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task Search_matches_table_and_column_names_and_results_are_paged()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");

        var byTable = await ReadAsync(await manager.GetAsync($"{Url}?search=podmember"));
        Names(byTable).ShouldContain("dbo.PodMember");

        var byColumn = await ReadAsync(await manager.GetAsync($"{Url}?search=DisplayName&pageSize=200"));
        Names(byColumn).ShouldContain("dbo.AppUser");
        Names(byColumn).ShouldNotContain("dbo.Pod" + "Member");

        var first = await ReadAsync(await manager.GetAsync($"{Url}?pageSize=5&page=1"));
        var second = await ReadAsync(await manager.GetAsync($"{Url}?pageSize=5&page=2"));
        first.GetProperty("tables").GetArrayLength().ShouldBe(5);
        first.GetProperty("total").GetInt32().ShouldBeGreaterThan(10);
        Names(first).Intersect(Names(second)).ShouldBeEmpty();
        Names(first).ShouldBe(Names(first).OrderBy(n => n, StringComparer.OrdinalIgnoreCase).ToArray());

        var tooBig = await ReadAsync(await manager.GetAsync($"{Url}?pageSize=100000"));
        tooBig.GetProperty("pageSize").GetInt32().ShouldBe(200);
        var beyond = await ReadAsync(await manager.GetAsync($"{Url}?page=9999&pageSize=50"));
        beyond.GetProperty("tables").GetArrayLength().ShouldBeGreaterThan(0);

        var nothing = await ReadAsync(await manager.GetAsync($"{Url}?search=zzz_no_such_thing"));
        nothing.GetProperty("total").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task One_table_is_found_by_name_and_a_denied_table_looks_like_a_missing_one()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");

        (await manager.GetAsync($"{Url}/Pod")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await ReadAsync(await manager.GetAsync($"{Url}/dbo.pod"))).GetProperty("name").GetString().ShouldBe("Pod");
        var denied = await manager.GetAsync($"{Url}/AuditEvent");
        var missing = await manager.GetAsync($"{Url}/NoSuchTable");
        denied.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        missing.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await ReadAsync(denied)).GetProperty("detail").GetString().ShouldBe((await ReadAsync(missing)).GetProperty("detail").GetString());
    }

    [Fact]
    public async Task The_schema_browser_answers_503_while_reports_are_off()
    {
        await using var h = await ReportTestHarness.StartAsync(sql, withLogin: false);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");

        var response = await manager.GetAsync(Url);

        response.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable);
        (await ReadAsync(response)).GetProperty("code").GetString().ShouldBe("REPORTS_UNAVAILABLE");
    }
}
