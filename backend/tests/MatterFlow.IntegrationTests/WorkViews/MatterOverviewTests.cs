using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// GET /matters/{id}/overview (epic #758, PX-11, #769): one call with the header, tasks by status, the next five deadlines, the people, the assets, the last events and the health
/// flag with reasons in words. Every count opens the list it counts; a section the caller may not use is null; a matter the caller may not see is a 404; no manager is not a warning.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class MatterOverviewTests(SqlServerFixture sql) : MyMattersTestBase(sql)
{
    private Task<JsonElement> Overview(int matterId, HttpClient? client = null) => GetAsync(client ?? A, $"/api/v1/matters/{matterId}/overview");

    private async Task<int> CreateAssetsAsync(int matterId, params string[] names)
    {
        var type = await OkAsync(await H.Admin.PostAsJsonAsync("/api/v1/asset-types", new { name = "Laptop" }), HttpStatusCode.Created);
        var typeId = type.GetProperty("assetTypeId").GetInt32();
        foreach (var name in names)
            await OkAsync(await H.Admin.PostAsJsonAsync("/api/v1/assets", new { matterId, assetTypeId = typeId, displayName = name }), HttpStatusCode.Created);
        return typeId;
    }

    [Fact]
    public async Task The_overview_has_the_header_the_counts_the_health_and_every_count_opens_the_list_it_counts()
    {
        var o = await Overview(M1);
        o.GetProperty("matter").GetProperty("matterId").GetInt32().ShouldBe(M1);
        o.GetProperty("matter").GetProperty("isActive").GetBoolean().ShouldBeTrue();
        o.GetProperty("matter").GetProperty("primaryManager").GetProperty("userId").GetInt32().ShouldBe(PmA);
        o.GetProperty("matter").GetProperty("secondaryManager").ValueKind.ShouldBe(JsonValueKind.Null);

        // M1: m1-soon (due in 2 days), m1-overdue, m1-asap are New; m1-hold has been on hold for ten days. Nobody is assigned.
        var counts = o.GetProperty("taskCounts");
        counts.GetProperty("new").GetInt32().ShouldBe(3);
        counts.GetProperty("inProgress").GetInt32().ShouldBe(0);
        counts.GetProperty("onHold").GetInt32().ShouldBe(1);
        counts.GetProperty("completed").GetInt32().ShouldBe(0);
        counts.GetProperty("open").GetInt32().ShouldBe(4);
        foreach (var (count, query) in new[] { ("new", "newQuery"), ("inProgress", "inProgressQuery"), ("onHold", "onHoldQuery"), ("completed", "completedQuery"), ("open", "openQuery") })
            (await TotalAsync(A, "task-queue", counts.GetProperty(query).GetString()!)).ShouldBe(counts.GetProperty(count).GetInt32(), count);

        var health = o.GetProperty("health");
        health.GetProperty("flag").GetString().ShouldBe("RED");
        var reasons = health.GetProperty("reasons").EnumerateArray().ToList();
        reasons.Select(r => r.GetProperty("code").GetString()).ShouldBe(["OVERDUE", "UNASSIGNED", "DUE_SOON", "LONG_HOLD"]);
        reasons.Select(r => r.GetProperty("count").GetInt32()).ShouldBe([1, 4, 1, 1]);
        foreach (var r in reasons.Take(3))
            (await TotalAsync(A, "task-queue", r.GetProperty("query").GetString()!)).ShouldBe(r.GetProperty("count").GetInt32(), r.GetProperty("code").GetString());

        // PM v2 (#882): the open tasks by task type and the tasks on hold by reason; each row's query lists exactly the tasks it counts.
        var types = o.GetProperty("types").EnumerateArray().ToList();
        types.Sum(t => t.GetProperty("open").GetInt32()).ShouldBe(counts.GetProperty("open").GetInt32());
        types.Sum(t => t.GetProperty("overdue").GetInt32()).ShouldBe(1);
        foreach (var t in types)
        {
            t.GetProperty("name").GetString().ShouldNotBeNullOrWhiteSpace();
            (await TotalAsync(A, "task-queue", t.GetProperty("query").GetString()!)).ShouldBe(t.GetProperty("open").GetInt32(), "type " + t.GetProperty("name").GetString());
            (await TotalAsync(A, "task-queue", t.GetProperty("overdueQuery").GetString()!)).ShouldBe(t.GetProperty("overdue").GetInt32(), "overdue of " + t.GetProperty("name").GetString());
        }

        var holds = o.GetProperty("holdReasons").EnumerateArray().ToList();
        holds.Sum(h => h.GetProperty("count").GetInt32()).ShouldBe(counts.GetProperty("onHold").GetInt32());
        foreach (var h in holds)
        {
            h.GetProperty("oldestDays").GetInt32().ShouldBeGreaterThanOrEqualTo(0);
            (await TotalAsync(A, "task-queue", h.GetProperty("query").GetString()!)).ShouldBe(h.GetProperty("count").GetInt32(), "hold reason " + h.GetProperty("name").GetString());
        }

        // The same flag and reasons as the health table of My Matters.
        var row = (await Mine($"health?pageSize=100")).GetProperty("items").EnumerateArray().Single(i => i.GetProperty("matterId").GetInt32() == M1);
        row.GetProperty("flag").GetString().ShouldBe("RED");
        row.GetProperty("flagReasons").EnumerateArray().Select(r => r.GetString()).ShouldBe(reasons.Select(r => r.GetProperty("code").GetString()));
        row.GetProperty("open").GetInt32().ShouldBe(counts.GetProperty("open").GetInt32());

        // Deadlines: open, not overdue, with a date: only m1-soon. The overdue one and the ASAP one are not deadlines to come.
        var deadlines = o.GetProperty("deadlines");
        deadlines.GetProperty("total").GetInt32().ShouldBe(1);
        Titles(deadlines.GetProperty("items")).ShouldBe(["m1-soon"]);
        (await TotalAsync(A, "task-queue", deadlines.GetProperty("query").GetString()!)).ShouldBe(1);

        // People: nobody is assigned; the four open tasks are counted as unassigned.
        o.GetProperty("people").GetProperty("total").GetInt32().ShouldBe(0);
        o.GetProperty("people").GetProperty("unassignedOpen").GetInt32().ShouldBe(4);

        // The manager of the project manager (A has no Asset.View): the assets section is absent, not empty.
        o.GetProperty("assets").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task The_next_five_deadlines_are_the_soonest_and_people_carry_their_open_work_and_away_window()
    {
        for (var day = 1; day <= 7; day++)
            await MakeAsync("dl-" + day, M2, new() { ["dueDate"] = In(day + 2), ["assignedPodId"] = PodX, ["assignedUserId"] = Tech });
        await H.ExecuteAsync($"UPDATE dbo.Task SET AssignedUserId = {PmB} WHERE Title IN ('dl-6', 'dl-7')");
        await MakeAsync("tech-late", M2, new() { ["dueDate"] = "2000-01-01", ["assignedPodId"] = PodX, ["assignedUserId"] = Tech });
        var own = await OkAsync(await TechClient.GetAsync("/api/v1/me/availability"));
        await OkAsync(await TechClient.PutAsJsonAsync("/api/v1/me/availability", new { status = "OUT_OF_OFFICE", from = In(5), until = In(9), note = "Private reason", rowVersion = own.GetProperty("rowVersion").GetString() }));
        H.Factory.InvalidateAll();

        var o = await Overview(M2);
        var deadlines = o.GetProperty("deadlines");
        deadlines.GetProperty("total").GetInt32().ShouldBe(9); // seven new ones, plus m2-in5 (in 5 days) and m2-far (2099); the late one is overdue and m2-hold is ASAP
        Titles(deadlines.GetProperty("items")).Count.ShouldBe(5);
        var dates = deadlines.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("dueDate").GetString()!).ToList();
        dates.ShouldBe([.. dates.Order()]);
        dates[0].ShouldBe(In(3));

        var people = o.GetProperty("people");
        people.GetProperty("total").GetInt32().ShouldBe(2);
        var items = people.GetProperty("items").EnumerateArray().ToList();
        items[0].GetProperty("userId").GetInt32().ShouldBe(Tech); // six open tasks (five dated, one late) against two
        items[0].GetProperty("open").GetInt32().ShouldBe(6);
        items[0].GetProperty("overdue").GetInt32().ShouldBe(1);
        items[0].GetProperty("away").GetProperty("from").GetString().ShouldBe(In(5));
        items[0].GetProperty("away").GetProperty("reasonCode").GetString().ShouldBe("OUT_OF_OFFICE");
        items[1].GetProperty("away").ValueKind.ShouldBe(JsonValueKind.Null);
        foreach (var p in items)
            (await TotalAsync(A, "task-queue", p.GetProperty("query").GetString()!)).ShouldBe(p.GetProperty("open").GetInt32());
        (await A.GetStringAsync($"/api/v1/matters/{M2}/overview")).ShouldNotContain("Private reason");
    }

    [Fact]
    public async Task Assets_are_counted_with_the_first_five_by_name_for_a_caller_who_may_view_assets()
    {
        await CreateAssetsAsync(M1, "G", "B", "A", "F", "D", "C", "E");
        var admin = await Overview(M1, H.Admin);
        var assets = admin.GetProperty("assets");
        assets.GetProperty("total").GetInt32().ShouldBe(7);
        assets.GetProperty("items").EnumerateArray().Select(a => a.GetProperty("displayName").GetString()).ShouldBe(["A", "B", "C", "D", "E"]);
        assets.GetProperty("items")[0].GetProperty("assetTypeName").GetString().ShouldBe("Laptop");

        (await Overview(M1)).GetProperty("assets").ValueKind.ShouldBe(JsonValueKind.Null);
        (await Overview(M6, H.Admin)).GetProperty("assets").GetProperty("total").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task A_caller_without_task_view_gets_the_header_only_and_a_caller_without_matter_view_is_refused()
    {
        var matterOnly = await H.UserWithAsync(@"KE\matteronly", "Matter.View");
        var o = await Overview(M1, matterOnly);
        o.GetProperty("matter").GetProperty("matterRef").GetString().ShouldNotBeNullOrEmpty();
        foreach (var section in new[] { "taskCounts", "deadlines", "people", "activity", "health" })
            o.GetProperty(section).ValueKind.ShouldBe(JsonValueKind.Null, section);

        var taskOnly = await H.UserWithAsync(@"KE\taskonly", "Task.View");
        (await taskOnly.GetAsync($"/api/v1/matters/{M1}/overview")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await H.Admin.GetAsync("/api/v1/matters/999999/overview")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task A_matter_nobody_manages_an_empty_matter_and_an_inactive_matter_are_normal_and_never_a_warning()
    {
        var m3 = await Overview(M3, Observer);
        m3.GetProperty("matter").GetProperty("primaryManager").ValueKind.ShouldBe(JsonValueKind.Null);
        m3.GetProperty("matter").GetProperty("secondaryManager").ValueKind.ShouldBe(JsonValueKind.Null);
        m3.GetProperty("health").GetProperty("flag").GetString().ShouldBe("RED"); // its one task is overdue; the missing manager adds nothing
        m3.GetProperty("health").GetProperty("reasons").EnumerateArray().Select(r => r.GetProperty("code").GetString()).ShouldBe(["OVERDUE", "UNASSIGNED"]);
        m3.GetRawText().ToLowerInvariant().ShouldNotContain("warning");

        var empty = await Overview(M6);
        empty.GetProperty("health").GetProperty("flag").GetString().ShouldBe("GREEN");
        empty.GetProperty("health").GetProperty("reasons").EnumerateArray().Select(r => r.GetProperty("code").GetString()).ShouldBe(["NO_OPEN_TASKS"]);
        empty.GetProperty("taskCounts").GetProperty("open").GetInt32().ShouldBe(0);
        empty.GetProperty("deadlines").GetProperty("items").GetArrayLength().ShouldBe(0);
        empty.GetProperty("people").GetProperty("items").GetArrayLength().ShouldBe(0);

        var inactive = await Overview(M5);
        inactive.GetProperty("matter").GetProperty("isActive").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task Completed_counts_the_last_thirty_days_and_the_activity_is_the_latest_ten_events_without_touching_the_marker()
    {
        await H.CompleteAsync(await H.GetTaskAsync(Ids["m2-in5"]));
        for (var i = 0; i < 4; i++)
            await MakeAsync("m2-extra-" + i, M2, new() { ["dueDate"] = In(12 + i) });
        var old = await MakeAsync("m2-old", M2, new() { ["dueDate"] = In(9) });
        await H.CompleteAsync(old);
        await H.ExecuteAsync($"UPDATE dbo.Task SET StatusChangedAt = DATEADD(day, -45, SYSUTCDATETIME()), CompletedAt = DATEADD(day, -45, SYSUTCDATETIME()) WHERE TaskId = {Ids["m2-old"]}");
        H.Factory.InvalidateAll();

        var o = await Overview(M2);
        o.GetProperty("taskCounts").GetProperty("completed").GetInt32().ShouldBe(1);
        (await TotalAsync(A, "task-queue", o.GetProperty("taskCounts").GetProperty("completedQuery").GetString()!)).ShouldBe(1);

        var activity = o.GetProperty("activity").EnumerateArray().ToList();
        activity.Count.ShouldBe(10);
        var ids = activity.Select(a => a.GetProperty("eventId").GetInt64()).ToList();
        ids.ShouldBe([.. ids.OrderDescending()]);
        activity.ShouldAllBe(a => a.GetProperty("matterId").GetInt32() == M2);
        activity.ShouldAllBe(a => !a.GetProperty("isUnread").GetBoolean());

        // The overview is a plain read: it neither creates nor moves the unread marker.
        (await H.ScalarLongAsync($"SELECT CAST((SELECT COUNT(*) FROM dbo.UserMatterActivitySeen WHERE UserId = {PmA}) AS BIGINT) AS [Value]")).ShouldBe(0);
    }
}
