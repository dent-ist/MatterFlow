using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Organization;

/// <summary>
/// Marking and un-marking a matter sensitive (epic #788, SM-05, #793): one dedicated audit event, the confirmation when the actor would lose sight of the matter,
/// un-marking only for people who can see the matter, and the creator rule. With the go-live switch off the guard rails stay out of the way and only the event is added.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class SensitivityMarkingTests(SqlServerFixture sql)
{
    private static async Task<JsonElement> GetAsync(HttpClient c, string url) => await OkAsync(await c.GetAsync(url));

    private static Task<HttpResponseMessage> PutAsync(HttpClient c, JsonElement matter, bool sensitive, bool? confirm = null, int? primary = null) =>
        c.PutAsJsonAsync($"/api/v1/matters/{matter.GetProperty("matterId").GetInt32()}", new
        {
            name = matter.GetProperty("name").GetString(),
            isSensitive = sensitive,
            confirmLossOfAccess = confirm ?? false,
            primaryManagerId = primary,
            rowVersion = matter.GetProperty("rowVersion").GetString(),
        });

    private static Task<List<MatterFlow.Audit.Domain.AuditEvent>> EventsAsync(SensitiveUniverse u, int matterId) =>
        u.H.Factory.WithDbAsync(db => Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.ToListAsync(
            db.Set<MatterFlow.Audit.Domain.AuditEvent>().Where(a => a.MatterId == matterId && a.EventType == "MATTER_SENSITIVITY_CHANGED").OrderBy(a => a.Id)));

    [Fact]
    public async Task Marking_and_un_marking_write_one_dedicated_event_each_and_no_generic_field_change()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            // The viewer (Matter.ViewSensitive) marks the normal matter, then un-marks it.
            var matter = await GetAsync(u.ViewerClient, $"/api/v1/matters/{u.N1}");
            var marked = await OkAsync(await PutAsync(u.ViewerClient, matter, true));
            marked.GetProperty("isSensitive").GetBoolean().ShouldBeTrue();
            var unmarked = await OkAsync(await PutAsync(u.ViewerClient, marked, false));
            unmarked.GetProperty("isSensitive").GetBoolean().ShouldBeFalse();

            var events = await EventsAsync(u, u.N1);
            events.Select(e => (e.OldValue, e.NewValue, e.FieldKey, e.ActorUserId)).ShouldBe([
                ("Not sensitive", "Sensitive", "IsSensitive", u.Viewer),
                ("Sensitive", "Not sensitive", "IsSensitive", u.Viewer),
            ]);
            events[0].Summary.ShouldBe("Matter marked sensitive.");
            events[1].Summary.ShouldBe("Matter no longer marked sensitive.");

            // Saving without changing the flag writes nothing; no generic FIELD_CHANGED row exists for the flag.
            await OkAsync(await PutAsync(u.ViewerClient, unmarked, false));
            (await EventsAsync(u, u.N1)).Count.ShouldBe(2);
            (await u.H.Factory.WithDbAsync(db => Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.CountAsync(
                db.Set<MatterFlow.Audit.Domain.AuditEvent>().Where(a => a.EventType == "FIELD_CHANGED" && a.FieldKey == "IsSensitive")))).ShouldBe(0);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task Un_marking_is_for_managers_and_view_sensitive_holders_because_nobody_else_can_see_the_matter()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            // S1: its managers (P1, P2) and the viewer may un-mark; the unrelated editor and the assignee get "not found" and nothing changes.
            var s1 = await GetAsync(u.H.Admin, $"/api/v1/matters/{u.S1}");
            foreach (var outsider in new[] { u.UnrelatedClient, u.AssigneeClient })
            {
                var denied = await PutAsync(outsider, s1, false);
                denied.StatusCode.ShouldBe(HttpStatusCode.NotFound);
            }

            (await GetAsync(u.H.Admin, $"/api/v1/matters/{u.S1}")).GetProperty("isSensitive").GetBoolean().ShouldBeTrue();
            var byManager = await OkAsync(await PutAsync(u.PmSecondaryClient, s1, false));
            byManager.GetProperty("isSensitive").GetBoolean().ShouldBeFalse();
            (await EventsAsync(u, u.S1)).Select(e => e.ActorUserId).ShouldBe([u.PmSecondary]);

            var s2 = await GetAsync(u.H.Admin, $"/api/v1/matters/{u.S2}");
            (await OkAsync(await PutAsync(u.ViewerClient, s2, false))).GetProperty("isSensitive").GetBoolean().ShouldBeFalse();
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task Marking_a_matter_that_ends_the_actors_own_access_asks_for_confirmation_first()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var n1 = await GetAsync(u.UnrelatedClient, $"/api/v1/matters/{u.N1}");

            var ask = await u.UnrelatedClient.PutAsJsonAsync($"/api/v1/matters/{u.N1}", new { name = "Merger", isSensitive = true, rowVersion = n1.GetProperty("rowVersion").GetString() });
            var problem = await ProblemAsync(ask, HttpStatusCode.Conflict, "SENSITIVE_CONFIRMATION_REQUIRED");
            problem.GetProperty("meta").GetProperty("willLoseAccess").GetBoolean().ShouldBeTrue();
            (await GetAsync(u.H.Admin, $"/api/v1/matters/{u.N1}")).GetProperty("isSensitive").GetBoolean().ShouldBeFalse();
            (await EventsAsync(u, u.N1)).ShouldBeEmpty();

            // Confirmed: it is marked, the actor gets the answer once and then no longer sees the matter. Everybody else outside the rule loses it too.
            var done = await OkAsync(await PutAsync(u.UnrelatedClient, n1, true, confirm: true));
            done.GetProperty("isSensitive").GetBoolean().ShouldBeTrue();
            (await u.UnrelatedClient.GetAsync($"/api/v1/matters/{u.N1}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await u.AssigneeClient.GetAsync($"/api/v1/matters/{u.N1}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await u.ViewerClient.GetAsync($"/api/v1/matters/{u.N1}")).StatusCode.ShouldBe(HttpStatusCode.OK);
            (await EventsAsync(u, u.N1)).Count.ShouldBe(1);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task No_confirmation_when_the_actor_keeps_access()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            // Naming themselves Primary in the same request, or holding Matter.ViewSensitive, keeps the actor in.
            var n1 = await GetAsync(u.UnrelatedClient, $"/api/v1/matters/{u.N1}");
            (await OkAsync(await PutAsync(u.UnrelatedClient, n1, true, primary: u.Unrelated))).GetProperty("isSensitive").GetBoolean().ShouldBeTrue();
            (await u.UnrelatedClient.GetAsync($"/api/v1/matters/{u.N1}")).StatusCode.ShouldBe(HttpStatusCode.OK);

            var s2 = await GetAsync(u.ViewerClient, $"/api/v1/matters/{u.S2}");
            await OkAsync(await PutAsync(u.ViewerClient, s2, false));
            await OkAsync(await PutAsync(u.ViewerClient, await GetAsync(u.ViewerClient, $"/api/v1/matters/{u.S2}"), true));
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task A_sensitive_matter_needs_a_manager_unless_the_creator_can_see_all_and_the_answer_is_returned_once()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var clientId = (await GetAsync(u.H.Admin, $"/api/v1/matters/{u.N1}")).GetProperty("clientId").GetInt32();

            var rejected = await u.UnrelatedClient.PostAsJsonAsync("/api/v1/matters", new { clientId, matterNumber = "00031", name = "Orphan", isSensitive = true });
            var problem = await ProblemAsync(rejected, HttpStatusCode.BadRequest, "VALIDATION_FAILED");
            problem.GetProperty("errors").GetProperty("isSensitive")[0].GetProperty("code").GetString().ShouldBe("SENSITIVE_NEEDS_MANAGER");

            // With a manager named, the creator (who cannot see it afterwards) still gets the created matter once.
            var created = await OkAsync(await u.UnrelatedClient.PostAsJsonAsync("/api/v1/matters", new { clientId, matterNumber = "00032", name = "Delegated", isSensitive = true, primaryManagerId = u.PmPrimary }), HttpStatusCode.Created);
            var id = created.GetProperty("matterId").GetInt32();
            created.GetProperty("isSensitive").GetBoolean().ShouldBeTrue();
            (await u.UnrelatedClient.GetAsync($"/api/v1/matters/{id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await u.PmPrimaryClient.GetAsync($"/api/v1/matters/{id}")).StatusCode.ShouldBe(HttpStatusCode.OK);
            (await EventsAsync(u, id)).Select(e => (e.OldValue, e.NewValue, e.ActorUserId)).ShouldBe([(null, "Sensitive", u.Unrelated)]);

            // A holder of Matter.ViewSensitive needs no manager.
            var byViewer = await OkAsync(await u.ViewerClient.PostAsJsonAsync("/api/v1/matters", new { clientId, matterNumber = "00033", name = "Open", isSensitive = true }), HttpStatusCode.Created);
            (await u.ViewerClient.GetAsync($"/api/v1/matters/{byViewer.GetProperty("matterId").GetInt32()}")).StatusCode.ShouldBe(HttpStatusCode.OK);

            // A normal matter needs no manager.
            (await u.UnrelatedClient.PostAsJsonAsync("/api/v1/matters", new { clientId, matterNumber = "00034", name = "Plain" })).StatusCode.ShouldBe(HttpStatusCode.Created);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task With_the_switch_off_the_guard_rails_stay_out_of_the_way_and_only_the_event_is_added()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: false);
        try
        {
            var clientId = (await GetAsync(u.H.Admin, $"/api/v1/matters/{u.N1}")).GetProperty("clientId").GetInt32();
            var n1 = await GetAsync(u.UnrelatedClient, $"/api/v1/matters/{u.N1}");

            var marked = await OkAsync(await PutAsync(u.UnrelatedClient, n1, true)); // no confirmation: nobody loses anything
            (await u.UnrelatedClient.GetAsync($"/api/v1/matters/{u.N1}")).StatusCode.ShouldBe(HttpStatusCode.OK);
            await OkAsync(await PutAsync(u.UnrelatedClient, marked, false)); // anyone with Matter.Edit may un-mark, as before
            await OkAsync(await u.UnrelatedClient.PostAsJsonAsync("/api/v1/matters", new { clientId, matterNumber = "00041", name = "Warning only", isSensitive = true }), HttpStatusCode.Created);

            (await EventsAsync(u, u.N1)).Count.ShouldBe(2);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }
}
