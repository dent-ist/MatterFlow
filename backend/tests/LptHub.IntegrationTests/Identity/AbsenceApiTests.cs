using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.Audit.Domain;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Microsoft.EntityFrameworkCore;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Identity;

/// <summary>
/// Out of office entries (Dashboard Calendar, epic #1074, issue #1078): list, add, change, delete and "I'm back" with the rules of decision AT (end inclusive, overlap refused naming the other entry,
/// past starts, read-only history, open-ended only from today, note length), who may edit whose entries (the person, a Pod Lead in a shared pod, a Director) and the audit events.
/// The clock is Wednesday 2026-10-14 noon in New York.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class AbsenceApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private static readonly DateTime Noon = new(2026, 10, 14, 16, 0, 0, DateTimeKind.Utc);
    private static readonly string[] Worker = ["Task.View", "Workflow.Execute", "Pod.View"];

    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private HttpClient _ann = null!;
    private HttpClient _ben = null!;
    private HttpClient _lead = null!;
    private HttpClient _otherLead = null!;
    private HttpClient _director = null!;
    private int _annId;
    private int _benId;
    private int _leadId;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { Clock = new MutableClock(Noon) };
        _h = new TaskHarness(_factory);
        _ann = await _h.UserWithAsync(@"KE\ann", Worker);
        _ben = await _h.UserWithAsync(@"KE\ben", Worker);
        _lead = await _h.UserWithAsync(@"KE\lead", [.. Worker, "User.ManageAvailability"]);
        _otherLead = await _h.UserWithAsync(@"KE\otherlead", [.. Worker, "User.ManageAvailability"]);
        _director = await _h.UserWithAsync(@"KE\director", [.. Worker, "User.ManageAvailability", "User.View"]);
        _annId = await _h.UserIdAsync(@"KE\ann");
        _benId = await _h.UserIdAsync(@"KE\ben");
        _leadId = await _h.UserIdAsync(@"KE\lead");
        var otherLeadId = await _h.UserIdAsync(@"KE\otherlead");
        await _h.CreatePodAsync("Review", _annId, _leadId);
        await _h.CreatePodAsync("Processing", _benId, otherLeadId);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static object Entry(string type, string start, string? end, string? note = null, string? version = null) => new { type, startDate = start, endDate = end, note, rowVersion = version };

    private Task<HttpResponseMessage> AddAsync(HttpClient client, int user, string type, string start, string? end, string? note = null) =>
        client.PostAsJsonAsync($"/api/v1/users/{user}/absences", Entry(type, start, end, note));

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>();

    private Task<List<AuditEvent>> AuditAsync(int userId) =>
        _factory.WithDbAsync(db => db.Set<AuditEvent>().AsNoTracking().Where(e => e.ObjectType == "User" && e.ObjectId == userId.ToString() && e.FieldKey == "absence").OrderBy(e => e.Id).ToListAsync());

    [Fact]
    public async Task A_person_adds_an_entry_for_themselves_and_it_shows_with_state_and_working_days()
    {
        var response = await AddAsync(_ann, _annId, "VACATION", "2026-10-19", "2026-10-23", "  Trip\nto Maine ");

        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        var entry = await JsonAsync(response);
        entry.GetProperty("type").GetString().ShouldBe("VACATION");
        entry.GetProperty("state").GetString().ShouldBe("UPCOMING");
        entry.GetProperty("workingDays").GetInt32().ShouldBe(5);
        entry.GetProperty("note").GetString().ShouldBe("Trip to Maine");
        entry.GetProperty("rowVersion").GetString().ShouldNotBeNullOrEmpty();

        var list = await JsonAsync(await _ann.GetAsync($"/api/v1/users/{_annId}/absences"));
        list.GetArrayLength().ShouldBe(1);
        var availability = await JsonAsync(await _ann.GetAsync("/api/v1/me/availability"));
        availability.GetProperty("absences").GetArrayLength().ShouldBe(1);
        availability.GetProperty("current").GetProperty("state").GetString().ShouldNotBe("OUT_OF_OFFICE");
    }

    [Fact]
    public async Task Two_entries_do_not_overlap_the_end_day_is_inclusive_and_the_409_names_the_other_entry()
    {
        var first = await JsonAsync(await AddAsync(_ann, _annId, "VACATION", "2026-10-19", "2026-10-23"));

        var overlap = await AddAsync(_ann, _annId, "TRAINING", "2026-10-23", "2026-10-26"); // starts on the last day of the first entry

        overlap.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        var problem = await JsonAsync(overlap);
        problem.GetProperty("code").GetString().ShouldBe("ABSENCE_OVERLAP");
        var other = problem.GetProperty("meta").GetProperty("overlapsWith");
        other.GetProperty("absenceId").GetInt32().ShouldBe(first.GetProperty("absenceId").GetInt32());
        other.GetProperty("type").GetString().ShouldBe("VACATION");
        other.GetProperty("startDate").GetString().ShouldBe("2026-10-19");
        other.GetProperty("endDate").GetString().ShouldBe("2026-10-23");
        problem.GetProperty("detail").GetString()!.ShouldContain("10/19/2026");

        (await AddAsync(_ann, _annId, "TRAINING", "2026-10-24", "2026-10-26")).StatusCode.ShouldBe(HttpStatusCode.Created); // the day after is free
        (await AddAsync(_ann, _annId, "OTHER", "2026-10-15", "2026-10-15")).StatusCode.ShouldBe(HttpStatusCode.Created); // before it is free
        (await AddAsync(_ann, _annId, "OTHER", "2026-10-21", "2026-10-21")).StatusCode.ShouldBe(HttpStatusCode.Conflict); // inside it
    }

    [Fact]
    public async Task Changing_an_entry_does_not_overlap_itself_but_does_overlap_the_next()
    {
        var a = await JsonAsync(await AddAsync(_ann, _annId, "VACATION", "2026-10-19", "2026-10-21"));
        await AddAsync(_ann, _annId, "TRAINING", "2026-10-26", "2026-10-28");

        var longer = await _ann.PutAsJsonAsync($"/api/v1/users/{_annId}/absences/{a.GetProperty("absenceId").GetInt32()}", Entry("VACATION", "2026-10-19", "2026-10-23", null, a.GetProperty("rowVersion").GetString()));
        longer.StatusCode.ShouldBe(HttpStatusCode.OK);
        var changed = await JsonAsync(longer);
        changed.GetProperty("endDate").GetString().ShouldBe("2026-10-23");

        var into = await _ann.PutAsJsonAsync($"/api/v1/users/{_annId}/absences/{a.GetProperty("absenceId").GetInt32()}", Entry("VACATION", "2026-10-19", "2026-10-26", null, changed.GetProperty("rowVersion").GetString()));
        into.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await JsonAsync(into)).GetProperty("code").GetString().ShouldBe("ABSENCE_OVERLAP");
    }

    [Theory]
    [InlineData("VACATION", "2026-10-20", "2026-10-19", null, "ABSENCE_RANGE_INVALID")]
    [InlineData("HOLIDAY", "2026-10-20", "2026-10-21", null, "ABSENCE_TYPE_INVALID")]
    [InlineData("VACATION", "2026-10-13", "2026-10-15", null, "ABSENCE_IN_PAST")] // yesterday, not Sick
    [InlineData("SICK", "2026-09-29", "2026-10-15", null, "ABSENCE_IN_PAST")] // 15 days back
    [InlineData("VACATION", "2026-10-20", null, null, "ABSENCE_OPEN_ENDED_NOT_TODAY")]
    [InlineData("VACATION", "1999-01-01", "1999-01-02", null, "ABSENCE_RANGE_INVALID")]
    [InlineData("VACATION", "2026-10-20", "2026-10-21", "x201", "NOTE_TOO_LONG")]
    public async Task Invalid_entries_return_stable_codes(string type, string start, string? end, string? note, string code)
    {
        if (note == "x201")
            note = new string('x', 201);

        var response = await AddAsync(_ann, _annId, type, start, end, note);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await JsonAsync(response)).GetProperty("code").GetString().ShouldBe(code);
    }

    [Fact]
    public async Task A_sick_entry_may_start_up_to_14_days_back_and_today_is_not_the_past()
    {
        (await AddAsync(_ann, _annId, "SICK", "2026-09-30", "2026-10-02")).StatusCode.ShouldBe(HttpStatusCode.Created); // exactly 14 days back
        (await AddAsync(_ann, _annId, "VACATION", "2026-10-14", "2026-10-14")).StatusCode.ShouldBe(HttpStatusCode.Created); // today
    }

    [Fact]
    public async Task A_manager_may_enter_a_past_sick_day_for_someone_else_and_it_is_audited_with_the_manager_as_actor()
    {
        var response = await AddAsync(_lead, _annId, "SICK", "2026-10-12", "2026-10-13", "Flu");

        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        var events = await AuditAsync(_annId);
        events.Count.ShouldBe(1);
        events[0].EventType.ShouldBe("USER_ABSENCE_ADDED");
        events[0].ActorUserId.ShouldBe(_leadId);
        events[0].Summary.ShouldBe(@"Added Sick 10/12/2026 to 10/13/2026 for KE\ann");
        events[0].Summary!.ShouldNotContain("Flu"); // the note is in the event detail, not in the readable text
        events[0].NewValue!.ShouldContain("Flu");
    }

    [Fact]
    public async Task An_open_ended_entry_starts_today_and_Im_back_ends_it_yesterday()
    {
        var open = await AddAsync(_ann, _annId, "OTHER", "2026-10-14", null);
        open.StatusCode.ShouldBe(HttpStatusCode.Created);
        var created = await JsonAsync(open);
        created.GetProperty("state").GetString().ShouldBe("NOW");
        created.GetProperty("endDate").ValueKind.ShouldBe(JsonValueKind.Null);
        created.GetProperty("workingDays").ValueKind.ShouldBe(JsonValueKind.Null);
        var availability = await JsonAsync(await _ann.GetAsync("/api/v1/me/availability"));
        availability.GetProperty("current").GetProperty("state").GetString().ShouldBe("OUT_OF_OFFICE");

        // Started today: ending it yesterday would leave nothing, so it is deleted.
        var back = await JsonAsync(await _ann.PostAsync($"/api/v1/users/{_annId}/absences/{created.GetProperty("absenceId").GetInt32()}/back", null));
        back.GetProperty("deleted").GetBoolean().ShouldBeTrue();
        (await JsonAsync(await _ann.GetAsync($"/api/v1/users/{_annId}/absences"))).GetArrayLength().ShouldBe(0);
    }

    [Fact]
    public async Task Im_back_on_a_running_entry_ends_it_yesterday_and_keeps_it_as_history()
    {
        await _factory.AddAbsenceAsync(_annId, "2026-10-12", "2026-10-16", null, "VACATION"); // started Monday, runs to Friday
        var running = (await JsonAsync(await _ann.GetAsync($"/api/v1/users/{_annId}/absences"))).EnumerateArray().Single();
        running.GetProperty("state").GetString().ShouldBe("NOW");

        var back = await JsonAsync(await _ann.PostAsync($"/api/v1/users/{_annId}/absences/{running.GetProperty("absenceId").GetInt32()}/back", null));

        back.GetProperty("deleted").GetBoolean().ShouldBeFalse();
        back.GetProperty("absence").GetProperty("endDate").GetString().ShouldBe("2026-10-13");
        back.GetProperty("absence").GetProperty("state").GetString().ShouldBe("PAST");
        (await JsonAsync(await _ann.GetAsync($"/api/v1/users/{_annId}/absences"))).GetArrayLength().ShouldBe(0);
        (await JsonAsync(await _ann.GetAsync($"/api/v1/users/{_annId}/absences?includePast=true"))).GetArrayLength().ShouldBe(1);
        (await JsonAsync(await _ann.GetAsync("/api/v1/me/availability"))).GetProperty("current").GetProperty("state").GetString().ShouldNotBe("OUT_OF_OFFICE");
    }

    [Fact]
    public async Task Past_entries_are_read_only()
    {
        await _factory.AddAbsenceAsync(_annId, "2026-10-05", "2026-10-09", "Old", "VACATION");
        var past = (await JsonAsync(await _ann.GetAsync($"/api/v1/users/{_annId}/absences?includePast=true"))).EnumerateArray().Single();
        past.GetProperty("state").GetString().ShouldBe("PAST");
        var id = past.GetProperty("absenceId").GetInt32();
        var version = past.GetProperty("rowVersion").GetString();

        var put = await _ann.PutAsJsonAsync($"/api/v1/users/{_annId}/absences/{id}", Entry("VACATION", "2026-10-05", "2026-10-10", null, version));
        put.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await JsonAsync(put)).GetProperty("code").GetString().ShouldBe("ABSENCE_READ_ONLY");
        (await _ann.DeleteAsync($"/api/v1/users/{_annId}/absences/{id}?rowVersion={Uri.EscapeDataString(version!)}")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _ann.PostAsync($"/api/v1/users/{_annId}/absences/{id}/back", null)).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Delete_needs_the_current_row_version_and_every_write_is_audited()
    {
        var entry = await JsonAsync(await AddAsync(_ann, _annId, "VACATION", "2026-10-19", "2026-10-21"));
        var id = entry.GetProperty("absenceId").GetInt32();
        var version = entry.GetProperty("rowVersion").GetString()!;

        var stale = await _ann.DeleteAsync($"/api/v1/users/{_annId}/absences/{id}?rowVersion={Uri.EscapeDataString("AAAAAAAAB9E=")}");
        stale.StatusCode.ShouldBe(HttpStatusCode.Conflict);

        var changed = await JsonAsync(await _ann.PutAsJsonAsync($"/api/v1/users/{_annId}/absences/{id}", Entry("TRAINING", "2026-10-19", "2026-10-21", "Course", version)));
        (await _ann.DeleteAsync($"/api/v1/users/{_annId}/absences/{id}?rowVersion={Uri.EscapeDataString(version)}")).StatusCode.ShouldBe(HttpStatusCode.Conflict); // the old version is stale now
        (await _ann.DeleteAsync($"/api/v1/users/{_annId}/absences/{id}?rowVersion={Uri.EscapeDataString(changed.GetProperty("rowVersion").GetString()!)}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        var events = await AuditAsync(_annId);
        events.Select(e => e.EventType).ShouldBe(["USER_ABSENCE_ADDED", "USER_ABSENCE_CHANGED", "USER_ABSENCE_DELETED"]);
        events.Select(e => e.Summary).ShouldBe(["Added Vacation 10/19/2026 to 10/21/2026", "Changed Training 10/19/2026 to 10/21/2026", "Deleted Training 10/19/2026 to 10/21/2026"]);
        events.ShouldAllBe(e => e.ActorUserId == _annId);
    }

    [Fact]
    public async Task A_change_that_changes_nothing_writes_no_audit_event()
    {
        var entry = await JsonAsync(await AddAsync(_ann, _annId, "VACATION", "2026-10-19", "2026-10-21", "x"));

        var same = await _ann.PutAsJsonAsync($"/api/v1/users/{_annId}/absences/{entry.GetProperty("absenceId").GetInt32()}", Entry("VACATION", "2026-10-19", "2026-10-21", "x", entry.GetProperty("rowVersion").GetString()));

        same.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await AuditAsync(_annId)).Count.ShouldBe(1);
    }

    [Fact]
    public async Task Who_may_edit_whose_entries()
    {
        // A colleague without User.ManageAvailability: no. A Pod Lead for a person in a shared pod: yes. A Pod Lead for a person in another pod: no. A Director (User.View): everybody.
        (await AddAsync(_ben, _annId, "VACATION", "2026-10-19", "2026-10-20")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await _ben.GetAsync($"/api/v1/users/{_annId}/absences")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await AddAsync(_lead, _annId, "VACATION", "2026-10-19", "2026-10-20")).StatusCode.ShouldBe(HttpStatusCode.Created); // Review pod: lead and ann
        (await AddAsync(_lead, _benId, "VACATION", "2026-10-19", "2026-10-20")).StatusCode.ShouldBe(HttpStatusCode.Forbidden); // Processing pod
        (await AddAsync(_otherLead, _annId, "TRAINING", "2026-10-21", "2026-10-22")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await AddAsync(_director, _benId, "VACATION", "2026-10-19", "2026-10-20")).StatusCode.ShouldBe(HttpStatusCode.Created);
        (await AddAsync(_director, 999999, "VACATION", "2026-10-19", "2026-10-20")).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        // The same rules for the entry of someone else: the lead cannot change or delete the entry of a person in another pod, and cannot read the availability of one.
        var benEntry = (await JsonAsync(await _director.GetAsync($"/api/v1/users/{_benId}/absences"))).EnumerateArray().Single();
        (await _lead.PutAsJsonAsync($"/api/v1/users/{_benId}/absences/{benEntry.GetProperty("absenceId").GetInt32()}", Entry("OTHER", "2026-10-19", "2026-10-20", null, benEntry.GetProperty("rowVersion").GetString()))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await _lead.GetAsync($"/api/v1/users/{_benId}/availability")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await _lead.GetAsync($"/api/v1/users/{_annId}/availability")).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task An_entry_of_another_user_id_in_the_route_is_not_found_not_changed()
    {
        var entry = await JsonAsync(await AddAsync(_ann, _annId, "VACATION", "2026-10-19", "2026-10-20"));

        var wrongOwner = await _director.PutAsJsonAsync($"/api/v1/users/{_benId}/absences/{entry.GetProperty("absenceId").GetInt32()}", Entry("OTHER", "2026-10-19", "2026-10-20", null, entry.GetProperty("rowVersion").GetString()));

        wrongOwner.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Two_entries_added_at_the_same_moment_never_both_succeed_when_they_overlap()
    {
        var tasks = Enumerable.Range(0, 6).Select(_ => AddAsync(_ann, _annId, "VACATION", "2026-10-19", "2026-10-23")).ToArray();

        var codes = (await Task.WhenAll(tasks)).Select(r => r.StatusCode).ToList();

        codes.Count(c => c == HttpStatusCode.Created).ShouldBe(1);
        codes.Count(c => c == HttpStatusCode.Conflict).ShouldBe(5);
    }

    [Fact]
    public async Task The_advisory_check_names_the_pods_that_would_fall_below_their_minimum_and_never_blocks()
    {
        // Review pod: ann and lead (both Workflow.Execute workers). With ann out for two days the pod has one of two: below the minimum of 2 (60 percent of 2, rounded up).
        var raw = await _ann.PostAsJsonAsync($"/api/v1/users/{_annId}/absences/check", new { startDate = "2026-10-19", endDate = "2026-10-20" });
        raw.StatusCode.ShouldBe(HttpStatusCode.OK, await raw.Content.ReadAsStringAsync());
        var check = await JsonAsync(raw);

        var pods = check.GetProperty("podsBelowMinimum").EnumerateArray().ToList();
        pods.Count.ShouldBe(1);
        pods[0].GetProperty("name").GetString().ShouldBe("Review");
        pods[0].GetProperty("days").EnumerateArray().Select(d => d.GetString()).ShouldBe(["2026-10-19", "2026-10-20"]);

        (await _ben.PostAsJsonAsync($"/api/v1/users/{_annId}/absences/check", new { startDate = "2026-10-19", endDate = "2026-10-20" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }
}
