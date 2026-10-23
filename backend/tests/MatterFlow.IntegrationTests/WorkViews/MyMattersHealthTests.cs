using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>GET /my-matters/health (epic #667, issue #679): one row per matter, the flag rule branch by branch, the workflow percentage, sort and paging.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class MyMattersHealthTests(SqlServerFixture sql) : MyMattersTestBase(sql)
{
    private static JsonElement Row(JsonElement page, int matterId) => page.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("matterId").GetInt32() == matterId);

    private static List<int> Order(JsonElement page) => [.. page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("matterId").GetInt32())];

    private static List<string> Reasons(JsonElement row) => [.. row.GetProperty("flagReasons").EnumerateArray().Select(r => r.GetString()!)];

    [Fact]
    public async Task One_row_per_matter_with_counts_next_deadline_and_the_flag_rule()
    {
        var page = await Mine("health");
        page.GetProperty("total").GetInt32().ShouldBe(4);
        page.GetProperty("sort").GetString().ShouldBe("nextDeadline");
        page.GetProperty("amberDueDays").GetInt32().ShouldBe(3);
        page.GetProperty("stuckOnHoldDays").GetInt32().ShouldBe(7);

        // M1: an overdue task makes it Red; every reason that applies is listed, no manager state anywhere.
        var m1 = Row(page, M1);
        (m1.GetProperty("open").GetInt32(), m1.GetProperty("overdue").GetInt32(), m1.GetProperty("dueThisWeek").GetInt32(), m1.GetProperty("unassigned").GetInt32()).ShouldBe((4, 1, 1, 4));
        m1.GetProperty("flag").GetString().ShouldBe("RED");
        Reasons(m1).ShouldBe(["OVERDUE", "UNASSIGNED", "DUE_SOON", "LONG_HOLD"]);
        m1.GetProperty("nextDeadline").GetString().ShouldBe(In(2)); // the overdue task is not the next deadline
        m1.GetProperty("matterRef").GetString().ShouldNotBeNullOrEmpty();
        m1.GetProperty("clientNumber").GetString().ShouldBe("00343");

        // M2: nothing overdue, an unassigned task (the hold is only 2 days old, the due date is 5 days away) makes it Amber.
        var m2 = Row(page, M2);
        m2.GetProperty("flag").GetString().ShouldBe("AMBER");
        Reasons(m2).ShouldBe(["UNASSIGNED"]);
        m2.GetProperty("dueThisWeek").GetInt32().ShouldBe(1);
        m2.GetProperty("nextDeadline").GetString().ShouldBe(In(5));

        // M4: an assigned task due far ahead is Green, with no reasons.
        var m4 = Row(page, M4);
        m4.GetProperty("flag").GetString().ShouldBe("GREEN");
        Reasons(m4).ShouldBeEmpty();
        m4.GetProperty("nextDeadline").GetString().ShouldBe("2099-01-01");

        // M6: no open task is Green with the reason, no percentage and no deadline.
        var m6 = Row(page, M6);
        m6.GetProperty("flag").GetString().ShouldBe("GREEN");
        Reasons(m6).ShouldBe(["NO_OPEN_TASKS"]);
        m6.GetProperty("percentComplete").ValueKind.ShouldBe(JsonValueKind.Null);
        m6.GetProperty("nextDeadline").ValueKind.ShouldBe(JsonValueKind.Null);

        // Default order: next deadline soonest first, matters with none last. M3 (no manager) and M5 (inactive) are not rows.
        Order(page).ShouldBe([M1, M2, M4, M6]);
        Order(page).ShouldNotContain(M3);
        Order(page).ShouldNotContain(M5);
    }

    [Fact]
    public async Task A_long_hold_alone_is_Amber_and_a_short_one_is_not()
    {
        await MakeAsync("m6-hold", M6, new() { ["dueDate"] = "2099-01-01", ["assignedUserId"] = Tech }, "ON_HOLD");
        Row(await Mine("health"), M6).GetProperty("flag").GetString().ShouldBe("GREEN");
        await H.ExecuteAsync("UPDATE dbo.Task SET StatusChangedAt = DATEADD(day, -8, SYSUTCDATETIME()) WHERE Title = 'm6-hold'");
        var m6 = Row(await Mine("health"), M6);
        m6.GetProperty("flag").GetString().ShouldBe("AMBER");
        Reasons(m6).ShouldBe(["LONG_HOLD"]);
    }

    [Fact]
    public async Task Percent_complete_counts_resolved_steps_of_open_tasks_only()
    {
        var m4 = Row(await Mine("health"), M4);
        m4.GetProperty("percentComplete").GetInt32().ShouldBe(0);

        // m4-ok has the 2-step unordered workflow: completing one step is 50%.
        var task = await H.GetTaskAsync(Ids["m4-ok"]);
        var steps = StepIds(task);
        await H.StepAsync(task, steps[0], "complete");
        Row(await Mine("health"), M4).GetProperty("percentComplete").GetInt32().ShouldBe(50);

        // A second open task with nothing done: 1 of 4 steps = 25%.
        await MakeAsync("m4-more", M4, new() { ["dueDate"] = "2099-02-01", ["assignedUserId"] = Tech });
        Row(await Mine("health"), M4).GetProperty("percentComplete").GetInt32().ShouldBe(25);

        // A completed task no longer counts, so finishing m4-more leaves only m4-ok (50%).
        var more = await H.GetTaskAsync(Ids["m4-more"]);
        await H.CompleteAsync(more);
        Row(await Mine("health"), M4).GetProperty("percentComplete").GetInt32().ShouldBe(50);
    }

    [Fact]
    public async Task Sorting_and_paging_are_stable_and_validated()
    {
        Order(await Mine("health?sort=open")).ShouldBe([M1, M2, M4, M6]);
        Order(await Mine("health?sort=open&dir=asc")).ShouldBe([M6, M4, M2, M1]);
        Order(await Mine("health?sort=client")).ShouldBe([M1, M2, M6, M4]); // client 343 before 344, then by reference
        Order(await Mine("health?sort=flag")).ShouldBe([M1, M2, M6, M4]); // Red, Amber, then the two Green rows by client
        Order(await Mine("health?sort=nextDeadline&dir=desc")).ShouldBe([M4, M2, M1, M6]);

        var first = await Mine("health?sort=matter&pageSize=2");
        var second = await Mine("health?sort=matter&pageSize=2&page=2");
        first.GetProperty("total").GetInt32().ShouldBe(4);
        Order(first).Concat(Order(second)).ShouldBe([M1, M2, M6, M4]); // by matter reference: 00343-00012, -00013, -00017, then 00344-00015
        Order(second).Count.ShouldBe(2);
        Order(await Mine("health?pageSize=2&page=3")).ShouldBeEmpty();

        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/health?sort=nonsense"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/health?dir=sideways"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/health?pageSize=1000"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task The_row_query_lists_exactly_the_open_tasks_of_the_matter_and_roles_and_scope_apply()
    {
        var page = await Mine("health");
        foreach (var row in page.GetProperty("items").EnumerateArray())
        {
            (await TotalAsync(A, "task-queue", row.GetProperty("query").GetString()!)).ShouldBe(row.GetProperty("open").GetInt32());
            (await TotalAsync(A, "task-queue", row.GetProperty("query").GetString()! + "&overdue=true")).ShouldBe(row.GetProperty("overdue").GetInt32());
        }

        Order(await Mine("health?role=secondary")).ShouldBe([M2]);
        Order(await Mine("health?role=primary")).ShouldBe([M1, M4, M6]);
        Order(await Mine("health", B)).ShouldBe([M2, M4]);

        var all = await Mine("health?scope=all", Director);
        Order(all).ShouldContain(M3);
        Row(all, M3).GetProperty("flag").GetString().ShouldBe("RED"); // the unmanaged matter shows in the All scope only, with the same rule
        Order(await Mine($"health?scope=all&managerId={PmB}", Director)).ShouldBe([M2, M4]);
        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/health?scope=all"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
    }
}
