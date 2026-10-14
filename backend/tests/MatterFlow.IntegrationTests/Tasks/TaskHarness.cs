using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using MatterFlow.Audit.Domain;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Workflows;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace MatterFlow.IntegrationTests.Tasks;

/// <summary>
/// Test support for the Task endpoints against a real SQL Server: builds the configuration a Task needs (Matter, Project, Task Type with a request form,
/// workflows) through the real admin APIs and offers small helpers for calling the Task API as different users.
/// </summary>
public sealed class TaskHarness
{
    /// <summary>Request form: a checkbox, a text field required only when the checkbox is on, and a plain notes field.</summary>
    public const string RequestFormFields = """
        {"fields":[
          {"key":"requires_ocr","label":"Requires OCR?","control":"CHECKBOX"},
          {"key":"ocr_language","label":"OCR language","control":"TEXT","required":true,"showWhen":{"op":"isTrue","field":"requires_ocr"}},
          {"key":"notes","label":"Notes","control":"TEXT"}
        ]}
        """;

    /// <summary>Every permission a Data Technician style user holds on Tasks.</summary>
    public static readonly string[] AllTaskPermissions =
    [
        "Task.View", "Task.Create", "Task.Edit", "Task.Assign", "Task.SetPriority", "Task.ChangeStatus", "Task.Complete", "Task.Cancel",
        "Task.Reopen", "Task.Comment", "Workflow.Execute", "Workflow.StepReopen", "Matter.View",
    ];

    private int _counter;

    public TaskHarness(DatabaseApiFactory factory)
    {
        Factory = factory;
        Workflows = new WorkflowInstanceHarness(factory);
        Admin = As(DatabaseApiFactory.AdminAccount);
    }

    public DatabaseApiFactory Factory { get; }

    public WorkflowInstanceHarness Workflows { get; }

    public HttpClient Admin { get; }

    /// <summary>What most tests need: an active Matter with a Project, a Task Type, and an ordered 3-step and an unordered 2-step workflow.</summary>
    public sealed record World(
        int MatterId,
        int ProjectId,
        int TaskTypeId,
        int OrderedWorkflowId,
        int UnorderedWorkflowId,
        int[] OrderedStepDefinitionIds);

    public HttpClient As(string user, string? timeZone = null)
    {
        var client = Factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", user);
        if (timeZone is not null)
            client.DefaultRequestHeaders.Add("X-Time-Zone", timeZone);
        return client;
    }

    /// <summary>A provisioned user holding exactly the given permissions.</summary>
    public async Task<HttpClient> UserWithAsync(string user, params string[] permissions)
    {
        var client = As(user);
        (await client.GetAsync("/api/v1/me")).StatusCode.ShouldBe(HttpStatusCode.OK);
        var roleId = await Factory.CreateRoleAsync("Role " + user, permissions);
        await Factory.GrantRoleAsync(user, roleId);
        return client;
    }

    public async Task<int> UserIdAsync(string username)
    {
        var me = await ReadAsync(await As(username).GetAsync("/api/v1/me"));
        return me.GetProperty("userId").GetInt32();
    }

    public static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");

    public static StringContent Body(object value) => Json(JsonSerializer.Serialize(value));

    public static async Task<JsonElement> ReadAsync(HttpResponseMessage response) => await response.Content.ReadFromJsonAsync<JsonElement>();

    public static async Task<JsonElement> OkAsync(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(expected, body);
        return JsonDocument.Parse(body).RootElement;
    }

    public static async Task<JsonElement> ProblemAsync(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(status, body);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json", body);
        var problem = JsonDocument.Parse(body).RootElement;
        problem.GetProperty("code").GetString().ShouldBe(code, body);
        return problem;
    }

    // ---- configuration

    public async Task<int> CreateMatterAsync(string clientNumber = "343", string matterNumber = "12")
    {
        var existing = await OkAsync(await Admin.GetAsync($"/api/v1/clients?q={clientNumber}"));
        var clientId = existing.GetProperty("total").GetInt32() > 0
            ? existing.GetProperty("items")[0].GetProperty("clientId").GetInt32()
            : (await OkAsync(await Admin.PostAsJsonAsync("/api/v1/clients", new { clientNumber, name = "Acme Corp " + clientNumber }), HttpStatusCode.Created)).GetProperty("clientId").GetInt32();

        var matter = await OkAsync(await Admin.PostAsJsonAsync("/api/v1/matters", new { clientId, matterNumber, name = "Merger Review " + matterNumber }), HttpStatusCode.Created);
        return matter.GetProperty("matterId").GetInt32();
    }

