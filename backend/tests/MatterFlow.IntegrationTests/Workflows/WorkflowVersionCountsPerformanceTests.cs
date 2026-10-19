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

namespace MatterFlow.IntegrationTests.Workflows;

/// <summary>
/// <c>openTaskCount</c> on the workflow versions (#391) against seeded data: all the Tasks run on the published version of one workflow (the worst
/// case for the count), and the workflow read, the version read and the publish-time reads must come back quickly in a fixed number of statements
/// (one grouped count for all the versions), with no SQL script: <c>IX_WorkflowInstance_Version</c> and the unique index of the Task's workflow
/// instance serve the count.
/// </summary>
public abstract class WorkflowVersionCountsPerformanceTestsBase(SqlServerFixture sql, ITestOutputHelper output, int tasks, int extraVersions) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private WebApplicationFactory<Program> _logged = null!;
    private readonly CommandLog _commands = new();
    private int _workflowId;
    private int _versionId;
    private int _expectedOpen;

    protected ITestOutputHelper Output { get; } = output;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        var h = new TaskHarness(_factory);
        var world = await h.CreateWorldAsync();
        var admin = await h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        await h.ExecuteAsync(CountsSeed.ScaleSql(world, admin, 100, 10, tasks));
        (await h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.Task WHERE Title LIKE N'Scale task%'")).ShouldBe(tasks);
        _expectedOpen = await h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.Task WHERE StatusCode IN ('NEW', 'IN_PROGRESS', 'ON_HOLD')");
        _expectedOpen.ShouldBeGreaterThan(0);
        _workflowId = world.OrderedWorkflowId;
        _versionId = await h.ScalarAsync($"SELECT TOP 1 WorkflowVersionId AS [Value] FROM dbo.WorkflowVersion WHERE WorkflowDefinitionId = {_workflowId} AND Status = 'PUBLISHED'");
        // More (retired) versions on the same workflow, so the table has many rows to count.
        await h.ExecuteAsync($"INSERT dbo.WorkflowVersion (WorkflowDefinitionId, VersionNo, Status, PublishedAt) SELECT TOP ({extraVersions}) {_workflowId}, 1 + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)), 'RETIRED', SYSUTCDATETIME() FROM sys.all_objects");
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
    public async Task The_workflow_the_version_and_the_published_view_stay_within_budget_in_a_fixed_number_of_statements()
    {
        var http = _logged.CreateClient();
        http.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        http.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);

        var (median, statements, workflow) = await MeasureAsync(http, $"/api/v1/workflows/{_workflowId}");
        workflow.GetProperty("versions").GetArrayLength().ShouldBe(extraVersions + 1);
        workflow.GetProperty("versions").EnumerateArray().Single(v => v.GetProperty("workflowVersionId").GetInt32() == _versionId).GetProperty("openTaskCount").GetInt32().ShouldBe(_expectedOpen);
        median.ShouldBeLessThan(BudgetMs);
        statements.ShouldBeLessThan(10, "a fixed number of statements, none per version");
        _commands.Snapshot().Count(c => c.Contains("GROUP BY", StringComparison.OrdinalIgnoreCase) && c.Contains("[WorkflowVersionId]", StringComparison.Ordinal)).ShouldBe(1);

        var (oneMedian, oneStatements, one) = await MeasureAsync(http, $"/api/v1/workflows/{_workflowId}/versions/{_versionId}");
        one.GetProperty("version").GetProperty("openTaskCount").GetInt32().ShouldBeGreaterThan(0);
        oneMedian.ShouldBeLessThan(BudgetMs);
        oneStatements.ShouldBeLessThan(10);
    }
}

/// <summary>5,000 Tasks on one version and 41 versions in the workflow.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class WorkflowVersionCountsPerformanceTests(SqlServerFixture sql, ITestOutputHelper output) : WorkflowVersionCountsPerformanceTestsBase(sql, output, 5_000, 40)
{
    // Taken on a LOADED machine (load average 21 to 29 on 4 cores; no idle run was possible): workflow read 21 to 75 ms, one version 40 to 50 ms, 5 to 6
    // statements. The bound is a safety net against a per-version query or a missing index, to be tightened from idle-machine medians.
    protected override int BudgetMs => 400;
}

/// <summary>50,000 Tasks on one version and 201 versions in the workflow: far above any real workflow, with no new index.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class WorkflowVersionCountsLargePerformanceTests(SqlServerFixture sql, ITestOutputHelper output) : WorkflowVersionCountsPerformanceTestsBase(sql, output, 50_000, 200)
{
    // Same load: 50,000 Tasks on one version and 201 versions; the grouped count reads them through the version and Task indexes.
    protected override int BudgetMs => 800;
}
