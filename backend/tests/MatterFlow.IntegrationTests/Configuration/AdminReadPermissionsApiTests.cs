using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using MatterFlow.Identity.Contracts;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;

namespace MatterFlow.IntegrationTests.Configuration;

/// <summary>
/// TY-P #417: each administration permission is enough to READ what it manages, so a person with only that permission can use its screens without
/// <c>Task.View</c>: <c>TaskType.Manage</c> reads Task Types and their request form, <c>Workflow.Manage</c> reads step definitions and the step
/// forms, <c>AssetType.Manage</c> reads Asset Types, link roles and the asset type forms, <c>CustomField.Manage</c> reads the custom field forms.
/// Every case: the manage-only person gets 200, a person with another administration permission (or none) gets 403 <c>PERMISSION_DENIED</c>, and
/// <c>Task.View</c> keeps its reads. A form is still read or designed only by the permission of its owner kind (service rule).
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class AdminReadPermissionsApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private int _taskTypeId;
    private int _taskTypeForm;
    private int _workflowId;
    private int _stepId;
    private int _stepForm;
    private int _assetTypeId;
    private int _assetTypeForm;
    private int _clientForm;
    private int _publishedVersion;
    private int _draftVersion;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        var admin = As();

        var taskType = await OkAsync(await admin.PostAsJsonAsync("/api/v1/task-types", new { name = "Manage-only type" }), HttpStatusCode.Created);
        _taskTypeId = taskType.GetProperty("id").GetInt32();
        _taskTypeForm = await EnsureAsync(admin, "TaskType", _taskTypeId);
        _publishedVersion = await PublishAsync(admin, _taskTypeForm);
        _draftVersion = (await OkAsync(await admin.PostAsync($"/api/v1/forms/{_taskTypeForm}/versions", Json("{}")), HttpStatusCode.Created))
            .GetProperty("version").GetProperty("formVersionId").GetInt32();

        var step = await OkAsync(
            await admin.PostAsJsonAsync("/api/v1/step-definitions", new { title = "Manage-only step", description = "d", instructions = "Do it." }),
            HttpStatusCode.Created);
        _stepId = step.GetProperty("stepDefinitionId").GetInt32();
        _stepForm = step.GetProperty("formDefinitionId").GetInt32();

        _workflowId = (await OkAsync(await admin.PostAsJsonAsync("/api/v1/workflows", new { name = "Manage-only flow", description = (string?)null, isOrdered = true }), HttpStatusCode.Created))
            .GetProperty("workflow").GetProperty("workflowDefinitionId").GetInt32();

        var assetType = await OkAsync(await admin.PostAsJsonAsync("/api/v1/asset-types", new { name = "Manage-only asset type" }), HttpStatusCode.Created);
        _assetTypeId = assetType.GetProperty("assetTypeId").GetInt32();
        _assetTypeForm = await EnsureAsync(admin, "AssetType", _assetTypeId);
        _clientForm = await EnsureAsync(admin, "Client", null);
    }

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
        (await client.GetAsync("/api/v1/me")).StatusCode.ShouldBe(HttpStatusCode.OK);
        await _factory.GrantRoleAsync(user, await _factory.CreateRoleAsync("Role " + user, permissions));
        return client;
    }

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");

    private static async Task<JsonElement> OkAsync(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    {
        response.StatusCode.ShouldBe(expected, await response.Content.ReadAsStringAsync());
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task<int> EnsureAsync(HttpClient client, string kind, int? ownerId)
    {
        var body = ownerId is null ? $$"""{"ownerKind":"{{kind}}"}""" : $$"""{"ownerKind":"{{kind}}","ownerId":{{ownerId}}}""";
        return (await OkAsync(await client.PostAsync("/api/v1/forms", Json(body)))).GetProperty("formDefinitionId").GetInt32();
    }

    private static async Task<int> PublishAsync(HttpClient client, int definitionId)
    {
        var draft = await OkAsync(await client.PostAsync($"/api/v1/forms/{definitionId}/versions", Json("{}")), HttpStatusCode.Created);
        var versionId = draft.GetProperty("version").GetProperty("formVersionId").GetInt32();
        (await FormDraftApi.SaveAsync(client, definitionId, versionId, """{"fields":[{"key":"title","label":"TITLE","control":"TEXT"}]}""")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await FormDraftApi.PublishAsync(client, definitionId, versionId)).StatusCode.ShouldBe(HttpStatusCode.OK);
        return versionId;
    }

    private static async Task ShouldBeAsync(HttpClient client, string url, HttpStatusCode expected)
    {
        var response = await client.GetAsync(url);
        response.StatusCode.ShouldBe(expected, $"{url}: {await response.Content.ReadAsStringAsync()}");
        if (expected == HttpStatusCode.Forbidden)
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString().ShouldBe("PERMISSION_DENIED", url);
    }

    [Fact]
    public async Task TaskType_Manage_alone_reads_task_types_and_the_request_form()
    {
        var manager = await UserWithAsync(@"KE\ttonly", Permissions.TaskType.Manage);
        await ShouldBeAsync(manager, "/api/v1/task-types", HttpStatusCode.OK);
        await ShouldBeAsync(manager, $"/api/v1/task-types/{_taskTypeId}", HttpStatusCode.OK);
        await ShouldBeAsync(manager, $"/api/v1/forms/by-owner?ownerKind=TaskType&ownerId={_taskTypeId}", HttpStatusCode.OK);
        await ShouldBeAsync(manager, $"/api/v1/forms/{_taskTypeForm}", HttpStatusCode.OK);
        await ShouldBeAsync(manager, $"/api/v1/forms/{_taskTypeForm}/versions", HttpStatusCode.OK);
        await ShouldBeAsync(manager, $"/api/v1/forms/{_taskTypeForm}/published", HttpStatusCode.OK);
        await ShouldBeAsync(manager, $"/api/v1/forms/versions/{_publishedVersion}/schema", HttpStatusCode.OK);
        await ShouldBeAsync(manager, $"/api/v1/forms/versions/{_draftVersion}/schema", HttpStatusCode.OK);
        await ShouldBeAsync(manager, $"/api/v1/forms/{_taskTypeForm}/versions/{_draftVersion}/diff?against={_publishedVersion}", HttpStatusCode.OK);

        // The number of open tasks is left out (null), not made up, without Task.View.
        (await OkAsync(await manager.GetAsync($"/api/v1/task-types/{_taskTypeId}"))).GetProperty("openTaskCount").ValueKind.ShouldBe(JsonValueKind.Null);

        // Writing is the type and its own form (the owner-kind rule), without Task.View.
        (await manager.PostAsync($"/api/v1/forms/{_taskTypeForm}/versions", Json("{}"))).StatusCode.ShouldBe(HttpStatusCode.Conflict); // a draft is already open
        (await manager.PostAsJsonAsync("/api/v1/task-types", new { name = "By a manager without Task.View" })).StatusCode.ShouldBe(HttpStatusCode.Created);

        // Nothing else of the area opens: workflows, steps, asset types, the other owners' forms.
        await ShouldBeAsync(manager, "/api/v1/workflows", HttpStatusCode.OK); // the list names and offers the eligible workflows
        await ShouldBeAsync(manager, $"/api/v1/workflows/{_workflowId}", HttpStatusCode.Forbidden);
        await ShouldBeAsync(manager, "/api/v1/step-definitions", HttpStatusCode.Forbidden);
        await ShouldBeAsync(manager, "/api/v1/asset-types", HttpStatusCode.Forbidden);
        await ShouldBeAsync(manager, "/api/v1/asset-link-roles", HttpStatusCode.Forbidden);
        await ShouldBeAsync(manager, $"/api/v1/forms/by-owner?ownerKind=Step&ownerId={_stepId}", HttpStatusCode.Forbidden);
        await ShouldBeAsync(manager, $"/api/v1/forms/{_stepForm}", HttpStatusCode.Forbidden);
        await ShouldBeAsync(manager, "/api/v1/forms/by-owner?ownerKind=Client", HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Workflow_Manage_alone_reads_steps_and_the_step_input_forms()
    {
        var designer = await UserWithAsync(@"KE\wfonly", Permissions.Workflow.Manage);
        await ShouldBeAsync(designer, "/api/v1/step-definitions", HttpStatusCode.OK);
        await ShouldBeAsync(designer, $"/api/v1/step-definitions/{_stepId}", HttpStatusCode.OK);
        await ShouldBeAsync(designer, "/api/v1/step-definitions/tags", HttpStatusCode.OK);
        await ShouldBeAsync(designer, "/api/v1/workflows", HttpStatusCode.OK);
        await ShouldBeAsync(designer, $"/api/v1/forms/by-owner?ownerKind=Step&ownerId={_stepId}", HttpStatusCode.OK);
        await ShouldBeAsync(designer, $"/api/v1/forms/{_stepForm}", HttpStatusCode.OK);
        await ShouldBeAsync(designer, $"/api/v1/forms/{_stepForm}/versions", HttpStatusCode.OK);

        // The step's own form can be designed without Task.View; the form of a task type cannot be read or designed.
        var draft = await designer.PostAsync($"/api/v1/forms/{_stepForm}/versions", Json("{}"));
        draft.StatusCode.ShouldBe(HttpStatusCode.Created, await draft.Content.ReadAsStringAsync());
        await ShouldBeAsync(designer, "/api/v1/task-types", HttpStatusCode.Forbidden);
        await ShouldBeAsync(designer, $"/api/v1/forms/{_taskTypeForm}", HttpStatusCode.Forbidden);
        await ShouldBeAsync(designer, $"/api/v1/forms/by-owner?ownerKind=TaskType&ownerId={_taskTypeId}", HttpStatusCode.Forbidden);
        (await designer.PostAsync($"/api/v1/forms/{_taskTypeForm}/versions", Json("{}"))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task AssetType_Manage_alone_reads_asset_types_link_roles_and_the_asset_type_forms()
    {
        var manager = await UserWithAsync(@"KE\atonly", Permissions.AssetType.Manage);
        await ShouldBeAsync(manager, "/api/v1/asset-types", HttpStatusCode.OK);
        await ShouldBeAsync(manager, $"/api/v1/asset-types/{_assetTypeId}", HttpStatusCode.OK);
        await ShouldBeAsync(manager, "/api/v1/asset-link-roles", HttpStatusCode.OK);
        await ShouldBeAsync(manager, $"/api/v1/forms/by-owner?ownerKind=AssetType&ownerId={_assetTypeId}", HttpStatusCode.OK);
        await ShouldBeAsync(manager, $"/api/v1/forms/{_assetTypeForm}/versions", HttpStatusCode.OK);
        (await manager.PostAsync($"/api/v1/forms/{_assetTypeForm}/versions", Json("{}"))).StatusCode.ShouldBe(HttpStatusCode.Created);
        (await manager.PostAsJsonAsync("/api/v1/asset-types", new { name = "By a manager without Asset.View" })).StatusCode.ShouldBe(HttpStatusCode.Created);

        await ShouldBeAsync(manager, "/api/v1/task-types", HttpStatusCode.Forbidden);
        await ShouldBeAsync(manager, $"/api/v1/forms/{_taskTypeForm}", HttpStatusCode.Forbidden);
        await ShouldBeAsync(manager, $"/api/v1/forms/{_clientForm}", HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task CustomField_Manage_alone_reads_and_designs_the_custom_field_forms()
    {
        var manager = await UserWithAsync(@"KE\cfonly", Permissions.CustomField.Manage);
        await ShouldBeAsync(manager, "/api/v1/forms/by-owner?ownerKind=Client", HttpStatusCode.OK);
        await ShouldBeAsync(manager, $"/api/v1/forms/{_clientForm}", HttpStatusCode.OK);
        await ShouldBeAsync(manager, $"/api/v1/forms/{_clientForm}/versions", HttpStatusCode.OK);
        (await manager.PostAsync($"/api/v1/forms/{_clientForm}/versions", Json("{}"))).StatusCode.ShouldBe(HttpStatusCode.Created);

        await ShouldBeAsync(manager, "/api/v1/task-types", HttpStatusCode.Forbidden);
        await ShouldBeAsync(manager, "/api/v1/asset-types", HttpStatusCode.Forbidden);
        await ShouldBeAsync(manager, $"/api/v1/forms/{_taskTypeForm}", HttpStatusCode.Forbidden);
        await ShouldBeAsync(manager, $"/api/v1/forms/by-owner?ownerKind=AssetType&ownerId={_assetTypeId}", HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Task_View_alone_keeps_its_reads_and_gets_no_design_access_and_no_permission_gets_nothing()
    {
        var viewer = await UserWithAsync(@"KE\viewer", Permissions.Task.View);
        await ShouldBeAsync(viewer, "/api/v1/task-types", HttpStatusCode.OK);
        await ShouldBeAsync(viewer, $"/api/v1/task-types/{_taskTypeId}", HttpStatusCode.OK);
        await ShouldBeAsync(viewer, "/api/v1/asset-link-roles", HttpStatusCode.OK);
        await ShouldBeAsync(viewer, $"/api/v1/forms/{_taskTypeForm}/published", HttpStatusCode.OK);
        await ShouldBeAsync(viewer, $"/api/v1/forms/versions/{_publishedVersion}/schema", HttpStatusCode.OK);
        await ShouldBeAsync(viewer, $"/api/v1/forms/{_taskTypeForm}", HttpStatusCode.Forbidden);
        await ShouldBeAsync(viewer, $"/api/v1/forms/versions/{_draftVersion}/schema", HttpStatusCode.Forbidden);
        await ShouldBeAsync(viewer, "/api/v1/step-definitions", HttpStatusCode.Forbidden);
        (await viewer.PostAsync($"/api/v1/forms/{_taskTypeForm}/versions", Json("{}"))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await viewer.PostAsJsonAsync("/api/v1/asset-types", new { name = "Nope" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        var nobody = await UserWithAsync(@"KE\nobody", Permissions.Client.View);
        foreach (var url in new[]
        {
            "/api/v1/task-types", $"/api/v1/task-types/{_taskTypeId}", "/api/v1/asset-types", $"/api/v1/asset-types/{_assetTypeId}", "/api/v1/asset-link-roles",
            $"/api/v1/forms/{_taskTypeForm}", $"/api/v1/forms/{_taskTypeForm}/versions", $"/api/v1/forms/by-owner?ownerKind=TaskType&ownerId={_taskTypeId}",
            $"/api/v1/forms/versions/{_publishedVersion}/schema", "/api/v1/step-definitions", $"/api/v1/step-definitions/{_stepId}", "/api/v1/workflows",
        })
        {
            await ShouldBeAsync(nobody, url, HttpStatusCode.Forbidden);
        }

        // The Asset.View reader of asset types is unchanged.
        var assetViewer = await UserWithAsync(@"KE\assetviewer", Permissions.Asset.View);
        await ShouldBeAsync(assetViewer, "/api/v1/asset-types", HttpStatusCode.OK);
        await ShouldBeAsync(assetViewer, "/api/v1/asset-link-roles", HttpStatusCode.Forbidden);
    }
}
