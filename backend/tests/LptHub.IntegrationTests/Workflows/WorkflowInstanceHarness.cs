using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using MatterFlow.Audit.Domain;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.WorkflowEngine.Contracts;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

namespace MatterFlow.IntegrationTests.Workflows;

/// <summary>
/// Test support for workflow execution against a real SQL Server: configures steps and workflows (published through the real admin API, so the
/// snapshots and form pins are the production ones) and drives <see cref="IWorkflowInstanceService"/> the way the Tasks module will, each call in
/// its own scope. The Tasks developer can reuse it for end-to-end task tests until the Tasks module has its own fixtures.
/// </summary>
public sealed class WorkflowInstanceHarness
{
    /// <summary>The form every "input" step gets: a required text field, a checkbox and a field shown only when the checkbox is on.</summary>
    public const string InputFormFields = """
        {"fields":[
          {"key":"note","label":"Note","control":"TEXT","required":true},
          {"key":"has_extra","label":"Has extra","control":"CHECKBOX"},
          {"key":"extra","label":"Extra","control":"TEXT","showWhen":{"op":"isTrue","field":"has_extra"}}
        ]}
        """;

    private readonly DatabaseApiFactory _factory;
    private readonly HttpClient _admin;

    public WorkflowInstanceHarness(DatabaseApiFactory factory)
    {
        _factory = factory;
        _admin = factory.CreateClient();
        _admin.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        _admin.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);
    }

    public DatabaseApiFactory Factory => _factory;

    public static StepActionContext Ctx(TaskStatusCode status = TaskStatusCode.InProgress, string? rowVersion = null) =>
        new(status, TaskId: 4242, MatterId: 7, ExpectedRowVersion: rowVersion);

    public static Dictionary<string, JsonElement> Values(string json) => JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json)!;

    /// <summary>A step placement in a workflow draft.</summary>
    public sealed record Place(int StepDefinitionId, bool Skippable = false, bool CommentRequired = false);

    // ---- configuration

    private static StringContent Json(object value) => new(JsonSerializer.Serialize(value), Encoding.UTF8, "application/json");

    private static StringContent Raw(string json) => new(json, Encoding.UTF8, "application/json");

    private static async Task<JsonElement> OkAsync(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    {
        response.StatusCode.ShouldBe(expected, await response.Content.ReadAsStringAsync());
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    /// <summary>Creates a library step; with <paramref name="withInputForm"/> it also gets a published input form (<see cref="InputFormFields"/>).</summary>
    public async Task<int> CreateStepAsync(string title, bool withInputForm = false, string instructions = "Do the thing.")
    {
        var step = await OkAsync(await _admin.PostAsync("/api/v1/step-definitions", Json(new { title, description = title + " description", instructions })), HttpStatusCode.Created);
        if (withInputForm)
        {
            var definitionId = step.GetProperty("formDefinitionId").GetInt32();
            var draft = await OkAsync(await _admin.PostAsync($"/api/v1/forms/{definitionId}/versions", Raw("{}")), HttpStatusCode.Created);
            var versionId = draft.GetProperty("version").GetProperty("formVersionId").GetInt32();
            (await FormDraftApi.SaveAsync(_admin, definitionId, versionId, InputFormFields)).StatusCode.ShouldBe(HttpStatusCode.OK);
            (await FormDraftApi.PublishAsync(_admin, definitionId, versionId)).StatusCode.ShouldBe(HttpStatusCode.OK);
        }

        return step.GetProperty("stepDefinitionId").GetInt32();
    }

    /// <summary>Edits a library step's title and instructions (never affects published versions or running instances).</summary>
    public async Task RenameStepAsync(int stepDefinitionId, string title, string instructions)
    {
        var current = await OkAsync(await _admin.GetAsync($"/api/v1/step-definitions/{stepDefinitionId}"));
        await OkAsync(await _admin.PutAsync(
            $"/api/v1/step-definitions/{stepDefinitionId}",
            Json(new { title, description = "d", instructions, isActive = true, rowVersion = current.GetProperty("rowVersion").GetString() })));
    }

    /// <summary>Creates a workflow and publishes its first version. Returns the workflow id and the published version id.</summary>
    public async Task<(int WorkflowId, int VersionId)> CreatePublishedWorkflowAsync(string name, bool ordered, params Place[] steps)
    {
        var created = await OkAsync(await _admin.PostAsync("/api/v1/workflows", Json(new { name, description = name, isOrdered = ordered })), HttpStatusCode.Created);
        var workflowId = created.GetProperty("workflow").GetProperty("workflowDefinitionId").GetInt32();
        var draftId = created.GetProperty("workflow").GetProperty("draftVersionId").GetInt32();
        return (workflowId, await SaveAndPublishAsync(workflowId, draftId, ordered, steps));
    }

    /// <summary>Starts a new draft from the published version, replaces its steps and publishes it (the old version becomes RETIRED).</summary>
    public async Task<int> PublishNextVersionAsync(int workflowId, bool ordered, params Place[] steps)
    {
        var draft = await OkAsync(await _admin.PostAsync($"/api/v1/workflows/{workflowId}/versions", Raw("{}")), HttpStatusCode.Created);
        return await SaveAndPublishAsync(workflowId, draft.GetProperty("version").GetProperty("workflowVersionId").GetInt32(), ordered, steps);
    }

    private async Task<int> SaveAndPublishAsync(int workflowId, int versionId, bool ordered, Place[] steps)
    {
        var version = await OkAsync(await _admin.GetAsync($"/api/v1/workflows/{workflowId}/versions/{versionId}"));
        var rowVersion = version.GetProperty("version").GetProperty("rowVersion").GetString();
        var placements = steps.Select(s => new { sourceStepDefinitionId = s.StepDefinitionId, isSkippable = s.Skippable, skipCommentRequired = s.CommentRequired }).ToArray();
        var saved = await OkAsync(await _admin.PutAsync($"/api/v1/workflows/{workflowId}/versions/{versionId}", Json(new { isOrdered = ordered, steps = placements, rowVersion })));
        var publishVersion = saved.GetProperty("version").GetProperty("rowVersion").GetString();
        await OkAsync(await _admin.PostAsync($"/api/v1/workflows/{workflowId}/versions/{versionId}/publish", Json(new { rowVersion = publishVersion })));
        return versionId;
    }

    // ---- driving the service

    /// <summary>Runs <paramref name="action"/> with the service of a fresh scope (like one request).</summary>
    public async Task<T> WithServiceAsync<T>(Func<IWorkflowInstanceService, Task<T>> action)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        return await action(scope.ServiceProvider.GetRequiredService<IWorkflowInstanceService>());
    }

    /// <summary>Runs <paramref name="action"/> inside one transaction of one scope, committing only when it returns true (the Tasks module's shape).</summary>
    public async Task<T> InTransactionAsync<T>(Func<DbContext, IWorkflowInstanceService, Task<T>> action, bool commit)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DbContext>();
        await using var tx = await db.Database.BeginTransactionAsync();
        var result = await action(db, scope.ServiceProvider.GetRequiredService<IWorkflowInstanceService>());
        if (commit)
        {
            await tx.CommitAsync();
        }

        return result;
    }

    public async Task<long> InstantiateAsync(int versionId)
    {
        var result = await WithServiceAsync(s => s.InstantiateAsync(versionId));
        result.IsSuccess.ShouldBeTrue(result.Error?.Message);
        return result.Value;
    }

    public async Task<WorkflowInstanceView> GetAsync(long instanceId)
    {
        var result = await WithServiceAsync(s => s.GetAsync(instanceId));
        result.IsSuccess.ShouldBeTrue(result.Error?.Message);
        return result.Value;
    }

    /// <summary>Returns the successful outcome or fails the test with the error.</summary>
    public static StepActionOutcome Ok(Result<StepActionOutcome> result)
    {
        result.IsSuccess.ShouldBeTrue($"{result.Error?.Code}: {result.Error?.Message}");
        return result.Value;
    }

    public Task<StepActionOutcome> StartAsync(long instanceId, int stepId, StepActionContext? ctx = null) =>
        WithServiceAsync(async s => Ok(await s.StartStepAsync(instanceId, stepId, ctx ?? Ctx())));

    public Task<StepActionOutcome> CompleteAsync(long instanceId, int stepId, string? valuesJson = null, StepActionContext? ctx = null) =>
        WithServiceAsync(async s => Ok(await s.CompleteStepAsync(instanceId, stepId, valuesJson is null ? null : Values(valuesJson), ctx ?? Ctx())));

    public Task<StepActionOutcome> SkipAsync(long instanceId, int stepId, string? comment, StepActionContext? ctx = null) =>
        WithServiceAsync(async s => Ok(await s.SkipStepAsync(instanceId, stepId, comment, ctx ?? Ctx())));

    public Task<StepActionOutcome> ReopenAsync(long instanceId, int stepId, StepActionContext? ctx = null) =>
        WithServiceAsync(async s => Ok(await s.ReopenStepAsync(instanceId, stepId, ctx ?? Ctx())));

    // ---- inspection

    public Task<List<AuditEvent>> AuditAsync(string? eventTypePrefix = "STEP_") =>
        _factory.WithDbAsync(db => db.Set<AuditEvent>().AsNoTracking()
            .Where(a => a.ObjectType == "StepInstance" && (eventTypePrefix == null || a.EventType.StartsWith(eventTypePrefix)))
            .OrderBy(a => a.Id)
            .ToListAsync());
}
