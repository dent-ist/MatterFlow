using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using LptHub.IntegrationTests.Fixtures;
using Shouldly;
using static LptHub.IntegrationTests.Tasks.TaskHarness;

namespace LptHub.IntegrationTests.Organization;

/// <summary>Matter fields epic #1298 / #1300: the three admin lists, Matter Type / Current State / DMS and DFS paths on the matter, the Team, the list filters and the audit.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class MatterFieldsApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private Tasks.TaskHarness _h = null!;
    private World _w = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new Tasks.TaskHarness(_factory);
        _w = await _h.CreateWorldAsync();
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private HttpClient Admin => _h.Admin;

    private static int Id(JsonElement e) => e.GetProperty("id").GetInt32();

    private static string[] Names(JsonElement list) => [.. list.EnumerateArray().Select(i => i.GetProperty("name").GetString()!)];

    private async Task<JsonElement> MatterAsync(int? id = null) =>
        await OkAsync(await Admin.GetAsync($"/api/v1/matters/{id ?? _w.MatterId}"));

    private async Task<int> ItemIdAsync(string route, string name) =>
        Id((await OkAsync(await Admin.GetAsync($"/api/v1/{route}"))).EnumerateArray().First(i => i.GetProperty("name").GetString() == name));

    private async Task<HttpResponseMessage> UpdateAsync(JsonElement matter, object fields)
    {
        var body = new Dictionary<string, object?>
        {
            ["name"] = matter.GetProperty("name").GetString(),
            ["isSensitive"] = matter.GetProperty("isSensitive").GetBoolean(),
            ["rowVersion"] = matter.GetProperty("rowVersion").GetString(),
        };
        foreach (var p in fields.GetType().GetProperties())
            body[p.Name] = p.GetValue(fields);
        return await Admin.PutAsJsonAsync($"/api/v1/matters/{matter.GetProperty("matterId").GetInt32()}", body);
    }

    private async Task<JsonElement[]> MatterEventsAsync(int matterId, string eventType)
    {
        var page = await OkAsync(await Admin.GetAsync($"/api/v1/audit/events?objectType=Matter&objectId={matterId}&pageSize=100"));
        return [.. page.GetProperty("items").EnumerateArray().Where(e => e.GetProperty("eventType").GetString() == eventType)];
    }

    private async Task<JsonElement> ProblemAsync(HttpResponseMessage response, HttpStatusCode expected, string code)
    {
        var json = await OkAsync(response, expected);
        json.GetProperty("code").GetString().ShouldBe(code);
        return json;
    }

    [Fact]
    public async Task The_three_lists_are_seeded_in_order_and_readable_with_Matter_View_but_managed_only_with_MatterList_Manage()
    {
        Names(await OkAsync(await Admin.GetAsync("/api/v1/current-states"))).ShouldBe(["Startup", "Start of Discovery", "Review", "Production", "Closed-out"]);
        Names(await OkAsync(await Admin.GetAsync("/api/v1/team-titles"))).ShouldContain("Attorney");
        Names(await OkAsync(await Admin.GetAsync("/api/v1/matter-types"))).ShouldNotBeEmpty();

        var viewer = await _h.UserWithAsync(@"KE\mviewer", "Matter.View");
        (await viewer.GetAsync("/api/v1/matter-types")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await viewer.PostAsJsonAsync("/api/v1/matter-types", new { name = "Nope" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        var nobody = await _h.UserWithAsync(@"KE\mnobody", "Task.View");
        (await nobody.GetAsync("/api/v1/current-states")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task A_list_item_can_be_added_renamed_deactivated_reordered_and_deleted_only_while_nobody_uses_it()
    {
        var manager = await _h.UserWithAsync(@"KE\mlists", "MatterList.Manage");
        var created = await OkAsync(await manager.PostAsJsonAsync("/api/v1/matter-types", new { name = "Trial prep" }), HttpStatusCode.Created);
        created.GetProperty("inUseCount").GetInt32().ShouldBe(0);
        await ProblemAsync(await manager.PostAsJsonAsync("/api/v1/matter-types", new { name = "trial prep" }), HttpStatusCode.Conflict, "DUPLICATE_NAME");

        var renamed = await OkAsync(await manager.PutAsJsonAsync($"/api/v1/matter-types/{Id(created)}", new { name = "Trial preparation", isActive = true, rowVersion = created.GetProperty("rowVersion").GetString() }));
        renamed.GetProperty("name").GetString().ShouldBe("Trial preparation");

        // Use it on a matter: the In Use count shows it and deleting is refused.
        var matter = await MatterAsync();
        await OkAsync(await UpdateAsync(matter, new { matterTypeIds = new[] { Id(created) } }));
        var list = await OkAsync(await manager.GetAsync("/api/v1/matter-types"));
        list.EnumerateArray().First(i => Id(i) == Id(created)).GetProperty("inUseCount").GetInt32().ShouldBe(1);
        await ProblemAsync(await manager.DeleteAsync($"/api/v1/matter-types/{Id(created)}"), HttpStatusCode.Conflict, "IN_USE");

        // Deactivate: the matter keeps showing it, new choices are refused.
        var current = await OkAsync(await manager.GetAsync("/api/v1/matter-types"));
        var row = current.EnumerateArray().First(i => Id(i) == Id(created));
        await OkAsync(await manager.PutAsJsonAsync($"/api/v1/matter-types/{Id(created)}", new { name = "Trial preparation", isActive = false, rowVersion = row.GetProperty("rowVersion").GetString() }));
        var shown = await MatterAsync();
        shown.GetProperty("matterTypes")[0].GetProperty("name").GetString().ShouldBe("Trial preparation");
        shown.GetProperty("matterTypes")[0].GetProperty("isActive").GetBoolean().ShouldBeFalse();

        // An unused item is deleted for real; reorder needs every id once.
        var spare = await OkAsync(await manager.PostAsJsonAsync("/api/v1/team-titles", new { name = "Spare" }), HttpStatusCode.Created);
        (await manager.DeleteAsync($"/api/v1/team-titles/{Id(spare)}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        var states = await OkAsync(await manager.GetAsync("/api/v1/current-states"));
        var ids = states.EnumerateArray().Select(Id).Reverse().ToArray();
        Names(await OkAsync(await manager.PutAsJsonAsync("/api/v1/current-states/order", new { ids }))).ShouldBe(["Closed-out", "Production", "Review", "Start of Discovery", "Startup"]);
        (await manager.PutAsJsonAsync("/api/v1/current-states/order", new { ids = ids.Take(2).ToArray() })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Type_state_and_paths_are_optional_saved_trimmed_returned_and_changes_are_audited_with_names()
    {
        var matter = await MatterAsync();
        matter.GetProperty("matterTypes").GetArrayLength().ShouldBe(0);
        matter.GetProperty("currentState").ValueKind.ShouldBe(JsonValueKind.Null);
        matter.GetProperty("dmsPath").ValueKind.ShouldBe(JsonValueKind.Null);

        var type = await ItemIdAsync("matter-types", (Names(await OkAsync(await Admin.GetAsync("/api/v1/matter-types")))[0]));
        var startup = await ItemIdAsync("current-states", "Startup");
        var discovery = await ItemIdAsync("current-states", "Start of Discovery");
        var saved = await OkAsync(await UpdateAsync(matter, new { matterTypeIds = new[] { type }, currentStateId = startup, dmsPath = @"  \\fs01\dms\1234\0056  ", dfsPath = "https://dfs.example.com/m/1" }));
        saved.GetProperty("currentState").GetProperty("name").GetString().ShouldBe("Startup");
        saved.GetProperty("dmsPath").GetString().ShouldBe(@"\\fs01\dms\1234\0056");
        saved.GetProperty("dfsPath").GetString().ShouldBe("https://dfs.example.com/m/1");

        var changed = await OkAsync(await UpdateAsync(saved, new { matterTypeIds = new[] { type }, currentStateId = discovery, dmsPath = @"\\fs01\dms\1234\0056", dfsPath = "https://dfs.example.com/m/1" }));
        changed.GetProperty("currentState").GetProperty("name").GetString().ShouldBe("Start of Discovery");

        var states = await MatterEventsAsync(_w.MatterId, "MATTER_STATE_CHANGED");
        states.Length.ShouldBe(2);
        states.Select(e => e.GetProperty("summary").GetString()).ShouldBe(["Current State changed from Startup to Start of Discovery.", "Current State set to Startup."], ignoreOrder: true);
        (await MatterEventsAsync(_w.MatterId, "MATTER_TYPE_CHANGED")).Length.ShouldBe(1);

        // Clearing: null removes the values (full values, not a patch).
        var cleared = await OkAsync(await UpdateAsync(changed, new { }));
        cleared.GetProperty("matterTypes").GetArrayLength().ShouldBe(0);
        cleared.GetProperty("currentState").ValueKind.ShouldBe(JsonValueKind.Null);
        cleared.GetProperty("dmsPath").ValueKind.ShouldBe(JsonValueKind.Null);
        (await MatterEventsAsync(_w.MatterId, "MATTER_STATE_CHANGED")).Select(e => e.GetProperty("summary").GetString()).ShouldContain("Current State cleared (was Start of Discovery).");

        // Path edits are field changes in the audit log.
        var page = await OkAsync(await Admin.GetAsync($"/api/v1/audit/events?objectType=Matter&objectId={_w.MatterId}&pageSize=100"));
        page.GetProperty("items").EnumerateArray().Any(e => e.GetProperty("fieldKey").GetString() == "DmsPath").ShouldBeTrue();
    }

    [Fact]
    public async Task A_matter_can_carry_several_Matter_Types_shown_in_list_order_saved_as_a_full_set_and_audited_with_the_names()
    {
        var types = Names(await OkAsync(await Admin.GetAsync("/api/v1/matter-types")));
        var first = await ItemIdAsync("matter-types", types[0]);
        var second = await ItemIdAsync("matter-types", types[1]);
        var third = await ItemIdAsync("matter-types", types[2]);

        // The ids may be sent in any order and repeated; the answer lists them in the order of the Matter Types list.
        var matter = await MatterAsync();
        var saved = await OkAsync(await UpdateAsync(matter, new { matterTypeIds = new[] { third, first, first } }));
        saved.GetProperty("matterTypes").EnumerateArray().Select(t => t.GetProperty("name").GetString()).ShouldBe([types[0], types[2]]);
        (await MatterEventsAsync(_w.MatterId, "MATTER_TYPE_CHANGED")).Single().GetProperty("summary").GetString().ShouldBe($"Matter Types set to {types[0]}, {types[2]}.");

        // Saving the same set again is no change (no new event); adding one and dropping one is a single event with both sets.
        await OkAsync(await UpdateAsync(saved, new { matterTypeIds = new[] { first, third } }));
        (await MatterEventsAsync(_w.MatterId, "MATTER_TYPE_CHANGED")).Length.ShouldBe(1);
        var again = await MatterAsync();
        var changed = await OkAsync(await UpdateAsync(again, new { matterTypeIds = new[] { second, third } }));
        changed.GetProperty("matterTypes").EnumerateArray().Select(t => t.GetProperty("name").GetString()).ShouldBe([types[1], types[2]]);
        (await MatterEventsAsync(_w.MatterId, "MATTER_TYPE_CHANGED")).Select(e => e.GetProperty("summary").GetString())
            .ShouldContain($"Matter Types changed from {types[0]}, {types[2]} to {types[1]}, {types[2]}.");

        // A type-only change still moves the row version, so a stale second editor is refused.
        changed.GetProperty("rowVersion").GetString().ShouldNotBe(again.GetProperty("rowVersion").GetString());
        (await UpdateAsync(again, new { matterTypeIds = new[] { first } })).StatusCode.ShouldBe(HttpStatusCode.Conflict);

        // The In Use count counts matters per type; a used type cannot be deleted.
        var manager = await _h.UserWithAsync(@"KE\mtypes", "MatterList.Manage");
        var list = await OkAsync(await manager.GetAsync("/api/v1/matter-types"));
        list.EnumerateArray().First(i => Id(i) == third).GetProperty("inUseCount").GetInt32().ShouldBe(1);
        list.EnumerateArray().First(i => Id(i) == first).GetProperty("inUseCount").GetInt32().ShouldBe(0);
        await ProblemAsync(await manager.DeleteAsync($"/api/v1/matter-types/{third}"), HttpStatusCode.Conflict, "IN_USE");

        // The list filter matches a matter when ANY of its types is chosen; sorting uses the first type in list order.
        var clientId = matter.GetProperty("clientId").GetInt32();
        var other = await OkAsync(await Admin.PostAsJsonAsync("/api/v1/matters", new { clientId, matterNumber = "910", name = "Single", matterTypeIds = new[] { first } }), HttpStatusCode.Created);
        var idOther = other.GetProperty("matterId").GetInt32();
        int[] Ids(JsonElement page) => [.. page.GetProperty("items").EnumerateArray().Select(m => m.GetProperty("matterId").GetInt32())];
        async Task<int[]> ListAsync(string query) => Ids(await OkAsync(await Admin.GetAsync($"/api/v1/matters?pageSize=100&{query}")));
        (await ListAsync($"matterTypeId={third}")).ShouldBe([_w.MatterId]);
        (await ListAsync($"matterTypeId={second}")).ShouldBe([_w.MatterId]);
        (await ListAsync($"matterTypeId={first}&matterTypeId={third}")).ShouldBe([idOther, _w.MatterId], ignoreOrder: true);
        (await ListAsync($"q={Uri.EscapeDataString(types[2])}")).ShouldContain(_w.MatterId);
        var sorted = await ListAsync($"clientId={clientId}&sort=matterType");
        sorted.ToList().IndexOf(idOther).ShouldBeLessThan(sorted.ToList().IndexOf(_w.MatterId));
        var row = (await OkAsync(await Admin.GetAsync($"/api/v1/matters?q={Uri.EscapeDataString(types[2])}&pageSize=100"))).GetProperty("items").EnumerateArray().First(m => m.GetProperty("matterId").GetInt32() == _w.MatterId);
        row.GetProperty("matterTypes").GetArrayLength().ShouldBe(2);

        // Too many or unknown ids are refused; an empty list clears.
        (await UpdateAsync(await MatterAsync(), new { matterTypeIds = new[] { first, 99999 } })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        var cleared = await OkAsync(await UpdateAsync(await MatterAsync(), new { matterTypeIds = Array.Empty<int>() }));
        cleared.GetProperty("matterTypes").GetArrayLength().ShouldBe(0);
    }

    [Fact]
    public async Task Matter_Category_is_a_managed_list_a_single_optional_choice_on_the_matter_and_changes_are_audited_with_names()
    {
        // The list starts with the starter categories (script 70), is managed with MatterList.Manage and read with Matter.View.
        Names(await OkAsync(await Admin.GetAsync("/api/v1/matter-categories"))).ShouldBe(["Litigation", "Investigation", "Regulatory Inquiry", "Arbitration", "Second Request", "Internal Review", "Other"]);
        var manager = await _h.UserWithAsync(@"KE\mcat", "MatterList.Manage");
        var advisory = await OkAsync(await manager.PostAsJsonAsync("/api/v1/matter-categories", new { name = "Advisory" }), HttpStatusCode.Created);
        var dispute = await OkAsync(await manager.PostAsJsonAsync("/api/v1/matter-categories", new { name = "Dispute" }), HttpStatusCode.Created);
        await ProblemAsync(await manager.PostAsJsonAsync("/api/v1/matter-categories", new { name = "advisory" }), HttpStatusCode.Conflict, "DUPLICATE_NAME");
        var viewer = await _h.UserWithAsync(@"KE\mcatview", "Matter.View");
        (await viewer.GetAsync("/api/v1/matter-categories")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await viewer.PostAsJsonAsync("/api/v1/matter-categories", new { name = "Nope" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        var matter = await MatterAsync();
        matter.GetProperty("matterCategory").ValueKind.ShouldBe(JsonValueKind.Null);
        var saved = await OkAsync(await UpdateAsync(matter, new { matterCategoryId = Id(advisory) }));
        saved.GetProperty("matterCategory").GetProperty("name").GetString().ShouldBe("Advisory");
        var changed = await OkAsync(await UpdateAsync(saved, new { matterCategoryId = Id(dispute) }));
        changed.GetProperty("matterCategory").GetProperty("name").GetString().ShouldBe("Dispute");

        var events = await MatterEventsAsync(_w.MatterId, "MATTER_CATEGORY_CHANGED");
        events.Select(e => e.GetProperty("summary").GetString()).ShouldBe(["Matter Category changed from Advisory to Dispute.", "Matter Category set to Advisory."], ignoreOrder: true);

        // In use: counted, delete refused; deactivated it still shows on the matter but is not accepted for a new choice.
        var list = await OkAsync(await manager.GetAsync("/api/v1/matter-categories"));
        list.EnumerateArray().First(i => Id(i) == Id(dispute)).GetProperty("inUseCount").GetInt32().ShouldBe(1);
        await ProblemAsync(await manager.DeleteAsync($"/api/v1/matter-categories/{Id(dispute)}"), HttpStatusCode.Conflict, "IN_USE");
        (await manager.DeleteAsync($"/api/v1/matter-categories/{Id(advisory)}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        var row = list.EnumerateArray().First(i => Id(i) == Id(dispute));
        await OkAsync(await manager.PutAsJsonAsync($"/api/v1/matter-categories/{Id(dispute)}", new { name = "Dispute", isActive = false, rowVersion = row.GetProperty("rowVersion").GetString() }));
        var shown = await MatterAsync();
        shown.GetProperty("matterCategory").GetProperty("isActive").GetBoolean().ShouldBeFalse();
        var other = await OkAsync(await manager.PostAsJsonAsync("/api/v1/matter-categories", new { name = "Dormant", isActive = false }), HttpStatusCode.Created);
        (await UpdateAsync(shown, new { matterCategoryId = Id(other) })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await UpdateAsync(shown, new { matterCategoryId = 9999 })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        // Created with a category: audited from the start. Clearing is a full value (null).
        var clientId = shown.GetProperty("clientId").GetInt32();
        var active = await OkAsync(await manager.PostAsJsonAsync("/api/v1/matter-categories", new { name = "Regulatory" }), HttpStatusCode.Created);
        var created = await OkAsync(
            await Admin.PostAsJsonAsync("/api/v1/matters", new { clientId, matterNumber = "779", name = "Category matter", matterCategoryId = Id(active) }),
            HttpStatusCode.Created);
        created.GetProperty("matterCategory").GetProperty("name").GetString().ShouldBe("Regulatory");
        (await MatterEventsAsync(created.GetProperty("matterId").GetInt32(), "MATTER_CATEGORY_CHANGED")).Length.ShouldBe(1);
        var cleared = await OkAsync(await UpdateAsync(created, new { }));
        cleared.GetProperty("matterCategory").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task Bad_paths_and_unknown_or_inactive_choices_are_refused_with_stable_codes()
    {
        var matter = await MatterAsync();
        var drive = await ProblemAsync(await UpdateAsync(matter, new { dmsPath = @"C:\Matters\1" }), HttpStatusCode.BadRequest, "INVALID_PATH");
        drive.GetProperty("errors").GetProperty("dmsPath")[0].GetProperty("code").GetString().ShouldBe("PATH_DRIVE_LETTER");
        await ProblemAsync(await UpdateAsync(matter, new { dfsPath = "https://user:pw@host/x" }), HttpStatusCode.BadRequest, "INVALID_PATH");
        await ProblemAsync(await UpdateAsync(matter, new { dfsPath = "ftp://host/x" }), HttpStatusCode.BadRequest, "INVALID_PATH");
        (await UpdateAsync(matter, new { dmsPath = new string('a', 1001) })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await UpdateAsync(matter, new { matterTypeIds = new[] { 9999 } })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var manager = await _h.UserWithAsync(@"KE\mlists2", "MatterList.Manage");
        var state = await ItemIdAsync("current-states", "Review");
        var item = (await OkAsync(await manager.GetAsync("/api/v1/current-states"))).EnumerateArray().First(i => Id(i) == state);
        await OkAsync(await manager.PutAsJsonAsync($"/api/v1/current-states/{state}", new { name = "Review", isActive = false, rowVersion = item.GetProperty("rowVersion").GetString() }));
        var inactive = await OkAsync(await UpdateAsync(matter, new { currentStateId = state }), HttpStatusCode.BadRequest);
        inactive.GetProperty("errors").GetProperty("currentStateId")[0].GetProperty("code").GetString().ShouldBe("INACTIVE");
    }

    [Fact]
    public async Task A_matter_can_be_created_with_the_new_fields_and_the_state_is_audited_from_the_start()
    {
        var clientId = (await OkAsync(await Admin.GetAsync($"/api/v1/matters/{_w.MatterId}"))).GetProperty("clientId").GetInt32();
        var state = await ItemIdAsync("current-states", "Review");
        var created = await OkAsync(
            await Admin.PostAsJsonAsync("/api/v1/matters", new { clientId, matterNumber = "777", name = "Fields matter", currentStateId = state, dmsPath = "https://dms.example.com/777" }),
            HttpStatusCode.Created);
        created.GetProperty("currentState").GetProperty("name").GetString().ShouldBe("Review");
        created.GetProperty("matterTypes").GetArrayLength().ShouldBe(0);
        (await MatterEventsAsync(created.GetProperty("matterId").GetInt32(), "MATTER_STATE_CHANGED")).Length.ShouldBe(1);

        await ProblemAsync(
            await Admin.PostAsJsonAsync("/api/v1/matters", new { clientId, matterNumber = "778", name = "Bad path", dfsPath = @"D:\x" }),
            HttpStatusCode.BadRequest,
            "INVALID_PATH");
    }

    [Fact]
    public async Task Team_members_are_added_edited_sorted_paged_and_removed_with_case_insensitive_duplicate_emails_refused()
    {
        var attorney = await ItemIdAsync("team-titles", "Attorney");
        var paralegal = await ItemIdAsync("team-titles", "Paralegal");
        var url = $"/api/v1/matters/{_w.MatterId}/team";

        var ann = await OkAsync(await Admin.PostAsJsonAsync(url, new { name = "  Ann Lee ", email = " Ann.Lee@Firm.com ", teamTitleId = attorney }), HttpStatusCode.Created);
        ann.GetProperty("name").GetString().ShouldBe("Ann Lee");
        ann.GetProperty("email").GetString().ShouldBe("Ann.Lee@Firm.com");
        ann.GetProperty("title").GetProperty("name").GetString().ShouldBe("Attorney");
        var ben = await OkAsync(await Admin.PostAsJsonAsync(url, new { name = "Ben Ortiz", email = "ben@vendor.example", teamTitleId = paralegal }), HttpStatusCode.Created);

        var dup = await ProblemAsync(await Admin.PostAsJsonAsync(url, new { name = "Other Ann", email = "ANN.LEE@firm.COM", teamTitleId = paralegal }), HttpStatusCode.Conflict, "DUPLICATE_TEAM_EMAIL");
        dup.GetProperty("meta").GetProperty("existingId").GetInt32().ShouldBe(Id(ann));
        await ProblemAsync(await Admin.PostAsJsonAsync(url, new { name = "X", email = "not-an-email", teamTitleId = paralegal }), HttpStatusCode.BadRequest, "INVALID_EMAIL");
        (await Admin.PostAsJsonAsync(url, new { name = "X", email = "x@y.com", teamTitleId = 9999 })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await Admin.PostAsJsonAsync(url, new { name = " ", email = "x@y.com", teamTitleId = paralegal })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        // Editing to its own e-mail (other case) is fine; taking Ben's is a duplicate.
        var edited = await OkAsync(await Admin.PutAsJsonAsync($"{url}/{Id(ann)}", new { name = "Ann Lee", email = "ann.lee@firm.com", teamTitleId = paralegal, rowVersion = ann.GetProperty("rowVersion").GetString() }));
        edited.GetProperty("title").GetProperty("name").GetString().ShouldBe("Paralegal");
        await ProblemAsync(await Admin.PutAsJsonAsync($"{url}/{Id(ann)}", new { name = "Ann Lee", email = "BEN@vendor.example", teamTitleId = paralegal, rowVersion = edited.GetProperty("rowVersion").GetString() }), HttpStatusCode.Conflict, "DUPLICATE_TEAM_EMAIL");
        await ProblemAsync(await Admin.PutAsJsonAsync($"{url}/{Id(ann)}", new { name = "Stale", email = "ann.lee@firm.com", teamTitleId = paralegal, rowVersion = ann.GetProperty("rowVersion").GetString() }), HttpStatusCode.Conflict, "CONCURRENCY_CONFLICT");

        // The same e-mail on another matter is fine (owner decision).
        var other = await OkAsync(
            await Admin.PostAsJsonAsync("/api/v1/matters", new { clientId = (await MatterAsync()).GetProperty("clientId").GetInt32(), matterNumber = "880", name = "Other" }),
            HttpStatusCode.Created);
        (await Admin.PostAsJsonAsync($"/api/v1/matters/{other.GetProperty("matterId").GetInt32()}/team", new { name = "Ann Lee", email = "ann.lee@firm.com", teamTitleId = attorney })).StatusCode.ShouldBe(HttpStatusCode.Created);

        // Sort (name default, title, descending) and paging.
        var byName = await OkAsync(await Admin.GetAsync(url));
        byName.GetProperty("total").GetInt32().ShouldBe(2);
        byName.GetProperty("items").EnumerateArray().Select(m => m.GetProperty("name").GetString()).ShouldBe(["Ann Lee", "Ben Ortiz"]);
        (await OkAsync(await Admin.GetAsync(url + "?sort=-name"))).GetProperty("items")[0].GetProperty("name").GetString().ShouldBe("Ben Ortiz");
        (await OkAsync(await Admin.GetAsync(url + "?sort=-email&pageSize=1&page=2"))).GetProperty("items")[0].GetProperty("name").GetString().ShouldBe("Ann Lee");
        (await Admin.GetAsync(url + "?sort=bogus")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await OkAsync(await Admin.GetAsync($"/api/v1/matters/{_w.MatterId}/summary"))).GetProperty("teamMemberCount").GetInt32().ShouldBe(2);

        // The In Use count of a title counts team rows; remove is a real delete and is idempotent; every change is audited.
        (await OkAsync(await Admin.GetAsync("/api/v1/team-titles"))).EnumerateArray().First(i => Id(i) == paralegal).GetProperty("inUseCount").GetInt32().ShouldBe(2);
        (await Admin.DeleteAsync($"{url}/{Id(ben)}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await Admin.DeleteAsync($"{url}/{Id(ben)}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await OkAsync(await Admin.GetAsync(url))).GetProperty("total").GetInt32().ShouldBe(1);
        (await MatterEventsAsync(_w.MatterId, "MATTER_TEAM_MEMBER_ADDED")).Length.ShouldBe(2);
        (await MatterEventsAsync(_w.MatterId, "MATTER_TEAM_MEMBER_CHANGED")).Length.ShouldBe(1);
        var removed = await MatterEventsAsync(_w.MatterId, "MATTER_TEAM_MEMBER_REMOVED");
        removed.Length.ShouldBe(1);
        removed[0].GetProperty("summary").GetString().ShouldBe("Team member removed: Ben Ortiz.");
    }

    [Fact]
    public async Task Team_changes_need_Matter_Edit_reading_needs_Matter_View_and_the_team_does_not_grant_access()
    {
        var url = $"/api/v1/matters/{_w.MatterId}/team";
        var attorney = await ItemIdAsync("team-titles", "Attorney");
        var viewer = await _h.UserWithAsync(@"KE\tviewer", "Matter.View");
        (await viewer.GetAsync(url)).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await viewer.PostAsJsonAsync(url, new { name = "A", email = "a@b.com", teamTitleId = attorney })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        var nobody = await _h.UserWithAsync(@"KE\tnobody", "Task.View");
        (await nobody.GetAsync(url)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await Admin.GetAsync("/api/v1/matters/999999/team")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task The_matters_list_filters_sorts_and_searches_by_type_and_state_including_Not_Set()
    {
        var clientId = (await MatterAsync()).GetProperty("clientId").GetInt32();
        var types = Names(await OkAsync(await Admin.GetAsync("/api/v1/matter-types")));
        var typeA = await ItemIdAsync("matter-types", types[0]);
        var typeB = await ItemIdAsync("matter-types", types[1]);
        var startup = await ItemIdAsync("current-states", "Startup");
        var review = await ItemIdAsync("current-states", "Review");

        var a = await OkAsync(await Admin.PostAsJsonAsync("/api/v1/matters", new { clientId, matterNumber = "901", name = "Alpha", matterTypeIds = new[] { typeA }, currentStateId = review }), HttpStatusCode.Created);
        var b = await OkAsync(await Admin.PostAsJsonAsync("/api/v1/matters", new { clientId, matterNumber = "902", name = "Beta", matterTypeIds = new[] { typeB }, currentStateId = startup }), HttpStatusCode.Created);
        var c = await OkAsync(await Admin.PostAsJsonAsync("/api/v1/matters", new { clientId, matterNumber = "903", name = "Gamma" }), HttpStatusCode.Created);
        int[] Ids(JsonElement page) => [.. page.GetProperty("items").EnumerateArray().Select(m => m.GetProperty("matterId").GetInt32())];
        var (idA, idB, idC) = (a.GetProperty("matterId").GetInt32(), b.GetProperty("matterId").GetInt32(), c.GetProperty("matterId").GetInt32());

        async Task<int[]> ListAsync(string query) => Ids(await OkAsync(await Admin.GetAsync($"/api/v1/matters?pageSize=100&{query}")));

        (await ListAsync($"matterTypeId={typeA}")).ShouldBe([idA]);
        (await ListAsync($"matterTypeId={typeA}&matterTypeId={typeB}")).ShouldBe([idA, idB], ignoreOrder: true);
        (await ListAsync("matterTypeNone=true")).ShouldContain(idC);
        (await ListAsync("matterTypeNone=true")).ShouldNotContain(idA);
        (await ListAsync($"matterTypeId={typeA}&matterTypeNone=true")).ShouldContain(idA);
        (await ListAsync($"matterTypeId={typeA}&matterTypeNone=true")).ShouldContain(idC);
        (await ListAsync($"matterTypeId={typeA}&matterTypeNone=true")).ShouldNotContain(idB);
        (await ListAsync($"currentStateId={review}")).ShouldBe([idA]);
        (await ListAsync("currentStateNone=true")).ShouldContain(idC);
        (await ListAsync("currentStateNone=true")).ShouldNotContain(idB);
        (await ListAsync($"currentStateId={startup}&currentStateId={review}")).ShouldBe([idA, idB], ignoreOrder: true);

        // Search finds the names of type and state.
        (await ListAsync("q=Start%20of")).ShouldBeEmpty();
        (await ListAsync($"q={Uri.EscapeDataString(types[1])}")).ShouldContain(idB);
        (await ListAsync("q=Review")).ShouldContain(idA);
        (await ListAsync("q=Review")).ShouldNotContain(idB);

        // Sort by the admin's list order of the state (Startup before Review), matters without one last.
        var sorted = await ListAsync($"clientId={clientId}&sort=currentState");
        sorted.ToList().IndexOf(idB).ShouldBeLessThan(sorted.ToList().IndexOf(idA));
        sorted.ToList().IndexOf(idC).ShouldBeGreaterThan(sorted.ToList().IndexOf(idA));
        var desc = await ListAsync($"clientId={clientId}&sort=-matterType");
        desc.ToList().IndexOf(idC).ShouldBeGreaterThan(desc.ToList().IndexOf(idA));

        // The row carries the new fields; an unknown filter name is still a 400.
        var row = (await OkAsync(await Admin.GetAsync($"/api/v1/matters?q=Alpha"))).GetProperty("items")[0];
        row.GetProperty("matterTypes")[0].GetProperty("id").GetInt32().ShouldBe(typeA);
        (await Admin.GetAsync("/api/v1/matters?matterTyp=1")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }
}
