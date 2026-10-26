using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Assets;

/// <summary>Asset disposition (epic #851, issue #865): the transitions, permissions, IsActive in step, audit, the history, the link guard, the list filter and the bulk change.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class AssetDispositionApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private World _w = null!;
    private int _typeId;
    private HttpClient _disposer = null!;
    private HttpClient _editor = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        _w = await _h.CreateWorldAsync();
        var type = await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/asset-types", new { name = "Laptop" }), HttpStatusCode.Created);
        _typeId = type.GetProperty("assetTypeId").GetInt32();
        _disposer = await _h.UserWithAsync(@"ke\disposer", "Asset.View", "Asset.Edit", "Asset.Dispose", "Task.View");
        _editor = await _h.UserWithAsync(@"ke\editor", "Asset.View", "Asset.Edit", "Task.View");
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<JsonElement> CreateAssetAsync(string name)
    {
        var asset = await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/assets", new { matterId = _w.MatterId, assetTypeId = _typeId, displayName = name }), HttpStatusCode.Created);
        return asset;
    }

    private static Task<HttpResponseMessage> ChangeAsync(HttpClient client, JsonElement asset, string code, string? note = null) =>
        client.PutAsJsonAsync($"/api/v1/assets/{asset.GetProperty("assetId").GetInt32()}/disposition", new { dispositionCode = code, note, rowVersion = asset.GetProperty("rowVersion").GetString() });

    /// <summary>A 400 whose body names the field and its own code (the top-level code of a validation problem is VALIDATION_FAILED).</summary>
    private static async Task RejectedAsync(HttpResponseMessage response, string field, string code)
    {
        var problem = await ProblemAsync(response, HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        problem.GetProperty("errors").GetProperty(field)[0].GetProperty("code").GetString().ShouldBe(code);
    }

    private async Task<JsonElement> GetAsync(int id) => await OkAsync(await _h.Admin.GetAsync($"/api/v1/assets/{id}"));

    [Fact]
    public async Task A_new_asset_is_active_and_a_disposer_walks_it_through_the_states_with_IsActive_in_step()
    {
        var asset = await CreateAssetAsync("Laptop 1");
        asset.GetProperty("dispositionCode").GetString().ShouldBe("ACTIVE");
        asset.GetProperty("isActive").GetBoolean().ShouldBeTrue();

        var pending = await OkAsync(await ChangeAsync(_disposer, asset, "PENDING_DISPOSITION", "Matter closed"));
        pending.GetProperty("dispositionCode").GetString().ShouldBe("PENDING_DISPOSITION");
        pending.GetProperty("isActive").GetBoolean().ShouldBeFalse();
        pending.GetProperty("dispositionNote").GetString().ShouldBe("Matter closed");
        pending.GetProperty("dispositionChangedByName").GetString().ShouldNotBeNullOrEmpty();
        pending.GetProperty("dispositionChangedAtUtc").ValueKind.ShouldBe(JsonValueKind.String);

        var inactive = await OkAsync(await ChangeAsync(_editor, pending, "INACTIVE")); // Asset.Edit is enough for Inactive
        inactive.GetProperty("isActive").GetBoolean().ShouldBeFalse();
        var active = await OkAsync(await ChangeAsync(_editor, inactive, "ACTIVE"));
        active.GetProperty("isActive").GetBoolean().ShouldBeTrue();
        active.GetProperty("dispositionNote").ValueKind.ShouldBe(JsonValueKind.Null);

        var disposed = await OkAsync(await ChangeAsync(_disposer, active, "DISPOSED", "Destroyed on 12 Oct"));
        disposed.GetProperty("isActive").GetBoolean().ShouldBeFalse();

        // Disposed is final, except for a correction back to Inactive by a disposer with a note.
        await ProblemAsync(await ChangeAsync(_disposer, disposed, "ACTIVE", "Oops"), HttpStatusCode.Conflict, "DISPOSED_IS_FINAL");
        await ProblemAsync(await ChangeAsync(_disposer, disposed, "PENDING_DISPOSITION", "Oops"), HttpStatusCode.Conflict, "DISPOSED_IS_FINAL");
        await RejectedAsync(await ChangeAsync(_disposer, disposed, "INACTIVE"), "note", "NOTE_REQUIRED");
        (await ChangeAsync(_editor, disposed, "INACTIVE", "Needs a disposer")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        var corrected = await OkAsync(await ChangeAsync(_disposer, disposed, "INACTIVE", "Disposed by mistake"));
        corrected.GetProperty("dispositionCode").GetString().ShouldBe("INACTIVE");
    }

    [Fact]
    public async Task Pending_and_disposed_need_Asset_Dispose_a_note_for_disposed_and_a_known_code()
    {
        var asset = await CreateAssetAsync("Laptop 2");

        (await ChangeAsync(_editor, asset, "PENDING_DISPOSITION")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await ChangeAsync(_editor, asset, "DISPOSED", "Because")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        await RejectedAsync(await ChangeAsync(_disposer, asset, "DISPOSED"), "note", "NOTE_REQUIRED");
        await RejectedAsync(await ChangeAsync(_disposer, asset, "GONE"), "dispositionCode", "INVALID_DISPOSITION");
        await ProblemAsync(await ChangeAsync(_disposer, asset, "INACTIVE", new string('x', 501)), HttpStatusCode.BadRequest, "VALIDATION_FAILED");

        var viewer = await _h.UserWithAsync(@"ke\viewonly", "Asset.View");
        (await ChangeAsync(viewer, asset, "INACTIVE")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await GetAsync(asset.GetProperty("assetId").GetInt32())).GetProperty("dispositionCode").GetString().ShouldBe("ACTIVE");
    }

    [Fact]
    public async Task A_stale_row_version_is_a_conflict_and_the_same_state_changes_nothing()
    {
        var asset = await CreateAssetAsync("Laptop 3");
        var changed = await OkAsync(await ChangeAsync(_disposer, asset, "INACTIVE"));
        await ProblemAsync(await ChangeAsync(_disposer, asset, "ACTIVE"), HttpStatusCode.Conflict, "CONCURRENCY_CONFLICT");

        var same = await OkAsync(await ChangeAsync(_disposer, changed, "INACTIVE"));
        same.GetProperty("rowVersion").GetString().ShouldBe(changed.GetProperty("rowVersion").GetString()); // nothing was written
        (await History(asset.GetProperty("assetId").GetInt32())).Count.ShouldBe(1);
    }

    private async Task<List<JsonElement>> History(int assetId) =>
        [.. (await OkAsync(await _disposer.GetAsync($"/api/v1/assets/{assetId}/disposition-history"))).GetProperty("items").EnumerateArray()];

    [Fact]
    public async Task Every_change_is_audited_with_from_to_and_note_and_the_history_is_readable_without_the_audit_browser()
    {
        var asset = await CreateAssetAsync("Laptop 4");
        var id = asset.GetProperty("assetId").GetInt32();
        var a = await OkAsync(await ChangeAsync(_disposer, asset, "PENDING_DISPOSITION", "Matter closed"));
        await OkAsync(await ChangeAsync(_disposer, a, "DISPOSED", "Shredded"));

        var history = await History(id);
        history.Count.ShouldBe(2);
        history[0].GetProperty("fromCode").GetString().ShouldBe("PENDING_DISPOSITION"); // newest first
        history[0].GetProperty("toCode").GetString().ShouldBe("DISPOSED");
        history[0].GetProperty("note").GetString().ShouldBe("Shredded");
        history[0].GetProperty("actorName").GetString().ShouldNotBeNullOrEmpty();
        history[1].GetProperty("fromCode").GetString().ShouldBe("ACTIVE");

        var events = await _h.AuditAsync("ASSET_DISPOSITION_CHANGED");
        events.Count.ShouldBe(2);
        events.ShouldAllBe(e => e.ObjectType == "Asset" && e.ObjectId == id.ToString() && e.MatterId == _w.MatterId && e.FieldKey == "disposition");

        // The viewer without Audit.View still reads the history; a hidden or unknown asset is a 404.
        var viewer = await _h.UserWithAsync(@"ke\viewer2", "Asset.View");
        (await OkAsync(await viewer.GetAsync($"/api/v1/assets/{id}/disposition-history"))).GetProperty("items").GetArrayLength().ShouldBe(2);
        (await viewer.GetAsync("/api/v1/assets/999999/disposition-history")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        var nobody = await _h.UserWithAsync(@"ke\nobody2", "Task.View");
        (await nobody.GetAsync($"/api/v1/assets/{id}/disposition-history")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Open_linked_tasks_do_not_block_a_disposal_they_raise_the_inactiveLinked_flag_and_only_active_assets_can_be_linked()
    {
        var asset = await CreateAssetAsync("Laptop 5");
        var id = asset.GetProperty("assetId").GetInt32();
        var task = await _h.CreateTaskAsync(_w, ordered: false);
        await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/assets", new { assetId = id }), HttpStatusCode.Created);

        var detail = await GetAsync(id);
        detail.GetProperty("openLinkedTaskCount").GetInt32().ShouldBe(1);
        detail.GetProperty("inactiveLinked").GetBoolean().ShouldBeFalse();

        var disposed = await OkAsync(await ChangeAsync(_disposer, asset, "DISPOSED", "Done with the hardware")); // allowed: a warning, not a rule
        disposed.GetProperty("openLinkedTaskCount").GetInt32().ShouldBe(1);
        disposed.GetProperty("inactiveLinked").GetBoolean().ShouldBeTrue();

        var list = await OkAsync(await _h.Admin.GetAsync($"/api/v1/assets?matterId={_w.MatterId}"));
        list.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("assetId").GetInt32() == id).GetProperty("inactiveLinked").GetBoolean().ShouldBeTrue();

        var other = await CreateAssetAsync("Laptop 6");
        var otherId = other.GetProperty("assetId").GetInt32();
        await OkAsync(await ChangeAsync(_disposer, other, "PENDING_DISPOSITION"));
        var second = await _h.CreateTaskAsync(_w, ordered: false);
        await ProblemAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(second)}/assets", new { assetId = otherId }), HttpStatusCode.Conflict, "ASSET_INACTIVE");
    }

    [Fact]
    public async Task The_set_inactive_endpoint_maps_to_inactive_and_active_and_leaves_pending_and_disposed_alone()
    {
        var asset = await CreateAssetAsync("Laptop 7");
        var id = asset.GetProperty("assetId").GetInt32();
        var off = await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/assets/{id}/active", new { isActive = false, rowVersion = asset.GetProperty("rowVersion").GetString() }));
        off.GetProperty("dispositionCode").GetString().ShouldBe("INACTIVE");
        off.GetProperty("isActive").GetBoolean().ShouldBeFalse();

        var pending = await OkAsync(await ChangeAsync(_disposer, off, "PENDING_DISPOSITION"));
        var still = await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/assets/{id}/active", new { isActive = false, rowVersion = pending.GetProperty("rowVersion").GetString() }));
        still.GetProperty("dispositionCode").GetString().ShouldBe("PENDING_DISPOSITION"); // already not active: nothing to do

        var on = await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/assets/{id}/active", new { isActive = true, rowVersion = still.GetProperty("rowVersion").GetString() }));
        on.GetProperty("dispositionCode").GetString().ShouldBe("ACTIVE");
        on.GetProperty("isActive").GetBoolean().ShouldBeTrue();
    }

    [Fact]
    public async Task The_list_filters_by_disposition_and_rejects_an_unknown_code()
    {
        var a = await CreateAssetAsync("List A");
        var b = await CreateAssetAsync("List B");
        await CreateAssetAsync("List C");
        await OkAsync(await ChangeAsync(_disposer, a, "PENDING_DISPOSITION"));
        await OkAsync(await ChangeAsync(_disposer, b, "DISPOSED", "Gone"));

        async Task<string[]> Names(string query) =>
            [.. (await OkAsync(await _h.Admin.GetAsync($"/api/v1/assets?matterId={_w.MatterId}&{query}"))).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("displayName").GetString()!).Order()];

        (await Names("disposition=PENDING_DISPOSITION")).ShouldBe(["List A"]);
        (await Names("disposition=PENDING_DISPOSITION&disposition=DISPOSED")).ShouldBe(["List A", "List B"]);
        (await Names("disposition=ACTIVE")).ShouldBe(["List C"]);
        (await Names("disposition=pending_disposition")).ShouldBe(["List A"]);
        (await _h.Admin.GetAsync("/api/v1/assets?disposition=GONE")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Bulk_change_reports_every_asset_applies_each_on_its_own_and_checks_the_request_first()
    {
        var a = (await CreateAssetAsync("Bulk A")).GetProperty("assetId").GetInt32();
        var b = (await CreateAssetAsync("Bulk B")).GetProperty("assetId").GetInt32();
        var c = await CreateAssetAsync("Bulk C");
        var cId = c.GetProperty("assetId").GetInt32();
        await OkAsync(await ChangeAsync(_disposer, c, "DISPOSED", "Already gone"));

        var result = await OkAsync(await _disposer.PostAsJsonAsync("/api/v1/assets/disposition", new { assetIds = new[] { a, b, cId, 999999 }, dispositionCode = "PENDING_DISPOSITION", note = "Matter closed" }));
        result.GetProperty("changed").GetInt32().ShouldBe(2);
        result.GetProperty("failed").GetInt32().ShouldBe(2);
        result.GetProperty("unchanged").GetInt32().ShouldBe(0);
        result.GetProperty("correlationId").GetString().ShouldNotBeNullOrEmpty();
        var byId = result.GetProperty("results").EnumerateArray().ToDictionary(r => r.GetProperty("assetId").GetInt32());
        byId[a].GetProperty("ok").GetBoolean().ShouldBeTrue();
        byId[cId].GetProperty("code").GetString().ShouldBe("DISPOSED_IS_FINAL");
        byId[999999].GetProperty("code").GetString().ShouldBe("NOT_FOUND");
        (await GetAsync(a)).GetProperty("dispositionCode").GetString().ShouldBe("PENDING_DISPOSITION");
        (await GetAsync(cId)).GetProperty("dispositionCode").GetString().ShouldBe("DISPOSED");

        var again = await OkAsync(await _disposer.PostAsJsonAsync("/api/v1/assets/disposition", new { assetIds = new[] { a }, dispositionCode = "PENDING_DISPOSITION" }));
        again.GetProperty("unchanged").GetInt32().ShouldBe(1);
        again.GetProperty("changed").GetInt32().ShouldBe(0);

        // The whole request is refused before anything changes.
        (await _editor.PostAsJsonAsync("/api/v1/assets/disposition", new { assetIds = new[] { b }, dispositionCode = "DISPOSED", note = "x" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        await RejectedAsync(await _disposer.PostAsJsonAsync("/api/v1/assets/disposition", new { assetIds = new[] { b }, dispositionCode = "DISPOSED" }), "note", "NOTE_REQUIRED");
        await ProblemAsync(await _disposer.PostAsJsonAsync("/api/v1/assets/disposition", new { assetIds = Array.Empty<int>(), dispositionCode = "INACTIVE" }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await _disposer.PostAsJsonAsync("/api/v1/assets/disposition", new { assetIds = new[] { b, b }, dispositionCode = "INACTIVE" }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        (await GetAsync(b)).GetProperty("dispositionCode").GetString().ShouldBe("PENDING_DISPOSITION"); // the refused requests changed nothing
    }
}
