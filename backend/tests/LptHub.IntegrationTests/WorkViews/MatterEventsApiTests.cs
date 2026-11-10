using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// Matter events (UI update epic #953, UI-05, issue #958): the eight fixed types, who may create, change and delete (the matter's Primary and Secondary PM and holders of Matter.Edit), the
/// validation, the optimistic concurrency, the My Matters calendar and upcoming list, and the audit trail.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class MatterEventsApiTests(SqlServerFixture sql) : MyMattersTestBase(sql)
{
    private static object Body(string title = "Motion hearing", string type = "COURT_HEARING", string? date = null, string? time = "10:00", string? note = null, string? rowVersion = null) =>
        new { typeCode = type, title, date = date ?? In(10), time, note, rowVersion };

    private Task<HttpResponseMessage> Create(HttpClient client, int matterId, object body) => client.PostAsJsonAsync($"/api/v1/matters/{matterId}/events", body);

    private static async Task<string> CodeAsync(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.GetProperty("code").GetString()!;

    [Fact]
    public async Task The_eight_event_types_are_a_fixed_list_in_display_order()
    {
        var types = await GetAsync(A, "/api/v1/matter-event-types");
        types.EnumerateArray().Select(t => t.GetProperty("code").GetString()).ShouldBe(
            ["COURT_HEARING", "TRIAL", "DEPOSITION", "PRODUCTION_DEADLINE", "FILING_DEADLINE", "MEDIATION", "CLIENT_MEETING", "OTHER"]);
        types.EnumerateArray().Select(t => t.GetProperty("label").GetString()).ShouldBe(
            ["Court hearing", "Trial", "Deposition", "Production deadline", "Filing deadline", "Mediation or settlement", "Client meeting or call", "Other"]);
        types.EnumerateArray().ShouldAllBe(t => t.GetProperty("iconKey").GetString()!.Length > 0 && t.GetProperty("colourKey").GetString()!.Length > 0);
        (await NoTaskView.GetAsync("/api/v1/matter-event-types")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await (await H.UserWithAsync(@"KE\noperm", "Client.View")).GetAsync("/api/v1/matter-event-types")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Primary_and_secondary_PM_and_matter_editors_may_write_nobody_else()
    {
        // A is Primary of M1 and Secondary of M2; B is neither on M1 (Primary of M2).
        var created = await OkAsync(await Create(A, M1, Body("By the primary")), HttpStatusCode.Created);
        created.GetProperty("canEdit").GetBoolean().ShouldBeTrue();
        created.GetProperty("matterId").GetInt32().ShouldBe(M1);
        created.GetProperty("typeLabel").GetString().ShouldBe("Court hearing");
        created.GetProperty("time").GetString().ShouldBe("10:00");
        created.GetProperty("createdByName").GetString().ShouldNotBeNullOrEmpty();
        (await Create(A, M2, Body("By the secondary"))).StatusCode.ShouldBe(HttpStatusCode.Created);

        foreach (var (name, client) in new[] { ("B (not a manager of M1)", B), ("observer", Observer) })
        {
            var response = await Create(client, M1, Body("Nope"));
            response.StatusCode.ShouldBe(HttpStatusCode.Forbidden, name);
            (await CodeAsync(response)).ShouldBe("NOT_MATTER_MANAGER", name);
        }

        // A holder of Matter.Edit may write on a matter nobody manages (M3); the Dev "Director" role holds it too.
        (await Create(Director, M3, Body("By the director"))).StatusCode.ShouldBe(HttpStatusCode.Created);
        var editor = await H.UserWithAsync(@"KE\editor", "Matter.View", "Matter.Edit");
        (await Create(editor, M3, Body("By an editor"))).StatusCode.ShouldBe(HttpStatusCode.Created);

        // canEdit is computed per viewer.
        var list = await GetAsync(Observer, $"/api/v1/matters/{M1}/events?from={In(0)}&to={In(30)}");
        list.GetProperty("total").GetInt32().ShouldBe(1);
        list.GetProperty("items")[0].GetProperty("canEdit").GetBoolean().ShouldBeFalse();
        (await GetAsync(A, $"/api/v1/matters/{M1}/events?from={In(0)}&to={In(30)}")).GetProperty("items")[0].GetProperty("canEdit").GetBoolean().ShouldBeTrue();
    }

    [Fact]
    public async Task Bad_input_is_a_400_with_the_field_and_an_archived_matter_gets_no_new_events()
    {
        async Task<JsonElement> Field(object body, string field)
        {
            var response = await Create(A, M1, body);
            response.StatusCode.ShouldBe(HttpStatusCode.BadRequest, field);
            var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
            problem.GetProperty("errors").TryGetProperty(field, out _).ShouldBeTrue(field + " " + problem.GetRawText());
            return problem;
        }

        await Field(Body(type: "PARTY"), "typeCode");
        await Field(Body(title: "   "), "title");
        await Field(Body(time: "25:00"), "time");
        await Field(Body(time: "9:5"), "time");
        await Field(new { typeCode = "OTHER", title = "No date" }, "date");
        (await Create(A, M1, Body(time: null))).StatusCode.ShouldBe(HttpStatusCode.Created); // all day

        var archived = await Create(A, M5, Body());
        archived.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await CodeAsync(archived)).ShouldBe("VALIDATION_FAILED");
        (await Create(A, 999999, Body())).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Update_and_delete_need_the_current_row_version_and_are_audited()
    {
        var created = await OkAsync(await Create(A, M1, Body("Before")), HttpStatusCode.Created);
        var id = created.GetProperty("eventId").GetInt32();
        var rv = created.GetProperty("rowVersion").GetString()!;

        var updated = await OkAsync(await A.PutAsJsonAsync($"/api/v1/matter-events/{id}", Body("After", "DEPOSITION", In(12), null, "Bring exhibits", rv)));
        updated.GetProperty("title").GetString().ShouldBe("After");
        updated.GetProperty("typeCode").GetString().ShouldBe("DEPOSITION");
        updated.GetProperty("time").ValueKind.ShouldBe(JsonValueKind.Null);
        updated.GetProperty("note").GetString().ShouldBe("Bring exhibits");
        updated.GetProperty("modifiedByName").GetString().ShouldNotBeNullOrEmpty();

        var stale = await A.PutAsJsonAsync($"/api/v1/matter-events/{id}", Body("Stale", rowVersion: rv));
        stale.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await CodeAsync(stale)).ShouldBe("CONCURRENCY_CONFLICT");
        (await A.PutAsJsonAsync($"/api/v1/matter-events/{id}", Body("No version"))).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await B.PutAsJsonAsync($"/api/v1/matter-events/{id}", Body("Not mine", rowVersion: updated.GetProperty("rowVersion").GetString()))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await B.DeleteAsync($"/api/v1/matter-events/{id}?rowVersion={Uri.EscapeDataString(updated.GetProperty("rowVersion").GetString()!)}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        (await A.DeleteAsync($"/api/v1/matter-events/{id}?rowVersion={Uri.EscapeDataString(rv)}")).StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await A.DeleteAsync($"/api/v1/matter-events/{id}")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await A.DeleteAsync($"/api/v1/matter-events/{id}?rowVersion={Uri.EscapeDataString(updated.GetProperty("rowVersion").GetString()!)}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await A.DeleteAsync($"/api/v1/matter-events/{id}?rowVersion={Uri.EscapeDataString(rv)}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await GetAsync(A, $"/api/v1/matters/{M1}/events?from={In(0)}&to={In(30)}")).GetProperty("total").GetInt32().ShouldBe(0);

        // Create, change and delete are in the audit trail of the matter.
        var audit = await GetAsync(H.Admin, $"/api/v1/audit/search?pageSize=200");
        var text = audit.GetRawText();
        text.ShouldContain("MatterEvent");
        text.ShouldContain("Before");
    }

    [Fact]
    public async Task The_scope_lists_and_counts_events_of_my_matters_only_in_date_order()
    {
        await Create(A, M1, Body("m1 late", date: In(5), time: "15:00"));
        await Create(A, M1, Body("m1 all day", date: In(5), time: null));
        await Create(A, M1, Body("m1 early", date: In(5), time: "08:30", type: "TRIAL"));
        await Create(A, M2, Body("m2 soon", date: In(1)));
        await Create(A, M2, Body("m2 far", date: In(40)));
        await Create(A, M2, Body("m2 yesterday", date: In(-1)));
        var editor = await H.UserWithAsync(@"KE\editor2", "Matter.View", "Matter.Edit");
        await Create(editor, M3, Body("nobody's matter", date: In(2)));

        var upcoming = await Mine("events/upcoming?days=14");
        upcoming.GetProperty("total").GetInt32().ShouldBe(4, upcoming.GetRawText()); // m2 soon + the three on day 5; not far, not past, not M3
        upcoming.GetProperty("items").EnumerateArray().Select(e => e.GetProperty("title").GetString()).ShouldBe(["m2 soon", "m1 all day", "m1 early", "m1 late"]);
        (await Mine("events/upcoming?days=14&take=2")).GetProperty("items").GetArrayLength().ShouldBe(2);
        (await Mine("events/upcoming?days=14&take=2")).GetProperty("total").GetInt32().ShouldBe(4);
        (await Mine("events/upcoming?days=60")).GetProperty("total").GetInt32().ShouldBe(5);

        var range = await Mine($"events?from={In(-1)}&to={In(6)}");
        range.GetProperty("items").EnumerateArray().Select(e => e.GetProperty("title").GetString()).ShouldBe(["m2 yesterday", "m2 soon", "m1 all day", "m1 early", "m1 late"]);
        (await Mine($"events?from={In(-1)}&to={In(6)}&typeCode=TRIAL")).GetProperty("total").GetInt32().ShouldBe(1);
        (await Mine($"events?from={In(-1)}&to={In(6)}&matterId={M2}")).GetProperty("total").GetInt32().ShouldBe(2);
        (await Mine($"events?from={In(-1)}&to={In(6)}&clientId={await ClientOfAsync(M4)}")).GetProperty("total").GetInt32().ShouldBe(0);

        // B manages M2 as Primary: sees only M2's; the director sees everything with scope=all.
        (await Mine($"events?from={In(-1)}&to={In(60)}", B)).GetProperty("total").GetInt32().ShouldBe(3);
        (await Mine($"events?scope=all&from={In(-1)}&to={In(60)}", Director)).GetProperty("total").GetInt32().ShouldBe(7);
    }

    [Fact]
    public async Task The_scope_calls_validate_their_parameters()
    {
        foreach (var url in new[] { "events", $"events?from={In(0)}", $"events?to={In(0)}", $"events?from={In(5)}&to={In(0)}", $"events?from={In(0)}&to={In(200)}", $"events?from={In(0)}&to={In(5)}&typeCode=PARTY", $"events?from={In(0)}&to={In(5)}&nope=1", "events/upcoming?days=0", "events/upcoming?days=61", "events/upcoming?take=51", "events/upcoming?from=2030-01-01" })
            (await A.GetAsync("/api/v1/my-matters/" + url)).StatusCode.ShouldBe(HttpStatusCode.BadRequest, url);
        (await A.GetAsync($"/api/v1/my-matters/events?scope=all&from={In(0)}&to={In(5)}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await NoTaskView.GetAsync($"/api/v1/my-matters/events/upcoming")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await A.GetAsync($"/api/v1/matters/{M1}/events?from={In(0)}&to={In(200)}")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await A.GetAsync($"/api/v1/matters/{M1}/events?x=1")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    private async Task<int> ClientOfAsync(int matterId) => (await GetAsync(H.Admin, $"/api/v1/matters/{matterId}")).GetProperty("clientId").GetInt32();
}
