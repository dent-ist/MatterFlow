using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.Audit.Domain;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace MatterFlow.IntegrationTests.Identity;

/// <summary>User availability and work hours (epic #68, issue #69): own and on-behalf editing, validation codes, concurrency, audit, lookups.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class UserAvailabilityApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;

    public async Task InitializeAsync() => _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private HttpClient As(string user)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", user);
        return client;
    }

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response) => await response.Content.ReadFromJsonAsync<JsonElement>();

    private async Task<int> ProvisionAsync(string account) => (await JsonAsync(await As(account).GetAsync("/api/v1/me"))).GetProperty("userId").GetInt32();

    private static string Version(JsonElement dto) => dto.GetProperty("rowVersion").GetString()!;

    private static object Body(string version, string status = "AVAILABLE", string? from = null, string? until = null, string? note = null, string? zone = null, object[]? hours = null) =>
        new { status, from, until, note, timeZoneId = zone, workHours = hours, rowVersion = version };

    private async Task<List<AuditEvent>> AuditAsync(int userId) =>
        await _factory.WithDbAsync(db => db.Set<AuditEvent>().AsNoTracking()
            .Where(e => e.ObjectType == "User" && e.ObjectId == userId.ToString() && e.EventType.StartsWith("USER_") && e.FieldKey != "role")
            .OrderBy(e => e.Id).ToListAsync());

    [Fact]
    public async Task A_user_without_a_saved_profile_gets_the_defaults_and_a_NEW_row_version()
    {
        var dto = await JsonAsync(await As(@"KE\scientist").GetAsync("/api/v1/me/availability"));

        dto.GetProperty("status").GetString().ShouldBe("AVAILABLE");
        dto.GetProperty("usesDefaultWorkHours").GetBoolean().ShouldBeTrue();
        dto.GetProperty("rowVersion").GetString().ShouldBe("NEW");
        dto.GetProperty("effectiveTimeZoneId").GetString().ShouldBe("America/New_York");
        var days = dto.GetProperty("workHours").EnumerateArray().ToList();
        days.Select(d => d.GetProperty("dayOfWeek").GetInt32()).ShouldBe([1, 2, 3, 4, 5]);
        days[0].GetProperty("start").GetString().ShouldBe("09:00");
        days[0].GetProperty("end").GetString().ShouldBe("17:00");
    }

    [Fact]
    public async Task A_user_edits_their_own_availability_and_it_is_audited_in_readable_text()
    {
        var me = await ProvisionAsync(@"KE\scientist");
        var client = As(@"KE\scientist");
        var initial = await JsonAsync(await client.GetAsync("/api/v1/me/availability"));

        var response = await client.PutAsJsonAsync("/api/v1/me/availability", Body(Version(initial), "OUT_OF_OFFICE", until: "2099-10-20", note: "  Vacation\nin Maine "));
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var saved = await JsonAsync(response);

        saved.GetProperty("status").GetString().ShouldBe("OUT_OF_OFFICE");
        saved.GetProperty("until").GetString().ShouldBe("2099-10-20");
        saved.GetProperty("note").GetString().ShouldBe("Vacation in Maine");
        saved.GetProperty("current").GetProperty("state").GetString().ShouldBe("OUT_OF_OFFICE");
        saved.GetProperty("current").GetProperty("outUntilUtc").GetDateTime().ShouldBe(new DateTime(2099, 10, 21, 4, 0, 0, DateTimeKind.Utc));
        Version(saved).ShouldNotBe("NEW");

        var audit = await AuditAsync(me);
        audit.Count.ShouldBe(1);
        audit[0].EventType.ShouldBe("USER_AVAILABILITY_CHANGED");
        audit[0].ActorUserId.ShouldBe(me);
        audit[0].Summary.ShouldBe("Set out of office until Oct 20");

        var back = await client.PutAsJsonAsync("/api/v1/me/availability", Body(Version(saved)));
        (await JsonAsync(back)).GetProperty("note").ValueKind.ShouldBe(JsonValueKind.Null);
        (await AuditAsync(me)).Last().Summary.ShouldBe("Set available");
    }

    [Fact]
    public async Task Saving_without_changes_writes_no_audit_event()
    {
        var me = await ProvisionAsync(@"KE\scientist");
        var client = As(@"KE\scientist");
        var saved = await JsonAsync(await client.PutAsJsonAsync("/api/v1/me/availability", Body("NEW", "OUT_OF_OFFICE", note: "Away")));
        (await AuditAsync(me)).Count.ShouldBe(1);

        var again = await client.PutAsJsonAsync("/api/v1/me/availability", Body(Version(saved), "OUT_OF_OFFICE", note: "Away"));

        again.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await AuditAsync(me)).Count.ShouldBe(1);
    }

    [Fact]
    public async Task Work_hours_and_time_zone_are_saved_audited_and_can_be_reset()
    {
        var me = await ProvisionAsync(@"KE\scientist");
        var client = As(@"KE\scientist");
        var hours = new object[]
        {
            new { dayOfWeek = 2, start = "07:30", end = "15:30" },
            new { dayOfWeek = 6, start = "10:00", end = "12:00" },
        };

        var saved = await JsonAsync(await client.PutAsJsonAsync("/api/v1/me/availability", Body("NEW", zone: "America/Chicago", hours: hours)));

        saved.GetProperty("usesDefaultWorkHours").GetBoolean().ShouldBeFalse();
        saved.GetProperty("effectiveTimeZoneId").GetString().ShouldBe("America/Chicago");
        saved.GetProperty("workHours").EnumerateArray().Select(d => d.GetProperty("dayOfWeek").GetInt32()).ShouldBe([2, 6]);
        (await AuditAsync(me)).Select(e => e.EventType).ShouldBe(["USER_TIME_ZONE_CHANGED", "USER_WORK_HOURS_CHANGED"], ignoreOrder: true);

        // Replace: drop Saturday, move Tuesday. An empty list is a schedule without working days.
        var replaced = await JsonAsync(await client.PutAsJsonAsync("/api/v1/me/availability", Body(Version(saved), zone: "America/Chicago", hours: [new { dayOfWeek = 2, start = "08:00", end = "16:00" }])));
        replaced.GetProperty("workHours").EnumerateArray().Single().GetProperty("start").GetString().ShouldBe("08:00");
        var none = await JsonAsync(await client.PutAsJsonAsync("/api/v1/me/availability", Body(Version(replaced), zone: "America/Chicago", hours: [])));
        none.GetProperty("workHours").GetArrayLength().ShouldBe(0);
        none.GetProperty("usesDefaultWorkHours").GetBoolean().ShouldBeFalse();
        none.GetProperty("current").GetProperty("state").GetString().ShouldBe("OFF_HOURS");

        var reset = await JsonAsync(await client.PutAsJsonAsync("/api/v1/me/availability", Body(Version(none))));
        reset.GetProperty("usesDefaultWorkHours").GetBoolean().ShouldBeTrue();
        reset.GetProperty("workHours").GetArrayLength().ShouldBe(5);
        reset.GetProperty("timeZoneId").ValueKind.ShouldBe(JsonValueKind.Null);
        (await AuditAsync(me)).Last().Summary.ShouldBe("Work hours reset to the default (Mon-Fri 09:00-17:00)");
    }

    [Theory]
    [InlineData("OUT_OF_OFFICE", "2099-10-20", "2099-10-19", null, null, "OOO_RANGE_INVALID")]
    [InlineData("OUT_OF_OFFICE", "1900-01-01", null, null, null, "OOO_RANGE_INVALID")]
    [InlineData("AWAY", null, null, null, null, "STATUS_INVALID")]
    [InlineData("AVAILABLE", null, null, null, "Mars/Olympus", "TIMEZONE_UNKNOWN")]
    [InlineData("AVAILABLE", null, null, null, "Eastern Standard Time", "TIMEZONE_UNKNOWN")]
    [InlineData("OUT_OF_OFFICE", null, null, "x", null, "NOTE_TOO_LONG")]
    public async Task Invalid_input_returns_stable_codes(string status, string? from, string? until, string? note, string? zone, string code)
    {
        if (note == "x")
            note = new string('x', 201);

        var response = await As(@"KE\scientist").PutAsJsonAsync("/api/v1/me/availability", Body("NEW", status, from, until, note, zone));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await JsonAsync(response)).GetProperty("code").GetString().ShouldBe(code);
    }

    [Theory]
    [InlineData(0, "09:00", "17:00")]
    [InlineData(8, "09:00", "17:00")]
    [InlineData(1, "17:00", "09:00")]
    [InlineData(1, "09:00", "09:00")]
    [InlineData(1, "9am", "17:00")]
    [InlineData(1, "09:00", "24:00")]
    public async Task Invalid_work_hours_return_WORK_HOURS_INVALID(int day, string start, string end)
    {
        var response = await As(@"KE\scientist").PutAsJsonAsync("/api/v1/me/availability", Body("NEW", hours: [new { dayOfWeek = day, start, end }]));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await JsonAsync(response)).GetProperty("code").GetString().ShouldBe("WORK_HOURS_INVALID");
    }

    [Fact]
    public async Task A_weekday_listed_twice_is_rejected()
    {
        var response = await As(@"KE\scientist").PutAsJsonAsync("/api/v1/me/availability", Body("NEW", hours: [new { dayOfWeek = 1, start = "09:00", end = "12:00" }, new { dayOfWeek = 1, start = "13:00", end = "17:00" }]));

        (await JsonAsync(response)).GetProperty("code").GetString().ShouldBe("WORK_HOURS_INVALID");
    }

    [Fact]
    public async Task A_stale_or_missing_row_version_is_a_409_and_a_missing_one_a_400()
    {
        var client = As(@"KE\scientist");
        var saved = await JsonAsync(await client.PutAsJsonAsync("/api/v1/me/availability", Body("NEW", "OUT_OF_OFFICE")));

        var stale = await client.PutAsJsonAsync("/api/v1/me/availability", Body("NEW"));
        stale.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await JsonAsync(stale)).GetProperty("code").GetString().ShouldBe("CONCURRENCY_CONFLICT");

        // A first successful change moves the version on; the old one is now stale.
        await client.PutAsJsonAsync("/api/v1/me/availability", Body(Version(saved)));
        (await client.PutAsJsonAsync("/api/v1/me/availability", Body(Version(saved), "OUT_OF_OFFICE"))).StatusCode.ShouldBe(HttpStatusCode.Conflict);

        (await client.PutAsJsonAsync("/api/v1/me/availability", new { status = "AVAILABLE" })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Another_user_cannot_edit_but_a_user_manager_can_on_their_behalf_with_the_editor_as_actor()
    {
        var target = await ProvisionAsync(@"KE\scientist");
        var admin = await ProvisionAsync(DatabaseApiFactory.AdminAccount);
        var body = Body("NEW", "OUT_OF_OFFICE", from: "2099-01-05", until: "2099-01-09", note: "Sick leave");

        (await As(@"KE\director").PutAsJsonAsync($"/api/v1/users/{target}/availability", body)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await As(@"KE\director").GetAsync($"/api/v1/users/{target}/availability")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await As(@"KE\scientist").PutAsJsonAsync($"/api/v1/users/{target}/availability", body)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        var response = await As(DatabaseApiFactory.AdminAccount).PutAsJsonAsync($"/api/v1/users/{target}/availability", body);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await JsonAsync(response)).GetProperty("updatedByUserId").GetInt32().ShouldBe(admin);

        var audit = (await AuditAsync(target)).Single();
        audit.ActorUserId.ShouldBe(admin);
        audit.ObjectId.ShouldBe(target.ToString());
        audit.Summary.ShouldBe("Set out of office from Jan 5 until Jan 9 (on behalf)");

        var own = await JsonAsync(await As(@"KE\scientist").GetAsync("/api/v1/me/availability"));
        own.GetProperty("note").GetString().ShouldBe("Sick leave");
        (await As(DatabaseApiFactory.AdminAccount).GetAsync("/api/v1/users/999999/availability")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Access_pending_users_cannot_use_the_availability_endpoints()
    {
        var response = await As(@"KE\nobody").GetAsync("/api/v1/me/availability");

        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task The_users_zone_decides_when_out_of_office_starts()
    {
        var client = As(@"KE\scientist");
        var zone = TimeZoneInfo.FindSystemTimeZoneById("Pacific/Kiritimati"); // UTC+14: its calendar date differs from the date in New York for 14 hours of the day
        var localToday = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone));

        var tomorrow = await JsonAsync(await client.PutAsJsonAsync("/api/v1/me/availability", Body("NEW", "OUT_OF_OFFICE", from: localToday.AddDays(1).ToString("yyyy-MM-dd"), zone: "Pacific/Kiritimati")));
        tomorrow.GetProperty("current").GetProperty("state").GetString().ShouldNotBe("OUT_OF_OFFICE");

        var today = await JsonAsync(await client.PutAsJsonAsync("/api/v1/me/availability", Body(Version(tomorrow), "OUT_OF_OFFICE", from: localToday.ToString("yyyy-MM-dd"), zone: "Pacific/Kiritimati")));
        today.GetProperty("current").GetProperty("state").GetString().ShouldBe("OUT_OF_OFFICE");
    }

    [Fact]
    public async Task Lookups_and_the_admin_users_list_carry_the_compact_availability()
    {
        var out1 = await ProvisionAsync(@"KE\outperson");
        await ProvisionAsync(@"KE\present");
        var roleId = await _factory.CreateRoleAsync("Worker", "Task.View");
        await _factory.GrantRoleAsync(@"KE\outperson", roleId);
        await _factory.GrantRoleAsync(@"KE\present", roleId);
        var saved = await As(@"KE\outperson").PutAsJsonAsync("/api/v1/me/availability", Body("NEW", "OUT_OF_OFFICE", until: "2099-10-20", note: "Conference"));
        saved.StatusCode.ShouldBe(HttpStatusCode.OK);

        var lookup = (await JsonAsync(await As(@"KE\scientist").GetAsync("/api/v1/users/lookup?q=outperson"))).EnumerateArray().Single();
        var availability = lookup.GetProperty("availability");
        availability.GetProperty("state").GetString().ShouldBe("OUT_OF_OFFICE");
        availability.GetProperty("note").GetString().ShouldBe("Conference");
        availability.GetProperty("outUntil").GetDateTime().Year.ShouldBe(2099);

        var presentLookup = (await JsonAsync(await As(@"KE\scientist").GetAsync("/api/v1/users/lookup?q=present"))).EnumerateArray().Single();
        presentLookup.GetProperty("availability").GetProperty("state").GetString().ShouldBeOneOf("AVAILABLE", "OFF_HOURS");

        var list = await JsonAsync(await As(DatabaseApiFactory.AdminAccount).GetAsync("/api/v1/users?search=outperson"));
        var row = list.GetProperty("items").EnumerateArray().Single(u => u.GetProperty("userId").GetInt32() == out1);
        row.GetProperty("availability").GetProperty("state").GetString().ShouldBe("OUT_OF_OFFICE");
    }
}