    public async Task<int> CreatePodAsync(string name, params int[] memberUserIds)
    {
        var pod = await OkAsync(await Admin.PostAsJsonAsync("/api/v1/pods", new { name }), HttpStatusCode.Created);
        var podId = pod.GetProperty("pod").GetProperty("podId").GetInt32();
        if (memberUserIds.Length > 0)
            await OkAsync(await Admin.PostAsJsonAsync($"/api/v1/pods/{podId}/members", new { userIds = memberUserIds }));

        return podId;
    }

    public async Task SetProjectActiveAsync(int projectId, bool active)
    {
        var project = await OkAsync(await Admin.GetAsync($"/api/v1/projects/{projectId}"));
        await OkAsync(await Admin.PostAsJsonAsync($"/api/v1/projects/{projectId}/active", new { isActive = active, rowVersion = project.GetProperty("rowVersion").GetString() }));
    }

    public async Task<int> CreateProjectAsync(int matterId, string name = "Phase 1")
    {
        var project = await OkAsync(await Admin.PostAsJsonAsync("/api/v1/projects", new { matterId, name }), HttpStatusCode.Created);
        return project.GetProperty("projectId").GetInt32();
    }

    public async Task SetMatterActiveAsync(int matterId, bool active, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var matter = await OkAsync(await Admin.GetAsync($"/api/v1/matters/{matterId}"));
        var response = await Admin.PostAsJsonAsync($"/api/v1/matters/{matterId}/active", new { isActive = active, rowVersion = matter.GetProperty("rowVersion").GetString() });
        response.StatusCode.ShouldBe(expected, await response.Content.ReadAsStringAsync());
    }

    /// <summary>Creates a Task Type with <see cref="RequestFormFields"/> published (or no form) and the given eligible workflows.</summary>
    public async Task<int> CreateTaskTypeAsync(string name, int[] workflowIds, bool withForm = true)
    {
        var created = await OkAsync(
            await Admin.PostAsJsonAsync("/api/v1/task-types", new { name, eligibleWorkflowIds = workflowIds, defaultWorkflowDefinitionId = workflowIds[0] }),
            HttpStatusCode.Created);
        var taskTypeId = created.GetProperty("id").GetInt32();
        if (withForm)
        {
            var definitionId = created.GetProperty("formDefinitionId").GetInt32();
            var draft = await OkAsync(await Admin.PostAsync($"/api/v1/forms/{definitionId}/versions", Json("{}")), HttpStatusCode.Created);
            var versionId = draft.GetProperty("version").GetProperty("formVersionId").GetInt32();
            await OkAsync(await Admin.PutAsync($"/api/v1/forms/{definitionId}/versions/{versionId}", Json(RequestFormFields)));
            await OkAsync(await Admin.PostAsync($"/api/v1/forms/{definitionId}/versions/{versionId}/publish", null));
        }

        return taskTypeId;
    }

    public async Task<World> CreateWorldAsync()
    {
        var a = await Workflows.CreateStepAsync("Intake review", withInputForm: true);
        var b = await Workflows.CreateStepAsync("Processing");
        var c = await Workflows.CreateStepAsync("Quality check");
        var d = await Workflows.CreateStepAsync("Delivery");
        var ordered = await Workflows.CreatePublishedWorkflowAsync(
            "Ordered flow",
            true,
            new WorkflowInstanceHarness.Place(a),
            new WorkflowInstanceHarness.Place(b, Skippable: true, CommentRequired: true),
            new WorkflowInstanceHarness.Place(c));
        var unordered = await Workflows.CreatePublishedWorkflowAsync(
            "Unordered flow",
            false,
            new WorkflowInstanceHarness.Place(c),
            new WorkflowInstanceHarness.Place(d, Skippable: true));
        var matterId = await CreateMatterAsync();
        var projectId = await CreateProjectAsync(matterId);
        var typeId = await CreateTaskTypeAsync("Data Processing", [ordered.WorkflowId, unordered.WorkflowId]);
        return new World(matterId, projectId, typeId, ordered.WorkflowId, unordered.WorkflowId, [a, b, c]);
    }

    // ---- task calls

    public Dictionary<string, object?> NewTask(World w, bool ordered = true, string? title = null, Dictionary<string, object?>? extra = null)
    {
        var body = new Dictionary<string, object?>
        {
            ["matterId"] = w.MatterId,
            ["taskTypeId"] = w.TaskTypeId,
            ["workflowDefinitionId"] = ordered ? w.OrderedWorkflowId : w.UnorderedWorkflowId,
            ["title"] = title ?? $"Load custodian data {++_counter}",
            ["requestorName"] = "Pat Partner",
        };
        foreach (var (key, value) in extra ?? [])
            body[key] = value;

        return body;
    }

