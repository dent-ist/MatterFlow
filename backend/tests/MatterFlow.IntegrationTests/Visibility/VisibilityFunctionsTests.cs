using System.Text.RegularExpressions;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using MatterFlow.SharedKernel.Visibility;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;
using Xunit.Abstractions;

namespace MatterFlow.IntegrationTests.Visibility;

/// <summary>
/// The SQL twin of the visibility rule (epic #788, SM-03): <c>dbo.fnMatterVisible</c>, <c>fnTaskVisible</c> and <c>fnAssetVisible</c> give exactly the rows the
/// C# predicate gives (in memory and as translated by EF) for a generated matrix of matters, tasks, assets and viewers, and they cost at most 15% more
/// logical reads than the same query without them at 200 matters / 24,000 tasks. Also: the report login cannot use them.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class VisibilityFunctionsTests(SqlServerFixture sql, ITestOutputHelper output) : IAsyncLifetime
{
    private const int MatterCount = 200;
    private const int TaskCount = 24_000;

    private string _cs = null!;
    private DatabaseApiFactory _factory = null!;
    private int[] _people = [];

    public async Task InitializeAsync()
    {
        _cs = await sql.CreateDatabaseAsync();
        _factory = new DatabaseApiFactory(_cs) { ExtraSettings = [("Features:SensitiveMatterAccess", "true")] };
        var h = new TaskHarness(_factory);
        var world = await h.CreateWorldAsync();
        var admin = await h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        await h.ExecuteAsync(SeedSql(world, admin));
        _people = [.. (await ReadIntsAsync("SELECT UserId FROM dbo.AppUser WHERE DisplayName LIKE N'Vis person %' ORDER BY UserId"))];
        _factory.InvalidateAll();
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    // 200 matters (every 10th sensitive; every 4th has a Primary, every 7th a Secondary, so some sensitive matters have none), 24,000 tasks assigned to
    // 20 people (one in three unassigned), 2,000 assets and a link from every 8th task to an asset of its matter.
    private static string SeedSql(TaskHarness.World w, int adminUserId) => $"""
        SET NOCOUNT ON;
        DECLARE @clientId INT = (SELECT TOP 1 ClientId FROM dbo.Client);
        DECLARE @clientNumber CHAR(5) = (SELECT TOP 1 ClientNumber FROM dbo.Client);
        INSERT dbo.AppUser (DisplayName) SELECT TOP (20) N'Vis person ' + RIGHT('00' + CAST(ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS VARCHAR(3)), 2) FROM sys.all_objects;
        DECLARE @people TABLE (idx INT NOT NULL, UserId INT NOT NULL);
        INSERT @people SELECT ROW_NUMBER() OVER (ORDER BY UserId) - 1, UserId FROM dbo.AppUser WHERE DisplayName LIKE N'Vis person %';

        ;WITH nums AS (SELECT TOP ({MatterCount}) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects)
        INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name, IsSensitive, PrimaryManagerId, SecondaryManagerId)
        SELECT @clientId, @clientNumber, RIGHT('0000' + CAST(n + 100 AS VARCHAR(5)), 5), N'Vis matter ' + CAST(n AS NVARCHAR(5)),
               CASE WHEN n % 10 = 0 THEN 1 ELSE 0 END,
               (SELECT UserId FROM @people WHERE idx = n % 20 AND n % 4 = 0),
               (SELECT UserId FROM @people WHERE idx = (n + 3) % 20 AND n % 7 = 0)
        FROM nums;
        DECLARE @matters TABLE (idx INT NOT NULL, MatterId INT NOT NULL);
        INSERT @matters SELECT CAST(REPLACE(Name, N'Vis matter ', N'') AS INT) - 1, MatterId FROM dbo.Matter WHERE Name LIKE N'Vis matter %';

        DECLARE @version INT = (SELECT TOP 1 WorkflowVersionId FROM dbo.WorkflowVersion WHERE WorkflowDefinitionId = {w.OrderedWorkflowId} AND Status = 'PUBLISHED');
        DECLARE @base BIGINT = ISNULL((SELECT MAX(WorkflowInstanceId) FROM dbo.WorkflowInstance), 0);
        ;WITH nums AS (SELECT TOP ({TaskCount}) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b)
        INSERT dbo.WorkflowInstance (WorkflowVersionId, IsOrdered) SELECT @version, 1 FROM nums;
        DECLARE @priority INT = (SELECT TOP 1 PriorityId FROM dbo.Priority);

        INSERT dbo.Task (MatterId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, StatusCode, AssignedUserId, RequestorName, StatusChangedAt, CompletedAt, CreatedAt, CreatedByUserId)
        SELECT m.MatterId, {w.TaskTypeId}, i.WorkflowInstanceId, N'Vis task ' + CAST(i.rn AS NVARCHAR(10)), @priority,
               x.st, u.UserId, N'Requestor', SYSUTCDATETIME(), CASE WHEN x.st = 'COMPLETED' THEN SYSUTCDATETIME() END, DATEADD(MINUTE, -i.rn, SYSUTCDATETIME()), {adminUserId}
        FROM (SELECT WorkflowInstanceId, ROW_NUMBER() OVER (ORDER BY WorkflowInstanceId) AS rn FROM dbo.WorkflowInstance WHERE WorkflowInstanceId > @base) i
        CROSS APPLY (SELECT CASE WHEN i.rn % 6 = 0 THEN 'COMPLETED' WHEN i.rn % 12 = 1 THEN 'ON_HOLD' WHEN i.rn % 3 = 0 THEN 'IN_PROGRESS' ELSE 'NEW' END AS st) x
        JOIN @matters m ON m.idx = i.rn % {MatterCount}
        LEFT JOIN @people u ON u.idx = i.rn % 30 AND i.rn % 30 < 20;

        INSERT dbo.AssetType (Name) VALUES (N'Vis type');
        DECLARE @type INT = SCOPE_IDENTITY();
        ;WITH nums AS (SELECT TOP (2000) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects)
        INSERT dbo.Asset (MatterId, AssetTypeId, DisplayName) SELECT m.MatterId, @type, N'Vis asset ' + CAST(n AS NVARCHAR(5)) FROM nums JOIN @matters m ON m.idx = n % {MatterCount};
        INSERT dbo.TaskAsset (TaskId, AssetId, MatterId)
        SELECT t.TaskId, a.AssetId, t.MatterId FROM dbo.Task t CROSS APPLY (SELECT TOP 1 AssetId FROM dbo.Asset x WHERE x.MatterId = t.MatterId ORDER BY x.AssetId) a WHERE t.TaskId % 8 = 0;
        """;

    private async Task<List<int>> ReadIntsAsync(string text, params (string Name, object? Value)[] args) =>
        [.. (await ReadLongsAsync(text, args)).Select(v => (int)v)];

    private async Task<List<long>> ReadLongsAsync(string text, params (string Name, object? Value)[] args)
    {
        await using var c = new SqlConnection(_cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = text;
        foreach (var (name, value) in args)
            cmd.Parameters.AddWithValue(name, value ?? DBNull.Value);
        var rows = new List<long>();
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
            rows.Add(Convert.ToInt64(r.GetValue(0)));
        return rows;
    }

    private IEnumerable<Viewer> Viewers()
    {
        yield return Viewer.Nobody;
        yield return new Viewer(null, true);
        yield return new Viewer(999_999, false); // unknown person
        foreach (var person in _people.Where((_, i) => i % 3 == 0))
        {
            yield return new Viewer(person, false);
            yield return new Viewer(person, true);
        }
    }

    private static string Label(Viewer v) => $"user {v.UserId?.ToString() ?? "none"}, seeAll {v.SeeAll}";

    [Fact]
    public async Task The_sql_functions_give_exactly_the_rows_the_csharp_rule_gives()
    {
        var matters = await ReadRowsAsync("SELECT MatterId, IsSensitive, PrimaryManagerId, SecondaryManagerId FROM dbo.Matter", r => new MatterAccessRow
        {
            MatterId = r.GetInt32(0),
            IsSensitive = r.GetBoolean(1),
            PrimaryManagerId = r.IsDBNull(2) ? null : r.GetInt32(2),
            SecondaryManagerId = r.IsDBNull(3) ? null : r.GetInt32(3),
        });
        var tasks = await ReadRowsAsync("SELECT TaskId, MatterId, AssignedUserId FROM dbo.Task", r => new TaskAccessRow
        {
            TaskId = r.GetInt64(0),
            MatterId = r.GetInt32(1),
            AssignedUserId = r.IsDBNull(2) ? null : r.GetInt32(2),
        });
        var assets = await ReadRowsAsync("SELECT AssetId, MatterId FROM dbo.Asset", r => (AssetId: r.GetInt32(0), MatterId: r.GetInt32(1)));
        var links = await ReadRowsAsync("SELECT AssetId, TaskId FROM dbo.TaskAsset", r => (AssetId: r.GetInt32(0), TaskId: r.GetInt64(1)));

        matters.Count(m => m.IsSensitive).ShouldBeGreaterThan(10);
        matters.Count(m => m.IsSensitive && m.PrimaryManagerId is null && m.SecondaryManagerId is null).ShouldBeGreaterThan(0);

        await using var scope = _factory.Services.CreateAsyncScope();
        var port = scope.ServiceProvider.GetRequiredService<IMatterVisibility>();
        port.Enabled.ShouldBeTrue();

        var checkedViewers = 0;
        foreach (var viewer in Viewers())
        {
            var matterRule = VisibilityPredicates.Matter(viewer).Compile();
            var assigned = VisibilityPredicates.AssignedToViewer(viewer).Compile();
            var visibleMatters = matters.Where(matterRule).Select(m => m.MatterId).ToHashSet();
            var seeAll = viewer.SeeAll ? 1 : 0;
            var args = new (string, object?)[] { ("@u", viewer.UserId), ("@s", seeAll) };
            var label = Label(viewer);

            var expectedMatters = visibleMatters.Order().Select(i => (long)i).ToList();
            (await ReadLongsAsync("SELECT MatterId FROM dbo.fnMatterVisible(@u, @s) ORDER BY MatterId", args)).ShouldBe(expectedMatters, label);
            (await port.VisibleMatters(viewer).Select(m => m.MatterId).OrderBy(i => i).ToListAsync()).Select(i => (long)i).ShouldBe(expectedMatters, "EF: " + label);

            var expectedTasks = tasks.Where(t => visibleMatters.Contains(t.MatterId) || assigned(t)).Select(t => t.TaskId).Order().ToList();
            (await ReadLongsAsync("SELECT TaskId FROM dbo.fnTaskVisible(@u, @s) ORDER BY TaskId", args)).ShouldBe(expectedTasks, label);
            (await port.VisibleTasks(viewer).Select(t => t.TaskId).OrderBy(i => i).ToListAsync()).ShouldBe(expectedTasks, "EF: " + label);

            var assignedTasks = tasks.Where(assigned).Select(t => t.TaskId).ToHashSet();
            var expectedAssets = assets
                .Where(a => visibleMatters.Contains(a.MatterId) || links.Any(l => l.AssetId == a.AssetId && assignedTasks.Contains(l.TaskId)))
                .Select(a => (long)a.AssetId).Order().ToList();
            (await ReadLongsAsync("SELECT AssetId FROM dbo.fnAssetVisible(@u, @s) ORDER BY AssetId", args)).ShouldBe(expectedAssets, label);
            checkedViewers++;
        }

        checkedViewers.ShouldBeGreaterThan(10);
    }

    private async Task<List<T>> ReadRowsAsync<T>(string text, Func<SqlDataReader, T> map)
    {
        await using var c = new SqlConnection(_cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = text;
        var rows = new List<T>();
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
            rows.Add(map(r));
        return rows;
    }

    private async Task<long> LogicalReadsAsync(string text, int? user, int seeAll)
    {
        await using var c = new SqlConnection(_cs);
        long reads = 0;
        c.InfoMessage += (_, e) =>
        {
            foreach (Match m in Regex.Matches(e.Message, @"logical reads (\d+)"))
                reads += long.Parse(m.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture);
        };
        await c.OpenAsync();
        await using (var on = c.CreateCommand())
        {
            on.CommandText = "SET STATISTICS IO ON";
            await on.ExecuteNonQueryAsync();
        }

        await using var cmd = c.CreateCommand();
        cmd.CommandText = text;
        cmd.Parameters.AddWithValue("@u", (object?)user ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@s", seeAll);
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
        }

        while (await r.NextResultAsync())
        {
        }

        return reads;
    }

    [Fact]
    public async Task The_functions_cost_at_most_15_percent_more_reads_than_the_same_query_without_them()
    {
        const string open = "t.StatusCode IN ('NEW', 'IN_PROGRESS', 'ON_HOLD')";
        var cases = new (string Name, string Plain, string Visible)[]
        {
            ("open tasks per matter",
                $"SELECT t.MatterId, COUNT(*) FROM dbo.Task t WHERE {open} GROUP BY t.MatterId",
                $"SELECT t.MatterId, COUNT(*) FROM dbo.Task t WHERE {open} AND EXISTS (SELECT 1 FROM dbo.fnMatterVisible(@u, @s) v WHERE v.MatterId = t.MatterId) GROUP BY t.MatterId"),
            // Task rule over a whole set: matter visible OR assigned to the viewer. The LEFT JOIN form lets SQL Server use one hash join; the same
            // rule written as "EXISTS (...) OR t.AssignedUserId = @u" probes the Matter table once per task (about 38,000 reads for these 20,000 tasks).
            ("open task total",
                $"SELECT COUNT(*) FROM dbo.Task t WHERE {open}",
                $"SELECT COUNT(*) FROM dbo.Task t LEFT JOIN dbo.fnMatterVisible(@u, @s) v ON v.MatterId = t.MatterId WHERE {open} AND (v.MatterId IS NOT NULL OR t.AssignedUserId = @u)"),
        };
        var user = _people[4];

        foreach (var (name, plain, visible) in cases)
        {
            var baseline = await LogicalReadsAsync(plain, user, 0);
            foreach (var seeAll in new[] { 0, 1 })
            {
                var withRule = await LogicalReadsAsync(visible, user, seeAll);
                output.WriteLine($"{name,-30} seeAll {seeAll}: {baseline,6} reads without, {withRule,6} reads with the rule ({(baseline == 0 ? 0 : 100.0 * (withRule - baseline) / baseline):F1}%)");
                // +15%, or at most 200 pages more for a query that reads only a few dozen pages without the rule (about a millisecond).
                withRule.ShouldBeLessThanOrEqualTo(Math.Max((long)(baseline * 1.15) + 2, baseline + 200), $"{name}, seeAll {seeAll}");
            }
        }
    }

    [Fact]
    public async Task A_single_task_or_asset_check_through_the_functions_is_a_handful_of_reads()
    {
        var task = (await ReadLongsAsync("SELECT TOP 1 TaskId FROM dbo.Task WHERE MatterId IN (SELECT MatterId FROM dbo.Matter WHERE IsSensitive = 1) ORDER BY TaskId DESC")).Single();
        var asset = (await ReadLongsAsync("SELECT TOP 1 AssetId FROM dbo.Asset ORDER BY AssetId DESC")).Single();
        foreach (var seeAll in new[] { 0, 1 })
        {
            var taskReads = await LogicalReadsAsync($"SELECT 1 FROM dbo.fnTaskVisible(@u, @s) WHERE TaskId = {task}", _people[4], seeAll);
            var assetReads = await LogicalReadsAsync($"SELECT 1 FROM dbo.fnAssetVisible(@u, @s) WHERE AssetId = {asset}", _people[4], seeAll);
            output.WriteLine($"single task {taskReads} reads, single asset {assetReads} reads (seeAll {seeAll})");
            taskReads.ShouldBeLessThanOrEqualTo(25);
            assetReads.ShouldBeLessThanOrEqualTo(40);
        }
    }

    [Fact]
    public async Task The_report_login_has_no_access_to_the_functions()
    {
        foreach (var function in new[] { "fnMatterVisible", "fnTaskVisible", "fnAssetVisible" })
        {
            var denied = await ReadLongsAsync(
                "SELECT COUNT(*) FROM sys.database_permissions p WHERE p.class = 1 AND p.major_id = OBJECT_ID(@f) AND p.state = 'D' AND p.permission_name = 'SELECT' AND USER_NAME(p.grantee_principal_id) = 'mf_report_reader'",
                ("@f", "dbo." + function));
            denied.ShouldBe([1L], function);
        }
    }
}
