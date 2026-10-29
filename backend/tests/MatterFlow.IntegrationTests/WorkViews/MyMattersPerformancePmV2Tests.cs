using System.Diagnostics;
using System.Net.Http.Json;
using System.Xml.Linq;
using MatterFlow.IntegrationTests.Assets;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// PM v2 (epic #851, issue #887, PV-36): the Breakdown, Data, volume, asset report, section and export reads against the harness size of this class (200 matters, 24,000 tasks,
/// 100,000 assets) plus <b>300,000 <c>CustomFieldIndex</c> asset rows</b> (three times the 100,000 the plan names: two numbers, "size_gb" (GB) and "copies" (Items), and a select "platform" per asset, as a published
/// form with a designated size field produces), twelve task types and five on-hold reasons. Plan budget: p95 300 ms for Breakdown and Data, 500 ms for a report run; like the rest of
/// the class the tests fail at twice that so a shared build machine does not make them flaky, and write the real numbers and plans to the output (recorded in
/// docs/ux/pm-review/performance.md). Plans: the typed index is read by seeks only, no statement contains JSON_VALUE, and the Task table is read by seeks for a manager of few matters.
/// </summary>
public sealed partial class MyMattersPerformanceTests
{
    private const int BreakdownDataBudgetMs = 300;
    private const int ReportBudgetMs = 500;
    private const int DataSelectionBudgetMs = 600; // the heavy shapes of the Data Area (issue #931): the budget the owner accepted on 2026-10-27 for 70,000 assets and more
    private const int ExportBudgetMs = 1500; // a file of up to 10,000 rows (17 pages here): no list budget applies, a download is not a screen
    private const int CeilingFactor = 2;

    private bool _pmV2Seeded;

