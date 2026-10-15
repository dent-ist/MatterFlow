using System.Net;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>GET /api/v1/dashboard/swimlane (epic #68, issue #71): lanes, the completed window in the viewer's zone, sorting, filters, group metadata, permissions.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class SwimlaneApiTests(SqlServerFixture sql)
{
    private Task<BoardData> DataAsync() => BoardData.GetAsync(sql);

    [Fact]
    public async Task Lanes_hold_open_tasks_and_recently_closed_ones_in_the_default_window()
    {
        var d = await DataAsync();

        var board = await d.GetAsync("/api/v1/dashboard/swimlane");

        board.GetProperty("lanes").EnumerateArray().Select(l => l.GetProperty("status").GetString()).ShouldBe(["NEW", "IN_PROGRESS", "ON_HOLD", "COMPLETED"]);
        d.Seeded(board, "NEW").ShouldBe(new[] { "sw-new-crit-asap", "sw-new-high-tomorrow", "sw-new-overdue", "sw-new-low-future", "sw-other-client" }, ignoreOrder: true);
        d.Seeded(board, "IN_PROGRESS").ShouldBe(new[] { "sw-prog", "sw-prog-a", "sw-prog-low" }, ignoreOrder: true);
        d.Seeded(board, "ON_HOLD").ShouldBe(["sw-hold"]);
        d.Seeded(board, "COMPLETED").ShouldBe(new[] { "sw-done-today", "sw-done-3d", "sw-cancelled" }, ignoreOrder: true);
        board.GetProperty("completedDays").GetInt32().ShouldBe(7);
        board.GetProperty("laneCap").GetInt32().ShouldBe(200);
        foreach (var lane in board.GetProperty("lanes").EnumerateArray())
        {
            lane.GetProperty("count").GetInt32().ShouldBe(lane.GetProperty("cards").GetArrayLength());
            lane.GetProperty("truncated").GetBoolean().ShouldBeFalse();
            lane.GetProperty("total").GetInt32().ShouldBe(lane.GetProperty("count").GetInt32());
        }
    }

    [Fact]
    public async Task The_completed_window_is_configurable_up_to_30_days()
    {
        var d = await DataAsync();

        d.Seeded(await d.GetAsync("/api/v1/dashboard/swimlane?completedDays=30"), "COMPLETED").ShouldContain("sw-done-10d");
        d.Seeded(await d.GetAsync("/api/v1/dashboard/swimlane?completedDays=2"), "COMPLETED").ShouldNotContain("sw-done-3d");
        d.Seeded(await d.GetAsync("/api/v1/dashboard/swimlane?completedDays=2"), "COMPLETED").ShouldContain("sw-done-today");
        (await d.H.Admin.GetAsync("/api/v1/dashboard/swimlane?completedDays=31")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await d.H.Admin.GetAsync("/api/v1/dashboard/swimlane?completedDays=0")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Theory]
    [InlineData("Pacific/Kiritimati")] // UTC+14
    [InlineData("Pacific/Pago_Pago")] // UTC-11
    [InlineData("America/New_York")]
    public async Task The_completed_window_starts_at_local_midnight_in_the_viewers_zone(string zoneId)
    {
        var d = await DataAsync();
        var zone = TimeZoneInfo.FindSystemTimeZoneById(zoneId);
        var localToday = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone));
        // Window of 2 days = yesterday and today in the viewer's zone: it starts at yesterday's local midnight.
        var startUtc = TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(localToday.AddDays(-1).ToDateTime(TimeOnly.MinValue), DateTimeKind.Unspecified), zone);
        await d.SetClosedAsync("sw-done-3d", "COMPLETED", startUtc.AddMinutes(1));
        await d.SetClosedAsync("sw-done-10d", "COMPLETED", startUtc.AddMinutes(-1));
        try
        {
            var board = await d.GetAsync("/api/v1/dashboard/swimlane?completedDays=2", timeZone: zoneId);

            board.GetProperty("timeZone").GetString().ShouldBe(zoneId);
            board.GetProperty("completedFrom").GetString().ShouldBe(localToday.AddDays(-1).ToString("yyyy-MM-dd"));
            d.Seeded(board, "COMPLETED").ShouldContain("sw-done-3d");
            d.Seeded(board, "COMPLETED").ShouldNotContain("sw-done-10d");
        }
        finally
        {
            await d.SetClosedAsync("sw-done-3d", "COMPLETED", DateTime.UtcNow.AddDays(-3));
            await d.SetClosedAsync("sw-done-10d", "COMPLETED", DateTime.UtcNow.AddDays(-10));
        }
    }

    [Fact]
    public async Task Cards_carry_priority_colour_assignee_availability_client_and_progress()
    {
        var d = await DataAsync();

        var board = await d.GetAsync("/api/v1/dashboard/swimlane");
        var card = BoardData.Lane(board, "IN_PROGRESS").GetProperty("cards").EnumerateArray().Single(c => c.GetProperty("title").GetString() == "sw-prog-a");

        card.GetProperty("taskId").GetInt64().ShouldBe(d.Id("sw-prog-a"));
        card.GetProperty("ref").GetString().ShouldStartWith("TSK-");
        card.GetProperty("status").GetString().ShouldBe("IN_PROGRESS");
        var priority = card.GetProperty("priority");
        priority.GetProperty("priorityId").GetInt32().ShouldBe(d.Critical);
        priority.GetProperty("label").GetString().ShouldBe("Critical");
        priority.GetProperty("color").GetString().ShouldBe("critical");
        priority.GetProperty("rank").GetInt32().ShouldBeGreaterThan(0);
        var assignee = card.GetProperty("assignee");
        assignee.GetProperty("userId").GetInt32().ShouldBe(d.TechA);
        assignee.GetProperty("availability").GetProperty("state").GetString().ShouldBe("OUT_OF_OFFICE");
        assignee.GetProperty("availability").GetProperty("note").GetString().ShouldBe("Conference");
        card.GetProperty("pod").GetProperty("podId").GetInt32().ShouldBe(d.PodA);
        card.GetProperty("clientId").GetInt32().ShouldBe(d.Client1Id);
        card.GetProperty("clientNumber").GetString().ShouldBe("00343");
        card.GetProperty("clientName").GetString().ShouldStartWith("Acme Corp");
        card.GetProperty("matterRef").GetString().ShouldBe("00343-00012");
        card.GetProperty("taskTypeName").GetString().ShouldBe("Data Processing");
        card.GetProperty("taskTypeIconKey").GetString().ShouldNotBeNullOrEmpty();
        card.GetProperty("isAsap").GetBoolean().ShouldBeTrue();
        card.GetProperty("isOverdue").GetBoolean().ShouldBeFalse();
        card.GetProperty("stepsTotal").GetInt32().ShouldBe(3);
        card.GetProperty("stepsResolved").GetInt32().ShouldBe(0);
        card.GetProperty("rowVersion").GetString().ShouldNotBeNullOrEmpty();

        var overdue = BoardData.Lane(board, "NEW").GetProperty("cards").EnumerateArray().Single(c => c.GetProperty("title").GetString() == "sw-new-overdue");
        overdue.GetProperty("isOverdue").GetBoolean().ShouldBeTrue();
        overdue.GetProperty("isAsap").GetBoolean().ShouldBeFalse();
        overdue.GetProperty("assignee").ValueKind.ShouldBe(JsonValueKind.Null);

        var done = BoardData.Lane(board, "COMPLETED").GetProperty("cards").EnumerateArray().Single(c => c.GetProperty("title").GetString() == "sw-done-today");
        done.GetProperty("stepsResolved").GetInt32().ShouldBe(done.GetProperty("stepsTotal").GetInt32());
        done.GetProperty("isOverdue").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task Cards_are_sorted_inside_each_lane()
    {
        var d = await DataAsync();

        // priority (default): rank, then ASAP above due dates, then due ascending, then oldest first.
        d.Seeded(await d.GetAsync("/api/v1/dashboard/swimlane"), "NEW")
            .ShouldBe(["sw-new-crit-asap", "sw-new-high-tomorrow", "sw-other-client", "sw-new-overdue", "sw-new-low-future"]);

        // due: ASAP first, then ascending explicit dates.
        var due = d.Seeded(await d.GetAsync("/api/v1/dashboard/swimlane?sort=due"), "NEW");
        due.First().ShouldBeOneOf("sw-new-crit-asap", "sw-other-client");
        due.IndexOf("sw-new-overdue").ShouldBeLessThan(due.IndexOf("sw-new-high-tomorrow"));
        due.IndexOf("sw-new-high-tomorrow").ShouldBeLessThan(due.IndexOf("sw-new-low-future"));

        // created: newest first.
        var created = d.Seeded(await d.GetAsync("/api/v1/dashboard/swimlane?sort=created"), "NEW");
        created.First().ShouldBe("sw-other-client");
        created.Last().ShouldBe("sw-new-crit-asap");

        // clientMatter: by client name, so the 343 client comes before the 500 client.
        var byClient = d.Seeded(await d.GetAsync("/api/v1/dashboard/swimlane?sort=clientMatter"), "NEW");
        byClient.Last().ShouldBe("sw-other-client");

        (await d.H.Admin.GetAsync("/api/v1/dashboard/swimlane?sort=bogus")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Group_metadata_gives_the_client_matter_tree_with_exact_counts()
    {
        var d = await DataAsync();

        var board = await d.GetAsync("/api/v1/dashboard/swimlane?groupBy=clientMatter");
        var groups = board.GetProperty("groups").EnumerateArray().ToList();

        board.GetProperty("groupBy").GetString().ShouldBe("clientMatter");
        var client1 = groups.Single(g => g.GetProperty("id").GetInt32() == d.Client1Id);
        client1.GetProperty("kind").GetString().ShouldBe("client");
        client1.GetProperty("clientNumber").GetString().ShouldBe("00343");
        var matters = client1.GetProperty("children").EnumerateArray().ToList();
        matters.Single().GetProperty("matterRef").GetString().ShouldBe("00343-00012");
        matters.Single().GetProperty("kind").GetString().ShouldBe("matter");
        client1.GetProperty("counts").GetProperty("new").GetInt32().ShouldBe(4);
        client1.GetProperty("counts").GetProperty("inProgress").GetInt32().ShouldBe(3);
        client1.GetProperty("counts").GetProperty("onHold").GetInt32().ShouldBe(1);
        client1.GetProperty("counts").GetProperty("completed").GetInt32().ShouldBe(3);
        client1.GetProperty("count").GetInt32().ShouldBe(11);
        matters.Single().GetProperty("count").GetInt32().ShouldBe(11);
        var client2 = groups.Single(g => g.GetProperty("id").GetInt32() == d.Client2Id);
        client2.GetProperty("count").GetInt32().ShouldBe(1);
        client2.GetProperty("children").EnumerateArray().Single().GetProperty("matterRef").GetString().ShouldBe("00500-00007");
    }

    [Fact]
    public async Task Group_metadata_for_priority_and_assignee()
    {
        var d = await DataAsync();

        var byPriority = (await d.GetAsync("/api/v1/dashboard/swimlane?groupBy=priority")).GetProperty("groups").EnumerateArray().ToList();
        byPriority.Select(g => g.GetProperty("rank").GetInt32()).ShouldBe(byPriority.Select(g => g.GetProperty("rank").GetInt32()).Order().ToList());
        var critical = byPriority.Single(g => g.GetProperty("id").GetInt32() == d.Critical);
        critical.GetProperty("color").GetString().ShouldBe("critical");
        critical.GetProperty("count").GetInt32().ShouldBe(3);

        var byAssignee = (await d.GetAsync("/api/v1/dashboard/swimlane?groupBy=assignee")).GetProperty("groups").EnumerateArray().ToList();
        byAssignee.Last().GetProperty("key").GetString().ShouldBe("assignee:unassigned");
        byAssignee.Single(g => g.GetProperty("key").GetString() == "assignee:" + d.TechB).GetProperty("count").GetInt32().ShouldBe(2);

        (await d.GetAsync("/api/v1/dashboard/swimlane")).GetProperty("groups").GetArrayLength().ShouldBe(0);
        (await d.H.Admin.GetAsync("/api/v1/dashboard/swimlane?groupBy=weird")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Filters_narrow_the_board()
    {
        var d = await DataAsync();

        d.Seeded(await d.GetAsync("/api/v1/dashboard/swimlane?assigneeId=unassigned"), "IN_PROGRESS").ShouldBeEmpty();
        d.Seeded(await d.GetAsync("/api/v1/dashboard/swimlane?assigneeId=unassigned"), "NEW").Count.ShouldBe(5);
        d.Seeded(await d.GetAsync($"/api/v1/dashboard/swimlane?assigneeId={d.TechB}"), "IN_PROGRESS").ShouldBe(new[] { "sw-prog", "sw-prog-low" }, ignoreOrder: true);
        d.Seeded(await d.GetAsync($"/api/v1/dashboard/swimlane?assigneeId={d.TechB}"), "NEW").ShouldBeEmpty();
        var pod = await d.GetAsync($"/api/v1/dashboard/swimlane?podId={d.PodA}");
        d.Seeded(pod, "NEW").ShouldBe(["sw-new-crit-asap"]);
        d.Seeded(pod, "IN_PROGRESS").ShouldBe(["sw-prog-a"]);
        var low = await d.GetAsync($"/api/v1/dashboard/swimlane?priorityId={d.Low}");
        d.Seeded(low, "NEW").ShouldBe(["sw-new-low-future"]);
        d.Seeded(low, "IN_PROGRESS").ShouldBe(["sw-prog-low"]);
        d.Seeded(await d.GetAsync($"/api/v1/dashboard/swimlane?taskTypeId={d.W.TaskTypeId}&q=crit-asap"), "NEW").ShouldBe(["sw-new-crit-asap"]);
        d.Seeded(await d.GetAsync("/api/v1/dashboard/swimlane?taskTypeId=999999"), "NEW").ShouldBeEmpty();

        var overdue = await d.GetAsync("/api/v1/dashboard/swimlane?overdueOnly=true");
        d.Seeded(overdue, "NEW").ShouldBe(["sw-new-overdue"]);
        d.Seeded(overdue, "ON_HOLD").ShouldBe(["sw-hold"]);
        d.Seeded(overdue, "IN_PROGRESS").ShouldBeEmpty();
        d.Seeded(overdue, "COMPLETED").ShouldBeEmpty();

        var mine = await d.GetAsync("/api/v1/dashboard/swimlane?mine=true", d.TechAClient);
        d.Seeded(mine, "NEW").ShouldBeEmpty();
        d.Seeded(mine, "IN_PROGRESS").ShouldBe(["sw-prog-a"]);
        d.Seeded(mine, "ON_HOLD").ShouldBe(["sw-hold"]);
        d.Seeded(mine, "COMPLETED").ShouldBe(["sw-done-3d"]);

        (await d.H.Admin.GetAsync("/api/v1/dashboard/swimlane?assigneeId=abc")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await d.H.Admin.GetAsync("/api/v1/dashboard/swimlane?nope=1")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task The_swimlane_needs_Dashboard_View_and_Dashboard_ViewSwimlane()
    {
        var d = await DataAsync();

        (await d.NoDashboardClient.GetAsync("/api/v1/dashboard/swimlane")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await d.TechAClient.GetAsync("/api/v1/dashboard/swimlane")).StatusCode.ShouldBe(HttpStatusCode.OK);
    }
}
