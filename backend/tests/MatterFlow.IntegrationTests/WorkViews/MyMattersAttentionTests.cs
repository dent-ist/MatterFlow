using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// GET /my-matters/attention and /deadlines (issue #681): groups, caps, ordering, links that equal their lists and the rule that an unmanaged matter is never an item.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class MyMattersAttentionTests(SqlServerFixture sql) : MyMattersTestBase(sql)
{
    private static JsonElement Group(JsonElement attention, string kind) => attention.GetProperty("groups").EnumerateArray().Single(g => g.GetProperty("kind").GetString() == kind);

    private static List<string> GroupTitles(JsonElement group) => [.. group.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("title").GetString()!)];

    [Fact]
    public async Task Attention_has_four_groups_with_facts_and_never_shows_the_unmanaged_matters_tasks()
    {
        var a = await Mine("attention");
        a.GetProperty("groups").EnumerateArray().Select(g => g.GetProperty("kind").GetString()).ShouldBe(["overdue", "dueSoon", "unassigned", "stuckOnHold"]);

        var overdue = Group(a, "overdue");
        overdue.GetProperty("total").GetInt32().ShouldBe(1);
        GroupTitles(overdue).ShouldBe(["m1-overdue"]); // m3-overdue belongs to a matter nobody manages
        var item = overdue.GetProperty("items")[0];
        item.GetProperty("factCode").GetString().ShouldBe("OVERDUE");
        item.GetProperty("factDays").GetInt32().ShouldBeGreaterThan(1000);
        item.GetProperty("matterRef").GetString().ShouldNotBeNullOrEmpty();
        item.GetProperty("clientName").GetString().ShouldStartWith("Acme");

        var soon = Group(a, "dueSoon");
        GroupTitles(soon).ShouldBe(["m1-soon"]);
        soon.GetProperty("items")[0].GetProperty("factCode").GetString().ShouldBeOneOf("DUE_IN_DAYS", "DUE_TODAY");

        // Unassigned: those due within 7 days first (overdue, soon, in 5 days), then the rest oldest first; every unassigned open task of A's matters is counted.
        var unassigned = Group(a, "unassigned");
        unassigned.GetProperty("total").GetInt32().ShouldBe(7);
        GroupTitles(unassigned).Take(3).ShouldBe(["m1-overdue", "m1-soon", "m2-in5"]);
        GroupTitles(unassigned).ShouldNotContain("m4-ok");
        GroupTitles(unassigned).ShouldNotContain("m3-overdue");
        unassigned.GetProperty("items")[0].GetProperty("factCode").GetString().ShouldBe("NO_ASSIGNEE");

        // Stuck on hold: longer than 7 days only (m2-hold is 2 days old), with its age.
        var stuck = Group(a, "stuckOnHold");
        stuck.GetProperty("total").GetInt32().ShouldBe(1);
        GroupTitles(stuck).ShouldBe(["m1-hold"]);
        var hold = stuck.GetProperty("items")[0];
        (hold.GetProperty("factCode").GetString(), hold.GetProperty("factDays").GetInt32()).ShouldBe(("ON_HOLD_DAYS", 10));

        // The "View all" queries open the same tasks.
        foreach (var kind in new[] { "overdue", "dueSoon", "unassigned" })
        {
            var g = Group(a, kind);
            (await TotalAsync(A, "task-queue", g.GetProperty("query").GetString()!)).ShouldBe(g.GetProperty("total").GetInt32(), kind);
        }

        // Someone who manages nothing has nothing to attend to; the All scope does include the unmanaged matter.
        var none = await Mine("attention", Director);
        none.GetProperty("groups").EnumerateArray().ShouldAllBe(g => g.GetProperty("total").GetInt32() == 0);
        GroupTitles(Group(await Mine("attention?scope=all", Director), "overdue")).Order().ShouldBe(["m1-overdue", "m3-overdue"]);
        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/attention?scope=all"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
    }

    [Fact]
    public async Task Each_attention_group_is_capped_at_ten_rows_and_keeps_the_real_total()
    {
        for (var i = 0; i < 12; i++)
            await MakeAsync($"extra-{i:00}", M6, new() { ["dueDate"] = "2001-01-" + (i + 1).ToString("00") });

        var overdue = Group(await Mine("attention"), "overdue");
        overdue.GetProperty("total").GetInt32().ShouldBe(13);
        overdue.GetProperty("items").GetArrayLength().ShouldBe(10);
        // Oldest due first.
        GroupTitles(overdue).Take(2).ShouldBe(["m1-overdue", "extra-00"]);
        (await TotalAsync(A, "task-queue", overdue.GetProperty("query").GetString()!)).ShouldBe(13);
    }

    [Fact]
    public async Task Deadlines_are_the_open_not_overdue_tasks_of_the_window_soonest_first_with_a_total()
    {
        var d = await Mine("deadlines");
        d.GetProperty("days").GetInt32().ShouldBe(14);
        d.GetProperty("total").GetInt32().ShouldBe(2);
        Titles(d.GetProperty("items")).ShouldBe(["m1-soon", "m2-in5"]); // not the overdue task, not ASAP, not the 2099 ones
        (await TotalAsync(A, "task-queue", d.GetProperty("query").GetString()!)).ShouldBe(2);

        await MakeAsync("m1-day20", M1, new() { ["dueDate"] = In(20) });
        Titles((await Mine("deadlines")).GetProperty("items")).ShouldNotContain("m1-day20");
        var wide = await Mine("deadlines?days=28");
        Titles(wide.GetProperty("items")).ShouldBe(["m1-soon", "m2-in5", "m1-day20"]);
        (await TotalAsync(A, "task-queue", wide.GetProperty("query").GetString()!)).ShouldBe(3);
        wide.GetProperty("items")[0].GetProperty("factCode").GetString().ShouldBeOneOf("DUE_IN_DAYS", "DUE_TODAY");

        // The date range narrows the window, and a bad window is a 400.
        Titles((await Mine($"deadlines?days=28&from={In(10)}")).GetProperty("items")).ShouldBe(["m1-day20"]);
        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/deadlines?days=7"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task Deadlines_are_capped_at_25_and_the_total_is_complete()
    {
        for (var i = 0; i < 27; i++)
            await MakeAsync($"day-{i:00}", M6, new() { ["dueDate"] = In(1 + i % 12) });

        var d = await Mine("deadlines");
        d.GetProperty("total").GetInt32().ShouldBe(29);
        d.GetProperty("items").GetArrayLength().ShouldBe(25);
    }
}
