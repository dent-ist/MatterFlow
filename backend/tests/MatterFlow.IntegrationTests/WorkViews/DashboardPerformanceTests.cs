using System.Diagnostics;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Shouldly;
using Xunit.Abstractions;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>The Dashboard against about 5,000 Tasks seeded with set-based SQL: a few aggregate statements and a generous time bound.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class DashboardPerformanceTests(SqlServerFixture sql, ITestOutputHelper output) : IAsyncLifetime
{
    private const int TaskCount = 5000;

    private DatabaseApiFactory _factory = null!;
    private WebApplicationFactory<Program> _logged = null!;
    private readonly CommandLog _commands = new();
    private readonly List<int> _typeIds = [];

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        var h = new TaskHarness(_factory);
        var world = await h.CreateWorldAsync();
        var admin = await h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        var pod = await h.CreatePodAsync("Pod Perf", admin);

        // The Tasks are spread over eight Task Types (a Task cannot change its type after creation, so they are inserted with it).
        _typeIds.Add(world.TaskTypeId);
        for (var i = 1; i < 8; i++)
            _typeIds.Add(await h.CreateTaskTypeAsync("Perf type " + i, [world.OrderedWorkflowId], withForm: false));
        await h.ExecuteAsync(SeedSql(world, admin, pod, _typeIds));
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
    private static string SeedSql(World w, int adminUserId, int podId, IReadOnlyList<int> typeIds) => $"""
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
        SELECT {w.MatterId}, CASE i.rn % 8 {string.Join(" ", typeIds.Select((id, idx) => $"WHEN {idx} THEN {id}"))} END, i.WorkflowInstanceId, N'Seeded task ' + CAST(i.rn AS NVARCHAR(10)), p.PriorityId, x.st,
               CASE WHEN i.rn % 4 < 2 THEN {podId} END, CASE WHEN i.rn % 3 = 0 THEN {adminUserId} END, N'Requestor ' + CAST(i.rn % 50 AS NVARCHAR(10)),
               x.due, NULL, CASE WHEN x.due IS NULL THEN NULL ELSE DATEADD(MILLISECOND, 86399999, CAST(x.due AS DATETIME2(3))) END,
               DATEADD(DAY, -(i.rn % 90), SYSUTCDATETIME()), CASE WHEN x.st = 'COMPLETED' THEN DATEADD(DAY, -(i.rn % 90), SYSUTCDATETIME()) END,
               DATEADD(DAY, -(i.rn % 120), DATEADD(MINUTE, -i.rn, SYSUTCDATETIME())), {adminUserId}
        FROM (SELECT WorkflowInstanceId, ROW_NUMBER() OVER (ORDER BY WorkflowInstanceId) AS rn FROM dbo.WorkflowInstance WHERE WorkflowInstanceId > @base) i
        CROSS APPLY (SELECT CASE i.rn % 10 WHEN 8 THEN 'COMPLETED' WHEN 9 THEN 'ON_HOLD' WHEN 6 THEN 'IN_PROGRESS' WHEN 7 THEN 'IN_PROGRESS' ELSE 'NEW' END AS st,
                            CASE WHEN i.rn % 5 = 0 THEN NULL ELSE DATEADD(DAY, (i.rn % 60) - 20, @today) END AS due) x
        JOIN @priorities p ON p.idx = i.rn % @pc;
        """;

    [Fact]
    public async Task The_dashboard_is_fast_uses_a_few_statements_and_its_counts_agree_with_the_queue()
    {
        var http = _logged.CreateClient();
        http.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        http.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);

        var warm = await OkAsync(await http.GetAsync("/api/v1/dashboard"));
        warm.GetProperty("open").GetProperty("count").GetInt32().ShouldBe(TaskCount * 9 / 10);

        var timings = new List<long>();
        List<string> statements = [];
        for (var i = 0; i < 5; i++)
        {
            _commands.Clear();
            var watch = Stopwatch.StartNew();
            var dashboard = await OkAsync(await http.GetAsync("/api/v1/dashboard?periodDays=90"));
            watch.Stop();
            timings.Add(watch.ElapsedMilliseconds);
            statements = _commands.Snapshot();
            dashboard.GetProperty("trend").GetArrayLength().ShouldBe(90);
        }

        output.WriteLine("dashboard ms: " + string.Join(", ", timings) + " statements: " + statements.Count);
        timings.Order().ElementAt(2).ShouldBeLessThan(2000, "the median dashboard request must stay far below a few seconds at 5,000 Tasks");
        statements.Count.ShouldBeLessThan(25, string.Join("\n---\n", statements));

        var d = await OkAsync(await http.GetAsync("/api/v1/dashboard"));
        foreach (var name in new[] { "open", "unassigned", "overdue", "onHold", "dueSoon", "asapOpen", "completed", "created" })
        {
            var count = d.GetProperty(name);
            var page = await OkAsync(await http.GetAsync("/api/v1/task-queue?pageSize=1&" + count.GetProperty("query").GetString()));
            page.GetProperty("total").GetInt32().ShouldBe(count.GetProperty("count").GetInt32(), name);
        }

        d.GetProperty("overdue").GetProperty("count").GetInt32().ShouldBeGreaterThan(0);
        d.GetProperty("aging").EnumerateArray().Sum(b => b.GetProperty("count").GetInt32()).ShouldBe(d.GetProperty("open").GetProperty("count").GetInt32());
    }

    [Fact]
    public async Task The_trend_by_task_type_is_fast_uses_a_fixed_number_of_statements_and_adds_up()
    {
        var http = _logged.CreateClient();
        http.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        http.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);
        var ids = string.Join('&', _typeIds.Select(id => "taskTypeIds=" + id));
        var url = $"/api/v1/dashboard/trend?periodDays=90&fresh=true&{ids}";

        var warm = await OkAsync(await http.GetAsync(url));
        warm.GetProperty("byTaskType").GetArrayLength().ShouldBe(8);

        var timings = new List<long>();
        List<string> statements = [];
        JsonElement trend = default;
        for (var i = 0; i < 9; i++)
        {
            _commands.Clear();
            var watch = Stopwatch.StartNew();
            trend = await OkAsync(await http.GetAsync(url));
            watch.Stop();
            timings.Add(watch.ElapsedMilliseconds);
            statements = _commands.Snapshot();
        }

        var median = timings.Order().ElementAt(timings.Count / 2);
        output.WriteLine("trend by type ms: " + string.Join(", ", timings) + " statements: " + statements.Count);
        median.ShouldBeLessThan(300, "p50 of the trend by task type at 5,000 Tasks: " + string.Join(", ", timings));
        statements.Count.ShouldBeLessThanOrEqualTo(4, string.Join("\n---\n", statements)); // catalogue + created + completed + tasks with a due date (no read per type or per day)

        // A full year of overdue snapshots stays as fast.
        var yearWatch = Stopwatch.StartNew();
        var year = await OkAsync(await http.GetAsync($"/api/v1/dashboard/trend?periodDays=365&fresh=true&{ids}"));
        yearWatch.Stop();
        output.WriteLine("trend 365 days ms: " + yearWatch.ElapsedMilliseconds);
        yearWatch.ElapsedMilliseconds.ShouldBeLessThan(600);
        year.GetProperty("all").GetArrayLength().ShouldBe(365);
        year.GetProperty("all").EnumerateArray().Max(p => p.GetProperty("overdue").GetInt32()).ShouldBeGreaterThan(0);

        foreach (var metric in new[] { "created", "completed", "overdue", "onTime", "late" })
        {
            var sum = trend.GetProperty("byTaskType").EnumerateArray()
                .Sum(s => s.GetProperty("points").EnumerateArray().Sum(p => p.GetProperty(metric).GetInt32()));
            sum.ShouldBe(trend.GetProperty("all").EnumerateArray().Sum(p => p.GetProperty(metric).GetInt32()), metric);
        }
    }

    /// <summary>Captures the text of every SQL command EF Core executes while a request runs.</summary>
    private sealed class CommandLog : ILoggerProvider
    {
        private readonly object _gate = new();
        private readonly List<string> _statements = [];

        public ILogger CreateLogger(string categoryName) => categoryName == "Microsoft.EntityFrameworkCore.Database.Command" ? new Capture(this) : new Silent();

        public void Clear()
        {
            lock (_gate)
                _statements.Clear();
        }

        public List<string> Snapshot()
        {
            lock (_gate)
                return [.. _statements];
        }

        public void Dispose()
        {
        }

        private void Add(string message)
        {
            lock (_gate)
                _statements.Add(message);
        }

        private sealed class Capture(CommandLog owner) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state)
                where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => logLevel == LogLevel.Information;

            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            {
                var message = formatter(state, exception);
                if (message.StartsWith("Executed DbCommand", StringComparison.Ordinal))
                    owner.Add(message);
            }
        }

        private sealed class Silent : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state)
                where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => false;

            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            {
            }
        }
    }
}
