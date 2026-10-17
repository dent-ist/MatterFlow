using System.Diagnostics;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Shouldly;
using Xunit.Abstractions;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>GET /api/v1/dashboard/coverage against about 5,000 Tasks, 300 people and 12 task types seeded with set-based SQL: median under 400 ms.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class CoveragePerformanceTests(SqlServerFixture sql, ITestOutputHelper output) : IAsyncLifetime
{
    private const int TaskCount = 5000;
    private const int UserCount = 300;
    private const int TypeCount = 12;

    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        var world = await _h.CreateWorldAsync();
        var typeIds = new List<int> { world.TaskTypeId };
        for (var i = 1; i < TypeCount; i++)
            typeIds.Add(await _h.CreateTaskTypeAsync($"Perf type {i}", [world.OrderedWorkflowId]));
        var admin = await _h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        var role = await _factory.CreateRoleAsync("Perf role", "Task.View");
        await _h.ExecuteAsync(SeedSql(world, admin, role, typeIds));
        (await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.Task")).ShouldBe(TaskCount);
        _factory.InvalidateAll();
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    // Half of the Tasks are COMPLETED in the last 100 days by one of 300 people; the rest are open.
    private static string SeedSql(World w, int adminUserId, int roleId, List<int> typeIds) => $"""
        SET NOCOUNT ON;
        DECLARE @n INT = {TaskCount};
        DECLARE @version INT = (SELECT TOP 1 WorkflowVersionId FROM dbo.WorkflowVersion WHERE WorkflowDefinitionId = {w.OrderedWorkflowId} AND Status = 'PUBLISHED');
        DECLARE @base BIGINT = ISNULL((SELECT MAX(WorkflowInstanceId) FROM dbo.WorkflowInstance), 0);
        DECLARE @baseUser INT = ISNULL((SELECT MAX(UserId) FROM dbo.AppUser), 0);

        ;WITH nums AS (SELECT TOP ({UserCount}) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b)
        INSERT dbo.AppUser (DisplayName, IsActive) SELECT N'Perf person ' + CAST(n AS NVARCHAR(10)), 1 FROM nums;
        INSERT dbo.UserRole (UserId, RoleId) SELECT UserId, {roleId} FROM dbo.AppUser WHERE UserId > @baseUser;

        DECLARE @users TABLE (idx INT NOT NULL, UserId INT NOT NULL);
        INSERT @users SELECT ROW_NUMBER() OVER (ORDER BY UserId) - 1, UserId FROM dbo.AppUser WHERE UserId > @baseUser;
        DECLARE @types TABLE (idx INT NOT NULL, TaskTypeId INT NOT NULL);
        INSERT @types VALUES {string.Join(", ", typeIds.Select((id, i) => $"({i}, {id})"))};

        ;WITH nums AS (SELECT TOP (@n) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b)
        INSERT dbo.WorkflowInstance (WorkflowVersionId, IsOrdered) SELECT @version, 1 FROM nums;

        DECLARE @priority INT = (SELECT TOP 1 PriorityId FROM dbo.Priority ORDER BY SortOrder);
        INSERT dbo.Task (MatterId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, StatusCode, AssignedUserId, RequestorName,
                         DueSortKey, StatusChangedAt, CompletedAt, CreatedAt, CreatedByUserId)
        SELECT {w.MatterId}, t.TaskTypeId, i.WorkflowInstanceId, N'Coverage perf task ' + CAST(i.rn AS NVARCHAR(10)), @priority,
               CASE WHEN i.rn % 2 = 0 THEN 'COMPLETED' ELSE 'IN_PROGRESS' END, u.UserId, N'Requestor',
               NULL, DATEADD(DAY, -(i.rn % 100), SYSUTCDATETIME()),
               CASE WHEN i.rn % 2 = 0 THEN DATEADD(DAY, -(i.rn % 100), SYSUTCDATETIME()) END,
               DATEADD(DAY, -(i.rn % 120), SYSUTCDATETIME()), {adminUserId}
        FROM (SELECT WorkflowInstanceId, ROW_NUMBER() OVER (ORDER BY WorkflowInstanceId) AS rn FROM dbo.WorkflowInstance WHERE WorkflowInstanceId > @base) i
        JOIN @users u ON u.idx = i.rn % {UserCount}
        JOIN @types t ON t.idx = i.rn % {TypeCount};
        """;

    private HttpClient Client()
    {
        var http = _factory.CreateClient();
        http.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        http.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);
        return http;
    }

    [Fact]
    public async Task The_coverage_matrix_is_fast_at_5000_tasks_300_people_and_12_types()
    {
        var http = Client();
        const string url = "/api/v1/dashboard/coverage?periodDays=90";
        await OkAsync(await http.GetAsync(url)); // warm-up
        var timings = new List<long>();
        for (var i = 0; i < 5; i++)
        {
            var watch = Stopwatch.StartNew();
            await OkAsync(await http.GetAsync(url));
            watch.Stop();
            timings.Add(watch.ElapsedMilliseconds);
        }

        output.WriteLine($"{url} ms: {string.Join(", ", timings)}");
        timings.Order().ElementAt(2).ShouldBeLessThan(400, "the median coverage request must stay under 400 ms");

        // The type orientation reads the same grouped counts without the people columns, cells and availability: it must be at least as fast.
        const string typed = url + "&groupBy=type";
        await OkAsync(await http.GetAsync(typed));
        var typedTimings = new List<long>();
        for (var i = 0; i < 5; i++)
        {
            var watch = Stopwatch.StartNew();
            await OkAsync(await http.GetAsync(typed));
            watch.Stop();
            typedTimings.Add(watch.ElapsedMilliseconds);
        }

        output.WriteLine($"{typed} ms: {string.Join(", ", typedTimings)}");
        typedTimings.Order().ElementAt(2).ShouldBeLessThan(400, "the median type-orientation request must stay under 400 ms");

        var board = await OkAsync(await http.GetAsync(url));
        board.GetProperty("users").GetArrayLength().ShouldBeGreaterThanOrEqualTo(UserCount);
        board.GetProperty("taskTypes").GetArrayLength().ShouldBeGreaterThanOrEqualTo(TypeCount);
        board.GetProperty("summary").GetProperty("totalCompleted").GetInt32().ShouldBeGreaterThan(1000);
        // The total agrees with the Task Queue.
        var from = board.GetProperty("from").GetString();
        var to = board.GetProperty("to").GetString();
        var queue = await OkAsync(await http.GetAsync($"/api/v1/task-queue?pageSize=1&status=COMPLETED&completedFrom={from}&completedTo={to}"));
        board.GetProperty("summary").GetProperty("totalCompleted").GetInt32().ShouldBe(queue.GetProperty("total").GetInt32());
    }
}
