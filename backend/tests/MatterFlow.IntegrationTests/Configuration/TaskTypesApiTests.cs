using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using MatterFlow.Audit.Domain;
using MatterFlow.Configuration.Contracts;
using MatterFlow.Identity.Contracts;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

namespace MatterFlow.IntegrationTests.Configuration;

/// <summary>
/// Task Types (ticket #34) against a real SQL Server through the full HTTP pipeline: create/edit/deactivate, the request form linkage,
/// eligible workflows, the usable-for-new-Tasks rule exposed by <see cref="ITaskTypeCatalog"/>, permissions and audit (SCN-008, SCN-009 admin side).
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskTypesApiTests(SqlServerFixture sql) : IAsyncLifetime
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
        (await client.GetAsync("/api/v1/me")).StatusCode.ShouldBe(HttpStatusCode.OK);
        var roleId = await _factory.CreateRoleAsync("Role " + user, permissions);
        await _factory.GrantRoleAsync(user, roleId);
        return client;
    }

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage response) => await response.Content.ReadFromJsonAsync<JsonElement>();

    private static string Code(JsonElement problem) => problem.GetProperty("code").GetString()!;

    private static int Id(JsonElement element) => element.GetProperty("id").GetInt32();

    private static int[] Ints(JsonElement array) => [.. array.EnumerateArray().Select(e => e.GetInt32())];

    private static string[] Strings(JsonElement array) => [.. array.EnumerateArray().Select(e => e.GetString()!)];

    private async Task<JsonElement> CreateAsync(HttpClient client, object body)
    {
        var response = await client.PostAsJsonAsync("/api/v1/task-types", body);
        response.StatusCode.ShouldBe(HttpStatusCode.Created, await response.Content.ReadAsStringAsync());
        return await ReadAsync(response);
    }

    private static object UpdateBody(JsonElement current, string? name = null, bool? isActive = null, int[]? workflows = null, int? defaultWorkflow = null, bool keepDefault = true, string? iconKey = null) => new
    {
        name = name ?? current.GetProperty("name").GetString(),
        description = current.GetProperty("description").GetString(),
        iconKey = iconKey ?? current.GetProperty("iconKey").GetString(),
        isActive = isActive ?? current.GetProperty("isActive").GetBoolean(),
        eligibleWorkflowIds = workflows ?? Ints(current.GetProperty("eligibleWorkflowIds")),
        defaultWorkflowDefinitionId = keepDefault && defaultWorkflow is null && current.GetProperty("defaultWorkflowDefinitionId").ValueKind == JsonValueKind.Number
            ? current.GetProperty("defaultWorkflowDefinitionId").GetInt32()
            : defaultWorkflow,
        rowVersion = current.GetProperty("rowVersion").GetString(),
    };

    private async Task<JsonElement> UpdateAsync(HttpClient client, JsonElement current, object body)
    {
        var response = await client.PutAsJsonAsync($"/api/v1/task-types/{Id(current)}", body);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        return await ReadAsync(response);
    }

    private async Task<JsonElement> GetAsync(HttpClient client, int id) => await ReadAsync(await client.GetAsync($"/api/v1/task-types/{id}"));

    /// <summary>Designs and publishes a one-field request form for the Task Type through the forms API.</summary>
    private async Task<int> PublishFormAsync(HttpClient client, JsonElement taskType)
    {
        var definitionId = taskType.GetProperty("formDefinitionId").GetInt32();
        var draft = await client.PostAsync($"/api/v1/forms/{definitionId}/versions", Json("{}"));
        draft.StatusCode.ShouldBe(HttpStatusCode.Created, await draft.Content.ReadAsStringAsync());
        var versionId = (await ReadAsync(draft)).GetProperty("version").GetProperty("formVersionId").GetInt32();
        var saved = await FormDraftApi.SaveAsync(
            client,
            definitionId,
            versionId,
            """{"fields":[{"key":"requires_ocr","label":"Requires OCR?","control":"CHECKBOX"}]}""");
        saved.StatusCode.ShouldBe(HttpStatusCode.OK, await saved.Content.ReadAsStringAsync());
        var published = await FormDraftApi.PublishAsync(client, definitionId, versionId);
        published.StatusCode.ShouldBe(HttpStatusCode.OK, await published.Content.ReadAsStringAsync());
        return versionId;
    }

    // ---- create + form linkage

    [Fact]
    public async Task Creating_a_task_type_provisions_its_request_form_owner_and_stores_eligible_workflows()
    {
        var admin = As();
        var created = await CreateAsync(admin, new
        {
            name = "  Data Processing ",
            description = "Process and load data",
            eligibleWorkflowIds = new[] { 12, 7, 12 },
            defaultWorkflowDefinitionId = 7,
        });

        created.GetProperty("name").GetString().ShouldBe("Data Processing");
        created.GetProperty("isActive").GetBoolean().ShouldBeTrue();
        Ints(created.GetProperty("eligibleWorkflowIds")).ShouldBe([7, 12]);
        created.GetProperty("defaultWorkflowDefinitionId").GetInt32().ShouldBe(7);
        created.GetProperty("formDefinitionId").ValueKind.ShouldBe(JsonValueKind.Number);

        var form = await ReadAsync(await admin.GetAsync($"/api/v1/forms/by-owner?ownerKind=TaskType&ownerId={Id(created)}"));
        form.GetProperty("formDefinitionId").GetInt32().ShouldBe(created.GetProperty("formDefinitionId").GetInt32());
        form.GetProperty("versions").GetArrayLength().ShouldBe(0);
        (await _factory.CountAsync<MatterFlow.Configuration.Domain.TaskType>()).ShouldBe(1);
    }

    [Fact]
    public async Task Names_are_required_unique_and_trimmed_and_ids_validated()
    {
        var admin = As();
        await CreateAsync(admin, new { name = "Collection" });

        var duplicate = await admin.PostAsJsonAsync("/api/v1/task-types", new { name = "Collection" });
        duplicate.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        Code(await ReadAsync(duplicate)).ShouldBe("DUPLICATE_NAME");

        var blank = await admin.PostAsJsonAsync("/api/v1/task-types", new { name = "   " });
        blank.StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var tooLong = await admin.PostAsJsonAsync("/api/v1/task-types", new { name = new string('x', 101) });
        tooLong.StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var badId = await admin.PostAsJsonAsync("/api/v1/task-types", new { name = "Bad", eligibleWorkflowIds = new[] { 0 } });
        badId.StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var badDefault = await admin.PostAsJsonAsync("/api/v1/task-types", new { name = "Bad", eligibleWorkflowIds = new[] { 1 }, defaultWorkflowDefinitionId = 2 });
        badDefault.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await ReadAsync(badDefault)).GetProperty("errors").GetProperty("defaultWorkflowDefinitionId")[0].GetProperty("code").GetString().ShouldBe("NOT_ELIGIBLE");
        (await _factory.CountAsync<MatterFlow.Configuration.Domain.TaskType>()).ShouldBe(1);
    }

    // ---- update, concurrency, deactivate

    [Fact]
    public async Task Update_changes_fields_and_eligible_workflows_and_detects_stale_edits()
    {
        var admin = As();
        var created = await CreateAsync(admin, new { name = "Review", eligibleWorkflowIds = new[] { 1, 2 }, defaultWorkflowDefinitionId = 1 });

        var updated = await UpdateAsync(admin, created, UpdateBody(created, name: "Document Review", workflows: [2, 3], defaultWorkflow: 3));
        updated.GetProperty("name").GetString().ShouldBe("Document Review");
        Ints(updated.GetProperty("eligibleWorkflowIds")).ShouldBe([2, 3]);
        updated.GetProperty("defaultWorkflowDefinitionId").GetInt32().ShouldBe(3);
        updated.GetProperty("rowVersion").GetString().ShouldNotBe(created.GetProperty("rowVersion").GetString());

        // Stale row version: someone else already saved.
        var stale = await admin.PutAsJsonAsync($"/api/v1/task-types/{Id(created)}", UpdateBody(created, name: "Stale"));
        stale.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        Code(await ReadAsync(stale)).ShouldBe("CONCURRENCY_CONFLICT");

        // Removing the default workflow from the eligible set without choosing another default is refused.
        var orphan = await admin.PutAsJsonAsync($"/api/v1/task-types/{Id(updated)}", UpdateBody(updated, workflows: [2], defaultWorkflow: 3));
        orphan.StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        // Eligibility-only changes still move the row version (concurrent editors of the workflow set conflict).
        var onlyWorkflows = await UpdateAsync(admin, updated, UpdateBody(updated, workflows: [2, 3, 4]));
        onlyWorkflows.GetProperty("rowVersion").GetString().ShouldNotBe(updated.GetProperty("rowVersion").GetString());

        var other = await CreateAsync(admin, new { name = "Other" });
        var clash = await admin.PutAsJsonAsync($"/api/v1/task-types/{Id(other)}", UpdateBody(other, name: "Document Review"));
        clash.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        Code(await ReadAsync(clash)).ShouldBe("DUPLICATE_NAME");
    }

    [Fact]
    public async Task Task_types_are_deactivated_never_deleted()
    {
        var admin = As();
        var created = await CreateAsync(admin, new { name = "Legacy", eligibleWorkflowIds = new[] { 1 } });

        var off = await UpdateAsync(admin, created, UpdateBody(created, isActive: false));
        off.GetProperty("isActive").GetBoolean().ShouldBeFalse();
        off.GetProperty("isUsable").GetBoolean().ShouldBeFalse();
        Strings(off.GetProperty("usabilityIssues")).ShouldContain("INACTIVE");

        (await admin.DeleteAsync($"/api/v1/task-types/{Id(created)}")).StatusCode.ShouldBe(HttpStatusCode.MethodNotAllowed);

        // Still listed (historical Tasks display it), and it can be reactivated.
        var all = await ReadAsync(await admin.GetAsync("/api/v1/task-types"));
        all.EnumerateArray().Select(Id).ShouldContain(Id(created));
        var on = await UpdateAsync(admin, off, UpdateBody(off, isActive: true));
        on.GetProperty("isActive").GetBoolean().ShouldBeTrue();
    }

    // ---- the usable rule (SCN-008, SCN-009 admin side)

    [Fact]
    public async Task A_task_type_is_usable_only_when_active_with_a_published_form_and_an_eligible_workflow()
    {
        var admin = As();
        var created = await CreateAsync(admin, new { name = "Data Processing" });
        var id = Id(created);

        // A new type has no fields, so the form needs no publishing, but it has no workflow yet.
        created.GetProperty("isUsable").GetBoolean().ShouldBeFalse();
        Strings(created.GetProperty("usabilityIssues")).ShouldBe(["NO_ELIGIBLE_WORKFLOW"]);

        // With a workflow it is usable although its form is empty.
        var withWorkflow = await UpdateAsync(admin, created, UpdateBody(created, workflows: [5], defaultWorkflow: 5));
        withWorkflow.GetProperty("isUsable").GetBoolean().ShouldBeTrue();
        withWorkflow.GetProperty("publishedFormVersionId").ValueKind.ShouldBe(JsonValueKind.Null);

        // A draft with fields makes the form "required to be published".
        var definitionId = withWorkflow.GetProperty("formDefinitionId").GetInt32();
        var draft = await admin.PostAsync($"/api/v1/forms/{definitionId}/versions", Json("{}"));
        var draftBody = await ReadAsync(draft);
        var draftVersion = draftBody.GetProperty("version");
        (await FormDraftApi.SaveAsync(
            admin,
            definitionId,
            draftVersion.GetProperty("formVersionId").GetInt32(),
            """{"fields":[{"key":"notes","label":"Notes","control":"TEXTAREA"}]}""")).StatusCode.ShouldBe(HttpStatusCode.OK);

        var drafting = await GetAsync(admin, id);
        drafting.GetProperty("formStatus").GetString().ShouldBe("Draft");
        drafting.GetProperty("isUsable").GetBoolean().ShouldBeFalse();
        Strings(drafting.GetProperty("usabilityIssues")).ShouldBe(["FORM_NOT_PUBLISHED"]);

        await using (var scope = _factory.Services.CreateAsyncScope())
            (await scope.ServiceProvider.GetRequiredService<ITaskTypeCatalog>().ListUsableAsync()).ShouldBeEmpty();

        // Publish: usable, and the catalog reports the form version a new Task would pin.
        var publishedVersion = await FormDraftApi.PublishAsync(admin, definitionId, draftVersion.GetProperty("formVersionId").GetInt32());
        publishedVersion.StatusCode.ShouldBe(HttpStatusCode.OK);
        var published = await GetAsync(admin, id);
        published.GetProperty("formStatus").GetString().ShouldBe("Published");
        published.GetProperty("publishedFormVersionNo").GetInt32().ShouldBe(1);
        published.GetProperty("isUsable").GetBoolean().ShouldBeTrue();
        published.GetProperty("usabilityIssues").GetArrayLength().ShouldBe(0);

        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var catalog = scope.ServiceProvider.GetRequiredService<ITaskTypeCatalog>();
            var usable = await catalog.ListUsableAsync();
            usable.Select(t => t.Id).ShouldBe([id]);
            var info = (await catalog.GetAsync(id))!;
            info.PublishedFormVersionId.ShouldBe(published.GetProperty("publishedFormVersionId").GetInt32());
            info.EligibleWorkflowIds.ShouldBe([5]);
            info.DefaultWorkflowDefinitionId.ShouldBe(5);
            info.IsUsable.ShouldBeTrue();
            (await catalog.GetAsync(999_999)).ShouldBeNull();
        }

        // Dropping the last eligible workflow or deactivating makes it unusable for new Tasks again.
        var noWorkflow = await UpdateAsync(admin, published, UpdateBody(published, workflows: [], keepDefault: false));
        noWorkflow.GetProperty("isUsable").GetBoolean().ShouldBeFalse();
        var inactive = await UpdateAsync(admin, noWorkflow, UpdateBody(noWorkflow, workflows: [5], isActive: false));
        inactive.GetProperty("isUsable").GetBoolean().ShouldBeFalse();
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var catalog = scope.ServiceProvider.GetRequiredService<ITaskTypeCatalog>();
            (await catalog.ListUsableAsync()).ShouldBeEmpty();
            (await catalog.ListAsync(includeInactive: false)).ShouldBeEmpty();
            (await catalog.ListAsync(includeInactive: true)).Select(t => t.Id).ShouldBe([id]);
        }
    }

    [Fact]
    public async Task Retiring_the_only_published_form_makes_the_type_unusable()
    {
        var admin = As();
        var created = await CreateAsync(admin, new { name = "Collection", eligibleWorkflowIds = new[] { 9 } });
        var versionId = await PublishFormAsync(admin, created);
        (await GetAsync(admin, Id(created))).GetProperty("isUsable").GetBoolean().ShouldBeTrue();

        var definitionId = created.GetProperty("formDefinitionId").GetInt32();
        (await admin.PostAsync($"/api/v1/forms/{definitionId}/versions/{versionId}/retire", null)).StatusCode.ShouldBe(HttpStatusCode.OK);

        var afterRetire = await GetAsync(admin, Id(created));
        afterRetire.GetProperty("isUsable").GetBoolean().ShouldBeFalse();
        afterRetire.GetProperty("formStatus").GetString().ShouldBe("Retired");
        Strings(afterRetire.GetProperty("usabilityIssues")).ShouldBe(["FORM_NOT_PUBLISHED"]);
    }

    // ---- permissions

    [Fact]
    public async Task Reading_needs_Task_View_and_managing_needs_TaskType_Manage()
    {
        var admin = As();
        var created = await CreateAsync(admin, new { name = "Data Processing" });

        var viewer = await UserWithAsync(@"KE\ttviewer", Permissions.Task.View);
        (await viewer.GetAsync("/api/v1/task-types")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await viewer.GetAsync($"/api/v1/task-types/{Id(created)}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        var denied = await viewer.PostAsJsonAsync("/api/v1/task-types", new { name = "Nope" });
        denied.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        Code(await ReadAsync(denied)).ShouldBe("PERMISSION_DENIED");
        (await viewer.PutAsJsonAsync($"/api/v1/task-types/{Id(created)}", UpdateBody(created))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        var nobody = await UserWithAsync(@"KE\ttnobody", Permissions.Priority.Manage);
        (await nobody.GetAsync("/api/v1/task-types")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        var manager = await UserWithAsync(@"KE\ttmanager", Permissions.TaskType.Manage, Permissions.Task.View);
        (await manager.PostAsJsonAsync("/api/v1/task-types", new { name = "Manager type" })).StatusCode.ShouldBe(HttpStatusCode.Created);
        (await (await manager.PutAsJsonAsync($"/api/v1/task-types/{Id(created)}", UpdateBody(created, name: "Renamed"))).Content.ReadAsStringAsync()).ShouldContain("Renamed");

        // The form designer endpoints for a Task Type form need the same management permission.
        var viewerForm = await viewer.GetAsync($"/api/v1/forms/by-owner?ownerKind=TaskType&ownerId={Id(created)}");
        viewerForm.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        var managerForm = await manager.GetAsync($"/api/v1/forms/by-owner?ownerKind=TaskType&ownerId={Id(created)}");
        managerForm.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    // ---- audit

    [Fact]
    public async Task Changes_are_audited_including_the_eligible_workflow_set()
    {
        var admin = As();
        var created = await CreateAsync(admin, new { name = "Audited", eligibleWorkflowIds = new[] { 1 }, defaultWorkflowDefinitionId = 1 });
        var renamed = await UpdateAsync(admin, created, UpdateBody(created, name: "Audited 2", workflows: [1, 2]));
        await UpdateAsync(admin, renamed, UpdateBody(renamed, isActive: false));

        var events = await _factory.WithDbAsync(db => db.Set<AuditEvent>()
            .Where(e => e.ObjectType == "TaskType" && e.ObjectId == Id(created).ToString())
            .OrderBy(e => e.Id)
            .ToListAsync());

        events.Select(e => e.EventType).ShouldContain("TASK_TYPE_WORKFLOWS_CHANGED");
        events.Count(e => e.EventType == "TASK_TYPE_WORKFLOWS_CHANGED").ShouldBe(2);
        events.Where(e => e.FieldKey == "Name").Select(e => e.NewValue).ShouldContain("Audited 2");
        events.Where(e => e.FieldKey == "IsActive").Select(e => e.NewValue).ShouldContain("false");
        events.Single(e => e.EventType == "TASK_TYPE_WORKFLOWS_CHANGED" && e.OldValue == "1").NewValue.ShouldBe("1, 2");
    }

    // ---- icon (required, allow-listed, default file-text)

    [Fact]
    public async Task A_new_task_type_gets_the_default_icon_when_none_is_sent_and_every_read_returns_it()
    {
        var admin = As();
        var created = await CreateAsync(admin, new { name = "No icon sent" });
        created.GetProperty("iconKey").GetString().ShouldBe(TaskTypeIcons.DefaultKey);
        TaskTypeIcons.DefaultKey.ShouldBe("file-text");

        var chosen = await CreateAsync(admin, new { name = "With icon", iconKey = "mail" });
        chosen.GetProperty("iconKey").GetString().ShouldBe("mail");

        // Shared by several types: allowed.
        var again = await CreateAsync(admin, new { name = "Same icon", iconKey = "mail" });
        again.GetProperty("iconKey").GetString().ShouldBe("mail");

        var list = await ReadAsync(await admin.GetAsync("/api/v1/task-types"));
        list.EnumerateArray().ToDictionary(t => t.GetProperty("name").GetString()!, t => t.GetProperty("iconKey").GetString())
            .ShouldBe(new Dictionary<string, string?> { ["No icon sent"] = "file-text", ["With icon"] = "mail", ["Same icon"] = "mail" }, ignoreOrder: true);
        (await GetAsync(admin, Id(chosen))).GetProperty("iconKey").GetString().ShouldBe("mail");

        using var scope = _factory.Services.CreateScope();
        var info = await scope.ServiceProvider.GetRequiredService<ITaskTypeCatalog>().GetAsync(Id(chosen));
        info!.IconKey.ShouldBe("mail");
    }

    [Theory]
    [InlineData("not-an-icon")]
    [InlineData("MAIL")]
    [InlineData("../mail")]
    [InlineData("<svg onload=alert(1)>")]
    [InlineData("   ")]
    public async Task An_icon_outside_the_library_is_rejected_on_create_and_update(string key)
    {
        var admin = As();
        var rejected = await admin.PostAsJsonAsync("/api/v1/task-types", new { name = "Bad icon", iconKey = key });
        rejected.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        var error = (await ReadAsync(rejected)).GetProperty("errors").GetProperty("iconKey")[0].GetProperty("code").GetString();
        error.ShouldBeOneOf("UNKNOWN_ICON", "REQUIRED");
        (await _factory.CountAsync<MatterFlow.Configuration.Domain.TaskType>()).ShouldBe(0);

        var created = await CreateAsync(admin, new { name = "Good icon", iconKey = "book" });
        var update = await admin.PutAsJsonAsync($"/api/v1/task-types/{Id(created)}", UpdateBody(created, iconKey: key));
        update.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await GetAsync(admin, Id(created))).GetProperty("iconKey").GetString().ShouldBe("book");
    }

    [Fact]
    public async Task Update_requires_an_icon_and_a_changed_icon_is_audited()
    {
        var admin = As();
        var created = await CreateAsync(admin, new { name = "Icon audit" });

        var missing = await admin.PutAsJsonAsync($"/api/v1/task-types/{Id(created)}", new
        {
            name = "Icon audit",
            isActive = true,
            eligibleWorkflowIds = Array.Empty<int>(),
            rowVersion = created.GetProperty("rowVersion").GetString(),
        });
        missing.StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var updated = await UpdateAsync(admin, created, UpdateBody(created, iconKey: "scale"));
        updated.GetProperty("iconKey").GetString().ShouldBe("scale");

        var events = await _factory.WithDbAsync(db => db.Set<AuditEvent>()
            .Where(e => e.ObjectType == "TaskType" && e.ObjectId == Id(created).ToString() && e.FieldKey == "IconKey")
            .OrderBy(e => e.Id)
            .ToListAsync());
        events.Single(e => e.NewValue == "scale").OldValue.ShouldBe("file-text");
    }
}
