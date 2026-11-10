using System.Diagnostics;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Organization;
using MatterFlow.IntegrationTests.Tasks;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Shouldly;
using Xunit.Abstractions;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Configuration;

/// <summary>
/// <c>openTaskCount</c> on the Task Type list and detail (#372) against seeded data: the whole list (the endpoint is not paged) with the counts, in
/// both count sorts, and one type, must come back quickly in a fixed number of statements (the counts are one grouped read for all the types, never
/// one per type), with no SQL script: the existing index <c>IX_Task_Type (TaskTypeId, StatusCode)</c> serves the grouped count.
/// </summary>
public abstract class TaskTypeCountsPerformanceTestsBase(SqlServerFixture sql, ITestOutputHelper output, int tasks, int taskTypes) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private WebApplicationFactory<Program> _logged = null!;
    private readonly CommandLog _commands = new();
    private int _typeId;

    protected ITestOutputHelper Output { get; } = output;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        var h = new TaskHarness(_factory);
        var world = await h.CreateWorldAsync();
        var admin = await h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        await h.ExecuteAsync(CountsSeed.ScaleSql(world, admin, 100, 10, tasks, taskTypes));
        (await h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.Task WHERE Title LIKE N'Scale task%'")).ShouldBe(tasks);
        _typeId = await h.ScalarAsync("SELECT TOP 1 TaskTypeId AS [Value] FROM dbo.TaskType WHERE Name LIKE N'Scale type%' ORDER BY TaskTypeId");
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

    /// <summary>The median budget of a request, in milliseconds (a median of 7).</summary>
    protected abstract int BudgetMs { get; }

    [Fact]
    public async Task The_list_its_count_sorts_and_the_detail_stay_within_budget_in_a_fixed_number_of_statements()
    {
        var http = _logged.CreateClient();
        http.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        http.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);

        foreach (var url in new[] { "/api/v1/task-types", "/api/v1/task-types?sort=-openTaskCount", "/api/v1/task-types?sort=openTaskCount" })
        {
            var (median, statements, list) = await MeasureAsync(http, url);
            list.GetArrayLength().ShouldBe(taskTypes + 1, url);
            list.EnumerateArray().Sum(t => t.GetProperty("openTaskCount").GetInt32()).ShouldBeGreaterThan(0, url);
            median.ShouldBeLessThan(BudgetMs, url);
            statements.ShouldBeLessThan(8, $"{url}: a fixed number of statements, none per type");
            _commands.Snapshot().Count(c => c.Contains("GROUP BY", StringComparison.OrdinalIgnoreCase) && c.Contains("[TaskTypeId]", StringComparison.Ordinal)).ShouldBe(1, url);
        }

        var (oneMedian, oneStatements, one) = await MeasureAsync(http, $"/api/v1/task-types/{_typeId}");
        one.GetProperty("openTaskCount").GetInt32().ShouldBeGreaterThan(0);
        oneMedian.ShouldBeLessThan(BudgetMs);
        oneStatements.ShouldBeLessThan(8);
    }
}

/// <summary>5,000 Tasks over 150 Task Types (the review's data is 74 types and a few thousand Tasks).</summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskTypeCountsPerformanceTests(SqlServerFixture sql, ITestOutputHelper output) : TaskTypeCountsPerformanceTestsBase(sql, output, 5_000, 150)
{
    // Taken on a LOADED machine (load average 21 to 29 on 4 cores; no idle run was possible): list medians 17 to 50 ms, one type 4 to 8 ms, 3 statements.
    // The bound is a safety net against a per-type query or a missing index, to be tightened from idle-machine medians.
    protected override int BudgetMs => 400;
}

/// <summary>50,000 Tasks over 600 Task Types: far above the review's data, with no new index.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskTypeCountsLargePerformanceTests(SqlServerFixture sql, ITestOutputHelper output) : TaskTypeCountsPerformanceTestsBase(sql, output, 50_000, 600)
{
    // Same load: list medians 100 to 430 ms (the response alone is 600 types with their form facts; the grouped count is a few milliseconds), one type 6 ms.
    protected override int BudgetMs => 1000;
}
