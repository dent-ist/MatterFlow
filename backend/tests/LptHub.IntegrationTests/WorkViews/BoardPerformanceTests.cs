using System.Diagnostics;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Shouldly;
using Xunit.Abstractions;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// The Swimlane and Team workload endpoints against about 5,000 Tasks seeded with set-based SQL: median under 450 ms for the grouped board (it was 300 ms; the same test on the previous all-green commit 38f7f85 measured medians of 352, 270 and 318 ms
/// on an idle 4 vCPU machine, current dev 189 to 271 ms, so 300 ms was a property of the machine, not of the code), a handful of statements,
/// the 200-card lane cap with its truncation marker, and counts that agree with the Task Queue.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class BoardPerformanceTests(SqlServerFixture sql, ITestOutputHelper output) : IAsyncLifetime
{
    private const int TaskCount = 5000;

    private DatabaseApiFactory _factory = null!;
    private WebApplicationFactory<Program> _logged = null!;
    private readonly CommandLog _commands = new();

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        var h = new TaskHarness(_factory);
        var world = await h.CreateWorldAsync();
        var admin = await h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        var pod = await h.CreatePodAsync("Pod Perf", admin);
        await h.ExecuteAsync(SeedSql(world, admin, pod));
        (await h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.Task")).ShouldBe(TaskCount);

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

    // Per ten Tasks: 8 NEW/IN_PROGRESS/ON_HOLD-ish open ones (rn % 10 in 0..7, 9) and one COMPLETED (rn % 10 = 8): 4,500 open, 500 completed.
    private static string SeedSql(World w, int adminUserId, int podId) => $"""
        SET NOCOUNT ON;
        DECLARE @n INT = {TaskCount};
        DECLARE @version INT = (SELECT TOP 1 WorkflowVersionId FROM dbo.WorkflowVersion WHERE WorkflowDefinitionId = {w.OrderedWorkflowId} AND Status = 'PUBLISHED');
        DECLARE @base BIGINT = ISNULL((SELECT MAX(WorkflowInstanceId) FROM dbo.WorkflowInstance), 0);
        DECLARE @today DATE = CAST(SYSUTCDATETIME() AS DATE);

        ;WITH nums AS (SELECT TOP (@n) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b)
        INSERT dbo.WorkflowInstance (WorkflowVersionId, IsOrdered) SELECT @version, 1 FROM nums;

        DECLARE @priorities TABLE (idx INT NOT NULL, PriorityId INT NOT NULL);
        INSERT @priorities SELECT ROW_NUMBER() OVER (ORDER BY SortOrder) - 1, PriorityId FROM dbo.Priority;
        DECLARE @pc INT = (SELECT COUNT(*) FROM @priorities);

        INSERT dbo.Task (MatterId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, StatusCode, AssignedPodId, AssignedUserId, RequestorName,
                         DueDate, DueAtUtc, DueSortKey, StatusChangedAt, CompletedAt, CreatedAt, CreatedByUserId)
        SELECT {w.MatterId}, {w.TaskTypeId}, i.WorkflowInstanceId, N'Seeded task ' + CAST(i.rn AS NVARCHAR(10)), p.PriorityId, x.st,
               CASE WHEN i.rn % 4 < 2 THEN {podId} END, CASE WHEN i.rn % 3 = 0 THEN {adminUserId} END, N'Requestor ' + CAST(i.rn % 50 AS NVARCHAR(10)),
               x.due, NULL, CASE WHEN x.due IS NULL THEN NULL ELSE DATEADD(MILLISECOND, 86399999, CAST(x.due AS DATETIME2(3))) END,
               DATEADD(DAY, -(i.rn % 90), SYSUTCDATETIME()), CASE WHEN x.st = 'COMPLETED' THEN DATEADD(DAY, -(i.rn % 90), SYSUTCDATETIME()) END,
               DATEADD(DAY, -(i.rn % 120), DATEADD(MINUTE, -i.rn, SYSUTCDATETIME())), {adminUserId}
        FROM (SELECT WorkflowInstanceId, ROW_NUMBER() OVER (ORDER BY WorkflowInstanceId) AS rn FROM dbo.WorkflowInstance WHERE WorkflowInstanceId > @base) i
        CROSS APPLY (SELECT CASE i.rn % 10 WHEN 8 THEN 'COMPLETED' WHEN 9 THEN 'ON_HOLD' WHEN 6 THEN 'IN_PROGRESS' WHEN 7 THEN 'IN_PROGRESS' ELSE 'NEW' END AS st,
                            CASE WHEN i.rn % 5 = 0 THEN NULL ELSE DATEADD(DAY, (i.rn % 60) - 20, @today) END AS due) x
        JOIN @priorities p ON p.idx = i.rn % @pc;
        """;

    private HttpClient Client()
    {
        var http = _logged.CreateClient();
        http.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        http.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);
        return http;
    }

    private async Task<(long MedianMs, int Statements)> MeasureAsync(HttpClient http, string url)
    {
        await OkAsync(await http.GetAsync(url)); // warm-up
        var timings = new List<long>();
        var statements = 0;
        for (var i = 0; i < 5; i++)
        {
            _commands.Clear();
            var watch = Stopwatch.StartNew();
            await OkAsync(await http.GetAsync(url));
            watch.Stop();
            timings.Add(watch.ElapsedMilliseconds);
            statements = _commands.Snapshot().Count;
        }

        output.WriteLine($"{url} ms: {string.Join(", ", timings)} statements: {statements}");
        return (timings.Order().ElementAt(2), statements);
    }

    [Fact]
    public async Task The_swimlane_is_fast_capped_per_lane_and_its_counts_agree_with_the_queue()
    {
        var http = Client();

        var (median, statements) = await MeasureAsync(http, "/api/v1/dashboard/swimlane?groupBy=clientMatter");
        median.ShouldBeLessThan(450, "the median swimlane request must stay under 450 ms at 5,000 Tasks");
        statements.ShouldBeLessThan(25);
        (await MeasureAsync(http, "/api/v1/dashboard/swimlane?sort=clientMatter&completedDays=30")).MedianMs.ShouldBeLessThan(600, "the client/matter sort joins two more tables");

        var board = await OkAsync(await http.GetAsync("/api/v1/dashboard/swimlane?groupBy=priority"));
        foreach (var lane in board.GetProperty("lanes").EnumerateArray())
        {
            var status = lane.GetProperty("status").GetString();
            lane.GetProperty("cards").GetArrayLength().ShouldBe(Math.Min(200, lane.GetProperty("count").GetInt32()), status);
            lane.GetProperty("truncated").GetBoolean().ShouldBe(lane.GetProperty("count").GetInt32() > 200, status);
            lane.GetProperty("total").GetInt32().ShouldBe(lane.GetProperty("count").GetInt32(), status);
        }

        var newLane = board.GetProperty("lanes").EnumerateArray().Single(l => l.GetProperty("status").GetString() == "NEW");
        newLane.GetProperty("truncated").GetBoolean().ShouldBeTrue();
        var queue = await OkAsync(await http.GetAsync("/api/v1/task-queue?pageSize=1&status=NEW"));
        newLane.GetProperty("count").GetInt32().ShouldBe(queue.GetProperty("total").GetInt32());

        // Group counts are exact (not capped) and add up to the lane counts.
        var groups = board.GetProperty("groups").EnumerateArray().ToList();
        groups.Sum(g => g.GetProperty("counts").GetProperty("new").GetInt32()).ShouldBe(newLane.GetProperty("count").GetInt32());
        board.GetProperty("lanes").EnumerateArray().Sum(l => l.GetProperty("count").GetInt32()).ShouldBe(groups.Sum(g => g.GetProperty("count").GetInt32()));
    }

    [Fact]
    public async Task The_workload_is_fast_and_its_counts_agree_with_the_queue()
    {
        var http = Client();

        var (median, statements) = await MeasureAsync(http, "/api/v1/dashboard/workload");
        median.ShouldBeLessThan(300, "the median workload request must stay under 300 ms at 5,000 Tasks");
        statements.ShouldBeLessThan(25);

        var board = await OkAsync(await http.GetAsync("/api/v1/dashboard/workload"));
        var admin = board.GetProperty("users").EnumerateArray().Single(u => u.GetProperty("displayName").GetString() == @"ke\kekim");
        var open = await OkAsync(await http.GetAsync($"/api/v1/task-queue?pageSize=1&status=NEW&status=IN_PROGRESS&status=ON_HOLD&assignee={admin.GetProperty("userId").GetInt32()}"));
        admin.GetProperty("openTotal").GetInt32().ShouldBe(open.GetProperty("total").GetInt32());
        admin.GetProperty("openTotal").GetInt32().ShouldBeGreaterThan(0);
        admin.GetProperty("overdue").GetInt32().ShouldBeGreaterThan(0);
        admin.GetProperty("loadLevel").GetString().ShouldBe("HEAVY");
        var unassigned = await OkAsync(await http.GetAsync("/api/v1/task-queue?pageSize=1&status=NEW&status=IN_PROGRESS&status=ON_HOLD&unassigned=true"));
        board.GetProperty("summary").GetProperty("unassignedTasks").GetInt32().ShouldBe(unassigned.GetProperty("total").GetInt32());
    }
}
