using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// Dashboard v4 (issue #1065): the capacity battery and its People list. Five workers in two Pods (one of them out of office), a manager who holds no Workflow.Execute, and a worker who is in no Pod.
/// The clock is Wednesday noon in New York (everybody in the default 9 to 5 hours) and then 11 PM (everybody off hours). Expected figures are worked out here from the seeds.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class DashboardCapacityTests(SqlServerFixture sql) : IAsyncLifetime
{
    private static readonly DateTime Noon = new(2026, 10, 14, 16, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Night = new(2026, 10, 15, 3, 0, 0, DateTimeKind.Utc);

    private static readonly string[] WorkerPermissions = ["Task.View", "Workflow.Execute", "Dashboard.View", "Dashboard.ViewUsers"];

    private MutableClock _clock = null!;
    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private World _w = null!;
    private HttpClient _manager = null!;
    private int _podA;
    private int _podB;
    private int _w1;
    private int _w2;
    private int _w3;
    private int _w4;
    private int _w5;
    private int _loner;

    public async Task InitializeAsync()
    {
        _clock = new MutableClock(Noon);
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { Clock = _clock };
        _h = new TaskHarness(_factory);
        _w = await _h.CreateWorldAsync();

        // The manager can see the capacity but holds no Workflow.Execute, so is not a worker.
        _manager = await _h.UserWithAsync(@"KE\mgr", "Task.View", "Dashboard.View", "Dashboard.ViewUsers", "Pod.View");
        foreach (var name in new[] { "w1", "w2", "w3", "w4", "w5", "loner" })
            await _h.UserWithAsync($@"KE\{name}", WorkerPermissions);

        var mgr = await _h.UserIdAsync(@"KE\mgr");
        _w1 = await _h.UserIdAsync(@"KE\w1");
        _w2 = await _h.UserIdAsync(@"KE\w2");
        _w3 = await _h.UserIdAsync(@"KE\w3");
        _w4 = await _h.UserIdAsync(@"KE\w4");
        _w5 = await _h.UserIdAsync(@"KE\w5");
        _loner = await _h.UserIdAsync(@"KE\loner");
        _podA = await _h.CreatePodAsync("Pod A", mgr, _w1, _w2, _w3, _w4);
        _podB = await _h.CreatePodAsync("Pod B", _w5);

        // Loads: w1 none; w2 one; w3 two plus two on hold (not counted); w4 three; w5 (out of office) three; the loner (no Pod) two.
        await GiveAsync(_w2, 1);
        var held = await GiveAsync(_w3, 4);
        await _h.ExecuteAsync($"UPDATE dbo.Task SET StatusCode = 'ON_HOLD' WHERE TaskId IN ({held[2]}, {held[3]})");
        await GiveAsync(_w4, 3);
        await GiveAsync(_w5, 3);
        await GiveAsync(_loner, 2);

        var own = await OkAsync(await _h.Admin.GetAsync($"/api/v1/users/{_w5}/availability"));
        await OkAsync(await _h.Admin.PutAsJsonAsync($"/api/v1/users/{_w5}/availability", new { status = "OUT_OF_OFFICE", until = "2099-12-31", note = "Private note", rowVersion = own.GetProperty("rowVersion").GetString() }));
        _factory.InvalidateAll();
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<List<long>> GiveAsync(int user, int count)
    {
        var ids = new List<long>();
        for (var i = 0; i < count; i++)
            ids.Add(TaskId(await _h.CreateTaskAsync(_w, extra: new() { ["assignedUserId"] = user })));
        return ids;
    }

    private async Task<JsonElement> CapacityAsync(string query = "", HttpClient? client = null) => await OkAsync(await (client ?? _h.Admin).GetAsync("/api/v1/dashboard/capacity" + query));

    private async Task<JsonElement> PeopleAsync(string query = "", HttpClient? client = null) => await OkAsync(await (client ?? _h.Admin).GetAsync("/api/v1/dashboard/capacity/people" + query));

    private static Dictionary<string, int> States(JsonElement capacity) => capacity.GetProperty("states").EnumerateArray().ToDictionary(s => s.GetProperty("state").GetString()!, s => s.GetProperty("count").GetInt32());

    [Fact]
    public async Task All_pods_count_the_workers_of_any_active_pod_and_leave_out_the_unavailable_from_the_denominator()
    {
        var c = await CapacityAsync();
        c.GetProperty("state").GetString().ShouldBe("OK");
        c.GetProperty("workers").GetInt32().ShouldBe(5); // w1..w5; the manager holds no Workflow.Execute and the loner is in no pod
        c.GetProperty("presentWorkers").GetInt32().ShouldBe(4);
        c.GetProperty("slotsPerPerson").GetInt32().ShouldBe(3);
        c.GetProperty("totalSlots").GetInt32().ShouldBe(12);
        c.GetProperty("freeSlots").GetInt32().ShouldBe(3 + 2 + 1 + 0);
        c.GetProperty("freePercent").GetInt32().ShouldBe(50);
        c.GetProperty("usedPercent").GetInt32().ShouldBe(50);
        c.GetProperty("canTakeWork").GetInt32().ShouldBe(3);
        c.GetProperty("assignedLastHour").GetInt32().ShouldBe(1 + 4 + 3 + 3);

        c.GetProperty("states").EnumerateArray().Select(s => s.GetProperty("state").GetString()).ShouldBe(["AVAILABLE", "OCCUPIED", "BUSY", "OVERLOADED", "OUT_OF_OFFICE", "OFF_HOURS"]);
        var states = States(c);
        states.ShouldBe(new Dictionary<string, int> { ["AVAILABLE"] = 1, ["OCCUPIED"] = 1, ["BUSY"] = 1, ["OVERLOADED"] = 1, ["OUT_OF_OFFICE"] = 1, ["OFF_HOURS"] = 0 });
        states.Values.Sum().ShouldBe(c.GetProperty("workers").GetInt32());
    }

    [Fact]
    public async Task A_pod_lead_sees_the_workers_of_their_pods_on_my_pods_and_any_pod_can_be_chosen()
    {
        var mine = await CapacityAsync("?podScope=mine", _manager);
        mine.GetProperty("workers").GetInt32().ShouldBe(4);
        mine.GetProperty("totalSlots").GetInt32().ShouldBe(12);
        mine.GetProperty("freeSlots").GetInt32().ShouldBe(6);
        States(mine)["OUT_OF_OFFICE"].ShouldBe(0);

        // Pod B holds the one worker who is out of office: nobody can take work, but it is not "after hours".
        var b = await CapacityAsync($"?podScope={_podB}");
        b.GetProperty("workers").GetInt32().ShouldBe(1);
        b.GetProperty("state").GetString().ShouldBe("ALL_OUT");
        b.GetProperty("usedPercent").ValueKind.ShouldBe(JsonValueKind.Null);
        b.GetProperty("freePercent").ValueKind.ShouldBe(JsonValueKind.Null);
        b.GetProperty("totalSlots").GetInt32().ShouldBe(0);
        b.GetProperty("canTakeWork").GetInt32().ShouldBe(0);

        (await _h.Admin.GetAsync("/api/v1/dashboard/capacity?podScope=99999")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task An_empty_scope_is_zero_workers_not_an_error()
    {
        var empty = await _h.CreatePodAsync("Empty pod");
        var c = await CapacityAsync($"?podScope={empty}");
        c.GetProperty("state").GetString().ShouldBe("NO_WORKERS");
        c.GetProperty("workers").GetInt32().ShouldBe(0);
        c.GetProperty("totalSlots").GetInt32().ShouldBe(0);
        c.GetProperty("assignedLastHour").GetInt32().ShouldBe(0);
        c.GetProperty("usedPercent").ValueKind.ShouldBe(JsonValueKind.Null);
        States(c).Values.ShouldAllBe(v => v == 0);
        (await PeopleAsync($"?podScope={empty}")).GetArrayLength().ShouldBe(0);
    }

    [Fact]
    public async Task After_hours_nobody_can_take_work_and_the_battery_says_so_instead_of_reading_one_hundred_percent()
    {
        _clock.UtcNow = Night; // 11 PM in New York
        var c = await CapacityAsync();
        c.GetProperty("state").GetString().ShouldBe("AFTER_HOURS");
        c.GetProperty("workers").GetInt32().ShouldBe(5);
        c.GetProperty("presentWorkers").GetInt32().ShouldBe(0);
        c.GetProperty("totalSlots").GetInt32().ShouldBe(0);
        c.GetProperty("canTakeWork").GetInt32().ShouldBe(0);
        c.GetProperty("usedPercent").ValueKind.ShouldBe(JsonValueKind.Null);
        c.GetProperty("freePercent").ValueKind.ShouldBe(JsonValueKind.Null);
        States(c).ShouldBe(new Dictionary<string, int> { ["AVAILABLE"] = 0, ["OCCUPIED"] = 0, ["BUSY"] = 0, ["OVERLOADED"] = 0, ["OUT_OF_OFFICE"] = 1, ["OFF_HOURS"] = 4 });
    }

    [Fact]
    public async Task The_people_list_has_name_state_and_load_only_most_loaded_first_and_filters()
    {
        var people = (await PeopleAsync()).EnumerateArray().ToList();
        people.Select(p => p.GetProperty("displayName").GetString()).Count().ShouldBe(5);
        people.Select(p => p.GetProperty("userId").GetInt32()).ShouldBe([_w4, _w3, _w2, _w1, _w5]);
        people.Select(p => p.GetProperty("state").GetString()).ShouldBe(["OVERLOADED", "BUSY", "OCCUPIED", "AVAILABLE", "OUT_OF_OFFICE"]);
        people.Select(p => p.GetProperty("load").GetInt32()).ShouldBe([3, 2, 1, 0, 3]);
        people[1].GetProperty("podNames").EnumerateArray().Select(n => n.GetString()).ShouldBe(["Pod A"]);
        people[4].GetProperty("outUntil").GetString().ShouldBe("2099-12-31");
        people[0].GetProperty("outUntil").ValueKind.ShouldBe(JsonValueKind.Null);

        // Only these properties leave the server: no task, matter, title or note.
        foreach (var p in people)
            p.EnumerateObject().Select(x => x.Name).Order().ShouldBe(["displayName", "load", "outUntil", "podNames", "state", "userId"]);
        people.Aggregate(string.Empty, (all, p) => all + p.GetRawText()).ShouldNotContain("Private note");

        (await PeopleAsync("?q=w3")).GetArrayLength().ShouldBe(1);
        (await PeopleAsync("?state=BUSY")).EnumerateArray().Single().GetProperty("userId").GetInt32().ShouldBe(_w3);
        (await PeopleAsync("?state=busy")).GetArrayLength().ShouldBe(1);
        (await PeopleAsync($"?podScope={_podB}")).EnumerateArray().Single().GetProperty("userId").GetInt32().ShouldBe(_w5);
        (await _h.Admin.GetAsync("/api/v1/dashboard/capacity/people?state=NOPE")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _h.Admin.GetAsync("/api/v1/dashboard/capacity/people?bogus=1")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Without_the_users_permission_both_endpoints_answer_403()
    {
        var technician = await _h.UserWithAsync(@"KE\tech", "Task.View", "Dashboard.View", "Dashboard.ViewUnassigned");
        (await technician.GetAsync("/api/v1/dashboard/capacity")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await technician.GetAsync("/api/v1/dashboard/capacity/people")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        var summary = await _h.UserWithAsync(@"KE\summary", "Task.View", "Dashboard.View", "Dashboard.ViewSummary");
        (await summary.GetAsync("/api/v1/dashboard/capacity")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await summary.GetAsync("/api/v1/dashboard/capacity/people")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task The_assignee_lookup_reports_the_same_state_and_load()
    {
        var items = await OkAsync(await _h.Admin.GetAsync("/api/v1/users/lookup?limit=50"));
        JsonElement Item(int id) => items.EnumerateArray().Single(i => i.GetProperty("userId").GetInt32() == id);

        Item(_w1).GetProperty("capacityState").GetString().ShouldBe("AVAILABLE");
        Item(_w1).GetProperty("load").GetInt32().ShouldBe(0);
        Item(_w2).GetProperty("capacityState").GetString().ShouldBe("OCCUPIED");
        Item(_w3).GetProperty("capacityState").GetString().ShouldBe("BUSY");
        Item(_w3).GetProperty("load").GetInt32().ShouldBe(2); // the two tasks on hold are not load
        Item(_w3).GetProperty("openTaskCount").GetInt32().ShouldBe(4); // the existing field keeps counting On hold
        Item(_w4).GetProperty("capacityState").GetString().ShouldBe("OVERLOADED");
        Item(_w5).GetProperty("capacityState").GetString().ShouldBe("OUT_OF_OFFICE");
        Item(_loner).GetProperty("capacityState").GetString().ShouldBe("BUSY"); // the lookup is not limited to pod members

        // Same people, same state as the battery's People list.
        var people = (await PeopleAsync()).EnumerateArray().ToDictionary(p => p.GetProperty("userId").GetInt32(), p => p.GetProperty("state").GetString());
        foreach (var (id, state) in people)
            Item(id).GetProperty("capacityState").GetString().ShouldBe(state);

        _clock.UtcNow = Night;
        var night = await OkAsync(await _h.Admin.GetAsync("/api/v1/users/lookup?limit=50"));
        night.EnumerateArray().Single(i => i.GetProperty("userId").GetInt32() == _w1).GetProperty("capacityState").GetString().ShouldBe("OFF_HOURS");
    }

    [Fact]
    public async Task The_number_of_statements_does_not_grow_with_the_number_of_workers()
    {
        var log = new CommandLog();
        await using var logged = _factory.WithWebHostBuilder(b => b.ConfigureServices(s => s.AddLogging(l =>
        {
            l.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Information);
            l.AddProvider(log);
        })));
        var http = logged.CreateClient();
        http.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        http.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);

        async Task<int> CountAsync(string url)
        {
            await OkAsync(await http.GetAsync(url));
            log.Clear();
            await OkAsync(await http.GetAsync(url));
            return log.Snapshot().Count;
        }

        var urls = new[] { "/api/v1/dashboard/capacity", "/api/v1/dashboard/capacity/people" };
        var before = new List<int>();
        foreach (var url in urls)
            before.Add(await CountAsync(url));

        var roleId = await _factory.CreateRoleAsync("Bulk workers", WorkerPermissions);
        var ids = new List<int>();
        for (var i = 0; i < 40; i++)
        {
            var name = $@"KE\bulk{i:D2}";
            await _h.As(name).GetAsync("/api/v1/me");
            await _factory.GrantRoleAsync(name, roleId);
            ids.Add(await _h.UserIdAsync(name));
        }

        await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/pods/{_podB}/members", new { userIds = ids.ToArray() }));
        for (var i = 0; i < urls.Length; i++)
            (await CountAsync(urls[i])).ShouldBe(before[i], urls[i]);

        (await CapacityAsync()).GetProperty("workers").GetInt32().ShouldBe(45);
    }

    [Fact]
    public async Task A_hidden_sensitive_task_counts_as_load_but_only_as_a_number_and_no_name_or_id_is_returned()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            // TS3 (a task on a sensitive matter the unrelated user cannot see) is held by the assignee. Both are workers of one pod.
            await u.H.CreatePodAsync("Capacity pod", u.Assignee, u.Unrelated);
            u.H.Factory.InvalidateAll();

            var capacity = await OkAsync(await u.UnrelatedClient.GetAsync("/api/v1/dashboard/capacity"));
            capacity.GetProperty("workers").GetInt32().ShouldBe(2);
            capacity.GetProperty("states").EnumerateArray().Sum(s => s.GetProperty("count").GetInt32()).ShouldBe(2);

            var people = (await OkAsync(await u.UnrelatedClient.GetAsync("/api/v1/dashboard/capacity/people"))).EnumerateArray().ToList();
            people.Single(p => p.GetProperty("userId").GetInt32() == u.Assignee).GetProperty("load").GetInt32().ShouldBe(1); // the hidden task is real load
            people.Single(p => p.GetProperty("userId").GetInt32() == u.Unrelated).GetProperty("load").GetInt32().ShouldBe(0);

            // The visibility-filtered board shows the lower, visible number for the same person: the capacity figure is the deliberate exception.
            var workload = await OkAsync(await u.UnrelatedClient.GetAsync("/api/v1/dashboard/workload"));
            workload.GetProperty("users").EnumerateArray().Single(w => w.GetProperty("userId").GetInt32() == u.Assignee).GetProperty("openTotal").GetInt32().ShouldBe(0);

            // Nothing of the task or its matter leaves the server.
            var text = capacity.GetRawText() + people.Aggregate(string.Empty, (all, p) => all + p.GetRawText());
            text.ShouldNotContain(SensitiveUniverse.SentinelPrefix);
            foreach (var forbidden in new[] { "taskId", "matterId", "matterName", "matterRef", "title", "projectId" })
                text.ShouldNotContain($"\"{forbidden}\"");
            capacity.EnumerateObject().Select(x => x.Name).Order().ShouldBe(new[] { "assignedLastHour", "asOfUtc", "canTakeWork", "freePercent", "freeSlots", "presentWorkers", "slotsPerPerson", "state", "states", "totalSlots", "usedPercent", "workers" }.Order());

            // Without the permission neither endpoint answers at all.
            (await u.NoPermClient.GetAsync("/api/v1/dashboard/capacity")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await u.NoPermClient.GetAsync("/api/v1/dashboard/capacity/people")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }
}