    private HttpClient AdminAll()
    {
        var http = _logged.CreateClient();
        http.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        http.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);
        return http;
    }

    private int _workspaceType;

    /// <summary>Gives the 100,000 assets one asset type with a published form (a number and a select), the designated size, the typed index rows, mixed dispositions, twelve task types and on-hold reasons.</summary>
    private async Task SeedPmV2Async()
    {
        if (_pmV2Seeded)
            return;

        var kit = new AssetTestKit(_factory);
        _workspaceType = (await kit.CreateTypeAsync("Perf workspace")).GetProperty("assetTypeId").GetInt32();
        await kit.PublishFormAsync(
            _workspaceType,
            AssetTestKit.Field("size_gb", "NUMBER"),
            AssetTestKit.Field("copies", "NUMBER"),
            AssetTestKit.Field("platform", "SELECT", """ "options":[{"key":"prod","label":"prod"},{"key":"test","label":"test"},{"key":"dev","label":"dev"},{"key":"archive","label":"archive"},{"key":"staging","label":"staging"}]"""));
        var definition = (await OkAsync(await _h.Admin.GetAsync($"/api/v1/forms/by-owner?ownerKind=AssetType&ownerId={_workspaceType}"))).GetProperty("formDefinitionId").GetInt32();
        var current = await OkAsync(await _h.Admin.GetAsync($"/api/v1/asset-types/{_workspaceType}"));
        await OkAsync(await _h.Admin.PutAsJsonAsync($"/api/v1/asset-types/{_workspaceType}/size-field", new { sizeFieldKey = "size_gb", sizeUnit = "GB", rowVersion = current.GetProperty("rowVersion").GetString() }));

        await _factory.WithDbAsync(async db =>
        {
            db.Database.SetCommandTimeout(600);
            await db.Database.ExecuteSqlRawAsync(PmV2SeedSql(_workspaceType, definition));
        });
        (await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.CustomFieldIndex WHERE OwnerKind = 'ASSET'")).ShouldBe(300_000);
        _factory.InvalidateAll();
        _pmV2Seeded = true;
    }

    private static string PmV2SeedSql(int workspaceType, int definition) => $"""
                SET NOCOUNT ON;
                -- The guard triggers (no move, no change of task type) compare the inserted and deleted images row by row; over 100,000 assets that takes minutes, so they are off for this one set-based seeding step.
                DISABLE TRIGGER dbo.TR_Asset_Guard ON dbo.Asset;
                DISABLE TRIGGER dbo.TR_Task_Immutable ON dbo.Task;
                UPDATE dbo.Asset SET AssetTypeId = {workspaceType},
                    IsActive = CASE WHEN AssetId % 50 < 45 THEN 1 ELSE 0 END,
                    DispositionCode = CASE AssetId % 50 WHEN 45 THEN 'INACTIVE' WHEN 46 THEN 'INACTIVE' WHEN 47 THEN 'PENDING_DISPOSITION' WHEN 48 THEN 'PENDING_DISPOSITION' WHEN 49 THEN 'DISPOSED' ELSE 'ACTIVE' END
                WHERE DisplayName LIKE N'Perf asset %';
                INSERT dbo.CustomFieldIndex (OwnerKind, OwnerId, FormDefinitionId, FieldKey, ValueNumber)
                SELECT 'ASSET', AssetId, {definition}, 'size_gb', CAST((AssetId % 500) + 1 AS DECIMAL(19, 4)) FROM dbo.Asset WHERE AssetTypeId = {workspaceType};
                INSERT dbo.CustomFieldIndex (OwnerKind, OwnerId, FormDefinitionId, FieldKey, ValueNumber)
                SELECT 'ASSET', AssetId, {definition}, 'copies', CAST((AssetId % 7) + 1 AS DECIMAL(19, 4)) FROM dbo.Asset WHERE AssetTypeId = {workspaceType};
                INSERT dbo.CustomFieldIndex (OwnerKind, OwnerId, FormDefinitionId, FieldKey, ValueText)
                SELECT 'ASSET', AssetId, {definition}, 'platform', CASE AssetId % 5 WHEN 0 THEN N'prod' WHEN 1 THEN N'test' WHEN 2 THEN N'dev' WHEN 3 THEN N'archive' ELSE N'staging' END FROM dbo.Asset WHERE AssetTypeId = {workspaceType};

                INSERT dbo.TaskType (Name, ColourKey, TargetDays)
                SELECT N'Perf kind ' + CAST(v.value AS NVARCHAR(3)), CASE v.value % 3 WHEN 0 THEN 'blue' WHEN 1 THEN 'green' ELSE NULL END, CASE WHEN v.value % 2 = 0 THEN 3 + v.value END FROM GENERATE_SERIES(1, 11) v;
                DECLARE @types TABLE (idx INT NOT NULL, TaskTypeId INT NOT NULL);
                INSERT @types SELECT ROW_NUMBER() OVER (ORDER BY TaskTypeId) - 1, TaskTypeId FROM dbo.TaskType WHERE Name LIKE N'Perf kind %' OR TaskTypeId = (SELECT TOP 1 TaskTypeId FROM dbo.Task);
                UPDATE t SET TaskTypeId = ty.TaskTypeId FROM dbo.Task t JOIN @types ty ON ty.idx = t.TaskId % (SELECT COUNT(*) FROM @types);

                INSERT dbo.OnHoldReason (Name, SortOrder) VALUES (N'Perf waiting for client', 1), (N'Perf waiting for approval', 2), (N'Perf vendor delay', 3), (N'Perf budget', 4), (N'Perf other', 5);
                DECLARE @reasons TABLE (idx INT NOT NULL, OnHoldReasonId INT NOT NULL);
                INSERT @reasons SELECT ROW_NUMBER() OVER (ORDER BY OnHoldReasonId) - 1, OnHoldReasonId FROM dbo.OnHoldReason WHERE Name LIKE N'Perf %';
                UPDATE t SET OnHoldReasonId = r.OnHoldReasonId FROM dbo.Task t JOIN @reasons r ON r.idx = t.TaskId % 5 WHERE t.StatusCode = 'ON_HOLD';

                ENABLE TRIGGER dbo.TR_Asset_Guard ON dbo.Asset;
                ENABLE TRIGGER dbo.TR_Task_Immutable ON dbo.Task;
                UPDATE STATISTICS dbo.Asset; UPDATE STATISTICS dbo.CustomFieldIndex; UPDATE STATISTICS dbo.Task;
                """;

    private enum PmV2Kind
    {
        BreakdownOrData,
        /// <summary>The Data Area with a selection (matters, period, several size fields): the heavy shapes of issue #931, accepted at 600 ms p95 at 70,000 assets and more (owner, 2026-10-27).</summary>
        DataSelection,
        Report,
        Queue,
        Other,
    }

    private sealed record PmV2Call(string Name, PmV2Kind Kind, Func<HttpClient, Task<HttpResponseMessage>> Send);

    private static Dictionary<string, object?> ReportDefinition(int? type, string measure = "count", string groupBy = "disposition", string? numberField = null, string scope = "mine", string[]? dispositions = null) =>
        new() { ["v"] = 1, ["assetTypeId"] = type, ["measure"] = measure, ["numberField"] = numberField, ["numberUnit"] = numberField is null ? null : "GB", ["groupBy"] = groupBy, ["scope"] = scope, ["dispositions"] = dispositions };

    private PmV2Call[] PmV2Calls(string scope)
    {
        var s = scope.Length == 0 ? string.Empty : "&scope=" + scope;
        var q = scope.Length == 0 ? string.Empty : "?scope=" + scope;
        PmV2Call Get(string name, PmV2Kind kind, string url) => new(name, kind, http => http.GetAsync(url));
        PmV2Call Post(string name, Dictionary<string, object?> body) => new(name, PmV2Kind.Report, http => http.PostAsJsonAsync("/api/v1/asset-reports/run", body));
        return
        [
            Get("breakdown (matrix, first page)", PmV2Kind.BreakdownOrData, "/api/v1/my-matters/breakdown" + q),
            Get("breakdown (matrix, page 2)", PmV2Kind.BreakdownOrData, "/api/v1/my-matters/breakdown?page=2" + s),
            Get("breakdown (per task type)", PmV2Kind.BreakdownOrData, "/api/v1/my-matters/breakdown?view=types" + s),
            Get("breakdown (on hold only)", PmV2Kind.BreakdownOrData, "/api/v1/my-matters/breakdown?status=onHold" + s),
            Get("data", PmV2Kind.BreakdownOrData, "/api/v1/my-matters/data" + q),
            Get("data (size field of one type)", PmV2Kind.BreakdownOrData, $"/api/v1/my-matters/data?assetTypeIds={_workspaceType}&sizeFields={_workspaceType}:size_gb" + s),
            Get("data volume (24 months)", PmV2Kind.BreakdownOrData, "/api/v1/my-matters/data/volume" + q),
            new("data (20 matters chosen)", PmV2Kind.DataSelection, http => http.GetAsync("/api/v1/my-matters/data?" + Chosen(http, scope, matters: 20))),
            new("data (period of one year)", PmV2Kind.DataSelection, http => http.GetAsync("/api/v1/my-matters/data?" + Chosen(http, scope, period: true))),
            new("data (two size fields, GB and Items)", PmV2Kind.DataSelection, http => http.GetAsync("/api/v1/my-matters/data?" + Chosen(http, scope, fields: true))),
            new("data (everything chosen)", PmV2Kind.DataSelection, http => http.GetAsync("/api/v1/my-matters/data?" + Chosen(http, scope, matters: 20, period: true, fields: true))),
            new("data volume (20 matters, two size fields)", PmV2Kind.DataSelection, http => http.GetAsync("/api/v1/my-matters/data/volume?" + Chosen(http, scope, matters: 20, fields: true))),
            new("data volume (period, 60 months)", PmV2Kind.DataSelection, http => http.GetAsync("/api/v1/my-matters/data/volume?months=60&" + Chosen(http, scope, period: true))),
            Post("report: count by disposition", ReportDefinition(_workspaceType, scope: Scope(scope))),
            Post("report: sum of size by disposition", ReportDefinition(_workspaceType, "sum", numberField: "size_gb", scope: Scope(scope))),
            Post("report: sum of size by matter", ReportDefinition(_workspaceType, "sum", "matter", "size_gb", Scope(scope))),
            Post("report: sum of size by client", ReportDefinition(_workspaceType, "sum", "client", "size_gb", Scope(scope))),
            Post("report: count by platform (select)", ReportDefinition(_workspaceType, groupBy: "field:platform", scope: Scope(scope))),
            Post("report: average of size by platform", ReportDefinition(_workspaceType, "average", "field:platform", "size_gb", Scope(scope))),
            Post("report: sum of size by platform, Active only", ReportDefinition(_workspaceType, "sum", "field:platform", "size_gb", Scope(scope), ["ACTIVE"])),
            Post("report: sum by asset type, all types", ReportDefinition(null, "sum", "assetType", scope: Scope(scope))),
            Get("attention (type filter, sort by type)", PmV2Kind.Other, "/api/v1/my-matters/attention?taskTypeId=" + TypeIdsCsv() + "&sort=type" + s),
            Get("deadlines (type filter, sort by age)", PmV2Kind.Other, "/api/v1/my-matters/deadlines?taskTypeId=" + TypeIdsCsv() + "&sort=age" + s),
            Get("summary (with at risk)", PmV2Kind.Other, "/api/v1/my-matters/summary?fresh=true" + s),
            Get("task queue: at risk", PmV2Kind.Queue, "/api/v1/task-queue?atRisk=true&pageSize=50"),
            Get("task queue: on hold, sorted by due date", PmV2Kind.Queue, "/api/v1/task-queue?status=ON_HOLD&sort=due&pageSize=50"),
            Get("task queue: export (CSV, 1,700 on-hold tasks)", PmV2Kind.Queue, "/api/v1/task-queue/export?format=csv&status=ON_HOLD"),
            Get("my views", PmV2Kind.Other, "/api/v1/me/views"),
        ];
    }

    private readonly Dictionary<HttpClient, int[]> _chosenMatters = [];

    /// <summary>Reads, for each client, the ids of up to 20 matters in its own scope (the Data call itself says which they are), so the "matters chosen" shapes are inside the scope.</summary>
    private async Task PrepareChosenAsync(params (HttpClient Client, string Scope)[] clients)
    {
        foreach (var (client, scope) in clients)
        {
            var data = await OkAsync(await client.GetAsync("/api/v1/my-matters/data" + (scope.Length == 0 ? string.Empty : "?scope=" + scope)));
            _chosenMatters[client] = [.. data.GetProperty("matters").EnumerateArray().Select(m => m.GetProperty("matterId").GetInt32()).Take(20)];
        }
    }

    /// <summary>The query string of a Data Area selection: some matters, a one-year period, and two size fields of the workspace type (GB, and Items).</summary>
    private string Chosen(HttpClient http, string scope, int matters = 0, bool period = false, bool fields = false)
    {
        var parts = new List<string>();
        if (scope.Length > 0)
            parts.Add("scope=" + scope);
        if (matters > 0 && _chosenMatters.TryGetValue(http, out var ids))
            parts.AddRange(ids.Take(matters).Select(i => "matterIds=" + i));
        if (period)
        {
            var today = DateTime.UtcNow.Date;
            parts.Add($"from={today.AddYears(-1):yyyy-MM-dd}&to={today:yyyy-MM-dd}");
        }

        if (fields)
            parts.Add($"sizeFields={_workspaceType}:size_gb&sizeFields={_workspaceType}:copies:Items");
        return string.Join('&', parts);
    }

    private static string Scope(string scope) => scope.Length == 0 ? "mine" : scope;

    private string TypeIdsCsv() => _typeIds is { Length: > 0 } ? string.Join("&taskTypeId=", _typeIds) : "0";

    private int[]? _typeIds;

    private async Task LoadTypeIdsAsync()
    {
        _typeIds = await _factory.WithDbAsync(async db => (await db.Database.SqlQueryRaw<int>("SELECT TOP 3 TaskTypeId AS [Value] FROM dbo.TaskType WHERE Name LIKE N'Perf kind %' ORDER BY TaskTypeId").ToListAsync()).ToArray());
    }

    private async Task<Measure> MeasureCallAsync(HttpClient http, PmV2Call call)
    {
        _commands.Clear();
        var watch = Stopwatch.StartNew();
        await Ok(await call.Send(http), call);
        watch.Stop();
        var cold = watch.ElapsedMilliseconds;
        var timings = new List<long>();
        var statements = 0;
        for (var i = 0; i < WarmRuns; i++)
        {
            _commands.Clear();
            watch.Restart();
            await Ok(await call.Send(http), call);
            watch.Stop();
            timings.Add(watch.ElapsedMilliseconds);
            statements = _commands.Snapshot().Count;
        }

        timings.Sort();
        var p95 = timings[(int)Math.Ceiling(timings.Count * 0.95) - 1];
        output.WriteLine($"{call.Name,-46} cold {cold,4} ms   warm median {timings[timings.Count / 2],4} ms   p95 {p95,4} ms   {statements} statements");
        return new Measure(call.Name, cold, p95, statements);
    }

    private static async Task Ok(HttpResponseMessage response, PmV2Call call)
    {
        var body = await response.Content.ReadAsStringAsync();
        response.IsSuccessStatusCode.ShouldBeTrue($"{call.Name}: {(int)response.StatusCode} {body[..Math.Min(body.Length, 300)]}");
    }

    private static int BudgetOf(PmV2Call call) => call.Name.Contains("export", StringComparison.Ordinal) ? ExportBudgetMs : call.Kind switch { PmV2Kind.Report => ReportBudgetMs, PmV2Kind.DataSelection => DataSelectionBudgetMs, _ => BreakdownDataBudgetMs };

    [Fact]
    public async Task Breakdown_data_volume_and_the_reports_stay_within_the_budget_at_100000_assets_and_300000_index_rows()
    {
        await SeedPmV2Async();
        await LoadTypeIdsAsync();
        foreach (var client in new[] { _pm50, _heavy })
            await OkAsync(await client.GetAsync("/api/v1/my-matters/activity"));

        var admin = AdminAll();
        await PrepareChosenAsync((_pm50, string.Empty), (_heavy, string.Empty), (admin, "all"));
        var failures = new List<string>();
        foreach (var (who, client, scope) in new[] { ("pm50 (50 matters, 25,000 assets)", _pm50, string.Empty), ("heavy (145 matters, 72,500 assets)", _heavy, string.Empty), ("administrator, All matters (100,000 assets)", admin, "all") })
        {
            output.WriteLine($"--- {who}");
            foreach (var call in PmV2Calls(scope))
            {
                var m = await MeasureCallAsync(client, call);
                var budget = BudgetOf(call);
                // The plan's budget is p95 300 ms (500 ms for a report run) warm and 800 ms cold; the test allows twice that on a shared build machine.
                if (m.Warm95 > CeilingFactor * budget || m.Cold > CeilingFactor * 800)
                    failures.Add($"{who}: {call.Name} cold {m.Cold} ms, warm p95 {m.Warm95} ms (budget {budget} ms)");
            }
        }

        failures.ShouldBeEmpty(string.Join("\n", failures));
    }

    [Fact]
    public async Task The_number_of_statements_of_the_pm_v2_reads_does_not_depend_on_the_number_of_matters()
    {
        await SeedPmV2Async();
        await LoadTypeIdsAsync();
        foreach (var client in new[] { _pm5, _pm50, _heavy })
            await OkAsync(await client.GetAsync("/api/v1/my-matters/activity"));

        await PrepareChosenAsync((_pm5, string.Empty), (_pm50, string.Empty), (_heavy, string.Empty));
        var small = PmV2Calls(string.Empty);
        for (var i = 0; i < small.Length; i++)
        {
            var call = small[i];
            // Page 2 is the same statements as page 1; an export reads every page of a list that is not scoped to managed matters (a page of 100 tasks costs a fixed number of statements, the number of pages follows the rows).
            if (call.Name.Contains("page 2", StringComparison.Ordinal) || call.Name.Contains("export", StringComparison.Ordinal))
                continue;

            var a = await MeasureCallAsync(_pm5, call);
            var b = await MeasureCallAsync(_pm50, call);
            var c = await MeasureCallAsync(_heavy, call);
            // The invariant: 50 and 145 matters cost the same number of statements. A person with few matters may skip the optional name lookups when a result is empty
            // (a deadlines list with nothing in the window), so the count can only be lower. The bound only catches a loop over rows.
            b.Statements.ShouldBe(c.Statements, call.Name);
            a.Statements.ShouldBeLessThanOrEqualTo(b.Statements, call.Name);
            c.Statements.ShouldBeLessThan(20, call.Name);
        }
    }

    /// <summary>
    /// Issue #938: the first caller after a restart (or a plan cache flush) decides the plan of a statement whose cost depends on how many matters the caller manages (the scope is a
    /// subquery on the caller's id). The statement-count harness asks the 5-matter person first and showed 2.1 s for the 145-matter person on the volume reads while the budget test, which
    /// asks the larger people first, showed at most 618 ms. This test makes that order explicit: the plan cache is emptied, the small person asks once, then the heavy person is measured
    /// (cold and warm), and the same again with the heavy person asking first. Both orders print their numbers; neither may pass twice the Data budget.
    /// </summary>
    [Fact]
    public async Task The_data_reads_of_the_heavy_person_do_not_depend_on_which_person_compiled_the_plan_first()
    {
        await SeedPmV2Async();
        await LoadTypeIdsAsync();
        foreach (var client in new[] { _pm5, _heavy })
            await OkAsync(await client.GetAsync("/api/v1/my-matters/activity"));

        string[] shapes = ["data", "data volume (24 months)", "data volume (period, 60 months)", "data (two size fields, GB and Items)", "data volume (20 matters, two size fields)"];
        await PrepareChosenAsync((_pm5, string.Empty), (_heavy, string.Empty));
        var failures = new List<string>();
        foreach (var call in PmV2Calls(string.Empty).Where(c => shapes.Contains(c.Name)))
        {
            foreach (var (label, firstAsks) in new[] { ("the 5-matter person compiled first", true), ("the 145-matter person compiled first", false) })
            {
                await _factory.WithDbAsync(db => db.Database.ExecuteSqlRawAsync("DBCC FREEPROCCACHE"));
                if (firstAsks)
                    await Ok(await call.Send(_pm5), call);

                output.WriteLine($"--- {call.Name}, {label}");
                var m = await MeasureCallAsync(_heavy, call);
                if (m.Warm95 > CeilingFactor * DataSelectionBudgetMs || m.Cold > CeilingFactor * 800)
                    failures.Add($"{call.Name}, {label}: cold {m.Cold} ms, warm p95 {m.Warm95} ms (ceiling {CeilingFactor * DataSelectionBudgetMs} ms)");
            }
        }

        failures.ShouldBeEmpty(string.Join("\n", failures));
    }

    [Fact]
    public async Task The_typed_index_is_read_by_seeks_no_statement_uses_json_value_and_a_few_matters_read_tasks_by_seeks()
    {
        await SeedPmV2Async();
        await LoadTypeIdsAsync();
        await PrepareChosenAsync((_pm5, string.Empty), (_pm50, string.Empty), (_heavy, string.Empty));
        var failures = new List<string>();
        foreach (var (who, client, strictTasks) in new[] { ("pm5", _pm5, true), ("pm50", _pm50, false), ("heavy", _heavy, false) })
        {
            await OkAsync(await client.GetAsync("/api/v1/my-matters/activity"));
            foreach (var call in PmV2Calls(string.Empty).Where(c => !c.Name.Contains("page 2", StringComparison.Ordinal)))
            {
                await Ok(await call.Send(client), call); // loads permissions and compiles
                await _factory.WithDbAsync(db => db.Database.ExecuteSqlRawAsync("DBCC FREEPROCCACHE"));
                var before = await TaskScansAsync();
                await Ok(await call.Send(client), call);
                var scans = (await TaskScansAsync()).Where(kv => kv.Value > before.GetValueOrDefault(kv.Key)).Select(kv => $"{kv.Key} +{kv.Value - before.GetValueOrDefault(kv.Key)}").ToList();
                var plans = await CachedPlansAsync();
                output.WriteLine($"{who} {call.Name}: task scans {(scans.Count == 0 ? "none" : string.Join(", ", scans))}; {plans.Statements} statements read {plans.Reads} pages");
                foreach (var path in plans.Paths)
                    output.WriteLine("    plan: " + path);

                if (plans.UsesJsonValue)
                    failures.Add($"{who} {call.Name}: a statement uses JSON_VALUE");
                foreach (var scan in plans.IndexAccess.Where(a => a.Table == "CustomFieldIndex" && a.Op is not ("Index Seek" or "Key Lookup")))
                    failures.Add($"{who} {call.Name}: {scan.Op} on {scan.Index} (typed index must be read by seeks): {scan.Statement}");
                // The Task Queue lists every task a person may see, whoever manages the matter, so only the My Matters reads are held to "seeks for a few matters".
                if (strictTasks && scans.Count > 0 && call.Kind != PmV2Kind.Queue)
                {
                    foreach (var scan in plans.IndexAccess.Where(a => a.Table == "Task" && a.Op.Contains("Scan", StringComparison.Ordinal)).DistinctBy(a => a.Statement))
                        output.WriteLine($"    scanning statement: {scan.Op} {scan.Index}: {scan.Statement.ReplaceLineEndings(" ")}");
                    failures.Add($"{who} {call.Name}: scan of the task table {string.Join(", ", scans)}");
                }
            }
        }

        failures.ShouldBeEmpty("plans:\n" + string.Join("\n", failures));
    }

    private sealed record IndexAccess(string Table, string Index, string Op, string Statement);

    private sealed record PlanSummary(int Statements, long Reads, bool UsesJsonValue, List<IndexAccess> IndexAccess, List<string> Paths);

    public sealed class StatementPlanRow
    {
        public string PlanXml { get; set; } = string.Empty;

        public long Reads { get; set; }

        public string StatementText { get; set; } = string.Empty;
    }

    /// <summary>The cached plans of the statements that read the typed index, the assets or the tasks: how each index is accessed, the reads, and whether the statement text or plan contains JSON_VALUE.</summary>
    private Task<PlanSummary> CachedPlansAsync() => _factory.WithDbAsync(async db =>
    {
        var plans = await db.Database.SqlQuery<StatementPlanRow>($"""
            SELECT TOP 60 qp.query_plan AS PlanXml, CAST(qs.last_logical_reads AS BIGINT) AS Reads,
                   SUBSTRING(st.text, (qs.statement_start_offset / 2) + 1, ((CASE qs.statement_end_offset WHEN -1 THEN DATALENGTH(st.text) ELSE qs.statement_end_offset END - qs.statement_start_offset) / 2) + 1) AS StatementText
            FROM sys.dm_exec_query_stats qs
            CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
            CROSS APPLY sys.dm_exec_text_query_plan(qs.plan_handle, qs.statement_start_offset, qs.statement_end_offset) qp
            WHERE (st.text LIKE '%[[]CustomFieldIndex]%' OR st.text LIKE '%[[]Asset]%' OR st.text LIKE '%[[]Task]%') AND st.text NOT LIKE '%dm_exec%' AND qp.query_plan IS NOT NULL
            ORDER BY qs.last_execution_time DESC
            """).ToListAsync();
        XNamespace ns = "http://schemas.microsoft.com/sqlserver/2004/07/showplan";
        var access = new List<IndexAccess>();
        var json = false;
        foreach (var plan in plans)
        {
            json |= plan.PlanXml.Contains("JSON_VALUE", StringComparison.OrdinalIgnoreCase);
            foreach (var op in XDocument.Parse(plan.PlanXml).Descendants(ns + "RelOp"))
            {
                var node = op.Elements().FirstOrDefault(e => e.Name.LocalName is "IndexScan" or "TableScan");
                var obj = node?.Element(ns + "Object");
                if (obj is not null)
                {
                    // A key lookup is an Index Seek on the clustered key with Lookup="1": reported as "Key Lookup", it is a seek per row, not a scan.
                    var lookup = node!.Attribute("Lookup")?.Value is "1" or "true";
                    access.Add(new IndexAccess(
                        obj.Attribute("Table")?.Value.Trim('[', ']') ?? string.Empty,
                        obj.Attribute("Index")?.Value.Trim('[', ']') ?? string.Empty,
                        lookup ? "Key Lookup" : op.Attribute("PhysicalOp")?.Value ?? string.Empty,
                        plan.StatementText.Length > 700 ? plan.StatementText[..700] : plan.StatementText));
                }
            }
        }

        var paths = access.Where(a => a.Table is "CustomFieldIndex" or "Asset" or "Task").Select(a => $"{a.Op} {a.Table}.{a.Index}").Distinct().Order().ToList();
        return new PlanSummary(plans.Count, plans.Sum(p => p.Reads), json, access, paths);
    });
}
