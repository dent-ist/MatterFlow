using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// GET /my-matters/activity, the epic #758 additions (PX-10, #768): the matter and kind filters (kinds are ORed, COMPLETED and ON_HOLD are the status changes to that status), unread only,
/// and cursor paging that walks the whole list once, newest first. The unread badge counts the whole window whatever the filters say.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class MyMattersActivityFiltersTests(SqlServerFixture sql) : MyMattersTestBase(sql)
{
    private static List<JsonElement> Items(JsonElement activity) => [.. activity.GetProperty("items").EnumerateArray()];

    private static List<long> EventIds(JsonElement activity) => [.. Items(activity).Select(i => i.GetProperty("eventId").GetInt64())];

    [Fact]
    public async Task The_matter_and_kind_filters_narrow_the_list_and_the_unread_badge_stays_for_the_whole_window()
    {
        await Mine("activity"); // first visit creates the marker
        await MakeAsync("n-a", M1, new() { ["dueDate"] = "2099-03-01" });
        await MakeAsync("n-b", M2, new() { ["dueDate"] = "2099-03-02" });
        await H.StatusAsync(await H.GetTaskAsync(Ids["m2-far"]), "ON_HOLD", "Waiting for the client");
        await H.StatusAsync(await H.GetTaskAsync(Ids["m1-soon"]), "IN_PROGRESS");
        await H.CompleteAsync(await H.GetTaskAsync(Ids["m1-soon"]));
        await OkAsync(await H.Admin.PostAsJsonAsync($"/api/v1/tasks/{Ids["m1-asap"]}/comments", new { bodyHtml = "<p>SECRET-TEXT</p>" }), HttpStatusCode.Created);

        var all = await Mine("activity?take=100");
        var unread = all.GetProperty("unreadCount").GetInt32();
        unread.ShouldBeGreaterThanOrEqualTo(6);

        var onlyM1 = await Mine($"activity?take=100&matterId={M1}");
        Items(onlyM1).ShouldNotBeEmpty();
        Items(onlyM1).ShouldAllBe(i => i.GetProperty("matterId").GetInt32() == M1);
        onlyM1.GetProperty("unreadCount").GetInt32().ShouldBe(unread); // the badge is not a count of the filtered list
        Items(await Mine($"activity?take=100&matterId={M3}")).ShouldBeEmpty(); // not one of A's matters: nothing, not an error
        Items(await Mine($"activity?take=100&matterId={M5}")).ShouldBeEmpty();

        Items(await Mine("activity?take=100&kind=TASK_CREATED")).ShouldAllBe(i => i.GetProperty("kind").GetString() == "TASK_CREATED");
        Items(await Mine("activity?take=100&kind=TASK_CREATED")).Select(i => i.GetProperty("taskTitle").GetString()).ShouldContain("n-a");

        var holds = Items(await Mine("activity?take=100&kind=ON_HOLD"));
        holds.ShouldNotBeEmpty();
        holds.ShouldAllBe(i => i.GetProperty("kind").GetString() == "STATUS_CHANGED" && i.GetProperty("to").GetString() == "ON_HOLD");
        var done = Items(await Mine("activity?take=100&kind=COMPLETED"));
        done.Select(i => i.GetProperty("taskTitle").GetString()).ShouldBe(["m1-soon"]);
        done[0].GetProperty("to").GetString().ShouldBe("COMPLETED");
        var status = Items(await Mine("activity?take=100&kind=STATUS_CHANGED"));
        status.Count.ShouldBeGreaterThan(holds.Count + done.Count - 1);
        status.ShouldAllBe(i => i.GetProperty("kind").GetString() == "STATUS_CHANGED");

        // Several kinds are an OR (repeated or comma separated); the comment is an event only.
        var mixed = Items(await Mine("activity?take=100&kind=COMMENTED&kind=REASSIGNED,TASK_CREATED"));
        var mixedKinds = mixed.Select(i => i.GetProperty("kind").GetString()).Distinct().Order().ToList();
        mixedKinds.ShouldContain("COMMENTED");
        mixedKinds.ShouldContain("TASK_CREATED");
        mixedKinds.ShouldAllBe(k => k == "COMMENTED" || k == "REASSIGNED" || k == "TASK_CREATED"); // nothing else: the kinds are an OR, not "all kinds"
        (await A.GetStringAsync("/api/v1/my-matters/activity?take=100")).ShouldNotContain("SECRET-TEXT");

        // Filters combine.
        var m2Created = Items(await Mine($"activity?take=100&matterId={M2}&kind=TASK_CREATED"));
        m2Created.ShouldAllBe(i => i.GetProperty("matterId").GetInt32() == M2 && i.GetProperty("kind").GetString() == "TASK_CREATED");
        m2Created.Select(i => i.GetProperty("taskTitle").GetString()).ShouldContain("n-b");
        m2Created.Select(i => i.GetProperty("taskTitle").GetString()).ShouldNotContain("n-a"); // that one is on M1
        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/activity?kind=NOPE"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/activity?cursor=0"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task Unread_only_lists_what_the_badge_counts_and_a_cursor_walks_the_list_once()
    {
        await Mine("activity");
        for (var i = 0; i < 7; i++)
            await MakeAsync($"walk-{i}", i % 2 == 0 ? M1 : M2, new() { ["dueDate"] = "2099-03-01" });

        var unread = await Mine("activity?take=100&unread=true");
        Items(unread).Count.ShouldBe(unread.GetProperty("unreadCount").GetInt32());
        Items(unread).ShouldAllBe(i => i.GetProperty("isUnread").GetBoolean());
        Items(await Mine("activity?take=100&unread=true", B)).ShouldAllBe(i => i.GetProperty("isUnread").GetBoolean());

        // A cursor continues exactly where the previous page ended: no gap, no repeat, newest first.
        var whole = EventIds(await Mine("activity?take=100"));
        var seen = new List<long>();
        long? cursor = null;
        var pages = 0;
        while (true)
        {
            var page = await Mine("activity?take=3" + (cursor is { } c ? $"&cursor={c}" : string.Empty));
            seen.AddRange(EventIds(page));
            pages++;
            if (!page.GetProperty("hasMore").GetBoolean())
            {
                page.GetProperty("nextCursor").ValueKind.ShouldBe(JsonValueKind.Null);
                break;
            }

            cursor = page.GetProperty("nextCursor").GetInt64();
            cursor.ShouldBe(EventIds(page)[^1]);
            pages.ShouldBeLessThan(100);
        }

        seen.ShouldBe(whole);
        seen.ShouldBe([.. seen.OrderByDescending(x => x)]);
        pages.ShouldBeGreaterThan(2);
    }
}
