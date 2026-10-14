using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Tasks;

/// <summary>Workflow step actions through the Task endpoints (part of ticket 39): SCN-010 to 013, Task status guards and the auto-move on step reopen.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskWorkflowApiTests(SqlServerFixture sql) : IAsyncLifetime
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

    private string StepUrl(JsonElement task, int stepId, string action) => $"/api/v1/tasks/{TaskId(task)}/workflow/steps/{stepId}/{action}";

    /// <summary>An ordered task whose first step is completed (its note filled in), so the rest can be worked through.</summary>
    private async Task<JsonElement> WithFirstStepDoneAsync()
    {
        var task = await _h.CreateTaskAsync(_w, ordered: true);
        return await _h.StepAsync(task, StepIds(task)[0], "complete", new { values = new { note = "reviewed" } });
    }

    [Fact]
    public async Task The_workflow_endpoint_returns_the_instance_with_progress()
    {
        var task = await _h.CreateTaskAsync(_w, ordered: true);

        var workflow = await OkAsync(await _h.Admin.GetAsync($"/api/v1/tasks/{TaskId(task)}/workflow"));

        workflow.GetProperty("workflowName").GetString().ShouldBe("Ordered flow");
        workflow.GetProperty("progress").GetProperty("pending").GetInt32().ShouldBe(3);
        workflow.GetProperty("steps")[0].GetProperty("title").GetString().ShouldBe("Intake review");
        workflow.GetProperty("steps")[0].GetProperty("inputFormVersionId").ValueKind.ShouldBe(JsonValueKind.Number);
        workflow.GetProperty("steps")[1].GetProperty("isSkippable").GetBoolean().ShouldBeTrue();
        await ProblemAsync(await _h.Admin.GetAsync("/api/v1/tasks/999999/workflow"), HttpStatusCode.NotFound, "NOT_FOUND");
    }

    [Fact]
    public async Task Scn010_an_ordered_workflow_does_not_let_a_later_step_progress_before_the_earlier_one_is_resolved()
    {
        var task = await _h.CreateTaskAsync(_w, ordered: true);
        var steps = StepIds(task);

        await ProblemAsync(await _h.Admin.PostAsJsonAsync(StepUrl(task, steps[2], "complete"), new { rowVersion = WorkflowRowVersion(task) }), HttpStatusCode.Conflict, "STEP_ORDER_VIOLATION");
        await ProblemAsync(await _h.Admin.PostAsJsonAsync(StepUrl(task, steps[1], "start"), new { rowVersion = WorkflowRowVersion(task) }), HttpStatusCode.Conflict, "STEP_ORDER_VIOLATION");
        StepStatus(await _h.GetTaskAsync(TaskId(task)), steps[2]).ShouldBe("PENDING");

        var started = await _h.StepAsync(task, steps[0], "start");
        StepStatus(started, steps[0]).ShouldBe("IN_PROGRESS");
        started.GetProperty("workflow").GetProperty("progress").GetProperty("currentStepInstanceId").GetInt32().ShouldBe(steps[0]);
    }

    [Fact]
    public async Task Completing_a_step_needs_its_required_inputs_and_saving_values_is_a_draft()
    {
        var task = await _h.CreateTaskAsync(_w, ordered: true);
        var first = StepIds(task)[0];

        var problem = await ProblemAsync(await _h.Admin.PostAsJsonAsync(StepUrl(task, first, "complete"), new { rowVersion = WorkflowRowVersion(task) }), HttpStatusCode.BadRequest, "FORM_VALIDATION_FAILED");
        problem.GetProperty("errors").TryGetProperty("form:note", out _).ShouldBeTrue();

        var saved = await _h.StepAsync(task, first, "values", new { values = new { has_extra = true } });
        StepStatus(saved, first).ShouldBe("IN_PROGRESS");
        saved.GetProperty("workflow").GetProperty("steps")[0].GetProperty("values").GetProperty("has_extra").GetBoolean().ShouldBeTrue();
        saved.GetProperty("workflow").GetProperty("steps")[0].GetProperty("requiredInputsSatisfied").GetBoolean().ShouldBeFalse();

        var completed = await _h.StepAsync(saved, first, "complete", new { values = new { note = "done" } });
        StepStatus(completed, first).ShouldBe("COMPLETED");
        completed.GetProperty("workflow").GetProperty("steps")[0].GetProperty("resolvedByUserId").ValueKind.ShouldBe(JsonValueKind.Number);
        Status(completed).ShouldBe("NEW"); // step actions never change the status of a New task
    }

    [Fact]
    public async Task Scn011_and_012_skip_rules_over_the_task_endpoints()
    {
        var task = await WithFirstStepDoneAsync();
        var steps = StepIds(task);

        // Step 2 is skippable but needs a comment.
        await ProblemAsync(await _h.Admin.PostAsJsonAsync(StepUrl(task, steps[1], "skip"), new { rowVersion = WorkflowRowVersion(task) }), HttpStatusCode.BadRequest, "SKIP_COMMENT_REQUIRED");
        await ProblemAsync(await _h.Admin.PostAsJsonAsync(StepUrl(task, steps[1], "skip"), new { rowVersion = WorkflowRowVersion(task), comment = "   " }), HttpStatusCode.BadRequest, "SKIP_COMMENT_REQUIRED");
        var skipped = await _h.StepAsync(task, steps[1], "skip", new { comment = "Not needed for this client" });
        StepStatus(skipped, steps[1]).ShouldBe("SKIPPED");
        skipped.GetProperty("workflow").GetProperty("steps")[1].GetProperty("skipComment").GetString().ShouldBe("Not needed for this client");

        // Step 3 is not skippable.
        await ProblemAsync(await _h.Admin.PostAsJsonAsync(StepUrl(skipped, steps[2], "skip"), new { rowVersion = WorkflowRowVersion(skipped), comment = "please" }), HttpStatusCode.Conflict, "STEP_NOT_SKIPPABLE");
    }

    [Fact]
    public async Task Scn013_reopening_a_step_keeps_the_later_steps_and_flags_the_reopened_prerequisite()
    {
        var task = await _h.StatusAsync(await WithFirstStepDoneAsync(), "IN_PROGRESS");
        var steps = StepIds(task);
        var afterSecond = await _h.StepAsync(task, steps[1], "skip", new { comment = "n/a" });
        var allDone = await _h.StepAsync(afterSecond, steps[2], "complete");

        var reopened = await _h.StepAsync(allDone, steps[1], "reopen");

        StepStatus(reopened, steps[1]).ShouldBe("IN_PROGRESS");
        StepStatus(reopened, steps[0]).ShouldBe("COMPLETED");
        StepStatus(reopened, steps[2]).ShouldBe("COMPLETED");
        reopened.GetProperty("workflow").GetProperty("progress").GetProperty("reopenedPrerequisiteStepInstanceIds").EnumerateArray().Select(e => e.GetInt32()).ShouldBe([steps[1]]);
        reopened.GetProperty("workflow").GetProperty("steps")[1].GetProperty("isReopenedPrerequisite").GetBoolean().ShouldBeTrue();
        Status(reopened).ShouldBe("IN_PROGRESS");
        (await _h.AuditAsync(TaskId(task))).ShouldContain(e => e.EventType == "STEP_REOPENED");
    }

    [Fact]
    public async Task A_new_task_offers_step_reopen_exactly_when_the_endpoint_allows_it_E2E_F1()
    {
        var task = await WithFirstStepDoneAsync();
        Status(task).ShouldBe("NEW");
        var step = StepIds(task)[0];

        // Step actions are allowed on a New task, so the UI flag and the endpoint agree that reopen is allowed too.
        task.GetProperty("allowedActions").GetProperty("canExecuteSteps").GetBoolean().ShouldBeTrue();
        task.GetProperty("allowedActions").GetProperty("canReopenSteps").GetBoolean().ShouldBeTrue();

        var reopened = await _h.StepAsync(task, step, "reopen");

        StepStatus(reopened, step).ShouldBe("IN_PROGRESS");
        Status(reopened).ShouldBe("NEW");
    }

    [Fact]
    public async Task Reopening_a_step_of_a_completed_task_moves_the_task_back_to_in_progress_and_audits_both()
    {
        var completed = await _h.ReachAsync(_w, "COMPLETED");
        var step = StepIds(completed)[0];

        // Other step actions stay blocked on a completed task.
        await ProblemAsync(await _h.Admin.PostAsJsonAsync(StepUrl(completed, step, "start"), new { rowVersion = WorkflowRowVersion(completed) }), HttpStatusCode.Conflict, "TASK_NOT_EDITABLE");

        var response = await OkAsync(await _h.Admin.PostAsJsonAsync(StepUrl(completed, step, "reopen"), new { rowVersion = WorkflowRowVersion(completed) }));

        response.GetProperty("taskStatusChanged").GetBoolean().ShouldBeTrue();
        var task = response.GetProperty("task");
        Status(task).ShouldBe("IN_PROGRESS");
        task.GetProperty("completedAtUtc").ValueKind.ShouldBe(JsonValueKind.Null);
        StepStatus(task, step).ShouldBe("IN_PROGRESS");
        var events = await _h.AuditAsync(TaskId(completed));
        var statusChange = events.Last(e => e.EventType == "TASK_STATUS_CHANGED");
        (statusChange.OldValue, statusChange.NewValue).ShouldBe(("COMPLETED", "IN_PROGRESS"));
        statusChange.Summary.ShouldBe("cause=STEP_REOPEN");
        var stepEvent = events.Last(e => e.EventType == "STEP_REOPENED");
        stepEvent.CorrelationId.ShouldBe(statusChange.CorrelationId);
    }

    [Fact]
    public async Task Step_reopen_on_a_completed_task_needs_an_active_matter()
    {
        var completed = await _h.ReachAsync(_w, "COMPLETED");
        await _h.SetMatterActiveAsync(_w.MatterId, false);

        await ProblemAsync(await _h.Admin.PostAsJsonAsync(StepUrl(completed, StepIds(completed)[0], "reopen"), new { rowVersion = WorkflowRowVersion(completed) }), HttpStatusCode.Conflict, "MATTER_INACTIVE");

        var after = await _h.GetTaskAsync(TaskId(completed));
        Status(after).ShouldBe("COMPLETED");
        StepStatus(after, StepIds(after)[0]).ShouldBe("COMPLETED");
    }

    [Fact]
    public async Task Step_actions_are_blocked_on_hold_and_on_cancelled_tasks()
    {
        var onHold = await _h.ReachAsync(_w, "ON_HOLD");
        var cancelled = await _h.ReachAsync(_w, "CANCELLED");

        foreach (var task in new[] { onHold, cancelled })
        {
            var step = StepIds(task)[0];
            foreach (var action in new[] { "start", "values", "complete", "skip", "reopen" })
            {
                var problem = await ProblemAsync(await _h.Admin.PostAsJsonAsync(StepUrl(task, step, action), new { rowVersion = WorkflowRowVersion(task), comment = "x", values = new { } }), HttpStatusCode.Conflict, "TASK_NOT_EDITABLE");
                problem.GetProperty("meta").GetProperty("taskStatus").GetString().ShouldBe(Status(task) == "ON_HOLD" ? "OnHold" : "Cancelled");
            }
        }

        // After resuming, step actions work again.
        var resumed = await _h.StatusAsync(onHold, "IN_PROGRESS");
        StepStatus(await _h.StepAsync(resumed, StepIds(resumed)[0], "start"), StepIds(resumed)[0]).ShouldBe("IN_PROGRESS");
    }

    [Fact]
    public async Task Step_actions_need_workflow_execute_and_reopen_needs_step_reopen()
    {
        var task = await _h.CreateTaskAsync(_w, ordered: false);
        var steps = StepIds(task);
        var noExecute = await _h.UserWithAsync(@"KE\viewonly", TaskHarness.AllTaskPermissions.Where(p => p != "Workflow.Execute").ToArray());
        var noReopen = await _h.UserWithAsync(@"KE\noreopen", TaskHarness.AllTaskPermissions.Where(p => p != "Workflow.StepReopen").ToArray());

        foreach (var action in new[] { "start", "values", "complete", "skip", "reopen" })
        {
            var client = action == "reopen" ? noReopen : noExecute;
            await ProblemAsync(await client.PostAsJsonAsync(StepUrl(task, steps[0], action), new { rowVersion = WorkflowRowVersion(task) }), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        }

        StepStatus(await _h.GetTaskAsync(TaskId(task)), steps[0]).ShouldBe("PENDING");
        (await _h.AuditAsync(TaskId(task))).ShouldNotContain(e => e.EventType.StartsWith("STEP_"));

        // The users still work with the permission they do hold.
        (await noReopen.PostAsJsonAsync(StepUrl(task, steps[0], "start"), new { rowVersion = WorkflowRowVersion(task) })).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task A_stale_workflow_row_version_is_a_concurrency_conflict_and_unknown_ids_are_not_found()
    {
        var task = await _h.CreateTaskAsync(_w, ordered: false);
        var steps = StepIds(task);
        var started = await _h.StepAsync(task, steps[0], "start", new { rowVersion = WorkflowRowVersion(task) });

        await ProblemAsync(await _h.Admin.PostAsJsonAsync(StepUrl(task, steps[1], "start"), new { rowVersion = WorkflowRowVersion(task) }), HttpStatusCode.Conflict, "CONCURRENCY_CONFLICT");
        var ok = await _h.StepAsync(started, steps[1], "start", new { rowVersion = WorkflowRowVersion(started) });
        StepStatus(ok, steps[1]).ShouldBe("IN_PROGRESS");

        await ProblemAsync(await _h.Admin.PostAsJsonAsync(StepUrl(ok, 999999, "start"), new { rowVersion = WorkflowRowVersion(ok) }), HttpStatusCode.NotFound, "NOT_FOUND");
        await ProblemAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/999999/workflow/steps/{steps[0]}/start", new { rowVersion = WorkflowRowVersion(ok) }), HttpStatusCode.NotFound, "NOT_FOUND");
    }

    [Fact]
    public async Task Step_values_are_audited_and_hidden_values_are_dropped_and_reported()
    {
        var task = await _h.CreateTaskAsync(_w, ordered: true);
        var first = StepIds(task)[0];

        var saved = await OkAsync(await _h.Admin.PostAsJsonAsync(StepUrl(task, first, "values"), new { rowVersion = WorkflowRowVersion(task), values = new { has_extra = false, extra = "hidden" } }));

        saved.GetProperty("droppedFields").EnumerateArray().Select(e => e.GetString()).ShouldBe(["extra"]);
        saved.GetProperty("affectedStepInstanceIds").GetArrayLength().ShouldBe(1);
        saved.GetProperty("taskStatusChanged").GetBoolean().ShouldBeFalse();
        var events = await _h.AuditAsync(TaskId(task));
        events.ShouldContain(e => e.EventType == "STEP_VALUES_EDITED" && e.TaskId == TaskId(task) && e.MatterId == _w.MatterId);
        events.ShouldContain(e => e.EventType == "STEP_STARTED");
    }

    [Fact]
    public async Task A_task_keeps_its_workflow_version_when_a_newer_one_is_published()
    {
        var task = await _h.CreateTaskAsync(_w, ordered: true);
        var newStep = await _h.Workflows.CreateStepAsync("Brand new step");
        await _h.Workflows.PublishNextVersionAsync(_w.OrderedWorkflowId, true, new MatterFlow.IntegrationTests.Workflows.WorkflowInstanceHarness.Place(newStep));

        var again = await _h.GetTaskAsync(TaskId(task));
        again.GetProperty("workflow").GetProperty("versionNo").GetInt32().ShouldBe(1);
        again.GetProperty("workflow").GetProperty("steps").GetArrayLength().ShouldBe(3);

        var fresh = await _h.CreateTaskAsync(_w, ordered: true);
        fresh.GetProperty("workflow").GetProperty("versionNo").GetInt32().ShouldBe(2);
        fresh.GetProperty("workflow").GetProperty("steps").GetArrayLength().ShouldBe(1);
    }
}
