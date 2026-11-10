using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using LptHub.IntegrationTests.Fixtures;
using Shouldly;
using static LptHub.IntegrationTests.Tasks.TaskHarness;

namespace LptHub.IntegrationTests.Security;

/// <summary>
/// Lost-write audit (issue #1304), matter content: Notes and note templates, Productions, production specs and comments, and Assets (update, active, disposition, bulk disposition, assign
/// number). With the sensitive-matter rule on, a caller who is NOT "see all" makes a SUCCESSFUL write and an administrator reads the value back. See
/// <see cref="LostWriteOrganizationTests"/> for why only a read-back after a good write can catch a write that EF silently dropped. Personas: "unrelated" (sees the normal matter N1) and the
/// primary project manager of the sensitive matter S1 (sees S1 as its manager).
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class LostWriteContentTests(SqlServerFixture sql)
{
    private static string Str(JsonElement e, string name) => e.GetProperty(name).GetString()!;

    [Fact]
    public async Task Note_and_note_template_changes_by_a_caller_who_is_not_see_all_are_saved()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        await using var _ = u.H.Factory;
        var admin = u.H.Admin;

        foreach (var (persona, matterId) in new[] { (u.UnrelatedClient, u.N1), (u.PmPrimaryClient, u.S1) })
        {
            var note = await OkAsync(await persona.PostAsJsonAsync("/api/v1/notes", new { matterId, bodyHtml = "<p>Plan one</p>" }), HttpStatusCode.Created);
            var noteId = note.GetProperty("noteId").GetInt32();
            Str(await OkAsync(await admin.GetAsync($"/api/v1/notes/{noteId}")), "title").ShouldBe("Plan one");

            var saved = await OkAsync(await persona.PutAsJsonAsync($"/api/v1/notes/{noteId}", new { bodyHtml = "<p>Plan two</p>", rowVersion = Str(note, "rowVersion") }));
            Str(await OkAsync(await admin.GetAsync($"/api/v1/notes/{noteId}")), "title").ShouldBe("Plan two");

            var pinned = await OkAsync(await persona.PutAsJsonAsync($"/api/v1/notes/{noteId}/pinned", new { pinned = true, rowVersion = Str(saved, "rowVersion") }));
            (await OkAsync(await admin.GetAsync($"/api/v1/notes/{noteId}"))).GetProperty("isPinned").GetBoolean().ShouldBeTrue();

            var locked = await OkAsync(await persona.PostAsJsonAsync($"/api/v1/notes/{noteId}/lock", new { rowVersion = Str(pinned, "rowVersion") }));
            (await OkAsync(await admin.GetAsync($"/api/v1/notes/{noteId}"))).GetProperty("isLocked").GetBoolean().ShouldBeTrue();

            var unlocked = await OkAsync(await persona.PostAsJsonAsync($"/api/v1/notes/{noteId}/unlock", new { rowVersion = Str(locked, "rowVersion") }));
            (await OkAsync(await admin.GetAsync($"/api/v1/notes/{noteId}"))).GetProperty("isLocked").GetBoolean().ShouldBeFalse();

            (await persona.DeleteAsync($"/api/v1/notes/{noteId}?rowVersion={Uri.EscapeDataString(Str(unlocked, "rowVersion"))}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
            (await admin.GetAsync($"/api/v1/notes/{noteId}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);

            // Matter Level templates: create, change, duplicate, use, delete.
            var template = await OkAsync(await persona.PostAsJsonAsync("/api/v1/note-templates", new { scope = "MATTER", matterId, name = "Kick-off " + matterId, bodyHtml = "<p>x</p>" }), HttpStatusCode.Created);
            var templateId = template.GetProperty("noteTemplateId").GetInt32();
            await OkAsync(await persona.PutAsJsonAsync($"/api/v1/note-templates/{templateId}", new { name = "Kick-off renamed " + matterId, bodyHtml = "<p>y</p>", rowVersion = Str(template, "rowVersion") }));
            var stored = await OkAsync(await admin.GetAsync($"/api/v1/note-templates/{templateId}"));
            Str(stored, "name").ShouldBe("Kick-off renamed " + matterId);
            Str(stored, "bodyHtml").ShouldBe("<p>y</p>");

            await OkAsync(await persona.PostAsync($"/api/v1/note-templates/{templateId}/use", null));
            (await OkAsync(await admin.GetAsync($"/api/v1/note-templates/{templateId}"))).GetProperty("usedCount").GetInt32().ShouldBe(1);

            var copy = await OkAsync(await persona.PostAsJsonAsync($"/api/v1/note-templates/{templateId}/duplicate", new { }), HttpStatusCode.Created);
            (await admin.GetAsync($"/api/v1/note-templates/{copy.GetProperty("noteTemplateId").GetInt32()}")).StatusCode.ShouldBe(HttpStatusCode.OK);

            var current = await OkAsync(await admin.GetAsync($"/api/v1/note-templates/{templateId}")); // "use" moved the row version
            (await persona.DeleteAsync($"/api/v1/note-templates/{templateId}?rowVersion={Uri.EscapeDataString(Str(current, "rowVersion"))}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
            (await admin.GetAsync($"/api/v1/note-templates/{templateId}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        }
    }

    [Fact]
    public async Task Production_spec_and_comment_changes_by_a_caller_who_is_not_see_all_are_saved()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        await using var _ = u.H.Factory;
        var admin = u.H.Admin;

        foreach (var (persona, matterId) in new[] { (u.UnrelatedClient, u.N1), (u.PmPrimaryClient, u.S1) })
        {
            // Specs: create, change, retire, unretire.
            var spec = await OkAsync(await persona.PostAsJsonAsync("/api/v1/production-specs", new { matterId, name = "ESI " + matterId }), HttpStatusCode.Created);
            var specId = spec.GetProperty("productionSpecId").GetInt32();
            var changedSpec = await OkAsync(await persona.PutAsJsonAsync($"/api/v1/production-specs/{specId}", new { name = "ESI renamed " + matterId, imageFormat = "TIFF", rowVersion = Str(spec, "rowVersion") }));
            Str(await OkAsync(await admin.GetAsync($"/api/v1/production-specs/{specId}")), "name").ShouldBe("ESI renamed " + matterId);

            var retired = await OkAsync(await persona.PostAsJsonAsync($"/api/v1/production-specs/{specId}/retire", new { rowVersion = Str(changedSpec, "rowVersion") }));
            Str(await OkAsync(await admin.GetAsync($"/api/v1/production-specs/{specId}")), "status").ShouldBe("Retired");
            await OkAsync(await persona.PostAsJsonAsync($"/api/v1/production-specs/{specId}/unretire", new { rowVersion = Str(retired, "rowVersion") }));
            Str(await OkAsync(await admin.GetAsync($"/api/v1/production-specs/{specId}")), "status").ShouldNotBe("Retired");

            // Productions: create, change, comment (add, edit, delete), delete.
            var production = await OkAsync(await persona.PostAsJsonAsync("/api/v1/productions", new { matterId, name = "Volume 1", direction = "OUT", productionSpecId = specId }), HttpStatusCode.Created);
            var productionId = production.GetProperty("productionId").GetInt32();
            var changed = await OkAsync(await persona.PutAsJsonAsync($"/api/v1/productions/{productionId}", new { name = "Volume 1", direction = "OUT", productionSpecId = specId, batesBegin = "ABC000001", batesEnd = "ABC000250", rowVersion = Str(production, "rowVersion") }));
            Str(await OkAsync(await admin.GetAsync($"/api/v1/productions/{productionId}")), "batesEnd").ShouldBe("ABC000250");

            var comment = await OkAsync(await persona.PostAsJsonAsync($"/api/v1/productions/{productionId}/comments", new { body = "First" }), HttpStatusCode.Created);
            var commentId = comment.GetProperty("productionCommentId").GetInt32();
            var edited = await OkAsync(await persona.PutAsJsonAsync($"/api/v1/production-comments/{commentId}", new { body = "Second", rowVersion = Str(comment, "rowVersion") }));
            (await OkAsync(await admin.GetAsync($"/api/v1/productions/{productionId}/comments"))).EnumerateArray().Single(c => c.GetProperty("productionCommentId").GetInt32() == commentId).GetProperty("body").GetString().ShouldBe("Second");
            (await persona.DeleteAsync($"/api/v1/production-comments/{commentId}?rowVersion={Uri.EscapeDataString(Str(edited, "rowVersion"))}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
            (await OkAsync(await admin.GetAsync($"/api/v1/productions/{productionId}/comments"))).EnumerateArray().ShouldBeEmpty();

            (await persona.DeleteAsync($"/api/v1/productions/{productionId}?rowVersion={Uri.EscapeDataString(Str(changed, "rowVersion"))}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
            (await admin.GetAsync($"/api/v1/productions/{productionId}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        }
    }

    [Fact]
    public async Task Asset_changes_by_a_caller_who_is_not_see_all_are_saved()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        await using var _ = u.H.Factory;
        var admin = u.H.Admin;
        var type = (await OkAsync(await admin.PostAsJsonAsync("/api/v1/asset-types", new { name = "Media" }), HttpStatusCode.Created)).GetProperty("assetTypeId").GetInt32();
        var disposer = await u.H.Factory.CreateRoleAsync("Disposer", "Asset.Dispose");
        await u.H.Factory.GrantRoleAsync(@"KE\unrelated", disposer);
        await u.H.Factory.GrantRoleAsync(@"KE\pmprimary", disposer);

        foreach (var (persona, matterId) in new[] { (u.UnrelatedClient, u.N1), (u.PmPrimaryClient, u.S1) })
        {
            async Task<JsonElement> NewAsset(string name) => await OkAsync(await admin.PostAsJsonAsync("/api/v1/assets", new { matterId, assetTypeId = type, displayName = name }), HttpStatusCode.Created);
            async Task<JsonElement> StoredAsync(int id) => await OkAsync(await admin.GetAsync($"/api/v1/assets/{id}"));

            var asset = await NewAsset("Disc A " + matterId);
            var id = asset.GetProperty("assetId").GetInt32();

            var renamed = await OkAsync(await persona.PutAsJsonAsync($"/api/v1/assets/{id}", new { displayName = "Disc A renamed " + matterId, rowVersion = Str(asset, "rowVersion") }));
            Str(await StoredAsync(id), "displayName").ShouldBe("Disc A renamed " + matterId);

            var inactive = await OkAsync(await persona.PostAsJsonAsync($"/api/v1/assets/{id}/active", new { isActive = false, rowVersion = Str(renamed, "rowVersion") }));
            (await StoredAsync(id)).GetProperty("isActive").GetBoolean().ShouldBeFalse();
            var active = await OkAsync(await persona.PostAsJsonAsync($"/api/v1/assets/{id}/active", new { isActive = true, rowVersion = Str(inactive, "rowVersion") }));
            (await StoredAsync(id)).GetProperty("isActive").GetBoolean().ShouldBeTrue();

            await OkAsync(await persona.PutAsJsonAsync($"/api/v1/assets/{id}/disposition", new { dispositionCode = "PENDING_DISPOSITION", note = "Matter closed", rowVersion = Str(active, "rowVersion") }));
            Str(await StoredAsync(id), "dispositionCode").ShouldBe("PENDING_DISPOSITION");

            var other = await NewAsset("Disc B " + matterId);
            var otherId = other.GetProperty("assetId").GetInt32();
            var bulk = await OkAsync(await persona.PostAsJsonAsync("/api/v1/assets/disposition", new { assetIds = new[] { otherId }, dispositionCode = "PENDING_DISPOSITION", note = "Bulk" }));
            bulk.ToString().ShouldContain("true");
            Str(await StoredAsync(otherId), "dispositionCode").ShouldBe("PENDING_DISPOSITION");
        }

        // The numbering counters' next-number control is walked by AssetNumberingSensitiveTests, the assign-number action by AssetAssignNumberSensitiveTests (both read the value back).
    }
}
