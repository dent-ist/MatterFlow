using System.Diagnostics;
using System.Net.Http.Json;
using System.Xml.Linq;
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
/// The My Matters endpoints against the size the plan names (epic #667, issue #686): 200 matters, 24,000 tasks of which 20,000 are open, three steps per
/// task and about 100,000 audit events, seeded with set-based SQL. Budget: each endpoint p95 under 300 ms warm and 800 ms cold on the reference machine;
/// this test fails at twice that so a busy shared build machine does not make it flaky, and writes the real numbers to the test output (recorded in
/// docs/ux/pm-review/performance.md). Also: a fixed number of statements whatever the number of matters, and no scan of the Task table for a person who
/// manages a normal share of the matters.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class MyMattersPerformanceTests(SqlServerFixture sql, ITestOutputHelper output) : IAsyncLifetime
{
    private const int MatterCount = 200;
    private const int OpenTasks = 20_000;
    private const int ClosedTasks = 4_000;
    private const int WarmRuns = 15;

    private DatabaseApiFactory _factory = null!;
    private WebApplicationFactory<Program> _logged = null!;
    private TaskHarness _h = null!;
    private readonly CommandLog _commands = new();
    private HttpClient _pm5 = null!;
    private HttpClient _pm50 = null!;
    private HttpClient _heavy = null!;
    private HttpClient _director = null!;
    private HttpClient _clients = null!;
    private HttpClient _observer = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        var world = await _h.CreateWorldAsync();
        var admin = await _h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        string[] perms = ["Task.View", "Matter.View", "Matter.BeManager", "Client.View", "Project.View", "Asset.View"];
        await _h.UserWithAsync(@"KE\pm5", perms);
        await _h.UserWithAsync(@"KE\pm50", perms);
        await _h.UserWithAsync(@"KE\heavy", perms);
        await _h.UserWithAsync(@"KE\perfdirector", "Task.View", "Matter.View", "Matter.AssignManagers");
        await _h.UserWithAsync(@"KE\pmclients", perms);
        await _h.UserWithAsync(@"KE\perfobserver", "Task.View", "Matter.View", "Client.View", "Project.View", "Asset.View");
        var pm5 = await _h.UserIdAsync(@"KE\pm5");
        var pm50 = await _h.UserIdAsync(@"KE\pm50");
        var heavy = await _h.UserIdAsync(@"KE\heavy");
        var clientsPm = await _h.UserIdAsync(@"KE\pmclients");
        var pods = new List<int>();
        for (var i = 0; i < 4; i++)
            pods.Add(await _h.CreatePodAsync("Perf pod " + i));

        await _h.ExecuteAsync(SeedSql(world, admin, pm5, pm50, heavy, clientsPm, pods));
        (await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.Task WHERE StatusCode <> 'COMPLETED' AND Title LIKE N'Seeded %'")).ShouldBe(OpenTasks);
        (await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.Matter WHERE Name LIKE N'Perf matter %'")).ShouldBe(MatterCount);
        _factory.InvalidateAll();

        _logged = _factory.WithWebHostBuilder(builder => builder.ConfigureServices(services => services.AddLogging(logging =>
        {
            logging.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Information);
            logging.AddProvider(_commands);
        })));
        _pm5 = Client(@"KE\pm5");
        _pm50 = Client(@"KE\pm50");
        _heavy = Client(@"KE\heavy");
        _director = Client(@"KE\perfdirector");
        _clients = Client(@"KE\pmclients");
        _observer = Client(@"KE\perfobserver");
    }

    public async Task DisposeAsync()
    {
        await _logged.DisposeAsync();
        await _factory.DisposeAsync();
    }

    private HttpClient Client(string user)
    {
        var http = _logged.CreateClient();
        http.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        http.DefaultRequestHeaders.Add("X-Dev-User", user);
        return http;
    }

    // Matters 1-5: pm5. 6-55: pm50 (50 matters, a normal share). 56-200: heavy (145 matters, the worst case for "mine"); 6-15 also list heavy as Secondary.
    // Tasks: 24,000 over the 200 matters; every 6th is Completed, one in twelve open ones On Hold since 0-20 days, two in three have no assignee, one in six has no due date.
    private static string SeedSql(TaskHarness.World w, int adminUserId, int pm5, int pm50, int heavy, int clientsPm, IReadOnlyList<int> pods) => $"""
        SET NOCOUNT ON;
        DECLARE @clientId INT = (SELECT TOP 1 ClientId FROM dbo.Client);
        DECLARE @clientNumber CHAR(5) = (SELECT TOP 1 ClientNumber FROM dbo.Client);
        DECLARE @today DATE = CAST(SYSUTCDATETIME() AS DATE);

        INSERT dbo.AppUser (DisplayName) SELECT TOP (20) N'Perf person ' + RIGHT('00' + CAST(ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS VARCHAR(3)), 2) FROM sys.all_objects;
        DECLARE @people TABLE (idx INT NOT NULL, UserId INT NOT NULL);
        INSERT @people SELECT ROW_NUMBER() OVER (ORDER BY UserId) - 1, UserId FROM dbo.AppUser WHERE DisplayName LIKE N'Perf person %';
        DECLARE @podTable TABLE (idx INT NOT NULL, PodId INT NOT NULL);
        INSERT @podTable SELECT ROW_NUMBER() OVER (ORDER BY PodId) - 1, PodId FROM dbo.Pod WHERE Name LIKE N'Perf pod %';

        ;WITH nums AS (SELECT TOP ({MatterCount}) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects)
        INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name, PrimaryManagerId, SecondaryManagerId)
        SELECT @clientId, @clientNumber, RIGHT('0000' + CAST(n + 100 AS VARCHAR(5)), 5), N'Perf matter ' + CAST(n AS NVARCHAR(5)),
               CASE WHEN n <= 5 THEN {pm5} WHEN n <= 55 THEN {pm50} ELSE {heavy} END,
               CASE WHEN n BETWEEN 6 AND 15 THEN {heavy} END
        FROM nums;
        DECLARE @matters TABLE (idx INT NOT NULL, MatterId INT NOT NULL);
        INSERT @matters SELECT CAST(REPLACE(Name, N'Perf matter ', N'') AS INT) - 1, MatterId FROM dbo.Matter WHERE Name LIKE N'Perf matter %';

        DECLARE @n INT = {OpenTasks + ClosedTasks};
        DECLARE @version INT = (SELECT TOP 1 WorkflowVersionId FROM dbo.WorkflowVersion WHERE WorkflowDefinitionId = {w.OrderedWorkflowId} AND Status = 'PUBLISHED');
        DECLARE @base BIGINT = ISNULL((SELECT MAX(WorkflowInstanceId) FROM dbo.WorkflowInstance), 0);
        ;WITH nums AS (SELECT TOP (@n) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b)
        INSERT dbo.WorkflowInstance (WorkflowVersionId, IsOrdered) SELECT @version, 1 FROM nums;

        INSERT dbo.StepInstance (WorkflowInstanceId, WorkflowVersionStepId, SequenceNo, Title, IsSkippable, SkipCommentRequired, Status, FirstResolvedAt, ResolvedAt)
        SELECT i.WorkflowInstanceId, vs.WorkflowVersionStepId, vs.SequenceNo, vs.Title, 0, 0, st.Status,
               CASE WHEN st.Status = 'COMPLETED' THEN SYSUTCDATETIME() END, CASE WHEN st.Status = 'COMPLETED' THEN SYSUTCDATETIME() END
        FROM dbo.WorkflowInstance i
        JOIN dbo.WorkflowVersionStep vs ON vs.WorkflowVersionId = @version
        CROSS APPLY (SELECT CASE WHEN (i.WorkflowInstanceId + vs.SequenceNo) % 3 = 0 THEN 'COMPLETED' ELSE 'PENDING' END AS Status) st
        WHERE i.WorkflowInstanceId > @base;

        DECLARE @priorities TABLE (idx INT NOT NULL, PriorityId INT NOT NULL);
        INSERT @priorities SELECT ROW_NUMBER() OVER (ORDER BY SortOrder) - 1, PriorityId FROM dbo.Priority;
        DECLARE @pc INT = (SELECT COUNT(*) FROM @priorities);

        INSERT dbo.Task (MatterId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, StatusCode, AssignedPodId, AssignedUserId, RequestorName,
                         DueDate, DueAtUtc, DueSortKey, StatusChangedAt, CompletedAt, CreatedAt, CreatedByUserId)
        SELECT m.MatterId, {w.TaskTypeId}, i.WorkflowInstanceId, N'Seeded task ' + CAST(i.rn AS NVARCHAR(10)), p.PriorityId, x.st,
               CASE WHEN i.rn % 4 < 2 THEN pod.PodId END, CASE WHEN i.rn % 3 = 0 THEN u.UserId END, N'Requestor ' + CAST(i.rn % 50 AS NVARCHAR(10)),
               x.due, NULL, CASE WHEN x.due IS NULL THEN NULL ELSE DATEADD(MILLISECOND, 86399999, CAST(x.due AS DATETIME2(3))) END,
               CASE WHEN x.st = 'ON_HOLD' THEN DATEADD(DAY, -(i.rn % 21), SYSUTCDATETIME()) ELSE DATEADD(DAY, -(i.rn % 90), SYSUTCDATETIME()) END,
               CASE WHEN x.st = 'COMPLETED' THEN DATEADD(DAY, -(i.rn % 90), SYSUTCDATETIME()) END,
               DATEADD(DAY, -(i.rn % 120), DATEADD(MINUTE, -i.rn, SYSUTCDATETIME())), {adminUserId}
        FROM (SELECT WorkflowInstanceId, ROW_NUMBER() OVER (ORDER BY WorkflowInstanceId) AS rn FROM dbo.WorkflowInstance WHERE WorkflowInstanceId > @base) i
        CROSS APPLY (SELECT CASE WHEN i.rn % 6 = 0 THEN 'COMPLETED' WHEN i.rn % 12 = 1 THEN 'ON_HOLD' WHEN i.rn % 3 = 0 THEN 'IN_PROGRESS' ELSE 'NEW' END AS st,
                            CASE WHEN i.rn % 6 = 5 THEN NULL ELSE DATEADD(DAY, (i.rn % 60) - 12, @today) END AS due) x
        JOIN @matters m ON m.idx = i.rn % {MatterCount}
        JOIN @priorities p ON p.idx = i.rn % @pc
        JOIN @podTable pod ON pod.idx = i.rn % {pods.Count}
        JOIN @people u ON u.idx = i.rn % 20;

        -- Epic #758 (#770): 300 more clients with one matter each (managed by one more project manager), three projects on every matter, and 100,000 assets on the 200 matters.
        ;WITH nums AS (SELECT TOP (300) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects)
        INSERT dbo.Client (ClientNumber, Name) SELECT CAST(70000 + n AS CHAR(5)), N'Perf client ' + CAST(n AS NVARCHAR(5)) FROM nums;
        INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name, PrimaryManagerId)
        SELECT c.ClientId, c.ClientNumber, '00101', N'Perf extra matter ' + SUBSTRING(c.Name, 13, 10), {clientsPm} FROM dbo.Client c WHERE c.Name LIKE N'Perf client %';
        INSERT dbo.Project (MatterId, Name)
        SELECT m.MatterId, N'Perf project ' + CAST(v.k AS NVARCHAR(2)) FROM @matters m CROSS JOIN (VALUES (1), (2), (3)) v(k)
        UNION ALL SELECT m.MatterId, N'Perf project 1' FROM dbo.Matter m WHERE m.Name LIKE N'Perf extra matter %';
        DECLARE @assetTypes TABLE (idx INT NOT NULL, AssetTypeId INT NOT NULL);
        INSERT dbo.AssetType (Name) VALUES (N'Perf laptop'), (N'Perf phone'), (N'Perf drive'), (N'Perf mailbox'), (N'Perf share');
        INSERT @assetTypes SELECT ROW_NUMBER() OVER (ORDER BY AssetTypeId) - 1, AssetTypeId FROM dbo.AssetType WHERE Name LIKE N'Perf %';
        ;WITH nums AS (SELECT TOP (100000) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b)
        INSERT dbo.Asset (MatterId, AssetTypeId, DisplayName, CreatedByUserId)
        SELECT m.MatterId, t.AssetTypeId, N'Perf asset ' + CAST(nums.n AS NVARCHAR(10)), {adminUserId}
        FROM nums JOIN @matters m ON m.idx = nums.n % {MatterCount} JOIN @assetTypes t ON t.idx = nums.n % 5;

        -- About 100,000 audit events in time order: each task is created, plus three events of kinds the panel does not show, and the on-hold ones a status change.
        INSERT dbo.AuditEvent (OccurredAtUtc, ActorUserId, EventType, ObjectType, ObjectId, MatterId, TaskId, FieldKey, OldValue, NewValue, CorrelationId)
        SELECT e.At, {adminUserId}, e.Kind, 'Task', CAST(e.TaskId AS VARCHAR(20)), e.MatterId, e.TaskId, e.Field, e.OldV, e.NewV, NEWID()
        FROM (
            SELECT t.CreatedAt AS At, 'TASK_CREATED' AS Kind, t.TaskId, t.MatterId, CAST(NULL AS VARCHAR(100)) AS Field, CAST(NULL AS NVARCHAR(MAX)) AS OldV, CAST(NULL AS NVARCHAR(MAX)) AS NewV FROM dbo.Task t
            UNION ALL SELECT DATEADD(HOUR, 1, t.CreatedAt), 'FIELD_CHANGED', t.TaskId, t.MatterId, 'priority', N'Normal', N'High' FROM dbo.Task t
            UNION ALL SELECT DATEADD(HOUR, 2, t.CreatedAt), 'FIELD_CHANGED', t.TaskId, t.MatterId, 'dueDate', N'a', N'b' FROM dbo.Task t
            UNION ALL SELECT DATEADD(HOUR, 3, t.CreatedAt), 'STEP_COMPLETED', t.TaskId, t.MatterId, NULL, NULL, NULL FROM dbo.Task t
            UNION ALL SELECT t.StatusChangedAt, 'TASK_STATUS_CHANGED', t.TaskId, t.MatterId, 'status', 'NEW', 'ON_HOLD' FROM dbo.Task t WHERE t.StatusCode = 'ON_HOLD'
        ) e
        ORDER BY e.At;
        """;

    private sealed record Measure(string Name, long Cold, long Warm95, int Statements);

    private async Task<Measure> MeasureAsync(HttpClient http, string name, string url)
    {
        _commands.Clear();
        var watch = Stopwatch.StartNew();
        await OkAsync(await http.GetAsync(url));
        watch.Stop();
        var cold = watch.ElapsedMilliseconds;
        var timings = new List<long>();
        var statements = 0;
        for (var i = 0; i < WarmRuns; i++)
        {
            _commands.Clear();
            watch.Restart();
            await OkAsync(await http.GetAsync(url));
            watch.Stop();
            timings.Add(watch.ElapsedMilliseconds);
            statements = _commands.Snapshot().Count;
        }

        timings.Sort();
        var p95 = timings[(int)Math.Ceiling(timings.Count * 0.95) - 1];
        output.WriteLine($"{name,-40} cold {cold,4} ms   warm median {timings[timings.Count / 2],4} ms   p95 {p95,4} ms   {statements} statements   {url}");
        return new Measure(name, cold, p95, statements);
    }

    private static readonly (string Name, string Url)[] Endpoints =
    [
        ("summary", "/api/v1/my-matters/summary?fresh=true"),
        ("attention", "/api/v1/my-matters/attention"),
        ("health (first page, next deadline)", "/api/v1/my-matters/health"),
        ("health (sorted by open)", "/api/v1/my-matters/health?sort=open"),
        ("health (page 2, size 50)", "/api/v1/my-matters/health?page=2"),
        ("workload", "/api/v1/my-matters/workload"),
        ("deadlines (14 days)", "/api/v1/my-matters/deadlines"),
        ("deadlines (28 days)", "/api/v1/my-matters/deadlines?days=28"),
        ("activity (30)", "/api/v1/my-matters/activity"),
        // Epic #758 (#770): the additions of the monitoring views.
        ("deadlines (14 days, by day)", "/api/v1/my-matters/deadlines?groupBy=day"),
        ("deadlines (28 days, by day)", "/api/v1/my-matters/deadlines?days=28&groupBy=day"),
        ("deadlines (14 days, by matter)", "/api/v1/my-matters/deadlines?groupBy=matter"),
        ("workload (with matters)", "/api/v1/my-matters/workload?include=matters"),
        ("activity (filtered: status changes)", "/api/v1/my-matters/activity?kind=STATUS_CHANGED&take=50"),
        ("since your last visit", "/api/v1/my-matters/since-last-visit"),
        ("trends (8 weeks)", "/api/v1/my-matters/trends"),
        ("trends (26 weeks)", "/api/v1/my-matters/trends?weeks=26"),
    ];

    [Fact]
    public async Task Every_endpoint_stays_within_the_budget_for_a_normal_share_the_worst_case_and_the_all_scope()
    {
        // The first activity call also creates the person's read marker; do it once so cold numbers are about reading.
        foreach (var client in new[] { _pm5, _pm50, _heavy, _director })
            await OkAsync(await client.GetAsync("/api/v1/my-matters/activity?scope=" + (client == _director ? "all" : "mine")));

        var failures = new List<string>();
        foreach (var (who, client, scope) in new[] { ("pm50 (50 matters)", _pm50, ""), ("heavy (145 matters)", _heavy, ""), ("director, All matters", _director, "all") })
        {
            output.WriteLine($"--- {who}");
            foreach (var (name, url) in Endpoints)
            {
                var full = scope.Length == 0 ? url : url + (url.Contains('?', StringComparison.Ordinal) ? "&" : "?") + "scope=" + scope;
                var m = await MeasureAsync(client, name, full);
                // The plan's budget is p95 300 ms warm / 800 ms cold; the test allows twice that on a shared build machine.
                if (m.Warm95 > 600 || m.Cold > 1600)
                    failures.Add($"{who}: {name} cold {m.Cold} ms, warm p95 {m.Warm95} ms");
            }
        }

        failures.ShouldBeEmpty(string.Join("\n", failures));
    }

    private const int ListBudgetMs = 600;

    [Fact]
    public async Task The_scoped_lists_of_assets_clients_and_projects_stay_within_the_budget()
    {
        // 100,000 assets over the 200 matters; 300 more clients with a matter and a project each, managed by one person.
        (await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.Asset")).ShouldBe(100_000);
        var failures = new List<string>();
        foreach (var (who, client, lists) in new[]
        {
            ("pm5 (5 matters, 2,500 assets)", _pm5, new[] { "assets", "clients", "projects" }),
            ("pm50 (50 matters, 25,000 assets)", _pm50, new[] { "assets", "clients", "projects" }),
            ("heavy (145 matters, 72,500 assets)", _heavy, new[] { "assets", "clients", "projects" }),
            ("pmclients (300 clients)", _clients, new[] { "clients", "projects" }),
        })
        {
            output.WriteLine($"--- {who}");
            foreach (var list in lists)
            {
                foreach (var (name, url) in new[]
                {
                    ($"{list} unfiltered", $"/api/v1/{list}?pageSize=50"),
                    ($"{list} matterManagedByMe", $"/api/v1/{list}?pageSize=50&matterManagedByMe=true"),
                    ($"{list} matterManagedByMe, primary", $"/api/v1/{list}?pageSize=50&matterManagedByMe=true&role=primary"),
                })
                {
                    var m = await MeasureAsync(client, name, url);
                    if (m.Warm95 > ListBudgetMs || m.Cold > 2 * ListBudgetMs)
                        failures.Add($"{who}: {name} cold {m.Cold} ms, warm p95 {m.Warm95} ms");
                }
            }
        }

        failures.ShouldBeEmpty(string.Join("\n", failures));
    }

    [Fact]
    public async Task Search_with_the_in_my_matters_flag_is_not_slower_than_search_without_it_by_more_than_ten_percent()
    {
        // A project manager gets the flag (an IN on the managed matter ids inside the same statement); an observer (no Matter.BeManager) gets null and no extra work.
        foreach (var client in new[] { _pm50, _heavy, _observer })
            await OkAsync(await client.GetAsync("/api/v1/search?q=Perf"));

        foreach (var (name, url) in new[] { ("global search 'Perf'", "/api/v1/search?q=Perf"), ("global search 'asset 77'", "/api/v1/search?q=asset%2077"), ("advanced asset search 'Perf asset 9'", "/api/v1/search/advanced?type=asset&q=Perf%20asset%209") })
        {
            foreach (var (who, flagged) in new[] { ("pm50", _pm50), ("heavy", _heavy) })
            {
                var with = new List<long>();
                var without = new List<long>();
                for (var i = 0; i < 25; i++)
                {
                    // Alternate, so a busy moment of the machine hits both sides alike.
                    with.Add(await TimeAsync(flagged, url));
                    without.Add(await TimeAsync(_observer, url));
                }

                with.Sort();
                without.Sort();
                long Pct(List<long> v, double p) => v[(int)Math.Ceiling(v.Count * p) - 1];
                output.WriteLine($"{name,-40} {who,-6} with flag: median {with[with.Count / 2]} ms p95 {Pct(with, 0.95)} ms | without: median {without[without.Count / 2]} ms p95 {Pct(without, 0.95)} ms");
                // Ten percent, plus 10 ms for the timer on a shared machine.
                with[with.Count / 2].ShouldBeLessThanOrEqualTo((long)(without[without.Count / 2] * 1.10) + 10, $"{name} as {who}: median");
                Pct(with, 0.95).ShouldBeLessThanOrEqualTo(ListBudgetMs, $"{name} as {who}: p95");
            }
        }
    }

    private static async Task<long> TimeAsync(HttpClient http, string url)
    {
        var watch = Stopwatch.StartNew();
        await OkAsync(await http.GetAsync(url));
        return watch.ElapsedMilliseconds;
    }

    [Fact]
    public async Task The_matter_overview_is_one_call_with_a_constant_number_of_statements_within_the_budget()
    {
        var small = await _h.ScalarAsync("SELECT MatterId AS [Value] FROM dbo.Matter WHERE Name = N'Perf matter 3'");
        var big = await _h.ScalarAsync("SELECT MatterId AS [Value] FROM dbo.Matter WHERE Name = N'Perf matter 150'");
        var empty = await _h.ScalarAsync("SELECT MatterId AS [Value] FROM dbo.Matter WHERE Name LIKE N'Perf extra matter 1%' ORDER BY MatterId OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY");
        foreach (var client in new[] { _pm5, _heavy })
            await OkAsync(await client.GetAsync($"/api/v1/matters/{small}/overview"));

        var a = await MeasureAsync(_pm5, "overview (pm5's matter)", $"/api/v1/matters/{small}/overview");
        var b = await MeasureAsync(_heavy, "overview (heavy's matter)", $"/api/v1/matters/{big}/overview");
        var c = await MeasureAsync(_clients, "overview (matter with no tasks or assets)", $"/api/v1/matters/{empty}/overview");
        var d = await MeasureAsync(_observer, "overview (observer, no manager role)", $"/api/v1/matters/{big}/overview");
        // A fixed set of reads; only the optional name lookups (people, matters, tasks of the activity page) are skipped when a matter has nothing to name.
        Math.Abs(a.Statements - b.Statements).ShouldBeLessThanOrEqualTo(2);
        b.Statements.ShouldBe(d.Statements);
        b.Statements.ShouldBeLessThan(20);
        c.Statements.ShouldBeLessThanOrEqualTo(b.Statements);
        foreach (var m in new[] { a, b, c, d })
            m.Warm95.ShouldBeLessThanOrEqualTo(ListBudgetMs, m.Name);
    }

    [Fact]
    public async Task The_number_of_statements_does_not_depend_on_the_number_of_matters()
    {
        // The first read of the activity creates a starting point (flagged initial); "Since your last visit" ignores it and counts the last 7 days, whose
        // optional name lookups depend on what happened in the data, not on the number of matters. Marking as read makes the marker explicit, so every
        // endpoint is measured on the same footing (issue #815).
        foreach (var client in new[] { _pm5, _pm50, _heavy })
        {
            await OkAsync(await client.GetAsync("/api/v1/my-matters/activity"));
            await OkAsync(await client.PostAsJsonAsync("/api/v1/my-matters/activity/seen", new { }));
        }

        foreach (var (name, url) in Endpoints.Where(e => !e.Name.Contains("page 2", StringComparison.Ordinal)))
        {
            var small = await MeasureAsync(_pm5, "5 matters: " + name, url);
            var mid = await MeasureAsync(_pm50, "50 matters: " + name, url);
            var big = await MeasureAsync(_heavy, "145 matters: " + name, url);
            small.Statements.ShouldBe(mid.Statements, name);
            mid.Statements.ShouldBe(big.Statements, name);
            small.Statements.ShouldBeLessThan(12, name);
        }
    }

    [Fact]
    public async Task A_person_with_a_few_matters_reads_the_task_table_only_by_seeks()
    {
        // pm5 manages 2.5% of the tasks; every read of Task must be a seek on a Task index (a scan would be 24,000 rows). For the larger shares the
        // optimizer legitimately prefers one scan to thousands of lookups; their usage is only written to the output.
        var failures = new List<string>();
        foreach (var (who, client, strict) in new[] { ("pm5", _pm5, true), ("pm50", _pm50, false), ("heavy", _heavy, false) })
        {
            foreach (var (name, url) in Endpoints)
            {
                await OkAsync(await client.GetAsync(url)); // the first call also loads the user's permissions
                await _factory.WithDbAsync(db => db.Database.ExecuteSqlRawAsync("DBCC FREEPROCCACHE"));
                var before = await TaskScansAsync();
                await OkAsync(await client.GetAsync(url));
                var scans = (await TaskScansAsync()).Where(kv => kv.Value > before.GetValueOrDefault(kv.Key)).Select(kv => $"{kv.Key} +{kv.Value - before.GetValueOrDefault(kv.Key)}").ToList();
                output.WriteLine($"{who} {name}: scans {(scans.Count == 0 ? "none" : string.Join(", ", scans))}");
                foreach (var path in await TaskAccessPathsAsync())
                    output.WriteLine("    plan: " + path);
                if (name.StartsWith("activity", StringComparison.Ordinal))
                    foreach (var path in await TaskAccessPathsAsync("AuditEvent"))
                        output.WriteLine("    audit plan: " + path);
                if (strict && scans.Count > 0)
                    failures.Add($"{who} {name}: {string.Join(", ", scans)}");
            }
        }

        failures.ShouldBeEmpty("with a few matters every read of the task table must be a seek, not a scan:\n" + string.Join("\n", failures));
    }

    private Task<Dictionary<string, long>> TaskScansAsync() => _factory.WithDbAsync(async db =>
        (await db.Database.SqlQueryRaw<ScanRow>("""
            SELECT i.name AS Name, CAST(s.user_scans AS BIGINT) AS Scans
            FROM sys.dm_db_index_usage_stats s
            JOIN sys.indexes i ON i.object_id = s.object_id AND i.index_id = s.index_id
            WHERE s.database_id = DB_ID() AND s.object_id = OBJECT_ID('dbo.Task')
            """).ToListAsync()).ToDictionary(r => r.Name, r => r.Scans));

    /// <summary>The access paths on Task in the cached plans of the statements that read it: operator, index and the optimizer's row estimate.</summary>
    private Task<List<string>> TaskAccessPathsAsync(string table = "Task") => _factory.WithDbAsync(async db =>
    {
        var pattern = table == "Task" ? "%[[]Task]%" : "%" + table + "%";
        var plans = await db.Database.SqlQuery<PlanRow>($"""
            SELECT TOP 40 qp.query_plan AS PlanXml, qs.last_execution_time AS LastRun, CAST(qs.last_logical_reads AS BIGINT) AS Reads
            FROM sys.dm_exec_query_stats qs
            CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
            CROSS APPLY sys.dm_exec_text_query_plan(qs.plan_handle, qs.statement_start_offset, qs.statement_end_offset) qp
            WHERE st.text LIKE {pattern} AND st.text NOT LIKE '%dm_exec%' AND qp.query_plan IS NOT NULL
            ORDER BY qs.last_execution_time DESC
            """).ToListAsync();
        XNamespace ns = "http://schemas.microsoft.com/sqlserver/2004/07/showplan";
        var paths = new List<string>();
        foreach (var plan in plans)
        {
            var doc = XDocument.Parse(plan.PlanXml);
            foreach (var op in doc.Descendants(ns + "RelOp"))
            {
                var access = op.Elements().FirstOrDefault(e => e.Name.LocalName is "IndexScan" or "TableScan");
                var obj = access?.Element(ns + "Object");
                if (obj is not null && obj.Attribute("Table")?.Value == $"[{table}]")
                    paths.Add($"{op.Attribute("PhysicalOp")?.Value} {obj.Attribute("Index")?.Value} est. {op.Attribute("EstimateRows")?.Value} rows");
            }
        }

        paths.Add($"logical reads of the request's statements: {plans.Sum(p => p.Reads)}");
        return paths.Distinct().ToList();
    });

    public sealed class PlanRow
    {
        public string PlanXml { get; set; } = string.Empty;

        public DateTime LastRun { get; set; }

        public long Reads { get; set; }
    }

    public sealed class ScanRow
    {
        public string Name { get; set; } = string.Empty;

        public long Scans { get; set; }
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
