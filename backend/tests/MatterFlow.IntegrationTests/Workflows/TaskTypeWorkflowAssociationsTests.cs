using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using MatterFlow.Identity.Contracts;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;

namespace MatterFlow.IntegrationTests.Workflows;

/// <summary>
/// The model Task Type -> eligible Workflows (one default) -> Steps on the three tabs of the Task Types admin page, against a real SQL
/// Server through the full HTTP pipeline: the Task types of each workflow (default marker, inactive flag), the <c>taskTypeId</c> and
/// <c>stepId</c> filters of the workflow list, the <c>workflowId</c> filter of the task type list, the distinct-workflow usage count of
/// the step list, and the permission of each endpoint.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskTypeWorkflowAssociationsTests(SqlServerFixture sql) : IAsyncLifetime
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

    private static StringContent Json(object value) => new(JsonSerializer.Serialize(value), Encoding.UTF8, "application/json");

    private static async Task<JsonElement> OkAsync(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    {
        response.StatusCode.ShouldBe(expected, await response.Content.ReadAsStringAsync());
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private sealed record Fixture(
        int StepA,
        int StepB,
        int StepC,
        int W1,
        int W2,
        int W3,
        int T1,
        int T2,
        int T3);

    private async Task<int> CreateStepAsync(HttpClient client, string title)
    {
        var step = await OkAsync(await client.PostAsync("/api/v1/step-definitions", Json(new { title, description = title })), HttpStatusCode.Created);
        return step.GetProperty("stepDefinitionId").GetInt32();
    }

    /// <summary>Creates a workflow and fills its first draft with the steps; <paramref name="publish"/> publishes it.</summary>
    private async Task<int> CreateWorkflowAsync(HttpClient client, string name, bool publish, params int[] steps)
    {
        var created = await OkAsync(await client.PostAsync("/api/v1/workflows", Json(new { name, isOrdered = true })), HttpStatusCode.Created);
        var id = created.GetProperty("workflow").GetProperty("workflowDefinitionId").GetInt32();
        if (steps.Length == 0)
        {
            return id;
        }

        await SaveAndPublishAsync(client, id, created.GetProperty("workflow").GetProperty("draftVersionId").GetInt32(), publish, steps);
        return id;
    }

    private static async Task SaveAndPublishAsync(HttpClient client, int workflowId, int draftVersionId, bool publish, int[] steps)
    {
        var version = await OkAsync(await client.GetAsync($"/api/v1/workflows/{workflowId}/versions/{draftVersionId}"));
        var saved = await OkAsync(await client.PutAsync(
            $"/api/v1/workflows/{workflowId}/versions/{draftVersionId}",
            Json(new
            {
                isOrdered = true,
                steps = steps.Select(s => new { sourceStepDefinitionId = s, isSkippable = false, skipCommentRequired = false }),
                rowVersion = version.GetProperty("version").GetProperty("rowVersion").GetString(),
            })));
        if (publish)
        {
            await OkAsync(await client.PostAsync(
                $"/api/v1/workflows/{workflowId}/versions/{draftVersionId}/publish",
                Json(new { rowVersion = saved.GetProperty("version").GetProperty("rowVersion").GetString() })));
        }
    }

    private static async Task<int> CreateTaskTypeAsync(HttpClient client, string name, int[] workflows, int? defaultWorkflow)
    {
        var created = await OkAsync(
            await client.PostAsync("/api/v1/task-types", Json(new { name, eligibleWorkflowIds = workflows, defaultWorkflowDefinitionId = defaultWorkflow })),
            HttpStatusCode.Created);
        return created.GetProperty("id").GetInt32();
    }

    /// <summary>
    /// Steps A (in W1 twice: published v1 and v2, and in W2), B (W1 only) and C (unused). Workflows W1 (A,B; two versions), W2 (A) and W3
    /// (no steps). Task types T1 (W1 default, W2), T2 (W1, W2 default) and T3 (none).
    /// </summary>
    private async Task<Fixture> SeedAsync(HttpClient admin)
    {
        var a = await CreateStepAsync(admin, "Step A");
        var b = await CreateStepAsync(admin, "Step B");
        var c = await CreateStepAsync(admin, "Step C");
        var w1 = await CreateWorkflowAsync(admin, "Workflow 1", publish: true, a, b);
        var w2 = await CreateWorkflowAsync(admin, "Workflow 2", publish: true, a);
        var w3 = await CreateWorkflowAsync(admin, "Workflow 3", publish: false);

        // A second version of W1 that also contains step A: the step still counts W1 once.
        var next = await OkAsync(await admin.PostAsync($"/api/v1/workflows/{w1}/versions", Json(new { })), HttpStatusCode.Created);
        await SaveAndPublishAsync(admin, w1, next.GetProperty("version").GetProperty("workflowVersionId").GetInt32(), publish: true, [a, b]);

        var t1 = await CreateTaskTypeAsync(admin, "Type 1", [w1, w2], w1);
        var t2 = await CreateTaskTypeAsync(admin, "Type 2", [w1, w2], w2);
        var t3 = await CreateTaskTypeAsync(admin, "Type 3", [], null);
        return new Fixture(a, b, c, w1, w2, w3, t1, t2, t3);
    }

    private static string[] Names(JsonElement page, string nameProperty) =>
        [.. page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty(nameProperty).GetString()!)];

    private static JsonElement Item(JsonElement page, string nameProperty, string name) =>
        page.GetProperty("items").EnumerateArray().Single(i => i.GetProperty(nameProperty).GetString() == name);

    [Fact]
    public async Task Workflow_list_carries_its_task_types_with_the_default_marker()
    {
        var admin = As();
        var f = await SeedAsync(admin);

        var page = await OkAsync(await admin.GetAsync("/api/v1/workflows"));
        var w1 = Item(page, "name", "Workflow 1").GetProperty("taskTypes");
        w1.EnumerateArray().Select(t => t.GetProperty("name").GetString()).ShouldBe(["Type 1", "Type 2"]);
        w1[0].GetProperty("taskTypeId").GetInt32().ShouldBe(f.T1);
        w1[0].GetProperty("isDefault").GetBoolean().ShouldBeTrue("Type 1 defaults to Workflow 1");
        w1[1].GetProperty("isDefault").GetBoolean().ShouldBeFalse("Type 2 defaults to Workflow 2");
        w1[0].GetProperty("isActive").GetBoolean().ShouldBeTrue();

        var w2 = Item(page, "name", "Workflow 2").GetProperty("taskTypes");
        w2.EnumerateArray().Select(t => (t.GetProperty("name").GetString(), t.GetProperty("isDefault").GetBoolean()))
            .ShouldBe([("Type 1", false), ("Type 2", true)]);
        Item(page, "name", "Workflow 3").GetProperty("taskTypes").GetArrayLength().ShouldBe(0);

        // A deactivated task type stays listed and says so.
        var type2 = await OkAsync(await admin.GetAsync($"/api/v1/task-types/{f.T2}"));
        await OkAsync(await admin.PutAsync(
            $"/api/v1/task-types/{f.T2}",
            Json(new
            {
                name = "Type 2",
                iconKey = type2.GetProperty("iconKey").GetString(),
                isActive = false,
                eligibleWorkflowIds = new[] { f.W1, f.W2 },
                defaultWorkflowDefinitionId = f.W2,
                rowVersion = type2.GetProperty("rowVersion").GetString(),
            })));
        var after = await OkAsync(await admin.GetAsync("/api/v1/workflows"));
        Item(after, "name", "Workflow 1").GetProperty("taskTypes")[1].GetProperty("isActive").GetBoolean().ShouldBeFalse();

        // The detail (create, edit and get answer with it) carries them too.
        var detail = await OkAsync(await admin.GetAsync($"/api/v1/workflows/{f.W2}"));
        detail.GetProperty("workflow").GetProperty("taskTypes").GetArrayLength().ShouldBe(2);
    }

    [Fact]
    public async Task Workflow_list_filters_by_task_type_and_by_step()
    {
        var admin = As();
        var f = await SeedAsync(admin);

        Names(await OkAsync(await admin.GetAsync($"/api/v1/workflows?taskTypeId={f.T1}")), "name").ShouldBe(["Workflow 1", "Workflow 2"]);
        var none = await OkAsync(await admin.GetAsync($"/api/v1/workflows?taskTypeId={f.T3}"));
        none.GetProperty("total").GetInt32().ShouldBe(0);
        (await OkAsync(await admin.GetAsync("/api/v1/workflows?taskTypeId=99999"))).GetProperty("total").GetInt32().ShouldBe(0);

        // Steps: A is in W1 (two versions) and W2; B only in W1; C nowhere.
        var withA = await OkAsync(await admin.GetAsync($"/api/v1/workflows?stepId={f.StepA}"));
        Names(withA, "name").ShouldBe(["Workflow 1", "Workflow 2"]);
        withA.GetProperty("total").GetInt32().ShouldBe(2, "a workflow with several versions of the step is one row");
        Names(await OkAsync(await admin.GetAsync($"/api/v1/workflows?stepId={f.StepB}")), "name").ShouldBe(["Workflow 1"]);
        (await OkAsync(await admin.GetAsync($"/api/v1/workflows?stepId={f.StepC}"))).GetProperty("total").GetInt32().ShouldBe(0);

        // Combined with the other filters, paging and sort.
        Names(await OkAsync(await admin.GetAsync($"/api/v1/workflows?taskTypeId={f.T1}&stepId={f.StepB}")), "name").ShouldBe(["Workflow 1"]);
        Names(await OkAsync(await admin.GetAsync($"/api/v1/workflows?taskTypeId={f.T1}&sort=-name")), "name").ShouldBe(["Workflow 2", "Workflow 1"]);
        var paged = await OkAsync(await admin.GetAsync($"/api/v1/workflows?taskTypeId={f.T1}&page=2&pageSize=1"));
        paged.GetProperty("total").GetInt32().ShouldBe(2);
        Names(paged, "name").ShouldBe(["Workflow 2"]);
        Names(await OkAsync(await admin.GetAsync($"/api/v1/workflows?taskTypeId={f.T1}&q=Workflow 2")), "name").ShouldBe(["Workflow 2"]);

        (await admin.GetAsync("/api/v1/workflows?taskTypeId=abc")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await admin.GetAsync("/api/v1/workflows?bogus=1")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Task_type_list_filters_by_workflow()
    {
        var admin = As();
        var f = await SeedAsync(admin);

        Names(await ReadListAsync(admin, $"/api/v1/task-types?workflowId={f.W2}"), "name").ShouldBe(["Type 1", "Type 2"]);
        Names(await ReadListAsync(admin, $"/api/v1/task-types?workflowId={f.W3}"), "name").ShouldBeEmpty();
        Names(await ReadListAsync(admin, "/api/v1/task-types?workflowId=99999"), "name").ShouldBeEmpty();
        Names(await ReadListAsync(admin, "/api/v1/task-types"), "name").ShouldBe(["Type 1", "Type 2", "Type 3"]);
        (await admin.GetAsync("/api/v1/task-types?workflowId=abc")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    private static async Task<JsonElement> ReadListAsync(HttpClient client, string url)
    {
        var array = await OkAsync(await client.GetAsync(url));
        // The task type list is a plain array; wrap it like a page so the helpers read both.
        return JsonSerializer.SerializeToElement(new { items = array });
    }

    [Fact]
    public async Task Step_list_counts_distinct_workflows_and_sorts_by_them()
    {
        var admin = As();
        var f = await SeedAsync(admin);

        var page = await OkAsync(await admin.GetAsync("/api/v1/step-definitions"));
        var a = Item(page, "title", "Step A");
        a.GetProperty("usedInWorkflows").GetInt32().ShouldBe(2);
        a.GetProperty("usedInVersions").GetInt32().ShouldBe(3, "W1 v1, W1 v2 and W2 v1");
        Item(page, "title", "Step B").GetProperty("usedInWorkflows").GetInt32().ShouldBe(1);
        Item(page, "title", "Step C").GetProperty("usedInWorkflows").GetInt32().ShouldBe(0);

        Names(await OkAsync(await admin.GetAsync("/api/v1/step-definitions?sort=-usedInWorkflows")), "title").ShouldBe(["Step A", "Step B", "Step C"]);
        Names(await OkAsync(await admin.GetAsync("/api/v1/step-definitions?sort=usedInWorkflows")), "title").ShouldBe(["Step C", "Step B", "Step A"]);
        (await admin.GetAsync("/api/v1/step-definitions?sort=usedIn")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        f.StepC.ShouldBeGreaterThan(0);
    }

    [Fact]
    public async Task Each_list_needs_the_permission_it_had_before()
    {
        var admin = As();
        var f = await SeedAsync(admin);

        const string taskTypeAdmin = @"KE\ttadmin";
        const string workflowAdmin = @"KE\wfadmin";
        foreach (var user in new[] { taskTypeAdmin, workflowAdmin })
        {
            (await As(user).GetAsync("/api/v1/me")).StatusCode.ShouldBe(HttpStatusCode.OK);
        }

        await _factory.GrantRoleAsync(taskTypeAdmin, await _factory.CreateRoleAsync("Task type admin", Permissions.Task.View, Permissions.TaskType.Manage));
        await _factory.GrantRoleAsync(workflowAdmin, await _factory.CreateRoleAsync("Workflow admin", Permissions.Workflow.Manage));

        // Task Types tab: Task.View reads the list (and its workflow filter); the workflow and step lists stay closed.
        var types = As(taskTypeAdmin);
        (await types.GetAsync($"/api/v1/task-types?workflowId={f.W1}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await types.GetAsync("/api/v1/workflows")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await types.GetAsync($"/api/v1/workflows?taskTypeId={f.T1}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await types.GetAsync("/api/v1/step-definitions")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        // Workflows and Workflow Steps tabs: Workflow.Manage reads both lists, task type names included, without reading task types.
        var workflows = As(workflowAdmin);
        var page = await OkAsync(await workflows.GetAsync($"/api/v1/workflows?taskTypeId={f.T1}"));
        Names(page, "name").ShouldBe(["Workflow 1", "Workflow 2"]);
        Item(page, "name", "Workflow 1").GetProperty("taskTypes").GetArrayLength().ShouldBe(2);
        (await workflows.GetAsync($"/api/v1/workflows?stepId={f.StepA}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        Item(await OkAsync(await workflows.GetAsync("/api/v1/step-definitions")), "title", "Step A").GetProperty("usedInWorkflows").GetInt32().ShouldBe(2);
        (await workflows.GetAsync("/api/v1/task-types")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        (await _factory.CreateClient().GetAsync("/api/v1/workflows")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }
}
