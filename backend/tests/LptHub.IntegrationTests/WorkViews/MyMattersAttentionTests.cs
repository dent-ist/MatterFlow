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
    private static List<string> ItemTitles(JsonElement attention) => Titles(attention.GetProperty("items"));

    private static string Reason(JsonElement attention, string title) =>
        attention.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("title").GetString() == title).GetProperty("factCode").GetString()!;

    [Fact]
    public async Task Attention_is_one_ranked_list_each_task_once_with_its_reason_and_never_shows_the_unmanaged_matters_tasks()
    {
        var a = await Mine("attention");
        // Overdue first; then the unassigned ones due within 7 days (soonest first); then the long hold. m1-overdue is unassigned too but is listed once, as overdue.
        ItemTitles(a).ShouldBe(["m1-overdue", "m1-soon", "m2-in5", "m1-hold"]); // m3-overdue belongs to a matter nobody manages
        a.GetProperty("total").GetInt32().ShouldBe(4);
        a.GetProperty("totalUnfiltered").ValueKind.ShouldBe(JsonValueKind.Null);
        a.GetProperty("stuckOnHoldDays").GetInt32().ShouldBe(7);

        var overdue = a.GetProperty("items")[0];
        overdue.GetProperty("factCode").GetString().ShouldBe("OVERDUE");
        overdue.GetProperty("factDays").GetInt32().ShouldBeGreaterThan(1000);
        overdue.GetProperty("matterRef").GetString().ShouldNotBeNullOrEmpty();
        overdue.GetProperty("clientName").GetString().ShouldStartWith("Acme");
        Reason(a, "m1-soon").ShouldBe("NO_ASSIGNEE");
        Reason(a, "m2-in5").ShouldBe("NO_ASSIGNEE");
        // The long hold, with its age (m2-hold is 2 days old and is not stuck).
        var hold = a.GetProperty("items")[3];
        (hold.GetProperty("factCode").GetString(), hold.GetProperty("factDays").GetInt32()).ShouldBe(("ON_HOLD_DAYS", 10));
        ItemTitles(a).ShouldNotContain("m4-ok");
        ItemTitles(a).ShouldNotContain("m2-hold");
        ItemTitles(a).ShouldNotContain("m1-asap"); // unassigned, but no date: not attention yet
        ItemTitles(a).ShouldNotContain("m3-overdue");

        // "View all" opens exactly the counted tasks (the Task Queue's needsAttention filter is the same set).
        var query = a.GetProperty("query").GetString()!;
        query.ShouldContain("needsAttention=true");
        (await TotalAsync(A, "task-queue", query)).ShouldBe(4);

        // Someone who manages nothing has nothing to attend to; the All scope does include the unmanaged matter.
        var none = await Mine("attention", Director);
        none.GetProperty("total").GetInt32().ShouldBe(0);
        none.GetProperty("items").GetArrayLength().ShouldBe(0);
        ItemTitles(await Mine("attention?scope=all", Director)).ShouldContain("m3-overdue");
        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/attention?scope=all"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
    }

    [Fact]
    public async Task The_list_is_capped_at_five_rows_and_keeps_the_real_total_which_equals_the_Task_Queue()
    {
        for (var i = 0; i < 12; i++)
            await MakeAsync($"extra-{i:00}", M6, new() { ["dueDate"] = "2001-01-" + (i + 1).ToString("00") });

        var a = await Mine("attention");
        // 13 overdue (12 new + m1-overdue), the soon ones and the hold: each once.
        a.GetProperty("total").GetInt32().ShouldBe(16);
        a.GetProperty("items").GetArrayLength().ShouldBe(5);
        // Oldest due first, and the overdue ones fill the list before anything less urgent.
        ItemTitles(a).ShouldBe(["m1-overdue", "extra-00", "extra-01", "extra-02", "extra-03"]);
        (await TotalAsync(A, "task-queue", a.GetProperty("query").GetString()!)).ShouldBe(16);
        ItemTitles(a).Distinct().Count().ShouldBe(5);
    }

    [Fact]
    public async Task A_task_that_is_overdue_and_unassigned_is_listed_once_as_overdue_and_counted_once()
    {
        var a = await Mine("attention");
        ItemTitles(a).Count(t => t == "m1-overdue").ShouldBe(1);
        Reason(a, "m1-overdue").ShouldBe("OVERDUE");
        // The unassigned chip of the strip counts it too (it is a different question); the list's total does not add the two.
        (await Mine("summary?fresh=true")).GetProperty("unassigned").GetProperty("count").GetInt32().ShouldBe(7);
        a.GetProperty("total").GetInt32().ShouldBe(4);
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
