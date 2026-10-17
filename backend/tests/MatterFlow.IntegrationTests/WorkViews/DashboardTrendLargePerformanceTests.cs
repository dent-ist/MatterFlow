using System.Diagnostics;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Shouldly;
using Xunit.Abstractions;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// The Trends endpoint (daily and weekly, with the Open series) against 50,000 Tasks seeded with set-based SQL: the budget of the Open at end of day
/// series (#120) is a median under 300 ms (600 ms for a full year) without a new index. The same seed as <see cref="DashboardPerformanceTests"/>, ten times larger.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class DashboardTrendLargePerformanceTests(SqlServerFixture sql, ITestOutputHelper output) : IAsyncLifetime
{
    private const int TaskCount = 50_000;

    private DatabaseApiFactory _factory = null!;
    private readonly List<int> _typeIds = [];

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        var h = new TaskHarness(_factory);
        var world = await h.CreateWorldAsync();
        var admin = await h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        var pod = await h.CreatePodAsync("Pod Perf", admin);
        _typeIds.Add(world.TaskTypeId);
        for (var i = 1; i < 8; i++)
            _typeIds.Add(await h.CreateTaskTypeAsync("Perf type " + i, [world.OrderedWorkflowId], withForm: false));
        await h.ExecuteAsync(DashboardPerformanceTests.SeedSql(world, admin, pod, _typeIds, TaskCount));
        (await h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.Task")).ShouldBe(TaskCount);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    [Theory]
    [InlineData("periodDays=30", "day", 30, 300)]
    [InlineData("periodDays=90", "week", 0, 300)]
    // A year reads every task of this seed (all created in the last 120 days) and has the same 600 ms budget as the 365-day read of DashboardPerformanceTests.
    [InlineData("periodDays=366", "week", 0, 600)]
    public async Task The_trend_with_the_open_series_stays_within_budget_at_50000_tasks(string period, string granularity, int points, int budgetMs)
    {
        var http = _factory.CreateClient();
        http.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        http.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);
        var ids = string.Join('&', _typeIds.Select(id => "taskTypeIds=" + id));
        var url = $"/api/v1/dashboard/trend?{period}&fresh=true&{ids}";

        var trend = await OkAsync(await http.GetAsync(url));
        var timings = new List<long>();
        for (var i = 0; i < 7; i++)
        {
            var watch = Stopwatch.StartNew();
            trend = await OkAsync(await http.GetAsync(url));
            watch.Stop();
            timings.Add(watch.ElapsedMilliseconds);
        }

        var median = timings.Order().ElementAt(timings.Count / 2);
        output.WriteLine($"{period} at {TaskCount} tasks ms: " + string.Join(", ", timings));
        median.ShouldBeLessThan(budgetMs, "p50 of the trend with the Open series: " + string.Join(", ", timings));
        trend.GetProperty("granularity").GetString().ShouldBe(granularity);
        if (points > 0)
            trend.GetProperty("all").GetArrayLength().ShouldBe(points);

        // The last point is the Open tile, and the per-type series add up to it.
        var open = trend.GetProperty("all").EnumerateArray().Select(p => p.GetProperty("open").GetInt32()).ToList();
        open[^1].ShouldBe(TaskCount * 9 / 10);
        trend.GetProperty("byTaskType").EnumerateArray().Sum(s => s.GetProperty("points").EnumerateArray().Last().GetProperty("open").GetInt32()).ShouldBe(open[^1]);
    }
}
