using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using LptHub.IntegrationTests.Fixtures;
using LptHub.Notes.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Shouldly;
using static LptHub.IntegrationTests.Tasks.TaskHarness;

namespace LptHub.IntegrationTests.Notes;

/// <summary>
/// Pasted images of notes (epic #1405, issue #1409) on the real API with the sensitive-matter rule on: upload limits and the type found by content, the read headers, a hidden matter answering 404,
/// the immediate delete on save, on Cancel and with the note, the 20-per-note and 50-pending limits, the cross-matter copy, a copied note copying its images, the nightly sweep, templates carrying no
/// images, and the interplay of a save with another tab's stale text.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class NoteImagesApiTests(SqlServerFixture sql)
{
    private static int Int(JsonElement e, string name) => e.GetProperty(name).GetInt32();

    private static string Str(JsonElement e, string name) => e.GetProperty(name).GetString()!;

    private static async Task<HttpResponseMessage> PostImageAsync(HttpClient client, int matterId, byte[] bytes, string fileName = "paste.png", string declaredType = "image/png")
    {
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue(declaredType);
        form.Add(file, "file", fileName);
        return await client.PostAsync($"/api/v1/matters/{matterId}/note-images", form);
    }

    private static async Task<int> UploadAsync(HttpClient client, int matterId, byte[]? bytes = null) =>
        Int(await OkAsync(await PostImageAsync(client, matterId, bytes ?? TestImages.Png()), HttpStatusCode.Created), "noteImageId");

    private static string Img(int id, string alt = "Pasted image") => $"<img data-image-id=\"{id}\" alt=\"{alt}\" width=\"480\" height=\"300\">";

    private static async Task<JsonElement> NewNoteAsync(HttpClient client, int matterId, string html) =>
        await OkAsync(await client.PostAsJsonAsync("/api/v1/notes", new { matterId, bodyHtml = html }), HttpStatusCode.Created);

    private static Task<HttpResponseMessage> SaveAsync(HttpClient client, JsonElement note, string html) =>
        client.PutAsJsonAsync($"/api/v1/notes/{Int(note, "noteId")}", new { bodyHtml = html, rowVersion = Str(note, "rowVersion"), tagIds = Array.Empty<int>() });

    private static async Task<HttpStatusCode> ReadStatusAsync(HttpClient client, int imageId) => (await client.GetAsync($"/api/v1/notes/images/{imageId}")).StatusCode;

    [Fact]
    public async Task An_image_is_uploaded_by_its_bytes_and_read_back_with_safe_headers_and_an_etag()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var admin = u.H.Admin;
            var png = TestImages.Png(3, 2);

            // The declared type and the file name are not trusted: a PNG declared as a JPEG called "payload.exe" is a PNG.
            var up = await OkAsync(await PostImageAsync(admin, u.N1, png, "payload.exe", "image/jpeg"), HttpStatusCode.Created);
            Str(up, "contentType").ShouldBe("image/png");
            (Int(up, "width"), Int(up, "height"), Int(up, "byteSize"), Int(up, "matterId")).ShouldBe((3, 2, png.Length, u.N1));
            var jpeg = await OkAsync(await PostImageAsync(admin, u.N1, TestImages.Jpeg(640, 480), "a.bin", "application/octet-stream"), HttpStatusCode.Created);
            Str(jpeg, "contentType").ShouldBe("image/jpeg");

            var id = Int(up, "noteImageId");
            var read = await admin.GetAsync($"/api/v1/notes/images/{id}");
            read.StatusCode.ShouldBe(HttpStatusCode.OK);
            (await read.Content.ReadAsByteArrayAsync()).ShouldBe(png);
            read.Content.Headers.ContentType!.MediaType.ShouldBe("image/png");
            read.Headers.GetValues("X-Content-Type-Options").Single().ShouldBe("nosniff");
            var cacheControl = string.Join(", ", read.Headers.GetValues("Cache-Control"));
            cacheControl.ShouldContain("private");
            cacheControl.ShouldContain("no-cache");
            cacheControl.ShouldNotContain("no-store");
            read.Headers.GetValues("Content-Security-Policy").Single().ShouldContain("sandbox");
            read.Content.Headers.ContentDisposition!.DispositionType.ShouldBe("inline");
            var etag = read.Headers.ETag!.Tag;

            // The same version again: 304 with no body.
            using var again = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/notes/images/{id}");
            again.Headers.TryAddWithoutValidation("If-None-Match", etag);
            var cached = await admin.SendAsync(again);
            cached.StatusCode.ShouldBe(HttpStatusCode.NotModified);
            (await cached.Content.ReadAsByteArrayAsync()).ShouldBeEmpty();

            // The upload is audited without its content.
            var events = await u.H.AuditAsync("NOTE_IMAGE_ADDED");
            events.Count.ShouldBe(2);
            events[0].Summary!.ShouldBe("PNG, 3 x 2 px, 1 KB");
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task Size_type_and_pixel_limits_are_checked_on_the_bytes_and_nothing_is_stored_for_a_refusal()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var admin = u.H.Admin;

            // 2 MB exactly is accepted, one byte more is not (413), and a request far above the limit is refused before it is read.
            await UploadAsync(admin, u.N1, TestImages.PngOfSize(2 * 1024 * 1024));
            var tooLarge = await ProblemAsync(await PostImageAsync(admin, u.N1, TestImages.PngOfSize((2 * 1024 * 1024) + 1)), HttpStatusCode.RequestEntityTooLarge, "IMAGE_TOO_LARGE");
            tooLarge.GetProperty("meta").GetProperty("maxBytes").GetInt32().ShouldBe(2 * 1024 * 1024);
            await ProblemAsync(await PostImageAsync(admin, u.N1, new byte[3 * 1024 * 1024]), HttpStatusCode.RequestEntityTooLarge, "IMAGE_TOO_LARGE");

            // More than 8,000 px on a side.
            await ProblemAsync(await PostImageAsync(admin, u.N1, TestImages.Png(8001, 10)), HttpStatusCode.RequestEntityTooLarge, "IMAGE_TOO_LARGE");
            await UploadAsync(admin, u.N1, TestImages.Png(8000, 8000));

            // Other types are refused by content, whatever the client says about them.
            var unsupported = new (string Name, byte[] Bytes, string Declared)[]
            {
                ("svg", System.Text.Encoding.UTF8.GetBytes("<svg xmlns=\"http://www.w3.org/2000/svg\" onload=\"alert(1)\"/>"), "image/png"),
                ("gif", System.Text.Encoding.ASCII.GetBytes("GIF89a\u0001\0\u0001\0\0\0\0;"), "image/png"),
                ("html", System.Text.Encoding.UTF8.GetBytes("<script>alert(1)</script>"), "image/jpeg"),
                ("text", System.Text.Encoding.UTF8.GetBytes("not an image"), "image/png"),
                ("webp", [.. System.Text.Encoding.ASCII.GetBytes("RIFF\0\0\0\0WEBPVP8 "), .. new byte[20]], "image/png"),
            };
            foreach (var (name, bytes, declared) in unsupported)
                await ProblemAsync(await PostImageAsync(admin, u.N1, bytes, name + ".png", declared), HttpStatusCode.UnsupportedMediaType, "IMAGE_TYPE_UNSUPPORTED");

            // A PNG or JPEG that is cut short, or carries data after its end.
            await ProblemAsync(await PostImageAsync(admin, u.N1, TestImages.Png()[..30]), HttpStatusCode.BadRequest, "IMAGE_CORRUPT");
            await ProblemAsync(await PostImageAsync(admin, u.N1, [.. TestImages.Png(), 0x41, 0x42]), HttpStatusCode.BadRequest, "IMAGE_CORRUPT");
            await ProblemAsync(await PostImageAsync(admin, u.N1, TestImages.Jpeg()[..25], "a.jpg", "image/jpeg"), HttpStatusCode.BadRequest, "IMAGE_CORRUPT");

            // No file at all.
            using var empty = new MultipartFormDataContent { { new StringContent("x"), "other" } };
            await ProblemAsync(await admin.PostAsync($"/api/v1/matters/{u.N1}/note-images", empty), HttpStatusCode.BadRequest, "IMAGE_REQUIRED");

            (await u.H.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.NoteImage")).ShouldBe(2); // only the two valid ones
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task A_hidden_matters_images_do_not_exist_and_permissions_and_inactive_matters_are_checked()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var admin = u.H.Admin;
            var hiddenImage = await UploadAsync(admin, u.S1);
            var outsider = u.UnrelatedClient;

            // 404, identical to a missing id; nothing changes.
            var missing = await outsider.GetAsync("/api/v1/notes/images/999999");
            var hidden = await outsider.GetAsync($"/api/v1/notes/images/{hiddenImage}");
            hidden.StatusCode.ShouldBe(HttpStatusCode.NotFound);
            missing.StatusCode.ShouldBe(HttpStatusCode.NotFound);
            var hiddenBody = JsonDocument.Parse(await hidden.Content.ReadAsStringAsync()).RootElement;
            var missingBody = JsonDocument.Parse(await missing.Content.ReadAsStringAsync()).RootElement;
            foreach (var field in new[] { "type", "title", "status", "detail", "code" })
                hiddenBody.GetProperty(field).ToString().ShouldBe(missingBody.GetProperty(field).ToString(), field);
            (await PostImageAsync(outsider, u.S1, TestImages.Png())).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await outsider.DeleteAsync($"/api/v1/note-images/{hiddenImage}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await outsider.PostAsJsonAsync($"/api/v1/note-images/{hiddenImage}/copy", new { targetMatterId = u.N1 })).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await PostImageAsync(outsider, 999999, TestImages.Png())).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            var own = await UploadAsync(outsider, u.N1);
            (await outsider.PostAsJsonAsync($"/api/v1/note-images/{own}/copy", new { targetMatterId = u.S1 })).StatusCode.ShouldBe(HttpStatusCode.NotFound); // a hidden target
            (await u.H.ScalarAsync($"SELECT COUNT(*) AS [Value] FROM dbo.NoteImage WHERE MatterId = {u.S1}")).ShouldBe(1);
            (await ReadStatusAsync(u.PmPrimaryClient, hiddenImage)).ShouldBe(HttpStatusCode.OK); // the manager sees it

            // A note of the visible matter cannot use the hidden matter's image either.
            // It is reported exactly like an image that does not exist, so a save cannot probe the ids of a hidden matter.
            var other = await ProblemAsync(await outsider.PostAsJsonAsync("/api/v1/notes", new { matterId = u.N1, bodyHtml = Img(hiddenImage) }), HttpStatusCode.BadRequest, "IMAGE_NOT_FOUND");
            var gone = await ProblemAsync(await outsider.PostAsJsonAsync("/api/v1/notes", new { matterId = u.N1, bodyHtml = Img(987654) }), HttpStatusCode.BadRequest, "IMAGE_NOT_FOUND");
            other.GetProperty("detail").GetString().ShouldBe(gone.GetProperty("detail").GetString());

            // View reads, Edit uploads and copies and deletes, nothing else does.
            var reader = await u.H.UserWithAsync(@"KE\imgreader", "Matter.View", "MatterNote.View");
            var editor = await u.H.UserWithAsync(@"KE\imgeditor", "Matter.View", "MatterNote.View", "MatterNote.Edit");
            var nobody = await u.H.UserWithAsync(@"KE\imgnobody", "Matter.View");
            var image = await UploadAsync(editor, u.N1);
            (await ReadStatusAsync(reader, image)).ShouldBe(HttpStatusCode.OK);
            (await ReadStatusAsync(nobody, image)).ShouldBe(HttpStatusCode.Forbidden);
            (await PostImageAsync(reader, u.N1, TestImages.Png())).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await reader.DeleteAsync($"/api/v1/note-images/{image}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await reader.PostAsJsonAsync($"/api/v1/note-images/{image}/copy", new { targetMatterId = u.N1 })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

            // An inactive matter takes no new image but its images stay readable.
            var quiet = await u.H.CreateMatterAsync("343", "24");
            var kept = await UploadAsync(admin, quiet);
            await u.H.SetMatterActiveAsync(quiet, false);
            await ProblemAsync(await PostImageAsync(admin, quiet, TestImages.Png()), HttpStatusCode.Conflict, "MATTER_INACTIVE");
            await ProblemAsync(await admin.PostAsJsonAsync($"/api/v1/note-images/{image}/copy", new { targetMatterId = quiet }), HttpStatusCode.Conflict, "MATTER_INACTIVE");
            (await ReadStatusAsync(admin, kept)).ShouldBe(HttpStatusCode.OK);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task A_note_uses_at_most_20_images_which_must_exist_and_belong_to_its_matter()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var admin = u.H.Admin;
            var ids = new List<int>();
            for (var i = 0; i < 21; i++)
                ids.Add(await UploadAsync(admin, u.N1));

            var twenty = await NewNoteAsync(admin, u.N1, string.Concat(ids.Take(20).Select(i => Img(i))));
            twenty.GetProperty("bodyHtml").GetString()!.ShouldContain("data-image-id=\"" + ids[0] + "\"");
            await ProblemAsync(await admin.PostAsJsonAsync("/api/v1/notes", new { matterId = u.N1, bodyHtml = string.Concat(ids.Select(i => Img(i))) }), HttpStatusCode.BadRequest, "TOO_MANY_IMAGES");
            var last = await NewNoteAsync(admin, u.N1, "<p>x</p>");
            await ProblemAsync(await SaveAsync(admin, last, string.Concat(ids.Select(i => Img(i)))), HttpStatusCode.BadRequest, "TOO_MANY_IMAGES");
            (await NewNoteAsync(admin, u.N1, Img(ids[20]) + Img(ids[20]))).GetProperty("noteId").GetInt32().ShouldBeGreaterThan(0); // the same picture twice counts once

            // An image that does not exist (the 404 is an id of nobody), or one of another matter.
            var missing = await ProblemAsync(await admin.PostAsJsonAsync("/api/v1/notes", new { matterId = u.N1, bodyHtml = Img(ids[0]) + Img(987654) }), HttpStatusCode.BadRequest, "IMAGE_NOT_FOUND");
            missing.GetProperty("meta").GetProperty("imageIds").EnumerateArray().Select(x => x.GetInt32()).ShouldBe([987654]);
            missing.GetProperty("errors").GetProperty("bodyHtml").GetArrayLength().ShouldBe(1);
            var foreign = await UploadAsync(admin, u.S1);
            await ProblemAsync(await admin.PostAsJsonAsync("/api/v1/notes", new { matterId = u.N1, bodyHtml = Img(foreign) }), HttpStatusCode.BadRequest, "IMAGE_NOT_IN_MATTER");

            // No src, no URL: whatever the client sends, the body keeps only the four attributes.
            var fresh = await UploadAsync(admin, u.N1);
            var clean = await NewNoteAsync(admin, u.N1, $"<img src=\"https://evil.example/x.png\" data-image-id=\"{fresh}\" onerror=\"a()\" style=\"width:9px\">");
            Str(clean, "bodyHtml").ShouldBe($"<img data-image-id=\"{fresh}\" alt=\"Pasted image\">");
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task An_image_no_saved_note_uses_is_deleted_by_the_save_that_drops_it_and_search_finds_the_alt_text()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var admin = u.H.Admin;
            var a = await UploadAsync(admin, u.N1);
            var b = await UploadAsync(admin, u.N1);

            var note = await NewNoteAsync(admin, u.N1, $"<p>Title line</p>{Img(a, "Privilege log screenshot")}{Img(b, "Org chart")}");
            var noteId = Int(note, "noteId");
            (await u.H.ScalarAsync($"SELECT COUNT(*) AS [Value] FROM dbo.NoteLink WHERE NoteId = {noteId} AND TargetType = 'IMAGE'")).ShouldBe(2);
            note.GetProperty("references").GetArrayLength().ShouldBe(0); // the References panel does not list images

            // Search covers the alt texts (the body text); the title and the snippet do not.
            (await OkAsync(await admin.GetAsync($"/api/v1/notes?matterId={u.N1}&q=privilege%20log"))).GetProperty("items").GetArrayLength().ShouldBe(1);
            (await OkAsync(await admin.GetAsync($"/api/v1/notes?matterId={u.N1}&q=Title%20line"))).GetProperty("items").GetArrayLength().ShouldBe(1);
            Str(note, "title").ShouldBe("Title line");

            // Dropping B: B is gone in the same save; A stays.
            var saved = await OkAsync(await SaveAsync(admin, note, $"<p>Title line</p>{Img(a, "Privilege log screenshot")}"));
            (await ReadStatusAsync(admin, b)).ShouldBe(HttpStatusCode.NotFound);
            (await ReadStatusAsync(admin, a)).ShouldBe(HttpStatusCode.OK);
            (await u.H.ScalarAsync($"SELECT COUNT(*) AS [Value] FROM dbo.NoteLink WHERE NoteId = {noteId} AND TargetType = 'IMAGE'")).ShouldBe(1);

            // A save that only changes the size or the alt text keeps the image.
            var resized = await OkAsync(await SaveAsync(admin, saved, $"<p>Title line</p><img data-image-id=\"{a}\" alt=\"Renamed\" width=\"240\" height=\"150\">"));
            (await ReadStatusAsync(admin, a)).ShouldBe(HttpStatusCode.OK);
            (await OkAsync(await admin.GetAsync($"/api/v1/notes?matterId={u.N1}&q=Privilege"))).GetProperty("items").GetArrayLength().ShouldBe(0);

            // Dropping the last picture removes it too; a pending image of someone else is not touched.
            var pending = await UploadAsync(admin, u.N1);
            await OkAsync(await SaveAsync(admin, resized, "<p>Title line</p>"));
            (await ReadStatusAsync(admin, a)).ShouldBe(HttpStatusCode.NotFound);
            (await ReadStatusAsync(admin, pending)).ShouldBe(HttpStatusCode.OK);
            (await u.H.ScalarAsync($"SELECT COUNT(*) AS [Value] FROM dbo.NoteLink WHERE TargetType = 'IMAGE'")).ShouldBe(0);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task Cancel_deletes_an_unsaved_upload_only_for_its_uploader_and_never_a_saved_one()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var admin = u.H.Admin;
            var editor = await u.H.UserWithAsync(@"KE\imgeditor2", "Matter.View", "MatterNote.View", "MatterNote.Edit");
            var draft = await UploadAsync(admin, u.N1);

            (await editor.DeleteAsync($"/api/v1/note-images/{draft}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden); // not the uploader
            await ProblemAsync(await editor.DeleteAsync($"/api/v1/note-images/{draft}"), HttpStatusCode.Forbidden, "NOT_IMAGE_UPLOADER");
            (await ReadStatusAsync(admin, draft)).ShouldBe(HttpStatusCode.OK);
            (await admin.DeleteAsync($"/api/v1/note-images/{draft}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
            (await ReadStatusAsync(admin, draft)).ShouldBe(HttpStatusCode.NotFound);
            (await admin.DeleteAsync($"/api/v1/note-images/{draft}")).StatusCode.ShouldBe(HttpStatusCode.NotFound); // already gone: the editor ignores it

            // A saved image is not deleted by Cancel (the editor may call it for every upload of the session).
            var saved = await UploadAsync(admin, u.N1);
            await NewNoteAsync(admin, u.N1, Img(saved));
            await ProblemAsync(await admin.DeleteAsync($"/api/v1/note-images/{saved}"), HttpStatusCode.Conflict, "IMAGE_IN_USE");
            (await ReadStatusAsync(admin, saved)).ShouldBe(HttpStatusCode.OK);
            (await u.H.AuditAsync("NOTE_IMAGE_ADDED")).Count.ShouldBe(2); // deleting is not audited
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task Deleting_a_note_deletes_its_images_and_a_copied_note_copies_its_images()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var admin = u.H.Admin;
            var a = await UploadAsync(admin, u.N1);
            var one = await NewNoteAsync(admin, u.N1, $"<p>One</p>{Img(a)}");

            // The editor copies the text of the note into a new note: the body names the same image, and the server gives the new note its own copy.
            var two = await NewNoteAsync(admin, u.N1, $"<p>Two</p>{Img(a)}");
            var copiedId = int.Parse(System.Text.RegularExpressions.Regex.Match(Str(two, "bodyHtml"), "data-image-id=\"(\\d+)\"").Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture);
            copiedId.ShouldNotBe(a);
            (await ReadStatusAsync(admin, copiedId)).ShouldBe(HttpStatusCode.OK);
            (await admin.GetByteArrayAsync($"/api/v1/notes/images/{copiedId}")).ShouldBe(await admin.GetByteArrayAsync($"/api/v1/notes/images/{a}"));
            (await u.H.ScalarAsync($"SELECT COUNT(*) AS [Value] FROM dbo.NoteImage WHERE MatterId = {u.N1}")).ShouldBe(2);
            (await u.H.ScalarAsync("SELECT COUNT(*) AS [Value] FROM (SELECT TargetId FROM dbo.NoteLink WHERE TargetType = 'IMAGE' GROUP BY TargetId HAVING COUNT(*) > 1) x")).ShouldBe(0); // nothing is shared

            // The same through a save: a third note pastes the first note's picture into its text.
            var three = await NewNoteAsync(admin, u.N1, "<p>Three</p>");
            var threeSaved = await OkAsync(await SaveAsync(admin, three, $"<p>Three</p>{Img(a)}"));
            Str(threeSaved, "bodyHtml").ShouldNotContain($"data-image-id=\"{a}\"");
            (await u.H.ScalarAsync($"SELECT COUNT(*) AS [Value] FROM dbo.NoteImage WHERE MatterId = {u.N1}")).ShouldBe(3);
            // Saving the same text again changes nothing (no new copy: the note already uses its own).
            var threeId = int.Parse(System.Text.RegularExpressions.Regex.Match(Str(threeSaved, "bodyHtml"), "data-image-id=\"(\\d+)\"").Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture);
            await OkAsync(await SaveAsync(admin, threeSaved, Str(threeSaved, "bodyHtml")));
            (await u.H.ScalarAsync($"SELECT COUNT(*) AS [Value] FROM dbo.NoteImage WHERE MatterId = {u.N1}")).ShouldBe(3);

            // Deleting the first note deletes its image and only its image.
            (await admin.DeleteAsync($"/api/v1/notes/{Int(one, "noteId")}?rowVersion={Uri.EscapeDataString(Str(one, "rowVersion"))}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
            (await ReadStatusAsync(admin, a)).ShouldBe(HttpStatusCode.NotFound);
            (await ReadStatusAsync(admin, copiedId)).ShouldBe(HttpStatusCode.OK);
            (await ReadStatusAsync(admin, threeId)).ShouldBe(HttpStatusCode.OK);

            // A locked note cannot be deleted, so its images stay.
            var locked = await OkAsync(await admin.PostAsJsonAsync($"/api/v1/notes/{Int(two, "noteId")}/lock", new { rowVersion = Str(two, "rowVersion") }));
            await ProblemAsync(await admin.DeleteAsync($"/api/v1/notes/{Int(two, "noteId")}?rowVersion={Uri.EscapeDataString(Str(locked, "rowVersion"))}"), HttpStatusCode.Conflict, "NOTE_LOCKED");
            (await ReadStatusAsync(admin, copiedId)).ShouldBe(HttpStatusCode.OK);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task An_image_copied_to_another_matter_is_a_separate_record_and_audited_there()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var admin = u.H.Admin;
            var source = await UploadAsync(admin, u.N1, TestImages.Jpeg(800, 600));
            var target = await u.H.CreateMatterAsync("343", "24");

            var copy = await OkAsync(await admin.PostAsJsonAsync($"/api/v1/note-images/{source}/copy", new { targetMatterId = target }), HttpStatusCode.Created);
            var copyId = Int(copy, "noteImageId");
            copyId.ShouldNotBe(source);
            (Int(copy, "matterId"), Int(copy, "width"), Int(copy, "height"), Str(copy, "contentType")).ShouldBe((target, 800, 600, "image/jpeg"));
            (await admin.GetByteArrayAsync($"/api/v1/notes/images/{copyId}")).ShouldBe(await admin.GetByteArrayAsync($"/api/v1/notes/images/{source}"));
            var events = await u.H.AuditAsync("NOTE_IMAGE_ADDED");
            events.Count.ShouldBe(2);
            events[1].MatterId.ShouldBe(target);

            // The copy belongs to the target: a note there can use it, a note of the source matter cannot; the source can go without touching the copy.
            await NewNoteAsync(admin, target, Img(copyId));
            await ProblemAsync(await admin.PostAsJsonAsync("/api/v1/notes", new { matterId = u.N1, bodyHtml = Img(copyId) }), HttpStatusCode.BadRequest, "IMAGE_NOT_IN_MATTER");
            (await admin.DeleteAsync($"/api/v1/note-images/{source}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
            (await ReadStatusAsync(admin, copyId)).ShouldBe(HttpStatusCode.OK);
            (await admin.PostAsJsonAsync($"/api/v1/note-images/{copyId}/copy", new { targetMatterId = 0 })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task A_person_may_have_50_unsaved_uploads_and_saved_ones_do_not_count()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var admin = u.H.Admin;
            var first = await UploadAsync(admin, u.N1);
            await u.H.ExecuteAsync(
                $"INSERT dbo.NoteImage (MatterId, ContentType, Width, Height, ByteSize, ContentSha256, Content, UploadedByUserId) SELECT TOP 48 MatterId, ContentType, Width, Height, ByteSize, ContentSha256, Content, UploadedByUserId FROM dbo.NoteImage CROSS JOIN sys.all_objects WHERE NoteImageId = {first}");
            (await u.H.ScalarAsync($"SELECT COUNT(*) AS [Value] FROM dbo.NoteImage WHERE UploadedByUserId = (SELECT UploadedByUserId FROM dbo.NoteImage WHERE NoteImageId = {first})")).ShouldBe(49);

            var fiftieth = await UploadAsync(admin, u.N1);
            var limit = await ProblemAsync(await PostImageAsync(admin, u.N1, TestImages.Png()), HttpStatusCode.Conflict, "TOO_MANY_PENDING_IMAGES");
            limit.GetProperty("meta").GetProperty("limit").GetInt32().ShouldBe(50);
            await ProblemAsync(await admin.PostAsJsonAsync($"/api/v1/note-images/{first}/copy", new { targetMatterId = u.N1 }), HttpStatusCode.Conflict, "TOO_MANY_PENDING_IMAGES");

            // Saving one into a note, or cancelling one, makes room; another person has their own 50.
            await NewNoteAsync(admin, u.N1, Img(fiftieth));
            await UploadAsync(admin, u.N1);
            var other = await u.H.UserWithAsync(@"KE\imgeditor3", "Matter.View", "MatterNote.View", "MatterNote.Edit");
            await UploadAsync(other, u.N1);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task The_nightly_sweep_deletes_unreferenced_uploads_older_than_48_hours_in_batches_and_nothing_else()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var admin = u.H.Admin;
            var saved = await UploadAsync(admin, u.N1);
            await NewNoteAsync(admin, u.N1, Img(saved));
            var recent = await UploadAsync(admin, u.N1);
            var old = await UploadAsync(admin, u.N1);
            var oldSaved = await UploadAsync(admin, u.N1);
            await NewNoteAsync(admin, u.N1, Img(oldSaved));
            await u.H.ExecuteAsync($"UPDATE dbo.NoteImage SET UploadedAt = DATEADD(HOUR, -49, SYSUTCDATETIME()) WHERE NoteImageId IN ({old}, {oldSaved}, {saved})");
            await u.H.ExecuteAsync($"UPDATE dbo.NoteImage SET UploadedAt = DATEADD(HOUR, -47, SYSUTCDATETIME()) WHERE NoteImageId = {recent}");
            // 249 more old orphans: more than two batches of 100.
            await u.H.ExecuteAsync(
                $"INSERT dbo.NoteImage (MatterId, ContentType, Width, Height, ByteSize, ContentSha256, Content, UploadedAt) SELECT TOP 249 MatterId, ContentType, Width, Height, ByteSize, ContentSha256, Content, DATEADD(DAY, -30, SYSUTCDATETIME()) FROM dbo.NoteImage CROSS JOIN sys.all_objects WHERE NoteImageId = {old}");
            var sweeper = u.H.Factory.Services.GetServices<IHostedService>().OfType<NoteImageSweeper>().Single();
            var audits = (await u.H.AuditAsync("NOTE_IMAGE_ADDED")).Count;

            (await sweeper.SweepAsync(CancellationToken.None)).ShouldBe(250);

            (await ReadStatusAsync(admin, old)).ShouldBe(HttpStatusCode.NotFound);
            (await ReadStatusAsync(admin, recent)).ShouldBe(HttpStatusCode.OK); // not yet 48 hours
            (await ReadStatusAsync(admin, saved)).ShouldBe(HttpStatusCode.OK); // old but a note uses it
            (await ReadStatusAsync(admin, oldSaved)).ShouldBe(HttpStatusCode.OK);
            (await u.H.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.NoteImage")).ShouldBe(3);
            (await sweeper.SweepAsync(CancellationToken.None)).ShouldBe(0);
            (await u.H.AuditAsync("NOTE_IMAGE_ADDED")).Count.ShouldBe(audits); // the sweep writes no audit
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task A_template_carries_no_images_and_says_how_many_it_left_out()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var admin = u.H.Admin;
            var a = await UploadAsync(admin, u.N1);
            var b = await UploadAsync(admin, u.N1);
            var body = $"<p>Standard text</p>{Img(a)}{Img(b)}";

            var created = await OkAsync(await admin.PostAsJsonAsync("/api/v1/note-templates", new { scope = "MATTER", matterId = u.N1, name = "With pictures", bodyHtml = body }), HttpStatusCode.Created);
            Str(created, "bodyHtml").ShouldBe("<p>Standard text</p>");
            Int(created, "imagesLeftOut").ShouldBe(2);

            var updated = await OkAsync(await admin.PutAsJsonAsync($"/api/v1/note-templates/{Int(created, "noteTemplateId")}", new { name = "With pictures", bodyHtml = body + Img(a), rowVersion = Str(created, "rowVersion") }));
            Str(updated, "bodyHtml").ShouldBe("<p>Standard text</p>");
            Int(updated, "imagesLeftOut").ShouldBe(3); // three pictures in the text (one of them twice)
            Int(await OkAsync(await admin.GetAsync($"/api/v1/note-templates/{Int(created, "noteTemplateId")}")), "imagesLeftOut").ShouldBe(0);

            // The pictures were never attached to the template, so they are still plain pending uploads.
            (await u.H.ScalarAsync($"SELECT COUNT(*) AS [Value] FROM dbo.NoteLink WHERE TargetType = 'IMAGE'")).ShouldBe(0);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task A_save_that_drops_an_image_while_another_tab_still_shows_it_conflicts_and_the_stale_text_cannot_bring_it_back()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var admin = u.H.Admin;
            var a = await UploadAsync(admin, u.N1);
            var note = await NewNoteAsync(admin, u.N1, $"<p>Plan</p>{Img(a)}");

            // Tab A drops the image and saves: it is deleted at once.
            var tabA = await OkAsync(await SaveAsync(admin, note, "<p>Plan</p>"));
            (await ReadStatusAsync(admin, a)).ShouldBe(HttpStatusCode.NotFound);

            // Tab B still has the old version and its image: the row version stops the save (409) before anything is lost.
            await ProblemAsync(await SaveAsync(admin, note, $"<p>Plan, edited</p>{Img(a)}"), HttpStatusCode.Conflict, "CONCURRENCY_CONFLICT");

            // "Copy My Text" after the conflict: the person reloads and saves the old text again. The image is gone, the answer says which one, and the text is not lost (the editor drops the node).
            var missing = await ProblemAsync(await SaveAsync(admin, tabA, $"<p>Plan, edited</p>{Img(a)}"), HttpStatusCode.BadRequest, "IMAGE_NOT_FOUND");
            missing.GetProperty("meta").GetProperty("imageIds").EnumerateArray().Select(x => x.GetInt32()).ShouldBe([a]);
            var again = await OkAsync(await SaveAsync(admin, tabA, "<p>Plan, edited</p>"));
            Str(again, "bodyHtml").ShouldBe("<p>Plan, edited</p>");

            // The same note edited by someone else is read as usual; a save that changes only tags still works with images in the body.
            var withImage = await UploadAsync(admin, u.N1);
            var c = await OkAsync(await SaveAsync(admin, again, $"<p>Plan, edited</p>{Img(withImage)}"));
            (await ReadStatusAsync(admin, withImage)).ShouldBe(HttpStatusCode.OK);
            var tagged = await OkAsync(await admin.PutAsJsonAsync($"/api/v1/notes/{Int(c, "noteId")}", new { bodyHtml = Str(c, "bodyHtml"), rowVersion = Str(c, "rowVersion"), tagIds = Array.Empty<int>() }));
            Str(tagged, "bodyHtml").ShouldBe(Str(c, "bodyHtml"));
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task Two_notes_that_claim_one_pending_image_at_the_same_time_never_share_it()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var admin = u.H.Admin;
            for (var round = 0; round < 3; round++)
            {
                var image = await UploadAsync(admin, u.N1);
                var results = await Task.WhenAll(
                    admin.PostAsJsonAsync("/api/v1/notes", new { matterId = u.N1, bodyHtml = $"<p>Left {round}</p>{Img(image)}" }),
                    admin.PostAsJsonAsync("/api/v1/notes", new { matterId = u.N1, bodyHtml = $"<p>Right {round}</p>{Img(image)}" }));
                results.ShouldAllBe(r => r.StatusCode == HttpStatusCode.Created);
            }

            // Every link points to an existing image, and no image has two notes.
            (await u.H.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.NoteLink l WHERE l.TargetType = 'IMAGE' AND NOT EXISTS (SELECT 1 FROM dbo.NoteImage i WHERE i.NoteImageId = l.TargetId)")).ShouldBe(0);
            (await u.H.ScalarAsync("SELECT COUNT(*) AS [Value] FROM (SELECT TargetId FROM dbo.NoteLink WHERE TargetType = 'IMAGE' GROUP BY TargetId HAVING COUNT(*) > 1) x")).ShouldBe(0);
            (await u.H.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.NoteLink WHERE TargetType = 'IMAGE'")).ShouldBe(6);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }
}
