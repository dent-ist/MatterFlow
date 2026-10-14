using System.Diagnostics;
using System.Net.Http.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Shouldly;
using Xunit.Abstractions;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Search;

/// <summary>
/// Global search against the volumes of architecture 15 seeded with set-based SQL (1,000 Clients and Matters, 5,000 Tasks, 300,000 Assets): every
/// typical query must stay well inside the 300 ms p95 goal of architecture 14 on a development machine (the bound here is looser because the CI
/// container shares its disk and CPU).
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class SearchPerformanceTests(SqlServerFixture sql, ITestOutputHelper output) : IAsyncLifetime
{
    private const int TaskCount = 5000;
    private const int AssetCount = 300_000;

    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        var world = await _h.CreateWorldAsync();
        var type = await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/asset-types", new { name = "Laptop" }), System.Net.HttpStatusCode.Created);
        var assetTypeId = type.GetProperty("assetTypeId").GetInt32();
        var admin = await _h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        await _h.ExecuteAsync(SeedSql(world, admin, assetTypeId));
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static string SeedSql(TaskHarness.World w, int adminUserId, int assetTypeId) => $"""
        SET NOCOUNT ON;
        DECLARE @version INT = (SELECT TOP 1 WorkflowVersionId FROM dbo.WorkflowVersion WHERE WorkflowDefinitionId = {w.OrderedWorkflowId} AND Status = 'PUBLISHED');
        DECLARE @base BIGINT = ISNULL((SELECT MAX(WorkflowInstanceId) FROM dbo.WorkflowInstance), 0);

        ;WITH nums AS (SELECT TOP (1000) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) + 1000 AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b)
        INSERT dbo.Client (ClientNumber, Name) SELECT RIGHT('00000' + CAST(n AS VARCHAR(5)), 5), N'Client ' + CAST(n AS NVARCHAR(10)) + N' Holdings' FROM nums;

        INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name)
        SELECT c.ClientId, c.ClientNumber, '00001', N'Matter for ' + c.Name FROM dbo.Client c WHERE c.ClientNumber >= '01001';

        ;WITH nums AS (SELECT TOP ({TaskCount}) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b)
        INSERT dbo.WorkflowInstance (WorkflowVersionId, IsOrdered) SELECT @version, 1 FROM nums;

        INSERT dbo.StepInstance (WorkflowInstanceId, WorkflowVersionStepId, SequenceNo, Title, IsSkippable, SkipCommentRequired, Status)
        SELECT wi.WorkflowInstanceId, vs.WorkflowVersionStepId, vs.SequenceNo, vs.Title, 0, 0, 'PENDING'
        FROM dbo.WorkflowInstance wi JOIN dbo.WorkflowVersionStep vs ON vs.WorkflowVersionId = wi.WorkflowVersionId
        WHERE wi.WorkflowInstanceId > @base;

        INSERT dbo.Task (MatterId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, StatusCode, RequestorName, CreatedAt, CreatedByUserId)
        SELECT {w.MatterId}, {w.TaskTypeId}, i.WorkflowInstanceId, N'Seeded task ' + CAST(i.rn AS NVARCHAR(10)) + N' review',
               (SELECT TOP 1 PriorityId FROM dbo.Priority), 'NEW', N'Requestor ' + CAST(i.rn % 50 AS NVARCHAR(10)), SYSUTCDATETIME(), {adminUserId}
        FROM (SELECT WorkflowInstanceId, ROW_NUMBER() OVER (ORDER BY WorkflowInstanceId) AS rn FROM dbo.WorkflowInstance WHERE WorkflowInstanceId > @base) i;

        DECLARE @matters TABLE (idx INT NOT NULL PRIMARY KEY, MatterId INT NOT NULL);
        INSERT @matters SELECT ROW_NUMBER() OVER (ORDER BY MatterId) - 1, MatterId FROM dbo.Matter;
        DECLARE @mc INT = (SELECT COUNT(*) FROM @matters);
        ;WITH nums AS (SELECT TOP ({AssetCount}) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b CROSS JOIN sys.all_objects c)
        INSERT dbo.Asset (MatterId, AssetTypeId, DisplayName, ExternalReference)
        SELECT m.MatterId, {assetTypeId}, N'Custodian laptop ' + CAST(n AS NVARCHAR(10)), N'https://evidence.example.com/ws/' + CAST(n AS NVARCHAR(10))
        FROM nums JOIN @matters m ON m.idx = n % @mc;
        """;

    [Fact]
    public async Task Typical_global_searches_stay_fast_at_300k_assets()
    {
        (await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.Asset")).ShouldBe(AssetCount);
        var worst = 0L;
        foreach (var query in new[] { "00343-00012", "343", "client 1500", "1500", "TSK-77", "seeded task 4", "custodian laptop 29999", "evidence.example.com/ws/123", "requestor 7", "zzzzqq" })
        {
            await OkAsync(await _h.Admin.GetAsync("/api/v1/search?q=" + Uri.EscapeDataString(query))); // warm the plan
            var timings = new List<long>();
            for (var i = 0; i < 3; i++)
            {
                var watch = Stopwatch.StartNew();
                await OkAsync(await _h.Admin.GetAsync("/api/v1/search?q=" + Uri.EscapeDataString(query)));
                timings.Add(watch.ElapsedMilliseconds);
            }

            output.WriteLine($"'{query}': {string.Join(", ", timings)} ms");
            worst = Math.Max(worst, timings.Order().First());
        }

        worst.ShouldBeLessThan(1500, "a typeahead query must stay fast with 300,000 Assets");
    }
}
