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

    private static JsonElement Group(JsonElement attention, string kind) => attention.GetProperty("groups").EnumerateArray().Single(g => g.GetProperty("kind").GetString() == kind);

    private static List<string> GroupTitles(JsonElement group) => Titles(group.GetProperty("items"));

    private static JsonElement Item(JsonElement group, string title) => group.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("title").GetString() == title);

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
        var plain = Item(Group(a, "overdue"), "m1-overdue");
        plain.GetProperty("taskTypeName").GetString().ShouldBe("Data Processing");
        plain.GetProperty("taskTypeIconKey").GetString().ShouldBe("file-text");
        plain.GetProperty("taskTypeColourKey").GetString().ShouldBe("teal");
        plain.GetProperty("priorityName").GetString().ShouldBe("Normal");
        plain.GetProperty("statusCode").GetString().ShouldBe("NEW");
        plain.GetProperty("ageDays").GetInt32().ShouldBe(0);
        plain.GetProperty("onHold").ValueKind.ShouldBe(JsonValueKind.Null);
        plain.GetProperty("atRisk").GetBoolean().ShouldBeFalse(); // no target on the type

        // An overdue task is not "at risk" (it is already late); a not-yet-late task that used 3 of 3 days is.
        Item(Group(a, "overdue"), "prod-overdue").GetProperty("atRisk").GetBoolean().ShouldBeFalse();
        var soon = Item(Group(a, "dueSoon"), "prod-soon");
        soon.GetProperty("atRisk").GetBoolean().ShouldBeTrue();
        soon.GetProperty("taskTypeName").GetString().ShouldBe("Production");
        soon.GetProperty("taskTypeColourKey").GetString().ShouldBe("violet");
        soon.GetProperty("ageDays").GetInt32().ShouldBe(3);

        // On hold: the days and (without a chosen reason) a null reason; an On Hold task is never at risk.
        var hold = Item(Group(a, "stuckOnHold"), "prod-hold");
        hold.GetProperty("statusCode").GetString().ShouldBe("ON_HOLD");
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

        var all = Group(await Mine("attention"), "overdue");
        all.GetProperty("total").GetInt32().ShouldBe(3);
        all.GetProperty("totalUnfiltered").ValueKind.ShouldBe(JsonValueKind.Null);

        var filtered = Group(await Mine($"attention?taskTypeId={_production}"), "overdue");
        filtered.GetProperty("total").GetInt32().ShouldBe(2);
        filtered.GetProperty("totalUnfiltered").GetInt32().ShouldBe(3);
        GroupTitles(filtered).ShouldBe(["prod-overdue", "prod-late-2"]);
        (await TotalAsync(A, "task-queue", filtered.GetProperty("query").GetString()!)).ShouldBe(2);

        // Two types are an OR; the other groups follow the same filter.
        var both = await Mine($"attention?taskTypeId={_production}&taskTypeId={W.TaskTypeId}");
        Group(both, "overdue").GetProperty("total").GetInt32().ShouldBe(3);
        Group(await Mine($"attention?taskTypeId={_production}"), "unassigned").GetProperty("total").GetInt32().ShouldBe(2);

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
    public async Task Sorting_is_done_on_the_server_by_type_priority_matter_and_age_in_either_direction_with_a_stable_tie_break()
    {
        await MakeAsync("prod-a", M2, new() { ["dueDate"] = "2001-03-01", ["taskTypeId"] = _production });
        await MakeAsync("prod-b", M1, new() { ["dueDate"] = "2001-04-01", ["taskTypeId"] = _production });
        await H.ExecuteAsync("UPDATE dbo.Task SET CreatedAt = DATEADD(day, -30, SYSUTCDATETIME()) WHERE Title = 'prod-b'");
        H.Factory.InvalidateAll();

        // Natural order: oldest due first. By type: Data Processing before Production, ties by due date.
        GroupTitles(Group(await Mine("attention"), "overdue")).ShouldBe(["m1-overdue", "prod-a", "prod-b"]);
        GroupTitles(Group(await Mine("attention?sort=type"), "overdue")).ShouldBe(["m1-overdue", "prod-a", "prod-b"]);
        GroupTitles(Group(await Mine("attention?sort=type&dir=desc"), "overdue")).ShouldBe(["prod-a", "prod-b", "m1-overdue"]);
        // Matter reference (M1 before M2), age (oldest first), due descending.
        GroupTitles(Group(await Mine("attention?sort=matter"), "overdue")).Last().ShouldBe("prod-a");
        GroupTitles(Group(await Mine("attention?sort=age"), "overdue")).First().ShouldBe("prod-b");
        GroupTitles(Group(await Mine("attention?sort=due&dir=desc"), "overdue")).ShouldBe(["prod-b", "prod-a", "m1-overdue"]);
        GroupTitles(Group(await Mine("attention?sort=priority"), "overdue")).Count.ShouldBe(3);

        // The View all link carries the filter and the sort.
        Group(await Mine($"attention?sort=age&taskTypeId={_production}"), "overdue").GetProperty("query").GetString()!.ShouldContain("sort=age");
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
