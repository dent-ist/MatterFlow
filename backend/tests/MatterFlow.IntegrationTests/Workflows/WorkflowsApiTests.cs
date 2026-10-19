using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using MatterFlow.Identity.Contracts;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.WorkflowEngine.Contracts;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

namespace MatterFlow.IntegrationTests.Workflows;

/// <summary>
/// Tickets #35 and #38 acceptance against a real SQL Server through the full HTTP pipeline: the step library, workflow drafts, validated
/// publish with snapshots (SCN-014), immutability of published versions (service and database trigger), permissions, audit and the catalog contract.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class WorkflowsApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private string _connectionString = null!;

    public async Task InitializeAsync()
    {
        _connectionString = await sql.CreateDatabaseAsync();
        _factory = new DatabaseApiFactory(_connectionString);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private HttpClient As(string user = DatabaseApiFactory.AdminAccount)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", user);
        return client;
    }

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");

    private static StringContent Json(object value) => Json(JsonSerializer.Serialize(value));

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage response) => await response.Content.ReadFromJsonAsync<JsonElement>();

    private static async Task<JsonElement> OkAsync(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    {
        response.StatusCode.ShouldBe(expected, await response.Content.ReadAsStringAsync());
        return await ReadAsync(response);
    }

    // ---- helpers: steps

    private async Task<JsonElement> CreateStepAsync(HttpClient client, string title, string? instructions = "Do the thing.", string? url = null)
    {
        var response = await client.PostAsync("/api/v1/step-definitions", Json(new { title, description = title + " description", instructions, documentationUrl = url }));
        return await OkAsync(response, HttpStatusCode.Created);
    }

    private static int StepId(JsonElement step) => step.GetProperty("stepDefinitionId").GetInt32();

    private async Task<JsonElement> UpdateStepAsync(HttpClient client, JsonElement step, string title, string? instructions)
    {
        var response = await client.PutAsync(
            $"/api/v1/step-definitions/{StepId(step)}",
            Json(new { title, description = "d", instructions, isActive = true, rowVersion = step.GetProperty("rowVersion").GetString() }));
        return await OkAsync(response);
    }

    /// <summary>Gives the step a published input form (one text field) and returns its published form version id.</summary>
    private async Task<int> PublishStepFormAsync(HttpClient client, JsonElement step, string fieldKey = "items_in")
    {
        var definitionId = step.GetProperty("formDefinitionId").GetInt32();
        var draft = await OkAsync(await client.PostAsync($"/api/v1/forms/{definitionId}/versions", Json("{}")), HttpStatusCode.Created);
        var versionId = draft.GetProperty("version").GetProperty("formVersionId").GetInt32();
        var body = $$"""{"fields":[{"key":"{{fieldKey}}","label":"Items in","control":"NUMBER"}]}""";
        (await FormDraftApi.SaveAsync(client, definitionId, versionId, body)).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await FormDraftApi.PublishAsync(client, definitionId, versionId)).StatusCode.ShouldBe(HttpStatusCode.OK);
        return versionId;
    }

    // ---- helpers: workflows

    private async Task<JsonElement> CreateWorkflowAsync(HttpClient client, string name, bool ordered = true)
    {
        var response = await client.PostAsync("/api/v1/workflows", Json(new { name, description = name + " description", isOrdered = ordered }));
        return await OkAsync(response, HttpStatusCode.Created);
    }

    private static int WorkflowId(JsonElement detail) => detail.GetProperty("workflow").GetProperty("workflowDefinitionId").GetInt32();

    private static int DraftId(JsonElement workflowDetail) => workflowDetail.GetProperty("workflow").GetProperty("draftVersionId").GetInt32();

    private async Task<JsonElement> GetVersionAsync(HttpClient client, int workflowId, int versionId) =>
        await OkAsync(await client.GetAsync($"/api/v1/workflows/{workflowId}/versions/{versionId}"));

    private static string VersionRowVersion(JsonElement versionDetail) => versionDetail.GetProperty("version").GetProperty("rowVersion").GetString()!;

    private static int VersionIdOf(JsonElement versionDetail) => versionDetail.GetProperty("version").GetProperty("workflowVersionId").GetInt32();

    private async Task<HttpResponseMessage> SaveDraftAsync(HttpClient client, int workflowId, JsonElement version, bool ordered, params object[] steps) =>
        await client.PutAsync(
            $"/api/v1/workflows/{workflowId}/versions/{VersionIdOf(version)}",
            Json(new { isOrdered = ordered, steps, rowVersion = VersionRowVersion(version) }));

    private async Task<JsonElement> SaveOkAsync(HttpClient client, int workflowId, JsonElement version, bool ordered, params object[] steps) =>
        await OkAsync(await SaveDraftAsync(client, workflowId, version, ordered, steps));

    private async Task<HttpResponseMessage> PublishAsync(HttpClient client, int workflowId, JsonElement version) =>
        await client.PostAsync(
            $"/api/v1/workflows/{workflowId}/versions/{VersionIdOf(version)}/publish",
            Json(new { rowVersion = VersionRowVersion(version) }));

    private static object Place(int stepId, bool skippable = false, bool commentRequired = false) =>
        new { sourceStepDefinitionId = stepId, isSkippable = skippable, skipCommentRequired = commentRequired };

    private static string[] Titles(JsonElement versionDetail) =>
        [.. versionDetail.GetProperty("steps").EnumerateArray().Select(s => s.GetProperty("title").GetString()!)];

    private static string[] Instructions(JsonElement versionDetail) =>
        [.. versionDetail.GetProperty("steps").EnumerateArray().Select(s => s.GetProperty("instructions").GetString() ?? string.Empty)];

    // ---- step library (#35)

    [Fact]
    public async Task Creating_a_step_provisions_its_input_form_and_titles_are_unique_among_active_steps()
    {
        var client = As();
        var step = await CreateStepAsync(client, "Deduplicate", url: "https://sharepoint.example.firm/dedupe");
        step.GetProperty("isActive").GetBoolean().ShouldBeTrue();
        step.GetProperty("formDefinitionId").GetInt32().ShouldBeGreaterThan(0);
        step.GetProperty("documentationUrl").GetString().ShouldBe("https://sharepoint.example.firm/dedupe");
        step.GetProperty("usage").GetArrayLength().ShouldBe(0);

        // The form belongs to the step and is edited with the existing designer endpoints.
        var form = await OkAsync(await client.GetAsync($"/api/v1/forms/{step.GetProperty("formDefinitionId").GetInt32()}"));
        form.GetProperty("ownerKind").GetString().ShouldBe("Step");
        form.GetProperty("ownerId").GetInt32().ShouldBe(StepId(step));

        var duplicate = await client.PostAsync("/api/v1/step-definitions", Json(new { title = "Deduplicate" }));
        duplicate.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ReadAsync(duplicate)).GetProperty("code").GetString().ShouldBe("DUPLICATE_NAME");

        // A deactivated title can be reused; reactivating the old one then clashes.
        var deactivated = await OkAsync(await client.PostAsync($"/api/v1/step-definitions/{StepId(step)}/deactivate", Json(new { rowVersion = step.GetProperty("rowVersion").GetString() })));
        deactivated.GetProperty("isActive").GetBoolean().ShouldBeFalse();
        var second = await CreateStepAsync(client, "Deduplicate");
        var clash = await client.PostAsync($"/api/v1/step-definitions/{StepId(step)}/activate", Json(new { rowVersion = deactivated.GetProperty("rowVersion").GetString() }));
        clash.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        StepId(second).ShouldNotBe(StepId(step));
    }

    [Fact]
    public async Task Step_validation_concurrency_list_and_get()
    {
        var client = As();
        (await client.PostAsync("/api/v1/step-definitions", Json(new { title = "   " }))).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        var badUrl = await client.PostAsync("/api/v1/step-definitions", Json(new { title = "Bad link", documentationUrl = "ftp://x/y" }));
        badUrl.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await ReadAsync(badUrl)).GetProperty("errors").GetProperty("documentationUrl")[0].GetProperty("code").GetString().ShouldBe("INVALID_URL");

        var step = await CreateStepAsync(client, "Quality Control Check");
        var updated = await UpdateStepAsync(client, step, "QC Check", "New SOP");
        updated.GetProperty("title").GetString().ShouldBe("QC Check");
        updated.GetProperty("rowVersion").GetString().ShouldNotBe(step.GetProperty("rowVersion").GetString());

        // The stale token from before the update is a conflict.
        var stale = await client.PutAsync(
            $"/api/v1/step-definitions/{StepId(step)}",
            Json(new { title = "Other", isActive = true, rowVersion = step.GetProperty("rowVersion").GetString() }));
        stale.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ReadAsync(stale)).GetProperty("code").GetString().ShouldBe("CONCURRENCY_CONFLICT");

        await CreateStepAsync(client, "Intake QC");
        var list = await OkAsync(await client.GetAsync("/api/v1/step-definitions?q=qc"));
        list.GetProperty("total").GetInt32().ShouldBe(2);
        list.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("title").GetString()).ShouldBe(["Intake QC", "QC Check"]);

        // Sorting by title (default), descending, and by where the step is used; an unknown field is a 400.
        var descending = await OkAsync(await client.GetAsync("/api/v1/step-definitions?q=qc&sort=-title"));
        descending.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("title").GetString()).ShouldBe(["QC Check", "Intake QC"]);
        (await OkAsync(await client.GetAsync("/api/v1/step-definitions?q=qc&sort=usedInVersions"))).GetProperty("total").GetInt32().ShouldBe(2);
        (await client.GetAsync("/api/v1/step-definitions?sort=nonsense")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        (await client.GetAsync("/api/v1/step-definitions?bogus=1")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await client.GetAsync("/api/v1/step-definitions/9999")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await OkAsync(await client.GetAsync("/api/v1/step-definitions?isActive=false"))).GetProperty("total").GetInt32().ShouldBe(0);
    }

    // ---- workflow drafts and publish (#38)

    [Fact]
    public async Task Workflow_and_step_lists_sort_by_status_with_active_first_and_ties_by_name()
    {
        var client = As();
        var tag = Guid.NewGuid().ToString("N")[..6];

        // Two workflows and two steps of each status, created out of name order.
        var wfB = await CreateWorkflowAsync(client, $"{tag} Beta");
        await CreateWorkflowAsync(client, $"{tag} Alpha");
        var wfC = await CreateWorkflowAsync(client, $"{tag} Gamma");
        await CreateWorkflowAsync(client, $"{tag} Delta");
        foreach (var (detail, name) in new[] { (wfB, $"{tag} Beta"), (wfC, $"{tag} Gamma") })
        {
            await OkAsync(await client.PutAsync(
                $"/api/v1/workflows/{WorkflowId(detail)}",
                Json(new { name, isActive = false, rowVersion = detail.GetProperty("workflow").GetProperty("rowVersion").GetString() })));
        }

        async Task<List<string?>> Names(string url, string property)
            => (await OkAsync(await client.GetAsync(url))).GetProperty("items").EnumerateArray().Select(i => i.GetProperty(property).GetString()).ToList();

        (await Names($"/api/v1/workflows?q={tag}&sort=status", "name")).ShouldBe([$"{tag} Alpha", $"{tag} Delta", $"{tag} Beta", $"{tag} Gamma"]);
        (await Names($"/api/v1/workflows?q={tag}&sort=-status", "name")).ShouldBe([$"{tag} Beta", $"{tag} Gamma", $"{tag} Alpha", $"{tag} Delta"]);

        var stepB = await CreateStepAsync(client, $"{tag} Step Beta");
        await CreateStepAsync(client, $"{tag} Step Alpha");
        await OkAsync(await client.PostAsync($"/api/v1/step-definitions/{StepId(stepB)}/deactivate", Json(new { rowVersion = stepB.GetProperty("rowVersion").GetString() })));

        (await Names($"/api/v1/step-definitions?q={tag}&sort=status", "title")).ShouldBe([$"{tag} Step Alpha", $"{tag} Step Beta"]);
        (await Names($"/api/v1/step-definitions?q={tag}&sort=-status", "title")).ShouldBe([$"{tag} Step Beta", $"{tag} Step Alpha"]);
    }

    [Fact]
    public async Task Workflow_starts_with_an_empty_draft_and_cannot_publish_without_steps()
    {
        var client = As();
        var created = await CreateWorkflowAsync(client, "Standard Processing");
        var workflowId = WorkflowId(created);
        created.GetProperty("versions").GetArrayLength().ShouldBe(1);
        created.GetProperty("workflow").GetProperty("publishedVersionId").ValueKind.ShouldBe(JsonValueKind.Null);

        (await client.PostAsync("/api/v1/workflows", Json(new { name = "Standard Processing" }))).StatusCode.ShouldBe(HttpStatusCode.Conflict);

        // The list sorts by name, ascending by default and descending with a minus sign; an unknown field is a 400.
        await CreateWorkflowAsync(client, "Archive Review");
        var ascending = (await OkAsync(await client.GetAsync("/api/v1/workflows?sort=name"))).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("name").GetString()).ToList();
        ascending.IndexOf("Archive Review").ShouldBeLessThan(ascending.IndexOf("Standard Processing"));
        var descending = (await OkAsync(await client.GetAsync("/api/v1/workflows?sort=-name"))).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("name").GetString()).ToList();
        descending.IndexOf("Standard Processing").ShouldBeLessThan(descending.IndexOf("Archive Review"));
        (await client.GetAsync("/api/v1/workflows?sort=nonsense")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var draft = await GetVersionAsync(client, workflowId, DraftId(created));
        var rejected = await PublishAsync(client, workflowId, draft);
        rejected.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        var problem = await ReadAsync(rejected);
        problem.GetProperty("code").GetString().ShouldBe("PUBLISH_VALIDATION_FAILED");
        problem.GetProperty("errors").GetProperty("steps")[0].GetProperty("code").GetString().ShouldBe("NO_STEPS");

        (await client.PostAsync($"/api/v1/workflows/{workflowId}/versions", Json("{}"))).StatusCode.ShouldBe(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task Draft_validation_duplicate_step_inactive_step_and_skip_rules()
    {
        var client = As();
        var a = await CreateStepAsync(client, "A");
        var b = await CreateStepAsync(client, "B");
        var workflow = await CreateWorkflowAsync(client, "W");
        var workflowId = WorkflowId(workflow);
        var draft = await GetVersionAsync(client, workflowId, DraftId(workflow));

        var duplicate = await SaveDraftAsync(client, workflowId, draft, true, Place(StepId(a)), Place(StepId(a)));
        duplicate.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await ReadAsync(duplicate)).GetProperty("errors").GetProperty("steps[1].sourceStepDefinitionId")[0].GetProperty("code").GetString().ShouldBe("DUPLICATE_STEP");

        var skip = await SaveDraftAsync(client, workflowId, draft, true, Place(StepId(a), skippable: false, commentRequired: true));
        skip.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await ReadAsync(skip)).GetProperty("errors").GetProperty("steps[0].skipCommentRequired")[0].GetProperty("code").GetString().ShouldBe("SKIP_COMMENT_REQUIRES_SKIPPABLE");

        (await SaveDraftAsync(client, workflowId, draft, true, Place(999))).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        await OkAsync(await client.PostAsync($"/api/v1/step-definitions/{StepId(b)}/deactivate", Json(new { rowVersion = b.GetProperty("rowVersion").GetString() })));
        var inactive = await SaveDraftAsync(client, workflowId, draft, true, Place(StepId(b)));
        inactive.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await ReadAsync(inactive)).GetProperty("errors").GetProperty("steps[0].sourceStepDefinitionId")[0].GetProperty("code").GetString().ShouldBe("STEP_INACTIVE");

        var saved = await SaveOkAsync(client, workflowId, draft, false, Place(StepId(a), skippable: true, commentRequired: true));
        saved.GetProperty("version").GetProperty("isOrdered").GetBoolean().ShouldBeFalse();
        var only = saved.GetProperty("steps")[0];
        only.GetProperty("sequenceNo").GetInt32().ShouldBe(1);
        only.GetProperty("isSkippable").GetBoolean().ShouldBeTrue();
        only.GetProperty("skipCommentRequired").GetBoolean().ShouldBeTrue();

        // The row version moved, so the token from before the save is stale.
        (await SaveDraftAsync(client, workflowId, draft, true, Place(StepId(a)))).StatusCode.ShouldBe(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task Step_with_inputs_only_in_draft_blocks_publish_and_an_empty_draft_form_does_not()
    {
        var client = As();
        var withDraftForm = await CreateStepAsync(client, "Has draft form");
        var emptyDraftForm = await CreateStepAsync(client, "Empty draft form");
        var formId = withDraftForm.GetProperty("formDefinitionId").GetInt32();
        var versionId = (await OkAsync(await client.PostAsync($"/api/v1/forms/{formId}/versions", Json("{}")), HttpStatusCode.Created)).GetProperty("version").GetProperty("formVersionId").GetInt32();
        (await FormDraftApi.SaveAsync(client, formId, versionId, """{"fields":[{"key":"qc","label":"QC","control":"TEXT"}]}""")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await client.PostAsync($"/api/v1/forms/{emptyDraftForm.GetProperty("formDefinitionId").GetInt32()}/versions", Json("{}"))).StatusCode.ShouldBe(HttpStatusCode.Created);

        var workflow = await CreateWorkflowAsync(client, "Mixed");
        var workflowId = WorkflowId(workflow);
        var draft = await GetVersionAsync(client, workflowId, DraftId(workflow));
        var saved = await SaveOkAsync(client, workflowId, draft, true, Place(StepId(withDraftForm)), Place(StepId(emptyDraftForm)));

        var blocked = await PublishAsync(client, workflowId, saved);
        blocked.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        var problem = await ReadAsync(blocked);
        problem.GetProperty("code").GetString().ShouldBe("PUBLISH_VALIDATION_FAILED");
        problem.GetProperty("errors").GetProperty("steps[1]")[0].GetProperty("code").GetString().ShouldBe("STEP_FORM_NOT_PUBLISHED");
        problem.GetProperty("errors").TryGetProperty("steps[2]", out _).ShouldBeFalse();

        // Publish the step's form; now the workflow publishes and pins it. The step with an empty form pins nothing.
        (await FormDraftApi.PublishAsync(client, formId, versionId)).StatusCode.ShouldBe(HttpStatusCode.OK);
        var published = await OkAsync(await PublishAsync(client, workflowId, saved));
        var steps = published.GetProperty("steps").EnumerateArray().ToList();
        steps[0].GetProperty("stepFormVersionId").GetInt32().ShouldBeGreaterThan(0);
        steps[1].GetProperty("stepFormVersionId").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task Scn014_publishing_a_new_version_leaves_the_previous_version_content_intact()
    {
        var client = As();
        var intake = await CreateStepAsync(client, "Intake QC", "Original intake SOP");
        var load = await CreateStepAsync(client, "Load to Relativity", "Original load SOP");
        var dedupe = await CreateStepAsync(client, "Deduplicate", "Original dedupe SOP");
        var intakeForm = await PublishStepFormAsync(client, intake);

        var workflow = await CreateWorkflowAsync(client, "Standard Processing");
        var workflowId = WorkflowId(workflow);
        var draft1 = await GetVersionAsync(client, workflowId, DraftId(workflow));
        var saved1 = await SaveOkAsync(client, workflowId, draft1, true, Place(StepId(intake)), Place(StepId(load), skippable: true));
        var v1 = await OkAsync(await PublishAsync(client, workflowId, saved1));
        var v1Id = VersionIdOf(v1);
        v1.GetProperty("version").GetProperty("status").GetString().ShouldBe("Published");
        Titles(v1).ShouldBe(["Intake QC", "Load to Relativity"]);
        v1.GetProperty("steps")[0].GetProperty("stepFormVersionId").GetInt32().ShouldBe(intakeForm);

        // Edit the library AFTER publishing v1: text, and a new published version of the step's form.
        await UpdateStepAsync(client, await OkAsync(await client.GetAsync($"/api/v1/step-definitions/{StepId(intake)}")), "Intake QC (renamed)", "Changed intake SOP");
        var newerForm = await PublishStepFormAsync(client, await OkAsync(await client.GetAsync($"/api/v1/step-definitions/{StepId(intake)}")), "items_out");
        newerForm.ShouldBeGreaterThan(intakeForm);

        var v1After = await GetVersionAsync(client, workflowId, v1Id);
        Titles(v1After).ShouldBe(["Intake QC", "Load to Relativity"]);
        Instructions(v1After).ShouldBe(["Original intake SOP", "Original load SOP"]);
        v1After.GetProperty("steps")[0].GetProperty("stepFormVersionId").GetInt32().ShouldBe(intakeForm);

        // Draft v2 copies v1 verbatim; a new step is added and the order changed. Publishing v2 snapshots the library as it is now.
        var created2 = await OkAsync(await client.PostAsync($"/api/v1/workflows/{workflowId}/versions", Json("{}")), HttpStatusCode.Created);
        VersionIdOf(created2).ShouldNotBe(v1Id);
        created2.GetProperty("version").GetProperty("versionNo").GetInt32().ShouldBe(2);
        Titles(created2).ShouldBe(["Intake QC", "Load to Relativity"]);
        var saved2 = await SaveOkAsync(client, workflowId, created2, true, Place(StepId(dedupe)), Place(StepId(intake)), Place(StepId(load), skippable: true, commentRequired: true));
        var v2 = await OkAsync(await PublishAsync(client, workflowId, saved2));

        Titles(v2).ShouldBe(["Deduplicate", "Intake QC (renamed)", "Load to Relativity"]);
        Instructions(v2).ShouldBe(["Original dedupe SOP", "Changed intake SOP", "Original load SOP"]);
        v2.GetProperty("steps")[1].GetProperty("stepFormVersionId").GetInt32().ShouldBe(newerForm);

        // v1 is retired and still reads exactly as it was published.
        var v1Retired = await GetVersionAsync(client, workflowId, v1Id);
        v1Retired.GetProperty("version").GetProperty("status").GetString().ShouldBe("Retired");
        Titles(v1Retired).ShouldBe(["Intake QC", "Load to Relativity"]);
        Instructions(v1Retired).ShouldBe(["Original intake SOP", "Original load SOP"]);
        v1Retired.GetProperty("steps")[1].GetProperty("isSkippable").GetBoolean().ShouldBeTrue();
        v1Retired.GetProperty("steps")[1].GetProperty("skipCommentRequired").GetBoolean().ShouldBeFalse();

        // The catalog contract resolves the current published version (v2) and any version by id (v1).
        await using var scope = _factory.Services.CreateAsyncScope();
        var catalog = scope.ServiceProvider.GetRequiredService<IWorkflowCatalog>();
        var current = (await catalog.GetPublishedVersionAsync(workflowId)).Value;
        current.VersionNo.ShouldBe(2);
        current.Steps.Select(s => s.Title).ShouldBe(["Deduplicate", "Intake QC (renamed)", "Load to Relativity"]);
        var old = (await catalog.GetVersionAsync(v1Id))!;
        old.Status.ShouldBe(WorkflowVersionStatus.Retired);
        old.Steps.Select(s => s.Title).ShouldBe(["Intake QC", "Load to Relativity"]);
        old.Steps[0].StepFormVersionId.ShouldBe(intakeForm);
    }

    [Fact]
    public async Task Published_versions_are_immutable_in_the_service_and_the_database()
    {
        var client = As();
        var a = await CreateStepAsync(client, "A");
        var other = await CreateStepAsync(client, "Other");
        var workflow = await CreateWorkflowAsync(client, "Locked");
        var workflowId = WorkflowId(workflow);
        var draft = await GetVersionAsync(client, workflowId, DraftId(workflow));
        var saved = await SaveOkAsync(client, workflowId, draft, true, Place(StepId(a)));
        var published = await OkAsync(await PublishAsync(client, workflowId, saved));
        var versionId = VersionIdOf(published);

        // Service guard: edit, discard and republish a published version are all conflicts.
        var edit = await SaveDraftAsync(client, workflowId, published, true, Place(StepId(a)));
        edit.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ReadAsync(edit)).GetProperty("code").GetString().ShouldBe("WORKFLOW_VERSION_IMMUTABLE");
        (await client.DeleteAsync($"/api/v1/workflows/{workflowId}/versions/{versionId}")).StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await PublishAsync(client, workflowId, published)).StatusCode.ShouldBe(HttpStatusCode.Conflict);

        // Database trigger: raw SQL cannot change or delete a published version or its steps either.
        async Task ShouldRejectAsync(string statement, string expected)
        {
            var ex = await Should.ThrowAsync<SqlException>(() => SqlServerFixture.ExecuteAsync(_connectionString, statement));
            ex.Message.ShouldContain(expected, Case.Insensitive, statement);
        }

        await ShouldRejectAsync($"UPDATE dbo.WorkflowVersionStep SET Title = N'Hacked' WHERE WorkflowVersionId = {versionId}", "immutable");
        await ShouldRejectAsync($"DELETE FROM dbo.WorkflowVersionStep WHERE WorkflowVersionId = {versionId}", "immutable");
        await ShouldRejectAsync($"INSERT dbo.WorkflowVersionStep (WorkflowVersionId, SequenceNo, SourceStepDefinitionId, Title) VALUES ({versionId}, 2, {StepId(other)}, N'x')", "immutable");
        await ShouldRejectAsync($"UPDATE dbo.WorkflowVersion SET IsOrdered = 0 WHERE WorkflowVersionId = {versionId}", "immutable");
        await ShouldRejectAsync($"UPDATE dbo.WorkflowVersion SET Status = 'DRAFT' WHERE WorkflowVersionId = {versionId}", "immutable");
        // The steps' foreign key already stops the delete; the trigger is the second line of defence for a version without steps.
        await ShouldRejectAsync($"DELETE FROM dbo.WorkflowVersion WHERE WorkflowVersionId = {versionId}", "FK_WVS_Version");

        // Retired is final too.
        var retired = await OkAsync(await client.PostAsync($"/api/v1/workflows/{workflowId}/versions/{versionId}/retire", Json(new { rowVersion = VersionRowVersion(published) })));
        retired.GetProperty("version").GetProperty("status").GetString().ShouldBe("Retired");
        await ShouldRejectAsync($"UPDATE dbo.WorkflowVersion SET Status = 'PUBLISHED' WHERE WorkflowVersionId = {versionId}", "immutable");
        await ShouldRejectAsync($"UPDATE dbo.WorkflowVersionStep SET IsSkippable = 1 WHERE WorkflowVersionId = {versionId}", "immutable");
    }

    [Fact]
    public async Task Draft_lifecycle_discard_retire_and_new_draft_from_published()
    {
        var client = As();
        var a = await CreateStepAsync(client, "A");
        var b = await CreateStepAsync(client, "B");
        var workflow = await CreateWorkflowAsync(client, "Lifecycle");
        var workflowId = WorkflowId(workflow);
        var draft = await GetVersionAsync(client, workflowId, DraftId(workflow));

        // Discard the first empty draft, then start over.
        (await client.DeleteAsync($"/api/v1/workflows/{workflowId}/versions/{VersionIdOf(draft)}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await OkAsync(await client.GetAsync($"/api/v1/workflows/{workflowId}"))).GetProperty("versions").GetArrayLength().ShouldBe(0);
        var fresh = await OkAsync(await client.PostAsync($"/api/v1/workflows/{workflowId}/versions", Json("{}")), HttpStatusCode.Created);
        fresh.GetProperty("version").GetProperty("versionNo").GetInt32().ShouldBe(1);
        var saved = await SaveOkAsync(client, workflowId, fresh, true, Place(StepId(a)), Place(StepId(b)));
        var v1 = await OkAsync(await PublishAsync(client, workflowId, saved));

        // Only the published version retires; afterwards the workflow offers nothing for new tasks.
        var published = await client.GetAsync($"/api/v1/workflows/{workflowId}/published");
        (await OkAsync(published)).GetProperty("versionNo").GetInt32().ShouldBe(1);
        (await OkAsync(await client.GetAsync("/api/v1/workflows/published"))).GetArrayLength().ShouldBe(1);
        var retired = await OkAsync(await client.PostAsync($"/api/v1/workflows/{workflowId}/versions/{VersionIdOf(v1)}/retire", Json(new { rowVersion = VersionRowVersion(v1) })));
        (await client.PostAsync($"/api/v1/workflows/{workflowId}/versions/{VersionIdOf(v1)}/retire", Json(new { rowVersion = VersionRowVersion(retired) }))).StatusCode.ShouldBe(HttpStatusCode.Conflict);
        var notPublished = await client.GetAsync($"/api/v1/workflows/{workflowId}/published");
        notPublished.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ReadAsync(notPublished)).GetProperty("code").GetString().ShouldBe("WORKFLOW_NOT_PUBLISHED");
        (await OkAsync(await client.GetAsync("/api/v1/workflows/published"))).GetArrayLength().ShouldBe(0);

        // A new draft copies the newest version (v1, retired) when nothing is published.
        var v2Draft = await OkAsync(await client.PostAsync($"/api/v1/workflows/{workflowId}/versions", Json("{}")), HttpStatusCode.Created);
        v2Draft.GetProperty("version").GetProperty("versionNo").GetInt32().ShouldBe(2);
        Titles(v2Draft).ShouldBe(["A", "B"]);
        var bad = await client.PostAsync($"/api/v1/workflows/{workflowId}/versions", Json("{}"));
        bad.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ReadAsync(bad)).GetProperty("code").GetString().ShouldBe("WORKFLOW_DRAFT_EXISTS");
    }

    [Fact]
    public async Task Publishing_a_new_version_retires_the_previous_one_atomically_and_inactive_workflows_are_not_offered()
    {
        var client = As();
        var a = await CreateStepAsync(client, "A");
        var workflow = await CreateWorkflowAsync(client, "Atomic");
        var workflowId = WorkflowId(workflow);
        var saved = await SaveOkAsync(client, workflowId, await GetVersionAsync(client, workflowId, DraftId(workflow)), true, Place(StepId(a)));
        await OkAsync(await PublishAsync(client, workflowId, saved));

        var next = await OkAsync(await client.PostAsync($"/api/v1/workflows/{workflowId}/versions", Json("{}")), HttpStatusCode.Created);
        await OkAsync(await PublishAsync(client, workflowId, next));

        var detail = await OkAsync(await client.GetAsync($"/api/v1/workflows/{workflowId}"));
        detail.GetProperty("versions").EnumerateArray().Select(v => v.GetProperty("status").GetString()).ShouldBe(["Published", "Retired"]);
        detail.GetProperty("workflow").GetProperty("publishedVersionNo").GetInt32().ShouldBe(2);

        var deactivate = await OkAsync(await client.PutAsync(
            $"/api/v1/workflows/{workflowId}",
            Json(new { name = "Atomic", isActive = false, rowVersion = detail.GetProperty("workflow").GetProperty("rowVersion").GetString() })));
        deactivate.GetProperty("workflow").GetProperty("isActive").GetBoolean().ShouldBeFalse();
        (await OkAsync(await client.GetAsync("/api/v1/workflows/published"))).GetArrayLength().ShouldBe(0);
        (await client.GetAsync($"/api/v1/workflows/{workflowId}/published")).StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await client.GetAsync("/api/v1/workflows/9999/published")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    // ---- permissions and audit

    [Fact]
    public async Task Permissions_manage_for_design_task_view_for_published_reads()
    {
        var admin = As();
        var a = await CreateStepAsync(admin, "A");
        var workflow = await CreateWorkflowAsync(admin, "Visible");
        var workflowId = WorkflowId(workflow);
        var draftVersion = await GetVersionAsync(admin, workflowId, DraftId(workflow));
        var saved = await SaveOkAsync(admin, workflowId, draftVersion, true, Place(StepId(a)));
        var published = await OkAsync(await PublishAsync(admin, workflowId, saved));
        var publishedId = VersionIdOf(published);
        var next = await OkAsync(await admin.PostAsync($"/api/v1/workflows/{workflowId}/versions", Json("{}")), HttpStatusCode.Created);

        const string viewer = @"KE\wfviewer";
        const string designer = @"KE\wfdesigner";
        foreach (var user in new[] { viewer, designer, @"KE\nobody" })
        {
            (await As(user).GetAsync("/api/v1/me")).StatusCode.ShouldBe(HttpStatusCode.OK);
        }

        await _factory.GrantRoleAsync(viewer, await _factory.CreateRoleAsync("Workflow reader", Permissions.Task.View));
        await _factory.GrantRoleAsync(designer, await _factory.CreateRoleAsync("Workflow designer", Permissions.Task.View, Permissions.Workflow.Manage));

        var reader = As(viewer);
        (await reader.GetAsync("/api/v1/workflows/published")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await reader.GetAsync($"/api/v1/workflows/{workflowId}/published")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await reader.GetAsync($"/api/v1/workflows/{workflowId}/versions/{publishedId}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await reader.GetAsync($"/api/v1/workflows/{workflowId}/versions/{VersionIdOf(next)}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await reader.GetAsync("/api/v1/workflows")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await reader.GetAsync($"/api/v1/workflows/{workflowId}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await reader.PostAsync("/api/v1/workflows", Json(new { name = "X" }))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await reader.PostAsync($"/api/v1/workflows/{workflowId}/versions/{VersionIdOf(next)}/publish", Json(new { rowVersion = VersionRowVersion(next) }))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await reader.GetAsync("/api/v1/step-definitions")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await reader.PostAsync("/api/v1/step-definitions", Json(new { title = "Nope" }))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        (await As(@"KE\nobody").GetAsync("/api/v1/workflows/published")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        var manager = As(designer);
        (await manager.GetAsync("/api/v1/workflows")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await manager.GetAsync($"/api/v1/workflows/{workflowId}/versions/{VersionIdOf(next)}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await manager.GetAsync("/api/v1/step-definitions")).StatusCode.ShouldBe(HttpStatusCode.OK);

        (await _factory.CreateClient().GetAsync("/api/v1/workflows/published")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Library_and_workflow_changes_are_audited()
    {
        var client = As();
        var step = await CreateStepAsync(client, "Audited step");
        await UpdateStepAsync(client, step, "Audited step 2", "changed");
        var workflow = await CreateWorkflowAsync(client, "Audited workflow");
        var workflowId = WorkflowId(workflow);
        var saved = await SaveOkAsync(client, workflowId, await GetVersionAsync(client, workflowId, DraftId(workflow)), true, Place(StepId(step)));
        var v1 = await OkAsync(await PublishAsync(client, workflowId, saved));
        var draft2 = await OkAsync(await client.PostAsync($"/api/v1/workflows/{workflowId}/versions", Json("{}")), HttpStatusCode.Created);
        await OkAsync(await PublishAsync(client, workflowId, draft2));
        v1.GetProperty("version").GetProperty("status").GetString().ShouldBe("Published");

        async Task<List<string>> EventsAsync(string objectType, int objectId)
        {
            var page = await ReadAsync(await client.GetAsync($"/api/v1/audit/events?objectType={objectType}&objectId={objectId}"));
            return [.. page.GetProperty("items").EnumerateArray().Select(e => e.GetProperty("eventType").GetString()!)];
        }

        var workflowEvents = await EventsAsync("WorkflowDefinition", workflowId);
        workflowEvents.Where(e => e != "FIELD_CHANGED").ToList().ShouldBe(
            ["WORKFLOW_DRAFT_CREATED", "WORKFLOW_DRAFT_SAVED", "WORKFLOW_PUBLISHED", "WORKFLOW_DRAFT_CREATED", "WORKFLOW_RETIRED", "WORKFLOW_PUBLISHED"]);

        var stepEvents = await EventsAsync("StepDefinition", StepId(step));
        stepEvents.ShouldContain("FIELD_CHANGED");
    }
}
