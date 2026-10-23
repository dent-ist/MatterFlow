using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.Reports.Application.Results;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

namespace MatterFlow.IntegrationTests.Reports;

/// <summary>GET /api/v1/reports/runs/{runId}/rows and DELETE: server-side paging, sorting and filtering, ownership, expiry and the memory budget (issue #705).</summary>
[Collection(SqlServerCollection.Name)]
public sealed class ReportRowsApiTests(SqlServerFixture sql)
{
    private const string People =
        "SELECT * FROM (VALUES (1, N'beta', 10.5, CAST('2026-10-02' AS date), 1), (2, N'Alpha', 2.0, CAST('2026-10-01' AS date), 0), (3, NULL, NULL, NULL, NULL), (4, N'alpha', 7.25, CAST('2026-10-03' AS date), 1), (5, N'Gamma', 10.5, CAST('2026-09-30' AS date), 0)) v(id, name, price, due, done)";

    private static string Rows(Guid run, string query = "") => $"/api/v1/reports/runs/{run}/rows{query}";

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>();

    private static async Task<Guid> RunAsync(HttpClient client, int report)
    {
        var response = await client.PostAsync($"/api/v1/reports/{report}/runs", ReportTestHarness.Parameters(new { }));
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        return Guid.Parse((await ReadAsync(response)).GetProperty("runId").GetString()!);
    }

    private static string[] Names(JsonElement page) => page.GetProperty("rows").EnumerateArray().Select(r => r[1].ValueKind == JsonValueKind.Null ? "<null>" : r[1].GetString()!).ToArray();

    [Fact]
    public async Task Pages_come_sorted_and_filtered_by_the_server()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var run = await RunAsync(runner, await h.AddReportAsync(People, roleIds: role));

        var all = await ReadAsync(await runner.GetAsync(Rows(run, "?pageSize=2&sort=name:asc")));
        var page2 = await ReadAsync(await runner.GetAsync(Rows(run, "?page=2&pageSize=2&sort=name:asc")));
        var desc = await ReadAsync(await runner.GetAsync(Rows(run, "?sort=name:desc")));
        var filtered = await ReadAsync(await runner.GetAsync(Rows(run, "?sort=price:desc&filter=" + Uri.EscapeDataString("[{\"column\":\"name\",\"op\":\"contains\",\"value\":\"AL\"}]"))));

        Names(all).ShouldBe(["Alpha", "alpha"]);
        Names(page2).ShouldBe(["beta", "Gamma"]);
        all.GetProperty("totalRows").GetInt32().ShouldBe(5);
        all.GetProperty("filteredRows").GetInt32().ShouldBe(5);
        all.GetProperty("columns").EnumerateArray().Select(c => $"{c.GetProperty("name").GetString()}:{c.GetProperty("type").GetString()}")
            .ShouldBe(["id:integer", "name:text", "price:decimal", "due:date", "done:integer"]);
        Names(desc).ShouldBe(["<null>", "Gamma", "beta", "Alpha", "alpha"]);
        Names(filtered).ShouldBe(["alpha", "Alpha"]);
        filtered.GetProperty("filteredRows").GetInt32().ShouldBe(2);
        filtered.GetProperty("totalRows").GetInt32().ShouldBe(5);
        filtered.GetProperty("rows")[0][3].GetString().ShouldBe("2026-10-03");
        filtered.GetProperty("rows")[0][2].GetDecimal().ShouldBe(7.25m);
    }

    [Fact]
    public async Task A_bad_sort_or_filter_is_400_and_names_the_problem()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var run = await RunAsync(runner, await h.AddReportAsync(People, roleIds: role));

        foreach (var query in new[] { "?sort=nope:asc", "?filter=" + Uri.EscapeDataString("[{\"column\":\"id\",\"op\":\"contains\",\"value\":\"1\"}]"), "?filter=%7Bbroken" })
        {
            var response = await runner.GetAsync(Rows(run, query));
            response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
            (await ReadAsync(response)).GetProperty("code").GetString().ShouldBe("RESULT_QUERY_INVALID");
        }
    }

    [Fact]
    public async Task Another_persons_result_is_404_exactly_like_an_unknown_id_and_an_own_expired_result_is_410()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var (bo, boRole) = await h.PersonAsync(@"KE\bo", "Report.Run");
        var report = await h.AddReportAsync(People, roleIds: [role, boRole]);
        var annRun = await RunAsync(ann, report);

        var stranger = await bo.GetAsync(Rows(annRun));
        var unknown = await bo.GetAsync(Rows(Guid.NewGuid()));
        stranger.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        unknown.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await stranger.Content.ReadAsStringAsync()).Replace(annRun.ToString(), "X").ShouldNotContain("expired");
        (await bo.DeleteAsync(Rows(annRun).Replace("/rows", ""))).StatusCode.ShouldBe(HttpStatusCode.NoContent); // not allowed to drop it either, and says nothing
        (await ann.GetAsync(Rows(annRun))).StatusCode.ShouldBe(HttpStatusCode.OK);

        // A new run replaces the old result: the old id is "expired" for its owner.
        var second = await RunAsync(ann, report);
        var expired = await ann.GetAsync(Rows(annRun));
        expired.StatusCode.ShouldBe(HttpStatusCode.Gone);
        (await ReadAsync(expired)).GetProperty("code").GetString().ShouldBe("RESULT_EXPIRED");
        (await bo.GetAsync(Rows(annRun))).StatusCode.ShouldBe(HttpStatusCode.NotFound); // others still learn nothing
        (await ann.GetAsync(Rows(second))).StatusCode.ShouldBe(HttpStatusCode.OK);

        (await ann.DeleteAsync(Rows(second).Replace("/rows", ""))).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await ann.GetAsync(Rows(second))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Without_Report_Run_the_rows_endpoint_is_forbidden()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var run = await RunAsync(ann, await h.AddReportAsync(People, roleIds: role));

        (await manager.GetAsync(Rows(run))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task A_fresh_result_survives_a_sweep_of_the_cache()
    {
        await using var h = await ReportTestHarness.StartAsync(sql, true, ("Reports:ResultIdleMinutes", "1"));
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var run = await RunAsync(ann, await h.AddReportAsync(People, roleIds: role));
        var store = h.Factory.Services.GetRequiredService<ReportResultStore>();

        store.Count.ShouldBe(1);
        store.Sweep().ShouldBe(0); // not idle yet
        (await ann.GetAsync(Rows(run))).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task A_result_over_the_memory_budget_is_503_and_nothing_stays_cached()
    {
        await using var h = await ReportTestHarness.StartAsync(sql, true, ("Reports:ResultMemoryBudgetMegabytes", "1"));
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var big = await h.AddReportAsync(
            "SELECT TOP (40000) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n, REPLICATE(N'x', 60) + CAST(ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS nvarchar(10)) AS payload FROM sys.all_objects a CROSS JOIN sys.all_objects b",
            roleIds: role);

        var response = await ann.PostAsync($"/api/v1/reports/{big}/runs", ReportTestHarness.Parameters(new { }));

        response.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable);
        (await ReadAsync(response)).GetProperty("code").GetString().ShouldBe("REPORT_MEMORY");
        h.Factory.Services.GetRequiredService<ReportResultStore>().Count.ShouldBe(0);
        (await h.RunLogAsync(big)).EnumerateArray().ShouldHaveSingleItem().GetProperty("Status").GetString().ShouldNotBe("Running");
    }
}
