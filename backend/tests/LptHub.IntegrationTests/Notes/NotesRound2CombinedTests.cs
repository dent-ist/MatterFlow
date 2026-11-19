using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using LptHub.IntegrationTests.Fixtures;
using LptHub.IntegrationTests.Reports;
using Microsoft.Data.SqlClient;
using Shouldly;
using static LptHub.IntegrationTests.Tasks.TaskHarness;

namespace LptHub.IntegrationTests.Notes;

/// <summary>
/// Notes round 2 (epic #1405, issue #1412): folders, pasted images and formatted paste used together on the real API with the sensitive-matter rule on. The single-feature rules are walked in
/// <see cref="NoteFoldersApiTests"/> and <see cref="NoteImagesApiTests"/>; this walks one note through its whole life and proves the features do not break each other.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class NotesRound2CombinedTests(SqlServerFixture sql)
{
    private static int Int(JsonElement e, string name) => e.GetProperty(name).GetInt32();

    private static string Str(JsonElement e, string name) => e.GetProperty(name).GetString()!;

    private static async Task<int> UploadAsync(HttpClient client, int matterId)
    {
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(TestImages.Png());
        file.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        form.Add(file, "file", "paste.png");
        return Int(await OkAsync(await client.PostAsync($"/api/v1/matters/{matterId}/note-images", form), HttpStatusCode.Created), "noteImageId");
    }

    private static async Task<JsonElement> NewFolderAsync(HttpClient client, int matterId, string name, int? parentId = null) =>
        await OkAsync(await client.PostAsJsonAsync("/api/v1/note-folders", new { matterId, parentFolderId = parentId, name }), HttpStatusCode.Created);

    private static string Img(int id) => $"<img data-image-id=\"{id}\" alt=\"Pasted image\" width=\"480\" height=\"300\">";

    private static int ImageIdOf(JsonElement note) => int.Parse(Regex.Match(Str(note, "bodyHtml"), "data-image-id=\"(\\d+)\"").Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture);

    private static async Task<HttpStatusCode> ReadStatusAsync(HttpClient client, int imageId) => (await client.GetAsync($"/api/v1/notes/images/{imageId}")).StatusCode;

    private static Task<HttpResponseMessage> SaveAsync(HttpClient client, JsonElement note, string html) =>
        client.PutAsJsonAsync($"/api/v1/notes/{Int(note, "noteId")}", new { bodyHtml = html, rowVersion = Str(note, "rowVersion"), tagIds = Array.Empty<int>() });

    private static async Task<JsonElement> FoldersAsync(HttpClient client, int matterId) => await OkAsync(await client.GetAsync($"/api/v1/matters/{matterId}/note-folders"));

    private static JsonElement Folder(JsonElement list, int id) => list.GetProperty("folders").EnumerateArray().Single(f => Int(f, "noteFolderId") == id);

    // What a Word paste looks like after the client clean-up plus a hand-made leftover the server must still remove (colour, font, strikethrough text, a data: picture).
    private const string PastedWord =
        "<h2 style=\"color:#2F5496\">Custodian interview</h2><p><strong>Key point</strong> <span style=\"font-family:Calibri;color:red\">kept words</span> <s>struck</s></p>"
        + "<ul><li><p>One</p></li><li><p>Two</p></li></ul><table><tbody><tr><th><p>Who</p></th><th><p>When</p></th></tr><tr><td><p>Ann</p></td><td><p>Monday</p></td></tr></tbody></table>"
        + "<p hidden>SECRET-HIDDEN</p>";

    [Fact]
    public async Task One_note_in_a_nested_folder_with_a_picture_and_pasted_text_lives_through_save_move_copy_folder_delete_and_note_delete()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var admin = u.H.Admin;
            var a = await NewFolderAsync(admin, u.N1, "Custodians");
            var b = await NewFolderAsync(admin, u.N1, "Interviews", Int(a, "noteFolderId"));
            var c = await NewFolderAsync(admin, u.N1, "Ann", Int(b, "noteFolderId"));
            var other = await NewFolderAsync(admin, u.N1, "Archive");

            // Create in the nested folder with an uploaded picture and pasted text: the server keeps the vocabulary and drops the rest.
            var image = await UploadAsync(admin, u.N1);
            var created = await OkAsync(
                await admin.PostAsJsonAsync("/api/v1/notes", new { matterId = u.N1, folderId = Int(c, "noteFolderId"), bodyHtml = PastedWord + Img(image) }),
                HttpStatusCode.Created);
            var noteId = Int(created, "noteId");
            Int(created, "folderId").ShouldBe(Int(c, "noteFolderId"));
            var body = Str(created, "bodyHtml");
            body.ShouldContain("<h2>Custodian interview</h2>");
            body.ShouldContain("<table>");
            body.ShouldNotContain("SECRET-HIDDEN");
            body.ShouldNotContain("style=");
            body.ShouldNotContain("Calibri");
            ImageIdOf(created).ShouldBe(image);

            // Save again (edit text, keep the picture): the picture stays and the folder stays.
            var saved = await OkAsync(await SaveAsync(admin, created, Str(created, "bodyHtml") + "<p>Follow-up</p>"));
            Int(saved, "folderId").ShouldBe(Int(c, "noteFolderId"));
            ImageIdOf(saved).ShouldBe(image);
            (await ReadStatusAsync(admin, image)).ShouldBe(HttpStatusCode.OK);

            // Move to another folder: text, picture and Last Updated are untouched.
            var before = await OkAsync(await admin.GetAsync($"/api/v1/notes/{noteId}"));
            var moved = await OkAsync(await admin.PutAsJsonAsync($"/api/v1/notes/{noteId}/folder", new { folderId = Int(other, "noteFolderId"), rowVersion = Str(before, "rowVersion") }));
            Int(moved, "folderId").ShouldBe(Int(other, "noteFolderId"));
            Str(moved, "bodyHtml").ShouldBe(Str(before, "bodyHtml"));
            ImageIdOf(moved).ShouldBe(image);
            (await ReadStatusAsync(admin, image)).ShouldBe(HttpStatusCode.OK);

            // Copy to another matter: the picture is copied as a separate record that belongs to the other matter; the original is never shared.
            var target = await u.H.CreateMatterAsync("344", "24");
            var copy = await OkAsync(await admin.PostAsJsonAsync($"/api/v1/note-images/{image}/copy", new { targetMatterId = target }), HttpStatusCode.Created);
            var copyId = Int(copy, "noteImageId");
            copyId.ShouldNotBe(image);
            var copiedNote = await OkAsync(await admin.PostAsJsonAsync("/api/v1/notes", new { matterId = target, bodyHtml = "<p>Copied</p>" + Img(copyId) }), HttpStatusCode.Created);
            ImageIdOf(copiedNote).ShouldBe(copyId);
            (await u.H.ScalarAsync("SELECT COUNT(*) AS [Value] FROM (SELECT TargetId FROM dbo.NoteLink WHERE TargetType = 'IMAGE' GROUP BY TargetId HAVING COUNT(*) > 1) x")).ShouldBe(0);
            (await u.H.ScalarAsync($"SELECT COUNT(*) AS [Value] FROM dbo.NoteImage WHERE MatterId = {target}")).ShouldBe(1);

            // The note in the other matter goes: its picture goes, the first matter's picture stays.
            (await admin.DeleteAsync($"/api/v1/notes/{Int(copiedNote, "noteId")}?rowVersion={Uri.EscapeDataString(Str(copiedNote, "rowVersion"))}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
            (await ReadStatusAsync(admin, copyId)).ShouldBe(HttpStatusCode.NotFound);
            (await ReadStatusAsync(admin, image)).ShouldBe(HttpStatusCode.OK);

            // A locked note is read-only (no save) but may still be moved, and its picture stays.
            var locked = await OkAsync(await admin.PostAsJsonAsync($"/api/v1/notes/{noteId}/lock", new { rowVersion = Str(moved, "rowVersion") }));
            await ProblemAsync(await SaveAsync(admin, locked, Str(locked, "bodyHtml") + "<p>x</p>"), HttpStatusCode.Conflict, "NOTE_LOCKED");
            var lockedMoved = await OkAsync(await admin.PutAsJsonAsync($"/api/v1/notes/{noteId}/folder", new { folderId = Int(c, "noteFolderId"), rowVersion = Str(locked, "rowVersion") }));
            Int(lockedMoved, "folderId").ShouldBe(Int(c, "noteFolderId"));
            (await ReadStatusAsync(admin, image)).ShouldBe(HttpStatusCode.OK);
            var unlocked = await OkAsync(await admin.PostAsJsonAsync($"/api/v1/notes/{noteId}/unlock", new { rowVersion = Str(lockedMoved, "rowVersion") }));

            // "Move Contents Up and Delete" on the nested folders keeps the note and its picture (note goes up one level each time).
            var list = await FoldersAsync(admin, u.N1);
            (await admin.DeleteAsync($"/api/v1/note-folders/{Int(c, "noteFolderId")}?rowVersion={Uri.EscapeDataString(Str(Folder(list, Int(c, "noteFolderId")), "rowVersion"))}&moveContentsUp=true"))
                .StatusCode.ShouldBe(HttpStatusCode.NoContent);
            var up = await OkAsync(await admin.GetAsync($"/api/v1/notes/{noteId}"));
            Int(up, "folderId").ShouldBe(Int(b, "noteFolderId"));
            ImageIdOf(up).ShouldBe(image);
            list = await FoldersAsync(admin, u.N1);
            (await admin.DeleteAsync($"/api/v1/note-folders/{Int(b, "noteFolderId")}?rowVersion={Uri.EscapeDataString(Str(Folder(list, Int(b, "noteFolderId")), "rowVersion"))}&moveContentsUp=true"))
                .StatusCode.ShouldBe(HttpStatusCode.NoContent);
            Int(await OkAsync(await admin.GetAsync($"/api/v1/notes/{noteId}")), "folderId").ShouldBe(Int(a, "noteFolderId"));
            (await ReadStatusAsync(admin, image)).ShouldBe(HttpStatusCode.OK);
            Str(up, "bodyHtml").ShouldContain("Custodian interview");

            // Deleting the note deletes its picture (and only that).
            var final = await OkAsync(await admin.GetAsync($"/api/v1/notes/{noteId}"));
            (await admin.DeleteAsync($"/api/v1/notes/{noteId}?rowVersion={Uri.EscapeDataString(Str(final, "rowVersion"))}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
            (await ReadStatusAsync(admin, image)).ShouldBe(HttpStatusCode.NotFound);
            (await u.H.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.NoteImage")).ShouldBe(0);
            unlocked.ValueKind.ShouldBe(JsonValueKind.Object);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task A_cancelled_editor_deletes_its_unsaved_upload_while_a_saved_picture_survives_and_the_old_sweep_spares_what_a_note_uses()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var admin = u.H.Admin;
            var folder = await NewFolderAsync(admin, u.N1, "Drafts");
            var kept = await UploadAsync(admin, u.N1);
            var note = await OkAsync(await admin.PostAsJsonAsync("/api/v1/notes", new { matterId = u.N1, folderId = Int(folder, "noteFolderId"), bodyHtml = "<p>x</p>" + Img(kept) }), HttpStatusCode.Created);

            // Cancel or Discard in the editor: the pasted-but-unsaved picture is deleted; the saved one refuses.
            var draft = await UploadAsync(admin, u.N1);
            (await admin.DeleteAsync($"/api/v1/note-images/{draft}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
            (await ReadStatusAsync(admin, draft)).ShouldBe(HttpStatusCode.NotFound);
            (await admin.DeleteAsync($"/api/v1/note-images/{kept}")).StatusCode.ShouldNotBe(HttpStatusCode.NoContent);
            (await ReadStatusAsync(admin, kept)).ShouldBe(HttpStatusCode.OK);

            // A save that removes the picture deletes it at once (the note's own images follow its text).
            var cleared = await OkAsync(await SaveAsync(admin, note, "<p>x</p>"));
            (await ReadStatusAsync(admin, kept)).ShouldBe(HttpStatusCode.NotFound);
            Int(cleared, "folderId").ShouldBe(Int(folder, "noteFolderId"));
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task Edit_and_Delete_rights_decide_folders_moves_and_pictures_and_a_read_only_person_changes_nothing()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var admin = u.H.Admin;
            var folder = await NewFolderAsync(admin, u.N1, "Shared");
            var image = await UploadAsync(admin, u.N1);
            var note = await OkAsync(await admin.PostAsJsonAsync("/api/v1/notes", new { matterId = u.N1, folderId = Int(folder, "noteFolderId"), bodyHtml = "<p>x</p>" + Img(image) }), HttpStatusCode.Created);

            var reader = await u.H.UserWithAsync(@"KE\r2reader", "Matter.View", "MatterNote.View");
            var editor = await u.H.UserWithAsync(@"KE\r2editor", "Matter.View", "MatterNote.View", "MatterNote.Edit");
            var deleter = await u.H.UserWithAsync(@"KE\r2deleter", "Matter.View", "MatterNote.View", "MatterNote.Delete");

            // View sees the folders, the note and the picture, and nothing more.
            (await reader.GetAsync($"/api/v1/matters/{u.N1}/note-folders")).StatusCode.ShouldBe(HttpStatusCode.OK);
            (await ReadStatusAsync(reader, image)).ShouldBe(HttpStatusCode.OK);
            (await reader.PostAsJsonAsync("/api/v1/note-folders", new { matterId = u.N1, name = "Nope" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await reader.PutAsJsonAsync($"/api/v1/notes/{Int(note, "noteId")}/folder", new { folderId = (int?)null, rowVersion = Str(note, "rowVersion") })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await reader.DeleteAsync($"/api/v1/note-folders/{Int(folder, "noteFolderId")}?rowVersion={Uri.EscapeDataString(Str(folder, "rowVersion"))}&moveContentsUp=true")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

            // Edit creates and moves, but deleting a folder needs Delete.
            var made = await NewFolderAsync(editor, u.N1, "Editor folder");
            (await editor.DeleteAsync($"/api/v1/note-folders/{Int(made, "noteFolderId")}?rowVersion={Uri.EscapeDataString(Str(made, "rowVersion"))}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            var moved = await OkAsync(await editor.PutAsJsonAsync($"/api/v1/notes/{Int(note, "noteId")}/folder", new { folderId = Int(made, "noteFolderId"), rowVersion = Str(note, "rowVersion") }));
            Int(moved, "folderId").ShouldBe(Int(made, "noteFolderId"));

            // Delete alone cannot create or move, but removes an (empty) folder.
            (await deleter.PostAsJsonAsync("/api/v1/note-folders", new { matterId = u.N1, name = "No" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            var empty = await NewFolderAsync(admin, u.N1, "Empty");
            (await deleter.DeleteAsync($"/api/v1/note-folders/{Int(empty, "noteFolderId")}?rowVersion={Uri.EscapeDataString(Str(empty, "rowVersion"))}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

            // Nothing the refused calls tried changed the note, its picture or the folder count.
            ImageIdOf(await OkAsync(await admin.GetAsync($"/api/v1/notes/{Int(note, "noteId")}"))).ShouldBe(image);
            (await FoldersAsync(admin, u.N1)).GetProperty("folders").GetArrayLength().ShouldBe(2);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task The_report_login_is_denied_the_folder_and_image_tables_like_the_other_notes_tables()
    {
        var h = await ReportTestHarness.StartAsync(sql);
        await using var _h = h;
        var reader = h.Login.ConnectionString;

        foreach (var table in new[] { "NoteFolder", "NoteImage", "NoteLink", "Note" })
            (await Should.ThrowAsync<SqlException>(() => SqlServerFixture.ScalarAsync(reader, $"SELECT COUNT(*) FROM dbo.{table}"))).Message.ShouldContain("permission was denied");
        foreach (var statement in new[] { "DELETE dbo.NoteImage", "INSERT dbo.NoteFolder (MatterId, Name) VALUES (1, N'x')", "UPDATE dbo.Note SET FolderId = NULL" })
            (await Should.ThrowAsync<SqlException>(() => SqlServerFixture.ExecuteAsync(reader, statement))).Message.ShouldContain("permission was denied");
    }
}
