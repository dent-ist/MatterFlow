using System.Net;
using System.Net.Http.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;
using static MatterFlow.IntegrationTests.WorkViews.QueueData;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>GET /api/v1/my-work and /api/v1/pod-work (ticket 50): tabs, counts, multi-Pod My Work (SCN-007), Pod Work scoping.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class MyWorkAndPodWorkApiTests(SqlServerFixture sql)
{
    private Task<QueueData> DataAsync() => QueueData.GetAsync(sql);

    private static string[] Of(params string[] titles) => titles;

    private static Task<System.Text.Json.JsonElement> MyWorkAsync(QueueData d, HttpClient client, string query = "") =>
        d.GetAsync("/api/v1/my-work?pageSize=100" + (query.Length > 0 ? "&" + query : string.Empty), client);

    private static Task<System.Text.Json.JsonElement> PodWorkAsync(QueueData d, HttpClient client, string query = "") =>
        d.GetAsync("/api/v1/pod-work?pageSize=100" + (query.Length > 0 ? "&" + query : string.Empty), client);

    // ---- My Work

    [Fact]
    public async Task Scn007_my_work_lists_everything_assigned_to_me_across_all_my_pods_and_nothing_of_others()
    {
        var d = await DataAsync();
        var active = await MyWorkAsync(d, d.TechAClient);

        active.GetProperty("view").GetString().ShouldBe("active");
        // Pod A, Pod B and no Pod at all; priority first, then ASAP above due dates, then due ascending.
        TitlesOf(active).ShouldBe(Of("mine-asap", "mine-hold", "mine-pod-a", "mine-pod-b", "mine-overdue", "mine-soon", "mine-far"));
        TitlesOf(active).ShouldNotContain("poda-member");
        TitlesOf(active).ShouldNotContain("mine-done");
        TitlesOf(active).ShouldNotContain("mine-cancelled");

        // The other member of Pod A sees only his own.
        TitlesOf(await MyWorkAsync(d, d.TechBClient)).ShouldBeSet(["poda-member", "created-by-tech-b"]);
    }

    [Fact]
    public async Task My_work_tabs_and_counts()
    {
        var d = await DataAsync();
        var active = await MyWorkAsync(d, d.TechAClient);
        var counts = active.GetProperty("counts");
        counts.GetProperty("active").GetInt32().ShouldBe(7);
        counts.GetProperty("dueSoon").GetInt32().ShouldBe(2);
        counts.GetProperty("completed").GetInt32().ShouldBe(2);
        counts.GetProperty("createdByMe").GetInt32().ShouldBe(2);
        active.GetProperty("total").GetInt32().ShouldBe(7);

        // Due soon: an explicit due date within 2 days, or overdue. ASAP is not included.
        var dueSoon = await MyWorkAsync(d, d.TechAClient, "view=dueSoon");
        TitlesOf(dueSoon).ShouldBe(Of("mine-overdue", "mine-soon"));
        dueSoon.GetProperty("total").GetInt32().ShouldBe(2);
        dueSoon.GetProperty("counts").GetProperty("active").GetInt32().ShouldBe(7);
        TitlesOf(await MyWorkAsync(d, d.TechAClient, "view=DUESOON")).ShouldBe(Of("mine-overdue", "mine-soon"));

        // Completed: completed and cancelled, newest first.
        TitlesOf(await MyWorkAsync(d, d.TechAClient, "view=completed")).ShouldBe(Of("mine-cancelled", "mine-done"));

        // Created by me: any status, any assignee.
        TitlesOf(await MyWorkAsync(d, d.TechAClient, "view=createdByMe")).ShouldBe(Of("created-by-tech", "created-by-tech-b"));
    }

    [Theory]
    [InlineData("UTC")]
    [InlineData("America/Los_Angeles")]
    [InlineData("Pacific/Kiritimati")]
    public async Task Group_by_due_returns_bucket_counts_that_equal_the_grid_and_orders_rows_by_bucket(string zone)
    {
        var d = await DataAsync();
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, TimeZoneInfo.FindSystemTimeZoneById(zone)));
        foreach (var client in new[] { d.TechAClient, d.TechBClient })
        {
            async Task<int> TotalAsync(string filter) =>
                (await d.GetAsync("/api/v1/my-work?pageSize=1&" + filter, client, zone)).GetProperty("total").GetInt32();

            foreach (var extra in new[] { string.Empty, "&status=IN_PROGRESS", $"&pod={d.PodB}" })
            {
                var grouped = await d.GetAsync("/api/v1/my-work?pageSize=100&group=due" + extra, client, zone);
                var b = grouped.GetProperty("bucketCounts");
                int Of(string name) => b.GetProperty(name).GetInt32();
                var sum = Of("asap") + Of("overdue") + Of("today") + Of("tomorrow") + Of("thisWeek") + Of("later");
                sum.ShouldBe(grouped.GetProperty("total").GetInt32());
                grouped.GetProperty("total").GetInt32().ShouldBe(await TotalAsync(extra.TrimStart('&')));

                Of("asap").ShouldBe(await TotalAsync("asap=true" + extra));
                Of("overdue").ShouldBe(await TotalAsync("overdue=true" + extra));
                Of("today").ShouldBe(await TotalAsync($"dueFrom={today:yyyy-MM-dd}&dueTo={today:yyyy-MM-dd}&overdue=false" + extra));
                var tomorrow = today.AddDays(1).ToString("yyyy-MM-dd");
                Of("tomorrow").ShouldBe(await TotalAsync($"dueFrom={tomorrow}&dueTo={tomorrow}&overdue=false" + extra));
                var weekEnd = Application_EndOfWeek(today);
                var afterTomorrow = today.AddDays(2);
                Of("thisWeek").ShouldBe(afterTomorrow > weekEnd ? 0 : await TotalAsync($"dueFrom={afterTomorrow:yyyy-MM-dd}&dueTo={weekEnd:yyyy-MM-dd}" + extra));

                var order = grouped.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("taskId").GetInt64()).ToList();
                var plain = (await d.GetAsync("/api/v1/my-work?pageSize=100" + extra, client, zone)).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("taskId").GetInt64()).ToList();
                order.OrderBy(x => x).ShouldBe(plain.OrderBy(x => x), "grouping reorders, it never adds or drops rows");
            }
        }

        // Paging is stable: pages of 2 concatenate to the one big page.
        var all = (await d.GetAsync("/api/v1/my-work?pageSize=100&group=due", d.TechAClient, zone)).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("taskId").GetInt64()).ToList();
        var paged = new List<long>();
        for (var page = 1; paged.Count < all.Count; page++)
        {
            var next = (await d.GetAsync($"/api/v1/my-work?pageSize=2&page={page}&group=due", d.TechAClient, zone)).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("taskId").GetInt64()).ToList();
            next.ShouldNotBeEmpty();
            paged.AddRange(next);
        }

        paged.ShouldBe(all);
    }

    private static bool HasBuckets(System.Text.Json.JsonElement page) =>
        page.TryGetProperty("bucketCounts", out var b) && b.ValueKind != System.Text.Json.JsonValueKind.Null;

    private static DateOnly Application_EndOfWeek(DateOnly today) => MatterFlow.WorkViews.Application.Queries.TaskQueueRules.EndOfWeek(today);

    [Fact]
    public async Task Group_by_due_is_only_for_the_active_tab_and_unknown_groups_are_rejected()
    {
        var d = await DataAsync();
        HasBuckets(await d.GetAsync("/api/v1/my-work", d.TechAClient, "UTC")).ShouldBeFalse();
        HasBuckets(await d.GetAsync("/api/v1/my-work?group=none", d.TechAClient, "UTC")).ShouldBeFalse();
        HasBuckets(await d.GetAsync("/api/v1/my-work?view=dueSoon&group=due", d.TechAClient, "UTC")).ShouldBeFalse();
        var a = (await d.GetAsync("/api/v1/my-work?group=due", d.TechAClient, "UTC")).GetProperty("bucketCounts");
        a.GetProperty("asap").GetInt32().ShouldBe(4);
        a.GetProperty("overdue").GetInt32().ShouldBe(1);
        var bad = await d.TechAClient.GetAsync("/api/v1/my-work?group=priority");
        bad.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Theory]
    [InlineData("UTC")]
    [InlineData("America/Los_Angeles")]
    [InlineData("Pacific/Kiritimati")]
    public async Task The_needs_attention_strip_counts_the_whole_open_set_and_equals_the_grid_for_the_same_filter(string zone)
    {
        var d = await DataAsync();
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, TimeZoneInfo.FindSystemTimeZoneById(zone))).ToString("yyyy-MM-dd");
        foreach (var client in new[] { d.TechAClient, d.TechBClient })
        {
            var plain = await d.GetAsync("/api/v1/my-work?pageSize=100", client, zone);
            var strip = plain.GetProperty("attention");
            async Task<int> TotalAsync(string filter) =>
                (await d.GetAsync("/api/v1/my-work?pageSize=1&" + filter, client, zone)).GetProperty("total").GetInt32();

            strip.GetProperty("overdue").GetInt32().ShouldBe(await TotalAsync("overdue=true"));
            strip.GetProperty("dueToday").GetInt32().ShouldBe(await TotalAsync($"dueFrom={today}&dueTo={today}&overdue=false"));
            strip.GetProperty("asap").GetInt32().ShouldBe(await TotalAsync("asap=true"));
            strip.GetProperty("onHold").GetInt32().ShouldBe(await TotalAsync("status=ON_HOLD"));

            // The strip is a stable overview: no grid filter and no tab changes it.
            var filtered = await d.GetAsync($"/api/v1/my-work?view=dueSoon&pod={d.PodB}&status=IN_PROGRESS", client, zone);
            filtered.GetProperty("attention").ToString().ShouldBe(strip.ToString());
        }

        var a = (await d.GetAsync("/api/v1/my-work", d.TechAClient, "UTC")).GetProperty("attention");
        a.GetProperty("overdue").GetInt32().ShouldBe(1);
        a.GetProperty("asap").GetInt32().ShouldBe(4);
        a.GetProperty("onHold").GetInt32().ShouldBe(1);
    }

    [Theory]
    [InlineData("UTC")]
    [InlineData("America/Los_Angeles")]
    [InlineData("Pacific/Kiritimati")]
    public async Task Assigned_from_lists_the_new_tasks_and_the_strip_count_equals_the_grid_total(string zone)
    {
        var d = await DataAsync();
        foreach (var client in new[] { d.TechAClient, d.TechBClient })
        {
            string Url(string extra) => "/api/v1/my-work?pageSize=100" + extra;
            var all = await d.GetAsync(Url(string.Empty), client, zone);
            // Without assignedFrom nothing is counted: the item is hidden.
            all.GetProperty("attention").GetProperty("new").ValueKind.ShouldBe(System.Text.Json.JsonValueKind.Null);

            // newSince alone only counts: the rows are not narrowed.
            var countOnly = await d.GetAsync(Url("&newSince=" + Uri.EscapeDataString(DateTime.UtcNow.AddDays(1).ToString("O"))), client, zone);
            countOnly.GetProperty("total").GetInt32().ShouldBe(all.GetProperty("total").GetInt32());
            countOnly.GetProperty("attention").GetProperty("new").GetInt32().ShouldBe(0);

            var instant = "2000-01-01T00:00:00Z";
            var longAgo = await d.GetAsync(Url($"&assignedFrom={instant}&newSince={instant}"), client, zone);
            longAgo.GetProperty("total").GetInt32().ShouldBe(all.GetProperty("total").GetInt32());
            longAgo.GetProperty("attention").GetProperty("new").GetInt32().ShouldBe(longAgo.GetProperty("total").GetInt32());

            instant = Uri.EscapeDataString(DateTime.UtcNow.AddDays(1).ToString("O"));
            var future = await d.GetAsync(Url($"&assignedFrom={instant}&newSince={instant}"), client, zone);
            future.GetProperty("total").GetInt32().ShouldBe(0);
            future.GetProperty("attention").GetProperty("new").GetInt32().ShouldBe(0);
            // Every tab count follows the filter, and the strip never depends on the zone or other filters.
            future.GetProperty("counts").GetProperty("active").GetInt32().ShouldBe(0);
        }

        // The boundary is exclusive: a task assigned exactly at the instant is not new, one millisecond earlier it is. An offset is converted.
        var first = (await MyWorkAsync(d, d.TechAClient)).GetProperty("items").EnumerateArray()
            .Select(r => r.GetProperty("assignedAtUtc").GetString() ?? r.GetProperty("createdAtUtc").GetString()!)
            .Select(v => DateTime.Parse(v!, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AdjustToUniversal)).Max();
        async Task<int> NewAsync(DateTime from)
        {
            var at = Uri.EscapeDataString(new DateTimeOffset(from, TimeSpan.Zero).ToString("O"));
            var page = await d.GetAsync($"/api/v1/my-work?pageSize=1&assignedFrom={at}&newSince={at}", d.TechAClient);
            // The strip item equals the filtered grid for the same instant.
            page.GetProperty("attention").GetProperty("new").GetInt32().ShouldBe(page.GetProperty("total").GetInt32());
            return page.GetProperty("total").GetInt32();
        }

        (await NewAsync(first)).ShouldBe(0);
        (await NewAsync(first.AddMilliseconds(-1))).ShouldBeGreaterThan(0);
        var offset = new DateTimeOffset(first.AddMilliseconds(-1)).ToOffset(TimeSpan.FromHours(-7)).ToString("O");
        (await d.GetAsync("/api/v1/my-work?pageSize=1&assignedFrom=" + Uri.EscapeDataString(offset), d.TechAClient)).GetProperty("total").GetInt32().ShouldBeGreaterThan(0);
    }

    [Fact]
    public async Task An_invalid_assigned_from_is_a_400()
    {
        var d = await DataAsync();
        foreach (var (bad, name) in new[] { ("yesterday", "assignedFrom"), ("2026-13-45", "assignedFrom"), ("", "assignedFrom"), ("soon", "newSince") })
        {
            var response = await d.TechAClient.GetAsync($"/api/v1/my-work?{name}={bad}");
            // An empty value is "not given"; anything else that is not an instant is rejected.
            response.StatusCode.ShouldBe(bad.Length == 0 ? HttpStatusCode.OK : HttpStatusCode.BadRequest);
        }
    }

    [Fact]
    public async Task My_work_filters_apply_to_the_rows_and_to_every_tab_count()
    {
        var d = await DataAsync();
        var byPod = await MyWorkAsync(d, d.TechAClient, $"pod={d.PodB}");
        TitlesOf(byPod).ShouldBe(Of("mine-pod-b"));
        byPod.GetProperty("counts").GetProperty("active").GetInt32().ShouldBe(1);
        byPod.GetProperty("counts").GetProperty("dueSoon").GetInt32().ShouldBe(0);
        byPod.GetProperty("counts").GetProperty("completed").GetInt32().ShouldBe(0);

        var held = await MyWorkAsync(d, d.TechAClient, "status=ON_HOLD");
        TitlesOf(held).ShouldBe(Of("mine-hold"));
        held.GetProperty("counts").GetProperty("completed").GetInt32().ShouldBe(0);

        TitlesOf(await MyWorkAsync(d, d.TechAClient, "q=MINE-FAR")).ShouldBe(Of("mine-far"));
        TitlesOf(await MyWorkAsync(d, d.TechAClient, $"priority={d.High}")).ShouldBe(Of("mine-asap"));
        TitlesOf(await MyWorkAsync(d, d.TechAClient, "view=completed&completedFrom=2099-01-01")).ShouldBeEmpty();
        TitlesOf(await MyWorkAsync(d, d.TechAClient, $"view=completed&completedFrom={DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1)):yyyy-MM-dd}")).ShouldBe(Of("mine-cancelled", "mine-done"));
    }

    [Fact]
    public async Task The_completed_tabs_closed_date_window_does_not_change_the_other_tab_counts()
    {
        var d = await DataAsync();
        var onActive = (await MyWorkAsync(d, d.TechAClient)).GetProperty("counts");

        // The web app asks for the Completed tab with a 90-day window; Active, Due soon and Created by me must read the same as on any tab.
        var window = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-90)).ToString("yyyy-MM-dd");
        foreach (var query in new[] { $"view=completed&completedFrom={window}", "view=completed&completedFrom=2099-01-01", "view=completed" })
        {
            var counts = (await MyWorkAsync(d, d.TechAClient, query)).GetProperty("counts");
            counts.GetProperty("active").GetInt32().ShouldBe(onActive.GetProperty("active").GetInt32(), query);
            counts.GetProperty("dueSoon").GetInt32().ShouldBe(onActive.GetProperty("dueSoon").GetInt32(), query);
            counts.GetProperty("createdByMe").GetInt32().ShouldBe(onActive.GetProperty("createdByMe").GetInt32(), query);
        }

        // The Completed count is the same on every tab (default window), and an explicit range changes only the Completed tab.
        (await MyWorkAsync(d, d.TechAClient, $"view=completed&completedFrom={window}")).GetProperty("counts").GetProperty("completed").GetInt32()
            .ShouldBe(onActive.GetProperty("completed").GetInt32());
        (await MyWorkAsync(d, d.TechAClient, "view=completed&completedFrom=2099-01-01")).GetProperty("counts").GetProperty("completed").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task My_work_pages_and_validates()
    {
        var d = await DataAsync();
        var page1 = await d.GetAsync("/api/v1/my-work?pageSize=3&page=1", d.TechAClient);
        var page3 = await d.GetAsync("/api/v1/my-work?pageSize=3&page=3", d.TechAClient);
        page1.GetProperty("total").GetInt32().ShouldBe(7);
        TitlesOf(page1).ShouldBe(Of("mine-asap", "mine-hold", "mine-pod-a"));
        TitlesOf(page3).ShouldBe(Of("mine-far"));

        TitlesOf(await d.GetAsync("/api/v1/my-work?sort=number&dir=desc&pageSize=2", d.TechAClient)).Count.ShouldBe(2);

        await ProblemAsync(await d.TechAClient.GetAsync("/api/v1/my-work?view=nope"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await d.TechAClient.GetAsync("/api/v1/my-work?podId=1"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task Due_soon_is_evaluated_in_the_viewers_zone()
    {
        var d = await DataAsync();
        // "mine-soon" is due tomorrow's UTC date. For a viewer whose local date is two days or more behind that, it is not yet "soon":
        // Pago Pago can be at most one day behind UTC, so it stays inside the window for everyone; check the window edge with an explicit zone.
        var pago = await d.GetAsync("/api/v1/my-work?view=dueSoon", d.TechAClient, "Pacific/Pago_Pago");
        TitlesOf(pago).ShouldContain("mine-soon");
        var kiritimati = await d.GetAsync("/api/v1/my-work?view=dueSoon", d.TechAClient, "Pacific/Kiritimati");
        TitlesOf(kiritimati).ShouldContain("mine-soon");
        kiritimati.GetProperty("timeZone").GetString().ShouldBe("Pacific/Kiritimati");
    }

    // ---- Pod Work

    [Fact]
    public async Task Pod_work_defaults_to_my_primary_pod_and_scopes_the_tabs()
    {
        var d = await DataAsync();
        var queue = await PodWorkAsync(d, d.TechAClient);
        queue.GetProperty("pod").GetProperty("name").GetString().ShouldBe("Pod A");
        queue.GetProperty("view").GetString().ShouldBe("queue");

        // Assigned to the Pod but to no person: High first, then ASAP above the overdue date.
        TitlesOf(queue).ShouldBe(Of("poda-queue-1", "poda-hold", "poda-queue-2"));
        TitlesOf(await PodWorkAsync(d, d.TechAClient, "view=members")).ShouldBeSet(["poda-member", "mine-pod-a"]);
        TitlesOf(await PodWorkAsync(d, d.TechAClient, "view=attention")).ShouldBeSet(["poda-hold", "poda-queue-2"]);
        TitlesOf(await PodWorkAsync(d, d.TechAClient, "view=all")).ShouldBeSet(["poda-queue-1", "poda-queue-2", "poda-hold", "poda-member", "mine-pod-a"]);

        // Other Pods' work and finished work never show.
        TitlesOf(await PodWorkAsync(d, d.TechAClient, "view=all")).ShouldNotContain("podb-queue");
        TitlesOf(await PodWorkAsync(d, d.TechAClient, "view=all")).ShouldNotContain("poda-done");
    }

    [Fact]
    public async Task Pod_work_summary_counts_and_member_loads()
    {
        var d = await DataAsync();
        var page = await PodWorkAsync(d, d.TechAClient);
        var summary = page.GetProperty("summary");
        summary.GetProperty("unassignedToPerson").GetInt32().ShouldBe(3);
        summary.GetProperty("assigned").GetInt32().ShouldBe(2);
        summary.GetProperty("overdue").GetInt32().ShouldBe(1);
        summary.GetProperty("onHold").GetInt32().ShouldBe(1);

        var counts = page.GetProperty("counts");
        counts.GetProperty("queue").GetInt32().ShouldBe(3);
        counts.GetProperty("members").GetInt32().ShouldBe(2);
        counts.GetProperty("attention").GetInt32().ShouldBe(2);
        counts.GetProperty("all").GetInt32().ShouldBe(5);
        page.GetProperty("total").GetInt32().ShouldBe(3);

        var loads = page.GetProperty("memberLoads").EnumerateArray().ToList();
        loads.Count.ShouldBe(2);
        loads.Single(l => l.GetProperty("userId").GetInt32() == d.TechA).GetProperty("open").GetInt32().ShouldBe(1);
        loads.Single(l => l.GetProperty("userId").GetInt32() == d.TechB).GetProperty("open").GetInt32().ShouldBe(1);
        loads.ShouldAllBe(l => l.GetProperty("isMember").GetBoolean());

        // Filters narrow the tab counts, not the Pod summary.
        var filtered = await PodWorkAsync(d, d.TechAClient, $"priority={d.High}");
        filtered.GetProperty("counts").GetProperty("all").GetInt32().ShouldBe(1);
        filtered.GetProperty("summary").GetProperty("assigned").GetInt32().ShouldBe(2);
    }

    [Fact]
    public async Task Pod_work_for_another_pod_and_the_pod_selector()
    {
        var d = await DataAsync();
        var b = await PodWorkAsync(d, d.TechAClient, $"podId={d.PodB}");
        b.GetProperty("pod").GetProperty("podId").GetInt32().ShouldBe(d.PodB);
        TitlesOf(b).ShouldBe(Of("podb-queue"));
        TitlesOf(await PodWorkAsync(d, d.TechAClient, $"podId={d.PodB}&view=members")).ShouldBe(Of("mine-pod-b"));

        var c = await PodWorkAsync(d, d.TechAClient, $"podId={d.PodC}");
        TitlesOf(c).ShouldBe(Of("podc-queue"));
        c.GetProperty("memberLoads").GetArrayLength().ShouldBe(0); // "No members yet"

        // My Pods first (primary flagged), then the others.
        var pods = b.GetProperty("pods").EnumerateArray().ToList();
        pods.Select(p => p.GetProperty("name").GetString()).ShouldBe(["Pod A", "Pod B", "Pod C"]);
        pods.Select(p => p.GetProperty("isMember").GetBoolean()).ShouldBe([true, true, false]);
        pods.Select(p => p.GetProperty("isPrimary").GetBoolean()).ShouldBe([true, false, false]);

        // A member without a primary Pod gets the first Pod they belong to.
        (await PodWorkAsync(d, d.TechBClient)).GetProperty("pod").GetProperty("name").GetString().ShouldBe("Pod A");
    }

    [Fact]
    public async Task Pod_work_without_a_pod_and_error_cases()
    {
        var d = await DataAsync();
        var none = await PodWorkAsync(d, d.H.Admin); // the admin belongs to no Pod
        none.GetProperty("pod").ValueKind.ShouldBe(System.Text.Json.JsonValueKind.Null);
        none.GetProperty("items").GetArrayLength().ShouldBe(0);
        none.GetProperty("pods").GetArrayLength().ShouldBe(3);

        await ProblemAsync(await d.TechAClient.GetAsync("/api/v1/pod-work?podId=99999"), HttpStatusCode.NotFound, "NOT_FOUND");
        await ProblemAsync(await d.TechAClient.GetAsync("/api/v1/pod-work?view=nope"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await d.TechAClient.GetAsync($"/api/v1/pod-work?pod={d.PodA}"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");

        // Pod Work needs Pod.View on top of Task.View.
        var taskOnly = await d.H.UserWithAsync(@"KE\taskonly", "Task.View");
        await ProblemAsync(await taskOnly.GetAsync("/api/v1/pod-work"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        (await taskOnly.GetAsync("/api/v1/my-work")).StatusCode.ShouldBe(HttpStatusCode.OK);

        // ... and Task.View on top of Pod.View (Pod Work epic #549: the page hides the item and shows the 403 page, so it never asks; the server
        // answers 403 PERMISSION_DENIED all the same, for the page and for the pod list).
        var podOnly = await d.H.UserWithAsync(@"KE\podonly", "Pod.View", "Dashboard.View");
        await ProblemAsync(await podOnly.GetAsync("/api/v1/pod-work"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        await ProblemAsync(await podOnly.GetAsync($"/api/v1/pod-work?podId={d.PodA}&view=members"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
    }

    // ---- Pod Work epic #546: additive fields (#556 pod choices, #560 strip, #565 member loads)

    [Theory]
    [InlineData("UTC")]
    [InlineData("America/Los_Angeles")]
    [InlineData("Pacific/Kiritimati")]
    public async Task Pod_work_summary_carries_due_today_and_asap_that_equal_the_grid_totals_in_the_viewers_zone(string zone)
    {
        var d = await DataAsync();
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, TimeZoneInfo.FindSystemTimeZoneById(zone)));
        foreach (var pod in new[] { d.PodA, d.PodB, d.PodC })
        {
            async Task<int> TotalAsync(string filter) =>
                (await d.GetAsync($"/api/v1/pod-work?podId={pod}&view=all&pageSize=1&{filter}", d.TechAClient, zone)).GetProperty("total").GetInt32();

            var summary = (await d.GetAsync($"/api/v1/pod-work?podId={pod}&pageSize=1", d.TechAClient, zone)).GetProperty("summary");
            summary.GetProperty("dueToday").GetInt32().ShouldBe(await TotalAsync($"dueFrom={today:yyyy-MM-dd}&dueTo={today:yyyy-MM-dd}&overdue=false"), $"due today in pod {pod}, {zone}");
            summary.GetProperty("asap").GetInt32().ShouldBe(await TotalAsync("asap=true"), $"ASAP in pod {pod}");
            // The existing fields keep their meaning.
            summary.GetProperty("overdue").GetInt32().ShouldBe(await TotalAsync("overdue=true"));
            summary.GetProperty("unassignedToPerson").GetInt32().ShouldBe(
                (await d.GetAsync($"/api/v1/pod-work?podId={pod}&view=queue&pageSize=1", d.TechAClient, zone)).GetProperty("total").GetInt32());
        }
    }

    [Fact]
    public async Task Pod_choices_carry_member_open_unassigned_and_overdue_counts_that_equal_each_pods_summary()
    {
        var d = await DataAsync();
        var page = await PodWorkAsync(d, d.TechAClient, $"podId={d.PodA}");
        var choices = page.GetProperty("pods").EnumerateArray().ToList();
        choices.Count.ShouldBeGreaterThanOrEqualTo(3);
        foreach (var choice in choices)
        {
            var podId = choice.GetProperty("podId").GetInt32();
            var summary = (await d.GetAsync($"/api/v1/pod-work?podId={podId}&pageSize=1", d.TechAClient)).GetProperty("summary");
            choice.GetProperty("openCount").GetInt32().ShouldBe(summary.GetProperty("unassignedToPerson").GetInt32() + summary.GetProperty("assigned").GetInt32(), $"pod {podId}");
            choice.GetProperty("unassignedCount").GetInt32().ShouldBe(summary.GetProperty("unassignedToPerson").GetInt32(), $"pod {podId}");
            choice.GetProperty("overdueCount").GetInt32().ShouldBe(summary.GetProperty("overdue").GetInt32(), $"pod {podId}");
        }

        int Count(int podId, string field) => choices.Single(c => c.GetProperty("podId").GetInt32() == podId).GetProperty(field).GetInt32();
        Count(d.PodA, "memberCount").ShouldBe(2);
        Count(d.PodB, "memberCount").ShouldBe(1);
        Count(d.PodC, "memberCount").ShouldBe(0);

        // A pod with no members and no tasks reads zero everywhere. It is made inactive again afterwards: the other tests count the pods.
        var empty = await d.H.CreatePodAsync("Pod Empty " + Guid.NewGuid().ToString("N")[..8]);
        try
        {
            var fresh = (await PodWorkAsync(d, d.TechAClient, $"podId={d.PodA}")).GetProperty("pods").EnumerateArray()
                .Single(c => c.GetProperty("podId").GetInt32() == empty);
            foreach (var field in new[] { "memberCount", "openCount", "unassignedCount", "overdueCount" })
                fresh.GetProperty(field).GetInt32().ShouldBe(0, field);
        }
        finally
        {
            await d.H.ExecuteAsync($"UPDATE dbo.Pod SET IsActive = 0 WHERE PodId = {empty}");
        }
    }

    [Fact]
    public async Task Member_loads_carry_availability_the_unassigned_count_and_the_number_of_people_with_work()
    {
        var d = await DataAsync();
        var own = await OkAsync(await d.TechBClient.GetAsync("/api/v1/me/availability"));
        await OkAsync(await d.TechBClient.PutAsJsonAsync("/api/v1/me/availability", new { status = "OUT_OF_OFFICE", until = "2099-12-31", note = "Conference", rowVersion = own.GetProperty("rowVersion").GetString() }));
        try
        {
            var page = await PodWorkAsync(d, d.TechAClient, $"podId={d.PodA}&view=members");
            var loads = page.GetProperty("memberLoads").EnumerateArray().ToList();
            var techB = loads.Single(l => l.GetProperty("userId").GetInt32() == d.TechB);
            var out_ = techB.GetProperty("availability");
            out_.GetProperty("state").GetString().ShouldBe("OUT_OF_OFFICE");
            out_.GetProperty("note").GetString().ShouldBe("Conference");
            // Tech A is a member too and available (or off hours, a soft state that is never reported as unavailable): never "out of office".
            var techA = loads.Single(l => l.GetProperty("userId").GetInt32() == d.TechA);
            if (techA.TryGetProperty("availability", out var a) && a.ValueKind != System.Text.Json.JsonValueKind.Null)
                a.GetProperty("state").GetString().ShouldNotBe("OUT_OF_OFFICE");

            var queue = await PodWorkAsync(d, d.TechAClient, $"podId={d.PodA}&view=queue");
            page.GetProperty("unassigned").GetInt32().ShouldBe(queue.GetProperty("total").GetInt32());
            page.GetProperty("counts").GetProperty("membersWithWork").GetInt32().ShouldBe(loads.Count(l => l.GetProperty("open").GetInt32() > 0));
            page.GetProperty("counts").GetProperty("members").GetInt32().ShouldBe(page.GetProperty("total").GetInt32());
        }
        finally
        {
            var current = await OkAsync(await d.TechBClient.GetAsync("/api/v1/me/availability"));
            await OkAsync(await d.TechBClient.PutAsJsonAsync("/api/v1/me/availability", new { status = "AVAILABLE", rowVersion = current.GetProperty("rowVersion").GetString() }));
        }
    }
}
