using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Tasks;

/// <summary>Reading, editing, assigning and prioritizing Tasks (tickets 44, 46): immutability, optimistic concurrency, SCN-006, audit.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskEditApiTests(SqlServerFixture sql) : IAsyncLifetime
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

    private static Dictionary<string, object?> UpdateBody(JsonElement task, Dictionary<string, object?>? changes = null)
    {
        var body = new Dictionary<string, object?>
        {
            ["rowVersion"] = RowVersion(task),
            ["title"] = task.GetProperty("title").GetString(),
            ["description"] = task.GetProperty("description").GetString(),
            ["requestorName"] = task.GetProperty("requestorName").GetString(),
            ["requestorEmail"] = task.GetProperty("requestorEmail").GetString(),
            ["projectId"] = task.GetProperty("project").ValueKind == JsonValueKind.Object ? task.GetProperty("project").GetProperty("projectId").GetInt32() : (int?)null,
            ["dueDate"] = task.GetProperty("dueDate").GetString(),
        };
        foreach (var (key, value) in changes ?? [])
            body[key] = value;

        return body;
    }

    private Task<HttpResponseMessage> PutAsync(JsonElement task, Dictionary<string, object?> body, HttpClient? client = null) =>
        (client ?? _h.Admin).PutAsJsonAsync($"/api/v1/tasks/{TaskId(task)}", body);

    // ---- get / list

    [Fact]
    public async Task Get_returns_the_full_detail_and_404_for_unknown_ids()
    {
        var task = await _h.CreateTaskAsync(_w, extra: new() { ["projectId"] = _w.ProjectId, ["dueDate"] = "2099-03-04" });

        var detail = await _h.GetTaskAsync(TaskId(task));
        detail.GetProperty("matter").GetProperty("clientNumber").GetString().ShouldBe("00343");
        detail.GetProperty("taskType").GetProperty("name").GetString().ShouldBe("Data Processing");
        detail.GetProperty("statusLabel").GetString().ShouldBe("New");
        detail.GetProperty("workflow").GetProperty("progress").GetProperty("total").GetInt32().ShouldBe(3);
        detail.GetProperty("workflow").GetProperty("progress").GetProperty("currentStepInstanceId").GetInt32().ShouldBe(StepIds(task)[0]);
        detail.GetProperty("allowedActions").GetProperty("canEdit").GetBoolean().ShouldBeTrue();
        detail.GetProperty("allowedActions").GetProperty("transitions").EnumerateArray().Select(t => t.GetProperty("action").GetString())
            .ShouldBe(["START", "HOLD", "COMPLETE", "CANCEL"], ignoreOrder: true);
        detail.GetProperty("warnings").GetArrayLength().ShouldBe(0);

        await ProblemAsync(await _h.Admin.GetAsync("/api/v1/tasks/999999"), HttpStatusCode.NotFound, "NOT_FOUND");
    }

    [Fact]
    public async Task List_filters_by_matter_project_status_and_assignee_and_pages()
    {
        var otherMatter = await _h.CreateMatterAsync("343", "13");
        await _h.UserWithAsync(@"KE\lister", TaskHarness.AllTaskPermissions);
        var userId = await _h.UserIdAsync(@"KE\lister");

        var inProject = await _h.CreateTaskAsync(_w, extra: new() { ["projectId"] = _w.ProjectId });
        var assigned = await _h.CreateTaskAsync(_w, extra: new() { ["assignedUserId"] = userId });
        var cancelled = await _h.ReachAsync(_w, "CANCELLED");
        var elsewhere = await OkAsync(
            await _h.Admin.PostAsJsonAsync("/api/v1/tasks", new { matterId = otherMatter, taskTypeId = _w.TaskTypeId, workflowDefinitionId = _w.UnorderedWorkflowId, title = "Other matter", requestorName = "R" }),
            HttpStatusCode.Created);

        async Task<long[]> IdsAsync(string query)
        {
            var page = await OkAsync(await _h.Admin.GetAsync("/api/v1/tasks" + query));
            return [.. page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("taskId").GetInt64())];
        }

        (await IdsAsync($"?matterId={_w.MatterId}")).Length.ShouldBe(3);
        (await IdsAsync($"?matterId={otherMatter}")).ShouldBe([TaskId(elsewhere)]);
        (await IdsAsync($"?projectId={_w.ProjectId}")).ShouldBe([TaskId(inProject)]);
        (await IdsAsync("?status=CANCELLED")).ShouldBe([TaskId(cancelled)]);
        (await IdsAsync("?status=NEW,IN_PROGRESS")).Length.ShouldBe(3);
        (await IdsAsync($"?assigneeId={userId}")).ShouldBe([TaskId(assigned)]);
        (await IdsAsync($"?q=Other matter")).ShouldBe([TaskId(elsewhere)]);

        var paged = await OkAsync(await _h.Admin.GetAsync("/api/v1/tasks?pageSize=2&page=2&sort=taskNumber"));
        paged.GetProperty("total").GetInt32().ShouldBe(4);
        paged.GetProperty("items").GetArrayLength().ShouldBe(2);
        paged.GetProperty("page").GetInt32().ShouldBe(2);

        var item = (await OkAsync(await _h.Admin.GetAsync($"/api/v1/tasks?projectId={_w.ProjectId}"))).GetProperty("items")[0];
        item.GetProperty("matterRef").GetString().ShouldBe("00343-00012");
        item.GetProperty("taskTypeName").GetString().ShouldBe("Data Processing");
        item.GetProperty("priority").GetProperty("label").GetString().ShouldBe("Normal");
        item.GetProperty("isAsap").GetBoolean().ShouldBeTrue();

        await ProblemAsync(await _h.Admin.GetAsync("/api/v1/tasks?bogus=1"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await _h.Admin.GetAsync("/api/v1/tasks?status=WAT"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await _h.Admin.GetAsync("/api/v1/tasks?sort=nope"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task The_default_sort_orders_by_priority_then_asap_then_due_then_age()
    {
        var priorities = await OkAsync(await _h.Admin.GetAsync("/api/v1/priorities"));
        int PriorityId(string label) => priorities.EnumerateArray().First(p => p.GetProperty("label").GetString() == label).GetProperty("id").GetInt32();

        var normalLate = await _h.CreateTaskAsync(_w, extra: new() { ["dueDate"] = "2099-05-01" });
        var normalAsap = await _h.CreateTaskAsync(_w);
        var normalSoon = await _h.CreateTaskAsync(_w, extra: new() { ["dueDate"] = "2099-02-01" });
        var critical = await _h.CreateTaskAsync(_w, extra: new() { ["priorityId"] = PriorityId("Critical"), ["dueDate"] = "2099-12-31" });
        var low = await _h.CreateTaskAsync(_w, extra: new() { ["priorityId"] = PriorityId("Low") });

        var page = await OkAsync(await _h.Admin.GetAsync("/api/v1/tasks?sort=default"));
        var order = page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("taskId").GetInt64()).ToArray();
        order.ShouldBe([TaskId(critical), TaskId(normalAsap), TaskId(normalSoon), TaskId(normalLate), TaskId(low)]);
    }

    // ---- update

    [Fact]
    public async Task Update_changes_details_audits_each_field_and_bumps_the_row_version()
    {
        var task = await _h.CreateTaskAsync(_w, extra: new() { ["description"] = "old" });

        var response = await PutAsync(task, UpdateBody(task, new()
        {
            ["title"] = "New title",
            ["description"] = "new text",
            ["requestorName"] = "Ann Associate",
            ["requestorEmail"] = "ann@firm.example",
            ["projectId"] = _w.ProjectId,
            ["dueDate"] = "2099-06-07",
        }));
        var updated = await OkAsync(response);

        updated.GetProperty("title").GetString().ShouldBe("New title");
        updated.GetProperty("project").GetProperty("projectId").GetInt32().ShouldBe(_w.ProjectId);
        updated.GetProperty("dueDate").GetString().ShouldBe("2099-06-07");
        updated.GetProperty("isAsap").GetBoolean().ShouldBeFalse();
        RowVersion(updated).ShouldNotBe(RowVersion(task));
        updated.GetProperty("modifiedAtUtc").ValueKind.ShouldBe(JsonValueKind.String);

        var events = await _h.AuditAsync(TaskId(task));
        var changed = events.Where(e => e.EventType == "FIELD_CHANGED").Select(e => e.FieldKey).ToList();
        changed.ShouldBe(["title", "description", "requestorName", "requestorEmail", "dueDate", "project"], ignoreOrder: true);
        var title = events.Single(e => e.FieldKey == "title");
        title.OldValue.ShouldStartWith("Load custodian data");
        title.NewValue.ShouldBe("New title");
        events.Single(e => e.EventType == "TASK_UPDATED").Summary!.ShouldContain("title");
    }

    [Fact]
    public async Task An_update_without_changes_is_a_no_op()
    {
        var task = await _h.CreateTaskAsync(_w);
        var before = (await _h.AuditAsync(TaskId(task))).Count;

        var updated = await OkAsync(await PutAsync(task, UpdateBody(task)));

        RowVersion(updated).ShouldBe(RowVersion(task));
        (await _h.AuditAsync(TaskId(task))).Count.ShouldBe(before);
    }

    [Fact]
    public async Task The_requested_time_round_trips_without_phantom_changes_and_offsets_are_normalized_to_utc()
    {
        var task = await _h.CreateTaskAsync(_w, extra: new() { ["requestedAtUtc"] = "2030-01-02T03:04:05.678+02:00" });
        task.GetProperty("requestedAtUtc").GetDateTime().ShouldBe(new DateTime(2030, 1, 2, 1, 4, 5, 678, DateTimeKind.Utc));

        var body = UpdateBody(task, new() { ["requestedAtUtc"] = task.GetProperty("requestedAtUtc").GetDateTime() });
        var again = await OkAsync(await PutAsync(task, body));

        RowVersion(again).ShouldBe(RowVersion(task));
        (await _h.AuditAsync(TaskId(task))).ShouldNotContain(e => e.FieldKey == "requestedAt");

        var changed = await OkAsync(await PutAsync(again, UpdateBody(again, new() { ["requestedAtUtc"] = "2030-01-03T00:00:00Z" })));
        changed.GetProperty("requestedAtUtc").GetDateTime().ShouldBe(new DateTime(2030, 1, 3, 0, 0, 0, DateTimeKind.Utc));
        (await _h.AuditAsync(TaskId(task))).Count(e => e.FieldKey == "requestedAt").ShouldBe(1);
    }

    [Fact]
    public async Task A_stale_row_version_is_a_conflict_with_the_current_token()
    {
        var task = await _h.CreateTaskAsync(_w);
        await OkAsync(await PutAsync(task, UpdateBody(task, new() { ["title"] = "First writer" })));

        var problem = await ProblemAsync(await PutAsync(task, UpdateBody(task, new() { ["title"] = "Second writer" })), HttpStatusCode.Conflict, "CONCURRENCY_CONFLICT");

        problem.GetProperty("meta").GetProperty("currentRowVersion").GetString().ShouldNotBeNullOrWhiteSpace();
        (await _h.GetTaskAsync(TaskId(task))).GetProperty("title").GetString().ShouldBe("First writer");

        var bad = UpdateBody(task);
        bad["rowVersion"] = "***";
        await ProblemAsync(await PutAsync(task, bad), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task Matter_task_type_and_workflow_cannot_change_through_the_api_or_the_database()
    {
        var task = await _h.CreateTaskAsync(_w);
        var otherMatter = await _h.CreateMatterAsync("343", "13");
        var otherType = await _h.CreateTaskTypeAsync("Other type", [_w.UnorderedWorkflowId]);

        await ProblemAsync(await PutAsync(task, UpdateBody(task, new() { ["matterId"] = otherMatter })), HttpStatusCode.Conflict, "IMMUTABLE_FIELD");
        await ProblemAsync(await PutAsync(task, UpdateBody(task, new() { ["taskTypeId"] = otherType })), HttpStatusCode.Conflict, "IMMUTABLE_FIELD");
        await ProblemAsync(await PutAsync(task, UpdateBody(task, new() { ["workflowDefinitionId"] = _w.UnorderedWorkflowId })), HttpStatusCode.Conflict, "IMMUTABLE_FIELD");

        // Echoing the real values is fine.
        await OkAsync(await PutAsync(task, UpdateBody(task, new() { ["matterId"] = _w.MatterId, ["taskTypeId"] = _w.TaskTypeId, ["workflowDefinitionId"] = _w.OrderedWorkflowId })));

        // Raw SQL is stopped by TR_Task_Immutable.
        var id = TaskId(task);
        var spareInstance = await _h.Workflows.InstantiateAsync(task.GetProperty("workflow").GetProperty("workflowVersionId").GetInt32());
        foreach (var update in new[]
        {
            $"UPDATE dbo.Task SET MatterId = {otherMatter} WHERE TaskId = {id}",
            $"UPDATE dbo.Task SET TaskTypeId = {otherType} WHERE TaskId = {id}",
            $"UPDATE dbo.Task SET FormVersionId = NULL WHERE TaskId = {id}",
            $"UPDATE dbo.Task SET WorkflowInstanceId = {spareInstance} WHERE TaskId = {id}",
            $"UPDATE dbo.Task SET TaskNumber = 'TSK-999999' WHERE TaskId = {id}",
        })
        {
            var ex = await Should.ThrowAsync<Exception>(() => _h.ExecuteAsync(update));
            ex.ToString().ShouldContain("cannot be changed after creation", Case.Insensitive);
        }

        // Tasks are never deleted.
        var delete = await Should.ThrowAsync<Exception>(() => _h.ExecuteAsync($"DELETE FROM dbo.Task WHERE TaskId = {id}"));
        delete.ToString().ShouldContain("cannot be deleted");
    }

    [Fact]
    public async Task The_project_can_change_within_the_matter_but_not_to_another_matters_project()
    {
        var task = await _h.CreateTaskAsync(_w, extra: new() { ["projectId"] = _w.ProjectId });
        var second = await _h.CreateProjectAsync(_w.MatterId, "Phase 2");
        var otherMatter = await _h.CreateMatterAsync("343", "13");
        var foreign = await _h.CreateProjectAsync(otherMatter, "Foreign");

        var moved = await OkAsync(await PutAsync(task, UpdateBody(task, new() { ["projectId"] = second })));
        moved.GetProperty("project").GetProperty("name").GetString().ShouldBe("Phase 2");

        await ProblemAsync(await PutAsync(moved, UpdateBody(moved, new() { ["projectId"] = foreign })), HttpStatusCode.Conflict, "CROSS_MATTER_REFERENCE");

        var cleared = await OkAsync(await PutAsync(moved, UpdateBody(moved, new() { ["projectId"] = null })));
        cleared.GetProperty("project").ValueKind.ShouldBe(JsonValueKind.Null);
        var events = await _h.AuditAsync(TaskId(task));
        events.Where(e => e.FieldKey == "project").Select(e => (e.OldValue, e.NewValue)).ShouldBe([("Phase 1", "Phase 2"), ("Phase 2", null)]);
    }

    [Fact]
    public async Task Form_values_are_a_patch_that_validates_changed_fields_drops_hidden_ones_and_audits_per_key()
    {
        var task = await _h.CreateTaskAsync(_w, extra: new() { ["formValues"] = new Dictionary<string, object?> { ["requires_ocr"] = true, ["ocr_language"] = "eng", ["notes"] = "a" } });

        var edited = await OkAsync(await PutAsync(task, UpdateBody(task, new() { ["formValues"] = new Dictionary<string, object?> { ["notes"] = "b" } })));
        edited.GetProperty("formValues").GetProperty("notes").GetString().ShouldBe("b");
        edited.GetProperty("formValues").GetProperty("ocr_language").GetString().ShouldBe("eng");
        edited.GetProperty("formVersionId").GetInt32().ShouldBe(task.GetProperty("formVersionId").GetInt32());

        // Switching the checkbox off hides ocr_language: its value is dropped and reported.
        var hidden = await OkAsync(await PutAsync(edited, UpdateBody(edited, new() { ["formValues"] = new Dictionary<string, object?> { ["requires_ocr"] = false } })));
        hidden.GetProperty("formValues").TryGetProperty("ocr_language", out _).ShouldBeFalse();
        hidden.GetProperty("droppedFields").EnumerateArray().Select(e => e.GetString()).ShouldContain("ocr_language");

        // A changed field is validated: an unknown key is rejected, and a value of the wrong type too.
        await ProblemAsync(await PutAsync(hidden, UpdateBody(hidden, new() { ["formValues"] = new Dictionary<string, object?> { ["nope"] = "x" } })), HttpStatusCode.BadRequest, "FORM_VALIDATION_FAILED");

        var keys = (await _h.AuditAsync(TaskId(task))).Where(e => e.EventType == "FIELD_CHANGED").Select(e => e.FieldKey).ToList();
        keys.ShouldContain("form:notes");
        keys.ShouldContain("form:requires_ocr");
        keys.ShouldContain("form:ocr_language");
        (await _h.AuditAsync(TaskId(task))).ShouldContain(e => e.EventType == "FORM_VALUES_DROPPED" && e.Summary!.Contains("ocr_language"));
    }

    [Fact]
    public async Task Editing_follows_the_status_table()
    {
        var onHold = await _h.ReachAsync(_w, "ON_HOLD");
        await OkAsync(await PutAsync(onHold, UpdateBody(onHold, new() { ["title"] = "Edited while on hold" })));

        foreach (var status in new[] { "COMPLETED", "CANCELLED" })
        {
            var closed = await _h.ReachAsync(_w, status);
            var problem = await ProblemAsync(await PutAsync(closed, UpdateBody(closed, new() { ["title"] = "no" })), HttpStatusCode.Conflict, "TASK_NOT_EDITABLE");
            problem.GetProperty("meta").GetProperty("taskStatus").GetString().ShouldBe(status);
        }
    }

    [Fact]
    public async Task Changing_the_priority_in_an_update_needs_the_set_priority_permission()
    {
        var task = await _h.CreateTaskAsync(_w);
        var editor = await _h.UserWithAsync(@"KE\editor", "Task.View", "Task.Edit");
        var priorities = await OkAsync(await _h.Admin.GetAsync("/api/v1/priorities"));
        var high = priorities.EnumerateArray().First(p => p.GetProperty("label").GetString() == "High").GetProperty("id").GetInt32();

        var problem = await ProblemAsync(await PutAsync(task, UpdateBody(task, new() { ["priorityId"] = high, ["title"] = "x" }), editor), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        problem.GetProperty("meta").GetProperty("permission").GetString().ShouldBe("Task.SetPriority");
        (await _h.GetTaskAsync(TaskId(task))).GetProperty("title").GetString().ShouldBe(task.GetProperty("title").GetString());

        var ok = await OkAsync(await PutAsync(task, UpdateBody(task, new() { ["priorityId"] = high }), _h.Admin));
        ok.GetProperty("priority").GetProperty("label").GetString().ShouldBe("High");
    }

    // ---- assignment (SCN-006)

    [Fact]
    public async Task Scn006_a_technician_assigns_a_task_to_themselves_and_then_to_someone_else()
    {
        var tech = await _h.UserWithAsync(@"KE\tech", TaskHarness.AllTaskPermissions);
        var techId = await _h.UserIdAsync(@"KE\tech");
        await _h.UserWithAsync(@"KE\peer", TaskHarness.AllTaskPermissions);
        var peerId = await _h.UserIdAsync(@"KE\peer");
        var task = await _h.CreateTaskAsync(_w);

        var mine = await _h.PostAsync(TaskId(task), "assignment", new { userId = techId, rowVersion = RowVersion(task) }, tech);
        Status(mine).ShouldBe("IN_PROGRESS");
        mine.GetProperty("assignedUser").GetProperty("displayName").GetString().ShouldNotBeNullOrWhiteSpace();

        var theirs = await _h.PostAsync(TaskId(task), "assignment", new { userId = peerId, rowVersion = RowVersion(mine) }, tech);
        Status(theirs).ShouldBe("IN_PROGRESS");
        theirs.GetProperty("assignedUser").GetProperty("userId").GetInt32().ShouldBe(peerId);

        var events = await _h.AuditAsync(TaskId(task));
        events.Count(e => e.EventType == "TASK_ASSIGNED").ShouldBe(2);
        var status = events.Single(e => e.EventType == "TASK_STATUS_CHANGED");
        status.OldValue.ShouldBe("NEW");
        status.NewValue.ShouldBe("IN_PROGRESS");
        status.Summary!.ShouldContain("ASSIGNMENT");
        var firstAssignment = events.First(e => e.EventType == "TASK_ASSIGNED");
        firstAssignment.CorrelationId.ShouldBe(status.CorrelationId);
        firstAssignment.OldValue.ShouldBe("""{"podId":null,"userId":null}""");
        firstAssignment.NewValue.ShouldBe($$"""{"podId":null,"userId":{{techId}}}""");
    }

    [Fact]
    public async Task Pod_only_assignment_does_not_start_and_unassigning_never_reverts_the_status()
    {
        var podId = await _h.CreatePodAsync("Pod B");
        await _h.UserWithAsync(@"KE\member", TaskHarness.AllTaskPermissions);
        var memberId = await _h.UserIdAsync(@"KE\member");
        await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/pods/{podId}/members", new { userIds = new[] { memberId } }));
        var task = await _h.CreateTaskAsync(_w);

        var podOnly = await _h.PostAsync(TaskId(task), "assignment", new { podId, rowVersion = RowVersion(task) });
        Status(podOnly).ShouldBe("NEW");
        podOnly.GetProperty("warnings").GetArrayLength().ShouldBe(0);

        var withUser = await _h.PostAsync(TaskId(task), "assignment", new { podId, userId = memberId, rowVersion = RowVersion(podOnly) });
        Status(withUser).ShouldBe("IN_PROGRESS");
        withUser.GetProperty("warnings").GetArrayLength().ShouldBe(0);

        var unassigned = await _h.PostAsync(TaskId(task), "assignment", new { rowVersion = RowVersion(withUser) });
        Status(unassigned).ShouldBe("IN_PROGRESS");
        unassigned.GetProperty("assignedUser").ValueKind.ShouldBe(JsonValueKind.Null);
        unassigned.GetProperty("assignedPod").ValueKind.ShouldBe(JsonValueKind.Null);

        // Re-sending the same assignment is a no-op.
        var again = await _h.PostAsync(TaskId(task), "assignment", new { rowVersion = RowVersion(unassigned) });
        RowVersion(again).ShouldBe(RowVersion(unassigned));
    }

    [Fact]
    public async Task Assignment_validates_pod_user_status_version_and_permission()
    {
        var task = await _h.CreateTaskAsync(_w);
        var inactivePod = await _h.CreatePodAsync("Dormant");
        var pod = await OkAsync(await _h.Admin.GetAsync($"/api/v1/pods/{inactivePod}"));
        await OkAsync(await _h.Admin.PutAsJsonAsync($"/api/v1/pods/{inactivePod}", new { name = "Dormant", description = (string?)null, isActive = false, rowVersion = pod.GetProperty("pod").GetProperty("rowVersion").GetString() }));

        await ProblemAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/assignment", new { podId = inactivePod, rowVersion = RowVersion(task) }), HttpStatusCode.Conflict, "POD_INACTIVE");
        await ProblemAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/assignment", new { podId = 99999, rowVersion = RowVersion(task) }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/assignment", new { userId = 99999, rowVersion = RowVersion(task) }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/assignment", new { rowVersion = "AAAA" }), HttpStatusCode.Conflict, "CONCURRENCY_CONFLICT");

        var viewer = await _h.UserWithAsync(@"KE\viewer", "Task.View");
        var viewerId = await _h.UserIdAsync(@"KE\viewer");
        await ProblemAsync(await viewer.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/assignment", new { userId = viewerId, rowVersion = RowVersion(task) }), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        Status(await _h.GetTaskAsync(TaskId(task))).ShouldBe("NEW");

        var closed = await _h.ReachAsync(_w, "CANCELLED");
        await ProblemAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(closed)}/assignment", new { userId = viewerId, rowVersion = RowVersion(closed) }), HttpStatusCode.Conflict, "TASK_NOT_EDITABLE");
    }

    // ---- batch assignment (Users tab "Assign the next 3")

    [Fact]
    public async Task Batch_assign_assigns_each_task_with_its_own_audit_and_keeps_the_others_when_one_fails()
    {
        await _h.UserWithAsync(@"KEen", TaskHarness.AllTaskPermissions);
        var benId = await _h.UserIdAsync(@"KEen");
        var a = await _h.CreateTaskAsync(_w);
        var b = await _h.CreateTaskAsync(_w);
        var c = await _h.CreateTaskAsync(_w);
        // b changes meanwhile (someone else assigns it): its row version is stale in the batch.
        await _h.PostAsync(TaskId(b), "assignment", new { userId = benId, rowVersion = RowVersion(b) });

        var response = await _h.Admin.PostAsJsonAsync("/api/v1/tasks/assign-batch", new
        {
            userId = benId,
            items = new[] { a, b, c }.Select(t => new { taskId = TaskId(t), rowVersion = RowVersion(t) }).ToArray(),
        });
        var body = await OkAsync(response);
        var results = body.GetProperty("results").EnumerateArray().ToList();
        results.Select(r => r.GetProperty("succeeded").GetBoolean()).ShouldBe([true, false, true]);
        results[1].GetProperty("errorCode").GetString().ShouldBe("CONCURRENCY_CONFLICT");
        results[0].GetProperty("task").GetProperty("status").GetString().ShouldBe("IN_PROGRESS");

        foreach (var t in new[] { a, c })
        {
            var events = await _h.AuditAsync(TaskId(t));
            events.Count(e => e.EventType == "TASK_ASSIGNED").ShouldBe(1);
            events.Count(e => e.EventType == "TASK_STATUS_CHANGED").ShouldBe(1);
            (await _h.GetTaskAsync(TaskId(t))).GetProperty("assignedUser").GetProperty("userId").GetInt32().ShouldBe(benId);
        }
    }

    [Fact]
    public async Task Batch_assign_needs_Task_Assign_and_at_most_ten_distinct_tasks()
    {
        var benId = await _h.UserIdAsync(@"KEen-none").ContinueWith(_ => 0);
        var task = await _h.CreateTaskAsync(_w);
        var viewer = await _h.UserWithAsync(@"KEiewer2", "Task.View");
        var viewerId = await _h.UserIdAsync(@"KEiewer2");
        var item = new { taskId = TaskId(task), rowVersion = RowVersion(task) };

        await ProblemAsync(await viewer.PostAsJsonAsync("/api/v1/tasks/assign-batch", new { userId = viewerId, items = new[] { item } }), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        Status(await _h.GetTaskAsync(TaskId(task))).ShouldBe("NEW");

        var eleven = Enumerable.Range(0, 11).Select(_ => item).ToArray();
        (await _h.Admin.PostAsJsonAsync("/api/v1/tasks/assign-batch", new { userId = viewerId, items = eleven })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _h.Admin.PostAsJsonAsync("/api/v1/tasks/assign-batch", new { userId = viewerId, items = Array.Empty<object>() })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _h.Admin.PostAsJsonAsync("/api/v1/tasks/assign-batch", new { userId = viewerId, items = new[] { item, item } })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        Status(await _h.GetTaskAsync(TaskId(task))).ShouldBe("NEW");
    }

    // ---- priority

    [Fact]
    public async Task Setting_the_priority_audits_labels_and_rejects_inactive_priorities_and_closed_tasks()
    {
        var priorities = await OkAsync(await _h.Admin.GetAsync("/api/v1/priorities"));
        int PriorityId(string label) => priorities.EnumerateArray().First(p => p.GetProperty("label").GetString() == label).GetProperty("id").GetInt32();
        var task = await _h.CreateTaskAsync(_w);

        var high = await _h.PostAsync(TaskId(task), "priority", new { priorityId = PriorityId("High"), rowVersion = RowVersion(task) });
        high.GetProperty("priority").GetProperty("label").GetString().ShouldBe("High");

        var change = (await _h.AuditAsync(TaskId(task))).Single(e => e.FieldKey == "priority");
        (change.OldValue, change.NewValue).ShouldBe(("Normal", "High"));

        var same = await _h.PostAsync(TaskId(task), "priority", new { priorityId = PriorityId("High"), rowVersion = RowVersion(high) });
        RowVersion(same).ShouldBe(RowVersion(high));

        await ProblemAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/priority", new { priorityId = 99999, rowVersion = RowVersion(high) }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");

        var closed = await _h.ReachAsync(_w, "COMPLETED");
        await ProblemAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(closed)}/priority", new { priorityId = PriorityId("Low"), rowVersion = RowVersion(closed) }), HttpStatusCode.Conflict, "TASK_NOT_EDITABLE");
    }
}
