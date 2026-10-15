using System.Net;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>GET /api/v1/dashboard/workload (epic #68, issue #71): who can hold work, open counts per priority, availability, load levels, filters, permissions.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class WorkloadApiTests(SqlServerFixture sql)
{
    private Task<BoardData> DataAsync() => BoardData.GetAsync(sql);

    private static JsonElement UserOf(JsonElement board, int userId) =>
        board.GetProperty("users").EnumerateArray().Single(u => u.GetProperty("userId").GetInt32() == userId);

    private static List<int> Ids(JsonElement board) => [.. board.GetProperty("users").EnumerateArray().Select(u => u.GetProperty("userId").GetInt32())];

    [Fact]
    public async Task Only_active_users_who_can_hold_work_are_listed_available_first_then_lighter_load()
    {
        var d = await DataAsync();

        var board = await d.GetAsync("/api/v1/dashboard/workload");

        // Everyone active with a role is listed (the admin, the pre-provisioned Director and Data Scientist, tech A and B); pending and inactive users are not.
        var ids = Ids(board);
        ids.Count.ShouldBe(5);
        ids.Take(3).ShouldBe([d.Admin, d.Director, d.Scientist], ignoreOrder: true); // idle people first
        ids.Skip(3).ShouldBe([d.TechB, d.TechA]); // then lighter load; out of office last
        Ids(board).ShouldNotContain(d.Pending);
        Ids(board).ShouldNotContain(d.Inactive);
        var summary = board.GetProperty("summary");
        summary.GetProperty("available").GetInt32().ShouldBe(3);
        summary.GetProperty("busy").GetInt32().ShouldBe(1);
        summary.GetProperty("outOfOffice").GetInt32().ShouldBe(1);
        summary.GetProperty("unassignedTasks").GetInt32().ShouldBe(5);
        summary.GetProperty("total").GetInt32().ShouldBe(5);
        board.GetProperty("thresholds").GetProperty("lightMax").GetInt32().ShouldBe(3);
        board.GetProperty("thresholds").GetProperty("normalMax").GetInt32().ShouldBe(8);
    }

    [Fact]
    public async Task Counts_per_priority_follow_the_priority_rank_and_agree_with_the_task_queue()
    {
        var d = await DataAsync();

        var board = await d.GetAsync("/api/v1/dashboard/workload");
        var legend = board.GetProperty("priorities").EnumerateArray().ToList();
        legend.Select(p => p.GetProperty("rank").GetInt32()).ShouldBe(legend.Select(p => p.GetProperty("rank").GetInt32()).Order().ToList());
        legend.Select(p => p.GetProperty("label").GetString()).ShouldBe(["Critical", "High", "Normal", "Low"], ignoreOrder: true);
        legend.Single(p => p.GetProperty("priorityId").GetInt32() == d.Critical).GetProperty("color").GetString().ShouldBe("critical");

        var techA = UserOf(board, d.TechA);
        techA.GetProperty("byPriority").EnumerateArray().Select(c => c.GetProperty("priorityId").GetInt32()).ShouldBe(legend.Select(p => p.GetProperty("priorityId").GetInt32()).ToList());
        int CountOf(JsonElement user, int priorityId) => user.GetProperty("byPriority").EnumerateArray().Single(c => c.GetProperty("priorityId").GetInt32() == priorityId).GetProperty("count").GetInt32();
        CountOf(techA, d.Critical).ShouldBe(2);
        CountOf(techA, d.Low).ShouldBe(0);
        techA.GetProperty("openTotal").GetInt32().ShouldBe(2);
        techA.GetProperty("overdue").GetInt32().ShouldBe(1);
        techA.GetProperty("onHold").GetInt32().ShouldBe(1);
        techA.GetProperty("topPriority").GetProperty("priorityId").GetInt32().ShouldBe(d.Critical);
        techA.GetProperty("topPriority").GetProperty("count").GetInt32().ShouldBe(2);
        techA.GetProperty("loadLevel").GetString().ShouldBe("LIGHT");

        var techB = UserOf(board, d.TechB);
        CountOf(techB, d.High).ShouldBe(1);
        CountOf(techB, d.Low).ShouldBe(1);
        techB.GetProperty("topPriority").GetProperty("priorityId").GetInt32().ShouldBe(d.High);
        techB.GetProperty("overdue").GetInt32().ShouldBe(0);
        techB.GetProperty("dueSoon").GetInt32().ShouldBe(1);
        techB.GetProperty("nextDue").GetProperty("taskId").GetInt64().ShouldBe(d.Id("sw-prog"));
        techB.GetProperty("nextDue").GetProperty("isOverdue").GetBoolean().ShouldBeFalse();

        var idle = UserOf(board, d.Admin);
        idle.GetProperty("openTotal").GetInt32().ShouldBe(0);
        idle.GetProperty("loadLevel").GetString().ShouldBe("IDLE");
        idle.GetProperty("topPriority").ValueKind.ShouldBe(JsonValueKind.Null);
        idle.GetProperty("nextDue").ValueKind.ShouldBe(JsonValueKind.Null);

        // The numbers agree with the Task Queue the user lands on.
        foreach (var (id, user) in new[] { (d.TechA, techA), (d.TechB, techB) })
        {
            var open = await d.GetAsync($"/api/v1/task-queue?pageSize=1&status=NEW&status=IN_PROGRESS&status=ON_HOLD&assignee={id}");
            open.GetProperty("total").GetInt32().ShouldBe(user.GetProperty("openTotal").GetInt32());
            var overdue = await d.GetAsync($"/api/v1/task-queue?pageSize=1&status=NEW&status=IN_PROGRESS&status=ON_HOLD&overdue=true&assignee={id}");
            overdue.GetProperty("total").GetInt32().ShouldBe(user.GetProperty("overdue").GetInt32());
            var soon = await d.GetAsync($"/api/v1/task-queue?pageSize=1&status=NEW&status=IN_PROGRESS&status=ON_HOLD&asap=false&overdue=false&dueTo={DateOnly.FromDateTime(DateTime.UtcNow).AddDays(3):yyyy-MM-dd}&assignee={id}");
            soon.GetProperty("total").GetInt32().ShouldBe(user.GetProperty("dueSoon").GetInt32());
        }
    }

    [Fact]
    public async Task People_carry_initials_pods_and_availability_from_the_evaluator()
    {
        var d = await DataAsync();

        var board = await d.GetAsync("/api/v1/dashboard/workload");
        var techA = UserOf(board, d.TechA);

        techA.GetProperty("displayName").GetString().ShouldBe(@"KE\techa");
        techA.GetProperty("initials").GetString().ShouldBe("TE");
        techA.GetProperty("pods").EnumerateArray().Single().GetProperty("name").GetString().ShouldBe("Board Pod A");
        var availability = techA.GetProperty("availability");
        availability.GetProperty("state").GetString().ShouldBe("OUT_OF_OFFICE");
        availability.GetProperty("note").GetString().ShouldBe("Conference");
        availability.GetProperty("outUntil").GetDateTime().Year.ShouldBeGreaterThanOrEqualTo(2099);
        UserOf(board, d.TechB).GetProperty("availability").GetProperty("state").GetString().ShouldBeOneOf("AVAILABLE", "OFF_HOURS");
        // Operational counts only: exactly these fields, no completion statistics, speed or ranking of people.
        techA.EnumerateObject().Select(p => p.Name).Order().ShouldBe(
            ["availability", "byPriority", "displayName", "dueSoon", "initials", "loadLevel", "nextDue", "onHold", "openTotal", "overdue", "pods", "topPriority", "userId"]);
    }

    [Fact]
    public async Task Filters_by_pod_availability_and_name()
    {
        var d = await DataAsync();

        Ids(await d.GetAsync("/api/v1/dashboard/workload?availability=out")).ShouldBe([d.TechA]);
        var available = Ids(await d.GetAsync("/api/v1/dashboard/workload?availability=available"));
        available.Count.ShouldBe(4);
        available.ShouldNotContain(d.TechA);
        available.Last().ShouldBe(d.TechB);
        Ids(await d.GetAsync("/api/v1/dashboard/workload?q=techb")).ShouldBe([d.TechB]);
        Ids(await d.GetAsync("/api/v1/dashboard/workload?q=nobody")).ShouldBeEmpty();
        var pod = await d.GetAsync($"/api/v1/dashboard/workload?podId={d.PodA}");
        Ids(pod).ShouldBe([d.TechB, d.TechA]);
        pod.GetProperty("summary").GetProperty("total").GetInt32().ShouldBe(2);

        // The summary stays the team's totals while the list is narrowed by availability.
        (await d.GetAsync("/api/v1/dashboard/workload?availability=out")).GetProperty("summary").GetProperty("total").GetInt32().ShouldBe(5);
        (await d.H.Admin.GetAsync("/api/v1/dashboard/workload?availability=maybe")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await d.H.Admin.GetAsync("/api/v1/dashboard/workload?bogus=1")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Load_levels_follow_the_configured_thresholds()
    {
        var d = await DataAsync();
        using var tight = d.H.Factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Dashboard:Workload:LightMax", "1");
            b.UseSetting("Dashboard:Workload:NormalMax", "1");
        });
        var client = tight.CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);

        var board = await OkAsync(await client.GetAsync("/api/v1/dashboard/workload"));

        board.GetProperty("thresholds").GetProperty("lightMax").GetInt32().ShouldBe(1);
        UserOf(board, d.TechB).GetProperty("loadLevel").GetString().ShouldBe("HEAVY");
        UserOf(board, d.Admin).GetProperty("loadLevel").GetString().ShouldBe("IDLE");
    }

    [Fact]
    public async Task The_workload_needs_Dashboard_View_and_Dashboard_ViewUsers()
    {
        var d = await DataAsync();

        (await d.NoDashboardClient.GetAsync("/api/v1/dashboard/workload")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await d.TechAClient.GetAsync("/api/v1/dashboard/workload")).StatusCode.ShouldBe(HttpStatusCode.OK);
    }
}
