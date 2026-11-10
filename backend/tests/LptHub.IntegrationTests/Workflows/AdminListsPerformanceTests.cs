using System.Diagnostics;
using System.Globalization;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Shouldly;
using Xunit.Abstractions;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Workflows;

/// <summary>
/// The Workflows and Workflow Steps lists with their new fields, sorts and library-wide summaries (#366) against seeded data: a page of 100 in the
/// default order and in each new sort must come back quickly, in a fixed number of statements (never one per row), with no SQL script (no index).
/// </summary>
public abstract class AdminListsPerformanceTestsBase(SqlServerFixture sql, ITestOutputHelper output, int workflows, int steps, int taskTypes) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private WebApplicationFactory<Program> _logged = null!;
    private readonly CommandLog _commands = new();

    protected ITestOutputHelper Output { get; } = output;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        var h = new TaskHarness(_factory);
        await h.ExecuteAsync(ScaleSql(workflows, steps, taskTypes));
        (await h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.WorkflowDefinition WHERE Name LIKE N'Perf workflow%'")).ShouldBe(workflows);
        (await h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.StepDefinition WHERE Title LIKE N'Perf step%'")).ShouldBe(steps);
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

    /// <summary>The median budget of a list request, in milliseconds (a median of 7, idle machine).</summary>
    protected abstract int ListBudgetMs { get; }

    [Fact]
    public async Task The_lists_their_sorts_and_summaries_stay_within_budget_in_a_fixed_number_of_statements()
    {
        var http = Http();
        foreach (var url in new[]
        {
            "/api/v1/workflows?pageSize=100",
            "/api/v1/workflows?pageSize=100&sort=-publishedAtUtc",
            "/api/v1/workflows?pageSize=100&sort=publishedAtUtc",
            "/api/v1/workflows?pageSize=100&sort=-taskTypeCount",
            "/api/v1/workflows?pageSize=100&hasDraft=true&isActive=true",
            "/api/v1/step-definitions?pageSize=100",
            "/api/v1/step-definitions?pageSize=100&isActive=false",
        })
        {
            var (median, statements, page) = await MeasureAsync(http, url);
            page.GetProperty("items").GetArrayLength().ShouldBeGreaterThan(0, url);
            page.GetProperty("summary").GetProperty("total").GetInt32().ShouldBe(url.Contains("workflows", StringComparison.Ordinal) ? workflows : steps, url);
            median.ShouldBeLessThan(ListBudgetMs, url);
            statements.ShouldBeLessThan(12, $"{url}: a fixed number of statements, none per row");
        }
    }

    /// <summary>
    /// Set-based seed: workflows (every tenth inactive; by n mod 8: published, published with a draft, published after a retired v1, retired only, draft only) with five steps per version, steps (every ninth inactive, a third with a published input form, every seventh with a draft field)
    /// and Task Types (every sixth inactive) eligible for three workflows each.
    /// </summary>
    private static string ScaleSql(int workflows, int steps, int taskTypes) => string.Create(CultureInfo.InvariantCulture, $"""
        SET NOCOUNT ON;
        DECLARE @wf INT = {workflows}, @st INT = {steps}, @tt INT = {taskTypes};
        DECLARE @nums TABLE (n INT NOT NULL PRIMARY KEY);
        INSERT @nums SELECT TOP (CASE WHEN @wf > @st THEN @wf ELSE @st END) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) FROM sys.all_objects a CROSS JOIN sys.all_objects b;

        INSERT dbo.StepDefinition (Title, Description, IsActive)
        SELECT N'Perf step ' + RIGHT('00000' + CAST(n AS VARCHAR(5)), 5), N'Perf step description', CASE WHEN n % 9 = 0 THEN 0 ELSE 1 END FROM @nums WHERE n <= @st;
        DECLARE @steps TABLE (idx INT NOT NULL PRIMARY KEY, StepDefinitionId INT NOT NULL);
        INSERT @steps SELECT ROW_NUMBER() OVER (ORDER BY StepDefinitionId) - 1, StepDefinitionId FROM dbo.StepDefinition WHERE Title LIKE N'Perf step%';

        INSERT dbo.FormDefinition (Scope, StepDefinitionId) SELECT 'STEP', StepDefinitionId FROM @steps;
        INSERT dbo.FormVersion (FormDefinitionId, VersionNo, Status, PublishedAt)
        SELECT d.FormDefinitionId, 1, 'PUBLISHED', SYSUTCDATETIME() FROM dbo.FormDefinition d JOIN @steps s ON s.StepDefinitionId = d.StepDefinitionId WHERE s.idx % 3 = 0;
        INSERT dbo.FormVersion (FormDefinitionId, VersionNo, Status)
        SELECT d.FormDefinitionId, CASE WHEN s.idx % 3 = 0 THEN 2 ELSE 1 END, 'DRAFT' FROM dbo.FormDefinition d JOIN @steps s ON s.StepDefinitionId = d.StepDefinitionId WHERE s.idx % 7 = 0;
        INSERT dbo.FormField (FormVersionId, FieldKey, Label, ControlType, SortOrder)
        SELECT v.FormVersionId, 'perf_field', N'Perf field', 'TEXT', 1 FROM dbo.FormVersion v WHERE v.Status = 'DRAFT';

        INSERT dbo.WorkflowDefinition (Name, Description, IsActive)
        SELECT N'Perf workflow ' + RIGHT('00000' + CAST(n AS VARCHAR(5)), 5), N'Perf workflow description', CASE WHEN n % 10 = 0 THEN 0 ELSE 1 END FROM @nums WHERE n <= @wf;
        DECLARE @wfs TABLE (idx INT NOT NULL PRIMARY KEY, WorkflowDefinitionId INT NOT NULL);
        INSERT @wfs SELECT ROW_NUMBER() OVER (ORDER BY WorkflowDefinitionId) - 1, WorkflowDefinitionId FROM dbo.WorkflowDefinition WHERE Name LIKE N'Perf workflow%';

        -- Steps may only be added to a DRAFT (triggers), so each version is inserted as a draft, filled, then moved to its final state.
        -- Version 1: k = 0..3 published, 4 and 5 retired (4 is followed by a published v2), 6 retired only (like 5), 7 draft only; k = 3 also gets a draft v2.
        INSERT dbo.WorkflowVersion (WorkflowDefinitionId, VersionNo, Status)
        SELECT w.WorkflowDefinitionId, 1, 'DRAFT' FROM @wfs w;
        INSERT dbo.WorkflowVersionStep (WorkflowVersionId, SequenceNo, SourceStepDefinitionId, Title)
        SELECT v.WorkflowVersionId, j.j + 1, s.StepDefinitionId, N'Perf version step'
        FROM dbo.WorkflowVersion v
        JOIN @wfs w ON w.WorkflowDefinitionId = v.WorkflowDefinitionId
        JOIN (VALUES (0), (1), (2), (3), (4)) j(j) ON 1 = 1
        JOIN @steps s ON s.idx = (w.idx * 7 + j.j * 13 + v.VersionNo) % @st
        WHERE v.VersionNo = 1;
        UPDATE v SET Status = CASE WHEN w.idx % 8 <= 3 THEN 'PUBLISHED' ELSE 'RETIRED' END, PublishedAt = DATEADD(MINUTE, w.idx, '2026-01-01')
        FROM dbo.WorkflowVersion v JOIN @wfs w ON w.WorkflowDefinitionId = v.WorkflowDefinitionId WHERE v.VersionNo = 1 AND w.idx % 8 <> 7;

        INSERT dbo.WorkflowVersion (WorkflowDefinitionId, VersionNo, Status)
        SELECT w.WorkflowDefinitionId, 2, 'DRAFT' FROM @wfs w WHERE w.idx % 8 IN (3, 4);
        INSERT dbo.WorkflowVersionStep (WorkflowVersionId, SequenceNo, SourceStepDefinitionId, Title)
        SELECT v.WorkflowVersionId, j.j + 1, s.StepDefinitionId, N'Perf version step'
        FROM dbo.WorkflowVersion v
        JOIN @wfs w ON w.WorkflowDefinitionId = v.WorkflowDefinitionId
        JOIN (VALUES (0), (1), (2), (3), (4)) j(j) ON 1 = 1
        JOIN @steps s ON s.idx = (w.idx * 7 + j.j * 13 + v.VersionNo) % @st
        WHERE v.VersionNo = 2;
        UPDATE v SET Status = 'PUBLISHED', PublishedAt = DATEADD(MINUTE, w.idx + 5000, '2026-01-01')
        FROM dbo.WorkflowVersion v JOIN @wfs w ON w.WorkflowDefinitionId = v.WorkflowDefinitionId WHERE v.VersionNo = 2 AND w.idx % 8 = 4;

        INSERT dbo.TaskType (Name, IsActive) SELECT N'Perf type ' + RIGHT('00000' + CAST(n AS VARCHAR(5)), 5), CASE WHEN n % 6 = 0 THEN 0 ELSE 1 END FROM @nums WHERE n <= @tt;
        INSERT dbo.TaskTypeWorkflowEligibility (TaskTypeId, WorkflowDefinitionId)
        SELECT t.TaskTypeId, w.WorkflowDefinitionId
        FROM (SELECT TaskTypeId, ROW_NUMBER() OVER (ORDER BY TaskTypeId) - 1 AS idx FROM dbo.TaskType WHERE Name LIKE N'Perf type%') t
        JOIN (VALUES (0), (1), (2)) j(j) ON 1 = 1
        JOIN @wfs w ON w.idx = (t.idx * 5 + j.j * 11) % @wf;
        """);
}

/// <summary>600 workflows, 1,200 steps and 150 Task Types: the list pages, their sorts and summaries stay quick.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class AdminListsPerformanceTests(SqlServerFixture sql, ITestOutputHelper output) : AdminListsPerformanceTestsBase(sql, output, 600, 1_200, 150)
{
    // Taken on a LOADED machine (load average 24 to 29 on 4 cores; no idle run was possible): workflow lists 35 to 65 ms, step lists 140 to 170 ms,
    // of which the database statements add up to about 45 ms. (The older step sort by `usedInWorkflows` is not measured here: it is 130 to 490 ms at 1,200 steps because it counts per row; not part of #366.) The bound is a safety net against a per-row query or a missing index (those cost
    // seconds at this size), to be tightened from idle-machine medians.
    protected override int ListBudgetMs => 400;
}

/// <summary>3,000 workflows, 6,000 steps and 600 Task Types: far above the 74/32/67 of the review, with no new index.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class AdminListsLargePerformanceTests(SqlServerFixture sql, ITestOutputHelper output) : AdminListsPerformanceTestsBase(sql, output, 3_000, 6_000, 600)
{
    // Same load: see above; the larger data set adds a few milliseconds per statement, the budget doubles.
    protected override int ListBudgetMs => 800;
}
