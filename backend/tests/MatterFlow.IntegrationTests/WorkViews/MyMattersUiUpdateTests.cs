using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// The scope APIs of the UI update (epic #953): the matter tree (UI-03), the six-kind feed (UI-03), the PM's asset list and detail (UI-03) and the status and Show counts with the task queue's
/// <c>show</c> filter (UI-04). The data is the My Matters world of <see cref="MyMattersTestBase"/>.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class MyMattersUiUpdateTests(SqlServerFixture sql) : MyMattersTestBase(sql)
{
    private async Task<int> CriticalPriorityAsync()
    {
        var all = await OkAsync(await H.Admin.GetAsync("/api/v1/priorities"));
        return (all.ValueKind == JsonValueKind.Array ? all : all.GetProperty("items")).EnumerateArray().Single(p => p.GetProperty("label").GetString() == "Critical").GetProperty("id").GetInt32();
    }

    private async Task<int> AssetAsync(int matterId, string name)
    {
        var types = await OkAsync(await H.Admin.GetAsync("/api/v1/asset-types?pageSize=100"));
        var typeId = types.GetProperty("items").GetArrayLength() > 0
            ? types.GetProperty("items")[0].GetProperty("assetTypeId").GetInt32()
            : (await OkAsync(await H.Admin.PostAsJsonAsync("/api/v1/asset-types", new { name = "Data source" }), HttpStatusCode.Created)).GetProperty("assetTypeId").GetInt32();
        return (await OkAsync(await H.Admin.PostAsJsonAsync("/api/v1/assets", new { matterId, assetTypeId = typeId, displayName = name }), HttpStatusCode.Created)).GetProperty("assetId").GetInt32();
    }

    private static JsonElement Matter(JsonElement tree, int matterId) =>
        tree.GetProperty("clients").EnumerateArray().SelectMany(c => c.GetProperty("matters").EnumerateArray()).Single(m => m.GetProperty("matterId").GetInt32() == matterId);

    // ---- tree

    [Fact]
    public async Task The_tree_has_the_scopes_clients_and_matters_with_counts_and_the_active_flag()
    {
        var critical = await CriticalPriorityAsync();
        await MakeAsync("m1-crit", M1, new() { ["priorityId"] = critical, ["assignedUserId"] = PmA });
        await MakeAsync("m1-hold-late", M1, new() { ["dueDate"] = "2000-01-01" }, "ON_HOLD");
        var tree = await Mine("tree");

        tree.GetProperty("activeDays").GetInt32().ShouldBe(7);
        tree.GetProperty("matterCount").GetInt32().ShouldBe(4); // M1, M2, M4, M6 (M3 has no manager, M5 is archived)
        tree.GetProperty("clients").EnumerateArray().Select(c => c.GetProperty("clientNumber").GetString()).ShouldBe(["00343", "00344"]);
        var m1 = Matter(tree, M1);
        m1.GetProperty("openTasks").GetInt32().ShouldBe(6);
        m1.GetProperty("overdue").GetInt32().ShouldBe(1); // m1-overdue only: the late task on hold is never overdue
        m1.GetProperty("unassigned").GetInt32().ShouldBe(5);
        m1.GetProperty("critical").GetInt32().ShouldBe(1);
        m1.GetProperty("isActive").GetBoolean().ShouldBeTrue();
        Matter(tree, M6).GetProperty("isActive").GetBoolean().ShouldBeFalse();
        Matter(tree, M6).GetProperty("lastAssetChangeUtc").ValueKind.ShouldBe(JsonValueKind.Null);
        var client = tree.GetProperty("clients")[0];
        client.GetProperty("openTasks").GetInt32().ShouldBe(client.GetProperty("matters").EnumerateArray().Sum(m => m.GetProperty("openTasks").GetInt32()));
        client.GetProperty("activeMatterCount").GetInt32().ShouldBe(2); // M1, M2

        // An asset added in the last N days makes an otherwise empty matter active.
        await AssetAsync(M6, "Fresh asset");
        var again = await Mine("tree");
        Matter(again, M6).GetProperty("isActive").GetBoolean().ShouldBeTrue();
        Matter(again, M6).GetProperty("lastAssetChangeUtc").ValueKind.ShouldBe(JsonValueKind.String);
        await H.ExecuteAsync("UPDATE dbo.Asset SET CreatedAt = DATEADD(day, -30, SYSUTCDATETIME()), ModifiedAt = NULL");
        Matter(await Mine("tree"), M6).GetProperty("isActive").GetBoolean().ShouldBeFalse();
        Matter(await Mine("tree?activeDays=60"), M6).GetProperty("isActive").GetBoolean().ShouldBeTrue();
    }

    [Fact]
    public async Task The_tree_filters_by_text_active_only_client_and_matter_and_validates()
    {
        (await Mine("tree?activeOnly=true")).GetProperty("matterCount").GetInt32().ShouldBe(3); // M6 is quiet
        var byClient = await Mine("tree?q=00344");
        byClient.GetProperty("clientCount").GetInt32().ShouldBe(1);
        byClient.GetProperty("matterCount").GetInt32().ShouldBe(1);
        (await Mine($"tree?matterId={M2}")).GetProperty("matterCount").GetInt32().ShouldBe(1);
        (await Mine("tree?q=zzzz-no-such")).GetProperty("clientCount").GetInt32().ShouldBe(0);
        (await Mine("tree", B)).GetProperty("matterCount").GetInt32().ShouldBe(2); // B: M2 (Primary) and M4 (Secondary)
        (await Mine("tree?scope=all", Director)).GetProperty("matterCount").GetInt32().ShouldBe(5); // every active matter
        foreach (var url in new[] { "tree?activeDays=0", "tree?activeDays=91", "tree?from=2030-01-01", "tree?x=1" })
            (await A.GetAsync("/api/v1/my-matters/" + url)).StatusCode.ShouldBe(HttpStatusCode.BadRequest, url);
        (await A.GetAsync("/api/v1/my-matters/tree?scope=all")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await NoTaskView.GetAsync("/api/v1/my-matters/tree")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    // ---- status and Show

    [Fact]
    public async Task Each_show_filter_equals_its_count_and_never_counts_a_task_on_hold_as_overdue()
    {
        var critical = await CriticalPriorityAsync();
        await MakeAsync("m1-crit", M1, new() { ["priorityId"] = critical, ["dueDate"] = In(3) });
        await MakeAsync("m1-hold-late", M1, new() { ["dueDate"] = "2000-01-01" }, "ON_HOLD");
        var progress = await MakeAsync("m2-progress", M2, new() { ["dueDate"] = "2000-02-02" });
        await H.StatusAsync(progress, "IN_PROGRESS");
        var done = await MakeAsync("m2-done", M2, new() { ["dueDate"] = "2000-03-03" });
        await H.CompleteAsync(done);

        var counts = await Mine("task-counts");
        var byStatus = counts.GetProperty("byStatus");
        byStatus.GetProperty("new").GetInt32().ShouldBe(6);
        byStatus.GetProperty("inProgress").GetInt32().ShouldBe(2); // m2-progress and m4-ok (an assigned task starts In Progress)
        byStatus.GetProperty("onHold").GetInt32().ShouldBe(3);
        byStatus.GetProperty("completed").GetInt32().ShouldBe(1);
        byStatus.GetProperty("allOpen").GetInt32().ShouldBe(11);
        var byShow = counts.GetProperty("byShow");
        byShow.GetProperty("everything").GetInt32().ShouldBe(11);
        byShow.GetProperty("overdue").GetInt32().ShouldBe(2); // m1-overdue and m2-progress; the late task on hold is not overdue here
        byShow.GetProperty("critical").GetInt32().ShouldBe(1);
        byShow.GetProperty("due7").GetInt32().ShouldBe(3); // m1-soon (+2), m1-crit (+3), m2-in5 (+5)
        byShow.GetProperty("unassigned").GetInt32().ShouldBe(10); // all open but m4-ok

        // Every number is the total of the Task Queue with the same two filters.
        const string open = "status=NEW&status=IN_PROGRESS&status=ON_HOLD";
        var queue = "managedByMe=true&";
        foreach (var (show, expected) in new[] { ("overdue", 2), ("risk", 0), ("due7", 3), ("critical", 1), ("unassigned", 10) })
            (await TotalAsync(A, "task-queue", $"{queue}{open}&show={show}")).ShouldBe(expected, show);
        (await TotalAsync(A, "task-queue", $"{queue}{open}")).ShouldBe(11);

        // Show narrows the status counts, status narrows the Show counts.
        var overdueOnly = await Mine("task-counts?show=overdue");
        overdueOnly.GetProperty("byStatus").GetProperty("new").GetInt32().ShouldBe(1);
        overdueOnly.GetProperty("byStatus").GetProperty("inProgress").GetInt32().ShouldBe(1);
        overdueOnly.GetProperty("byStatus").GetProperty("onHold").GetInt32().ShouldBe(0);
        overdueOnly.GetProperty("byStatus").GetProperty("completed").GetInt32().ShouldBe(0);
        var holdOnly = await Mine("task-counts?status=ON_HOLD");
        holdOnly.GetProperty("byShow").GetProperty("everything").GetInt32().ShouldBe(3);
        holdOnly.GetProperty("byShow").GetProperty("overdue").GetInt32().ShouldBe(0);
        holdOnly.GetProperty("byShow").GetProperty("unassigned").GetInt32().ShouldBe(3);
        var closed = await Mine("task-counts?status=COMPLETED");
        closed.GetProperty("byShow").GetProperty("everything").GetInt32().ShouldBe(1);
        closed.GetProperty("byShow").GetProperty("overdue").GetInt32().ShouldBe(0); // completed tasks are never overdue
        closed.GetProperty("byShow").GetProperty("unassigned").GetInt32().ShouldBe(1); // unassigned applies to any status

        // The client and the matter narrow the scope; the grid agrees.
        var m2 = await Mine($"task-counts?matterId={M2}");
        m2.GetProperty("byStatus").GetProperty("allOpen").GetInt32().ShouldBe(4);
        (await TotalAsync(A, "task-queue", $"matter={M2}&{open}")).ShouldBe(4);
        (await TotalAsync(A, "task-queue", $"matter={M2}&status=COMPLETED")).ShouldBe(m2.GetProperty("byStatus").GetProperty("completed").GetInt32());
    }

    [Fact]
    public async Task The_status_sort_and_the_step_n_of_m_of_the_task_queue_are_there_and_bad_values_are_400()
    {
        var progress = await MakeAsync("m2-progress", M2, new() { ["dueDate"] = In(9) });
        await H.StatusAsync(progress, "IN_PROGRESS");
        var rows = await OkAsync(await A.GetAsync("/api/v1/task-queue?managedByMe=true&sort=status&dir=asc&pageSize=100&status=NEW&status=IN_PROGRESS&status=ON_HOLD"));
        var statuses = rows.GetProperty("items").EnumerateArray().Select(r => r.GetProperty("status").GetString()).ToList();
        statuses.ShouldBe([.. statuses.OrderBy(s => s switch { "NEW" => 0, "IN_PROGRESS" => 1, _ => 2 })]);
        var step = rows.GetProperty("items").EnumerateArray().First().GetProperty("workflow");
        step.GetProperty("stepsTotal").GetInt32().ShouldBeGreaterThan(0);
        step.GetProperty("stepsResolved").GetInt32().ShouldBeGreaterThanOrEqualTo(0);
        step.GetProperty("currentStepNumber").GetInt32().ShouldBeGreaterThan(0);

        (await A.GetAsync("/api/v1/task-queue?show=delayed")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await A.GetAsync("/api/v1/my-matters/task-counts?show=delayed")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await A.GetAsync("/api/v1/my-matters/task-counts?status=DONE")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await A.GetAsync("/api/v1/my-matters/task-counts?x=1")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await NoTaskView.GetAsync("/api/v1/my-matters/task-counts")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    // ---- feed

    [Fact]
    public async Task The_feed_has_the_six_kinds_with_counts_unread_and_paging()
    {
        await Mine("feed"); // first visit creates the marker, so nothing before it is unread
        var feed0 = await Mine("feed");
        feed0.GetProperty("unreadCount").GetInt32().ShouldBe(0);
        feed0.GetProperty("countsByKind").GetProperty("OVERDUE").GetInt32().ShouldBe(1); // m1-overdue
        feed0.GetProperty("countsByKind").GetProperty("ON_HOLD").GetInt32().ShouldBe(2); // m1-hold, m2-hold
        feed0.GetProperty("countsByKind").EnumerateObject().Select(p => p.Name).Order().ShouldBe(["DUE_DATE_UPDATED", "NEW_ASSETS", "NEW_COMMENTS", "NEW_STATUS_UPDATES", "ON_HOLD", "OVERDUE"]);

        var hold = feed0.GetProperty("items").EnumerateArray().Where(i => i.GetProperty("kind").GetString() == "ON_HOLD").ToList();
        hold.Single(i => i.GetProperty("taskTitle").GetString() == "m1-hold").GetProperty("onHoldDays").GetInt32().ShouldBe(10);
        hold.Select(i => i.GetProperty("onHoldReason").ValueKind).ShouldAllBe(k => k == JsonValueKind.Null || k == JsonValueKind.String);
        var overdue = feed0.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("kind").GetString() == "OVERDUE");
        overdue.GetProperty("taskTitle").GetString().ShouldBe("m1-overdue");
        overdue.GetProperty("daysOverdue").GetInt32().ShouldBeGreaterThan(9000);
        overdue.GetProperty("isUnread").GetBoolean().ShouldBeFalse(); // it fell due long before the marker

        // New things by somebody else: an asset, a comment, a status update, a due date change.
        await AssetAsync(M1, "Laptop batch");
        await OkAsync(await H.Admin.PostAsJsonAsync($"/api/v1/tasks/{Ids["m1-soon"]}/comments", new { bodyHtml = "<p>PRIVILEGED-WORDS</p>" }), HttpStatusCode.Created);
        await H.StatusAsync(await H.GetTaskAsync(Ids["m1-asap"]), "IN_PROGRESS");
        var soon = await H.GetTaskAsync(Ids["m2-in5"]);
        await OkAsync(await H.Admin.PutAsJsonAsync($"/api/v1/tasks/{Ids["m2-in5"]}", new Dictionary<string, object?>
        {
            ["rowVersion"] = RowVersion(soon), ["title"] = soon.GetProperty("title").GetString(), ["requestorName"] = soon.GetProperty("requestorName").GetString(),
            ["requestorEmail"] = soon.GetProperty("requestorEmail").GetString(), ["dueDate"] = In(20),
        }));
        await H.StatusAsync(await H.GetTaskAsync(Ids["m2-far"]), "ON_HOLD", "Waiting"); // a third task on hold: a state, not a status update

        var feed = await Mine("feed");
        var counts = feed.GetProperty("countsByKind");
        counts.GetProperty("NEW_ASSETS").GetInt32().ShouldBe(1);
        counts.GetProperty("NEW_COMMENTS").GetInt32().ShouldBe(1);
        counts.GetProperty("NEW_STATUS_UPDATES").GetInt32().ShouldBe(2, feed.GetRawText()); // m4-ok (before the marker) and asap -> in progress; the holds are not status updates
        counts.GetProperty("DUE_DATE_UPDATED").GetInt32().ShouldBe(1);
        counts.GetProperty("ON_HOLD").GetInt32().ShouldBe(3);
        feed.GetProperty("unreadCount").GetInt32().ShouldBe(4 + 1); // the four events and the new hold (a state that began after the marker)
        feed.GetRawText().ShouldNotContain("PRIVILEGED-WORDS");
        var due = feed.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("kind").GetString() == "DUE_DATE_UPDATED");
        due.GetProperty("newDueDate").GetString().ShouldBe(In(20));
        due.GetProperty("oldDueDate").GetString().ShouldBe(In(5));
        var status = feed.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("kind").GetString() == "NEW_STATUS_UPDATES" && i.GetProperty("taskTitle").GetString() == "m1-asap");
        status.GetProperty("isUnread").GetBoolean().ShouldBeTrue();
        (status.GetProperty("fromStatus").GetString(), status.GetProperty("toStatus").GetString()).ShouldBe(("NEW", "IN_PROGRESS"));
        feed.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("itemKey").GetString()).Distinct().Count().ShouldBe(feed.GetProperty("items").GetArrayLength());
        var times = feed.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("occurredAtUtc").GetDateTime()).ToList();
        times.ShouldBe([.. times.OrderByDescending(t => t)]);

        // Filters: kinds, unread, paging.
        var assetsOnly = await Mine("feed?kind=NEW_ASSETS");
        assetsOnly.GetProperty("total").GetInt32().ShouldBe(1);
        assetsOnly.GetProperty("items")[0].GetProperty("assetName").GetString().ShouldBe("Laptop batch");
        assetsOnly.GetProperty("countsByKind").GetProperty("OVERDUE").GetInt32().ShouldBe(1); // the badge numbers ignore the kind filter
        (await Mine("feed?unread=true")).GetProperty("total").GetInt32().ShouldBe(5);
        (await Mine("feed?unread=true&kind=NEW_STATUS_UPDATES")).GetProperty("total").GetInt32().ShouldBe(1);
        var page1 = await Mine("feed?pageSize=3");
        var page2 = await Mine("feed?pageSize=3&page=2");
        page1.GetProperty("items").GetArrayLength().ShouldBe(3);
        page2.GetProperty("items")[0].GetProperty("itemKey").GetString().ShouldNotBe(page1.GetProperty("items")[0].GetProperty("itemKey").GetString());
        page1.GetProperty("total").GetInt32().ShouldBe(feed.GetProperty("total").GetInt32());

        // Mark as read moves the same marker: nothing is unread afterwards.
        await OkAsync(await A.PostAsJsonAsync("/api/v1/my-matters/activity/seen", new { }));
        (await Mine("feed")).GetProperty("unreadCount").GetInt32().ShouldBe(0);

        // The scope applies: B (Primary of M2) sees M2's items only.
        var b = await Mine("feed?pageSize=100", B);
        b.GetProperty("items").EnumerateArray().ShouldAllBe(i => i.GetProperty("matterId").GetInt32() == M2 || i.GetProperty("matterId").GetInt32() == M4);
    }

    [Fact]
    public async Task The_feed_rejects_bad_parameters()
    {
        foreach (var url in new[] { "feed?kind=NEW_TASKS", "feed?days=0", "feed?days=91", "feed?pageSize=101", "feed?page=6&pageSize=100", "feed?from=2030-01-01", "feed?x=1" })
            (await A.GetAsync("/api/v1/my-matters/" + url)).StatusCode.ShouldBe(HttpStatusCode.BadRequest, url);
        (await A.GetAsync("/api/v1/my-matters/feed?scope=all")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    // ---- assets

    [Fact]
    public async Task The_asset_list_filters_sorts_pages_and_the_detail_shows_linked_tasks_with_their_latest_comment()
    {
        var a1 = await AssetAsync(M1, "Alpha laptops");
        var a2 = await AssetAsync(M2, "Beta server");
        await AssetAsync(M3, "Nobody's asset");
        await AssetAsync(M6, "Quiet matter asset");
        (await H.Admin.PostAsJsonAsync($"/api/v1/tasks/{Ids["m1-soon"]}/assets", new { assetId = a1 })).EnsureSuccessStatusCode();
        (await H.Admin.PostAsJsonAsync($"/api/v1/tasks/{Ids["m1-asap"]}/assets", new { assetId = a1 })).EnsureSuccessStatusCode();
        await OkAsync(await H.Admin.PostAsJsonAsync($"/api/v1/tasks/{Ids["m1-soon"]}/comments", new { bodyHtml = "<p>First note</p>" }), HttpStatusCode.Created);
        await OkAsync(await H.Admin.PostAsJsonAsync($"/api/v1/tasks/{Ids["m1-soon"]}/comments", new { bodyHtml = "<p>Latest <b>note</b> here</p>" }), HttpStatusCode.Created);
        await H.StatusAsync(await H.GetTaskAsync(Ids["m1-asap"]), "ON_HOLD", "ignored"); // a hold reason comment must not be returned as a comment

        var list = await Mine("assets");
        list.GetProperty("total").GetInt32().ShouldBe(3); // M1, M2 and M6; M3 is nobody's
        var alpha = list.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("assetId").GetInt32() == a1);
        alpha.GetProperty("clientName").GetString().ShouldNotBeNullOrEmpty();
        alpha.GetProperty("matterId").GetInt32().ShouldBe(M1);
        alpha.GetProperty("statusCode").GetString().ShouldBe("ACTIVE");
        alpha.GetProperty("linkedTaskCount").GetInt32().ShouldBe(2);
        alpha.GetProperty("openLinkedTaskCount").GetInt32().ShouldBe(2);
        alpha.GetProperty("updatedAtUtc").ValueKind.ShouldBe(JsonValueKind.Null);
        alpha.GetRawText().ShouldNotContain("comment", Case.Insensitive);

        (await Mine("assets?sort=name&dir=desc")).GetProperty("items")[0].GetProperty("name").GetString().ShouldBe("Quiet matter asset");
        (await Mine("assets?sort=linkedTasks&dir=desc")).GetProperty("items")[0].GetProperty("assetId").GetInt32().ShouldBe(a1);
        (await Mine("assets?name=beta")).GetProperty("total").GetInt32().ShouldBe(1);
        (await Mine("assets?q=laptops")).GetProperty("total").GetInt32().ShouldBe(1);
        (await Mine($"assets?matterId={M2}")).GetProperty("items")[0].GetProperty("assetId").GetInt32().ShouldBe(a2);
        (await Mine("assets?status=DISPOSED")).GetProperty("total").GetInt32().ShouldBe(0);
        (await Mine("assets?status=ACTIVE&status=INACTIVE")).GetProperty("total").GetInt32().ShouldBe(3);
        (await Mine($"assets?createdFrom={In(1)}")).GetProperty("total").GetInt32().ShouldBe(0);
        (await Mine($"assets?updatedFrom={In(-1)}")).GetProperty("total").GetInt32().ShouldBe(0); // never updated
        (await Mine("assets?pageSize=1&page=2")).GetProperty("items").GetArrayLength().ShouldBe(1);
        (await Mine("assets?scope=all", Director)).GetProperty("total").GetInt32().ShouldBe(4);

        var detail = await Mine($"assets/{a1}");
        detail.GetProperty("name").GetString().ShouldBe("Alpha laptops");
        var tasks = detail.GetProperty("linkedTasks").EnumerateArray().ToList();
        tasks.Count.ShouldBe(2);
        var soon = tasks.Single(t => t.GetProperty("title").GetString() == "m1-soon");
        soon.GetProperty("latestComment").GetProperty("excerpt").GetString().ShouldBe("Latest note here");
        soon.GetProperty("statusLabel").GetString().ShouldBe("New");
        var asap = tasks.Single(t => t.GetProperty("title").GetString() == "m1-asap");
        asap.GetProperty("latestComment").ValueKind.ShouldBe(JsonValueKind.Null);
        asap.GetProperty("statusLabel").GetString().ShouldBe("On Hold");

        (await A.GetAsync("/api/v1/my-matters/assets/999999")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await B.GetAsync($"/api/v1/my-matters/assets/{a1}")).StatusCode.ShouldBe(HttpStatusCode.NotFound); // B does not manage M1
        foreach (var url in new[] { "assets?sort=comment", "assets?dir=up", "assets?status=GONE", "assets?pageSize=101", "assets?x=1" })
            (await A.GetAsync("/api/v1/my-matters/" + url)).StatusCode.ShouldBe(HttpStatusCode.BadRequest, url);
    }
}
