using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// GET /my-matters/since-last-visit (epic #758, PX-10, #768): counts since the person's marker (or the last 7 days without one), the links that open the same lists, up to five
/// most important items with overdue first, and the rule that only an explicit "Mark as read" moves the marker. Comment text never appears.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class MyMattersSinceLastVisitTests(SqlServerFixture sql) : MyMattersTestBase(sql)
{
    private static JsonElement Count(JsonElement answer, string name) => answer.GetProperty("counts").GetProperty(name);

    private async Task<long> MarkerAsync() =>
        await H.ScalarLongAsync($"SELECT CAST(ISNULL((SELECT SeenAuditEventId FROM dbo.UserMatterActivitySeen WHERE UserId = {PmA}), -1) AS BIGINT) AS [Value]");

    private async Task SetMarkerTimeAsync(int daysAgo) =>
        await H.ExecuteAsync($"UPDATE dbo.UserMatterActivitySeen SET SeenAtUtc = DATEADD(day, -{daysAgo}, '{ViewerDay.Now:yyyy-MM-ddTHH:mm:ss}') WHERE UserId = {PmA}");

    [Fact]
    public async Task Without_a_marker_the_last_seven_days_count_and_the_call_neither_creates_nor_moves_a_marker()
    {
        var answer = await Mine("since-last-visit");
        answer.GetProperty("hasMarker").GetBoolean().ShouldBeFalse();
        answer.GetProperty("seenEventId").GetInt64().ShouldBe(0);
        DateTime.Parse(answer.GetProperty("sinceUtc").GetString()!).ShouldBeInRange(ViewerDay.Now.AddDays(-7).AddMinutes(-5), ViewerDay.Now.AddDays(-7).AddMinutes(5));

        // The seeded tasks of A's matters (M1: four, M2: three, M4: one; M3 belongs to nobody) were created by the administrator, in the period.
        Count(answer, "newTasks").GetProperty("count").GetInt32().ShouldBe(8);
        Count(answer, "putOnHold").GetProperty("count").GetInt32().ShouldBe(2);
        Count(answer, "becameOverdue").GetProperty("count").GetInt32().ShouldBe(0); // m1-overdue fell due in 2000, long before the period
        answer.GetProperty("counts").EnumerateObject().Select(p => p.Name).Order().ShouldBe(["becameOverdue", "comments", "completed", "newTasks", "newUnassigned", "putOnHold", "reassigned"]);

        // New unassigned (issue #909): the open unassigned tasks created in the period (M1: four, M2: three; m4-ok is assigned); the link opens exactly those.
        var newUnassigned = Count(answer, "newUnassigned");
        newUnassigned.GetProperty("count").GetInt32().ShouldBe(7);
        newUnassigned.GetProperty("target").GetString().ShouldBe("taskQueue");
        newUnassigned.GetProperty("query").GetString()!.ShouldContain("unassigned=true");
        (await TotalAsync(A, "task-queue", newUnassigned.GetProperty("query").GetString()!)).ShouldBe(7);

        // Asking again changes nothing, and no marker row appeared (the activity list creates it, this summary does not).
        await Mine("since-last-visit");
        (await MarkerAsync()).ShouldBe(-1);
        Count(answer, "newTasks").GetProperty("target").GetString().ShouldBe("activity");
        Count(answer, "newTasks").GetProperty("query").GetString().ShouldStartWith("kind=TASK_CREATED&from=");
    }

    [Fact]
    public async Task Reading_the_activity_creates_a_starting_point_that_does_not_hide_the_period_until_Mark_as_read()
    {
        var before = await Mine("since-last-visit");
        before.GetProperty("hasMarker").GetBoolean().ShouldBeFalse();
        var newTasks = Count(before, "newTasks").GetProperty("count").GetInt32();
        newTasks.ShouldBeGreaterThan(0);

        // The Activity tab (and the Recent activity panel) read the list: that creates the starting point of the unread dots, flagged initial.
        await Mine("activity");
        (await MarkerAsync()).ShouldBeGreaterThan(0);
        (await H.ScalarLongAsync($"SELECT CAST(IsInitial AS BIGINT) AS [Value] FROM dbo.UserMatterActivitySeen WHERE UserId = {PmA}")).ShouldBe(1);

        var after = await Mine("since-last-visit");
        after.GetProperty("hasMarker").GetBoolean().ShouldBeFalse();
        after.GetProperty("seenEventId").GetInt64().ShouldBe(0);
        Count(after, "newTasks").GetProperty("count").GetInt32().ShouldBe(newTasks);
        Count(after, "newTasks").GetProperty("query").GetString().ShouldStartWith("kind=TASK_CREATED&from=");

        // Mark as read is the only thing that moves it: afterwards nothing has changed.
        await OkAsync(await A.PostAsJsonAsync("/api/v1/my-matters/activity/seen", new { }));
        (await H.ScalarLongAsync($"SELECT CAST(IsInitial AS BIGINT) AS [Value] FROM dbo.UserMatterActivitySeen WHERE UserId = {PmA}")).ShouldBe(0);
        var marked = await Mine("since-last-visit");
        marked.GetProperty("hasMarker").GetBoolean().ShouldBeTrue();
        Count(marked, "newTasks").GetProperty("count").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task With_a_marker_the_counts_are_what_happened_after_it_and_the_links_open_the_same_lists()
    {
        await Mine("activity"); // first visit: the starting point is created at the newest event (it is not a "last visit")
        (await MarkerAsync()).ShouldBeGreaterThan(0);
        await OkAsync(await A.PostAsJsonAsync("/api/v1/my-matters/activity/seen", new { })); // Mark as read: now it is
        var marker = await MarkerAsync();
        marker.ShouldBeGreaterThan(0);

        await MakeAsync("new-1", M1, new() { ["dueDate"] = "2099-03-01" });
        await MakeAsync("new-2", M2, new() { ["dueDate"] = "2099-03-02" });
        await H.StatusAsync(await H.GetTaskAsync(Ids["m2-far"]), "ON_HOLD", "Waiting for a decision");
        await H.StatusAsync(await H.GetTaskAsync(Ids["m1-soon"]), "IN_PROGRESS");
        await H.CompleteAsync(await H.GetTaskAsync(Ids["m2-in5"]));
        await OkAsync(await H.Admin.PostAsJsonAsync($"/api/v1/tasks/{Ids["m1-asap"]}/comments", new { bodyHtml = "<p>SECRET-PRIVILEGED-TEXT</p>" }), HttpStatusCode.Created);
        // m1-soon fell due yesterday, after the marker was set two days ago: it became overdue during the period.
        var yesterday = ViewerDay.Today().AddDays(-1); // the viewer's day (New York), not the UTC day
        await H.ExecuteAsync($"UPDATE dbo.Task SET DueDate = '{yesterday:yyyy-MM-dd}', DueSortKey = '{yesterday:yyyy-MM-dd} 23:59:59' WHERE TaskId = {Ids["m1-soon"]}");
        await SetMarkerTimeAsync(2);

        var answer = await Mine("since-last-visit");
        answer.GetProperty("hasMarker").GetBoolean().ShouldBeTrue();
        answer.GetProperty("seenEventId").GetInt64().ShouldBe(marker);
        Count(answer, "newTasks").GetProperty("count").GetInt32().ShouldBe(2);
        Count(answer, "putOnHold").GetProperty("count").GetInt32().ShouldBe(1);
        Count(answer, "completed").GetProperty("count").GetInt32().ShouldBe(1);
        Count(answer, "comments").GetProperty("count").GetInt32().ShouldBe(1);
        Count(answer, "becameOverdue").GetProperty("count").GetInt32().ShouldBe(1);
        answer.GetRawText().ShouldNotContain("SECRET-PRIVILEGED-TEXT");

        // Each activity count opens exactly the events it counted; the overdue count opens the Task Queue.
        foreach (var (name, expected) in new[] { ("newTasks", 2), ("putOnHold", 1), ("completed", 1), ("comments", 1), ("reassigned", Count(answer, "reassigned").GetProperty("count").GetInt32()) })
        {
            var c = Count(answer, name);
            c.GetProperty("target").GetString().ShouldBe("activity");
            var list = await Mine("activity?take=100&" + c.GetProperty("query").GetString());
            list.GetProperty("items").GetArrayLength().ShouldBe(expected, name);
        }

        var overdue = Count(answer, "becameOverdue");
        overdue.GetProperty("target").GetString().ShouldBe("taskQueue");
        (await TotalAsync(A, "task-queue", overdue.GetProperty("query").GetString()!)).ShouldBe(1);

        // New unassigned follows the period's time (the test moved the marker's time back two days, so the seeded tasks are in it too): six seeded open tasks nobody holds
        // (m2-in5 is completed, m4-ok is assigned) and the two new ones; the link lists them.
        var unassigned = Count(answer, "newUnassigned");
        unassigned.GetProperty("count").GetInt32().ShouldBe(8);
        (await TotalAsync(A, "task-queue", unassigned.GetProperty("query").GetString()!)).ShouldBe(8);

        // The items: the task that became overdue first, then the newest hold / reassignment.
        var items = answer.GetProperty("items").EnumerateArray().ToList();
        items.Count.ShouldBeLessThanOrEqualTo(5);
        items[0].GetProperty("kind").GetString().ShouldBe("BECAME_OVERDUE");
        items[0].GetProperty("task").GetProperty("title").GetString().ShouldBe("m1-soon");
        items[0].GetProperty("task").GetProperty("factCode").GetString().ShouldBe("OVERDUE");
        items[0].GetProperty("event").ValueKind.ShouldBe(JsonValueKind.Null);
        items.Skip(1).ShouldAllBe(i => i.GetProperty("task").ValueKind == JsonValueKind.Null && (i.GetProperty("kind").GetString() == "ON_HOLD" || i.GetProperty("kind").GetString() == "REASSIGNED"));
        items.Any(i => i.GetProperty("kind").GetString() == "ON_HOLD" && i.GetProperty("event").GetProperty("taskTitle").GetString() == "m2-far").ShouldBeTrue();

        // Opening the page, however often, does not move the marker; only Mark as read does, and then nothing is new.
        await Mine("since-last-visit");
        (await MarkerAsync()).ShouldBe(marker);
        await OkAsync(await A.PostAsJsonAsync("/api/v1/my-matters/activity/seen", new { }));
        var after = await Mine("since-last-visit");
        after.GetProperty("counts").EnumerateObject().ShouldAllBe(p => p.Value.GetProperty("count").GetInt32() == 0);
        after.GetProperty("items").GetArrayLength().ShouldBe(0);
        after.GetProperty("seenEventId").GetInt64().ShouldBeGreaterThan(marker);
    }

    [Fact]
    public async Task At_most_five_items_overdue_first_and_the_scope_and_permissions_are_those_of_My_Matters()
    {
        await Mine("activity");
        for (var i = 0; i < 7; i++)
        {
            await MakeAsync($"late-{i}", M6, new() { ["dueDate"] = "2099-01-01" });
        }

        var yesterday = ViewerDay.Today().AddDays(-1); // the viewer's day (New York), not the UTC day
        await H.ExecuteAsync($"UPDATE dbo.Task SET DueDate = '{yesterday:yyyy-MM-dd}', DueSortKey = '{yesterday:yyyy-MM-dd} 23:59:59' WHERE Title LIKE 'late-%'");
        await SetMarkerTimeAsync(3);

        var answer = await Mine("since-last-visit");
        Count(answer, "becameOverdue").GetProperty("count").GetInt32().ShouldBe(7);
        var items = answer.GetProperty("items").EnumerateArray().ToList();
        items.Count.ShouldBe(5);
        items.ShouldAllBe(i => i.GetProperty("kind").GetString() == "BECAME_OVERDUE");

        // B manages other matters and never saw those: B has no marker, the last seven days, and not A's matter M6.
        var b = await Mine("since-last-visit", B);
        Count(b, "becameOverdue").GetProperty("count").GetInt32().ShouldBe(0);
        (await Mine("since-last-visit?scope=all", Director)).GetProperty("hasMarker").GetBoolean().ShouldBeFalse();
        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/since-last-visit?scope=all"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        await ProblemAsync(await Observer.GetAsync("/api/v1/my-matters/since-last-visit"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        await ProblemAsync(await NoTaskView.GetAsync("/api/v1/my-matters/since-last-visit"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        (await A.GetAsync("/api/v1/my-matters/since-last-visit?days=7")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }
}