    public async Task<JsonElement> CreateTaskAsync(World w, bool ordered = true, Dictionary<string, object?>? extra = null, HttpClient? client = null)
    {
        var response = await (client ?? Admin).PostAsJsonAsync("/api/v1/tasks", NewTask(w, ordered, extra: extra));
        return await OkAsync(response, HttpStatusCode.Created);
    }

    public async Task<JsonElement> GetTaskAsync(long taskId, HttpClient? client = null) =>
        await OkAsync(await (client ?? Admin).GetAsync($"/api/v1/tasks/{taskId}"));

    public static long TaskId(JsonElement task) => task.GetProperty("taskId").GetInt64();

    public static string RowVersion(JsonElement task) => task.GetProperty("rowVersion").GetString()!;

    public static string Status(JsonElement task) => task.GetProperty("status").GetString()!;

    public static int[] StepIds(JsonElement task) =>
        [.. task.GetProperty("workflow").GetProperty("steps").EnumerateArray().Select(s => s.GetProperty("stepInstanceId").GetInt32())];

    public static string StepStatus(JsonElement task, int stepInstanceId) =>
        task.GetProperty("workflow").GetProperty("steps").EnumerateArray()
            .Single(s => s.GetProperty("stepInstanceId").GetInt32() == stepInstanceId).GetProperty("status").GetString()!;

    public static string WorkflowRowVersion(JsonElement task) => task.GetProperty("workflow").GetProperty("rowVersion").GetString()!;

    public async Task<JsonElement> PostAsync(long taskId, string action, object body, HttpClient? client = null, HttpStatusCode expected = HttpStatusCode.OK) =>
        await OkAsync(await (client ?? Admin).PostAsJsonAsync($"/api/v1/tasks/{taskId}/{action}", body), expected);

    public async Task<JsonElement> StatusAsync(JsonElement task, string status, string? comment = null, HttpClient? client = null) =>
        await PostAsync(TaskId(task), "status", new { status, comment, rowVersion = RowVersion(task) }, client);

    public async Task<JsonElement> CompleteAsync(JsonElement task, bool bulk = true, HttpClient? client = null) =>
        await PostAsync(TaskId(task), "complete", new { completeUnresolvedSteps = bulk, rowVersion = RowVersion(task) }, client);

    public async Task<JsonElement> StepAsync(JsonElement task, int stepInstanceId, string action, object? body = null, HttpClient? client = null, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var response = await (client ?? Admin).PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/workflow/steps/{stepInstanceId}/{action}", body ?? new { });
        var result = await OkAsync(response, expected);
        return expected == HttpStatusCode.OK ? result.GetProperty("task") : result;
    }

    /// <summary>Drives a freshly created Task to the wanted status through the API (Admin).</summary>
    public async Task<JsonElement> ReachAsync(World w, string status, bool ordered = false)
    {
        var task = await CreateTaskAsync(w, ordered);
        switch (status)
        {
            case "NEW":
                return task;
            case "IN_PROGRESS":
                return await StatusAsync(task, "IN_PROGRESS");
            case "ON_HOLD":
                return await StatusAsync(task, "ON_HOLD", "Waiting for the client");
            case "COMPLETED":
                return await CompleteAsync(task);
            case "CANCELLED":
                return await StatusAsync(task, "CANCELLED", "No longer needed");
            default:
                throw new ArgumentOutOfRangeException(nameof(status));
        }
    }

    // ---- inspection

    public Task<List<AuditEvent>> AuditAsync(long taskId) =>
        Factory.WithDbAsync(db => db.Set<AuditEvent>().AsNoTracking().Where(a => a.TaskId == taskId).OrderBy(a => a.Id).ToListAsync());

    public Task<List<AuditEvent>> AuditAsync(string eventType) =>
        Factory.WithDbAsync(db => db.Set<AuditEvent>().AsNoTracking().Where(a => a.EventType == eventType).OrderBy(a => a.Id).ToListAsync());

    public Task<int> ScalarAsync(string sql) =>
        Factory.WithDbAsync(async db =>
        {
            var rows = await db.Database.SqlQueryRaw<int>(sql).ToListAsync();
            return rows.Single();
        });

    public Task ExecuteAsync(string sql) => Factory.WithDbAsync(db => db.Database.ExecuteSqlRawAsync(sql));
}
