using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>GET /my-matters/activity and POST /my-matters/activity/seen (epic #667, issue #683): event kinds, matter scoping, the 7-day cut-off, the unread marker and privilege.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class MyMattersActivityTests(SqlServerFixture sql) : MyMattersTestBase(sql)
{
    private static List<JsonElement> Items(JsonElement activity) => [.. activity.GetProperty("items").EnumerateArray()];

    private static List<string> Kinds(JsonElement activity) => [.. Items(activity).Select(i => i.GetProperty("kind").GetString()!)];

    private static JsonElement Find(JsonElement activity, string kind, string? task = null) =>
        Items(activity).First(i => i.GetProperty("kind").GetString() == kind && (task is null || i.GetProperty("taskTitle").GetString() == task));

    [Fact]
    public async Task The_first_visit_marks_nothing_unread_and_later_events_are_unread_until_marked()
    {
        var first = await Mine("activity");
        first.GetProperty("unreadCount").GetInt32().ShouldBe(0);
        Items(first).ShouldAllBe(i => !i.GetProperty("isUnread").GetBoolean());
        Items(first).ShouldNotBeEmpty(); // the seeded tasks of A's matters, new tasks and the holds
        var seen = first.GetProperty("seenEventId").GetInt64();
        seen.ShouldBeGreaterThan(0);

        // Someone else acts: a task is created, put on hold, reassigned, and a comment is added.
        var created = await MakeAsync("m1-new", M1, new() { ["dueDate"] = "2099-03-01" });
        await H.StatusAsync(await H.GetTaskAsync(Ids["m2-far"]), "ON_HOLD", "Waiting for a decision");
        var far = await H.GetTaskAsync(Ids["m2-in5"]);
        await OkAsync(await H.Admin.PostAsJsonAsync($"/api/v1/tasks/{Ids["m2-in5"]}/assignment", new { rowVersion = RowVersion(far), userId = Tech }));
        await OkAsync(await H.Admin.PostAsJsonAsync($"/api/v1/tasks/{Ids["m1-soon"]}/comments", new { bodyHtml = "<p>SECRET-PRIVILEGED-TEXT</p>" }), HttpStatusCode.Created);

        var next = await Mine("activity");
        next.GetProperty("unreadCount").GetInt32().ShouldBe(5); // assigning a New task also starts it: a second status change
        var unread = Items(next).Where(i => i.GetProperty("isUnread").GetBoolean()).ToList();
        unread.Select(i => i.GetProperty("kind").GetString()).Order().ShouldBe(new[] { "COMMENTED", "REASSIGNED", "STATUS_CHANGED", "STATUS_CHANGED", "TASK_CREATED" }.Order());
        unread.ShouldAllBe(i => i.GetProperty("eventId").GetInt64() > seen);
        next.GetProperty("latestEventId").GetInt64().ShouldBe(Items(next)[0].GetProperty("eventId").GetInt64());

        var status = Find(next, "STATUS_CHANGED", "m2-far");
        (status.GetProperty("from").GetString(), status.GetProperty("to").GetString()).ShouldBe(("NEW", "ON_HOLD"));
        var reassigned = Find(next, "REASSIGNED", "m2-in5");
        reassigned.GetProperty("from").ValueKind.ShouldBe(JsonValueKind.Null);
        reassigned.GetProperty("to").GetString().ShouldBe(@"KE\tech");
        var commented = Find(next, "COMMENTED", "m1-soon");
        commented.GetProperty("actorName").GetString().ShouldBe(DatabaseApiFactory.AdminAccount);
        Find(next, "TASK_CREATED", "m1-new").GetProperty("taskNumber").GetString().ShouldStartWith("TSK-");

        // Privilege: no comment text anywhere in the payload.
        next.GetRawText().ShouldNotContain("SECRET-PRIVILEGED-TEXT");
        commented.EnumerateObject().Select(p => p.Name).ShouldNotContain("body");

        // Marking as read moves the marker; the next answer has no unread events. The marker is per person.
        var marked = await OkAsync(await A.PostAsJsonAsync("/api/v1/my-matters/activity/seen", new { }));
        marked.GetProperty("seenEventId").GetInt64().ShouldBeGreaterThanOrEqualTo(next.GetProperty("latestEventId").GetInt64());
        (await Mine("activity")).GetProperty("unreadCount").GetInt32().ShouldBe(0);
        (await Mine("activity", B)).GetProperty("unreadCount").GetInt32().ShouldBe(0); // B's first visit: nothing unread either
        await MakeAsync("m4-new", M4, new() { ["dueDate"] = "2099-03-01" });
        (await Mine("activity")).GetProperty("unreadCount").GetInt32().ShouldBe(1);
        (await Mine("activity", B)).GetProperty("unreadCount").GetInt32().ShouldBe(1);
        await OkAsync(await B.PostAsJsonAsync("/api/v1/my-matters/activity/seen", new { }));
        (await Mine("activity", B)).GetProperty("unreadCount").GetInt32().ShouldBe(0);
        (await Mine("activity")).GetProperty("unreadCount").GetInt32().ShouldBe(1); // A has not marked it yet
        created.GetProperty("taskId").GetInt64().ShouldBeGreaterThan(0);
    }

    [Fact]
    public async Task Opening_one_item_marks_up_to_it_and_the_marker_only_moves_forward()
    {
        await Mine("activity"); // first visit
        await MakeAsync("n1", M1, new() { ["dueDate"] = "2099-03-01" });
        await MakeAsync("n2", M1, new() { ["dueDate"] = "2099-03-02" });
        var activity = await Mine("activity");
        activity.GetProperty("unreadCount").GetInt32().ShouldBe(2);
        var older = Find(activity, "TASK_CREATED", "n1").GetProperty("eventId").GetInt64();

        var upTo = await OkAsync(await A.PostAsJsonAsync("/api/v1/my-matters/activity/seen", new { upToEventId = older }));
        upTo.GetProperty("seenEventId").GetInt64().ShouldBe(older);
        var after = await Mine("activity");
        after.GetProperty("unreadCount").GetInt32().ShouldBe(1);
        Items(after).Single(i => i.GetProperty("isUnread").GetBoolean()).GetProperty("taskTitle").GetString().ShouldBe("n2");

        // A smaller id never moves it back; a huge one stops at the newest event.
        (await OkAsync(await A.PostAsJsonAsync("/api/v1/my-matters/activity/seen", new { upToEventId = 1 }))).GetProperty("seenEventId").GetInt64().ShouldBe(older);
        var capped = await OkAsync(await A.PostAsJsonAsync("/api/v1/my-matters/activity/seen", new { upToEventId = 9_000_000_000_000L }));
        capped.GetProperty("seenEventId").GetInt64().ShouldBe((await Mine("activity")).GetProperty("latestEventId").GetInt64());
        await ProblemAsync(await A.PostAsJsonAsync("/api/v1/my-matters/activity/seen", new { upToEventId = 0 }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task Only_my_matters_only_the_window_and_only_the_five_kinds()
    {
        await Mine("activity");
        await H.ExecuteAsync($"""
            INSERT dbo.AuditEvent (OccurredAtUtc, ActorUserId, EventType, ObjectType, ObjectId, MatterId, TaskId, FieldKey, NewValue, CorrelationId)
            VALUES (DATEADD(day, -8, SYSUTCDATETIME()), NULL, 'TASK_CREATED', 'Task', '{Ids["m1-soon"]}', {M1}, {Ids["m1-soon"]}, NULL, NULL, NEWID()),
                   (DATEADD(day, -6, SYSUTCDATETIME()), NULL, 'TASK_CREATED', 'Task', '{Ids["m1-soon"]}', {M1}, {Ids["m1-soon"]}, NULL, NULL, NEWID()),
                   (SYSUTCDATETIME(), NULL, 'TASK_CREATED', 'Task', '{Ids["m3-overdue"]}', {M3}, {Ids["m3-overdue"]}, NULL, NULL, NEWID()),
                   (SYSUTCDATETIME(), NULL, 'FORM_VALUES_DROPPED', 'Task', '{Ids["m1-soon"]}', {M1}, {Ids["m1-soon"]}, NULL, NULL, NEWID()),
                   (SYSUTCDATETIME(), NULL, 'COMMENT_ADDED', 'TaskComment', '1', {M1}, {Ids["m1-soon"]}, 'purpose', 'ON_HOLD', NEWID());
            """);

        var a = await Mine("activity?take=100");
        var all = Items(a).Select(i => (i.GetProperty("matterId").GetInt32(), i.GetProperty("occurredAtUtc").GetDateTime())).ToList();
        all.ShouldAllBe(x => x.Item1 == M1 || x.Item1 == M2 || x.Item1 == M4 || x.Item1 == M6); // never the unmanaged matter M3, never the inactive M5
        all.ShouldAllBe(x => x.Item2 > DateTime.UtcNow.AddDays(-7)); // the 8-day-old event is outside the window; the 6-day-old one is inside
        Items(a).Count(i => i.GetProperty("kind").GetString() == "TASK_CREATED" && i.GetProperty("occurredAtUtc").GetDateTime() < DateTime.UtcNow.AddDays(-5)).ShouldBe(1);
        Kinds(a).ShouldAllBe(k => k == "TASK_CREATED" || k == "STATUS_CHANGED" || k == "COMMENTED" || k == "REASSIGNED" || k == "MANAGER_CHANGED");
        Kinds(a).ShouldNotContain("COMMENTED"); // only ordinary comments count; the hold / cancel reasons are status changes already

        // The All scope sees the unmanaged matter too; a date range replaces the 7 days.
        Items(await Mine("activity?scope=all&take=100", Director)).ShouldContain(i => i.GetProperty("matterId").GetInt32() == M3);
        var wide = await Mine($"activity?take=100&from={DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-10):yyyy-MM-dd}");
        Items(wide).Count(i => i.GetProperty("occurredAtUtc").GetDateTime() < DateTime.UtcNow.AddDays(-7)).ShouldBe(1);
    }

    [Fact]
    public async Task Manager_changes_show_names_and_paging_says_when_there_is_more()
    {
        await Mine("activity");
        var matter = await OkAsync(await H.Admin.GetAsync($"/api/v1/matters/{M6}"));
        await OkAsync(await H.Admin.PutAsJsonAsync($"/api/v1/matters/{M6}/managers", new { primaryManagerId = PmA, secondaryManagerId = PmB, rowVersion = matter.GetProperty("rowVersion").GetString() }));
        var a = await Mine("activity");
        var change = Find(a, "MANAGER_CHANGED");
        change.GetProperty("managerPlace").GetString().ShouldBe("secondary");
        change.GetProperty("to").GetString().ShouldBe(@"KE\pmb");
        change.GetProperty("from").ValueKind.ShouldBe(JsonValueKind.Null);
        change.GetProperty("isUnread").GetBoolean().ShouldBeTrue();

        var one = await Mine("activity?take=1");
        one.GetProperty("items").GetArrayLength().ShouldBe(1);
        one.GetProperty("hasMore").GetBoolean().ShouldBeTrue();
        (await Mine("activity?take=100")).GetProperty("hasMore").GetBoolean().ShouldBeFalse();
        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/activity?take=101"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task Activity_needs_the_same_permissions_as_the_rest_of_My_Matters()
    {
        await ProblemAsync(await Observer.GetAsync("/api/v1/my-matters/activity"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        await ProblemAsync(await Observer.PostAsJsonAsync("/api/v1/my-matters/activity/seen", new { }), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        await ProblemAsync(await NoTaskView.GetAsync("/api/v1/my-matters/activity"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        (await Mine("activity", Director)).GetProperty("items").GetArrayLength().ShouldBe(0);
    }
}
