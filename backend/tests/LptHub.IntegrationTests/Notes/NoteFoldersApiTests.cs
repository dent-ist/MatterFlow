using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using LptHub.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Shouldly;
using static LptHub.IntegrationTests.Tasks.TaskHarness;

namespace LptHub.IntegrationTests.Notes;

/// <summary>
/// Nested note folders (epic #1405, issue #1407) on the real API with the sensitive-matter rule on: names, depth, the 200 limit, cycles, concurrency, the delete rules and
/// "Move Contents Up", moving notes (also locked ones), the list filters, the audit events, and a hidden matter answering 404.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class NoteFoldersApiTests(SqlServerFixture sql)
{
    private static string Str(JsonElement e, string name) => e.GetProperty(name).GetString()!;

    private static int Int(JsonElement e, string name) => e.GetProperty(name).GetInt32();

    private static async Task<JsonElement> NewFolderAsync(HttpClient client, int matterId, string name, int? parentId = null) =>
        await OkAsync(await client.PostAsJsonAsync("/api/v1/note-folders", new { matterId, parentFolderId = parentId, name }), HttpStatusCode.Created);

    private static async Task<JsonElement> NewNoteAsync(HttpClient client, int matterId, string text, int? folderId = null) =>
        await OkAsync(await client.PostAsJsonAsync("/api/v1/notes", new { matterId, folderId, bodyHtml = $"<p>{text}</p>" }), HttpStatusCode.Created);

    private static async Task<JsonElement> FoldersAsync(HttpClient client, int matterId) => await OkAsync(await client.GetAsync($"/api/v1/matters/{matterId}/note-folders"));

    private static JsonElement Find(JsonElement list, int folderId) => list.GetProperty("folders").EnumerateArray().Single(f => Int(f, "noteFolderId") == folderId);

    private static Task<HttpResponseMessage> MoveFolderAsync(HttpClient client, JsonElement folder, int? parentId) =>
        client.PutAsJsonAsync($"/api/v1/note-folders/{Int(folder, "noteFolderId")}/parent", new { parentFolderId = parentId, rowVersion = Str(folder, "rowVersion") });

    private static async Task<JsonElement> NotesAsync(HttpClient client, int matterId, string query = "") =>
        (await OkAsync(await client.GetAsync($"/api/v1/notes?matterId={matterId}{query}"))).GetProperty("items");

    private static string[] Titles(JsonElement items) => [.. items.EnumerateArray().Select(i => Str(i, "title")).OrderBy(t => t, StringComparer.Ordinal)];

    [Fact]
    public async Task Names_nesting_depth_and_counts_follow_the_rules()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var admin = u.H.Admin;
            var custodians = await NewFolderAsync(admin, u.N1, "  Custodians  ");
            custodians.GetProperty("name").GetString().ShouldBe("Custodians"); // trimmed
            custodians.GetProperty("parentFolderId").ValueKind.ShouldBe(JsonValueKind.Null);
            var id = Int(custodians, "noteFolderId");

            // Unique inside the parent, case-insensitive, also at the top level; the same name under another parent is fine.
            var taken = await ProblemAsync(await admin.PostAsJsonAsync("/api/v1/note-folders", new { matterId = u.N1, name = "custodians" }), HttpStatusCode.Conflict, "FOLDER_NAME_TAKEN");
            taken.GetProperty("errors").GetProperty("name").GetArrayLength().ShouldBe(1);
            var finance = await NewFolderAsync(admin, u.N1, "Finance", id);
            await NewFolderAsync(admin, u.N1, "Finance"); // top level: another parent
            await ProblemAsync(await admin.PostAsJsonAsync("/api/v1/note-folders", new { matterId = u.N1, parentFolderId = id, name = "FINANCE" }), HttpStatusCode.Conflict, "FOLDER_NAME_TAKEN");

            // The name rule.
            foreach (var bad in new[] { "", "   ", "a/b", "a\\b", "tab\there", new string('x', 101) })
                (await admin.PostAsJsonAsync("/api/v1/note-folders", new { matterId = u.N1, name = bad })).StatusCode.ShouldBe(HttpStatusCode.BadRequest, bad);
            await NewFolderAsync(admin, u.N1, new string('y', 100));

            // Five levels at most.
            var parent = Int(finance, "noteFolderId");
            for (var level = 3; level <= 5; level++)
                parent = Int(await NewFolderAsync(admin, u.N1, $"Level {level}", parent), "noteFolderId");
            var tooDeep = await ProblemAsync(await admin.PostAsJsonAsync("/api/v1/note-folders", new { matterId = u.N1, parentFolderId = parent, name = "Level 6" }), HttpStatusCode.Conflict, "FOLDER_TOO_DEEP");
            tooDeep.GetProperty("detail").GetString()!.ShouldContain("5 levels");

            // Direct counts: the folder numbers plus No Folder equal All Notes.
            await NewNoteAsync(admin, u.N1, "In custodians", id);
            await NewNoteAsync(admin, u.N1, "In finance", Int(finance, "noteFolderId"));
            await NewNoteAsync(admin, u.N1, "In finance too", Int(finance, "noteFolderId"));
            await NewNoteAsync(admin, u.N1, "Loose");
            var list = await FoldersAsync(admin, u.N1);
            Int(Find(list, id), "noteCount").ShouldBe(1);
            Int(Find(list, id), "subfolderCount").ShouldBe(1); // Finance only (the other Finance is top level)
            Int(Find(list, Int(finance, "noteFolderId")), "noteCount").ShouldBe(2);
            list.GetProperty("noFolderNoteCount").GetInt32().ShouldBe(1);
            list.GetProperty("totalNoteCount").GetInt32().ShouldBe(4);
            list.GetProperty("folders").EnumerateArray().Sum(f => Int(f, "noteCount")).ShouldBe(3);

            // Another matter has its own, empty tree.
            (await FoldersAsync(admin, u.S1)).GetProperty("folders").GetArrayLength().ShouldBe(0);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task A_matter_holds_at_most_200_folders()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            await u.H.Factory.WithDbAsync(async db =>
            {
                await db.Database.ExecuteSqlAsync($"INSERT dbo.NoteFolder (MatterId, Name) SELECT TOP 199 {u.N1}, CONCAT(N'Folder ', ROW_NUMBER() OVER (ORDER BY (SELECT 1))) FROM sys.all_objects");
                return 0;
            });

            await NewFolderAsync(u.H.Admin, u.N1, "The 200th");
            var limit = await ProblemAsync(await u.H.Admin.PostAsJsonAsync("/api/v1/note-folders", new { matterId = u.N1, name = "The 201st" }), HttpStatusCode.Conflict, "FOLDER_LIMIT");
            limit.GetProperty("meta").GetProperty("limit").GetInt32().ShouldBe(200);
            await NewFolderAsync(u.H.Admin, u.S1, "Other matter, own count");
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task Rename_and_move_check_the_row_version_names_cycles_and_depth()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var admin = u.H.Admin;
            var a = await NewFolderAsync(admin, u.N1, "A");
            var b = await NewFolderAsync(admin, u.N1, "B", Int(a, "noteFolderId"));
            var c = await NewFolderAsync(admin, u.N1, "C", Int(b, "noteFolderId"));
            var other = await NewFolderAsync(admin, u.N1, "Other");

            // Rename: stale token 409, clash 409, a change of case only is allowed.
            var renamed = await OkAsync(await admin.PutAsJsonAsync($"/api/v1/note-folders/{Int(other, "noteFolderId")}", new { name = "Others", rowVersion = Str(other, "rowVersion") }));
            renamed.GetProperty("name").GetString().ShouldBe("Others");
            await ProblemAsync(await admin.PutAsJsonAsync($"/api/v1/note-folders/{Int(other, "noteFolderId")}", new { name = "Again", rowVersion = Str(other, "rowVersion") }), HttpStatusCode.Conflict, "CONCURRENCY_CONFLICT");
            await ProblemAsync(await admin.PutAsJsonAsync($"/api/v1/note-folders/{Int(other, "noteFolderId")}", new { name = "a", rowVersion = Str(renamed, "rowVersion") }), HttpStatusCode.Conflict, "FOLDER_NAME_TAKEN");
            var lower = await OkAsync(await admin.PutAsJsonAsync($"/api/v1/note-folders/{Int(other, "noteFolderId")}", new { name = "OTHERS", rowVersion = Str(renamed, "rowVersion") }));
            lower.GetProperty("name").GetString().ShouldBe("OTHERS");

            // Cycles: into itself and into its own subfolders.
            await ProblemAsync(await MoveFolderAsync(admin, a, Int(a, "noteFolderId")), HttpStatusCode.Conflict, "FOLDER_CYCLE");
            await ProblemAsync(await MoveFolderAsync(admin, a, Int(c, "noteFolderId")), HttpStatusCode.Conflict, "FOLDER_CYCLE");

            // Depth: A (3 levels with its subtree) under a 3-level chain would be 6 levels; under a 2-level chain 5.
            var x1 = await NewFolderAsync(admin, u.N1, "X1");
            var x2 = await NewFolderAsync(admin, u.N1, "X2", Int(x1, "noteFolderId"));
            var x3 = await NewFolderAsync(admin, u.N1, "X3", Int(x2, "noteFolderId"));
            await ProblemAsync(await MoveFolderAsync(admin, a, Int(x3, "noteFolderId")), HttpStatusCode.Conflict, "FOLDER_TOO_DEEP");
            var moved = await OkAsync(await MoveFolderAsync(admin, a, Int(x2, "noteFolderId")));
            moved.GetProperty("parentFolderId").GetInt32().ShouldBe(Int(x2, "noteFolderId"));

            // A name clash in the target; a move to the top level and a move to the same place.
            await NewFolderAsync(admin, u.N1, "B"); // top level
            await ProblemAsync(await MoveFolderAsync(admin, (await FoldersAsync(admin, u.N1)).GetProperty("folders").EnumerateArray().Single(f => Int(f, "noteFolderId") == Int(b, "noteFolderId")), null), HttpStatusCode.Conflict, "FOLDER_NAME_TAKEN");
            var top = await OkAsync(await MoveFolderAsync(admin, moved, null));
            top.GetProperty("parentFolderId").ValueKind.ShouldBe(JsonValueKind.Null);
            (await OkAsync(await MoveFolderAsync(admin, top, null))).GetProperty("rowVersion").GetString().ShouldBe(Str(top, "rowVersion")); // no change

            // A parent of another matter does not exist for this matter.
            var foreign = await NewFolderAsync(admin, u.S1, "Foreign");
            (await admin.PostAsJsonAsync("/api/v1/note-folders", new { matterId = u.N1, parentFolderId = Int(foreign, "noteFolderId"), name = "Nope" })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
            (await MoveFolderAsync(admin, top, Int(foreign, "noteFolderId"))).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task Two_folders_moved_into_each_other_at_the_same_time_never_make_a_cycle()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var a = await NewFolderAsync(u.H.Admin, u.N1, "A");
            var b = await NewFolderAsync(u.H.Admin, u.N1, "B");
            var first = MoveFolderAsync(u.H.Admin, a, Int(b, "noteFolderId"));
            var second = MoveFolderAsync(u.H.Admin, b, Int(a, "noteFolderId"));
            var results = await Task.WhenAll(first, second);

            results.Count(r => r.StatusCode == HttpStatusCode.OK).ShouldBe(1);
            results.Count(r => r.StatusCode == HttpStatusCode.Conflict).ShouldBe(1);
            var list = await FoldersAsync(u.H.Admin, u.N1);
            list.GetProperty("folders").EnumerateArray().Count(f => f.GetProperty("parentFolderId").ValueKind == JsonValueKind.Null).ShouldBe(1);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task Notes_move_between_folders_also_when_locked_and_the_list_filters_by_folder()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var admin = u.H.Admin;
            var parent = await NewFolderAsync(admin, u.N1, "Custodians");
            var child = await NewFolderAsync(admin, u.N1, "Executive Team", Int(parent, "noteFolderId"));
            var empty = await NewFolderAsync(admin, u.N1, "Empty");
            var tablet = await NewNoteAsync(admin, u.N1, "Tablet in parent", Int(parent, "noteFolderId"));
            await NewNoteAsync(admin, u.N1, "Tablet in child", Int(child, "noteFolderId"));
            await NewNoteAsync(admin, u.N1, "Tablet loose");
            await NewNoteAsync(admin, u.N1, "Other in parent", Int(parent, "noteFolderId"));
            tablet.GetProperty("folderId").GetInt32().ShouldBe(Int(parent, "noteFolderId"));

            // A folder shows its direct notes; No Folder the loose ones; with a search the folder and its subfolders; All Notes everything.
            Titles(await NotesAsync(admin, u.N1, $"&folderId={Int(parent, "noteFolderId")}")).ShouldBe(["Other in parent", "Tablet in parent"]);
            Titles(await NotesAsync(admin, u.N1, "&noFolder=true")).ShouldBe(["Tablet loose"]);
            Titles(await NotesAsync(admin, u.N1, $"&folderId={Int(parent, "noteFolderId")}&q=Tablet")).ShouldBe(["Tablet in child", "Tablet in parent"]);
            Titles(await NotesAsync(admin, u.N1, $"&folderId={Int(child, "noteFolderId")}&q=Tablet")).ShouldBe(["Tablet in child"]);
            Titles(await NotesAsync(admin, u.N1, "&q=Tablet")).Length.ShouldBe(3);
            Titles(await NotesAsync(admin, u.N1)).Length.ShouldBe(4);
            (await NotesAsync(admin, u.N1, $"&folderId={Int(empty, "noteFolderId")}")).GetArrayLength().ShouldBe(0);
            (await admin.GetAsync($"/api/v1/notes?matterId={u.N1}&folderId=999999")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await admin.GetAsync($"/api/v1/notes?matterId={u.N1}&folderId={Int(empty, "noteFolderId")}&noFolder=true")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
            (await NotesAsync(admin, u.N1, $"&folderId={Int(parent, "noteFolderId")}")).EnumerateArray().ShouldAllBe(n => n.GetProperty("folderId").GetInt32() == Int(parent, "noteFolderId"));

            // Move: Last Updated and the body do not change; the row version does; a locked note can be moved.
            var noteId = Int(tablet, "noteId");
            var moved = await OkAsync(await admin.PutAsJsonAsync($"/api/v1/notes/{noteId}/folder", new { folderId = Int(empty, "noteFolderId"), rowVersion = Str(tablet, "rowVersion") }));
            moved.GetProperty("folderId").GetInt32().ShouldBe(Int(empty, "noteFolderId"));
            Str(moved, "updatedAtUtc").ShouldBe(Str(tablet, "updatedAtUtc"));
            Str(moved, "bodyHtml").ShouldBe(Str(tablet, "bodyHtml"));
            Str(moved, "rowVersion").ShouldNotBe(Str(tablet, "rowVersion"));
            await ProblemAsync(await admin.PutAsJsonAsync($"/api/v1/notes/{noteId}/folder", new { folderId = (int?)null, rowVersion = Str(tablet, "rowVersion") }), HttpStatusCode.Conflict, "CONCURRENCY_CONFLICT");

            var locked = await OkAsync(await u.PmPrimaryClient.PostAsJsonAsync($"/api/v1/notes/{noteId}/lock", new { rowVersion = Str(moved, "rowVersion") }));
            var lockedMove = await OkAsync(await admin.PutAsJsonAsync($"/api/v1/notes/{noteId}/folder", new { folderId = Int(child, "noteFolderId"), rowVersion = Str(locked, "rowVersion") }));
            lockedMove.GetProperty("isLocked").GetBoolean().ShouldBeTrue();
            lockedMove.GetProperty("folderId").GetInt32().ShouldBe(Int(child, "noteFolderId"));
            var unfiled = await OkAsync(await admin.PutAsJsonAsync($"/api/v1/notes/{noteId}/folder", new { folderId = (int?)null, rowVersion = Str(lockedMove, "rowVersion") }));
            unfiled.GetProperty("folderId").ValueKind.ShouldBe(JsonValueKind.Null);

            // The history says where it went; the same place again writes nothing.
            await OkAsync(await admin.PutAsJsonAsync($"/api/v1/notes/{noteId}/folder", new { folderId = (int?)null, rowVersion = Str(unfiled, "rowVersion") }));
            var history = (await OkAsync(await admin.GetAsync($"/api/v1/notes/{noteId}/history"))).GetProperty("items").EnumerateArray().Where(i => Str(i, "eventType") == "NOTE_MOVED").ToList();
            history.Count.ShouldBe(3);
            history.ShouldContain(i => i.GetProperty("oldValue").GetString() == "Custodians" && i.GetProperty("newValue").GetString() == "Empty");
            history.ShouldContain(i => i.GetProperty("oldValue").GetString() == "Empty" && i.GetProperty("newValue").GetString() == "Custodians > Executive Team");
            history.ShouldContain(i => i.GetProperty("oldValue").GetString() == "Custodians > Executive Team" && i.GetProperty("newValue").GetString() == "No Folder");

            // A folder of another matter is refused, on create and on move.
            var foreign = await NewFolderAsync(admin, u.S1, "Foreign");
            (await admin.PostAsJsonAsync("/api/v1/notes", new { matterId = u.N1, folderId = Int(foreign, "noteFolderId"), bodyHtml = "<p>x</p>" })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
            (await admin.PutAsJsonAsync($"/api/v1/notes/{noteId}/folder", new { folderId = Int(foreign, "noteFolderId"), rowVersion = Str(unfiled, "rowVersion") })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task A_folder_with_contents_is_refused_unless_the_contents_move_up_and_notes_are_never_deleted()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var admin = u.H.Admin;
            var top = await NewFolderAsync(admin, u.N1, "Top");
            var middle = await NewFolderAsync(admin, u.N1, "Middle", Int(top, "noteFolderId"));
            var leaf = await NewFolderAsync(admin, u.N1, "Leaf", Int(middle, "noteFolderId"));
            await NewNoteAsync(admin, u.N1, "In middle one", Int(middle, "noteFolderId"));
            var n2 = await NewNoteAsync(admin, u.N1, "In middle two", Int(middle, "noteFolderId"));
            await OkAsync(await u.PmPrimaryClient.PostAsJsonAsync($"/api/v1/notes/{Int(n2, "noteId")}/lock", new { rowVersion = Str(n2, "rowVersion") })); // a locked note moves too
            var middleNow = Find(await FoldersAsync(admin, u.N1), Int(middle, "noteFolderId"));

            // Plain delete: refused with the counts; nothing changes.
            var refused = await ProblemAsync(
                await admin.DeleteAsync($"/api/v1/note-folders/{Int(middle, "noteFolderId")}?rowVersion={Uri.EscapeDataString(Str(middleNow, "rowVersion"))}"),
                HttpStatusCode.Conflict,
                "FOLDER_NOT_EMPTY");
            refused.GetProperty("meta").GetProperty("noteCount").GetInt32().ShouldBe(2);
            refused.GetProperty("meta").GetProperty("subfolderCount").GetInt32().ShouldBe(1);
            (await FoldersAsync(admin, u.N1)).GetProperty("folders").GetArrayLength().ShouldBe(3);

            // A stale token and a missing token.
            await ProblemAsync(await admin.DeleteAsync($"/api/v1/note-folders/{Int(middle, "noteFolderId")}?rowVersion={Uri.EscapeDataString(Convert.ToBase64String(new byte[8]))}&moveContentsUp=true"), HttpStatusCode.Conflict, "CONCURRENCY_CONFLICT");
            (await admin.DeleteAsync($"/api/v1/note-folders/{Int(middle, "noteFolderId")}?moveContentsUp=true")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

            // Move Contents Up and Delete: notes and the subfolder go to the parent.
            (await admin.DeleteAsync($"/api/v1/note-folders/{Int(middle, "noteFolderId")}?rowVersion={Uri.EscapeDataString(Str(middleNow, "rowVersion"))}&moveContentsUp=true")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
            var after = await FoldersAsync(admin, u.N1);
            after.GetProperty("folders").GetArrayLength().ShouldBe(2);
            Find(after, Int(leaf, "noteFolderId")).GetProperty("parentFolderId").GetInt32().ShouldBe(Int(top, "noteFolderId"));
            Int(Find(after, Int(top, "noteFolderId")), "noteCount").ShouldBe(2);
            after.GetProperty("totalNoteCount").GetInt32().ShouldBe(2);
            var moved = await OkAsync(await admin.GetAsync($"/api/v1/notes/{Int(n2, "noteId")}"));
            moved.GetProperty("folderId").GetInt32().ShouldBe(Int(top, "noteFolderId"));
            moved.GetProperty("isLocked").GetBoolean().ShouldBeTrue();
            (await u.H.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.AuditEvent WHERE EventType = 'NOTE_MOVED'")).ShouldBe(2);
            (await u.H.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.AuditEvent WHERE EventType = 'NOTE_FOLDER_DELETED' AND Summary = N'2 notes and 1 subfolder moved up'")).ShouldBe(1);
            (await u.H.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.AuditEvent WHERE EventType = 'NOTE_FOLDER_CREATED'")).ShouldBe(3);

            // A top-level folder moves its notes to No Folder; an empty folder deletes plainly.
            var topNow = Find(await FoldersAsync(admin, u.N1), Int(top, "noteFolderId"));
            (await admin.DeleteAsync($"/api/v1/note-folders/{Int(top, "noteFolderId")}?rowVersion={Uri.EscapeDataString(Str(topNow, "rowVersion"))}&moveContentsUp=true")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
            var last = await FoldersAsync(admin, u.N1);
            last.GetProperty("noFolderNoteCount").GetInt32().ShouldBe(2);
            var leafNow = Find(last, Int(leaf, "noteFolderId"));
            leafNow.GetProperty("parentFolderId").ValueKind.ShouldBe(JsonValueKind.Null);
            (await admin.DeleteAsync($"/api/v1/note-folders/{Int(leaf, "noteFolderId")}?rowVersion={Uri.EscapeDataString(Str(leafNow, "rowVersion"))}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
            (await FoldersAsync(admin, u.N1)).GetProperty("folders").GetArrayLength().ShouldBe(0);
            (await admin.DeleteAsync($"/api/v1/note-folders/{Int(leaf, "noteFolderId")}?rowVersion={Uri.EscapeDataString(Str(leafNow, "rowVersion"))}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task Move_Contents_Up_refuses_a_name_clash_in_the_parent_and_changes_nothing()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var admin = u.H.Admin;
            var parent = await NewFolderAsync(admin, u.N1, "Parent");
            var middle = await NewFolderAsync(admin, u.N1, "Middle", Int(parent, "noteFolderId"));
            await NewFolderAsync(admin, u.N1, "Volume 002", Int(middle, "noteFolderId"));
            await NewFolderAsync(admin, u.N1, "Volume 002", Int(parent, "noteFolderId"));
            await NewNoteAsync(admin, u.N1, "Stays put", Int(middle, "noteFolderId"));
            var middleNow = Find(await FoldersAsync(admin, u.N1), Int(middle, "noteFolderId"));

            var clash = await ProblemAsync(
                await admin.DeleteAsync($"/api/v1/note-folders/{Int(middle, "noteFolderId")}?rowVersion={Uri.EscapeDataString(Str(middleNow, "rowVersion"))}&moveContentsUp=true"),
                HttpStatusCode.Conflict,
                "FOLDER_NAME_TAKEN");
            clash.GetProperty("detail").GetString()!.ShouldContain("Volume 002");
            var after = await FoldersAsync(admin, u.N1);
            after.GetProperty("folders").GetArrayLength().ShouldBe(4);
            Int(Find(after, Int(middle, "noteFolderId")), "noteCount").ShouldBe(1);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task A_hidden_matter_has_no_folders_and_the_permissions_and_inactive_matter_are_checked()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var admin = u.H.Admin;
            var hidden = await NewFolderAsync(admin, u.S1, "Hidden folder");
            var hiddenNote = await NewNoteAsync(admin, u.S1, "Hidden note");
            var outsider = u.UnrelatedClient;

            // Hidden = 404, identical to a missing record, and nothing changes.
            (await outsider.GetAsync($"/api/v1/matters/{u.S1}/note-folders")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await outsider.PostAsJsonAsync("/api/v1/note-folders", new { matterId = u.S1, name = "Sneaky" })).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await outsider.PutAsJsonAsync($"/api/v1/note-folders/{Int(hidden, "noteFolderId")}", new { name = "Sneaky", rowVersion = Str(hidden, "rowVersion") })).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await MoveFolderAsync(outsider, hidden, null)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await outsider.DeleteAsync($"/api/v1/note-folders/{Int(hidden, "noteFolderId")}?rowVersion={Uri.EscapeDataString(Str(hidden, "rowVersion"))}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await outsider.PutAsJsonAsync($"/api/v1/notes/{Int(hiddenNote, "noteId")}/folder", new { folderId = Int(hidden, "noteFolderId"), rowVersion = Str(hiddenNote, "rowVersion") })).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await outsider.GetAsync($"/api/v1/notes?matterId={u.S1}&folderId={Int(hidden, "noteFolderId")}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await outsider.GetAsync($"/api/v1/matters/999999/note-folders")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await outsider.PostAsJsonAsync("/api/v1/notes", new { matterId = u.N1, folderId = Int(hidden, "noteFolderId"), bodyHtml = "<p>x</p>" })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
            Find(await FoldersAsync(admin, u.S1), Int(hidden, "noteFolderId")).GetProperty("name").GetString().ShouldBe("Hidden folder");
            (await u.PmPrimaryClient.GetAsync($"/api/v1/matters/{u.S1}/note-folders")).StatusCode.ShouldBe(HttpStatusCode.OK); // the manager sees it

            // Permissions: View lists, Edit creates, renames and moves, Delete deletes.
            var reader = await u.H.UserWithAsync(@"KE\notereader", "Matter.View", "MatterNote.View");
            var editor = await u.H.UserWithAsync(@"KE\noteeditor", "Matter.View", "MatterNote.View", "MatterNote.Edit");
            var folder = await NewFolderAsync(admin, u.N1, "Plain");
            (await reader.GetAsync($"/api/v1/matters/{u.N1}/note-folders")).StatusCode.ShouldBe(HttpStatusCode.OK);
            (await reader.PostAsJsonAsync("/api/v1/note-folders", new { matterId = u.N1, name = "No" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await reader.PutAsJsonAsync($"/api/v1/note-folders/{Int(folder, "noteFolderId")}", new { name = "No", rowVersion = Str(folder, "rowVersion") })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            var made = await NewFolderAsync(editor, u.N1, "By editor");
            (await editor.PutAsJsonAsync($"/api/v1/note-folders/{Int(made, "noteFolderId")}", new { name = "Renamed by editor", rowVersion = Str(made, "rowVersion") })).StatusCode.ShouldBe(HttpStatusCode.OK);
            (await editor.DeleteAsync($"/api/v1/note-folders/{Int(made, "noteFolderId")}?rowVersion=x")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

            // An inactive matter takes no new folder (like a new note); rename, move and delete still work.
            var quiet = await u.H.CreateMatterAsync("343", "24"); // N1 has an open task, which blocks deactivating it
            var quietFolder = await NewFolderAsync(admin, quiet, "Before");
            await u.H.SetMatterActiveAsync(quiet, false);
            await ProblemAsync(await admin.PostAsJsonAsync("/api/v1/note-folders", new { matterId = quiet, name = "Late" }), HttpStatusCode.Conflict, "MATTER_INACTIVE");
            (await admin.PutAsJsonAsync($"/api/v1/note-folders/{Int(quietFolder, "noteFolderId")}", new { name = "After", rowVersion = Str(quietFolder, "rowVersion") })).StatusCode.ShouldBe(HttpStatusCode.OK);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task The_database_keeps_folders_and_notes_in_one_matter()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var folder = await NewFolderAsync(u.H.Admin, u.N1, "Mine");
            var note = await NewNoteAsync(u.H.Admin, u.S1, "Other matter");

            // The composite foreign keys refuse what the service would never do.
            var crossNote = await Should.ThrowAsync<Exception>(() => u.H.ScalarAsync($"UPDATE dbo.Note SET FolderId = {Int(folder, "noteFolderId")} WHERE NoteId = {Int(note, "noteId")}; SELECT 1 AS [Value]"));
            crossNote.ToString().ShouldContain("FK_Note_Folder");
            var crossParent = await Should.ThrowAsync<Exception>(() => u.H.ScalarAsync($"INSERT dbo.NoteFolder (MatterId, ParentFolderId, Name) VALUES ({u.S1}, {Int(folder, "noteFolderId")}, N'Child'); SELECT 1 AS [Value]"));
            crossParent.ToString().ShouldContain("FK_NoteFolder_Parent");

            // And it refuses to delete a folder that still holds a note or a subfolder.
            await NewNoteAsync(u.H.Admin, u.N1, "Inside", Int(folder, "noteFolderId"));
            var held = await Should.ThrowAsync<Exception>(() => u.H.ScalarAsync($"DELETE dbo.NoteFolder WHERE NoteFolderId = {Int(folder, "noteFolderId")}; SELECT 1 AS [Value]"));
            held.ToString().ShouldContain("FK_Note_Folder");
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }
}
