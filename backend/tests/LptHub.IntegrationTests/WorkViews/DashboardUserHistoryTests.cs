using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// Dashboard Users person history and Skills matrix (issue #1092). The clock is Wednesday 2026-10-14 noon in New York (the firm works 8 to 18, Monday to Friday). Completed Tasks are
/// forced to COMPLETED with SQL (completion time) and get a synthetic "to In progress" audit event at a chosen time, earlier than the real events the API wrote, so every duration is known.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class DashboardUserHistoryTests(SqlServerFixture sql) : IAsyncLifetime
{
    private static readonly DateTime Noon = new(2026, 10, 14, 16, 0, 0, DateTimeKind.Utc);
    private static readonly string[] Worker = ["Task.View", "Workflow.Execute", "Dashboard.View", "Dashboard.ViewUsers"];

    private MutableClock _clock = null!;
    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private World _w = null!;
    private HttpClient _viewer = null!;
    private HttpClient _noPerm = null!;
    private int _typeA;
    private int _typeB;
    private int _alice;
    private int _bob;
    private int _carol;
    private int _outsider;
    private int _podX;
    private int _podY;

    public async Task InitializeAsync()
    {
        _clock = new MutableClock(Noon);
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { Clock = _clock };
        _h = new TaskHarness(_factory);
        _w = await _h.CreateWorldAsync();
        _typeA = _w.TaskTypeId;
        _typeB = await _h.CreateTaskTypeAsync("History Review", [_w.OrderedWorkflowId, _w.UnorderedWorkflowId]);

        _viewer = await _h.UserWithAsync(@"KE\hviewer", "Task.View", "Dashboard.View", "Dashboard.ViewUsers", "Pod.View");
        _noPerm = await _h.UserWithAsync(@"KE\hnoperm", "Task.View", "Dashboard.View");
        foreach (var name in new[] { "alice", "bob", "carol", "outsider" })
            await _h.UserWithAsync($@"KE\h{name}", Worker);
        _alice = await _h.UserIdAsync(@"KE\halice");
        _bob = await _h.UserIdAsync(@"KE\hbob");
        _carol = await _h.UserIdAsync(@"KE\hcarol");
        _outsider = await _h.UserIdAsync(@"KE\houtsider");
        _podX = await _h.CreatePodAsync("Pod X", _alice, _bob);
        _podY = await _h.CreatePodAsync("Pod Y", _carol);

        // Alice, type A: durations 60, 120, 180, 240, 300 working minutes on Tuesday 2026-10-13 (10:00 New York = 14:00 UTC), completed the same day.
        foreach (var minutes in new[] { 60, 120, 180, 240, 300 })
            await CompletedAsync(_typeA, _alice, Tue(14, 0), Tue(14, 0).AddMinutes(minutes));
        // Bob, type A: five Tasks of 120 minutes. Firm sample for A: ten, median (120 + 120) / 2.
        for (var i = 0; i < 5; i++)
            await CompletedAsync(_typeA, _bob, Tue(14, 0), Tue(16, 0));
        // Alice, type B: four Tasks (below the sample size of five): counted, no median.
        for (var i = 0; i < 4; i++)
            await CompletedAsync(_typeB, _alice, Tue(14, 0), Tue(15, 0));
        // Alice, type A, five months ago (outside the 3 month window, inside 12 months): counted in the 12 month window only.
        await CompletedAsync(_typeA, _alice, new DateTime(2026, 5, 12, 14, 0, 0, DateTimeKind.Utc), new DateTime(2026, 5, 12, 15, 0, 0, DateTimeKind.Utc));
        // Alice, type A, 14 months ago: outside both windows and the series.
        await CompletedAsync(_typeA, _alice, new DateTime(2025, 8, 12, 14, 0, 0, DateTimeKind.Utc), new DateTime(2025, 8, 12, 15, 0, 0, DateTimeKind.Utc));
        // Alice, type A: cancelled never counts; a completed one that never started has a count but no duration.
        await CancelledAsync(_typeA, _alice);
        await CompletedAsync(_typeA, _alice, null, Tue(17, 0));
        // Carol (Pod Y) has five Tasks of type B, Dave-less: experienced with B.
        for (var i = 0; i < 5; i++)
            await CompletedAsync(_typeB, _carol, Tue(14, 0), Tue(15, 0));
        // The outsider (no pod) completed type A.
        await CompletedAsync(_typeA, _outsider, Tue(14, 0), Tue(15, 0));
        // Due dates for Alice's type A Tasks (the five of 2026-10-13): three on time (due the 13th), two late (due the 12th).
        _factory.InvalidateAll();
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static DateTime Tue(int hour, int minute) => new(2026, 10, 13, hour, minute, 0, DateTimeKind.Utc);

    private async Task<long> CompletedAsync(int typeId, int user, DateTime? startedUtc, DateTime completedUtc)
    {
        var task = await _h.CreateTaskAsync(_w with { TaskTypeId = typeId }, ordered: false, extra: new() { ["assignedUserId"] = user });
        var id = TaskId(task);
        await _h.ExecuteAsync($"UPDATE dbo.Task SET StatusCode = 'COMPLETED', StatusChangedAt = '{completedUtc:yyyy-MM-ddTHH:mm:ss.fff}', CompletedAt = '{completedUtc:yyyy-MM-ddTHH:mm:ss.fff}' WHERE TaskId = {id}");
        if (startedUtc is { } start)
            await _h.ExecuteAsync($"""
                INSERT INTO dbo.AuditEvent (OccurredAtUtc, EventType, ObjectType, ObjectId, MatterId, TaskId, FieldKey, OldValue, NewValue, CorrelationId)
                VALUES ('{start:yyyy-MM-ddTHH:mm:ss.fff}', 'TASK_STATUS_CHANGED', 'Task', '{id}', {_w.MatterId}, {id}, 'status', 'NEW', 'IN_PROGRESS', NEWID())
                """);
        return id;
    }

    private async Task CancelledAsync(int typeId, int user)
    {
        var task = await _h.CreateTaskAsync(_w with { TaskTypeId = typeId }, ordered: false, extra: new() { ["assignedUserId"] = user });
        await _h.ExecuteAsync($"UPDATE dbo.Task SET StatusCode = 'CANCELLED', StatusChangedAt = '2026-10-13T16:00:00' WHERE TaskId = {TaskId(task)}");
    }

    private async Task<JsonElement> HistoryAsync(int user, string query = "", HttpClient? client = null) =>
        await OkAsync(await (client ?? _viewer).GetAsync($"/api/v1/dashboard/users/{user}/history{query}"));

    private async Task<JsonElement> SkillsAsync(string query = "", HttpClient? client = null) =>
        await OkAsync(await (client ?? _viewer).GetAsync("/api/v1/dashboard/users/skills" + query));

    private static JsonElement Type(JsonElement history, int typeId) => history.GetProperty("types").EnumerateArray().Single(t => t.GetProperty("taskTypeId").GetInt32() == typeId);

    [Fact]
    public async Task History_compares_the_median_duration_with_the_firm_median_per_type()
    {
        var h = await HistoryAsync(_alice);
        h.GetProperty("windowMonths").GetInt32().ShouldBe(12);
        h.GetProperty("durationBasis").GetString().ShouldBe("WORKING");
        h.GetProperty("durationUnit").GetString().ShouldBe("MINUTES");
        h.GetProperty("minSampleSize").GetInt32().ShouldBe(5);

        var a = Type(h, _typeA);
        a.GetProperty("completed").GetInt32().ShouldBe(5 + 1 + 1); // five on Tuesday, May, the one that never started; the cancelled and the 14 months old one do not count
        a.GetProperty("sampleSize").GetInt32().ShouldBe(6); // the one that never started has no duration
        // Durations 60, 120, 180, 240, 300 and the May Task of 60: sorted 60, 60, 120, 180, 240, 300 -> median 150.
        a.GetProperty("medianMinutes").GetDouble().ShouldBe(150);
        // Firm: Alice's six plus Bob's five of 120 plus the outsider's 60: 60, 60, 60, 120 x6, 180, 240, 300 -> 12 samples, median (120 + 120) / 2.
        a.GetProperty("firmSampleSize").GetInt32().ShouldBe(12);
        a.GetProperty("firmMedianMinutes").GetDouble().ShouldBe(120);
        a.GetProperty("ratio").GetDouble().ShouldBe(1.25);

        var b = Type(h, _typeB);
        b.GetProperty("completed").GetInt32().ShouldBe(4);
        b.GetProperty("sampleSize").GetInt32().ShouldBe(4);
        b.GetProperty("medianMinutes").ValueKind.ShouldBe(JsonValueKind.Null);
        b.GetProperty("ratio").ValueKind.ShouldBe(JsonValueKind.Null);
        b.GetProperty("firmSampleSize").GetInt32().ShouldBe(9); // Alice's four and Carol's five
        b.GetProperty("firmMedianMinutes").GetDouble().ShouldBe(60);

        h.GetProperty("totalCompleted").GetInt32().ShouldBe(7 + 4);
    }

    [Fact]
    public async Task The_window_narrows_the_counts_and_the_firm_sample_with_it()
    {
        var h = await HistoryAsync(_alice, "?months=3");
        h.GetProperty("windowMonths").GetInt32().ShouldBe(3);
        var a = Type(h, _typeA);
        a.GetProperty("completed").GetInt32().ShouldBe(6); // the May Task is out
        a.GetProperty("medianMinutes").GetDouble().ShouldBe(150 + 30); // 60, 120, 180, 240, 300 -> 180
        a.GetProperty("firmSampleSize").GetInt32().ShouldBe(11);
    }

    [Fact]
    public async Task The_series_has_twelve_months_oldest_first_and_cancelled_never_counts()
    {
        var h = await HistoryAsync(_alice);
        var months = h.GetProperty("months").EnumerateArray().ToList();
        months.Count.ShouldBe(12);
        months[0].GetProperty("month").GetString().ShouldBe("2025-11");
        months[^1].GetProperty("month").GetString().ShouldBe("2026-10");
        months.Single(m => m.GetProperty("month").GetString() == "2026-10").GetProperty("completed").GetInt32().ShouldBe(10);
        months.Single(m => m.GetProperty("month").GetString() == "2026-05").GetProperty("completed").GetInt32().ShouldBe(1);
        months.Sum(m => m.GetProperty("completed").GetInt32()).ShouldBe(11);
    }

    [Fact]
    public async Task The_on_time_rate_needs_a_sample_and_skips_tasks_without_a_due_date()
    {
        var empty = await HistoryAsync(_alice);
        empty.GetProperty("onTime").GetProperty("sampleSize").GetInt32().ShouldBe(0);
        empty.GetProperty("onTime").GetProperty("rate").ValueKind.ShouldBe(JsonValueKind.Null);

        // Give five of Alice's Tuesday Tasks a due date: three due Tuesday (on time, completed that day), two due Monday (late).
        var ids = await TaskIdsAsync(_alice, _typeA, "2026-10-13");
        ids.Count.ShouldBeGreaterThanOrEqualTo(5);
        var chosen = ids.Take(5).ToList();
        await _h.ExecuteAsync($"UPDATE dbo.Task SET DueDate = '2026-10-13', DueSortKey = '2026-10-13T23:59:59' WHERE TaskId IN ({string.Join(',', chosen.Take(3))})");
        await _h.ExecuteAsync($"UPDATE dbo.Task SET DueDate = '2026-10-12', DueSortKey = '2026-10-12T23:59:59' WHERE TaskId IN ({string.Join(',', chosen.Skip(3))})");
        _factory.InvalidateAll();

        var h = await HistoryAsync(_alice);
        var onTime = h.GetProperty("onTime");
        onTime.GetProperty("sampleSize").GetInt32().ShouldBe(5);
        onTime.GetProperty("onTime").GetInt32().ShouldBe(3);
        onTime.GetProperty("late").GetInt32().ShouldBe(2);
        onTime.GetProperty("rate").GetDouble().ShouldBe(0.6);
    }

    private async Task<List<long>> TaskIdsAsync(int user, int typeId, string day)
    {
        var ids = new List<long>();
        await _factory.WithDbAsync(async db =>
        {
            var rows = await db.Database.SqlQuery<long>($"SELECT TaskId AS [Value] FROM dbo.Task WHERE AssignedUserId = {user} AND TaskTypeId = {typeId} AND StatusCode = 'COMPLETED' AND CAST(CompletedAt AS DATE) = {day} ORDER BY TaskId").ToListAsync();
            ids.AddRange(rows);
            return 0;
        });
        return ids;
    }

    [Fact]
    public async Task A_person_with_no_completed_tasks_has_an_empty_but_complete_answer()
    {
        var h = await HistoryAsync(_outsider, "?months=3");
        h.GetProperty("types").GetArrayLength().ShouldBe(1);
        Type(h, _typeA).GetProperty("medianMinutes").ValueKind.ShouldBe(JsonValueKind.Null);
        var none = await HistoryAsync((await _h.UserIdAsync(@"KE\hviewer")));
        none.GetProperty("types").GetArrayLength().ShouldBe(0);
        none.GetProperty("months").GetArrayLength().ShouldBe(12);
        none.GetProperty("totalCompleted").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task Clock_basis_counts_every_minute()
    {
        // Saturday to Monday: a Task started Saturday 10:00 New York and completed Monday 10:00 New York is 1 working hour (Monday 8 to 10 = 120 min) and 48 clock hours.
        var sat = new DateTime(2026, 10, 10, 14, 0, 0, DateTimeKind.Utc);
        var mon = new DateTime(2026, 10, 12, 14, 0, 0, DateTimeKind.Utc);
        for (var i = 0; i < 5; i++)
            await CompletedAsync(_typeB, _bob, sat, mon);
        var working = Type(await HistoryAsync(_bob), _typeB);
        working.GetProperty("medianMinutes").GetDouble().ShouldBe(120);

        var settings = await OkAsync(await _h.Admin.GetAsync("/api/v1/admin/settings/dashboard"));
        var gauge = new { workdayStart = "08:00", workdayEnd = "18:00", workDays = new[] { 1, 2, 3, 4, 5 }, ageBasis = "CLOCK", levelHours = new[] { 1, 2, 3, 4, 5 }, tasksPerLevel = 5, countBonusMax = 2 };
        await OkAsync(await _h.Admin.PutAsJsonAsync("/api/v1/admin/settings/dashboard", new { gauge, rowVersion = settings.GetProperty("rowVersion").GetString() }));
        _factory.InvalidateAll();
        var clockHistory = await HistoryAsync(_bob);
        clockHistory.GetProperty("durationBasis").GetString().ShouldBe("CLOCK");
        Type(clockHistory, _typeB).GetProperty("medianMinutes").GetDouble().ShouldBe(48 * 60);
    }

    [Fact]
    public async Task Hidden_unknown_and_out_of_scope_people_answer_404_and_bad_parameters_400()
    {
        (await _viewer.GetAsync("/api/v1/dashboard/users/999999/history")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await _viewer.GetAsync($"/api/v1/dashboard/users/{_carol}/history?podScope={_podX}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await _viewer.GetAsync($"/api/v1/dashboard/users/{_alice}/history?podScope={_podX}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        await ProblemAsync(await _viewer.GetAsync($"/api/v1/dashboard/users/{_alice}/history?months=6"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await _viewer.GetAsync($"/api/v1/dashboard/users/{_alice}/history?bogus=1"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task Both_endpoints_need_Dashboard_ViewUsers()
    {
        (await _noPerm.GetAsync($"/api/v1/dashboard/users/{_alice}/history")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await _noPerm.GetAsync("/api/v1/dashboard/users/skills")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await _factory.CreateClient().GetAsync("/api/v1/dashboard/users/skills")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Skills_lists_the_workers_of_the_scope_with_counts_state_and_experience()
    {
        var s = await SkillsAsync();
        s.GetProperty("experiencedMin").GetInt32().ShouldBe(5);
        s.GetProperty("thinMax").GetInt32().ShouldBe(2);

        var people = s.GetProperty("people").EnumerateArray().ToList();
        // The workers of any active pod: Alice, Bob, Carol. The outsider (no pod) and the viewer (no Workflow.Execute) are not workers.
        people.Select(p => p.GetProperty("userId").GetInt32()).ShouldBe([_alice, _bob, _carol], ignoreOrder: true);
        people.Select(p => p.GetProperty("displayName").GetString()!).ShouldBe(people.Select(p => p.GetProperty("displayName").GetString()!).Order(StringComparer.CurrentCultureIgnoreCase).ToList());

        var alice = people.Single(p => p.GetProperty("userId").GetInt32() == _alice);
        alice.GetProperty("state").GetString().ShouldBe("AVAILABLE");
        alice.GetProperty("load").GetInt32().ShouldBe(0);
        alice.GetProperty("completed12Months").GetInt32().ShouldBe(7 + 4);
        alice.GetProperty("completed3Months").GetInt32().ShouldBe(6 + 4);

        var cells = s.GetProperty("cells").EnumerateArray().ToList();
        var aliceA = cells.Single(c => c.GetProperty("userId").GetInt32() == _alice && c.GetProperty("taskTypeId").GetInt32() == _typeA);
        aliceA.GetProperty("completed12Months").GetInt32().ShouldBe(7);
        aliceA.GetProperty("completed3Months").GetInt32().ShouldBe(6);
        cells.Any(c => c.GetProperty("userId").GetInt32() == _outsider).ShouldBeFalse();

        var types = s.GetProperty("types").EnumerateArray().ToList();
        var a = types.Single(t => t.GetProperty("taskTypeId").GetInt32() == _typeA);
        a.GetProperty("experiencedPeople").GetInt32().ShouldBe(2); // Alice (7) and Bob (5)
        a.GetProperty("isThin").GetBoolean().ShouldBeTrue();
        a.GetProperty("completed12Months").GetInt32().ShouldBe(12);
        var b = types.Single(t => t.GetProperty("taskTypeId").GetInt32() == _typeB);
        b.GetProperty("experiencedPeople").GetInt32().ShouldBe(1); // Carol (5); Alice has four
        b.GetProperty("isThin").GetBoolean().ShouldBeTrue();
    }

    [Fact]
    public async Task Skills_follow_the_pod_scope_and_the_capacity_load()
    {
        await _h.CreateTaskAsync(_w, ordered: false, extra: new() { ["assignedUserId"] = _bob });
        await _h.CreateTaskAsync(_w, ordered: false, extra: new() { ["assignedUserId"] = _bob });
        _factory.InvalidateAll();

        var x = await SkillsAsync($"?podScope={_podX}");
        var people = x.GetProperty("people").EnumerateArray().ToList();
        people.Select(p => p.GetProperty("userId").GetInt32()).ShouldBe([_alice, _bob], ignoreOrder: true);
        var bob = people.Single(p => p.GetProperty("userId").GetInt32() == _bob);
        bob.GetProperty("load").GetInt32().ShouldBe(2);
        bob.GetProperty("state").GetString().ShouldBe("BUSY");
        var b = x.GetProperty("types").EnumerateArray().Single(t => t.GetProperty("taskTypeId").GetInt32() == _typeB);
        b.GetProperty("experiencedPeople").GetInt32().ShouldBe(0); // Carol is outside Pod X

        await ProblemAsync(await _viewer.GetAsync("/api/v1/dashboard/users/skills?podScope=99999"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task Skills_and_history_are_a_fixed_number_of_statements_whatever_the_number_of_people()
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

        var urls = new[] { "/api/v1/dashboard/users/skills", $"/api/v1/dashboard/users/{_alice}/history" };
        var before = new List<int>();
        foreach (var url in urls)
            before.Add(await CountAsync(url));

        var added = new List<int>();
        for (var i = 0; i < 6; i++)
        {
            var name = $@"KE\hextra{i}";
            await _h.UserWithAsync(name, Worker);
            var id = await _h.UserIdAsync(name);
            added.Add(id);
            await CompletedAsync(i % 2 == 0 ? _typeA : _typeB, id, Tue(14, 0), Tue(15, 0));
            await CompletedAsync(_typeA, _alice, Tue(14, 0), Tue(15, 0));
        }

        await _h.CreatePodAsync("Extra pod", [.. added]);
        _factory.InvalidateAll();

        for (var i = 0; i < urls.Length; i++)
            (await CountAsync(urls[i])).ShouldBe(before[i], urls[i]);
        before[0].ShouldBeLessThan(15);
        before[1].ShouldBeLessThan(15);
    }
}
