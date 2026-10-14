using System.Net;
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
    }
}
