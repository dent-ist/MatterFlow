using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using LptHub.IntegrationTests.Fixtures;
using Shouldly;
using static LptHub.IntegrationTests.Tasks.TaskHarness;

namespace LptHub.IntegrationTests.Security;

/// <summary>
/// Lost-write audit (issue #1304), Matters, Projects, Clients, matter team and matter events: with the sensitive-matter rule on, a caller who is NOT "see all" makes a SUCCESSFUL write and
/// reads the value back. The visibility rule is a subquery over the access rows, which are read without tracking; EF applies that to the whole statement, so an entity loaded through the
/// filter is untracked and <c>SaveChanges</c> silently saves nothing (a 200 that changed nothing). Hidden-target tests cannot see that, only a read-back after a good write can.
/// Personas: "unrelated" (broad permissions, sees the normal matter only) and the primary project manager of the sensitive matter S1 (sees it as its manager).
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class LostWriteOrganizationTests(SqlServerFixture sql)
{
    private static string Str(JsonElement e, string name) => e.GetProperty(name).GetString()!;

    /// <summary>The parts of an error answer that must not differ between a hidden and a missing target (everything but the trace id), the given id masked.</summary>
    private static async Task<string> ShapeAsync(HttpResponseMessage response, string id)
    {
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var p = doc.RootElement;
        return $"{(int)response.StatusCode}|{p.GetProperty("code").GetString()}|{p.GetProperty("title").GetString()}|{p.GetProperty("detail").GetString()!.Replace(id, "X")}";
    }

    [Fact]
    public async Task Matter_changes_by_a_caller_who_is_not_see_all_are_saved()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        await using var _ = u.H.Factory;
        var admin = u.H.Admin;

        // Two extra matters without tasks (a matter with open tasks cannot be archived): a normal one, and a sensitive one the persona manages.
        var free = await u.H.CreateMatterAsync("343", "30");
        var managed = await u.H.CreateMatterAsync("343", "31");
        await u.H.ExecuteAsync($"UPDATE dbo.Matter SET IsSensitive = 1, PrimaryManagerId = {u.PmPrimary} WHERE MatterId = {managed}");
        u.H.Factory.InvalidateAll();

        foreach (var (client, matterId, sensitive, activeMatter) in new[] { (u.UnrelatedClient, u.N1, false, free), (u.PmPrimaryClient, u.S1, true, managed) })
        {
            var url = $"/api/v1/matters/{matterId}";
            var matter = await OkAsync(await client.GetAsync(url));

            var renamed = await OkAsync(await client.PutAsJsonAsync(url, new { name = "Renamed by persona " + matterId, isSensitive = sensitive, rowVersion = Str(matter, "rowVersion") }));
            Str(renamed, "name").ShouldBe("Renamed by persona " + matterId);
            Str(await OkAsync(await admin.GetAsync(url)), "name").ShouldBe("Renamed by persona " + matterId);

            var wanted = matterId == u.N1 ? "00077" : "00078";
            var numbered = await OkAsync(await client.PutAsJsonAsync($"{url}/number", new { number = wanted, rowVersion = Str(renamed, "rowVersion") }));
            Str(await OkAsync(await admin.GetAsync(url)), "matterNumber").ShouldBe(wanted);

            var activeUrl = $"/api/v1/matters/{activeMatter}";
            var target = await OkAsync(await client.GetAsync(activeUrl));
            var archived = await OkAsync(await client.PostAsJsonAsync($"{activeUrl}/active", new { isActive = false, rowVersion = Str(target, "rowVersion") }));
            archived.GetProperty("isActive").GetBoolean().ShouldBeFalse();
            (await OkAsync(await admin.GetAsync(activeUrl))).GetProperty("isActive").GetBoolean().ShouldBeFalse();
            var reopened = await OkAsync(await client.PostAsJsonAsync($"{activeUrl}/active", new { isActive = true, rowVersion = Str(await OkAsync(await admin.GetAsync(activeUrl)), "rowVersion") }));
            reopened.GetProperty("isActive").GetBoolean().ShouldBeTrue();
            (await OkAsync(await admin.GetAsync(activeUrl))).GetProperty("isActive").GetBoolean().ShouldBeTrue();

            // Last, because handing the primary manager away can end the persona's own access to a sensitive matter.
            var current = await OkAsync(await client.GetAsync(url));
            await OkAsync(await client.PutAsJsonAsync($"{url}/managers", new { primaryManagerId = (int?)u.PmSecondary, secondaryManagerId = (int?)null, rowVersion = Str(current, "rowVersion") }));
            (await OkAsync(await admin.GetAsync(url))).GetProperty("primaryManager").GetProperty("userId").GetInt32().ShouldBe(u.PmSecondary);
        }
    }

    [Fact]
    public async Task Project_changes_by_a_caller_who_is_not_see_all_are_saved()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        await using var _ = u.H.Factory;
        var admin = u.H.Admin;
        var archiver = await u.H.Factory.CreateRoleAsync("Project archiver", "Project.Archive");
        await u.H.Factory.GrantRoleAsync(@"KE\unrelated", archiver);
        await u.H.Factory.GrantRoleAsync(@"KE\pmprimary", archiver);

        foreach (var (client, projectId) in new[] { (u.UnrelatedClient, u.PN1), (u.PmPrimaryClient, u.PS1) })
        {
            var url = $"/api/v1/projects/{projectId}";
            var project = await OkAsync(await client.GetAsync(url));

            var renamed = await OkAsync(await client.PutAsJsonAsync(url, new { name = "Renamed project " + projectId, description = "Changed by persona", rowVersion = Str(project, "rowVersion") }));
            Str(renamed, "name").ShouldBe("Renamed project " + projectId);
            var stored = await OkAsync(await admin.GetAsync(url));
            Str(stored, "name").ShouldBe("Renamed project " + projectId);
            Str(stored, "description").ShouldBe("Changed by persona");

            var archived = await OkAsync(await client.PostAsJsonAsync($"{url}/active", new { isActive = false, rowVersion = Str(stored, "rowVersion") }));
            archived.GetProperty("isActive").GetBoolean().ShouldBeFalse();
            (await OkAsync(await admin.GetAsync(url))).GetProperty("isActive").GetBoolean().ShouldBeFalse();
        }

        // A project of a hidden matter still answers exactly like a missing one and is untouched.
        var hidden = await OkAsync(await admin.GetAsync($"/api/v1/projects/{u.PS2}"));
        var denied = await u.UnrelatedClient.PutAsJsonAsync($"/api/v1/projects/{u.PS2}", new { name = "Sneaky", rowVersion = Str(hidden, "rowVersion") });
        var missing = await u.UnrelatedClient.PutAsJsonAsync("/api/v1/projects/999999", new { name = "Sneaky", rowVersion = Str(hidden, "rowVersion") });
        denied.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        missing.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await ShapeAsync(denied, u.PS2.ToString())).ShouldBe(await ShapeAsync(missing, "999999"));
        Str(await OkAsync(await admin.GetAsync($"/api/v1/projects/{u.PS2}")), "name").ShouldBe(SensitiveUniverse.Sentinel(u.S2) + " project");
    }

    [Fact]
    public async Task Client_matter_team_and_event_changes_by_a_caller_who_is_not_see_all_are_saved()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        await using var _ = u.H.Factory;
        var admin = u.H.Admin;

        // Client (not matter scoped, but the persona is non-see-all with the rule on).
        var editor = await u.H.UserWithAsync(@"KE\clientedit", "Client.View", "Client.Edit", "Matter.View");
        var clientId = (await OkAsync(await admin.GetAsync($"/api/v1/matters/{u.N1}"))).GetProperty("clientId").GetInt32();
        var client = await OkAsync(await editor.GetAsync($"/api/v1/clients/{clientId}"));
        var renamedClient = await OkAsync(await editor.PutAsJsonAsync($"/api/v1/clients/{clientId}", new { name = "Acme renamed by persona", isActive = true, rowVersion = Str(client, "rowVersion") }));
        Str(renamedClient, "name").ShouldBe("Acme renamed by persona");
        Str(await OkAsync(await admin.GetAsync($"/api/v1/clients/{clientId}")), "name").ShouldBe("Acme renamed by persona");

        // Matter team (unrelated on N1, primary manager on S1).
        var titles = await OkAsync(await admin.GetAsync("/api/v1/team-titles"));
        var attorney = titles.EnumerateArray().First(t => Str(t, "name") == "Attorney").GetProperty("id").GetInt32();
        var paralegal = titles.EnumerateArray().First(t => Str(t, "name") == "Paralegal").GetProperty("id").GetInt32();
        foreach (var (persona, matterId) in new[] { (u.UnrelatedClient, u.N1), (u.PmPrimaryClient, u.S1) })
        {
            var url = $"/api/v1/matters/{matterId}/team";
            var member = await OkAsync(await persona.PostAsJsonAsync(url, new { name = "Ann Lee", email = $"ann{matterId}@firm.com", teamTitleId = attorney }), HttpStatusCode.Created);
            var memberId = member.GetProperty("id").GetInt32();
            var edited = await OkAsync(await persona.PutAsJsonAsync($"{url}/{memberId}", new { name = "Ann Q. Lee", email = $"ann{matterId}@firm.com", teamTitleId = paralegal, rowVersion = Str(member, "rowVersion") }));
            Str(edited, "name").ShouldBe("Ann Q. Lee");
            var listed = (await OkAsync(await admin.GetAsync(url))).GetProperty("items");
            var stored = listed.EnumerateArray().Single(m => m.GetProperty("id").GetInt32() == memberId);
            Str(stored, "name").ShouldBe("Ann Q. Lee");
            stored.GetProperty("title").GetProperty("id").GetInt32().ShouldBe(paralegal);

            (await persona.DeleteAsync($"{url}/{memberId}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
            (await OkAsync(await admin.GetAsync(url))).GetProperty("items").EnumerateArray().ShouldNotContain(m => m.GetProperty("id").GetInt32() == memberId);
        }

        // Matter events.
        foreach (var (persona, matterId) in new[] { (u.UnrelatedClient, u.N1), (u.PmPrimaryClient, u.S1) })
        {
            var created = await OkAsync(await persona.PostAsJsonAsync($"/api/v1/matters/{matterId}/events", new { typeCode = "DEPOSITION", title = "Deposition " + matterId, date = "2031-02-03", time = "09:30", note = "first" }), HttpStatusCode.Created);
            var eventId = created.GetProperty("eventId").GetInt32();
            var changed = await OkAsync(await persona.PutAsJsonAsync($"/api/v1/matter-events/{eventId}", new { typeCode = "TRIAL", title = "Trial " + matterId, date = "2031-02-04", time = "10:15", note = "second", rowVersion = Str(created, "rowVersion") }));
            Str(changed, "title").ShouldBe("Trial " + matterId);
            var stored = (await OkAsync(await admin.GetAsync($"/api/v1/matters/{matterId}/events?from=2031-02-01&to=2031-02-28"))).GetProperty("items");
            var row = stored.EnumerateArray().Single(e => e.GetProperty("eventId").GetInt32() == eventId);
            Str(row, "title").ShouldBe("Trial " + matterId);
            Str(row, "typeCode").ShouldBe("TRIAL");

            (await persona.DeleteAsync($"/api/v1/matter-events/{eventId}?rowVersion={Uri.EscapeDataString(Str(changed, "rowVersion"))}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
            (await OkAsync(await admin.GetAsync($"/api/v1/matters/{matterId}/events?from=2031-02-01&to=2031-02-28"))).GetProperty("items").EnumerateArray().ShouldNotContain(e => e.GetProperty("eventId").GetInt32() == eventId);
        }
    }
}
