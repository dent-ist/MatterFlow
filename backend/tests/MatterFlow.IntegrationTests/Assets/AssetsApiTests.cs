using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using MatterFlow.Assets.Contracts;
using MatterFlow.Identity.Contracts;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

namespace MatterFlow.IntegrationTests.Assets;

/// <summary>
/// Asset Types and Matter-owned Assets (ticket 37) against a real SQL Server through the full HTTP pipeline: one Matter per Asset that
/// never changes, type-specific validation with hidden values dropped, deactivation instead of deletion, readable history,
/// Matter-scoped lookups and permissions.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class AssetsApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;

    public async Task InitializeAsync() => _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private HttpClient As(string user = DatabaseApiFactory.AdminAccount)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", user);
        return client;
    }

    private async Task<HttpClient> UserWithAsync(string user, params string[] permissions)
    {
        var client = As(user);
        (await client.GetAsync("/api/v1/me")).StatusCode.ShouldBe(HttpStatusCode.OK); // JIT-provisions the user
        var roleId = await _factory.CreateRoleAsync("Role " + user, permissions);
        await _factory.GrantRoleAsync(user, roleId);
        return client;
    }

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");

    private static async Task<JsonElement> OkAsync(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(expected, body);
        return JsonDocument.Parse(body).RootElement;
    }

    private static async Task<JsonElement> ProblemAsync(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(status, body);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
        var problem = JsonDocument.Parse(body).RootElement;
        problem.GetProperty("code").GetString().ShouldBe(code);
        return problem;
    }

    private async Task<int> CreateMatterAsync(string clientNumber = "343", string matterNumber = "12")
    {
        var admin = As();
        var existing = await admin.GetAsync($"/api/v1/clients?q={clientNumber}");
        var clients = await OkAsync(existing);
        int clientId;
        if (clients.GetProperty("total").GetInt32() > 0)
        {
            clientId = clients.GetProperty("items")[0].GetProperty("clientId").GetInt32();
        }
        else
        {
            clientId = (await OkAsync(await admin.PostAsJsonAsync("/api/v1/clients", new { clientNumber, name = "Acme Corp" }), HttpStatusCode.Created)).GetProperty("clientId").GetInt32();
        }

        var matter = await OkAsync(await admin.PostAsJsonAsync("/api/v1/matters", new { clientId, matterNumber, name = "Merger Review" }), HttpStatusCode.Created);
        return matter.GetProperty("matterId").GetInt32();
    }

    private async Task<JsonElement> CreateTypeAsync(string name = "Document Set", string? description = null) =>
        await OkAsync(await As().PostAsJsonAsync("/api/v1/asset-types", new { name, description }), HttpStatusCode.Created);

    private static string Field(string key, string control, string extra = "") =>
        $$"""{"key":"{{key}}","label":"{{key.ToUpperInvariant()}}","control":"{{control}}"{{(extra.Length == 0 ? string.Empty : "," + extra)}}}""";

    /// <summary>Publishes a form for the Asset Type through the forms API (new draft, save, publish); returns the published version id.</summary>
    private async Task<int> PublishFormAsync(int assetTypeId, params string[] fields)
    {
        var admin = As();
        var definition = await OkAsync(await admin.GetAsync($"/api/v1/forms/by-owner?ownerKind=AssetType&ownerId={assetTypeId}"));
        var definitionId = definition.GetProperty("formDefinitionId").GetInt32();
        var draft = await OkAsync(await admin.PostAsync($"/api/v1/forms/{definitionId}/versions", Json("{}")), HttpStatusCode.Created);
        var versionId = draft.GetProperty("version").GetProperty("formVersionId").GetInt32();
        await OkAsync(await admin.PutAsync($"/api/v1/forms/{definitionId}/versions/{versionId}", Json($$"""{"fields":[{{string.Join(",", fields)}}]}""")));
        await OkAsync(await admin.PostAsync($"/api/v1/forms/{definitionId}/versions/{versionId}/publish", null));
        return versionId;
    }

    private static readonly string[] DocumentFields =
    [
        Field("format", "SELECT", """ "options":[{"key":"pdf","label":"PDF"},{"key":"docx","label":"Word"}]"""),
        Field("pages", "NUMBER", """ "required":true,"validation":{"min":1,"max":100000},"isFilterable":true"""),
        Field("scanned", "CHECKBOX"),
        Field("ocr_language", "TEXT", """ "showWhen":{"op":"isTrue","field":"scanned"}"""),
        Field("notes", "TEXTAREA"),
    ];

    private async Task<(int MatterId, int TypeId, int VersionId)> SetUpAsync()
    {
        var matterId = await CreateMatterAsync();
        var type = await CreateTypeAsync();
        var typeId = type.GetProperty("assetTypeId").GetInt32();
        var versionId = await PublishFormAsync(typeId, DocumentFields);
        return (matterId, typeId, versionId);
    }

    private async Task<JsonElement> CreateAssetAsync(int matterId, int typeId, string name = "Contract bundle", string? externalReference = null, string? formValues = null)
    {
        var values = formValues is null ? string.Empty : $$""","formValues":{{formValues}}""";
        var body = $$"""{"matterId":{{matterId}},"assetTypeId":{{typeId}},"displayName":"{{name}}","externalReference":{{(externalReference is null ? "null" : $"\"{externalReference}\"")}}{{values}}}""";
        return await OkAsync(await As().PostAsync("/api/v1/assets", Json(body)), HttpStatusCode.Created);
    }

    private async Task<string[]> HistoryAsync(int assetId)
    {
        var page = await OkAsync(await As().GetAsync($"/api/v1/audit/events?objectType=Asset&objectId={assetId}&pageSize=100"));
        return [.. page.GetProperty("items").EnumerateArray().Select(e => $"{e.GetProperty("eventType").GetString()}|{(e.TryGetProperty("fieldKey", out var f) && f.ValueKind == JsonValueKind.String ? f.GetString() : string.Empty)}")];
    }

    // ---- Asset Types

    [Fact]
    public async Task Creating_an_asset_type_creates_its_field_form_and_rejects_duplicate_names()
    {
        var type = await CreateTypeAsync("Data Room", "Virtual data rooms");

        type.GetProperty("name").GetString().ShouldBe("Data Room");
        type.GetProperty("isActive").GetBoolean().ShouldBeTrue();
        type.GetProperty("assetCount").GetInt32().ShouldBe(0);
        type.GetProperty("publishedFormVersionId").ValueKind.ShouldBe(JsonValueKind.Null);
        var id = type.GetProperty("assetTypeId").GetInt32();

        var form = await OkAsync(await As().GetAsync($"/api/v1/forms/by-owner?ownerKind=AssetType&ownerId={id}"));
        form.GetProperty("ownerKind").GetString().ShouldBe("AssetType");

        var duplicate = await ProblemAsync(await As().PostAsJsonAsync("/api/v1/asset-types", new { name = " data room " }), HttpStatusCode.Conflict, "DUPLICATE_NAME");
        duplicate.GetProperty("meta").GetProperty("existingId").GetInt32().ShouldBe(id);
        duplicate.GetProperty("errors").GetProperty("name")[0].GetProperty("code").GetString().ShouldBe("DUPLICATE_NAME");
    }

    [Fact]
    public async Task Asset_type_is_edited_with_a_row_version_and_deactivated_without_deleting_assets()
    {
        var (matterId, typeId, _) = await SetUpAsync();
        var asset = await CreateAssetAsync(matterId, typeId, formValues: """{"pages":12}""");
        var type = await OkAsync(await As().GetAsync($"/api/v1/asset-types/{typeId}"));
        type.GetProperty("assetCount").GetInt32().ShouldBe(1);
        type.GetProperty("publishedFormVersionNo").GetInt32().ShouldBe(1);

        var updated = await OkAsync(await As().PutAsJsonAsync($"/api/v1/asset-types/{typeId}", new
        {
            name = "Document Bundle",
            description = "Sets of documents",
            sortOrder = 5,
            isActive = false,
            rowVersion = type.GetProperty("rowVersion").GetString(),
        }));
        updated.GetProperty("name").GetString().ShouldBe("Document Bundle");
        updated.GetProperty("isActive").GetBoolean().ShouldBeFalse();

        // Stale token.
        await ProblemAsync(
            await As().PutAsJsonAsync($"/api/v1/asset-types/{typeId}", new { name = "X", sortOrder = 1, isActive = true, rowVersion = type.GetProperty("rowVersion").GetString() }),
            HttpStatusCode.Conflict,
            "CONCURRENCY_CONFLICT");

        // The inactive type rejects new assets but the existing one keeps working and reading it.
        await ProblemAsync(
            await As().PostAsync("/api/v1/assets", Json($$"""{"matterId":{{matterId}},"assetTypeId":{{typeId}},"displayName":"Another","formValues":{"pages":3} }""")),
            HttpStatusCode.Conflict,
            "ASSET_TYPE_INACTIVE");
        var read = await OkAsync(await As().GetAsync($"/api/v1/assets/{asset.GetProperty("assetId").GetInt32()}"));
        read.GetProperty("assetTypeIsActive").GetBoolean().ShouldBeFalse();
        read.GetProperty("assetTypeName").GetString().ShouldBe("Document Bundle");
    }

    [Fact]
    public async Task Asset_type_changes_need_AssetType_Manage_and_reads_need_Asset_View()
    {
        var viewer = await UserWithAsync(@"KE\viewer", Permissions.Asset.View);
        (await viewer.GetAsync("/api/v1/asset-types")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await viewer.PostAsJsonAsync("/api/v1/asset-types", new { name = "Nope" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        var manager = await UserWithAsync(@"KE\manager", Permissions.AssetType.Manage, Permissions.Asset.View);
        (await manager.PostAsJsonAsync("/api/v1/asset-types", new { name = "Source System" })).StatusCode.ShouldBe(HttpStatusCode.Created);

        var nobody = await UserWithAsync(@"KE\nobody", Permissions.Matter.View);
        (await nobody.GetAsync("/api/v1/asset-types")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    // ---- creating Assets and type-specific validation

    [Fact]
    public async Task Asset_is_created_in_one_matter_with_values_stored_under_the_published_version()
    {
        var (matterId, typeId, versionId) = await SetUpAsync();

        var asset = await CreateAssetAsync(matterId, typeId, "Contract bundle", "https://dms.example/folders/42", """{"format":"pdf","pages":120,"notes":"first batch"}""");

        asset.GetProperty("matterId").GetInt32().ShouldBe(matterId);
        asset.GetProperty("matterRef").GetString().ShouldBe("00343-00012");
        asset.GetProperty("assetTypeName").GetString().ShouldBe("Document Set");
        asset.GetProperty("displayName").GetString().ShouldBe("Contract bundle");
        asset.GetProperty("externalReference").GetString().ShouldBe("https://dms.example/folders/42");
        asset.GetProperty("isActive").GetBoolean().ShouldBeTrue();
        asset.GetProperty("formVersionId").GetInt32().ShouldBe(versionId);
        asset.GetProperty("publishedFormVersionId").GetInt32().ShouldBe(versionId);
        var values = asset.GetProperty("formValues");
        values.GetProperty("format").GetString().ShouldBe("pdf");
        values.GetProperty("pages").GetDecimal().ShouldBe(120);
        values.GetProperty("notes").GetString().ShouldBe("first batch");
    }

    [Fact]
    public async Task Type_specific_validation_is_enforced_server_side_and_hidden_values_are_dropped()
    {
        var (matterId, typeId, _) = await SetUpAsync();
        var admin = As();

        // Required field missing.
        var missing = await ProblemAsync(
            await admin.PostAsync("/api/v1/assets", Json($$"""{"matterId":{{matterId}},"assetTypeId":{{typeId}},"displayName":"A","formValues":{"format":"pdf"} }""")),
            HttpStatusCode.BadRequest,
            "FORM_VALIDATION_FAILED");
        missing.GetProperty("errors").GetProperty("form:pages")[0].GetProperty("code").GetString().ShouldBe("REQUIRED");

        // Out of range, bad option, unknown field.
        var invalid = await ProblemAsync(
            await admin.PostAsync("/api/v1/assets", Json($$"""{"matterId":{{matterId}},"assetTypeId":{{typeId}},"displayName":"A","formValues":{"pages":0,"format":"rtf","nope":1} }""")),
            HttpStatusCode.BadRequest,
            "FORM_VALIDATION_FAILED");
        invalid.GetProperty("errors").GetProperty("form:pages")[0].GetProperty("code").GetString().ShouldBe("OUT_OF_RANGE");
        invalid.GetProperty("errors").GetProperty("form:format")[0].GetProperty("code").GetString().ShouldBe("OPTION_NOT_ALLOWED");
        invalid.GetProperty("errors").GetProperty("form:nope")[0].GetProperty("code").GetString().ShouldBe("UNKNOWN_FIELD");
        (await _factory.CountAsync<MatterFlow.Assets.Domain.Asset>()).ShouldBe(0);

        // Hidden value (ocr_language needs scanned) is dropped, not stored; the response and the history say so.
        var created = await CreateAssetAsync(matterId, typeId, formValues: """{"pages":5,"scanned":false,"ocr_language":"eng"}""");
        created.GetProperty("formValues").TryGetProperty("ocr_language", out _).ShouldBeFalse();
        created.GetProperty("droppedFields").EnumerateArray().Select(e => e.GetString()).ShouldBe(["ocr_language"]);
        (await HistoryAsync(created.GetProperty("assetId").GetInt32())).ShouldContain("FORM_VALUES_DROPPED|");

        // Shown once scanned is true.
        var scanned = await CreateAssetAsync(matterId, typeId, "Scans", formValues: """{"pages":5,"scanned":true,"ocr_language":"eng"}""");
        scanned.GetProperty("formValues").GetProperty("ocr_language").GetString().ShouldBe("eng");
    }

    [Fact]
    public async Task Matter_must_exist_and_be_active_and_name_is_required()
    {
        var (matterId, typeId, _) = await SetUpAsync();
        var admin = As();

        await ProblemAsync(await admin.PostAsync("/api/v1/assets", Json($$"""{"matterId":9999,"assetTypeId":{{typeId}},"displayName":"A","formValues":{"pages":1} }""")), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await admin.PostAsync("/api/v1/assets", Json($$"""{"matterId":{{matterId}},"assetTypeId":9999,"displayName":"A"}""")), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        (await admin.PostAsync("/api/v1/assets", Json($$"""{"matterId":{{matterId}},"assetTypeId":{{typeId}},"displayName":""}"""))).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await admin.PostAsync("/api/v1/assets", Json($$"""{"matterId":{{matterId}},"assetTypeId":{{typeId}},"displayName":"   ","formValues":{"pages":1} }"""))).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var matter = await OkAsync(await admin.GetAsync($"/api/v1/matters/{matterId}"));
        await OkAsync(await admin.PostAsJsonAsync($"/api/v1/matters/{matterId}/active", new { isActive = false, rowVersion = matter.GetProperty("rowVersion").GetString() }));
        await ProblemAsync(
            await admin.PostAsync("/api/v1/assets", Json($$"""{"matterId":{{matterId}},"assetTypeId":{{typeId}},"displayName":"A","formValues":{"pages":1} }""")),
            HttpStatusCode.Conflict,
            "MATTER_INACTIVE");
    }

    [Fact]
    public async Task A_type_without_a_published_form_accepts_no_values_but_still_creates_assets()
    {
        var matterId = await CreateMatterAsync();
        var typeId = (await CreateTypeAsync("Source System")).GetProperty("assetTypeId").GetInt32();

        var plain = await CreateAssetAsync(matterId, typeId, "Relativity");
        plain.GetProperty("formVersionId").ValueKind.ShouldBe(JsonValueKind.Null);
        plain.GetProperty("formValues").EnumerateObject().ShouldBeEmpty();

        await ProblemAsync(
            await As().PostAsync("/api/v1/assets", Json($$"""{"matterId":{{matterId}},"assetTypeId":{{typeId}},"displayName":"X","formValues":{"a":1} }""")),
            HttpStatusCode.Conflict,
            "FORM_NOT_PUBLISHED");
    }

    // ---- one Matter, forever

    [Fact]
    public async Task An_asset_cannot_move_to_another_matter_through_the_api_or_the_database()
    {
        var (matterId, typeId, _) = await SetUpAsync();
        var otherMatter = await CreateMatterAsync("343", "13");
        var asset = await CreateAssetAsync(matterId, typeId, formValues: """{"pages":2}""");
        var id = asset.GetProperty("assetId").GetInt32();

        var move = await ProblemAsync(
            await As().PutAsync($"/api/v1/assets/{id}", Json($$"""{"matterId":{{otherMatter}},"displayName":"Contract bundle","rowVersion":"{{asset.GetProperty("rowVersion").GetString()}}"}""")),
            HttpStatusCode.Conflict,
            "IMMUTABLE_FIELD");
        move.GetProperty("detail").GetString()!.ShouldContain("cannot move");

        await ProblemAsync(
            await As().PutAsync($"/api/v1/assets/{id}", Json($$"""{"assetTypeId":{{typeId + 1}},"displayName":"Contract bundle","rowVersion":"{{asset.GetProperty("rowVersion").GetString()}}"}""")),
            HttpStatusCode.Conflict,
            "IMMUTABLE_FIELD");

        // Defense in depth: the trigger rejects a direct move and a hard delete.
        var move1 = await Should.ThrowAsync<Exception>(() => _factory.WithDbAsync(db => db.Database.ExecuteSqlAsync($"UPDATE dbo.Asset SET MatterId = {otherMatter} WHERE AssetId = {id}")));
        move1.ToString().ShouldContain("cannot move");
        var delete = await Should.ThrowAsync<Exception>(() => _factory.WithDbAsync(db => db.Database.ExecuteSqlAsync($"DELETE FROM dbo.Asset WHERE AssetId = {id}")));
        delete.ToString().ShouldContain("cannot be deleted");

        var after = await OkAsync(await As().GetAsync($"/api/v1/assets/{id}"));
        after.GetProperty("matterId").GetInt32().ShouldBe(matterId);
    }

    [Fact]
    public async Task There_is_no_delete_endpoint()
    {
        var (matterId, typeId, _) = await SetUpAsync();
        var asset = await CreateAssetAsync(matterId, typeId, formValues: """{"pages":2}""");

        var response = await As().DeleteAsync($"/api/v1/assets/{asset.GetProperty("assetId").GetInt32()}");

        response.StatusCode.ShouldBe(HttpStatusCode.MethodNotAllowed);
    }

    // ---- editing, versions, patch

    [Fact]
    public async Task Edit_patches_values_and_keeps_unchanged_fields_and_a_new_published_version_is_captured_on_save()
    {
        var (matterId, typeId, v1) = await SetUpAsync();
        var asset = await CreateAssetAsync(matterId, typeId, formValues: """{"pages":10,"format":"pdf","notes":"keep"}""");
        var id = asset.GetProperty("assetId").GetInt32();

        // Publish version 2 (adds a field). The asset still reads under version 1.
        var v2 = await PublishFormAsync(typeId, [.. DocumentFields, Field("owner_team", "TEXT")]);
        v2.ShouldNotBe(v1);
        var unchanged = await OkAsync(await As().GetAsync($"/api/v1/assets/{id}"));
        unchanged.GetProperty("formVersionId").GetInt32().ShouldBe(v1);
        unchanged.GetProperty("publishedFormVersionId").GetInt32().ShouldBe(v2);

        // Patch: change pages, clear notes with null, add the new field; format is not sent and stays.
        var edited = await OkAsync(await As().PutAsync(
            $"/api/v1/assets/{id}",
            Json($$"""{"displayName":"Contract bundle 2","description":"updated","formValues":{"pages":11,"notes":null,"owner_team":"M&A"},"rowVersion":"{{unchanged.GetProperty("rowVersion").GetString()}}"}""")));

        edited.GetProperty("displayName").GetString().ShouldBe("Contract bundle 2");
        edited.GetProperty("description").GetString().ShouldBe("updated");
        edited.GetProperty("formVersionId").GetInt32().ShouldBe(v2);
        var values = edited.GetProperty("formValues");
        values.GetProperty("pages").GetDecimal().ShouldBe(11);
        values.GetProperty("format").GetString().ShouldBe("pdf");
        values.GetProperty("owner_team").GetString().ShouldBe("M&A");
        values.TryGetProperty("notes", out _).ShouldBeFalse();

        // Omitting formValues leaves them alone.
        var renamed = await OkAsync(await As().PutAsync(
            $"/api/v1/assets/{id}",
            Json($$"""{"displayName":"Renamed","rowVersion":"{{edited.GetProperty("rowVersion").GetString()}}"}""")));
        renamed.GetProperty("formValues").GetProperty("pages").GetDecimal().ShouldBe(11);

        // Invalid patch value is a form validation error; nothing changes.
        await ProblemAsync(
            await As().PutAsync($"/api/v1/assets/{id}", Json($$"""{"displayName":"Renamed","formValues":{"pages":-5},"rowVersion":"{{renamed.GetProperty("rowVersion").GetString()}}"}""")),
            HttpStatusCode.BadRequest,
            "FORM_VALIDATION_FAILED");
        (await OkAsync(await As().GetAsync($"/api/v1/assets/{id}"))).GetProperty("formValues").GetProperty("pages").GetDecimal().ShouldBe(11);
    }

    [Fact]
    public async Task A_newly_required_field_does_not_block_editing_the_name_of_an_older_asset()
    {
        var (matterId, typeId, _) = await SetUpAsync();
        var asset = await CreateAssetAsync(matterId, typeId, formValues: """{"pages":10}""");
        var id = asset.GetProperty("assetId").GetInt32();
        await PublishFormAsync(typeId, [.. DocumentFields, Field("owner_team", "TEXT", """ "required":true""")]);

        var renamed = await OkAsync(await As().PutAsync(
            $"/api/v1/assets/{id}",
            Json($$"""{"displayName":"Renamed","formValues":{},"rowVersion":"{{asset.GetProperty("rowVersion").GetString()}}"}""")));

        renamed.GetProperty("displayName").GetString().ShouldBe("Renamed");

        // Touching the new required field to an empty value is still reported.
        await ProblemAsync(
            await As().PutAsync($"/api/v1/assets/{id}", Json($$"""{"displayName":"Renamed","formValues":{"owner_team":null},"rowVersion":"{{renamed.GetProperty("rowVersion").GetString()}}"}""")),
            HttpStatusCode.BadRequest,
            "FORM_VALIDATION_FAILED");
    }

    [Fact]
    public async Task An_asset_without_stored_values_is_edited_freely_until_a_value_is_entered_then_all_required_fields_are_named()
    {
        var matterId = await CreateMatterAsync();
        var typeId = (await CreateTypeAsync()).GetProperty("assetTypeId").GetInt32();
        var asset = await CreateAssetAsync(matterId, typeId); // created before the type has any form
        var id = asset.GetProperty("assetId").GetInt32();
        await PublishFormAsync(typeId, DocumentFields);

        var renamed = await OkAsync(await As().PutAsync(
            $"/api/v1/assets/{id}",
            Json($$"""{"displayName":"Renamed","formValues":{},"rowVersion":"{{asset.GetProperty("rowVersion").GetString()}}"}""")));
        renamed.GetProperty("displayName").GetString().ShouldBe("Renamed");

        var problem = await ProblemAsync(
            await As().PutAsync($"/api/v1/assets/{id}", Json($$"""{"displayName":"Renamed","formValues":{"notes":"x"},"rowVersion":"{{renamed.GetProperty("rowVersion").GetString()}}"}""")),
            HttpStatusCode.BadRequest,
            "FORM_VALIDATION_FAILED");
        problem.GetProperty("errors").GetProperty("form:pages")[0].GetProperty("code").GetString().ShouldBe("REQUIRED");
    }

    [Fact]
    public async Task A_number_sent_as_text_is_a_field_error_not_a_silently_dropped_value()
    {
        var (matterId, typeId, _) = await SetUpAsync();
        var problem = await ProblemAsync(
            await As().PostAsync("/api/v1/assets", Json($$"""{"matterId":{{matterId}},"assetTypeId":{{typeId}},"displayName":"A","formValues":{"pages":"12abc"} }""")),
            HttpStatusCode.BadRequest,
            "FORM_VALIDATION_FAILED");
        problem.GetProperty("errors").GetProperty("form:pages")[0].GetProperty("code").GetString().ShouldBe("INVALID_TYPE");
    }

    [Fact]
    public async Task Concurrent_edits_are_detected_with_the_row_version()
    {
        var (matterId, typeId, _) = await SetUpAsync();
        var asset = await CreateAssetAsync(matterId, typeId, formValues: """{"pages":1}""");
        var id = asset.GetProperty("assetId").GetInt32();
        var stale = asset.GetProperty("rowVersion").GetString();

        await OkAsync(await As().PutAsync($"/api/v1/assets/{id}", Json($$"""{"displayName":"First","rowVersion":"{{stale}}"}""")));
        var conflict = await ProblemAsync(await As().PutAsync($"/api/v1/assets/{id}", Json($$"""{"displayName":"Second","rowVersion":"{{stale}}"}""")), HttpStatusCode.Conflict, "CONCURRENCY_CONFLICT");

        conflict.GetProperty("meta").GetProperty("currentRowVersion").GetString().ShouldNotBeNullOrEmpty();
    }

    // ---- deactivation and history

    [Fact]
    public async Task Deactivation_keeps_the_asset_and_its_history_and_blocks_edits_until_reactivated()
    {
        var (matterId, typeId, _) = await SetUpAsync();
        var asset = await CreateAssetAsync(matterId, typeId, formValues: """{"pages":4}""");
        var id = asset.GetProperty("assetId").GetInt32();

        var inactive = await OkAsync(await As().PostAsJsonAsync($"/api/v1/assets/{id}/active", new { isActive = false, rowVersion = asset.GetProperty("rowVersion").GetString() }));
        inactive.GetProperty("isActive").GetBoolean().ShouldBeFalse();

        await ProblemAsync(
            await As().PutAsync($"/api/v1/assets/{id}", Json($$"""{"displayName":"X","rowVersion":"{{inactive.GetProperty("rowVersion").GetString()}}"}""")),
            HttpStatusCode.Conflict,
            "ASSET_INACTIVE");

        // Still listed (filterable), still readable, hidden from the picker.
        (await OkAsync(await As().GetAsync($"/api/v1/assets?matterId={matterId}&isActive=false"))).GetProperty("total").GetInt32().ShouldBe(1);
        (await OkAsync(await As().GetAsync($"/api/v1/assets/lookup?matterId={matterId}"))).GetArrayLength().ShouldBe(0);
        (await OkAsync(await As().GetAsync($"/api/v1/assets/lookup?matterId={matterId}&includeInactive=true"))).GetArrayLength().ShouldBe(1);

        var active = await OkAsync(await As().PostAsJsonAsync($"/api/v1/assets/{id}/active", new { isActive = true, rowVersion = inactive.GetProperty("rowVersion").GetString() }));
        active.GetProperty("isActive").GetBoolean().ShouldBeTrue();
        (await _factory.CountAsync<MatterFlow.Assets.Domain.Asset>()).ShouldBe(1);
    }

    [Fact]
    public async Task History_lists_creation_field_changes_value_changes_and_deactivation_for_the_asset()
    {
        var (matterId, typeId, _) = await SetUpAsync();
        var asset = await CreateAssetAsync(matterId, typeId, "Contract bundle", formValues: """{"pages":4,"format":"pdf"}""");
        var id = asset.GetProperty("assetId").GetInt32();

        var edited = await OkAsync(await As().PutAsync(
            $"/api/v1/assets/{id}",
            Json($$"""{"displayName":"Contract bundle v2","formValues":{"pages":9,"format":null},"rowVersion":"{{asset.GetProperty("rowVersion").GetString()}}"}""")));
        await OkAsync(await As().PostAsJsonAsync($"/api/v1/assets/{id}/active", new { isActive = false, rowVersion = edited.GetProperty("rowVersion").GetString() }));

        var history = await HistoryAsync(id);

        history.ShouldContain("FIELD_CHANGED|DisplayName");
        history.ShouldContain("FIELD_CHANGED|IsActive");
        history.Count(h => h == "FIELD_CHANGED|form:pages").ShouldBe(2); // set on create, changed on edit
        history.ShouldContain("FIELD_CHANGED|form:format");

        var events = await OkAsync(await As().GetAsync($"/api/v1/audit/events?objectType=Asset&objectId={id}&pageSize=100"));
        var pages = events.GetProperty("items").EnumerateArray().Single(e => e.GetProperty("fieldKey").GetString() == "form:pages" && e.GetProperty("oldValue").ValueKind == JsonValueKind.String);
        pages.GetProperty("oldValue").GetString().ShouldBe("4");
        pages.GetProperty("newValue").GetString().ShouldBe("9");
        pages.GetProperty("matterId").GetInt32().ShouldBe(matterId);
    }

    // ---- lists, search and lookups

    [Fact]
    public async Task List_searches_by_name_type_and_external_reference_and_pages_within_a_matter()
    {
        var (matterId, typeId, _) = await SetUpAsync();
        var roomType = (await CreateTypeAsync("Data Room")).GetProperty("assetTypeId").GetInt32();
        var otherMatter = await CreateMatterAsync("343", "13");
        await CreateAssetAsync(matterId, typeId, "Alpha bundle", "https://dms.example/alpha", """{"pages":1}""");
        await CreateAssetAsync(matterId, typeId, "Bravo bundle", null, """{"pages":2}""");
        await CreateAssetAsync(matterId, roomType, "Charlie room", "ds-room-77");
        await CreateAssetAsync(otherMatter, roomType, "Alpha room elsewhere");

        var all = await OkAsync(await As().GetAsync($"/api/v1/assets?matterId={matterId}"));
        all.GetProperty("total").GetInt32().ShouldBe(3);
        all.GetProperty("items").EnumerateArray().Select(a => a.GetProperty("displayName").GetString()).ShouldBe(["Alpha bundle", "Bravo bundle", "Charlie room"]);

        async Task<string[]> Names(string query) =>
            [.. (await OkAsync(await As().GetAsync($"/api/v1/assets?matterId={matterId}&{query}"))).GetProperty("items").EnumerateArray().Select(a => a.GetProperty("displayName").GetString()!)];

        (await Names("q=bravo")).ShouldBe(["Bravo bundle"]);
        (await Names("q=data%20room")).ShouldBe(["Charlie room"]); // by type name
        (await Names("q=ds-room")).ShouldBe(["Charlie room"]); // by external reference
        (await Names("q=dms.example")).ShouldBe(["Alpha bundle"]);
        (await Names($"assetTypeId={typeId}")).ShouldBe(["Alpha bundle", "Bravo bundle"]);
        (await Names("sort=-displayName&pageSize=2")).ShouldBe(["Charlie room", "Bravo bundle"]);
        (await Names("sort=assetType,displayName")).ShouldBe(["Charlie room", "Alpha bundle", "Bravo bundle"]); // Data Room < Document Set

        // Without a matter filter the list is global and carries the Matter reference.
        var global = await OkAsync(await As().GetAsync("/api/v1/assets?q=alpha"));
        global.GetProperty("total").GetInt32().ShouldBe(2);
        global.GetProperty("items").EnumerateArray().Select(a => a.GetProperty("matterRef").GetString()).ShouldBe(["00343-00012", "00343-00013"], ignoreOrder: true);

        await ProblemAsync(await As().GetAsync("/api/v1/assets?bogus=1"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        (await As().GetAsync("/api/v1/assets?pageSize=500")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Lookup_is_matter_scoped_requires_a_matter_and_is_limited()
    {
        var (matterId, typeId, _) = await SetUpAsync();
        var otherMatter = await CreateMatterAsync("343", "13");
        for (var i = 1; i <= 5; i++)
            await CreateAssetAsync(matterId, typeId, $"Set {i}", formValues: """{"pages":1}""");
        await CreateAssetAsync(otherMatter, typeId, "Set elsewhere", formValues: """{"pages":1}""");

        var found = await OkAsync(await As().GetAsync($"/api/v1/assets/lookup?matterId={matterId}&q=set&limit=3"));
        found.GetArrayLength().ShouldBe(3);
        found.EnumerateArray().ShouldAllBe(a => a.GetProperty("matterId").GetInt32() == matterId);
        found[0].GetProperty("assetTypeName").GetString().ShouldBe("Document Set");

        (await As().GetAsync("/api/v1/assets/lookup?q=set")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await OkAsync(await As().GetAsync($"/api/v1/assets/lookup?matterId={otherMatter}"))).GetArrayLength().ShouldBe(1);
    }

    // ---- permissions

    [Fact]
    public async Task Asset_actions_are_gated_by_Asset_View_Create_and_Edit()
    {
        var (matterId, typeId, _) = await SetUpAsync();
        var asset = await CreateAssetAsync(matterId, typeId, formValues: """{"pages":1}""");
        var id = asset.GetProperty("assetId").GetInt32();
        var rv = asset.GetProperty("rowVersion").GetString();
        var createBody = $$"""{"matterId":{{matterId}},"assetTypeId":{{typeId}},"displayName":"New","formValues":{"pages":1} }""";

        var viewer = await UserWithAsync(@"KE\viewer", Permissions.Asset.View);
        (await viewer.GetAsync($"/api/v1/assets/{id}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await viewer.PostAsync("/api/v1/assets", Json(createBody))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await viewer.PutAsync($"/api/v1/assets/{id}", Json($$"""{"displayName":"X","rowVersion":"{{rv}}"}"""))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await viewer.PostAsJsonAsync($"/api/v1/assets/{id}/active", new { isActive = false, rowVersion = rv })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        var creator = await UserWithAsync(@"KE\creator", Permissions.Asset.View, Permissions.Asset.Create);
        (await creator.PostAsync("/api/v1/assets", Json(createBody))).StatusCode.ShouldBe(HttpStatusCode.Created);
        (await creator.PutAsync($"/api/v1/assets/{id}", Json($$"""{"displayName":"X","rowVersion":"{{rv}}"}"""))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        var editor = await UserWithAsync(@"KE\editor", Permissions.Asset.View, Permissions.Asset.Edit);
        (await editor.PutAsync($"/api/v1/assets/{id}", Json($$"""{"displayName":"X","rowVersion":"{{rv}}"}"""))).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await editor.PostAsync("/api/v1/assets", Json(createBody))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        var nobody = await UserWithAsync(@"KE\nobody", Permissions.Matter.View);
        (await nobody.GetAsync($"/api/v1/assets/{id}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await nobody.GetAsync($"/api/v1/assets/lookup?matterId={matterId}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    // ---- contract for the Tasks module

    [Fact]
    public async Task Asset_directory_returns_assets_with_their_matter_for_the_tasks_module()
    {
        var (matterId, typeId, _) = await SetUpAsync();
        var otherMatter = await CreateMatterAsync("343", "13");
        var a = (await CreateAssetAsync(matterId, typeId, "Bravo", formValues: """{"pages":1}""")).GetProperty("assetId").GetInt32();
        var b = (await CreateAssetAsync(matterId, typeId, "Alpha", formValues: """{"pages":1}""")).GetProperty("assetId").GetInt32();
        var c = (await CreateAssetAsync(otherMatter, typeId, "Elsewhere", formValues: """{"pages":1}""")).GetProperty("assetId").GetInt32();
        var rv = (await OkAsync(await As().GetAsync($"/api/v1/assets/{b}"))).GetProperty("rowVersion").GetString();
        await OkAsync(await As().PostAsJsonAsync($"/api/v1/assets/{b}/active", new { isActive = false, rowVersion = rv }));

        await using var scope = _factory.Services.CreateAsyncScope();
        var directory = scope.ServiceProvider.GetRequiredService<IAssetDirectory>();
        var found = await directory.FindAsync(a);
        found.ShouldNotBeNull();
        found.MatterId.ShouldBe(matterId);
        found.AssetTypeName.ShouldBe("Document Set");
        (await directory.FindAsync(99999)).ShouldBeNull();

        (await directory.ListForMatterAsync(matterId)).Select(x => x.DisplayName).ShouldBe(["Bravo"]);
        (await directory.ListForMatterAsync(matterId, includeInactive: true)).Select(x => x.DisplayName).ShouldBe(["Alpha", "Bravo"]);
        (await directory.FindManyAsync([a, b, c, 99999])).Select(x => x.AssetId).ShouldBe([a, b, c], ignoreOrder: true);
        (await directory.FindManyAsync([])).ShouldBeEmpty();
    }
}
