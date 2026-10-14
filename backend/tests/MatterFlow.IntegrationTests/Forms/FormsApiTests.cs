using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using MatterFlow.Identity.Contracts;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace MatterFlow.IntegrationTests.Forms;

/// <summary>
/// Ticket #29 acceptance against a real SQL Server through the full HTTP pipeline: draft/publish/retire lifecycle, immutability (service and
/// database), publish validation with the contract's codes, permissions per owner kind, audit, and the diff summary.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class FormsApiTests(SqlServerFixture sql) : IAsyncLifetime
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

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage response) => await response.Content.ReadFromJsonAsync<JsonElement>();

    private static string Field(string key, string control, string extra = "") =>
        $$"""{"key":"{{key}}","label":"{{key.ToUpperInvariant()}}","control":"{{control}}"{{(extra.Length == 0 ? string.Empty : "," + extra)}}}""";

    private static string Body(params string[] fields) => $$"""{"fields":[{{string.Join(",", fields)}}]}""";

    private async Task<int> EnsureAsync(HttpClient client, string kind, int? ownerId)
    {
        var body = ownerId is null ? $$"""{"ownerKind":"{{kind}}"}""" : $$"""{"ownerKind":"{{kind}}","ownerId":{{ownerId}}}""";
        var response = await client.PostAsync("/api/v1/forms", Json(body));
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        return (await ReadAsync(response)).GetProperty("formDefinitionId").GetInt32();
    }

    private async Task<JsonElement> NewDraftAsync(HttpClient client, int definitionId)
    {
        var response = await client.PostAsync($"/api/v1/forms/{definitionId}/versions", Json("{}"));
        response.StatusCode.ShouldBe(HttpStatusCode.Created, await response.Content.ReadAsStringAsync());
        return await ReadAsync(response);
    }

    private static int VersionId(JsonElement detail) => detail.GetProperty("version").GetProperty("formVersionId").GetInt32();

    private static string RowVersion(JsonElement detail) => detail.GetProperty("version").GetProperty("rowVersion").GetString()!;

    private async Task<HttpResponseMessage> SaveAsync(HttpClient client, int definitionId, int versionId, string fieldsJson, string? rowVersion = null)
    {
        var rv = rowVersion is null ? string.Empty : $$""","rowVersion":"{{rowVersion}}" """;
        return await client.PutAsync($"/api/v1/forms/{definitionId}/versions/{versionId}", Json(fieldsJson.TrimEnd('}') + rv + "}"));
    }

    /// <summary>Creates a draft with the fields, saves and publishes it; returns the published version id.</summary>
    private async Task<int> PublishFormAsync(HttpClient client, int definitionId, params string[] fields)
    {
        var draft = await NewDraftAsync(client, definitionId);
        var versionId = VersionId(draft);
        var saved = await SaveAsync(client, definitionId, versionId, Body(fields));
        saved.StatusCode.ShouldBe(HttpStatusCode.OK, await saved.Content.ReadAsStringAsync());
        var published = await client.PostAsync($"/api/v1/forms/{definitionId}/versions/{versionId}/publish", null);
        published.StatusCode.ShouldBe(HttpStatusCode.OK, await published.Content.ReadAsStringAsync());
        return versionId;
    }

    private static string[] ErrorCodes(JsonElement problem) =>
        [.. problem.GetProperty("errors").EnumerateObject().SelectMany(p => p.Value.EnumerateArray().Select(e => e.GetProperty("code").GetString()!))];

    // ---- lifecycle

    [Fact]
    public async Task Ensure_definition_is_idempotent_and_validates_the_owner()
    {
        var client = As();
        var first = await EnsureAsync(client, "TaskType", 5);
        (await EnsureAsync(client, "TaskType", 5)).ShouldBe(first);
        (await EnsureAsync(client, "TaskType", 6)).ShouldNotBe(first);
        var client1 = await EnsureAsync(client, "Client", null);
        (await EnsureAsync(client, "Client", null)).ShouldBe(client1);

        (await client.PostAsync("/api/v1/forms", Json("""{"ownerKind":"TaskType"}"""))).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await client.PostAsync("/api/v1/forms", Json("""{"ownerKind":"Client","ownerId":3}"""))).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var byOwner = await ReadAsync(await client.GetAsync("/api/v1/forms/by-owner?ownerKind=TaskType&ownerId=5"));
        byOwner.GetProperty("formDefinitionId").GetInt32().ShouldBe(first);
        byOwner.GetProperty("ownerKind").GetString().ShouldBe("TaskType");
        byOwner.GetProperty("ownerId").GetInt32().ShouldBe(5);
        (await client.GetAsync("/api/v1/forms/by-owner?ownerKind=TaskType&ownerId=999")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Draft_is_edited_published_and_then_immutable_in_the_service_and_the_database()
    {
        var client = As();
        var definitionId = await EnsureAsync(client, "TaskType", 1);

        var draft = await NewDraftAsync(client, definitionId);
        var versionId = VersionId(draft);
        draft.GetProperty("version").GetProperty("versionNo").GetInt32().ShouldBe(1);
        draft.GetProperty("version").GetProperty("status").GetString().ShouldBe("Draft");

        var saved = await SaveAsync(client, definitionId, versionId, Body(
            Field("requires_ocr", "CHECKBOX", """ "isFilterable":true"""),
            Field("language", "SELECT", """ "options":[{"key":"eng","label":"English"},{"key":"fra","label":"French"}],"showWhen":{"op":"isTrue","field":"requires_ocr"}"""),
            Field("volume", "NUMBER", """ "validation":{"min":0,"max":1000},"defaultValue":10""")));
        saved.StatusCode.ShouldBe(HttpStatusCode.OK, await saved.Content.ReadAsStringAsync());
        var savedBody = await ReadAsync(saved);
        savedBody.GetProperty("fields").GetArrayLength().ShouldBe(3);
        savedBody.GetProperty("fields")[1].GetProperty("options").GetArrayLength().ShouldBe(2);

        var published = await ReadAsync(await client.PostAsync($"/api/v1/forms/{definitionId}/versions/{versionId}/publish", null));
        published.GetProperty("version").GetProperty("status").GetString().ShouldBe("Published");
        published.GetProperty("version").GetProperty("publishedAtUtc").ValueKind.ShouldBe(JsonValueKind.String);

        // Service guard: a published version cannot be edited, discarded or published again.
        var edit = await SaveAsync(client, definitionId, versionId, Body(Field("other", "TEXT")));
        edit.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ReadAsync(edit)).GetProperty("code").GetString().ShouldBe("FORM_VERSION_IMMUTABLE");
        (await client.DeleteAsync($"/api/v1/forms/{definitionId}/versions/{versionId}")).StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await client.PostAsync($"/api/v1/forms/{definitionId}/versions/{versionId}/publish", null)).StatusCode.ShouldBe(HttpStatusCode.Conflict);

        // Database guard: even raw SQL cannot change or delete a published version, its fields or its options.
        await ShouldBeRejectedAsync($"UPDATE dbo.FormField SET Label = N'hacked' WHERE FormVersionId = {versionId}");
        await ShouldBeRejectedAsync($"DELETE FROM dbo.FormFieldOption WHERE FormFieldId IN (SELECT FormFieldId FROM dbo.FormField WHERE FormVersionId = {versionId})");
        await ShouldBeRejectedAsync($"DELETE FROM dbo.FormField WHERE FormVersionId = {versionId} AND ControlType = 'NUMBER'");
        await ShouldBeRejectedAsync($"INSERT INTO dbo.FormField (FormVersionId, FieldKey, Label, ControlType, SortOrder) VALUES ({versionId}, 'extra', N'Extra', 'TEXT', 99)");
        await ShouldBeRejectedAsync($"UPDATE dbo.FormVersion SET Notes = N'edited' WHERE FormVersionId = {versionId}");
        await ShouldBeRejectedAsync($"UPDATE dbo.FormVersion SET Status = 'DRAFT' WHERE FormVersionId = {versionId}");

        // The one allowed change is PUBLISHED -> RETIRED, and retired is final.
        var retireSql = "UPDATE dbo.FormVersion SET Status = 'RETIRED' WHERE FormVersionId = " + versionId;
        await _factory.WithDbAsync(db => db.Database.ExecuteSqlRawAsync(retireSql));
        await ShouldBeRejectedAsync($"UPDATE dbo.FormVersion SET Status = 'PUBLISHED' WHERE FormVersionId = {versionId}");

        // A published version is never deleted (a field-less one has no foreign key to hide behind).
        var emptyDefinition = await EnsureAsync(client, "TaskType", 2);
        var emptyVersion = await PublishFormAsync(client, emptyDefinition);
        await ShouldBeRejectedAsync($"DELETE FROM dbo.FormVersion WHERE FormVersionId = {emptyVersion}");
    }

    private async Task ShouldBeRejectedAsync(string sqlText)
    {
        var ex = await Should.ThrowAsync<Exception>(() => _factory.WithDbAsync(db => db.Database.ExecuteSqlRawAsync(sqlText)));
        ex.ToString().ShouldContain("immutable", Case.Insensitive, sqlText);
    }

    [Fact]
    public async Task Editing_a_published_form_creates_a_new_draft_and_publishing_retires_the_previous_version()
    {
        var client = As();
        // The form definition's owner key is a real foreign key to the Asset Type (script 10).
        await _factory.WithDbAsync(db => db.Database.ExecuteSqlRawAsync("INSERT dbo.AssetType (Name) VALUES (N'Document Set'), (N'Data Room')"));
        var definitionId = await EnsureAsync(client, "AssetType", 2);
        var v1 = await PublishFormAsync(client, definitionId, Field("title", "TEXT"), Field("pages", "NUMBER"));

        // New draft starts as a copy of the published version.
        var draft = await NewDraftAsync(client, definitionId);
        var v2 = VersionId(draft);
        draft.GetProperty("version").GetProperty("versionNo").GetInt32().ShouldBe(2);
        draft.GetProperty("version").GetProperty("clonedFromVersionId").GetInt32().ShouldBe(v1);
        draft.GetProperty("fields").EnumerateArray().Select(f => f.GetProperty("key").GetString()).ShouldBe(["title", "pages"]);

        // Only one draft at a time.
        var second = await client.PostAsync($"/api/v1/forms/{definitionId}/versions", Json("{}"));
        second.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ReadAsync(second)).GetProperty("code").GetString().ShouldBe("FORM_DRAFT_EXISTS");

        // The published version keeps serving while the draft is edited.
        (await SaveAsync(client, definitionId, v2, Body(Field("title", "TEXT"), Field("pages", "NUMBER"), Field("scanned", "CHECKBOX")))).StatusCode.ShouldBe(HttpStatusCode.OK);
        var published = await ReadAsync(await client.GetAsync($"/api/v1/forms/{definitionId}/published"));
        VersionId(published).ShouldBe(v1);
        published.GetProperty("fields").GetArrayLength().ShouldBe(2);

        (await client.PostAsync($"/api/v1/forms/{definitionId}/versions/{v2}/publish", null)).StatusCode.ShouldBe(HttpStatusCode.OK);

        var definition = await ReadAsync(await client.GetAsync($"/api/v1/forms/{definitionId}"));
        definition.GetProperty("publishedVersionId").GetInt32().ShouldBe(v2);
        definition.GetProperty("draftVersionId").ValueKind.ShouldBe(JsonValueKind.Null);
        definition.GetProperty("versions").EnumerateArray().Select(v => v.GetProperty("status").GetString()).ShouldBe(["Published", "Retired"]);

        // The retired version stays readable forever.
        var retired = await ReadAsync(await client.GetAsync($"/api/v1/forms/versions/{v1}/schema"));
        retired.GetProperty("fields").GetArrayLength().ShouldBe(2);

        // Clone any version into a new draft.
        var cloned = await client.PostAsync($"/api/v1/forms/{definitionId}/versions/{v1}/clone", null);
        cloned.StatusCode.ShouldBe(HttpStatusCode.Created);
        var clonedBody = await ReadAsync(cloned);
        clonedBody.GetProperty("version").GetProperty("versionNo").GetInt32().ShouldBe(3);
        clonedBody.GetProperty("version").GetProperty("clonedFromVersionId").GetInt32().ShouldBe(v1);
        clonedBody.GetProperty("fields").GetArrayLength().ShouldBe(2);

        // A draft can be discarded; the version number is simply reused by the next draft.
        (await client.DeleteAsync($"/api/v1/forms/{definitionId}/versions/{VersionId(clonedBody)}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await client.GetAsync($"/api/v1/forms/versions/{VersionId(clonedBody)}/schema")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Retire_leaves_the_form_without_a_published_version()
    {
        var client = As();
        var definitionId = await EnsureAsync(client, "Project", null);
        var v1 = await PublishFormAsync(client, definitionId, Field("matter_code", "TEXT"));

        var retired = await ReadAsync(await client.PostAsync($"/api/v1/forms/{definitionId}/versions/{v1}/retire", null));
        retired.GetProperty("version").GetProperty("status").GetString().ShouldBe("Retired");

        var published = await client.GetAsync($"/api/v1/forms/{definitionId}/published");
        published.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ReadAsync(published)).GetProperty("code").GetString().ShouldBe("FORM_NOT_PUBLISHED");
        (await client.PostAsync($"/api/v1/forms/{definitionId}/versions/{v1}/retire", null)).StatusCode.ShouldBe(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task Stale_row_version_is_a_concurrency_conflict()
    {
        var client = As();
        var definitionId = await EnsureAsync(client, "Matter", null);
        var draft = await NewDraftAsync(client, definitionId);
        var versionId = VersionId(draft);

        var first = await SaveAsync(client, definitionId, versionId, Body(Field("a", "TEXT")), RowVersion(draft));
        first.StatusCode.ShouldBe(HttpStatusCode.OK);

        var stale = await SaveAsync(client, definitionId, versionId, Body(Field("b", "TEXT")), RowVersion(draft));
        stale.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ReadAsync(stale)).GetProperty("code").GetString().ShouldBe("CONCURRENCY_CONFLICT");

        var fresh = await SaveAsync(client, definitionId, versionId, Body(Field("b", "TEXT")), RowVersion(await ReadAsync(first)));
        fresh.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    // ---- validation

    [Fact]
    public async Task Publish_rejects_cyclic_and_dangling_rules_with_the_contract_codes_and_keeps_the_draft()
    {
        var client = As();
        var definitionId = await EnsureAsync(client, "TaskType", 10);
        var draft = await NewDraftAsync(client, definitionId);
        var versionId = VersionId(draft);
        (await SaveAsync(client, definitionId, versionId, Body(
            Field("a", "TEXT", """ "showWhen":{"op":"isNotEmpty","field":"b"}"""),
            Field("b", "TEXT", """ "showWhen":{"op":"isNotEmpty","field":"a"}"""),
            Field("c", "TEXT", """ "showWhen":{"op":"eq","field":"ghost","value":"x"}"""),
            Field("d", "TEXT", """ "showWhen":{"op":"isNotEmpty","field":"d"}"""),
            Field("e", "SELECT")))).StatusCode.ShouldBe(HttpStatusCode.OK);

        var response = await client.PostAsync($"/api/v1/forms/{definitionId}/versions/{versionId}/publish", null);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
        var problem = await ReadAsync(response);
        problem.GetProperty("code").GetString().ShouldBe("PUBLISH_VALIDATION_FAILED");
        ErrorCodes(problem).ShouldBe(["CIRCULAR_DEPENDENCY", "UNKNOWN_FIELD_REFERENCE", "SELF_REFERENCE", "NO_OPTIONS"], ignoreOrder: true);
        problem.GetProperty("errors").GetProperty("form:c")[0].GetProperty("code").GetString().ShouldBe("UNKNOWN_FIELD_REFERENCE");
        problem.GetProperty("errors").GetProperty("form:e")[0].GetProperty("code").GetString().ShouldBe("NO_OPTIONS");

        var after = await ReadAsync(await client.GetAsync($"/api/v1/forms/versions/{versionId}/schema"));
        after.GetProperty("version").GetProperty("status").GetString().ShouldBe("Draft");
    }

    [Fact]
    public async Task Publish_enforces_filterable_limit_default_validity_and_stable_field_types()
    {
        var client = As();
        var definitionId = await EnsureAsync(client, "TaskType", 11);

        var tooMany = await NewDraftAsync(client, definitionId);
        var tooManyId = VersionId(tooMany);
        (await SaveAsync(client, definitionId, tooManyId, Body(
            [.. Enumerable.Range(1, 6).Select(i => Field($"f{i}", "TEXT", """ "isFilterable":true""")),
             Field("note", "HELP_TEXT", """ "isFilterable":true"""),
             Field("qty", "NUMBER", """ "validation":{"max":5},"defaultValue":9""")]))).StatusCode.ShouldBe(HttpStatusCode.OK);
        var rejected = await ReadAsync(await client.PostAsync($"/api/v1/forms/{definitionId}/versions/{tooManyId}/publish", null));
        ErrorCodes(rejected).ShouldBe(["TOO_MANY_FILTERABLE_FIELDS", "INVALID_FILTERABLE_FIELD", "INVALID_DEFAULT"], ignoreOrder: true);

        (await SaveAsync(client, definitionId, tooManyId, Body(Field("qty", "NUMBER", """ "isFilterable":true"""), Field("flag", "CHECKBOX")))).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await client.PostAsync($"/api/v1/forms/{definitionId}/versions/{tooManyId}/publish", null)).StatusCode.ShouldBe(HttpStatusCode.OK);

        // 'qty' is a NUMBER in version 1: it cannot become text later; a different text control family is fine.
        var next = await NewDraftAsync(client, definitionId);
        var nextId = VersionId(next);
        (await SaveAsync(client, definitionId, nextId, Body(Field("qty", "TEXT"), Field("flag", "CHECKBOX")))).StatusCode.ShouldBe(HttpStatusCode.OK);
        var changed = await ReadAsync(await client.PostAsync($"/api/v1/forms/{definitionId}/versions/{nextId}/publish", null));
        ErrorCodes(changed).ShouldBe(["FIELD_TYPE_CHANGED"]);
        changed.GetProperty("errors").GetProperty("form:qty").GetArrayLength().ShouldBe(1);
    }

    [Fact]
    public async Task Draft_save_rejects_malformed_keys_duplicates_and_unknown_controls_with_paths()
    {
        var client = As();
        var definitionId = await EnsureAsync(client, "Client", null);
        var versionId = VersionId(await NewDraftAsync(client, definitionId));

        var response = await SaveAsync(client, definitionId, versionId, Body(
            Field("Bad Key", "TEXT"),
            Field("dup", "TEXT"),
            Field("dup", "TEXT"),
            Field("odd", "WIDGET"),
            Field("pick", "SELECT", """ "options":[{"key":"a","label":"A"},{"key":"a","label":"A again"}],"showWhen":"nope" """)));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        var problem = await ReadAsync(response);
        problem.GetProperty("code").GetString().ShouldBe("VALIDATION_FAILED");
        var errors = problem.GetProperty("errors");
        errors.GetProperty("fields[0].key")[0].GetProperty("code").GetString().ShouldBe("INVALID_FIELD_KEY");
        errors.GetProperty("fields[2].key")[0].GetProperty("code").GetString().ShouldBe("DUPLICATE_FIELD_KEY");
        errors.GetProperty("fields[3].control")[0].GetProperty("code").GetString().ShouldBe("UNKNOWN_CONTROL");
        errors.GetProperty("fields[4].options[1].key")[0].GetProperty("code").GetString().ShouldBe("DUPLICATE_OPTION_KEY");
        errors.GetProperty("fields[4].showWhen")[0].GetProperty("code").GetString().ShouldBe("SCHEMA_VIOLATION");
    }

    [Fact]
    public async Task Diff_summarizes_added_removed_and_changed_fields()
    {
        var client = As();
        var definitionId = await EnsureAsync(client, "TaskType", 12);
        var v1 = await PublishFormAsync(client, definitionId, Field("a", "TEXT"), Field("b", "NUMBER"), Field("c", "CHECKBOX"));

        var draft = await NewDraftAsync(client, definitionId);
        var v2 = VersionId(draft);
        (await SaveAsync(client, definitionId, v2, Body(
            Field("c", "CHECKBOX"),
            Field("a", "TEXT", """ "required":true,"helpText":"hint" """),
            Field("d", "DATE")))).StatusCode.ShouldBe(HttpStatusCode.OK);

        var diff = await ReadAsync(await client.GetAsync($"/api/v1/forms/{definitionId}/versions/{v2}/diff"));

        diff.GetProperty("fromVersionId").GetInt32().ShouldBe(v1);
        diff.GetProperty("toVersionId").GetInt32().ShouldBe(v2);
        diff.GetProperty("added").GetInt32().ShouldBe(1);
        diff.GetProperty("removed").GetInt32().ShouldBe(1);
        diff.GetProperty("changed").GetInt32().ShouldBe(2);
        var changes = diff.GetProperty("changes").EnumerateArray().ToDictionary(c => c.GetProperty("fieldKey").GetString()!);
        changes["a"].GetProperty("details").EnumerateArray().Select(d => d.GetString()).ShouldBe(["helpText", "required", "order"], ignoreOrder: true);
        changes["b"].GetProperty("kind").GetString().ShouldBe("Removed");
        changes["d"].GetProperty("kind").GetString().ShouldBe("Added");
        changes["c"].GetProperty("details").EnumerateArray().Select(d => d.GetString()).ShouldBe(["order"]);
    }

    [Fact]
    public async Task Validate_endpoint_uses_the_evaluator_drops_hidden_values_and_supports_changed_only_validation()
    {
        var client = As();
        var definitionId = await EnsureAsync(client, "Client", null);
        var v1 = await PublishFormAsync(client, definitionId,
            Field("kind", "SELECT", """ "options":[{"key":"person","label":"Person"},{"key":"org","label":"Org"}]"""),
            Field("org_name", "TEXT", """ "required":true,"showWhen":{"op":"eq","field":"kind","value":"org"}"""),
            Field("rating", "NUMBER", """ "validation":{"min":1,"max":5}"""));

        async Task<JsonElement> ValidateAsync(string body)
        {
            var response = await client.PostAsync($"/api/v1/forms/versions/{v1}/validate", Json(body));
            response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
            return await ReadAsync(response);
        }

        var ok = await ValidateAsync("""{"values":{"kind":"person","org_name":"ignored","rating":3}}""");
        ok.GetProperty("isValid").GetBoolean().ShouldBeTrue();
        ok.GetProperty("droppedFields").EnumerateArray().Select(d => d.GetString()).ShouldBe(["org_name"]);
        ok.GetProperty("normalizedValues").EnumerateObject().Select(p => p.Name).ShouldBe(["kind", "rating"]);

        var bad = await ValidateAsync("""{"values":{"kind":"org","rating":9,"mystery":1}}""");
        bad.GetProperty("errors").EnumerateArray().Select(e => $"{e.GetProperty("fieldKey").GetString()}:{e.GetProperty("code").GetString()}")
            .ShouldBe(["org_name:REQUIRED", "rating:OUT_OF_RANGE", "mystery:UNKNOWN_FIELD"], ignoreOrder: true);

        // FND-07: a stored record whose required field is empty can still change an unrelated field.
        var partial = await ValidateAsync("""{"values":{"rating":4},"existingValues":{"kind":"org","rating":2},"validateOnlyChanged":true}""");
        partial.GetProperty("isValid").GetBoolean().ShouldBeTrue();
        var full = await ValidateAsync("""{"values":{"rating":4},"existingValues":{"kind":"org","rating":2},"validateOnlyChanged":false}""");
        full.GetProperty("isValid").GetBoolean().ShouldBeFalse();
    }

    // ---- authorization and audit

    [Fact]
    public async Task Design_operations_require_the_management_permission_of_the_owner_kind()
    {
        var admin = As();
        var taskTypeForm = await EnsureAsync(admin, "TaskType", 20);
        var clientForm = await EnsureAsync(admin, "Client", null);
        var v1 = await PublishFormAsync(admin, taskTypeForm, Field("title", "TEXT"));
        var draftId = VersionId(await NewDraftAsync(admin, clientForm));

        const string viewer = @"KE\viewer";
        const string customFieldManager = @"KE\cfmanager";
        foreach (var user in new[] { viewer, customFieldManager, @"KE\nobody" })
        {
            (await As(user).GetAsync("/api/v1/me")).StatusCode.ShouldBe(HttpStatusCode.OK);
        }

        await _factory.GrantRoleAsync(viewer, await _factory.CreateRoleAsync("Form reader", Permissions.Task.View));
        await _factory.GrantRoleAsync(customFieldManager, await _factory.CreateRoleAsync("Custom field admin", Permissions.Task.View, Permissions.CustomField.Manage));

        // Access Pending: no Task.View at all.
        (await As(@"KE\nobody").GetAsync($"/api/v1/forms/versions/{v1}/schema")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        // A Task.View holder can read a published schema but not design anything.
        var reader = As(viewer);
        (await reader.GetAsync($"/api/v1/forms/versions/{v1}/schema")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await reader.GetAsync($"/api/v1/forms/{taskTypeForm}/published")).StatusCode.ShouldBe(HttpStatusCode.OK);
        var denied = await reader.PostAsync($"/api/v1/forms/{taskTypeForm}/versions", Json("{}"));
        denied.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await ReadAsync(denied)).GetProperty("code").GetString().ShouldBe("PERMISSION_DENIED");
        (await reader.GetAsync($"/api/v1/forms/versions/{draftId}/schema")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await reader.GetAsync($"/api/v1/forms/{taskTypeForm}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await reader.PostAsync("/api/v1/forms", Json("""{"ownerKind":"Matter"}"""))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        // CustomField.Manage covers Client/Matter/Project forms only.
        var customFields = As(customFieldManager);
        (await customFields.GetAsync($"/api/v1/forms/versions/{draftId}/schema")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await SaveAsync(customFields, clientForm, draftId, Body(Field("segment", "TEXT")))).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await customFields.PostAsync($"/api/v1/forms/{clientForm}/versions/{draftId}/publish", null)).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await customFields.PostAsync($"/api/v1/forms/{taskTypeForm}/versions", Json("{}"))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        // Anonymous callers are rejected.
        var anonymous = _factory.CreateClient();
        (await anonymous.GetAsync($"/api/v1/forms/versions/{v1}/schema")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Lifecycle_changes_are_audited()
    {
        var client = As();
        var definitionId = await EnsureAsync(client, "TaskType", 30);
        var v1 = await PublishFormAsync(client, definitionId, Field("title", "TEXT"));
        var v2 = VersionId(await NewDraftAsync(client, definitionId));
        (await client.PostAsync($"/api/v1/forms/{definitionId}/versions/{v2}/publish", null)).StatusCode.ShouldBe(HttpStatusCode.OK);

        var page = await ReadAsync(await client.GetAsync($"/api/v1/audit/events?objectType=FormDefinition&objectId={definitionId}"));
        var events = page.GetProperty("items").EnumerateArray().Select(e => e.GetProperty("eventType").GetString()).ToList();

        events.ShouldBe(
            ["FORM_DEFINITION_CREATED", "FORM_DRAFT_CREATED", "FORM_DRAFT_SAVED", "FORM_PUBLISHED", "FORM_DRAFT_CREATED", "FORM_RETIRED", "FORM_PUBLISHED"]);
        v1.ShouldBeLessThan(v2);
    }
}
