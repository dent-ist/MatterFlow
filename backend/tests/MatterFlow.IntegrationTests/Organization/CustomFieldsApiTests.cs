using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;

namespace MatterFlow.IntegrationTests.Organization;

/// <summary>
/// Custom fields of Clients, Matters and Projects (ticket 59) against a real SQL Server: values are validated under the published form,
/// only changed fields are validated on update (FND-07), hidden values are dropped and reported, changes are audited, and old records stay editable.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class CustomFieldsApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;

    public async Task InitializeAsync() => _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private HttpClient Admin()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);
        return client;
    }

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");

    private static async Task<JsonElement> OkAsync(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(expected, body);
        return JsonDocument.Parse(body).RootElement;
    }

    private static string Field(string key, string control, string extra = "") =>
        $$"""{"key":"{{key}}","label":"{{key.ToUpperInvariant()}}","control":"{{control}}"{{(extra.Length == 0 ? string.Empty : "," + extra)}}}""";

    /// <summary>Publishes the singleton custom-field form of an object kind through the forms API; returns the published version id.</summary>
    private async Task<int> PublishFormAsync(string kind, params string[] fields)
    {
        var admin = Admin();
        var definition = await OkAsync(await admin.PostAsJsonAsync("/api/v1/forms", new { ownerKind = kind }));
        var definitionId = definition.GetProperty("formDefinitionId").GetInt32();
        var draft = await OkAsync(await admin.PostAsync($"/api/v1/forms/{definitionId}/versions", Json("{}")), HttpStatusCode.Created);
        var versionId = draft.GetProperty("version").GetProperty("formVersionId").GetInt32();
        await OkAsync(await admin.PutAsync($"/api/v1/forms/{definitionId}/versions/{versionId}", Json($$"""{"fields":[{{string.Join(",", fields)}}]}""")));
        await OkAsync(await admin.PostAsync($"/api/v1/forms/{definitionId}/versions/{versionId}/publish", null));
        return versionId;
    }

    private async Task<int> CreateClientAsync(string number = "343", string? formValues = null)
    {
        var values = formValues is null ? string.Empty : $$""","formValues":{{formValues}}""";
        var client = await OkAsync(await Admin().PostAsync("/api/v1/clients", Json($$"""{"clientNumber":"{{number}}","name":"Acme"{{values}}}""")), HttpStatusCode.Created);
        return client.GetProperty("clientId").GetInt32();
    }

    private async Task<JsonElement> CreateMatterAsync(int clientId, string number, string? formValues = null, HttpStatusCode expected = HttpStatusCode.Created)
    {
        var values = formValues is null ? string.Empty : $$""","formValues":{{formValues}}""";
        return await OkAsync(await Admin().PostAsync("/api/v1/matters", Json($$"""{"clientId":{{clientId}},"matterNumber":"{{number}}","name":"Merger"{{values}}}""")), expected);
    }

    private async Task<JsonElement> UpdateMatterAsync(JsonElement matter, string? formValues, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var values = formValues is null ? string.Empty : $$""","formValues":{{formValues}}""";
        var id = matter.GetProperty("matterId").GetInt32();
        var rowVersion = matter.GetProperty("rowVersion").GetString();
        return await OkAsync(await Admin().PutAsync($"/api/v1/matters/{id}", Json($$"""{"name":"Merger 2","isSensitive":false,"rowVersion":"{{rowVersion}}"{{values}}}""")), expected);
    }

    [Fact]
    public async Task Required_matter_field_is_enforced_on_create_but_existing_matters_stay_editable()
    {
        var clientId = await CreateClientAsync();
        var old = await CreateMatterAsync(clientId, "1"); // created before the form exists
        old.GetProperty("formValues").EnumerateObject().ShouldBeEmpty();

        var versionId = await PublishFormAsync("Matter", Field("practice_area", "TEXT", """ "required":true,"isFilterable":true"""), Field("notes", "TEXTAREA"));

        // Create enforces the required field server-side.
        var rejected = await CreateMatterAsync(clientId, "2", expected: HttpStatusCode.BadRequest);
        rejected.GetProperty("code").GetString().ShouldBe("FORM_VALIDATION_FAILED");
        rejected.GetProperty("errors").GetProperty("form:practice_area")[0].GetProperty("code").GetString().ShouldBe("REQUIRED");
        (await CreateMatterAsync(clientId, "2", "{}", HttpStatusCode.BadRequest)).GetProperty("code").GetString().ShouldBe("FORM_VALIDATION_FAILED");

        var created = await CreateMatterAsync(clientId, "2", """{"practice_area":"M&A","notes":"x"}""");
        created.GetProperty("publishedFormVersionId").GetInt32().ShouldBe(versionId);
        created.GetProperty("formVersionId").GetInt32().ShouldBe(versionId);
        created.GetProperty("formValues").GetProperty("practice_area").GetString().ShouldBe("M&A");

        // The new matter is readable with its values; lists do not carry them.
        var matterId = created.GetProperty("matterId").GetInt32();
        var read = await OkAsync(await Admin().GetAsync($"/api/v1/matters/{matterId}"));
        read.GetProperty("formValues").GetProperty("notes").GetString().ShouldBe("x");
        var list = await OkAsync(await Admin().GetAsync("/api/v1/matters"));
        list.GetProperty("items")[0].GetProperty("formValues").ValueKind.ShouldBe(JsonValueKind.Null);

        // The existing matter stays editable: ordinary edits, and an edit that only sets an optional field, do not re-validate the new required field.
        var renamed = await UpdateMatterAsync(old, null);
        renamed.GetProperty("name").GetString().ShouldBe("Merger 2");
        var withEmpty = await UpdateMatterAsync(renamed, "{}");
        withEmpty.GetProperty("formValues").EnumerateObject().ShouldBeEmpty();
        var optionalOnly = await UpdateMatterAsync(withEmpty, """{"notes":"later"}""", HttpStatusCode.BadRequest);
        optionalOnly.GetProperty("code").GetString().ShouldBe("FORM_VALIDATION_FAILED"); // entering a value touches the section: required fields must be complete

        // A record whose values are complete can change one of them.
        var edited = await UpdateMatterAsync(read, """{"notes":"changed"}""");
        edited.GetProperty("formValues").GetProperty("practice_area").GetString().ShouldBe("M&A");
        edited.GetProperty("formValues").GetProperty("notes").GetString().ShouldBe("changed");

        // Clearing the required field is a change to it, so it is rejected.
        var cleared = await UpdateMatterAsync(edited, """{"practice_area":null}""", HttpStatusCode.BadRequest);
        cleared.GetProperty("errors").GetProperty("form:practice_area")[0].GetProperty("code").GetString().ShouldBe("REQUIRED");
    }

    [Fact]
    public async Task A_field_made_required_later_never_blocks_an_edit_that_leaves_the_custom_fields_alone()
    {
        var clientId = await CreateClientAsync();
        await PublishFormAsync("Matter", Field("notes", "TEXT"));
        var matter = await CreateMatterAsync(clientId, "1", """{"notes":"a"}""");

        await PublishFormAsync("Matter", Field("notes", "TEXT"), Field("practice_area", "TEXT", """ "required":true"""));

        // No custom values sent, or the same values sent back: the record is edited without validating the new required field.
        var renamed = await UpdateMatterAsync(matter, null);
        var sameValues = await UpdateMatterAsync(renamed, """{"notes":"a"}""");
        sameValues.GetProperty("name").GetString().ShouldBe("Merger 2");

        // Changing a custom value touches the section (decisions addendum P): every required field of it must be satisfied, named per field.
        var touched = await UpdateMatterAsync(sameValues, """{"notes":"b"}""", HttpStatusCode.BadRequest);
        touched.GetProperty("code").GetString().ShouldBe("FORM_VALIDATION_FAILED");
        touched.GetProperty("errors").GetProperty("form:practice_area")[0].GetProperty("code").GetString().ShouldBe("REQUIRED");
        touched.GetProperty("errors").TryGetProperty("form:notes", out _).ShouldBeFalse();

        var complete = await UpdateMatterAsync(sameValues, """{"notes":"b","practice_area":"M&A"}""");
        complete.GetProperty("formValues").GetProperty("practice_area").GetString().ShouldBe("M&A");

        // A new matter must satisfy the new required field.
        (await CreateMatterAsync(clientId, "2", """{"notes":"c"}""", HttpStatusCode.BadRequest)).GetProperty("code").GetString().ShouldBe("FORM_VALIDATION_FAILED");
    }

    [Fact]
    public async Task Values_without_a_published_form_are_refused()
    {
        var clientId = await CreateClientAsync();

        var response = await CreateMatterAsync(clientId, "1", """{"notes":"a"}""", HttpStatusCode.Conflict);
        response.GetProperty("code").GetString().ShouldBe("FORM_NOT_PUBLISHED");

        (await CreateMatterAsync(clientId, "2", """{"notes":null}""")).GetProperty("formVersionId").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task Hidden_values_are_dropped_reported_and_changes_are_audited()
    {
        var clientId = await CreateClientAsync();
        await PublishFormAsync(
            "Matter",
            Field("flagged", "CHECKBOX"),
            Field("reason", "TEXT", """ "showWhen":{"op":"isTrue","field":"flagged"}"""));

        var matter = await CreateMatterAsync(clientId, "1", """{"flagged":false,"reason":"stale"}""");

        matter.GetProperty("droppedFields").EnumerateArray().Select(e => e.GetString()).ShouldBe(["reason"]);
        matter.GetProperty("formValues").TryGetProperty("reason", out _).ShouldBeFalse();

        var matterId = matter.GetProperty("matterId").GetInt32();
        var read = await OkAsync(await Admin().GetAsync($"/api/v1/matters/{matterId}"));
        read.GetProperty("droppedFields").GetArrayLength().ShouldBe(0);

        await UpdateMatterAsync(read, """{"flagged":true,"reason":"because"}""");

        var page = await OkAsync(await Admin().GetAsync($"/api/v1/audit/events?objectType=Matter&objectId={matterId}&pageSize=100"));
        var events = page.GetProperty("items").EnumerateArray()
            .Select(e => $"{e.GetProperty("eventType").GetString()}|{(e.TryGetProperty("fieldKey", out var f) && f.ValueKind == JsonValueKind.String ? f.GetString() : string.Empty)}")
            .ToList();
        events.ShouldContain("FIELD_CHANGED|form:flagged");
        events.ShouldContain("FIELD_CHANGED|form:reason");
        events.ShouldContain("FORM_VALUES_DROPPED|");
    }

    [Fact]
    public async Task Clients_and_projects_have_their_own_forms()
    {
        await PublishFormAsync("Client", Field("segment", "TEXT", """ "required":true"""));
        await PublishFormAsync("Project", Field("budget", "NUMBER", """ "validation":{"min":0}"""));

        var rejected = await OkAsync(await Admin().PostAsync("/api/v1/clients", Json("""{"clientNumber":"1","name":"A"}""")), HttpStatusCode.BadRequest);
        rejected.GetProperty("code").GetString().ShouldBe("FORM_VALIDATION_FAILED");

        var clientId = await CreateClientAsync("1", """{"segment":"Enterprise"}""");
        var client = await OkAsync(await Admin().GetAsync($"/api/v1/clients/{clientId}"));
        client.GetProperty("formValues").GetProperty("segment").GetString().ShouldBe("Enterprise");

        var updated = await OkAsync(await Admin().PutAsync(
            $"/api/v1/clients/{clientId}",
            JsonContent.Create(new { name = "Acme 2", isActive = true, rowVersion = client.GetProperty("rowVersion").GetString(), formValues = new { segment = "SMB" } })));
        updated.GetProperty("formValues").GetProperty("segment").GetString().ShouldBe("SMB");

        var matter = await CreateMatterAsync(clientId, "1");
        var project = await OkAsync(
            await Admin().PostAsync("/api/v1/projects", JsonContent.Create(new { matterId = matter.GetProperty("matterId").GetInt32(), name = "Phase 1", formValues = new { budget = 1500 } })),
            HttpStatusCode.Created);
        project.GetProperty("formValues").GetProperty("budget").GetDecimal().ShouldBe(1500m);

        var bad = await OkAsync(
            await Admin().PostAsync("/api/v1/projects", JsonContent.Create(new { matterId = matter.GetProperty("matterId").GetInt32(), name = "Phase 2", formValues = new { budget = -1 } })),
            HttpStatusCode.BadRequest);
        bad.GetProperty("errors").GetProperty("form:budget")[0].GetProperty("code").GetString().ShouldBe("OUT_OF_RANGE");

        var projectId = project.GetProperty("projectId").GetInt32();
        var saved = await OkAsync(await Admin().PutAsync(
            $"/api/v1/projects/{projectId}",
            JsonContent.Create(new { name = "Phase 1b", rowVersion = project.GetProperty("rowVersion").GetString(), formValues = new { budget = 2000 } })));
        saved.GetProperty("formValues").GetProperty("budget").GetDecimal().ShouldBe(2000m);
    }
}
