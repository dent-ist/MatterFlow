using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// PM v2 #855: the task items of Needs my attention, Upcoming deadlines and Since your last visit carry the task type (name, icon, colour), priority, status, age, the hold and the At risk flag;
/// the two sections filter by task type and sort on the server, with the unfiltered total beside the filtered one.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class MyMattersSectionsTests(SqlServerFixture sql) : MyMattersTestBase(sql)
{
    private int _production;

    public override async Task InitializeAsync()
    {
        await base.InitializeAsync();
        _production = await H.CreateTaskTypeAsync("Production", [W.OrderedWorkflowId, W.UnorderedWorkflowId]);
        await SetTypeAsync(W.TaskTypeId, "teal", null);
        await SetTypeAsync(_production, "violet", 3);
    }

    private async Task SetTypeAsync(int id, string? colour, int? target)
    {
        var t = await OkAsync(await H.Admin.GetAsync($"/api/v1/task-types/{id}"));
        await OkAsync(await H.Admin.PutAsJsonAsync($"/api/v1/task-types/{id}", new
        {
            name = t.GetProperty("name").GetString(),
            iconKey = t.GetProperty("iconKey").GetString(),
            colourKey = colour,
            targetDays = target,
            isActive = true,
            eligibleWorkflowIds = t.GetProperty("eligibleWorkflowIds").EnumerateArray().Select(e => e.GetInt32()).ToArray(),
            defaultWorkflowDefinitionId = t.GetProperty("defaultWorkflowDefinitionId").GetInt32(),
            rowVersion = t.GetProperty("rowVersion").GetString(),
        }));
    }

    private static JsonElement Item(JsonElement attention, string title) => attention.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("title").GetString() == title);

    [Fact]
    public async Task Items_carry_the_type_priority_status_age_hold_and_at_risk_facts()
    {
        await MakeAsync("prod-overdue", M1, new() { ["dueDate"] = "2001-01-01", ["taskTypeId"] = _production });
        await MakeAsync("prod-soon", M1, new() { ["dueDate"] = In(2), ["taskTypeId"] = _production });
        await MakeAsync("prod-hold", M1, new() { ["taskTypeId"] = _production }, "ON_HOLD");
        await H.ExecuteAsync("UPDATE dbo.Task SET CreatedAt = DATEADD(day, -3, SYSUTCDATETIME()) WHERE Title IN ('prod-overdue', 'prod-soon', 'prod-hold')");
        await H.ExecuteAsync("UPDATE dbo.Task SET StatusChangedAt = DATEADD(day, -9, SYSUTCDATETIME()) WHERE Title = 'prod-hold'");
        H.Factory.InvalidateAll();

        var a = await Mine("attention");
        var plain = Item(a, "m1-overdue");
        plain.GetProperty("taskTypeName").GetString().ShouldBe("Data Processing");
        plain.GetProperty("taskTypeIconKey").GetString().ShouldBe("file-text");
        plain.GetProperty("taskTypeColourKey").GetString().ShouldBe("teal");
        plain.GetProperty("priorityName").GetString().ShouldBe("Normal");
        plain.GetProperty("statusCode").GetString().ShouldBe("NEW");
        plain.GetProperty("ageDays").GetInt32().ShouldBe(0);
        plain.GetProperty("onHold").ValueKind.ShouldBe(JsonValueKind.Null);
        plain.GetProperty("atRisk").GetBoolean().ShouldBeFalse(); // no target on the type

        // The Production tasks (the type filter keeps the five rows for them): an overdue task is not "at risk" (it is already late);
        // a not-yet-late task that used 3 of 3 days is, and At risk is a reason with a row of its own (issue #905).
        var p = await Mine($"attention?taskTypeId={_production}");
        Item(p, "prod-overdue").GetProperty("atRisk").GetBoolean().ShouldBeFalse();
        Item(p, "prod-overdue").GetProperty("factCode").GetString().ShouldBe("OVERDUE");
        var soon = Item(p, "prod-soon");
        soon.GetProperty("atRisk").GetBoolean().ShouldBeTrue();
        soon.GetProperty("factCode").GetString().ShouldBe("AT_RISK"); // before "unassigned", although it is unassigned and due in 2 days
        soon.GetProperty("taskTypeName").GetString().ShouldBe("Production");
        soon.GetProperty("taskTypeColourKey").GetString().ShouldBe("violet");
        soon.GetProperty("ageDays").GetInt32().ShouldBe(3);
        Titles(p.GetProperty("items")).ShouldBe(["prod-overdue", "prod-soon", "prod-hold"]);

        // On hold: the days and (without a chosen reason) a null reason; an On Hold task is never at risk.
        var hold = Item(p, "prod-hold");
        hold.GetProperty("statusCode").GetString().ShouldBe("ON_HOLD");
        hold.GetProperty("factCode").GetString().ShouldBe("ON_HOLD_DAYS");
        hold.GetProperty("onHold").GetProperty("days").GetInt32().ShouldBe(9);
        hold.GetProperty("onHold").GetProperty("reasonName").ValueKind.ShouldBe(JsonValueKind.Null);
        hold.GetProperty("atRisk").GetBoolean().ShouldBeFalse();

        // The deadlines list carries the same facts.
        var soonInDeadlines = (await Mine("deadlines")).GetProperty("items").EnumerateArray().Single(x => x.GetProperty("title").GetString() == "prod-soon");
        soonInDeadlines.GetProperty("taskTypeName").GetString().ShouldBe("Production");
        soonInDeadlines.GetProperty("atRisk").GetBoolean().ShouldBeTrue();
    }

    [Fact]
    public async Task The_type_filter_narrows_rows_totals_and_the_view_all_link_and_keeps_the_unfiltered_total()
    {
        await MakeAsync("prod-overdue", M1, new() { ["dueDate"] = "2001-01-01", ["taskTypeId"] = _production });
        await MakeAsync("prod-late-2", M2, new() { ["dueDate"] = "2001-02-01", ["taskTypeId"] = _production });

        var all = await Mine("attention");
        all.GetProperty("total").GetInt32().ShouldBe(6); // three overdue, two unassigned and due soon, one long hold: each once
        all.GetProperty("totalUnfiltered").ValueKind.ShouldBe(JsonValueKind.Null);

        var filtered = await Mine($"attention?taskTypeId={_production}");
        filtered.GetProperty("total").GetInt32().ShouldBe(2);
        filtered.GetProperty("totalUnfiltered").GetInt32().ShouldBe(6);
        Titles(filtered.GetProperty("items")).ShouldBe(["prod-overdue", "prod-late-2"]);
        var query = filtered.GetProperty("query").GetString()!;
        query.ShouldContain($"type={_production}");
        (await TotalAsync(A, "task-queue", query)).ShouldBe(2);

        // Two types are an OR.
        var both = await Mine($"attention?taskTypeId={_production}&taskTypeId={W.TaskTypeId}");
        both.GetProperty("total").GetInt32().ShouldBe(6);

        // Deadlines: the same.
        await MakeAsync("prod-in3", M1, new() { ["dueDate"] = In(3), ["taskTypeId"] = _production });
        var d = await Mine($"deadlines?taskTypeId={_production}");
        Titles(d.GetProperty("items")).ShouldBe(["prod-in3"]);
        d.GetProperty("total").GetInt32().ShouldBe(1);
        d.GetProperty("totalUnfiltered").GetInt32().ShouldBe(3);
        (await TotalAsync(A, "task-queue", d.GetProperty("query").GetString()!)).ShouldBe(1);
        (await Mine($"deadlines?taskTypeId={_production}&groupBy=day")).GetProperty("totalUnfiltered").GetInt32().ShouldBe(3);
    }

    [Fact]
    public async Task Deadlines_are_sorted_on_the_server_by_type_priority_matter_and_age_in_either_direction_with_a_stable_tie_break()
    {
        await MakeAsync("prod-a", M2, new() { ["dueDate"] = In(3), ["taskTypeId"] = _production });
        await MakeAsync("prod-b", M1, new() { ["dueDate"] = In(4), ["taskTypeId"] = _production });
        await H.ExecuteAsync("UPDATE dbo.Task SET CreatedAt = DATEADD(day, -30, SYSUTCDATETIME()) WHERE Title = 'prod-b'");
        H.Factory.InvalidateAll();

        // Natural order: soonest due first. By type: Data Processing before Production, ties by due date.
        Titles((await Mine("deadlines")).GetProperty("items")).ShouldBe(["m1-soon", "prod-a", "prod-b", "m2-in5"]);
        Titles((await Mine("deadlines?sort=type")).GetProperty("items")).ShouldBe(["m1-soon", "m2-in5", "prod-a", "prod-b"]);
        Titles((await Mine("deadlines?sort=type&dir=desc")).GetProperty("items")).ShouldBe(["prod-a", "prod-b", "m1-soon", "m2-in5"]);
        // Matter reference (M1 before M2), age (oldest first), due descending.
        Titles((await Mine("deadlines?sort=matter")).GetProperty("items")).Last().ShouldBe("m2-in5");
        Titles((await Mine("deadlines?sort=age")).GetProperty("items")).First().ShouldBe("prod-b");
        Titles((await Mine("deadlines?sort=due&dir=desc")).GetProperty("items")).ShouldBe(["m2-in5", "prod-b", "prod-a", "m1-soon"]);
        Titles((await Mine("deadlines?sort=priority")).GetProperty("items")).Count.ShouldBe(4);

        // The View all link carries the filter and the sort.
        (await Mine($"deadlines?sort=age&taskTypeId={_production}")).GetProperty("query").GetString()!.ShouldContain("sort=age");
    }

    [Fact]
    public async Task Priority_sort_of_the_deadlines_is_Critical_High_Normal_Low_and_descending_is_the_reverse_with_ties_in_due_order()
    {
        // Issue #898: a sort named Priority must put the most urgent first. Two Normal tasks tie on priority; the tie breaks by due date, then id.
        var priorities = await OkAsync(await H.Admin.GetAsync("/api/v1/priorities"));
        int Id(string label) => priorities.EnumerateArray().First(p => p.GetProperty("label").GetString() == label).GetProperty("id").GetInt32();
        await MakeAsync("prio-low", M1, new() { ["dueDate"] = In(2), ["priorityId"] = Id("Low") });
        await MakeAsync("prio-normal-late", M1, new() { ["dueDate"] = In(6), ["priorityId"] = Id("Normal") });
        await MakeAsync("prio-critical", M2, new() { ["dueDate"] = In(5), ["priorityId"] = Id("Critical") });
        await MakeAsync("prio-normal-soon", M1, new() { ["dueDate"] = In(3), ["priorityId"] = Id("Normal") });
        await MakeAsync("prio-high", M2, new() { ["dueDate"] = In(4), ["priorityId"] = Id("High") });

        List<string> Own(JsonElement items) => [.. Titles(items).Where(t => t.StartsWith("prio-", StringComparison.Ordinal))];
        var asc = (await Mine("deadlines?sort=priority")).GetProperty("items");
        Own(asc).ShouldBe(["prio-critical", "prio-high", "prio-normal-soon", "prio-normal-late", "prio-low"]);
        asc.EnumerateArray().Where(i => i.GetProperty("title").GetString()!.StartsWith("prio-", StringComparison.Ordinal))
            .Select(i => i.GetProperty("priorityName").GetString()).ShouldBe(["Critical", "High", "Normal", "Normal", "Low"]);
        Own((await Mine("deadlines?sort=priority&dir=asc")).GetProperty("items")).ShouldBe(Own(asc));
        Own((await Mine("deadlines?sort=priority&dir=desc")).GetProperty("items")).ShouldBe(["prio-low", "prio-normal-soon", "prio-normal-late", "prio-high", "prio-critical"]);

        // The "View all" link carries the same sort, and the Task Queue answers it in the same order.
        var viewAll = (await Mine("deadlines?sort=priority")).GetProperty("query").GetString()!;
        viewAll.ShouldContain("sort=priority");
        var queue = await OkAsync(await A.GetAsync("/api/v1/task-queue?pageSize=100&" + viewAll));
        Own(queue.GetProperty("items")).ShouldBe(["prio-critical", "prio-high", "prio-normal-soon", "prio-normal-late", "prio-low"]);
    }

    [Fact]
    public async Task A_bad_sort_direction_or_type_id_is_a_400_and_Since_your_last_visit_items_carry_the_facts()
    {
        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/attention?sort=colour"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/attention?dir=sideways"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/attention?taskTypeId=0"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/deadlines?sort=nope"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");

        var since = await Mine("since-last-visit");
        foreach (var item in since.GetProperty("items").EnumerateArray().Where(i => i.GetProperty("task").ValueKind == JsonValueKind.Object))
            item.GetProperty("task").GetProperty("taskTypeName").GetString().ShouldNotBeNullOrEmpty();
    }
}
