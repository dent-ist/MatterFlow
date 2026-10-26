using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// GET /my-matters/breakdown (PM v2, #861): open work per matter and task type, totals over all matters that equal the Task Queue counts of the links, paging, the type filter, the status
/// and the scope rules.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class MyMattersBreakdownTests(SqlServerFixture sql) : MyMattersTestBase(sql)
{
    private int _production;

    public override async Task InitializeAsync()
    {
        await base.InitializeAsync();
        _production = await H.CreateTaskTypeAsync("Production", [W.OrderedWorkflowId, W.UnorderedWorkflowId]);
        await MakeAsync("prod-m2-late", M2, new() { ["dueDate"] = "2001-01-01", ["taskTypeId"] = _production });
        await MakeAsync("prod-m2-ok", M2, new() { ["dueDate"] = "2099-01-01", ["taskTypeId"] = _production });
        await MakeAsync("prod-m3", M3, new() { ["taskTypeId"] = _production });
    }

    private static JsonElement TypeOf(JsonElement b, string name) => b.GetProperty("types").EnumerateArray().Single(t => t.GetProperty("name").GetString() == name);

    private static JsonElement RowOf(JsonElement b, int matterId) => b.GetProperty("rows").EnumerateArray().Single(r => r.GetProperty("matterId").GetInt32() == matterId);

    [Fact]
    public async Task The_matrix_has_the_types_as_columns_the_matters_overdue_first_and_totals_that_equal_the_queue()
    {
        var b = await Mine("breakdown");
        b.GetProperty("view").GetString().ShouldBe("matrix");
        b.GetProperty("types").EnumerateArray().Select(t => t.GetProperty("name").GetString()).ShouldBe(["Data Processing", "Production"]);

        // A manages M1, M2 and M4: 4 + 5 + 1 open tasks (M3 is unmanaged and never counted); 2 overdue (m1-overdue, prod-m2-late); 2 on hold.
        var totals = b.GetProperty("totals");
        (totals.GetProperty("open").GetInt32(), totals.GetProperty("overdue").GetInt32(), totals.GetProperty("onHold").GetInt32()).ShouldBe((10, 2, 2));
        (await TotalAsync(A, "task-queue", totals.GetProperty("query").GetString()!)).ShouldBe(10);
        (await TotalAsync(A, "task-queue", totals.GetProperty("overdueQuery").GetString()!)).ShouldBe(2);

        var processing = TypeOf(b, "Data Processing");
        (processing.GetProperty("open").GetInt32(), processing.GetProperty("overdue").GetInt32()).ShouldBe((8, 1));
        var production = TypeOf(b, "Production");
        (production.GetProperty("open").GetInt32(), production.GetProperty("overdue").GetInt32()).ShouldBe((2, 1));
        foreach (var t in new[] { processing, production })
        {
            (await TotalAsync(A, "task-queue", t.GetProperty("query").GetString()!)).ShouldBe(t.GetProperty("open").GetInt32());
            (await TotalAsync(A, "task-queue", t.GetProperty("overdueQuery").GetString()!)).ShouldBe(t.GetProperty("overdue").GetInt32());
        }

        // Rows: overdue first, then open tasks; M4 (one open task) last. The unmanaged matter is not a row.
        b.GetProperty("rows").EnumerateArray().Select(r => r.GetProperty("matterId").GetInt32()).ShouldBe([M2, M1, M4]);
        b.GetProperty("matterTotal").GetInt32().ShouldBe(3);
        var m2 = RowOf(b, M2);
        (m2.GetProperty("open").GetInt32(), m2.GetProperty("overdue").GetInt32(), m2.GetProperty("onHold").GetInt32()).ShouldBe((5, 1, 1));
        m2.GetProperty("cells").EnumerateArray().Select(c => c.GetProperty("taskTypeId").GetInt32()).ShouldBe([W.TaskTypeId, _production]);

        // Every cell's links list exactly what the cell counts; the cells of a row add up to the row, the rows to the totals.
        foreach (var row in b.GetProperty("rows").EnumerateArray())
        {
            row.GetProperty("cells").EnumerateArray().Sum(c => c.GetProperty("open").GetInt32()).ShouldBe(row.GetProperty("open").GetInt32());
            foreach (var cell in row.GetProperty("cells").EnumerateArray())
            {
                (await TotalAsync(A, "task-queue", cell.GetProperty("query").GetString()!)).ShouldBe(cell.GetProperty("open").GetInt32());
                (await TotalAsync(A, "task-queue", cell.GetProperty("overdueQuery").GetString()!)).ShouldBe(cell.GetProperty("overdue").GetInt32());
            }
        }

        b.GetProperty("rows").EnumerateArray().Sum(r => r.GetProperty("open").GetInt32()).ShouldBe(totals.GetProperty("open").GetInt32());
    }

    [Fact]
    public async Task The_types_view_the_type_filter_and_the_on_hold_status_narrow_the_figures_and_paging_keeps_the_totals()
    {
        var types = await Mine("breakdown?view=types");
        types.GetProperty("rows").GetArrayLength().ShouldBe(0);
        types.GetProperty("types").GetArrayLength().ShouldBe(2);
        types.GetProperty("totals").GetProperty("open").GetInt32().ShouldBe(10);

        var production = await Mine($"breakdown?taskTypeId={_production}");
        production.GetProperty("types").GetArrayLength().ShouldBe(1);
        production.GetProperty("totals").GetProperty("open").GetInt32().ShouldBe(2);
        production.GetProperty("rows").GetArrayLength().ShouldBe(1);

        var hold = await Mine("breakdown?status=onHold");
        hold.GetProperty("totals").GetProperty("open").GetInt32().ShouldBe(2);
        (await TotalAsync(A, "task-queue", hold.GetProperty("totals").GetProperty("query").GetString()!)).ShouldBe(2);

        // A page of one matter: the totals still cover all three matters.
        var page2 = await Mine("breakdown?pageSize=1&page=2");
        page2.GetProperty("rows").GetArrayLength().ShouldBe(1);
        page2.GetProperty("rows")[0].GetProperty("matterId").GetInt32().ShouldBe(M1);
        page2.GetProperty("matterTotal").GetInt32().ShouldBe(3);
        page2.GetProperty("totals").GetProperty("open").GetInt32().ShouldBe(10);
    }

    [Fact]
    public async Task At_risk_and_the_average_days_to_completion_come_with_the_target_of_the_type()
    {
        var t = await OkAsync(await H.Admin.GetAsync($"/api/v1/task-types/{_production}"));
        await OkAsync(await H.Admin.PutAsJsonAsync($"/api/v1/task-types/{_production}", new
        {
            name = "Production",
            iconKey = t.GetProperty("iconKey").GetString(),
            targetDays = 5,
            isActive = true,
            eligibleWorkflowIds = t.GetProperty("eligibleWorkflowIds").EnumerateArray().Select(e => e.GetInt32()).ToArray(),
            defaultWorkflowDefinitionId = t.GetProperty("defaultWorkflowDefinitionId").GetInt32(),
            rowVersion = t.GetProperty("rowVersion").GetString(),
        }));
        // prod-m2-ok is 4.5 days old (90 percent of 5), not overdue: at risk. prod-m2-late is overdue: not at risk.
        await H.ExecuteAsync("UPDATE dbo.Task SET CreatedAt = DATEADD(hour, -108, SYSUTCDATETIME()) WHERE Title IN ('prod-m2-ok', 'prod-m2-late')");
        var done = await MakeAsync("prod-done", M1, new() { ["taskTypeId"] = _production });
        await H.CompleteAsync(done);
        await H.ExecuteAsync("UPDATE dbo.Task SET CreatedAt = DATEADD(day, -4, SYSUTCDATETIME()) WHERE Title = 'prod-done'");
        H.Factory.InvalidateAll();

        var b = await Mine("breakdown");
        var production = TypeOf(b, "Production");
        production.GetProperty("targetDays").GetInt32().ShouldBe(5);
        production.GetProperty("atRisk").GetInt32().ShouldBe(1);
        production.GetProperty("doneCount").GetInt32().ShouldBe(1);
        production.GetProperty("avgDaysDone").GetDouble().ShouldBe(4.0, 0.1);
        b.GetProperty("totals").GetProperty("atRisk").GetInt32().ShouldBe(1);
        RowOf(b, M2).GetProperty("atRisk").GetInt32().ShouldBe(1);

        // The Task Queue filter atRisk=true lists the same task.
        (await TotalAsync(A, "task-queue", "managedByMe=true&atRisk=true")).ShouldBe(1);
        TypeOf(b, "Data Processing").GetProperty("avgDaysDone").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task The_all_scope_needs_Matter_AssignManagers_and_then_includes_the_unmanaged_matter_and_bad_input_is_a_400()
    {
        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/breakdown?scope=all"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        var all = await Mine("breakdown?scope=all", Director);
        all.GetProperty("rows").EnumerateArray().Select(r => r.GetProperty("matterId").GetInt32()).ShouldContain(M3);
        all.GetProperty("totals").GetProperty("open").GetInt32().ShouldBe(12);

        var none = await Mine("breakdown", Director);
        none.GetProperty("totals").GetProperty("open").GetInt32().ShouldBe(0);
        none.GetProperty("rows").GetArrayLength().ShouldBe(0);

        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/breakdown?view=cube"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/breakdown?status=done"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/breakdown?taskTypeId=0"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/breakdown?nope=1"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        (await NoTaskView.GetAsync("/api/v1/my-matters/breakdown")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }
}
