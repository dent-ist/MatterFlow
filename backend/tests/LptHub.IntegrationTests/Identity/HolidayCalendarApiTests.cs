using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using LptHub.IntegrationTests.Fixtures;
using LptHub.IntegrationTests.Tasks;
using Shouldly;
using static LptHub.IntegrationTests.Tasks.TaskHarness;

namespace LptHub.IntegrationTests.Identity;

/// <summary>
/// Holiday calendars (Dashboard Calendar, epic #1074, issue #1078): calendars and holiday rules with validation, the preview of a year (US federal days of 2026 and 2027 with observed days), the paste import with a dry run,
/// the firm and pod defaults, the calendar of a person and the calendar settings (thresholds). Everything here needs Settings.Manage (the person's calendar needs User.Manage).
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class HolidayCalendarApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private HttpClient _admin = null!;
    private HttpClient _plain = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        _admin = _h.Admin;
        _plain = await _h.UserWithAsync(@"KE\plain", "Task.View", "Pod.View", "User.Manage");
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>();

    private async Task<JsonElement> CalendarAsync(string name, string colour = "indigo", bool everyone = false)
    {
        var response = await _admin.PostAsJsonAsync("/api/v1/admin/holiday-calendars", new { name, colourKey = colour, regionNote = "Test", appliesToEveryone = everyone, isActive = true });
        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        return await JsonAsync(response);
    }

    private static object Rule(string name, string kind, int? month = null, int? day = null, int? nth = null, int? weekday = null, int plus = 0, int? easter = null, string? once = null, string weekend = "NONE", bool yearly = true, int? endMonth = null, int? endDay = null, string? endDate = null, string? version = null) =>
        new { name, ruleKind = kind, month, day, nth, weekday, plusDays = plus, easterOffset = easter, onceDate = once, rangeEndMonth = endMonth, rangeEndDay = endDay, rangeEndDate = endDate, yearly, weekendRule = weekend, rowVersion = version };

    private async Task<int> AddAsync(int calendar, object rule)
    {
        var response = await _admin.PostAsJsonAsync($"/api/v1/admin/holiday-calendars/{calendar}/holidays", rule);
        response.StatusCode.ShouldBe(HttpStatusCode.Created, await response.Content.ReadAsStringAsync());
        return (await JsonAsync(response)).GetProperty("holidayId").GetInt32();
    }

    [Fact]
    public async Task Only_Settings_Manage_reaches_the_holiday_administration()
    {
        (await _plain.GetAsync("/api/v1/admin/holiday-calendars")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await _plain.PostAsJsonAsync("/api/v1/admin/holiday-calendars", new { name = "X", appliesToEveryone = false })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await _plain.GetAsync("/api/v1/admin/settings/holidays")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await _plain.GetAsync("/api/v1/admin/settings/calendar")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await _admin.GetAsync("/api/v1/admin/holiday-calendars")).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Calendars_are_created_changed_and_listed_with_counts_and_a_unique_name()
    {
        var us = await CalendarAsync("US Holiday");
        us.GetProperty("holidayCount").GetInt32().ShouldBe(0);
        us.GetProperty("colourKey").GetString().ShouldBe("indigo");

        var duplicate = await _admin.PostAsJsonAsync("/api/v1/admin/holiday-calendars", new { name = "US Holiday", colourKey = "rose", appliesToEveryone = false });
        duplicate.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await JsonAsync(duplicate)).GetProperty("code").GetString().ShouldBe("DUPLICATE_NAME");

        var badColour = await _admin.PostAsJsonAsync("/api/v1/admin/holiday-calendars", new { name = "Odd", colourKey = "hotpink", appliesToEveryone = false });
        badColour.StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var id = us.GetProperty("calendarId").GetInt32();
        var changed = await _admin.PutAsJsonAsync($"/api/v1/admin/holiday-calendars/{id}", new { name = "US federal", colourKey = "blue", regionNote = "Chicago", appliesToEveryone = false, isActive = true, rowVersion = us.GetProperty("rowVersion").GetString() });
        changed.StatusCode.ShouldBe(HttpStatusCode.OK);
        var stale = await _admin.PutAsJsonAsync($"/api/v1/admin/holiday-calendars/{id}", new { name = "Again", colourKey = "blue", appliesToEveryone = false, isActive = true, rowVersion = us.GetProperty("rowVersion").GetString() });
        stale.StatusCode.ShouldBe(HttpStatusCode.Conflict);

        var list = await JsonAsync(await _admin.GetAsync("/api/v1/admin/holiday-calendars"));
        list.EnumerateArray().Select(c => c.GetProperty("name").GetString()).ShouldBe(["US federal"]);
    }

    [Fact]
    public async Task The_preview_of_a_year_expands_the_rules_with_observed_days_and_ranges()
    {
        var cal = (await CalendarAsync("US Holiday")).GetProperty("calendarId").GetInt32();
        await AddAsync(cal, Rule("Thanksgiving", "NTH_WEEKDAY", month: 11, nth: 4, weekday: 4));
        await AddAsync(cal, Rule("Day after Thanksgiving", "NTH_WEEKDAY", month: 11, nth: 4, weekday: 4, plus: 1));
        await AddAsync(cal, Rule("Christmas Day", "FIXED", month: 12, day: 25, weekend: "US"));
        await AddAsync(cal, Rule("Independence Day", "FIXED", month: 7, day: 4, weekend: "US"));
        await AddAsync(cal, Rule("Year-end closure", "RANGE", month: 12, day: 28, endMonth: 12, endDay: 31));
        await AddAsync(cal, Rule("Office move", "ONCE", once: "2027-02-12", yearly: false));

        var p2026 = (await JsonAsync(await _admin.GetAsync($"/api/v1/admin/holiday-calendars/{cal}/preview?year=2026"))).EnumerateArray().ToList();
        p2026.Select(l => $"{l.GetProperty("date").GetString()} {l.GetProperty("name").GetString()}").ShouldBe(
            ["2026-07-03 Independence Day", "2026-11-26 Thanksgiving", "2026-11-27 Day after Thanksgiving", "2026-12-25 Christmas Day", "2026-12-28 Year-end closure"]);
        p2026[0].GetProperty("observedFrom").GetString().ShouldBe("2026-07-04"); // a Saturday moves to Friday
        p2026[4].GetProperty("endDate").GetString().ShouldBe("2026-12-31"); // a range is one line

        var p2027 = (await JsonAsync(await _admin.GetAsync($"/api/v1/admin/holiday-calendars/{cal}/preview?year=2027"))).EnumerateArray().ToList();
        p2027.Select(l => l.GetProperty("date").GetString()).ShouldBe(["2027-02-12", "2027-07-05", "2027-11-25", "2027-11-26", "2027-12-24", "2027-12-28"]);

        (await _admin.GetAsync($"/api/v1/admin/holiday-calendars/{cal}/preview?year=1800")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _admin.GetAsync("/api/v1/admin/holiday-calendars/9999/preview?year=2026")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Theory]
    [InlineData("FIXED", null, null, null, null, "HOLIDAY_RULE_INVALID")]
    [InlineData("FIXED", 2, 30, null, null, "HOLIDAY_RULE_INVALID")]
    [InlineData("NTH_WEEKDAY", 11, null, 5, 4, "HOLIDAY_RULE_INVALID")]
    [InlineData("NTH_WEEKDAY", 11, null, 4, 9, "HOLIDAY_RULE_INVALID")]
    [InlineData("WEEKLY", 1, 1, null, null, "HOLIDAY_RULE_INVALID")]
    [InlineData("ONCE", null, null, null, null, "HOLIDAY_RULE_INVALID")]
    public async Task A_rule_that_does_not_fit_its_kind_is_refused(string kind, int? month, int? day, int? nth, int? weekday, string code)
    {
        var cal = (await CalendarAsync("US Holiday")).GetProperty("calendarId").GetInt32();

        var response = await _admin.PostAsJsonAsync($"/api/v1/admin/holiday-calendars/{cal}/holidays", Rule("Bad", kind, month, day, nth, weekday));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await JsonAsync(response)).GetProperty("code").GetString().ShouldBe(code);
    }

    [Fact]
    public async Task Holidays_are_changed_and_deleted_with_their_row_version()
    {
        var cal = (await CalendarAsync("UK Holiday", "rose")).GetProperty("calendarId").GetInt32();
        var id = await AddAsync(cal, Rule("Good Friday", "EASTER_OFFSET", easter: -2));
        var holiday = (await JsonAsync(await _admin.GetAsync($"/api/v1/admin/holiday-calendars/{cal}/holidays"))).EnumerateArray().Single();

        var changed = await _admin.PutAsJsonAsync($"/api/v1/admin/holiday-calendars/{cal}/holidays/{id}", Rule("Easter Monday", "EASTER_OFFSET", easter: 1, version: holiday.GetProperty("rowVersion").GetString()));
        changed.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await JsonAsync(changed)).GetProperty("easterOffset").GetInt32().ShouldBe(1);

        var stale = await _admin.DeleteAsync($"/api/v1/admin/holiday-calendars/{cal}/holidays/{id}?rowVersion={Uri.EscapeDataString(holiday.GetProperty("rowVersion").GetString()!)}");
        stale.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        var current = (await JsonAsync(await _admin.GetAsync($"/api/v1/admin/holiday-calendars/{cal}/holidays"))).EnumerateArray().Single();
        (await _admin.DeleteAsync($"/api/v1/admin/holiday-calendars/{cal}/holidays/{id}?rowVersion={Uri.EscapeDataString(current.GetProperty("rowVersion").GetString()!)}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task A_paste_of_twenty_lines_is_reported_line_by_line_and_a_bad_line_blocks_only_itself()
    {
        var cal = (await CalendarAsync("Firm closures", "green", everyone: true)).GetProperty("calendarId").GetInt32();
        await AddAsync(cal, Rule("Already there", "ONCE", once: "2026-12-24", yearly: false));
        var lines = new List<string>();
        for (var i = 1; i <= 15; i++)
            lines.Add($"01/{i:00}/2027, Closure day {i}");
        lines.Add("12/24/2026 - 12/31/2026, Year-end closure"); // a range
        lines.Add("2027-03-01, ISO date");
        lines.Add("13/45/2026, Impossible date"); // bad
        lines.Add("just words"); // bad
        lines.Add("01/01/2027, Closure day 1"); // duplicate of line 1
        lines.Add("12/24/2026, Already there"); // already in the calendar
        var text = string.Join("\r\n", lines);

        var dry = await JsonAsync(await _admin.PostAsJsonAsync($"/api/v1/admin/holiday-calendars/{cal}/holidays/import?dryRun=true", new { text, year = 2027 }));

        dry.GetProperty("lines").GetArrayLength().ShouldBe(21);
        dry.GetProperty("okCount").GetInt32().ShouldBe(17);
        dry.GetProperty("errorCount").GetInt32().ShouldBe(4);
        dry.GetProperty("saved").GetBoolean().ShouldBeFalse();
        var bad = dry.GetProperty("lines").EnumerateArray().Where(l => !l.GetProperty("ok").GetBoolean()).ToList();
        bad.Select(l => l.GetProperty("line").GetInt32()).ShouldBe([18, 19, 20, 21]);
        bad[0].GetProperty("message").GetString().ShouldBe("Not a real date.");
        bad[2].GetProperty("message").GetString().ShouldBe("Same as line 1.");
        dry.GetProperty("lines")[15].GetProperty("parsed").GetProperty("endDate").GetString().ShouldBe("2026-12-31");
        (await JsonAsync(await _admin.GetAsync($"/api/v1/admin/holiday-calendars/{cal}/holidays"))).GetArrayLength().ShouldBe(1); // nothing was saved

        // Saving with errors and without acceptOk saves nothing; with acceptOk it saves the ok lines in one go.
        var blocked = await JsonAsync(await _admin.PostAsJsonAsync($"/api/v1/admin/holiday-calendars/{cal}/holidays/import?dryRun=false", new { text, year = 2027 }));
        blocked.GetProperty("saved").GetBoolean().ShouldBeFalse();
        (await JsonAsync(await _admin.GetAsync($"/api/v1/admin/holiday-calendars/{cal}/holidays"))).GetArrayLength().ShouldBe(1);
        var accepted = await JsonAsync(await _admin.PostAsJsonAsync($"/api/v1/admin/holiday-calendars/{cal}/holidays/import?dryRun=false&acceptOk=true", new { text, year = 2027 }));
        accepted.GetProperty("saved").GetBoolean().ShouldBeTrue();
        (await JsonAsync(await _admin.GetAsync($"/api/v1/admin/holiday-calendars/{cal}/holidays"))).GetArrayLength().ShouldBe(18);
    }

    [Fact]
    public async Task The_firm_calendar_the_pod_defaults_and_the_calendar_of_a_person_are_set_and_a_used_calendar_cannot_be_deleted()
    {
        var us = await CalendarAsync("US Holiday");
        var uk = await CalendarAsync("UK Holiday", "rose");
        var usId = us.GetProperty("calendarId").GetInt32();
        var ukId = uk.GetProperty("calendarId").GetInt32();
        var pod = await _h.CreatePodAsync("Review");

        var settings = await JsonAsync(await _admin.GetAsync("/api/v1/admin/settings/holidays"));
        settings.GetProperty("firmCalendarId").ValueKind.ShouldBe(JsonValueKind.Null);
        settings.GetProperty("podDefaults").EnumerateArray().Single().GetProperty("calendarId").ValueKind.ShouldBe(JsonValueKind.Null);

        var saved = await _admin.PutAsJsonAsync("/api/v1/admin/settings/holidays", new { firmCalendarId = usId, podDefaults = new[] { new { podId = pod, calendarId = ukId } }, rowVersion = settings.GetProperty("rowVersion").GetString() });
        saved.StatusCode.ShouldBe(HttpStatusCode.OK);
        var after = await JsonAsync(saved);
        after.GetProperty("firmCalendarId").GetInt32().ShouldBe(usId);
        after.GetProperty("podDefaults").EnumerateArray().Single().GetProperty("calendarId").GetInt32().ShouldBe(ukId);
        (await _admin.PutAsJsonAsync("/api/v1/admin/settings/holidays", new { firmCalendarId = usId, podDefaults = Array.Empty<object>(), rowVersion = "" })).StatusCode.ShouldBe(HttpStatusCode.Conflict); // stale

        var userId = await _h.UserIdAsync(@"KE\plain");
        var assigned = await _plain.PutAsJsonAsync($"/api/v1/users/{userId}/holiday-calendar", new { calendarId = ukId });
        assigned.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await JsonAsync(await _admin.GetAsync($"/api/v1/users/{userId}/availability"))).GetProperty("holidayCalendar").GetProperty("source").GetString().ShouldBe("PERSON");
        (await _plain.PutAsJsonAsync($"/api/v1/users/{userId}/holiday-calendar", new { calendarId = 9999 })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var delete = await _admin.DeleteAsync($"/api/v1/admin/holiday-calendars/{usId}?rowVersion={Uri.EscapeDataString(us.GetProperty("rowVersion").GetString()!)}");
        delete.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await JsonAsync(delete)).GetProperty("code").GetString().ShouldBe("CALENDAR_IN_USE");

        var spare = await CalendarAsync("Spare", "teal");
        (await _admin.DeleteAsync($"/api/v1/admin/holiday-calendars/{spare.GetProperty("calendarId").GetInt32()}?rowVersion={Uri.EscapeDataString(spare.GetProperty("rowVersion").GetString()!)}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task The_person_sees_the_calendar_in_force_and_their_next_holidays()
    {
        var us = (await CalendarAsync("US Holiday")).GetProperty("calendarId").GetInt32();
        await AddAsync(us, Rule("Christmas Day", "FIXED", month: 12, day: 25));
        await AddAsync(us, Rule("New Year", "FIXED", month: 1, day: 1));
        var settings = await JsonAsync(await _admin.GetAsync("/api/v1/admin/settings/holidays"));
        await _admin.PutAsJsonAsync("/api/v1/admin/settings/holidays", new { firmCalendarId = us, podDefaults = Array.Empty<object>(), rowVersion = settings.GetProperty("rowVersion").GetString() });

        var mine = await JsonAsync(await _plain.GetAsync("/api/v1/me/availability"));

        mine.GetProperty("holidayCalendar").GetProperty("name").GetString().ShouldBe("US Holiday");
        mine.GetProperty("holidayCalendar").GetProperty("source").GetString().ShouldBe("FIRM");
        var next = mine.GetProperty("nextHolidays").EnumerateArray().ToList();
        next.Count.ShouldBeGreaterThan(0);
        next[0].GetProperty("date").GetString()!.ShouldBeGreaterThanOrEqualTo(DateTime.UtcNow.AddDays(-1).ToString("yyyy-MM-dd"));
    }

    [Fact]
    public async Task Calendar_thresholds_have_defaults_validation_a_row_version_and_a_reset()
    {
        var pod = await _h.CreatePodAsync("Review");
        var defaults = await JsonAsync(await _admin.GetAsync("/api/v1/admin/settings/calendar"));
        defaults.GetProperty("minCoveragePercent").GetInt32().ShouldBe(75);
        defaults.GetProperty("podMinimumPercent").GetInt32().ShouldBe(60);
        defaults.GetProperty("isCustom").GetBoolean().ShouldBeFalse();
        defaults.GetProperty("podMinimums").GetArrayLength().ShouldBe(0);

        (await _admin.PutAsJsonAsync("/api/v1/admin/settings/calendar", new { minCoveragePercent = 5, podMinimumPercent = 60, podMinimums = Array.Empty<object>(), rowVersion = "" })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _admin.PutAsJsonAsync("/api/v1/admin/settings/calendar", new { minCoveragePercent = 80, podMinimumPercent = 60, podMinimums = new[] { new { podId = 9999, people = 3 } }, rowVersion = "" })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var saved = await _admin.PutAsJsonAsync("/api/v1/admin/settings/calendar", new { minCoveragePercent = 80, podMinimumPercent = 50, podMinimums = new[] { new { podId = pod, people = 3 } }, rowVersion = "" });
        saved.StatusCode.ShouldBe(HttpStatusCode.OK);
        var custom = await JsonAsync(saved);
        custom.GetProperty("isCustom").GetBoolean().ShouldBeTrue();
        custom.GetProperty("minCoveragePercent").GetInt32().ShouldBe(80);
        custom.GetProperty("podMinimums").EnumerateArray().Single().GetProperty("people").GetInt32().ShouldBe(3);

        (await _admin.PutAsJsonAsync("/api/v1/admin/settings/calendar", new { minCoveragePercent = 85, podMinimumPercent = 50, podMinimums = Array.Empty<object>(), rowVersion = "" })).StatusCode.ShouldBe(HttpStatusCode.Conflict);

        var reset = await _admin.DeleteAsync($"/api/v1/admin/settings/calendar?rowVersion={Uri.EscapeDataString(custom.GetProperty("rowVersion").GetString()!)}");
        reset.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await JsonAsync(reset)).GetProperty("minCoveragePercent").GetInt32().ShouldBe(75);
    }
}
