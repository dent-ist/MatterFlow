using System.Diagnostics;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Shouldly;
using Xunit.Abstractions;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Organization;

/// <summary>
/// The Task counts on the Client, Matter and Project lists and summaries (#258, #259) against seeded data: a page of 100 sorted by the open count,
/// the default-order page with counts, and the three summaries must come back quickly, in a fixed number of statements (the counts are one grouped
/// read for the page, never one per row), with no SQL script (no index) needed.
/// </summary>
public abstract class CountsPerformanceTestsBase(SqlServerFixture sql, ITestOutputHelper output, int clients, int mattersPerClient, int taskCount) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private WebApplicationFactory<Program> _logged = null!;
    private readonly CommandLog _commands = new();
    private int _clientId;
    private int _matterId;
    private int _projectId;

    protected ITestOutputHelper Output { get; } = output;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        var h = new TaskHarness(_factory);
        var world = await h.CreateWorldAsync();
        var admin = await h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        await h.ExecuteAsync(CountsSeed.ScaleSql(world, admin, clients, mattersPerClient, taskCount));
        (await h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.Task WHERE Title LIKE N'Scale task%'")).ShouldBe(taskCount);
        // A Matter that has Projects (every second Matter does), and its Client.
        _projectId = await h.ScalarAsync("SELECT TOP 1 ProjectId AS [Value] FROM dbo.Project WHERE Name LIKE N'Scale project%' ORDER BY ProjectId");
        _matterId = await h.ScalarAsync($"SELECT MatterId AS [Value] FROM dbo.Project WHERE ProjectId = {_projectId}");
        _clientId = await h.ScalarAsync($"SELECT ClientId AS [Value] FROM dbo.Matter WHERE MatterId = {_matterId}");

        _logged = _factory.WithWebHostBuilder(builder => builder.ConfigureServices(services => services.AddLogging(logging =>
        {
            logging.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Information);
            logging.AddProvider(_commands);
        })));
    }

    public async Task DisposeAsync()
    {
        await _logged.DisposeAsync();
        await _factory.DisposeAsync();
    }

    private HttpClient Http()
    {
        var http = _logged.CreateClient();
        http.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        http.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);
        return http;
    }

    /// <summary>The median request time and the statement count of a URL, after a warm-up request.</summary>
    private async Task<(long Median, int Statements, System.Text.Json.JsonElement Last)> MeasureAsync(HttpClient http, string url)
    {
        var last = await OkAsync(await http.GetAsync(url));
        var timings = new List<long>();
        var statements = 0;
        for (var i = 0; i < 7; i++)
        {
            _commands.Clear();
            var watch = Stopwatch.StartNew();
            last = await OkAsync(await http.GetAsync(url));
            watch.Stop();
            timings.Add(watch.ElapsedMilliseconds);
            statements = _commands.Snapshot().Count;
        }

        var median = timings.Order().ElementAt(3);
        Output.WriteLine($"{url}: median {median} ms (all {string.Join(", ", timings)}), {statements} statements");
        return (median, statements, last);
    }

    /// <summary>The median budget of a list or summary request, in milliseconds (a median of 7, idle machine).</summary>
    protected abstract int ListBudgetMs { get; }

    [Fact]
    public async Task The_count_sorts_the_default_pages_and_the_summaries_stay_within_budget_in_a_fixed_number_of_statements()
    {
        var http = Http();

        // A page of 100 sorted by a count: the counts are a grouped left join inside the page statement (count + page = 2 statements).
        foreach (var (list, sort) in new[] { ("clients", "-openTasks"), ("clients", "-overdue"), ("matters", "-openTasks"), ("matters", "overdue"), ("projects", "-openTasks"), ("projects", "-overdue") })
        {
            var (median, statements, page) = await MeasureAsync(http, $"/api/v1/{list}?pageSize=100&sort={sort}");
            page.GetProperty("items").GetArrayLength().ShouldBe(100, $"{list} sorted by {sort}");
            median.ShouldBeLessThan(ListBudgetMs, $"{list} sorted by {sort}");
            statements.ShouldBeLessThan(12, $"{list} sorted by {sort}: a fixed number of statements, none per row");
        }

        // A page of 100 in the default order: one more grouped read for the page's ids, with a bounded IN list (it never groups the whole table).
        foreach (var list in new[] { "clients", "matters", "projects" })
        {
            var (median, statements, page) = await MeasureAsync(http, $"/api/v1/{list}?pageSize=100");
            page.GetProperty("items").GetArrayLength().ShouldBe(100, list);
            median.ShouldBeLessThan(ListBudgetMs, list);
            statements.ShouldBeLessThan(12, list);
            _commands.Snapshot().Count(c => c.Contains("GROUP BY", StringComparison.OrdinalIgnoreCase) && c.Contains("IN (", StringComparison.OrdinalIgnoreCase)).ShouldBe(1, list);
        }

        foreach (var url in new[] { $"/api/v1/clients/{_clientId}/summary", $"/api/v1/matters/{_matterId}/summary", $"/api/v1/projects/{_projectId}/summary" })
        {
            var (median, statements, _) = await MeasureAsync(http, url);
            median.ShouldBeLessThan(ListBudgetMs, url);
            statements.ShouldBeLessThan(12, url);
        }
    }
}

/// <summary>5,000 Tasks, 120 Clients, 1,200 Matters: the bar of the issues (a page of 100 sorted by open tasks, and the summaries, under 100 ms).</summary>
[Collection(SqlServerCollection.Name)]
public sealed class CountsPerformanceTests(SqlServerFixture sql, ITestOutputHelper output) : CountsPerformanceTestsBase(sql, output, 120, 10, 5_000)
{
    protected override int ListBudgetMs => 100;
}

/// <summary>200 Clients, 2,000 Matters, 4,000 Projects and 50,000 Tasks: the list endpoints stay within the budget of the existing performance tests, with no new index.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class CountsLargePerformanceTests(SqlServerFixture sql, ITestOutputHelper output) : CountsPerformanceTestsBase(sql, output, 200, 10, 50_000)
{
    // Idle machine (load average 1 to 3, three runs, final verification 2026-10-20): list medians 30 to 56 ms (the slowest is Projects sorted by a
    // count, 4,000 rows), summaries 4 to 29 ms. Under load (average 14 to 24) the lists reached 117 ms. The bound is about 4.5 times the idle maximum
    // and twice the loaded one: a per-row query or a missing index (hundreds of ms at 50,000 tasks) still fails it.
    protected override int ListBudgetMs => 250;
}
