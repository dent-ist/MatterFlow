using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// UI update (epic #953, QA): the reads the new My Matters page makes (tree, upcoming events, calendar events, the six-kind feed, task counts with Show, the assets list and the asset detail) against the same
/// harness size as the rest of this class (200 matters, 24,000 tasks, 100,000 assets). Plan budget: p95 300 ms warm and 800 ms cold; the test fails at twice that (shared build machine) and writes the real numbers
/// to the output (recorded in docs/ux/ui-update/qa-report.md). The statement count of each read must not depend on the number of matters.
/// </summary>
public sealed partial class MyMattersPerformanceTests
{
    private const int UiUpdateBudgetMs = 300;

    private PmV2Call[] UiUpdateCalls(string scope)
    {
        var s = scope.Length == 0 ? string.Empty : "&scope=" + scope;
        var q = scope.Length == 0 ? string.Empty : "?scope=" + scope;
        var from = DateTime.UtcNow.Date;
        var window = $"from={from:yyyy-MM-dd}&to={from.AddDays(60):yyyy-MM-dd}";
        PmV2Call Get(string name, string url) => new(name, PmV2Kind.Other, http => http.GetAsync(url));
        return
        [
            Get("tree", "/api/v1/my-matters/tree" + q),
            Get("tree (search)", "/api/v1/my-matters/tree?q=a" + s),
            Get("tree (active only)", "/api/v1/my-matters/tree?activeOnly=true" + s),
            Get("upcoming events", "/api/v1/my-matters/events/upcoming" + q),
            Get("calendar events (60 days)", $"/api/v1/my-matters/events?{window}{s}"),
            Get("feed (all six kinds)", "/api/v1/my-matters/feed" + q),
            Get("feed (unread only)", "/api/v1/my-matters/feed?unread=true" + s),
            Get("feed (overdue + on hold)", "/api/v1/my-matters/feed?kind=OVERDUE&kind=ON_HOLD" + s),
            Get("task counts", "/api/v1/my-matters/task-counts" + q),
            Get("task counts (show overdue)", "/api/v1/my-matters/task-counts?show=overdue" + s),
            Get("assets (first page)", "/api/v1/my-matters/assets?pageSize=25" + s),
            Get("assets (name filter)", "/api/v1/my-matters/assets?name=Perf&pageSize=25" + s),
            Get("assets (sorted by name, page 3)", "/api/v1/my-matters/assets?sort=name&page=3&pageSize=25" + s),
            Get("assets (sorted by linked tasks, desc)", "/api/v1/my-matters/assets?sort=linkedTasks&dir=desc&pageSize=25" + s),
            Get("task grid (open, 25 rows)", "/api/v1/task-queue?pageSize=25&show=overdue"),
        ];
    }

    [Fact]
    public async Task The_my_matters_page_reads_stay_within_the_budget_at_100000_assets_and_24000_tasks()
    {
        await SeedPmV2Async();
        foreach (var client in new[] { _pm5, _pm50, _heavy })
            await OkAsync(await client.GetAsync("/api/v1/my-matters/feed"));

        var admin = AdminAll();
        var failures = new List<string>();
        foreach (var (who, client, scope) in new[] { ("pm5 (5 matters)", _pm5, string.Empty), ("pm50 (50 matters, 25,000 assets)", _pm50, string.Empty), ("heavy (145 matters, 72,500 assets)", _heavy, string.Empty), ("administrator, All matters (100,000 assets)", admin, "all") })
        {
            output.WriteLine($"--- {who}");
            foreach (var call in UiUpdateCalls(scope))
            {
                var m = await MeasureCallAsync(client, call);
                if (m.Warm95 > CeilingFactor * UiUpdateBudgetMs || m.Cold > CeilingFactor * 800)
                    failures.Add($"{who}: {call.Name} cold {m.Cold} ms, warm p95 {m.Warm95} ms (budget {UiUpdateBudgetMs} ms)");
            }
        }

        failures.ShouldBeEmpty(string.Join("\n", failures));
    }

    [Fact]
    public async Task The_number_of_statements_of_the_my_matters_page_reads_does_not_depend_on_the_number_of_matters()
    {
        await SeedPmV2Async();
        foreach (var client in new[] { _pm5, _pm50, _heavy })
            await OkAsync(await client.GetAsync("/api/v1/my-matters/feed"));

        foreach (var call in UiUpdateCalls(string.Empty))
        {
            var a = await MeasureCallAsync(_pm5, call);
            var b = await MeasureCallAsync(_pm50, call);
            var c = await MeasureCallAsync(_heavy, call);
            b.Statements.ShouldBe(c.Statements, call.Name);
            a.Statements.ShouldBeLessThanOrEqualTo(b.Statements, call.Name);
            c.Statements.ShouldBeLessThan(25, call.Name);
        }
    }
}
