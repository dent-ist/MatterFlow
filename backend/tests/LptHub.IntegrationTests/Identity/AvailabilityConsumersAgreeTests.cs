using System.Net.Http.Json;
using System.Text.Json;
using LptHub.IntegrationTests.Fixtures;
using LptHub.IntegrationTests.Tasks;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Shouldly;
using static LptHub.IntegrationTests.Tasks.TaskHarness;

namespace LptHub.IntegrationTests.Identity;

/// <summary>
/// One availability rule for every consumer (Dashboard Calendar, epic #1074, issue #1076): a person with two Out of office entries (one covering now), a person on a holiday today and a person with
/// nothing are the same in the users list filter, the assignee lookup, the capacity People list and the team workload, at the same instant; the statement counts do not grow with the number of users.
/// The clock is Wednesday 2026-10-14 noon in New York.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class AvailabilityConsumersAgreeTests(SqlServerFixture sql) : IAsyncLifetime
{
    private static readonly DateTime Noon = new(2026, 10, 14, 16, 0, 0, DateTimeKind.Utc);
    private static readonly string[] Worker = ["Task.View", "Workflow.Execute", "Dashboard.View", "Dashboard.ViewUsers", "Pod.View"];

    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private int _out;
    private int _holiday;
    private int _free;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { Clock = new MutableClock(Noon) };
        _h = new TaskHarness(_factory);
        foreach (var name in new[] { "away", "hol", "free" })
            await _h.UserWithAsync($@"KE\{name}", Worker);
        _out = await _h.UserIdAsync(@"KE\away");
        _holiday = await _h.UserIdAsync(@"KE\hol");
        _free = await _h.UserIdAsync(@"KE\free");
        await _h.CreatePodAsync("Agree pod", _out, _holiday, _free);

        // Two entries for one person: Monday to Friday this week (covers now) and a week in two weeks. Between them (the 19th to the 25th) the person is available.
        await _factory.AddAbsenceAsync(_out, "2026-10-12", "2026-10-16", null, "VACATION");
        await _factory.AddAbsenceAsync(_out, "2026-10-26", "2026-10-30", null, "TRAINING");

        // A holiday today for one person only (their own calendar).
        var calendar = (await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/admin/holiday-calendars", new { name = "Today off", colourKey = "teal", appliesToEveryone = false, isActive = true }), System.Net.HttpStatusCode.Created)).GetProperty("calendarId").GetInt32();
        await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/admin/holiday-calendars/{calendar}/holidays", new { name = "Day off", ruleKind = "ONCE", onceDate = "2026-10-14", plusDays = 0, yearly = false, weekendRule = "NONE" }), System.Net.HttpStatusCode.Created);
        await OkAsync(await _h.Admin.PutAsJsonAsync($"/api/v1/users/{_holiday}/holiday-calendar", new { calendarId = calendar }));
        _factory.InvalidateAll();
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static string StateOf(JsonElement rows, int userId) =>
        rows.EnumerateArray().Single(r => r.GetProperty("userId").GetInt32() == userId).GetProperty("state").GetString()!;

    private static string AvailabilityOf(JsonElement rows, int userId) =>
        rows.EnumerateArray().Single(r => r.GetProperty("userId").GetInt32() == userId).GetProperty("availability").GetProperty("state").GetString()!;

    [Fact]
    public async Task The_users_list_the_lookup_the_capacity_people_and_the_team_workload_agree()
    {
        var list = await OkAsync(await _h.Admin.GetAsync("/api/v1/users?search=KE"));
        var listState = (int id) => list.GetProperty("items").EnumerateArray().Single(u => u.GetProperty("userId").GetInt32() == id).GetProperty("availability").GetProperty("state").GetString();
        listState(_out).ShouldBe("OUT_OF_OFFICE");
        listState(_holiday).ShouldBe("OFF_HOURS"); // a holiday is the soft off-hours state, never out of office
        listState(_free).ShouldBe("AVAILABLE");

        var filtered = await OkAsync(await _h.Admin.GetAsync("/api/v1/users?availability=OUT_OF_OFFICE"));
        filtered.GetProperty("items").EnumerateArray().Select(u => u.GetProperty("userId").GetInt32()).ShouldBe([_out]);
        var off = await OkAsync(await _h.Admin.GetAsync("/api/v1/users?availability=OFF_HOURS"));
        off.GetProperty("items").EnumerateArray().Select(u => u.GetProperty("userId").GetInt32()).ShouldContain(_holiday);

        var lookup = await OkAsync(await _h.Admin.GetAsync("/api/v1/users/lookup?q=KE&limit=50"));
        AvailabilityOf(lookup, _out).ShouldBe("OUT_OF_OFFICE");
        lookup.EnumerateArray().Single(r => r.GetProperty("userId").GetInt32() == _out).GetProperty("availability").GetProperty("outUntil").GetDateTime()
            .ShouldBe(new DateTime(2026, 10, 17, 4, 0, 0, DateTimeKind.Utc)); // the first entry ends after Friday the 16th; the next one does not touch it
        lookup.EnumerateArray().Single(r => r.GetProperty("userId").GetInt32() == _holiday).GetProperty("availability").GetProperty("state").GetString().ShouldBe("OFF_HOURS");
        lookup.EnumerateArray().Single(r => r.GetProperty("userId").GetInt32() == _free).GetProperty("availability").GetProperty("state").GetString().ShouldBe("AVAILABLE");

        var people = await OkAsync(await _h.Admin.GetAsync("/api/v1/dashboard/capacity/people"));
        StateOf(people, _out).ShouldBe("OUT_OF_OFFICE");
        StateOf(people, _holiday).ShouldBe("OFF_HOURS");
        StateOf(people, _free).ShouldBe("AVAILABLE");
        people.EnumerateArray().Single(p => p.GetProperty("userId").GetInt32() == _out).GetProperty("outUntil").GetString().ShouldBe("2026-10-16");

        var workload = await OkAsync(await _h.Admin.GetAsync("/api/v1/dashboard/workload"));
        var users = workload.GetProperty("users");
        users.EnumerateArray().Single(u => u.GetProperty("userId").GetInt32() == _out).GetProperty("availability").GetProperty("state").GetString().ShouldBe("OUT_OF_OFFICE");
        users.EnumerateArray().Single(u => u.GetProperty("userId").GetInt32() == _holiday).GetProperty("availability").GetProperty("state").GetString().ShouldBe("OFF_HOURS");

        // The battery: one present worker out of three.
        var capacity = await OkAsync(await _h.Admin.GetAsync("/api/v1/dashboard/capacity"));
        capacity.GetProperty("workers").GetInt32().ShouldBe(3);
        capacity.GetProperty("presentWorkers").GetInt32().ShouldBe(1);
        capacity.GetProperty("state").GetString().ShouldBe("OK");
    }

    [Fact]
    public async Task Between_the_two_entries_the_person_is_available_in_every_consumer()
    {
        ((MutableClock)_factory.Clock!).UtcNow = new DateTime(2026, 10, 21, 16, 0, 0, DateTimeKind.Utc); // Wednesday the 21st
        _factory.InvalidateAll();

        var people = await OkAsync(await _h.Admin.GetAsync("/api/v1/dashboard/capacity/people"));
        StateOf(people, _out).ShouldBe("AVAILABLE");
        var lookup = await OkAsync(await _h.Admin.GetAsync("/api/v1/users/lookup?q=KE&limit=50"));
        AvailabilityOf(lookup, _out).ShouldBe("AVAILABLE");
        (await OkAsync(await _h.Admin.GetAsync("/api/v1/users?availability=OUT_OF_OFFICE"))).GetProperty("items").GetArrayLength().ShouldBe(0);

        ((MutableClock)_factory.Clock!).UtcNow = new DateTime(2026, 10, 27, 16, 0, 0, DateTimeKind.Utc); // inside the second entry
        _factory.InvalidateAll();
        StateOf(await OkAsync(await _h.Admin.GetAsync("/api/v1/dashboard/capacity/people")), _out).ShouldBe("OUT_OF_OFFICE");
    }

    [Fact]
    public async Task The_number_of_statements_does_not_grow_with_the_number_of_users_entries_or_holidays()
    {
        var log = new CommandLog();
        await using var logged = _factory.WithWebHostBuilder(b => b.ConfigureServices(s => s.AddLogging(l =>
        {
            l.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Information);
            l.AddProvider(log);
        })));
        var http = logged.CreateClient();
        http.DefaultRequestHeaders.Add("X-LptHub-Client", "web");
        http.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);

        async Task<int> CountAsync(string url)
        {
            await OkAsync(await http.GetAsync(url));
            log.Clear();
            await OkAsync(await http.GetAsync(url));
            return log.Snapshot().Count;
        }

        var urls = new[] { "/api/v1/users/lookup?q=KE&limit=50", "/api/v1/dashboard/capacity/people", "/api/v1/dashboard/capacity", "/api/v1/dashboard/calendar/days?from=2026-10-01&to=2026-11-30" };
        var before = new List<int>();
        foreach (var url in urls)
            before.Add(await CountAsync(url));

        var ids = new List<int>();
        for (var i = 0; i < 40; i++)
        {
            await _h.UserWithAsync($@"KE\bulk{i:D2}", Worker);
            var id = await _h.UserIdAsync($@"KE\bulk{i:D2}");
            ids.Add(id);
            await _factory.AddAbsenceAsync(id, $"2026-10-{12 + (i % 10):D2}", $"2026-10-{13 + (i % 10):D2}");
            await _factory.AddAbsenceAsync(id, $"2026-11-{2 + (i % 20):D2}", $"2026-11-{3 + (i % 20):D2}");
        }

        await _h.CreatePodAsync("Bulk pod", [.. ids]);
        _factory.InvalidateAll();

        for (var i = 0; i < urls.Length; i++)
            (await CountAsync(urls[i])).ShouldBe(before[i], urls[i]);
        before[0].ShouldBeLessThan(20, "a fixed handful of statements: profiles, hours, entries, holidays");
    }
}
