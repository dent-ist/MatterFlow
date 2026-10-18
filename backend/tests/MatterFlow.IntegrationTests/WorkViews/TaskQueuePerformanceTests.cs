using System.Diagnostics;
using System.Text.RegularExpressions;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Shouldly;
using Xunit.Abstractions;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// The queue against about 5,000 Tasks seeded with set-based SQL: the default page must come back quickly, and the number of SQL commands must not
/// grow with the page (no per-row lookups).
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed partial class TaskQueuePerformanceTests(SqlServerFixture sql, ITestOutputHelper output) : IAsyncLifetime
{
    private const int TaskCount = 5000;

    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private WebApplicationFactory<Program> _logged = null!;
    private readonly CommandLog _commands = new();

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        var world = await _h.CreateWorldAsync();
        var admin = await _h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        var pod = await _h.CreatePodAsync("Pod Perf", admin);
        await _h.ExecuteAsync(SeedSql(world, admin, pod));
        (await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.Task")).ShouldBe(TaskCount);

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

    private static string SeedSql(TaskHarness.World w, int adminUserId, int podId) => $"""
        SET NOCOUNT ON;
        DECLARE @n INT = {TaskCount};
        DECLARE @version INT = (SELECT TOP 1 WorkflowVersionId FROM dbo.WorkflowVersion WHERE WorkflowDefinitionId = {w.OrderedWorkflowId} AND Status = 'PUBLISHED');
        DECLARE @base BIGINT = ISNULL((SELECT MAX(WorkflowInstanceId) FROM dbo.WorkflowInstance), 0);
        DECLARE @today DATE = CAST(SYSUTCDATETIME() AS DATE);

        ;WITH nums AS (SELECT TOP (@n) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b)
        INSERT dbo.WorkflowInstance (WorkflowVersionId, IsOrdered) SELECT @version, 1 FROM nums;

        INSERT dbo.StepInstance (WorkflowInstanceId, WorkflowVersionStepId, SequenceNo, Title, IsSkippable, SkipCommentRequired, Status)
        SELECT wi.WorkflowInstanceId, vs.WorkflowVersionStepId, vs.SequenceNo, vs.Title, 0, 0, 'PENDING'
        FROM dbo.WorkflowInstance wi JOIN dbo.WorkflowVersionStep vs ON vs.WorkflowVersionId = wi.WorkflowVersionId
        WHERE wi.WorkflowInstanceId > @base;

        DECLARE @priorities TABLE (idx INT NOT NULL, PriorityId INT NOT NULL);
        INSERT @priorities SELECT ROW_NUMBER() OVER (ORDER BY SortOrder) - 1, PriorityId FROM dbo.Priority;
        DECLARE @pc INT = (SELECT COUNT(*) FROM @priorities);

        INSERT dbo.Task (MatterId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, StatusCode, AssignedPodId, AssignedUserId, RequestorName,
                         DueDate, DueAtUtc, DueSortKey, CompletedAt, CreatedAt, CreatedByUserId)
        SELECT {w.MatterId}, {w.TaskTypeId}, i.WorkflowInstanceId, N'Seeded task ' + CAST(i.rn AS NVARCHAR(10)), p.PriorityId, x.st,
               CASE WHEN i.rn % 4 < 2 THEN {podId} END, CASE WHEN i.rn % 3 = 0 THEN {adminUserId} END, N'Requestor ' + CAST(i.rn % 50 AS NVARCHAR(10)),
               x.due, NULL, CASE WHEN x.due IS NULL THEN NULL ELSE DATEADD(MILLISECOND, 86399999, CAST(x.due AS DATETIME2(3))) END,
               CASE WHEN x.st = 'COMPLETED' THEN SYSUTCDATETIME() END, DATEADD(MINUTE, -i.rn, SYSUTCDATETIME()), {adminUserId}
        FROM (SELECT WorkflowInstanceId, ROW_NUMBER() OVER (ORDER BY WorkflowInstanceId) AS rn FROM dbo.WorkflowInstance WHERE WorkflowInstanceId > @base) i
        CROSS APPLY (SELECT CASE i.rn % 10 WHEN 8 THEN 'COMPLETED' WHEN 9 THEN 'ON_HOLD' WHEN 6 THEN 'IN_PROGRESS' WHEN 7 THEN 'IN_PROGRESS' ELSE 'NEW' END AS st,
                            CASE WHEN i.rn % 5 = 0 THEN NULL ELSE DATEADD(DAY, (i.rn % 60) - 20, @today) END AS due) x
        JOIN @priorities p ON p.idx = i.rn % @pc;
        """;

    [Fact]
    public async Task The_default_queue_page_is_fast_and_uses_a_fixed_number_of_queries()
    {
        var client = _h.As(DatabaseApiFactory.AdminAccount);
        var http = _logged.CreateClient();
        http.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        http.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);
        client.ShouldNotBeNull();

        const string openQueue = "/api/v1/task-queue?status=NEW&status=IN_PROGRESS&status=ON_HOLD&pageSize=100";
        var warm = await OkAsync(await http.GetAsync(openQueue));
        warm.GetProperty("total").GetInt32().ShouldBe(TaskCount * 9 / 10);
        warm.GetProperty("items").GetArrayLength().ShouldBe(100);

        var timings = new List<long>();
        List<string> sqlText = [];
        for (var i = 0; i < 5; i++)
        {
            _commands.Clear();
            var watch = Stopwatch.StartNew();
            var page = await OkAsync(await http.GetAsync(openQueue));
            watch.Stop();
            timings.Add(watch.ElapsedMilliseconds);
            page.GetProperty("items").GetArrayLength().ShouldBe(100);
            sqlText = _commands.Snapshot();
        }

        output.WriteLine("default page (100 rows of 4,500 open) ms: " + string.Join(", ", timings));
        foreach (var statement in sqlText)
            output.WriteLine(statement.Length > 220 ? statement[..220] + "..." : statement);

        timings.Order().ElementAt(2).ShouldBeLessThan(1000, "the median request of the default page must stay well under a second");

        // The reads behind a page are: the permission/identity lookups, the id page, the total, the row columns, the status labels and the steps.
        // None of them runs once per row.
        sqlText.Count.ShouldBeLessThan(15, string.Join("\n---\n", sqlText));
        sqlText.GroupBy(Normalize).ShouldAllBe(g => g.Count() <= 2, "no statement may repeat per row");

        var unfiltered = await OkAsync(await http.GetAsync("/api/v1/task-queue?pageSize=100&sort=due&dir=desc"));
        unfiltered.GetProperty("total").GetInt32().ShouldBe(TaskCount);
        var overdue = await OkAsync(await http.GetAsync("/api/v1/task-queue?overdue=true&pageSize=100"));
        overdue.GetProperty("total").GetInt32().ShouldBeGreaterThan(0);
        var myWork = await OkAsync(await http.GetAsync("/api/v1/my-work?pageSize=100"));
        myWork.GetProperty("total").GetInt32().ShouldBeGreaterThan(0);
        var podWork = await OkAsync(await http.GetAsync("/api/v1/pod-work?pageSize=100"));
        podWork.GetProperty("counts").GetProperty("all").GetInt32().ShouldBeGreaterThan(0);
    }

    [Fact]
    public async Task The_quick_view_counts_are_one_statement_that_stays_under_100_ms_at_5000_tasks()
    {
        var http = _logged.CreateClient();
        http.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        http.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);

        const string query = "/api/v1/task-queue?pageSize=1";
        var warm = await OkAsync(await http.GetAsync(query));
        var views = warm.GetProperty("views");
        views.GetProperty("open").GetInt32().ShouldBe(TaskCount * 9 / 10);
        views.GetProperty("createdByMe").GetInt32().ShouldBe(TaskCount);

        var elapsed = new List<int>();
        for (var i = 0; i < 7; i++)
        {
            _commands.Clear();
            await OkAsync(await http.GetAsync(query));
            // The counts are the one statement with a scalar subquery per number.
            var counting = _commands.SnapshotTimed().Where(c => Regex.Matches(c.Text, "SELECT COUNT\\(\\*\\)").Count >= 6).ToList();
            counting.Count.ShouldBe(1, "one statement for all the counts");
            elapsed.Add(counting[0].Millis);
        }

        output.WriteLine("quick view counts statement ms: " + string.Join(", ", elapsed));
        elapsed.Order().ElementAt(3).ShouldBeLessThan(100, "the counts add at most 100 ms to the response (median of 7)");
    }

    [Fact]
    public async Task The_new_sort_keys_stay_fast_at_5000_tasks_and_add_no_statements()
    {
        var http = _logged.CreateClient();
        http.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        http.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);

        var baseline = 0;
        foreach (var sort in new[] { "default", "title", "matter", "updated", "age", "closed", "assignee", "client" })
            foreach (var dir in new[] { "asc", "desc" })
            {
                var query = $"/api/v1/task-queue?pageSize=50&sort={sort}&dir={dir}";
                var last = await OkAsync(await http.GetAsync(query));
                last.GetProperty("total").GetInt32().ShouldBe(TaskCount);
                var timings = new List<long>();
                var statements = 0;
                for (var i = 0; i < 5; i++)
                {
                    _commands.Clear();
                    var watch = Stopwatch.StartNew();
                    await OkAsync(await http.GetAsync(query));
                    watch.Stop();
                    timings.Add(watch.ElapsedMilliseconds);
                    statements = _commands.Snapshot().Count;
                }

                output.WriteLine($"sort={sort} {dir}: ms {string.Join(", ", timings)}, {statements} statements");
                // G3: a page of a scan sort comes back in well under 150 ms on an idle machine; the bound leaves room for a loaded one.
                timings.Order().ElementAt(2).ShouldBeLessThan(500, $"{sort} {dir}");
                if (sort == "default")
                    baseline = statements;
                else
                    statements.ShouldBe(baseline, $"{sort} {dir}: a sort never adds a read");
            }
    }

    [Fact]
    public async Task The_column_text_filters_stay_fast_at_5000_tasks_and_add_no_statements()
    {
        var http = _logged.CreateClient();
        http.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        http.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);

        var open = "status=NEW&status=IN_PROGRESS&status=ON_HOLD&pageSize=100";
        (string Name, string Query, int? Total)[] cases =
        [
            ("matter reference", $"/api/v1/task-queue?{open}&matterText=343-12", TaskCount * 9 / 10),
            ("matter name", $"/api/v1/task-queue?{open}&matterText=merger%20review", TaskCount * 9 / 10),
            ("client name", $"/api/v1/task-queue?{open}&clientText=acme", TaskCount * 9 / 10),
            ("client number", $"/api/v1/task-queue?{open}&clientText=343", TaskCount * 9 / 10),
            ("no match", $"/api/v1/task-queue?{open}&matterText=nowhere", 0),
            ("project, none have one", $"/api/v1/task-queue?{open}&projectText=phase", 0),
            ("updated range", $"/api/v1/task-queue?{open}&updatedFrom=2000-01-01", null),
            ("title and matter and client together", $"/api/v1/task-queue?{open}&q=seeded&matterText=343&clientText=acme", null),
            ("my work with a text filter", "/api/v1/my-work?pageSize=100&matterText=343", null),
            ("pod work with a text filter", "/api/v1/pod-work?pageSize=100&clientText=acme", null),
        ];

        var baseline = new Dictionary<string, int>();
        foreach (var (name, query, total) in cases)
        {
            var warm = await OkAsync(await http.GetAsync(query));
            if (total is { } expected)
                warm.GetProperty("total").GetInt32().ShouldBe(expected, name);

            var timings = new List<long>();
            var statements = 0;
            for (var i = 0; i < 3; i++)
            {
                _commands.Clear();
                var watch = Stopwatch.StartNew();
                await OkAsync(await http.GetAsync(query));
                watch.Stop();
                timings.Add(watch.ElapsedMilliseconds);
                statements = _commands.Snapshot().Count;
            }

            output.WriteLine($"{name}: ms {string.Join(", ", timings)}, {statements} statements");
            timings.Order().ElementAt(1).ShouldBeLessThan(1500, name);
            // The text filters are conditions inside the existing reads, never extra reads and never one read per row.
            baseline[name] = statements;
            statements.ShouldBeLessThan(query.Contains("my-work") || query.Contains("pod-work") ? 25 : 15, name);
        }

        baseline["matter reference"].ShouldBe(baseline["client name"]);
    }

    [Fact]
    public async Task The_page_query_is_answered_from_the_queue_index_without_touching_the_table_rows()
    {
        // The statement EF Core generates for the id page of the open queue, with literal statuses.
        const string pageQuery = """
            SELECT t.TaskId
            FROM dbo.Task AS t
            INNER JOIN dbo.Priority AS p ON t.PriorityId = p.PriorityId
            WHERE t.StatusCode IN ('NEW', 'IN_PROGRESS', 'ON_HOLD')
            ORDER BY p.SortOrder, CASE WHEN t.DueSortKey IS NULL THEN 0 ELSE 1 END, t.DueSortKey, t.CreatedAt, t.TaskId
            OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY
            """;

        var (io, plan) = await _factory.WithDbAsync(async db =>
        {
            var connection = (Microsoft.Data.SqlClient.SqlConnection)db.Database.GetDbConnection();
            await connection.OpenAsync();
            var messages = new List<string>();
            connection.InfoMessage += (_, e) => messages.Add(e.Message);

            async Task RunAsync(string text)
            {
                await using var command = connection.CreateCommand();
                command.CommandText = text;
                await command.ExecuteNonQueryAsync();
            }

            try
            {
                await RunAsync("SET STATISTICS IO ON");
                await RunAsync(pageQuery);
                await RunAsync("SET STATISTICS IO OFF");

                await RunAsync("SET SHOWPLAN_TEXT ON");
                var planText = new List<string>();
                await using (var showplan = connection.CreateCommand())
                {
                    showplan.CommandText = pageQuery;
                    await using var reader = await showplan.ExecuteReaderAsync();
                    do
                    {
                        while (await reader.ReadAsync())
                            planText.Add(reader.GetString(0));
                    }
                    while (await reader.NextResultAsync());
                }

                return (string.Join("\n", messages), string.Join("\n", planText));
            }
            finally
            {
                await RunAsync("SET SHOWPLAN_TEXT OFF");
                await RunAsync("SET STATISTICS IO OFF");
            }
        });

        output.WriteLine(io);
        output.WriteLine(plan);
        plan.ShouldContain("IX_Task_Queue");
        plan.ShouldNotContain("PK_Task", Case.Insensitive, "the queue index covers the page query, so the clustered index is never read");
        plan.ShouldNotContain("Key Lookup", Case.Insensitive);
    }

    private static string Normalize(string statement) => WhitespaceRegex().Replace(statement, " ");

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();

    /// <summary>Captures the text of every SQL command EF Core executes while a request runs.</summary>
    private sealed class CommandLog : ILoggerProvider
    {
        private readonly object _gate = new();
        private readonly List<string> _statements = [];
        private readonly List<int> _millis = [];

        public ILogger CreateLogger(string categoryName) => categoryName == "Microsoft.EntityFrameworkCore.Database.Command" ? new Capture(this) : new NullLogger();

        public void Clear()
        {
            lock (_gate)
            {
                _statements.Clear();
                _millis.Clear();
            }
        }

        /// <summary>The statements with the milliseconds the database reported for each, in execution order.</summary>
        public List<(string Text, int Millis)> SnapshotTimed()
        {
            lock (_gate)
                return [.. _statements.Zip(_millis, (text, ms) => (text, ms))];
        }

        public List<string> Snapshot()
        {
            lock (_gate)
                return [.. _statements];
        }

        public void Dispose()
        {
        }

        private void Add(string message, int millis)
        {
            lock (_gate)
            {
                _statements.Add(message);
                _millis.Add(millis);
            }
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
                {
                    // Drop the "(12ms) [Parameters=[...]]" header so equal statements compare equal.
                    var newline = message.IndexOf('\n', StringComparison.Ordinal);
                    var header = Regex.Match(message, @"\((\d+)ms\)");
                    owner.Add(newline < 0 ? message : message[(newline + 1)..], header.Success ? int.Parse(header.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture) : 0);
                }
            }
        }

        private sealed class NullLogger : ILogger
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
