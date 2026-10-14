using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.Audit.Domain;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Tasks;

/// <summary>Task creation (tickets 41, 44) against a real SQL Server through the HTTP pipeline: SCN-004, 005, 008, 009, 015.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskCreateApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private World _w = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        _w = await _h.CreateWorldAsync();
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    [Fact]
    public async Task Scn004_creates_a_task_without_a_project_with_a_pending_workflow_and_a_created_audit_event()
    {
        var response = await _h.Admin.PostAsJsonAsync("/api/v1/tasks", _h.NewTask(_w, extra: new() { ["description"] = "Load the custodian export", ["requestorEmail"] = "pat@firm.example" }));
        var task = await OkAsync(response, HttpStatusCode.Created);

        response.Headers.Location!.ToString().ShouldEndWith($"/api/v1/tasks/{TaskId(task)}");
        task.GetProperty("taskNumber").GetString().ShouldStartWith("TSK-");
        Status(task).ShouldBe("NEW");
        task.GetProperty("project").ValueKind.ShouldBe(JsonValueKind.Null);
        task.GetProperty("matter").GetProperty("matterRef").GetString().ShouldBe("00343-00012");
        task.GetProperty("priority").GetProperty("label").GetString().ShouldBe("Normal");
        task.GetProperty("requestorName").GetString().ShouldBe("Pat Partner");
        task.GetProperty("isAsap").GetBoolean().ShouldBeTrue();
        task.GetProperty("isOverdue").GetBoolean().ShouldBeFalse();
        task.GetProperty("createdBy").GetProperty("displayName").GetString().ShouldNotBeNullOrWhiteSpace();
        task.GetProperty("workflow").GetProperty("workflowName").GetString().ShouldBe("Ordered flow");
        task.GetProperty("workflow").GetProperty("isOrdered").GetBoolean().ShouldBeTrue();
        var steps = task.GetProperty("workflow").GetProperty("steps").EnumerateArray().ToList();
        steps.Count.ShouldBe(3);
        steps.ShouldAllBe(s => s.GetProperty("status").GetString() == "PENDING");
        task.GetProperty("formVersionId").ValueKind.ShouldBe(JsonValueKind.Number);

        var events = await _h.AuditAsync(TaskId(task));
        events.Select(e => e.EventType).ShouldContain("TASK_CREATED");
        events.Count(e => e.EventType == "TASK_CREATED").ShouldBe(1);
        events.Single(e => e.EventType == "TASK_CREATED").MatterId.ShouldBe(_w.MatterId);
    }

    [Fact]
    public async Task Task_numbers_are_sequential_and_unique()
    {
        var first = await _h.CreateTaskAsync(_w);
        var second = await _h.CreateTaskAsync(_w);

        var a = int.Parse(first.GetProperty("taskNumber").GetString()!["TSK-".Length..]);
        var b = int.Parse(second.GetProperty("taskNumber").GetString()!["TSK-".Length..]);
        b.ShouldBe(a + 1);
    }

    [Fact]
    public async Task Scn005_a_project_of_another_matter_is_rejected_and_the_database_agrees()
    {
        var otherMatter = await _h.CreateMatterAsync("343", "13");
        var foreignProject = await _h.CreateProjectAsync(otherMatter, "Elsewhere");

        var response = await _h.Admin.PostAsJsonAsync("/api/v1/tasks", _h.NewTask(_w, extra: new() { ["projectId"] = foreignProject }));

        await ProblemAsync(response, HttpStatusCode.Conflict, "CROSS_MATTER_REFERENCE");
        (await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.Task")).ShouldBe(0);
        (await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.WorkflowInstance")).ShouldBe(0);

        // Defense in depth: the composite foreign key rejects the same combination written with raw SQL.
        var ex = await Should.ThrowAsync<Exception>(() => _h.ExecuteAsync(
            $"INSERT dbo.Task (MatterId, ProjectId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, RequestorName) " +
            $"SELECT {_w.MatterId}, {foreignProject}, {_w.TaskTypeId}, 1, N'x', MIN(PriorityId), N'r' FROM dbo.Priority"));
        ex.ToString().ShouldContain("FK_Task_Project_SameMatter");
    }

    [Fact]
    public async Task A_task_can_be_created_under_a_project_of_its_matter()
    {
        var task = await _h.CreateTaskAsync(_w, extra: new() { ["projectId"] = _w.ProjectId });

        task.GetProperty("project").GetProperty("projectId").GetInt32().ShouldBe(_w.ProjectId);
        task.GetProperty("project").GetProperty("name").GetString().ShouldBe("Phase 1");
    }

    [Fact]
    public async Task Scn009_exactly_one_eligible_workflow_must_be_chosen()
    {
        var other = await _h.Workflows.CreateStepAsync("Other step");
        var notEligible = await _h.Workflows.CreatePublishedWorkflowAsync("Not eligible", false, new MatterFlow.IntegrationTests.Workflows.WorkflowInstanceHarness.Place(other));

        var ineligible = _h.NewTask(_w, extra: new() { ["workflowDefinitionId"] = notEligible.WorkflowId });
        await ProblemAsync(await _h.Admin.PostAsJsonAsync("/api/v1/tasks", ineligible), HttpStatusCode.Conflict, "WORKFLOW_NOT_ELIGIBLE");

        var none = _h.NewTask(_w);
        none.Remove("workflowDefinitionId");
        (await _h.Admin.PostAsJsonAsync("/api/v1/tasks", none)).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var both = _h.NewTask(_w, extra: new() { ["workflowDefinitionId"] = new[] { _w.OrderedWorkflowId, _w.UnorderedWorkflowId } });
        (await _h.Admin.PostAsJsonAsync("/api/v1/tasks", both)).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var a = await _h.CreateTaskAsync(_w, ordered: true);
        a.GetProperty("workflow").GetProperty("workflowDefinitionId").GetInt32().ShouldBe(_w.OrderedWorkflowId);
        (await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.WorkflowInstance")).ShouldBe(1);
    }

    [Fact]
    public async Task Scn008_a_visible_required_form_field_is_enforced_server_side_and_hidden_values_are_dropped()
    {
        var missing = _h.NewTask(_w, extra: new() { ["formValues"] = new Dictionary<string, object?> { ["requires_ocr"] = true } });
        var problem = await ProblemAsync(await _h.Admin.PostAsJsonAsync("/api/v1/tasks", missing), HttpStatusCode.BadRequest, "FORM_VALIDATION_FAILED");
        problem.GetProperty("errors").TryGetProperty("form:ocr_language", out _).ShouldBeTrue();
        (await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.Task")).ShouldBe(0);
        (await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.WorkflowInstance")).ShouldBe(0);

        var valid = await _h.CreateTaskAsync(_w, extra: new() { ["formValues"] = new Dictionary<string, object?> { ["requires_ocr"] = true, ["ocr_language"] = "eng", ["notes"] = "rush" } });
        valid.GetProperty("formValues").GetProperty("ocr_language").GetString().ShouldBe("eng");
        valid.GetProperty("formValues").GetProperty("notes").GetString().ShouldBe("rush");

        var hidden = await _h.CreateTaskAsync(_w, extra: new() { ["formValues"] = new Dictionary<string, object?> { ["requires_ocr"] = false, ["ocr_language"] = "fra" } });
        hidden.GetProperty("formValues").TryGetProperty("ocr_language", out _).ShouldBeFalse();
        hidden.GetProperty("droppedFields").EnumerateArray().Select(e => e.GetString()).ShouldContain("ocr_language");
    }

    [Fact]
    public async Task Unknown_form_keys_and_values_for_a_type_without_a_form_are_rejected()
    {
        var unknown = _h.NewTask(_w, extra: new() { ["formValues"] = new Dictionary<string, object?> { ["nope"] = "x" } });
        await ProblemAsync(await _h.Admin.PostAsJsonAsync("/api/v1/tasks", unknown), HttpStatusCode.BadRequest, "FORM_VALIDATION_FAILED");

        var plainType = await _h.CreateTaskTypeAsync("Plain", [_w.UnorderedWorkflowId], withForm: false);
        var plain = new Dictionary<string, object?>
        {
            ["matterId"] = _w.MatterId,
            ["taskTypeId"] = plainType,
            ["workflowDefinitionId"] = _w.UnorderedWorkflowId,
            ["title"] = "No form",
            ["requestorName"] = "Pat",
        };
        var created = await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/tasks", plain), HttpStatusCode.Created);
        created.GetProperty("formVersionId").ValueKind.ShouldBe(JsonValueKind.Null);

        plain["formValues"] = new Dictionary<string, object?> { ["x"] = 1 };
        await ProblemAsync(await _h.Admin.PostAsJsonAsync("/api/v1/tasks", plain), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task An_inactive_matter_or_archived_project_rejects_new_tasks()
    {
        var project = await _h.CreateProjectAsync(_w.MatterId, "Archived soon");
        await _h.SetProjectActiveAsync(project, false);

        await ProblemAsync(
            await _h.Admin.PostAsJsonAsync("/api/v1/tasks", _h.NewTask(_w, extra: new() { ["projectId"] = project })),
            HttpStatusCode.Conflict,
            "PROJECT_INACTIVE");

        await _h.SetMatterActiveAsync(_w.MatterId, false);
        await ProblemAsync(await _h.Admin.PostAsJsonAsync("/api/v1/tasks", _h.NewTask(_w)), HttpStatusCode.Conflict, "MATTER_INACTIVE");
        (await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.Task")).ShouldBe(0);
    }

    [Fact]
    public async Task Requestor_name_is_required_and_text_fields_are_validated()
    {
        var noRequestor = _h.NewTask(_w);
        noRequestor["requestorName"] = "  ";
        var problem = await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/tasks", noRequestor), HttpStatusCode.BadRequest);
        problem.GetProperty("code").GetString().ShouldBe("VALIDATION_FAILED");
        problem.GetProperty("errors").TryGetProperty("requestorName", out _).ShouldBeTrue();

        var badEmail = _h.NewTask(_w, extra: new() { ["requestorEmail"] = "not-an-email" });
        (await ProblemAsync(await _h.Admin.PostAsJsonAsync("/api/v1/tasks", badEmail), HttpStatusCode.BadRequest, "VALIDATION_FAILED"))
            .GetProperty("errors").TryGetProperty("requestorEmail", out _).ShouldBeTrue();

        var noTitle = _h.NewTask(_w);
        noTitle["title"] = "";
        (await _h.Admin.PostAsJsonAsync("/api/v1/tasks", noTitle)).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Scn015_no_due_date_is_asap_and_never_overdue_while_a_past_date_is_overdue()
    {
        var asap = await _h.CreateTaskAsync(_w);
        asap.GetProperty("isAsap").GetBoolean().ShouldBeTrue();
        asap.GetProperty("isOverdue").GetBoolean().ShouldBeFalse();
        asap.GetProperty("dueDate").ValueKind.ShouldBe(JsonValueKind.Null);

        var past = await _h.CreateTaskAsync(_w, extra: new() { ["dueDate"] = "2020-01-02" });
        past.GetProperty("isAsap").GetBoolean().ShouldBeFalse();
        past.GetProperty("isOverdue").GetBoolean().ShouldBeTrue();

        var future = await _h.CreateTaskAsync(_w, extra: new() { ["dueDate"] = "2099-01-02" });
        future.GetProperty("isOverdue").GetBoolean().ShouldBeFalse();

        // A closed task is never overdue, even with a past due date.
        var cancelled = await _h.StatusAsync(past, "CANCELLED", "Dropped");
        cancelled.GetProperty("isOverdue").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task A_due_time_is_entered_in_the_callers_zone_and_stored_as_an_instant()
    {
        var chicago = _h.As(DatabaseApiFactory.AdminAccount, "America/Chicago");
        var created = await OkAsync(
            await chicago.PostAsJsonAsync("/api/v1/tasks", _h.NewTask(_w, extra: new() { ["dueDate"] = "2099-01-15", ["dueTime"] = "14:30" })),
            HttpStatusCode.Created);

        created.GetProperty("dueDate").GetString().ShouldBe("2099-01-15");
        created.GetProperty("dueAtUtc").GetDateTime().ShouldBe(new DateTime(2099, 1, 15, 20, 30, 0, DateTimeKind.Utc));
        created.GetProperty("dueTime").GetString().ShouldBe("14:30");
        created.GetProperty("timeZone").GetString().ShouldBe("America/Chicago");

        // Another viewer sees the same instant in their own zone.
        var pacific = _h.As(DatabaseApiFactory.AdminAccount, "America/Los_Angeles");
        var seen = await _h.GetTaskAsync(TaskId(created), pacific);
        seen.GetProperty("dueTime").GetString().ShouldBe("12:30");
        seen.GetProperty("dueAtUtc").GetDateTime().ShouldBe(new DateTime(2099, 1, 15, 20, 30, 0, DateTimeKind.Utc));

        var timeWithoutDate = _h.NewTask(_w, extra: new() { ["dueTime"] = "09:00" });
        await ProblemAsync(await _h.Admin.PostAsJsonAsync("/api/v1/tasks", timeWithoutDate), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        var badTime = _h.NewTask(_w, extra: new() { ["dueDate"] = "2099-01-15", ["dueTime"] = "25:99" });
        await ProblemAsync(await _h.Admin.PostAsJsonAsync("/api/v1/tasks", badTime), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task Creating_with_a_user_assigned_starts_the_task_and_audits_assignment_and_status()
    {
        var tech = await _h.UserWithAsync(@"KE\tech1", TaskHarness.AllTaskPermissions);
        var techId = await _h.UserIdAsync(@"KE\tech1");

        var task = await _h.CreateTaskAsync(_w, extra: new() { ["assignedUserId"] = techId });

        Status(task).ShouldBe("IN_PROGRESS");
        task.GetProperty("assignedUser").GetProperty("userId").GetInt32().ShouldBe(techId);
        var events = await _h.AuditAsync(TaskId(task));
        events.Select(e => e.EventType).ShouldBe(["TASK_CREATED", "TASK_ASSIGNED", "TASK_STATUS_CHANGED"], ignoreOrder: true);
        events.Select(e => e.CorrelationId).Distinct().Count().ShouldBe(1);
        tech.ShouldNotBeNull();
    }

    [Fact]
    public async Task A_pod_only_assignment_keeps_the_task_new_and_a_user_outside_the_pod_only_warns()
    {
        var podId = await _h.CreatePodAsync("Pod A");
        await _h.UserWithAsync(@"KE\tech2", TaskHarness.AllTaskPermissions);
        var userId = await _h.UserIdAsync(@"KE\tech2");

        var podOnly = await _h.CreateTaskAsync(_w, extra: new() { ["assignedPodId"] = podId });
        Status(podOnly).ShouldBe("NEW");
        podOnly.GetProperty("assignedPod").GetProperty("name").GetString().ShouldBe("Pod A");

        var outsider = await _h.CreateTaskAsync(_w, extra: new() { ["assignedPodId"] = podId, ["assignedUserId"] = userId });
        Status(outsider).ShouldBe("IN_PROGRESS");
        outsider.GetProperty("warnings").EnumerateArray().Select(e => e.GetString()).ShouldContain("USER_NOT_IN_POD");
    }

    [Fact]
    public async Task Sub_permissions_apply_to_the_whole_creation_request()
    {
        var creator = await _h.UserWithAsync(@"KE\creator", "Task.View", "Task.Create");
        var someone = await _h.UserIdAsync(@"KE\creator");

        var assign = await creator.PostAsJsonAsync("/api/v1/tasks", _h.NewTask(_w, extra: new() { ["assignedUserId"] = someone }));
        (await ProblemAsync(assign, HttpStatusCode.Forbidden, "PERMISSION_DENIED")).GetProperty("meta").GetProperty("permission").GetString().ShouldBe("Task.Assign");

        var priorities = await OkAsync(await _h.Admin.GetAsync("/api/v1/priorities"));
        var high = priorities.EnumerateArray().First(p => p.GetProperty("label").GetString() == "High").GetProperty("id").GetInt32();
        var priority = await creator.PostAsJsonAsync("/api/v1/tasks", _h.NewTask(_w, extra: new() { ["priorityId"] = high }));
        (await ProblemAsync(priority, HttpStatusCode.Forbidden, "PERMISSION_DENIED")).GetProperty("meta").GetProperty("permission").GetString().ShouldBe("Task.SetPriority");

        (await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.Task")).ShouldBe(0);
        (await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.WorkflowInstance")).ShouldBe(0);
        (await _h.AuditAsync("TASK_CREATED")).ShouldBeEmpty();

        var plain = await creator.PostAsJsonAsync("/api/v1/tasks", _h.NewTask(_w));
        plain.StatusCode.ShouldBe(HttpStatusCode.Created);
    }

    [Fact]
    public async Task Priority_must_be_active_and_defaults_to_normal()
    {
        var missing = _h.NewTask(_w, extra: new() { ["priorityId"] = 99999 });
        await ProblemAsync(await _h.Admin.PostAsJsonAsync("/api/v1/tasks", missing), HttpStatusCode.BadRequest, "VALIDATION_FAILED");

        var priorities = await OkAsync(await _h.Admin.GetAsync("/api/v1/priorities"));
        var critical = priorities.EnumerateArray().First(p => p.GetProperty("label").GetString() == "Critical").GetProperty("id").GetInt32();
        var task = await _h.CreateTaskAsync(_w, extra: new() { ["priorityId"] = critical });
        task.GetProperty("priority").GetProperty("label").GetString().ShouldBe("Critical");
    }

    [Fact]
    public async Task Unknown_task_type_and_matter_are_validation_errors_and_an_unusable_type_is_rejected()
    {
        var body = _h.NewTask(_w);
        body["taskTypeId"] = 99999;
        await ProblemAsync(await _h.Admin.PostAsJsonAsync("/api/v1/tasks", body), HttpStatusCode.BadRequest, "VALIDATION_FAILED");

        var noMatter = _h.NewTask(_w);
        noMatter["matterId"] = 99999;
        await ProblemAsync(await _h.Admin.PostAsJsonAsync("/api/v1/tasks", noMatter), HttpStatusCode.BadRequest, "VALIDATION_FAILED");

        var type = await OkAsync(await _h.Admin.GetAsync($"/api/v1/task-types/{_w.TaskTypeId}"));
        await OkAsync(await _h.Admin.PutAsJsonAsync($"/api/v1/task-types/{_w.TaskTypeId}", new
        {
            name = type.GetProperty("name").GetString(),
            description = (string?)null,
            isActive = false,
            eligibleWorkflowIds = new[] { _w.OrderedWorkflowId, _w.UnorderedWorkflowId },
            defaultWorkflowDefinitionId = _w.OrderedWorkflowId,
            rowVersion = type.GetProperty("rowVersion").GetString(),
        }));
        await ProblemAsync(await _h.Admin.PostAsJsonAsync("/api/v1/tasks", _h.NewTask(_w)), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task Created_tasks_reference_the_pinned_request_form_version()
    {
        var task = await _h.CreateTaskAsync(_w);

        task.GetProperty("formVersionNo").GetInt32().ShouldBe(1);
        var stored = await _h.ScalarAsync("SELECT FormVersionId AS [Value] FROM dbo.Task");
        task.GetProperty("formVersionId").GetInt32().ShouldBe(stored);
    }

    [Fact]
    public async Task Audit_rows_of_a_task_creation_are_task_scoped()
    {
        var task = await _h.CreateTaskAsync(_w, extra: new() { ["formValues"] = new Dictionary<string, object?> { ["notes"] = "n" } });

        var events = await _h.AuditAsync(TaskId(task));
        events.ShouldAllBe(e => e.MatterId == _w.MatterId || e.MatterId == null);
        events.ShouldContain(e => e.EventType == "TASK_CREATED" && e.ObjectType == "Task");
        (await _factory.WithDbAsync(db => Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.CountAsync(db.Set<AuditEvent>()))).ShouldBeGreaterThan(0);
    }
}
