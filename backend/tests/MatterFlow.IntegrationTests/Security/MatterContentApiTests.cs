using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Security;

/// <summary>
/// Productions, production specs and notes of a matter (epic #1001, MD-09, MD-10, MD-12) on the real API with the sensitive-matter rule on: create, concurrency, the spec rules,
/// the lock rules, the sanitiser, references, and a hidden matter answering 404 for every kind of call (the persona walk covers the GETs; this class walks the writes).
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class MatterContentApiTests(SqlServerFixture sql)
{
    private static async Task<string> CodeAsync(HttpResponseMessage response)
    {
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.TryGetProperty("code", out var code) ? code.GetString()! : string.Empty;
    }

    [Fact]
    public async Task Specs_and_productions_follow_the_retire_rule_and_the_row_version()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var admin = u.H.Admin;
            var spec = await OkAsync(await admin.PostAsJsonAsync("/api/v1/production-specs", new { matterId = u.N1, name = "ESI standard", metadataFields = new[] { "BegBates", "EndBates" } }), HttpStatusCode.Created);
            var specId = spec.GetProperty("productionSpecId").GetInt32();

            (await admin.PostAsJsonAsync("/api/v1/production-specs", new { matterId = u.N1, name = "ESI standard" })).StatusCode.ShouldBe(HttpStatusCode.Conflict);

            var copy = await OkAsync(await admin.PostAsJsonAsync($"/api/v1/production-specs/{specId}/duplicate", new { }), HttpStatusCode.Created);
            copy.GetProperty("name").GetString().ShouldBe("Copy of ESI standard");
            copy.GetProperty("metadataFields").GetArrayLength().ShouldBe(2);

            var production = await OkAsync(await admin.PostAsJsonAsync("/api/v1/productions", new { matterId = u.N1, name = "Volume 1", direction = "OUT", productionSpecId = specId, batesBegin = "ABC000001", batesEnd = "ABC000100" }), HttpStatusCode.Created);
            var productionId = production.GetProperty("productionId").GetInt32();
            var version = production.GetProperty("rowVersion").GetString();

            var changed = await OkAsync(await admin.PutAsJsonAsync($"/api/v1/productions/{productionId}", new { name = "Volume 1", direction = "OUT", productionSpecId = specId, batesBegin = "ABC000001", batesEnd = "ABC000250", rowVersion = version }));
            changed.GetProperty("batesEnd").GetString().ShouldBe("ABC000250");

            var stale = await admin.PutAsJsonAsync($"/api/v1/productions/{productionId}", new { name = "Volume 1", direction = "OUT", rowVersion = version });
            stale.StatusCode.ShouldBe(HttpStatusCode.Conflict);
            (await CodeAsync(stale)).ShouldBe("CONCURRENCY_CONFLICT");

            // Retire the spec: it stays on the production it is on, but cannot be chosen for a new one.
            var retired = await OkAsync(await admin.PostAsJsonAsync($"/api/v1/production-specs/{specId}/retire", new { rowVersion = spec.GetProperty("rowVersion").GetString() }));
            retired.GetProperty("status").GetString().ShouldBe("Retired");
            retired.GetProperty("usedByCount").GetInt32().ShouldBe(1);
            var rejected = await admin.PostAsJsonAsync("/api/v1/productions", new { matterId = u.N1, name = "Volume 2", direction = "OUT", productionSpecId = specId });
            rejected.StatusCode.ShouldBe(HttpStatusCode.Conflict);
            (await CodeAsync(rejected)).ShouldBe("SPEC_RETIRED");
            (await admin.PutAsJsonAsync($"/api/v1/production-specs/{specId}", new { name = "x", rowVersion = retired.GetProperty("rowVersion").GetString() })).StatusCode.ShouldBe(HttpStatusCode.Conflict);

            // A spec of another matter is refused.
            var other = await OkAsync(await admin.PostAsJsonAsync("/api/v1/production-specs", new { matterId = u.S1, name = "Other matter spec" }), HttpStatusCode.Created);
            (await admin.PostAsJsonAsync("/api/v1/productions", new { matterId = u.N1, name = "Volume 3", direction = "OUT", productionSpecId = other.GetProperty("productionSpecId").GetInt32() })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

            // Comments and the history (field change with old and new value).
            await OkAsync(await admin.PostAsJsonAsync($"/api/v1/productions/{productionId}/comments", new { body = "First" }), HttpStatusCode.Created);
            var history = await OkAsync(await admin.GetAsync($"/api/v1/productions/{productionId}/history"));
            var items = history.GetProperty("items").EnumerateArray().ToList();
            items.ShouldContain(i => i.GetProperty("fieldKey").GetString() == "BatesEnd" && i.GetProperty("oldValue").GetString() == "ABC000100" && i.GetProperty("newValue").GetString() == "ABC000250");
            items.ShouldContain(i => i.GetProperty("eventType").GetString() == "PRODUCTION_CREATED");
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task A_hidden_matter_answers_404_to_every_kind_of_call_and_a_visible_one_works_for_a_person_without_access_to_the_other()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var admin = u.H.Admin;
            var specId = (await OkAsync(await admin.PostAsJsonAsync("/api/v1/production-specs", new { matterId = u.S1, name = "Hidden spec" }), HttpStatusCode.Created)).GetProperty("productionSpecId").GetInt32();
            var productionId = (await OkAsync(await admin.PostAsJsonAsync("/api/v1/productions", new { matterId = u.S1, name = "Hidden production", direction = "IN" }), HttpStatusCode.Created)).GetProperty("productionId").GetInt32();
            var note = await OkAsync(await admin.PostAsJsonAsync("/api/v1/notes", new { matterId = u.S1, bodyHtml = "<p>Hidden note</p>" }), HttpStatusCode.Created);
            var noteId = note.GetProperty("noteId").GetInt32();
            var version = note.GetProperty("rowVersion").GetString();
            var unrelated = u.UnrelatedClient;

            string[] gets =
            [
                $"/api/v1/production-specs?matterId={u.S1}", $"/api/v1/production-specs/{specId}", $"/api/v1/production-specs/{specId}/history",
                $"/api/v1/productions?matterId={u.S1}", $"/api/v1/productions/{productionId}", $"/api/v1/productions/{productionId}/comments", $"/api/v1/productions/{productionId}/history",
                $"/api/v1/matters/{u.S1}/productions/summary", $"/api/v1/matters/{u.S1}/notes/summary", $"/api/v1/notes?matterId={u.S1}", $"/api/v1/notes/{noteId}", $"/api/v1/notes/{noteId}/history",
                $"/api/v1/note-templates?matterId={u.S1}",
            ];
            foreach (var url in gets)
                (await unrelated.GetAsync(url)).StatusCode.ShouldBe(HttpStatusCode.NotFound, url);

            (await unrelated.PutAsJsonAsync($"/api/v1/notes/{noteId}", new { bodyHtml = "<p>x</p>", rowVersion = version })).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await unrelated.PutAsJsonAsync($"/api/v1/notes/{noteId}/pinned", new { pinned = true, rowVersion = version })).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await unrelated.PostAsJsonAsync($"/api/v1/notes/{noteId}/lock", new { rowVersion = version })).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await unrelated.DeleteAsync($"/api/v1/notes/{noteId}?rowVersion={Uri.EscapeDataString(version!)}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await unrelated.PostAsJsonAsync($"/api/v1/production-specs/{specId}/duplicate", new { })).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await unrelated.PostAsJsonAsync($"/api/v1/productions/{productionId}/comments", new { body = "x" })).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await unrelated.PostAsJsonAsync("/api/v1/notes/resolve-references", new { matterId = u.S1, references = Array.Empty<object>() })).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await unrelated.PostAsJsonAsync("/api/v1/notes", new { matterId = u.S1, bodyHtml = "<p>x</p>" })).StatusCode.ShouldBe(HttpStatusCode.BadRequest); // like assets: "select a matter"
            (await unrelated.PostAsJsonAsync("/api/v1/productions", new { matterId = u.S1, name = "x", direction = "OUT" })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

            // The same person works on the matter they do see, and the hidden note is still untouched.
            (await unrelated.PostAsJsonAsync("/api/v1/notes", new { matterId = u.N1, bodyHtml = "<p>Visible</p>" })).StatusCode.ShouldBe(HttpStatusCode.Created);
            (await OkAsync(await admin.GetAsync($"/api/v1/notes/{noteId}"))).GetProperty("isPinned").GetBoolean().ShouldBeFalse();
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task Notes_are_sanitised_titled_checked_for_references_and_locked_for_everybody()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var admin = u.H.Admin;
            var other = u.PmPrimaryClient;
            var created = await OkAsync(
                await admin.PostAsJsonAsync("/api/v1/notes", new { matterId = u.N1, bodyHtml = "<h1>  Plan </h1><script>alert(1)</script><p onclick=\"x()\">Body</p><table><tr><td>1</td></tr></table>" }),
                HttpStatusCode.Created);
            var noteId = created.GetProperty("noteId").GetInt32();
            created.GetProperty("title").GetString().ShouldBe("Plan");
            var html = created.GetProperty("bodyHtml").GetString()!;
            html.ShouldNotContain("script");
            html.ShouldNotContain("onclick");
            html.ShouldContain("<table>");

            // A reference to a project of another matter is refused; one of the note's own matter is kept as a link.
            var foreign = await admin.PostAsJsonAsync("/api/v1/notes", new { matterId = u.N1, bodyHtml = $"<p>See <span data-project-id=\"{u.PS1}\">P</span></p>" });
            foreign.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
            var own = await OkAsync(await admin.PostAsJsonAsync("/api/v1/notes", new { matterId = u.N1, bodyHtml = $"<p>See <span data-project-id=\"{u.PN1}\">P</span></p>" }), HttpStatusCode.Created);
            own.GetProperty("references").EnumerateArray().ShouldContain(r => r.GetProperty("kind").GetString() == "project" && r.GetProperty("id").GetInt32() == u.PN1);

            // Stale row version is a 409.
            var version = created.GetProperty("rowVersion").GetString();
            var saved = await OkAsync(await admin.PutAsJsonAsync($"/api/v1/notes/{noteId}", new { bodyHtml = "<p>Plan v2</p>", rowVersion = version }));
            saved.GetProperty("title").GetString().ShouldBe("Plan v2");
            var stale = await admin.PutAsJsonAsync($"/api/v1/notes/{noteId}", new { bodyHtml = "<p>Plan v3</p>", rowVersion = version });
            stale.StatusCode.ShouldBe(HttpStatusCode.Conflict);
            (await CodeAsync(stale)).ShouldBe("CONCURRENCY_CONFLICT");

            // Lock: read only for everybody, pinning still works, only the locker or an administrator unlocks, a locked note cannot be deleted.
            var locked = await OkAsync(await other.PostAsJsonAsync($"/api/v1/notes/{noteId}/lock", new { rowVersion = saved.GetProperty("rowVersion").GetString() }));
            locked.GetProperty("isLocked").GetBoolean().ShouldBeTrue();
            var lockedVersion = locked.GetProperty("rowVersion").GetString();
            var edit = await admin.PutAsJsonAsync($"/api/v1/notes/{noteId}", new { bodyHtml = "<p>Nope</p>", rowVersion = lockedVersion });
            edit.StatusCode.ShouldBe(HttpStatusCode.Conflict);
            (await CodeAsync(edit)).ShouldBe("NOTE_LOCKED");
            var sameUserEdit = await other.PutAsJsonAsync($"/api/v1/notes/{noteId}", new { bodyHtml = "<p>Nope</p>", rowVersion = lockedVersion });
            (await CodeAsync(sameUserEdit)).ShouldBe("NOTE_LOCKED");
            var pinned = await OkAsync(await admin.PutAsJsonAsync($"/api/v1/notes/{noteId}/pinned", new { pinned = true, rowVersion = lockedVersion }));
            pinned.GetProperty("isPinned").GetBoolean().ShouldBeTrue();
            var delete = await admin.DeleteAsync($"/api/v1/notes/{noteId}?rowVersion={Uri.EscapeDataString(pinned.GetProperty("rowVersion").GetString()!)}");
            delete.StatusCode.ShouldBe(HttpStatusCode.Conflict);

            var third = u.UnrelatedClient;
            var denied = await third.PostAsJsonAsync($"/api/v1/notes/{noteId}/unlock", new { rowVersion = pinned.GetProperty("rowVersion").GetString() });
            denied.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await CodeAsync(denied)).ShouldBe("NOT_LOCK_OWNER");
            var unlocked = await OkAsync(await admin.PostAsJsonAsync($"/api/v1/notes/{noteId}/unlock", new { rowVersion = pinned.GetProperty("rowVersion").GetString() })); // an administrator may
            unlocked.GetProperty("isLocked").GetBoolean().ShouldBeFalse();

            var history = await OkAsync(await admin.GetAsync($"/api/v1/notes/{noteId}/history"));
            var types = history.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("eventType").GetString()).ToList();
            types.ShouldContain("NOTE_CREATED");
            types.ShouldContain("NOTE_EDITED");
            types.ShouldContain("NOTE_LOCKED");
            types.ShouldContain("NOTE_UNLOCKED");
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }
}
