using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Configuration.Domain.Forms;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

namespace MatterFlow.IntegrationTests.Forms;

/// <summary>
/// Stored values keep the form version they were captured under, the typed filter index follows every save, and the reusable validator
/// service (what the Tasks, Assets and Workflow modules call) behaves as the contract says. Real SQL Server.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class FormValueStoreTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private HttpClient _admin = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _admin = _factory.CreateClient();
        _admin.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        _admin.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static Dictionary<string, JsonElement> Values(string json) => JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json)!;

    private async Task<T> InScopeAsync<T>(Func<IServiceProvider, Task<T>> action)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        return await action(scope.ServiceProvider);
    }

    private async Task<(int DefinitionId, int VersionId)> PublishAsync(string kind, int? ownerId, string fieldsJson, int? definitionId = null)
    {
        var body = ownerId is null ? $$"""{"ownerKind":"{{kind}}"}""" : $$"""{"ownerKind":"{{kind}}","ownerId":{{ownerId}}}""";
        var ensure = await _admin.PostAsync("/api/v1/forms", new StringContent(body, Encoding.UTF8, "application/json"));
        var definition = definitionId ?? (await ensure.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("formDefinitionId").GetInt32();
        var draft = await _admin.PostAsync($"/api/v1/forms/{definition}/versions", new StringContent("{}", Encoding.UTF8, "application/json"));
        var versionId = (await draft.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("version").GetProperty("formVersionId").GetInt32();
        var saved = await FormDraftApi.SaveAsync(_admin, definition, versionId, fieldsJson);
        saved.EnsureSuccessStatusCode();
        (await FormDraftApi.PublishAsync(_admin, definition, versionId)).EnsureSuccessStatusCode();
        return (definition, versionId);
    }

    private const string RequestForm = """
        {"fields":[
          {"key":"requires_ocr","label":"Requires OCR","control":"CHECKBOX","isFilterable":true},
          {"key":"ocr_language","label":"Language","control":"SELECT","isFilterable":true,
           "options":[{"key":"eng","label":"English"},{"key":"fra","label":"French"}],
           "showWhen":{"op":"isTrue","field":"requires_ocr"}},
          {"key":"volume","label":"Volume","control":"NUMBER","isFilterable":true,"validation":{"min":0}},
          {"key":"outputs","label":"Outputs","control":"MULTISELECT","isFilterable":true,
           "options":[{"key":"pdf","label":"PDF"},{"key":"tiff","label":"TIFF"}]},
          {"key":"due","label":"Due","control":"DATE","isFilterable":true},
          {"key":"notes","label":"Notes","control":"TEXTAREA"}
        ]}
        """;

    private const string RequestFormV2 = """
        {"fields":[
          {"key":"requires_ocr","label":"Requires OCR","control":"CHECKBOX","isFilterable":true},
          {"key":"ocr_language","label":"Language","control":"SELECT","isFilterable":true,
           "options":[{"key":"eng","label":"English"},{"key":"fra","label":"French"}],
           "showWhen":{"op":"isTrue","field":"requires_ocr"}},
          {"key":"volume","label":"Volume","control":"NUMBER","isFilterable":true,"validation":{"min":0}},
          {"key":"outputs","label":"Outputs","control":"MULTISELECT","isFilterable":true,
           "options":[{"key":"pdf","label":"PDF"},{"key":"tiff","label":"TIFF"}]},
          {"key":"due","label":"Due","control":"DATE","isFilterable":true},
          {"key":"notes","label":"Notes","control":"TEXTAREA"},
          {"key":"reviewer","label":"Reviewer","control":"USER_REF","required":true}
        ]}
        """;

    private Task<List<CustomFieldIndex>> IndexRowsAsync(FormValueOwnerKind kind, long ownerId) =>
        _factory.WithDbAsync(db => db.Set<CustomFieldIndex>().AsNoTracking().Where(i => i.OwnerKind == kind && i.OwnerId == ownerId).OrderBy(i => i.Id).ToListAsync());

    [Fact]
    public async Task GetMany_returns_the_values_of_several_owners_in_one_read_and_only_for_the_asked_definition()
    {
        var (definitionId, versionId) = await PublishAsync("TaskType", 8, RequestForm);
        var (otherDefinitionId, otherVersionId) = await PublishAsync("TaskType", 9, RequestForm);
        var store = new Func<IServiceProvider, IFormValueStore>(sp => sp.GetRequiredService<IFormValueStore>());
        foreach (var (owner, volume) in new[] { (201L, 1), (202L, 2), (203L, 3) })
            (await InScopeAsync(sp => store(sp).SaveAsync(FormValueOwnerKind.Task, owner, versionId, Values($$"""{"volume":{{volume}}}"""))))
                .IsSuccess.ShouldBeTrue();
        (await InScopeAsync(sp => store(sp).SaveAsync(FormValueOwnerKind.Task, 204, otherVersionId, Values("""{"volume":4}""")))).IsSuccess.ShouldBeTrue();

        var many = await InScopeAsync(sp => store(sp).GetManyAsync(
            FormValueOwnerKind.Task,
            [(201, definitionId), (202, definitionId), (204, definitionId), (205, definitionId), (204, otherDefinitionId)]));

        many.Keys.Order().ToList().ShouldBe([201L, 202L, 204L], "203 was not asked for, 205 has no values, and 204 only counts under the definition it was saved for");
        many[201].Values["volume"].GetDecimal().ShouldBe(1m);
        many[202].FormVersionId.ShouldBe(versionId);
        many[204].FormDefinitionId.ShouldBe(otherDefinitionId);
        many[204].Values["volume"].GetDecimal().ShouldBe(4m);

        (await InScopeAsync(sp => store(sp).GetManyAsync(FormValueOwnerKind.Task, []))).ShouldBeEmpty();
        (await InScopeAsync(sp => store(sp).GetManyAsync(FormValueOwnerKind.StepInstance, [(201, definitionId)]))).ShouldBeEmpty("a different owner kind");
    }

    [Fact]
    public async Task Values_round_trip_with_the_version_they_were_saved_under_and_stay_pinned_for_tasks()
    {
        var (definitionId, v1) = await PublishAsync("TaskType", 7, RequestForm);

        var saved = await InScopeAsync(sp => sp.GetRequiredService<IFormValueStore>().SaveAsync(
            FormValueOwnerKind.Task, 100, v1, Values("""{"requires_ocr":true,"ocr_language":"eng","volume":12.5,"outputs":["tiff","pdf"],"due":"2026-03-01","notes":"hello"}""")));
        saved.IsSuccess.ShouldBeTrue(saved.Error?.Message);
        saved.Value.Stored.FormVersionId.ShouldBe(v1);
        saved.Value.DroppedFields.ShouldBeEmpty();

        var read = await InScopeAsync(sp => sp.GetRequiredService<IFormValueStore>().GetAsync(FormValueOwnerKind.Task, 100, definitionId));
        read.ShouldNotBeNull();
        read.FormVersionId.ShouldBe(v1);
        read.Values["volume"].GetDecimal().ShouldBe(12.5m);
        read.Values["outputs"].EnumerateArray().Select(e => e.GetString()).ShouldBe(["tiff", "pdf"]);
        read.Values["notes"].GetString().ShouldBe("hello");

        // Typed filter rows: one per scalar, multiselect one per key.
        var rows = await IndexRowsAsync(FormValueOwnerKind.Task, 100);
        rows.Count.ShouldBe(6);
        rows.Single(r => r.FieldKey == "requires_ocr").ValueBool.ShouldBe(true);
        rows.Single(r => r.FieldKey == "ocr_language").ValueText.ShouldBe("eng");
        rows.Single(r => r.FieldKey == "volume").ValueNumber.ShouldBe(12.5m);
        rows.Single(r => r.FieldKey == "due").ValueDate.ShouldBe(new DateOnly(2026, 3, 1));
        rows.Where(r => r.FieldKey == "outputs").Select(r => r.ValueText).ShouldBe(["tiff", "pdf"]);

        // A patch that hides a field drops (and reports) its value, and the index follows.
        var patched = await InScopeAsync(sp => sp.GetRequiredService<IFormValueStore>().SaveAsync(
            FormValueOwnerKind.Task, 100, v1, Values("""{"requires_ocr":false}""")));
        patched.IsSuccess.ShouldBeTrue(patched.Error?.Message);
        patched.Value.DroppedFields.ShouldBe(["ocr_language"]);
        patched.Value.Stored.Values.ContainsKey("ocr_language").ShouldBeFalse();
        patched.Value.Stored.Values["volume"].GetDecimal().ShouldBe(12.5m);
        var after = await IndexRowsAsync(FormValueOwnerKind.Task, 100);
        after.Single(r => r.FieldKey == "requires_ocr").ValueBool.ShouldBe(false);
        after.Any(r => r.FieldKey == "ocr_language").ShouldBeFalse();

        // Publish version 2 (new required field). The Task stays on version 1 and keeps being editable there.
        var (_, v2) = await PublishAsync("TaskType", 7, RequestFormV2, definitionId);
        v2.ShouldNotBe(v1);
        var pinned = await InScopeAsync(sp => sp.GetRequiredService<IFormValueStore>().GetAsync(FormValueOwnerKind.Task, 100, definitionId));
        pinned!.FormVersionId.ShouldBe(v1);

        var moved = await InScopeAsync(sp => sp.GetRequiredService<IFormValueStore>().SaveAsync(
            FormValueOwnerKind.Task, 100, v2, Values("""{"volume":3}""")));
        moved.IsFailure.ShouldBeTrue();
        moved.Error!.Code.ShouldBe("IMMUTABLE_FIELD");

        var stillV1 = await InScopeAsync(sp => sp.GetRequiredService<IFormValueStore>().SaveAsync(
            FormValueOwnerKind.Task, 100, v1, Values("""{"volume":3}"""), new FormSaveOptions { ValidateOnlyChanged = true }));
        stillV1.IsSuccess.ShouldBeTrue(stillV1.Error?.Message);
        stillV1.Value.Stored.FormVersionId.ShouldBe(v1);
        stillV1.Value.Stored.Values["volume"].GetDecimal().ShouldBe(3m);

        // A new Task on version 2 must satisfy the new required field and is pinned to version 2.
        var missing = await InScopeAsync(sp => sp.GetRequiredService<IFormValueStore>().SaveAsync(
            FormValueOwnerKind.Task, 101, v2, Values("""{"volume":1}""")));
        missing.IsFailure.ShouldBeTrue();
        missing.Error!.Code.ShouldBe("FORM_VALIDATION_FAILED");
        missing.Error.FieldErrors!["form:reviewer"].Single().Code.ShouldBe("REQUIRED");
        (await IndexRowsAsync(FormValueOwnerKind.Task, 101)).ShouldBeEmpty();

        var created = await InScopeAsync(sp => sp.GetRequiredService<IFormValueStore>().SaveAsync(
            FormValueOwnerKind.Task, 101, v2, Values("""{"volume":1,"reviewer":4}""")));
        created.IsSuccess.ShouldBeTrue(created.Error?.Message);
        created.Value.Stored.FormVersionId.ShouldBe(v2);
    }

    [Fact]
    public async Task Draft_versions_cannot_store_values()
    {
        var (definitionId, _) = await PublishAsync("TaskType", 8, RequestForm);
        var draft = await _admin.PostAsync($"/api/v1/forms/{definitionId}/versions", new StringContent("{}", Encoding.UTF8, "application/json"));
        var draftId = (await draft.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("version").GetProperty("formVersionId").GetInt32();

        var result = await InScopeAsync(sp => sp.GetRequiredService<IFormValueStore>().SaveAsync(FormValueOwnerKind.Task, 1, draftId, Values("{}")));

        result.IsFailure.ShouldBeTrue();
        result.Error!.Code.ShouldBe("FORM_NOT_PUBLISHED");
    }

    [Fact]
    public async Task Core_objects_follow_the_current_published_version_and_validate_only_changed_fields()
    {
        var (definitionId, v1) = await PublishAsync("Client", null, RequestForm);
        var first = await InScopeAsync(sp => sp.GetRequiredService<IFormValueStore>().SaveAsync(
            FormValueOwnerKind.Client, 55, v1, Values("""{"volume":2,"notes":"old","legacy_note":"kept"}""")));
        // 'legacy_note' is not a field of the form: submitting it is an error ...
        first.IsFailure.ShouldBeTrue();
        first.Error!.FieldErrors!.ContainsKey("form:legacy_note").ShouldBeTrue();
        // ... without it the save works.
        (await InScopeAsync(sp => sp.GetRequiredService<IFormValueStore>().SaveAsync(
            FormValueOwnerKind.Client, 55, v1, Values("""{"volume":2,"notes":"old"}""")))).IsSuccess.ShouldBeTrue();

        // Version 2 adds a required field. Existing clients are not blocked on unrelated edits (FND-07).
        var (_, v2) = await PublishAsync("Client", null, RequestFormV2, definitionId);

        var full = await InScopeAsync(sp => sp.GetRequiredService<IFormValueStore>().SaveAsync(
            FormValueOwnerKind.Client, 55, v2, Values("""{"notes":"new"}""")));
        full.IsFailure.ShouldBeTrue();
        full.Error!.FieldErrors!.ContainsKey("form:reviewer").ShouldBeTrue();

        var partial = await InScopeAsync(sp => sp.GetRequiredService<IFormValueStore>().SaveAsync(
            FormValueOwnerKind.Client, 55, v2, Values("""{"notes":"new"}"""), new FormSaveOptions { ValidateOnlyChanged = true }));
        partial.IsSuccess.ShouldBeTrue(partial.Error?.Message);
        partial.Value.Stored.FormVersionId.ShouldBe(v2);
        partial.Value.Stored.Values["notes"].GetString().ShouldBe("new");
        partial.Value.Stored.Values["volume"].GetDecimal().ShouldBe(2m);

        // Changing the unrelated field to something invalid is still caught.
        var invalid = await InScopeAsync(sp => sp.GetRequiredService<IFormValueStore>().SaveAsync(
            FormValueOwnerKind.Client, 55, v2, Values("""{"volume":-1}"""), new FormSaveOptions { ValidateOnlyChanged = true }));
        invalid.IsFailure.ShouldBeTrue();
        invalid.Error!.FieldErrors!["form:volume"].Single().Code.ShouldBe("OUT_OF_RANGE");
    }

    [Fact]
    public async Task Submission_validator_reports_dropped_fields_index_values_and_preserves_unknown_stored_keys()
    {
        var (_, v1) = await PublishAsync("TaskType", 9, RequestForm);

        var result = await InScopeAsync(sp => sp.GetRequiredService<IFormSubmissionValidator>().ValidateAsync(
            v1,
            Values("""{"requires_ocr":false,"ocr_language":"fra","volume":7,"due":"2026-12-31"}"""),
            new FormSubmissionOptions { ExistingValues = Values("""{"retired_key":"keep me","volume":1}""") }));

        result.IsSuccess.ShouldBeTrue();
        var r = result.Value;
        r.IsValid.ShouldBeTrue();
        r.DroppedFields.ShouldBe(["ocr_language"]);
        r.NormalizedValues.Keys.ShouldBe(["requires_ocr", "volume", "due", "retired_key"], ignoreOrder: true);
        r.NormalizedValues["retired_key"].GetString().ShouldBe("keep me");
        r.IndexValues.Select(i => i.FieldKey).ShouldBe(["requires_ocr", "volume", "due"], ignoreOrder: true);
        r.IndexValues.Single(i => i.FieldKey == "volume").ValueNumber.ShouldBe(7m);

        var unknownVersion = await InScopeAsync(sp => sp.GetRequiredService<IFormSubmissionValidator>().ValidateAsync(424242, Values("{}")));
        unknownVersion.IsFailure.ShouldBeTrue();
        unknownVersion.Error!.Code.ShouldBe("NOT_FOUND");
    }

    [Fact]
    public async Task Dropped_values_and_value_changes_are_audited_per_field()
    {
        var (_, v1) = await PublishAsync("TaskType", 13, RequestForm);
        (await InScopeAsync(sp => sp.GetRequiredService<IFormValueStore>().SaveAsync(
            FormValueOwnerKind.Task, 900, v1, Values("""{"requires_ocr":true,"ocr_language":"eng"}""")))).IsSuccess.ShouldBeTrue();
        (await InScopeAsync(sp => sp.GetRequiredService<IFormValueStore>().SaveAsync(
            FormValueOwnerKind.Task, 900, v1, Values("""{"requires_ocr":false}""")))).IsSuccess.ShouldBeTrue();

        var id = await _factory.WithDbAsync(db => db.Set<FormValueSet>().Where(s => s.OwnerId == 900).Select(s => s.Id).SingleAsync());
        var page = await _admin.GetFromJsonAsync<JsonElement>($"/api/v1/audit/events?objectType=FormValueSet&objectId={id}");
        var events = page.GetProperty("items").EnumerateArray().Select(e => (Type: e.GetProperty("eventType").GetString(), Field: e.GetProperty("fieldKey").GetString())).ToList();

        events.ShouldContain(("FIELD_CHANGED", "form:requires_ocr"));
        events.ShouldContain(("FIELD_CHANGED", "form:ocr_language"));
        events.ShouldContain(("FORM_VALUES_DROPPED", null));
    }
}
