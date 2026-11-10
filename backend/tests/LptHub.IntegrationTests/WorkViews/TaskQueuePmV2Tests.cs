using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// PM v2 #860: the Task Queue (and My Work and Pod Work, which take the same keys) filter by <c>atRisk</c> and <c>onHoldReason</c>, sort by <c>type</c> and carry the type colour,
/// the on-hold reason and the At risk flag on each row.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskQueuePmV2Tests(SqlServerFixture sql) : MyMattersTestBase(sql)
{
    private int _production;
    private int[] _reasons = [];

    public override async Task InitializeAsync()
    {
        await base.InitializeAsync();
        _production = await H.CreateTaskTypeAsync("Production", [W.OrderedWorkflowId, W.UnorderedWorkflowId]);
        _reasons = [.. (await OkAsync(await H.Admin.GetAsync("/api/v1/on-hold-reasons"))).EnumerateArray().Select(r => r.GetProperty("id").GetInt32())];
    }

    private async Task<JsonElement> HoldWithReasonAsync(string title, int matterId, int? reasonId, int? typeId = null)
    {
        var extra = new Dictionary<string, object?> { ["matterId"] = matterId };
        if (typeId is { } t)
            extra["taskTypeId"] = t;
        var task = await OkAsync(await H.Admin.PostAsJsonAsync("/api/v1/tasks", H.NewTask(W, ordered: false, title: title, extra: extra)), HttpStatusCode.Created);
        Ids[title] = TaskId(task);
        return await OkAsync(await H.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/status", new { status = "ON_HOLD", comment = "Waiting", onHoldReasonId = reasonId, rowVersion = RowVersion(task) }));
    }

    private async Task<List<JsonElement>> QueueAsync(string query, string path = "task-queue") =>
        [.. (await OkAsync(await A.GetAsync($"/api/v1/{path}?pageSize=100&managedByMe=true&{query}"))).GetProperty("items").EnumerateArray()];

    private static List<string> TitlesOf(IEnumerable<JsonElement> rows) => [.. rows.Select(r => r.GetProperty("title").GetString()!)];

    [Fact]
    public async Task The_on_hold_reason_filter_matches_the_chosen_reasons_and_zero_means_no_reason_and_rows_carry_the_reason()
    {
        await HoldWithReasonAsync("hold-client", M1, _reasons[0]);
        await HoldWithReasonAsync("hold-vendor", M2, _reasons[2]);
        await HoldWithReasonAsync("hold-vendor-2", M1, _reasons[2]);

        var client = await QueueAsync($"onHoldReason={_reasons[0]}");
        TitlesOf(client).ShouldBe(["hold-client"]);
        client[0].GetProperty("onHoldReasonName").GetString().ShouldBe("Waiting for client data");
        client[0].GetProperty("onHoldReasonId").GetInt32().ShouldBe(_reasons[0]);

        TitlesOf(await QueueAsync($"onHoldReason={_reasons[0]}&onHoldReason={_reasons[2]}")).Order().ShouldBe(["hold-client", "hold-vendor", "hold-vendor-2"]);
        // 0 = on hold without a reason: the two holds of the base data (m1-hold, m2-hold).
        TitlesOf(await QueueAsync("onHoldReason=0")).Order().ShouldBe(["m1-hold", "m2-hold"]);
        (await QueueAsync("onHoldReason=999999")).ShouldBeEmpty();

        // The same keys work on My Work and Pod Work (a 200, not a 400 unknown filter); the filter agrees with the task queue.
        (await A.GetAsync($"/api/v1/my-work?onHoldReason={_reasons[0]}&atRisk=true")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await A.GetAsync("/api/v1/pod-work?atRisk=true")).StatusCode.ShouldBeOneOf(HttpStatusCode.OK, HttpStatusCode.NotFound, HttpStatusCode.Forbidden);
        await ProblemAsync(await A.GetAsync("/api/v1/task-queue?onHoldReason=-3&nope=1"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task The_at_risk_filter_and_the_row_flag_follow_the_target_turnaround_and_the_colour_comes_with_the_row()
    {
        var type = await OkAsync(await H.Admin.GetAsync($"/api/v1/task-types/{_production}"));
        await OkAsync(await H.Admin.PutAsJsonAsync($"/api/v1/task-types/{_production}", new
        {
            name = "Production",
            iconKey = "package-export",
            colourKey = "violet",
            targetDays = 10,
            isActive = true,
            eligibleWorkflowIds = type.GetProperty("eligibleWorkflowIds").EnumerateArray().Select(e => e.GetInt32()).ToArray(),
            defaultWorkflowDefinitionId = type.GetProperty("defaultWorkflowDefinitionId").GetInt32(),
            rowVersion = type.GetProperty("rowVersion").GetString(),
        }));
        await MakeAsync("prod-fresh", M1, new() { ["dueDate"] = "2099-01-01", ["taskTypeId"] = _production });
        await MakeAsync("prod-old", M1, new() { ["dueDate"] = "2099-01-01", ["taskTypeId"] = _production });
        await MakeAsync("prod-late", M1, new() { ["dueDate"] = "2001-01-01", ["taskTypeId"] = _production });
        await H.ExecuteAsync("UPDATE dbo.Task SET CreatedAt = DATEADD(day, -9, SYSUTCDATETIME()) WHERE Title IN ('prod-old', 'prod-late')");
        await H.ExecuteAsync("UPDATE dbo.Task SET CreatedAt = DATEADD(day, -9, SYSUTCDATETIME()) WHERE Title = 'm1-soon'"); // a type without a target is never at risk
        H.Factory.InvalidateAll();

        var atRisk = await QueueAsync("atRisk=true");
        TitlesOf(atRisk).ShouldBe(["prod-old"]); // prod-fresh used 0 percent, prod-late is overdue, m1-soon's type has no target
        atRisk[0].GetProperty("atRisk").GetBoolean().ShouldBeTrue();
        atRisk[0].GetProperty("taskTypeColourKey").GetString().ShouldBe("violet");

        var all = await QueueAsync("status=NEW&status=IN_PROGRESS&status=ON_HOLD");
        all.Where(r => r.GetProperty("atRisk").GetBoolean()).Select(r => r.GetProperty("title").GetString()).ShouldBe(["prod-old"]);
        all.Single(r => r.GetProperty("title").GetString() == "m1-soon").GetProperty("taskTypeColourKey").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task The_needs_attention_filter_is_the_union_of_overdue_at_risk_due_today_unassigned_soon_and_long_holds_each_task_once()
    {
        var type = await OkAsync(await H.Admin.GetAsync($"/api/v1/task-types/{_production}"));
        await OkAsync(await H.Admin.PutAsJsonAsync($"/api/v1/task-types/{_production}", new
        {
            name = type.GetProperty("name").GetString(),
            iconKey = type.GetProperty("iconKey").GetString(),
            colourKey = "violet",
            targetDays = 5,
            isActive = true,
            eligibleWorkflowIds = type.GetProperty("eligibleWorkflowIds").EnumerateArray().Select(e => e.GetInt32()).ToArray(),
            defaultWorkflowDefinitionId = type.GetProperty("defaultWorkflowDefinitionId").GetInt32(),
            rowVersion = type.GetProperty("rowVersion").GetString(),
        }));
        // At risk (assigned, far due date, 9 of 5 days used), and a fresh one that is none of the five.
        await MakeAsync("prod-old", M1, new() { ["dueDate"] = "2099-01-01", ["taskTypeId"] = _production, ["assignedUserId"] = Tech });
        await MakeAsync("prod-fresh", M1, new() { ["dueDate"] = "2099-01-01", ["taskTypeId"] = _production, ["assignedUserId"] = Tech });
        await H.ExecuteAsync("UPDATE dbo.Task SET CreatedAt = DATEADD(day, -9, SYSUTCDATETIME()) WHERE Title = 'prod-old'");
        H.Factory.InvalidateAll();

        // The base data: m1-overdue (also unassigned: once), m1-soon and m2-in5 (unassigned, due in 2 and 5 days), m1-hold (10 days on hold); m1-asap has no date, m2-far is far
        // away, m2-hold is 2 days old, m4-ok is assigned and far away. prod-old is at risk.
        TitlesOf(await QueueAsync("needsAttention=true")).Order().ShouldBe(["m1-hold", "m1-overdue", "m1-soon", "m2-in5", "prod-old"]);
        // Issue #935: the urgency sort ranks by reason (overdue, at risk, due today, unassigned, long hold) and inside a reason by due date, so at risk and held tasks are not
        // pushed out of the first rows by a due-date order; descending is the exact reverse.
        var urgency = new[] { "m1-overdue", "prod-old", "m1-soon", "m2-in5", "m1-hold" };
        TitlesOf(await QueueAsync("needsAttention=true&sort=attention")).ShouldBe(urgency);
        TitlesOf(await QueueAsync("needsAttention=true&sort=attention&dir=desc")).ShouldBe(urgency.Reverse());
        // It combines with the other filters like any filter, and false is the same as leaving it out.
        TitlesOf(await QueueAsync($"needsAttention=true&type={_production}")).ShouldBe(["prod-old"]);
        (await QueueAsync("needsAttention=false")).Count.ShouldBeGreaterThan(5);
        (await A.GetAsync("/api/v1/my-work?needsAttention=true")).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Sorting_by_type_orders_by_the_type_name_in_either_direction()
    {
        await MakeAsync("prod-a", M1, new() { ["dueDate"] = "2099-02-01", ["taskTypeId"] = _production });
        await MakeAsync("prod-b", M2, new() { ["dueDate"] = "2099-03-01", ["taskTypeId"] = _production });

        var asc = TitlesOf(await QueueAsync("status=NEW&status=IN_PROGRESS&status=ON_HOLD&sort=type&dir=asc"));
        var kinds = asc.Select(t => t.StartsWith("prod-", StringComparison.Ordinal) ? "P" : "D").ToList();
        string.Join(string.Empty, kinds).ShouldBe(new string('D', kinds.Count(k => k == "D")) + "PP"); // Data Processing before Production
        var desc = TitlesOf(await QueueAsync("status=NEW&status=IN_PROGRESS&status=ON_HOLD&sort=type&dir=desc"));
        desc.Take(2).Order().ShouldBe(["prod-a", "prod-b"]);
        (await A.GetAsync("/api/v1/task-queue?sort=type")).StatusCode.ShouldBe(HttpStatusCode.OK);
    }
}
