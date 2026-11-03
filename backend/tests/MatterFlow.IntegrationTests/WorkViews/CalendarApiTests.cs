using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// The Dashboard Calendar endpoints (epic #1074, issue #1077): coverage per day, the day panel, the summary, the permission and pod-scope rules, and the privacy of absence reasons.
/// Seven workers in two pods; US firm calendar with Thanksgiving, one UK person per pod. The clock is Tuesday 2026-11-03 noon in New York. The expected figures are worked out here from the seeds.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class CalendarApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private static readonly DateTime Noon = new(2026, 11, 3, 17, 0, 0, DateTimeKind.Utc);
    private static readonly string[] WorkerPerms = ["Task.View", "Workflow.Execute", "Pod.View"];

    private MutableClock _clock = null!;
    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private TaskHarness.World _w = null!;
    private HttpClient _director = null!;
    private HttpClient _lead = null!;
    private HttpClient _leadNoReasons = null!;
    private HttpClient _tech = null!;
    private int _podR;
    private int _podP;
    private readonly Dictionary<string, int> _id = [];

    public async Task InitializeAsync()
    {
        _clock = new MutableClock(Noon);
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { Clock = _clock };
        _h = new TaskHarness(_factory);
        _w = await _h.CreateWorldAsync();

        // Viewers: a Director (sees every pod, holds the reasons permission), a Pod Lead of Review, a Pod Lead without the reasons permission, a Technician (no calendar permission).
        string[] calendar = ["Dashboard.View", "Dashboard.ViewCalendar"];
        _director = await _h.UserWithAsync(@"KE\dir", [.. WorkerPerms, .. calendar, "Dashboard.ViewAbsenceReasons", "User.View"]);
        // The Pod Leads are pod members but hold no Workflow.Execute, so they are not counted as workers.
        string[] leadPerms = ["Task.View", "Pod.View"];
        _lead = await _h.UserWithAsync(@"KE\lead", [.. leadPerms, .. calendar, "Dashboard.ViewAbsenceReasons"]);
        _leadNoReasons = await _h.UserWithAsync(@"KE\leadnr", [.. leadPerms, .. calendar]);
        _tech = await _h.UserWithAsync(@"KE\tech", [.. WorkerPerms, "Dashboard.View"]);

        // Workers. r4 and p3 are in London (UK calendar); the others use the firm calendar (US). multi holds two roles.
        foreach (var name in new[] { "r1", "r2", "r3", "r4", "p1", "p2", "p3" })
            await _h.UserWithAsync($@"KE\{name}", WorkerPerms);
        foreach (var name in new[] { "dir", "lead", "leadnr", "tech", "r1", "r2", "r3", "r4", "p1", "p2", "p3" })
            _id[name] = await _h.UserIdAsync($@"KE\{name}");

        _podR = await _h.CreatePodAsync("Review", _id["lead"], _id["r1"], _id["r2"], _id["r3"], _id["r4"]);
        _podP = await _h.CreatePodAsync("Processing", _id["leadnr"], _id["p1"], _id["p2"], _id["p3"]);
        await _h.ExecuteAsync($"UPDATE dbo.AppUser SET DisplayName = N'Rita {1}' WHERE UserId = {_id["r1"]}");

        // Calendars: US (firm default) with Thanksgiving, UK (assigned to r4 and p3) without it.
        var us = (await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/admin/holiday-calendars", new { name = "US Holiday", colourKey = "indigo", appliesToEveryone = false, isActive = true }), HttpStatusCode.Created)).GetProperty("calendarId").GetInt32();
        var uk = (await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/admin/holiday-calendars", new { name = "UK Holiday", colourKey = "rose", appliesToEveryone = false, isActive = true }), HttpStatusCode.Created)).GetProperty("calendarId").GetInt32();
        await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/admin/holiday-calendars/{us}/holidays", new { name = "Thanksgiving", ruleKind = "NTH_WEEKDAY", month = 11, nth = 4, weekday = 4, plusDays = 0, yearly = true, weekendRule = "NONE" }), HttpStatusCode.Created);
        await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/admin/holiday-calendars/{uk}/holidays", new { name = "Boxing Day", ruleKind = "FIXED", month = 12, day = 26, plusDays = 0, yearly = true, weekendRule = "UK" }), HttpStatusCode.Created);
        var holidays = await OkAsync(await _h.Admin.GetAsync("/api/v1/admin/settings/holidays"));
        await OkAsync(await _h.Admin.PutAsJsonAsync("/api/v1/admin/settings/holidays", new { firmCalendarId = us, podDefaults = Array.Empty<object>(), rowVersion = holidays.GetProperty("rowVersion").GetString() }));
        foreach (var name in new[] { "r4", "p3" })
            await OkAsync(await _h.Admin.PutAsJsonAsync($"/api/v1/users/{_id[name]}/holiday-calendar", new { calendarId = uk }));

        // Entries: Wed 11-04 r1 vacation and r2 sick (note "Flu"); Thu 11-05 r1, r2, r3 vacation; Tue 11-10 r1 out; Mon 11-16 all of Processing out.
        await _factory.AddAbsenceAsync(_id["r1"], "2026-11-04", "2026-11-05", null, "VACATION");
        await _factory.AddAbsenceAsync(_id["r2"], "2026-11-04", "2026-11-05", "Flu", "SICK");
        await _factory.AddAbsenceAsync(_id["r3"], "2026-11-05", "2026-11-05", null, "TRAINING");
        await _factory.AddAbsenceAsync(_id["r1"], "2026-11-10", "2026-11-10", null, "OTHER");
        foreach (var p in new[] { "p1", "p2", "p3" })
            await _factory.AddAbsenceAsync(_id[p], "2026-11-16", "2026-11-16", null, "CONFERENCE");

        // Loads: r3 has two open tasks, p1 one, r2 three (one of them on hold: not counted).
        foreach (var (user, n) in new[] { ("r3", 2), ("p1", 1), ("r2", 3) })
        {
            for (var i = 0; i < n; i++)
                await _h.CreateTaskAsync(_w, extra: new() { ["assignedUserId"] = _id[user] });
        }

        await _h.ExecuteAsync($"UPDATE TOP (1) dbo.Task SET StatusCode = 'ON_HOLD' WHERE AssignedUserId = {_id["r2"]}");
        _factory.InvalidateAll();
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static async Task<JsonElement> GetAsync(HttpClient client, string url) => await OkAsync(await client.GetAsync(url));

    private static JsonElement Day(JsonElement days, string date) => days.GetProperty("days").EnumerateArray().Single(d => d.GetProperty("date").GetString() == date);

    [Fact]
    public async Task A_good_day_counts_everybody_and_a_weekend_is_non_working()
    {
        var days = await GetAsync(_director, "/api/v1/dashboard/calendar/days?from=2026-11-01&to=2026-11-07");

        days.GetProperty("today").GetString().ShouldBe("2026-11-03");
        days.GetProperty("firstDayOfWeek").GetInt32().ShouldBe(0);
        var tuesday = Day(days, "2026-11-03");
        (tuesday.GetProperty("total").GetInt32(), tuesday.GetProperty("expected").GetInt32(), tuesday.GetProperty("available").GetInt32()).ShouldBe((7, 7, 7));
        tuesday.GetProperty("level").GetString().ShouldBe("GOOD");
        tuesday.GetProperty("coveragePercent").GetInt32().ShouldBe(100);
        tuesday.GetProperty("holidays").GetArrayLength().ShouldBe(0);
        tuesday.GetProperty("pods").EnumerateArray().Select(p => p.GetProperty("name").GetString()).ShouldBe(["Processing", "Review"]);

        var sunday = Day(days, "2026-11-01");
        sunday.GetProperty("level").GetString().ShouldBe("NON_WORKING");
        sunday.GetProperty("expected").GetInt32().ShouldBe(0);
        sunday.GetProperty("coveragePercent").ValueKind.ShouldBe(JsonValueKind.Null);
        sunday.GetProperty("offHours").GetInt32().ShouldBe(7);
    }

    [Fact]
    public async Task Levels_follow_the_coverage_and_the_pod_minimums()
    {
        var days = await GetAsync(_director, "/api/v1/dashboard/calendar/days?from=2026-11-03&to=2026-11-17");

        // 11-04: r1 and r2 out: 5 of 7 = 71 percent, below 75: LOW. Review has 2 of 4 expected (minimum 3).
        var low = Day(days, "2026-11-04");
        (low.GetProperty("outOfOffice").GetInt32(), low.GetProperty("available").GetInt32(), low.GetProperty("coveragePercent").GetInt32()).ShouldBe((2, 5, 71));
        low.GetProperty("level").GetString().ShouldBe("LOW");
        var review = low.GetProperty("pods").EnumerateArray().Single(p => p.GetProperty("name").GetString() == "Review");
        (review.GetProperty("expected").GetInt32(), review.GetProperty("available").GetInt32(), review.GetProperty("minimum").GetInt32()).ShouldBe((4, 2, 3));
        review.GetProperty("level").GetString().ShouldBe("LOW");

        // 11-05: three out of 7: 4 of 7 = 57 percent: CRITICAL.
        Day(days, "2026-11-05").GetProperty("level").GetString().ShouldBe("CRITICAL");

        // 11-10: one out: 6 of 7 = 86 percent and Review has 3 of 4 (its minimum is 3): GOOD.
        var good = Day(days, "2026-11-10");
        good.GetProperty("level").GetString().ShouldBe("GOOD");
        good.GetProperty("coveragePercent").GetInt32().ShouldBe(86);

        // 11-16: all of Processing out: 4 of 7 = 57 percent: CRITICAL, and Processing is at zero.
        var zero = Day(days, "2026-11-16");
        zero.GetProperty("level").GetString().ShouldBe("CRITICAL");
        zero.GetProperty("pods").EnumerateArray().Single(p => p.GetProperty("name").GetString() == "Processing").GetProperty("level").GetString().ShouldBe("CRITICAL");
    }

    [Fact]
    public async Task A_pod_below_its_minimum_turns_a_good_day_into_watch()
    {
        var settings = await GetAsync(_h.Admin, "/api/v1/admin/settings/calendar");
        await OkAsync(await _h.Admin.PutAsJsonAsync("/api/v1/admin/settings/calendar", new { minCoveragePercent = 75, podMinimumPercent = 60, podMinimums = new[] { new { podId = _podR, people = 4 } }, rowVersion = settings.GetProperty("rowVersion").GetString() }));

        var days = await GetAsync(_director, "/api/v1/dashboard/calendar/days?from=2026-11-10&to=2026-11-10");

        var day = Day(days, "2026-11-10"); // r1 out: 6 of 7 = 86 percent, Review has 3 of 4 but wants 4
        day.GetProperty("level").GetString().ShouldBe("WATCH");
        day.GetProperty("pods").EnumerateArray().Single(p => p.GetProperty("name").GetString() == "Review").GetProperty("minimum").GetInt32().ShouldBe(4);
    }

    [Fact]
    public async Task Thanksgiving_for_a_us_firm_with_uk_colleagues_is_two_of_two_expected_and_good()
    {
        var days = await GetAsync(_director, "/api/v1/dashboard/calendar/days?from=2026-11-26&to=2026-11-27");

        var thanksgiving = Day(days, "2026-11-26");
        (thanksgiving.GetProperty("total").GetInt32(), thanksgiving.GetProperty("onHoliday").GetInt32(), thanksgiving.GetProperty("expected").GetInt32(), thanksgiving.GetProperty("available").GetInt32()).ShouldBe((7, 5, 2, 2));
        thanksgiving.GetProperty("level").GetString().ShouldBe("GOOD"); // 2 of 2, not 2 of 7
        thanksgiving.GetProperty("coveragePercent").GetInt32().ShouldBe(100);
        var holiday = thanksgiving.GetProperty("holidays").EnumerateArray().Single();
        holiday.GetProperty("name").GetString().ShouldBe("Thanksgiving");
        holiday.GetProperty("category").GetString().ShouldBe("US Holiday");
        holiday.GetProperty("colourKey").GetString().ShouldBe("indigo");
        Day(days, "2026-11-27").GetProperty("holidays").GetArrayLength().ShouldBe(0);
    }

    [Fact]
    public async Task A_firm_closure_is_closed_and_the_battery_says_holiday()
    {
        var closure = (await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/admin/holiday-calendars", new { name = "Firm closure", colourKey = "green", appliesToEveryone = true, isActive = true }), HttpStatusCode.Created)).GetProperty("calendarId").GetInt32();
        await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/admin/holiday-calendars/{closure}/holidays", new { name = "Office closed", ruleKind = "ONCE", onceDate = "2026-11-03", plusDays = 0, yearly = false, weekendRule = "NONE" }), HttpStatusCode.Created);
        _factory.InvalidateAll();

        var days = await GetAsync(_director, "/api/v1/dashboard/calendar/days?from=2026-11-03&to=2026-11-03");
        var day = Day(days, "2026-11-03");
        (day.GetProperty("onHoliday").GetInt32(), day.GetProperty("expected").GetInt32()).ShouldBe((7, 0));
        day.GetProperty("level").GetString().ShouldBe("CLOSED");

        var capacity = await GetAsync(_h.Admin, "/api/v1/dashboard/capacity");
        capacity.GetProperty("state").GetString().ShouldBe("HOLIDAY");
        capacity.GetProperty("presentWorkers").GetInt32().ShouldBe(0);
        capacity.GetProperty("freePercent").ValueKind.ShouldBe(JsonValueKind.Null);
        capacity.GetProperty("states").EnumerateArray().Single(s => s.GetProperty("state").GetString() == "OFF_HOURS").GetProperty("count").GetInt32().ShouldBe(7);
    }

    [Fact]
    public async Task A_holiday_wins_over_an_entry_on_the_same_day_and_counts_once()
    {
        await _factory.AddAbsenceAsync(_id["r1"], "2026-11-25", "2026-11-27", null, "VACATION"); // r1 is on the US calendar: Thanksgiving is the 26th

        var days = await GetAsync(_director, "/api/v1/dashboard/calendar/days?from=2026-11-25&to=2026-11-27");

        var thanksgiving = Day(days, "2026-11-26");
        thanksgiving.GetProperty("onHoliday").GetInt32().ShouldBe(5);
        thanksgiving.GetProperty("outOfOffice").GetInt32().ShouldBe(0);
        Day(days, "2026-11-25").GetProperty("outOfOffice").GetInt32().ShouldBe(1);
    }

    [Fact]
    public async Task The_day_panel_lists_people_by_role_sorted_by_workload_and_gives_reasons_only_with_the_permission()
    {
        var roleA = await _factory.CreateRoleAsync("Alpha Analyst", "Task.View", "Workflow.Execute");
        var roleZ = await _factory.CreateRoleAsync("Zulu Reviewer", "Task.View", "Workflow.Execute");
        await _factory.GrantRoleAsync(@"KE\r3", roleZ); // r3 holds her own role and Zulu: the first role A to Z that holds Workflow.Execute is Alpha only when she has it
        await _factory.GrantRoleAsync(@"KE\r3", roleA);
        _factory.InvalidateAll();

        var day = await GetAsync(_director, "/api/v1/dashboard/calendar/day?date=2026-11-04");

        day.GetProperty("date").GetString().ShouldBe("2026-11-04");
        day.GetProperty("level").GetString().ShouldBe("LOW");
        var counts = day.GetProperty("counts");
        (counts.GetProperty("total").GetInt32(), counts.GetProperty("expected").GetInt32(), counts.GetProperty("available").GetInt32(), counts.GetProperty("outOfOffice").GetInt32()).ShouldBe((7, 7, 5, 2));

        // r3 appears once, under Alpha Analyst; groups are in role-name order.
        var groups = day.GetProperty("available").EnumerateArray().ToList();
        groups.Select(g => g.GetProperty("roleName").GetString()).ShouldBe(groups.Select(g => g.GetProperty("roleName").GetString()).Order(StringComparer.OrdinalIgnoreCase).ToList());
        groups.Select(g => g.GetProperty("roleName").GetString()).ShouldContain("Alpha Analyst");
        var everyone = groups.SelectMany(g => g.GetProperty("people").EnumerateArray()).Select(p => p.GetProperty("userId").GetInt32()).ToList();
        everyone.Count.ShouldBe(5);
        everyone.Distinct().Count().ShouldBe(5);
        var alpha = groups.Single(g => g.GetProperty("roleName").GetString() == "Alpha Analyst").GetProperty("people").EnumerateArray().Single();
        alpha.GetProperty("userId").GetInt32().ShouldBe(_id["r3"]);
        alpha.GetProperty("load").GetInt32().ShouldBe(2);
        alpha.GetProperty("podNames").EnumerateArray().Select(n => n.GetString()).ShouldBe(["Review"]);

        // Within a role group the available are lightest first: p2 (0), p3 (0), p1 (1) share the technician roles of their own, so check the ordering inside every group.
        foreach (var group in groups)
        {
            var loads = group.GetProperty("people").EnumerateArray().Select(p => p.GetProperty("load").GetInt32()).ToList();
            loads.ShouldBe(loads.Order().ToList());
        }

        var unavailable = day.GetProperty("unavailable").EnumerateArray().SelectMany(g => g.GetProperty("people").EnumerateArray()).ToList();
        unavailable.Select(p => p.GetProperty("userId").GetInt32()).ShouldBe([_id["r1"], _id["r2"]], ignoreOrder: true);
        unavailable.ShouldAllBe(p => p.GetProperty("reason").GetString() == "OUT_OF_OFFICE");
        unavailable.Single(p => p.GetProperty("userId").GetInt32() == _id["r1"]).GetProperty("absenceType").GetString().ShouldBe("VACATION");
        unavailable.Single(p => p.GetProperty("userId").GetInt32() == _id["r2"]).GetProperty("absenceType").GetString().ShouldBe("SICK");
        unavailable.Single(p => p.GetProperty("userId").GetInt32() == _id["r2"]).GetProperty("backOn").GetString().ShouldBe("2026-11-06"); // out through the 5th
        unavailable.Single(p => p.GetProperty("userId").GetInt32() == _id["r2"]).GetProperty("load").GetInt32().ShouldBe(2); // 3 tasks, one on hold
    }

    [Fact]
    public async Task Without_the_reasons_permission_the_absence_type_is_not_in_the_response_at_all_and_no_note_ever_is()
    {
        var withReasons = await _lead.GetAsync("/api/v1/dashboard/calendar/day?date=2026-11-04&podScope=all");
        var without = await _leadNoReasons.GetAsync("/api/v1/dashboard/calendar/day?date=2026-11-04");
        (await _lead.GetAsync("/api/v1/dashboard/calendar/days?from=2026-11-03&to=2026-11-06")).StatusCode.ShouldBe(HttpStatusCode.OK);

        var okBody = await withReasons.Content.ReadAsStringAsync();
        var plainBody = await without.Content.ReadAsStringAsync();
        okBody.ShouldContain("\"absenceType\":\"SICK\"");
        plainBody.ShouldNotContain("absenceType", Case.Insensitive);
        plainBody.ShouldNotContain("SICK");
        plainBody.ShouldNotContain("VACATION");
        okBody.ShouldNotContain("Flu"); // the note never appears in the Calendar
        plainBody.ShouldNotContain("Flu");

        // Nor does the days answer or the summary carry a type or a note.
        (await (await _leadNoReasons.GetAsync("/api/v1/dashboard/calendar/days?from=2026-11-03&to=2026-11-06")).Content.ReadAsStringAsync()).ShouldNotContain("SICK");
    }

    [Fact]
    public async Task A_technician_gets_403_and_a_pod_lead_sees_only_their_own_pods()
    {
        (await _tech.GetAsync("/api/v1/dashboard/calendar/days?from=2026-11-03&to=2026-11-06")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await _tech.GetAsync("/api/v1/dashboard/calendar/day?date=2026-11-04")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await _tech.GetAsync("/api/v1/dashboard/calendar/summary")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        // The lead of Review is a member of Review only: "all" means Review (the workers r1 to r4), and Processing is 403.
        var own = await GetAsync(_lead, "/api/v1/dashboard/calendar/days?from=2026-11-03&to=2026-11-03");
        Day(own, "2026-11-03").GetProperty("total").GetInt32().ShouldBe(4);
        (await _lead.GetAsync($"/api/v1/dashboard/calendar/days?from=2026-11-03&to=2026-11-03&podScope={_podP}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await _lead.GetAsync($"/api/v1/dashboard/calendar/days?from=2026-11-03&to=2026-11-03&podScope={_podR}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await _lead.GetAsync("/api/v1/dashboard/calendar/days?from=2026-11-03&to=2026-11-03&podScope=9999")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _director.GetAsync($"/api/v1/dashboard/calendar/days?from=2026-11-03&to=2026-11-03&podScope={_podP}")).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Pod_filter_role_filter_and_range_rules()
    {
        var onlyP = await GetAsync(_director, $"/api/v1/dashboard/calendar/days?from=2026-11-03&to=2026-11-03&podScope={_podP}");
        Day(onlyP, "2026-11-03").GetProperty("total").GetInt32().ShouldBe(3); // p1 to p3

        var roles = onlyP.GetProperty("roles").EnumerateArray().ToList();
        roles.Count.ShouldBeGreaterThan(0);
        var firstRole = roles[0].GetProperty("roleId").GetInt32();
        var filtered = await GetAsync(_director, $"/api/v1/dashboard/calendar/days?from=2026-11-03&to=2026-11-03&role={firstRole}");
        Day(filtered, "2026-11-03").GetProperty("total").GetInt32().ShouldBeGreaterThan(0);

        (await _director.GetAsync("/api/v1/dashboard/calendar/days?from=2026-11-01&to=2027-01-31")).StatusCode.ShouldBe(HttpStatusCode.BadRequest); // more than 62 days
        (await _director.GetAsync("/api/v1/dashboard/calendar/days?from=2026-11-10&to=2026-11-01")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _director.GetAsync("/api/v1/dashboard/calendar/days?to=2026-11-01")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _director.GetAsync("/api/v1/dashboard/calendar/days?from=2026-11-01&to=2026-11-02&unknown=1")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        var exactly62 = await _director.GetAsync("/api/v1/dashboard/calendar/days?from=2026-11-01&to=2027-01-02");
        exactly62.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await JsonAsync(exactly62)).GetProperty("days").GetArrayLength().ShouldBe(63);
    }

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>();

    [Fact]
    public async Task The_summary_has_the_thresholds_the_risk_banner_and_four_weeks_of_forecast()
    {
        var summary = await GetAsync(_director, "/api/v1/dashboard/calendar/summary");

        summary.GetProperty("thresholds").GetProperty("minCoveragePercent").GetInt32().ShouldBe(75);
        summary.GetProperty("thresholds").GetProperty("podMinimumPercent").GetInt32().ShouldBe(60);
        var risk = summary.GetProperty("risk");
        risk.GetProperty("windowDays").GetInt32().ShouldBe(30);
        risk.GetProperty("firstRiskDate").GetString().ShouldBe("2026-11-04");
        risk.GetProperty("firstRiskLevel").GetString().ShouldBe("LOW");
        risk.GetProperty("daysAtRisk").GetInt32().ShouldBe(3); // 11-04 LOW, 11-05 CRITICAL, 11-16 CRITICAL (11-10 is good)
        risk.GetProperty("worstPod").GetProperty("name").GetString().ShouldBe("Review"); // below its minimum on 11-04 and 11-05

        var forecast = summary.GetProperty("forecast").EnumerateArray().ToList();
        forecast.Count.ShouldBe(4);
        forecast.Select(w => w.GetProperty("weekStart").GetString()).ShouldBe(["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22"]);
        // Week of 11-01 from today (Tuesday): 11-03 to 11-06 are working days with 7, 5, 4 and 7 people available (average 5.8); 6 open tasks (2 + 1 + 2 + 1... see seeds) of 3 slots each.
        var first = forecast[0];
        first.GetProperty("availablePeople").GetDouble().ShouldBe(5.8);
        first.GetProperty("freePercent").GetInt32().ShouldBe((int)Math.Round((3 * (23 / 4.0) - 5) / (3 * (23 / 4.0)) * 100, MidpointRounding.AwayFromZero));
        (await _tech.GetAsync("/api/v1/dashboard/calendar/summary")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task The_responses_name_no_task_matter_or_title()
    {
        var bodies = new[]
        {
            await (await _director.GetAsync("/api/v1/dashboard/calendar/days?from=2026-11-03&to=2026-11-20")).Content.ReadAsStringAsync(),
            await (await _director.GetAsync("/api/v1/dashboard/calendar/day?date=2026-11-04")).Content.ReadAsStringAsync(),
            await (await _director.GetAsync("/api/v1/dashboard/calendar/summary")).Content.ReadAsStringAsync(),
        };

        foreach (var body in bodies)
        {
            body.ShouldNotContain("taskId", Case.Insensitive);
            body.ShouldNotContain("matter", Case.Insensitive);
            body.ShouldNotContain("title", Case.Insensitive);
        }
    }

    [Fact]
    public async Task The_number_of_statements_does_not_grow_with_the_number_of_days_or_people()
    {
        // 62 days for 7 people and the same for 40 more people: the same handful of statements (profiles, entries, holidays, pods, roles); this is a smoke check on time, the query shape is by construction.
        for (var i = 0; i < 33; i++)
        {
            var name = $"x{i}";
            await _h.UserWithAsync($@"KE\{name}", WorkerPerms);
        }

        var members = new List<int>();
        for (var i = 0; i < 33; i++)
            members.Add(await _h.UserIdAsync($@"KE\x{i}"));
        await _h.CreatePodAsync("Big pod", [.. members]);

        var watch = System.Diagnostics.Stopwatch.StartNew();
        var days = await GetAsync(_director, "/api/v1/dashboard/calendar/days?from=2026-11-01&to=2027-01-02");
        watch.Stop();

        Day(days, "2026-11-03").GetProperty("total").GetInt32().ShouldBe(40);
        days.GetProperty("days").GetArrayLength().ShouldBe(63);
        watch.Elapsed.TotalSeconds.ShouldBeLessThan(10);
    }
}
