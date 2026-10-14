using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Tasks;

/// <summary>Task status changes (ticket 42) over HTTP: the lifecycle matrix per permission, mandatory comments, reopen, bulk completion (addendum K).</summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskLifecycleApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private static readonly string[] Statuses = ["NEW", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"];

    /// <summary>The architecture 8.3 matrix: from -> allowed targets.</summary>
    private static readonly Dictionary<string, string[]> Allowed = new()
    {
        ["NEW"] = ["IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"],
        ["IN_PROGRESS"] = ["ON_HOLD", "COMPLETED", "CANCELLED"],
        ["ON_HOLD"] = ["IN_PROGRESS", "CANCELLED"],
        ["COMPLETED"] = ["IN_PROGRESS", "CANCELLED"],
        ["CANCELLED"] = ["IN_PROGRESS"],
    };

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

    private async Task<HttpResponseMessage> TryStatusAsync(JsonElement task, string status, HttpClient? client = null) =>
        await (client ?? _h.Admin).PostAsJsonAsync(
            $"/api/v1/tasks/{TaskId(task)}/status",
            new { status, comment = status is "ON_HOLD" or "CANCELLED" ? "Because." : null, rowVersion = RowVersion(task) });

    [Fact]
    public async Task The_whole_status_matrix_over_http()
    {
        foreach (var from in Statuses)
        {
            foreach (var to in Statuses)
            {
                var task = await _h.ReachAsync(_w, from);
                Status(task).ShouldBe(from);

                var response = to == "COMPLETED"
                    ? await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/complete", new { completeUnresolvedSteps = true, rowVersion = RowVersion(task) })
                    : await TryStatusAsync(task, to);

                if (Allowed[from].Contains(to))
                {
                    var updated = await OkAsync(response);
                    Status(updated).ShouldBe(to, $"{from} -> {to}");
                    (updated.GetProperty("completedAtUtc").ValueKind == JsonValueKind.String).ShouldBe(to == "COMPLETED", $"{from} -> {to}");
                }
                else
                {
                    await ProblemAsync(response, HttpStatusCode.Conflict, "INVALID_STATUS_TRANSITION");
                    Status(await _h.GetTaskAsync(TaskId(task))).ShouldBe(from, $"{from} -> {to} must not change anything");
                }
            }
        }
    }

    [Fact]
    public async Task Allowed_actions_list_exactly_the_matrix_transitions_with_their_permissions()
    {
        foreach (var from in Statuses)
        {
            var task = await _h.ReachAsync(_w, from);
            var transitions = task.GetProperty("allowedActions").GetProperty("transitions").EnumerateArray()
                .Select(t => t.GetProperty("targetStatus").GetString()!).ToArray();
            transitions.ShouldBe(Allowed[from], ignoreOrder: true, $"from {from}");
        }

        var onHold = await _h.ReachAsync(_w, "ON_HOLD");
        var resume = onHold.GetProperty("allowedActions").GetProperty("transitions").EnumerateArray().Single(t => t.GetProperty("targetStatus").GetString() == "IN_PROGRESS");
        resume.GetProperty("action").GetString().ShouldBe("RESUME");
        resume.GetProperty("requiredPermission").GetString().ShouldBe("Task.ChangeStatus");
        onHold.GetProperty("allowedActions").GetProperty("canEdit").GetBoolean().ShouldBeTrue();
        onHold.GetProperty("allowedActions").GetProperty("canExecuteSteps").GetBoolean().ShouldBeFalse();

        var reduced = await _h.UserWithAsync(@"KE\reader", "Task.View", "Task.ChangeStatus");
        var seen = await _h.GetTaskAsync(TaskId(onHold), reduced);
        seen.GetProperty("allowedActions").GetProperty("canEdit").GetBoolean().ShouldBeFalse();
        var cancel = seen.GetProperty("allowedActions").GetProperty("transitions").EnumerateArray().Single(t => t.GetProperty("action").GetString() == "CANCEL");
        cancel.GetProperty("permitted").GetBoolean().ShouldBeFalse();
        cancel.GetProperty("blockedReason").GetString().ShouldBe("PERMISSION_DENIED");
        cancel.GetProperty("requiresComment").GetBoolean().ShouldBeTrue();
    }

    [Theory]
    [InlineData("NEW", "IN_PROGRESS", "Task.ChangeStatus")]
    [InlineData("IN_PROGRESS", "ON_HOLD", "Task.ChangeStatus")]
    [InlineData("ON_HOLD", "IN_PROGRESS", "Task.ChangeStatus")]
    [InlineData("IN_PROGRESS", "COMPLETED", "Task.Complete")]
    [InlineData("NEW", "COMPLETED", "Task.Complete")]
    [InlineData("IN_PROGRESS", "CANCELLED", "Task.Cancel")]
    [InlineData("COMPLETED", "CANCELLED", "Task.Cancel")]
    [InlineData("COMPLETED", "IN_PROGRESS", "Task.Reopen")]
    [InlineData("CANCELLED", "IN_PROGRESS", "Task.Reopen")]
    public async Task Each_transition_needs_its_own_permission_and_a_denial_changes_nothing(string from, string to, string permission)
    {
        var task = await _h.ReachAsync(_w, from);
        var user = @"KE\" + permission.Replace('.', '_').ToLowerInvariant() + from.ToLowerInvariant() + to.ToLowerInvariant();
        var withoutIt = await _h.UserWithAsync(user, TaskHarness.AllTaskPermissions.Where(p => p != permission).ToArray());
        var before = (await _h.AuditAsync(TaskId(task))).Count;

        // Through the generic status endpoint (service-level check) ...
        var response = to == "COMPLETED"
            ? await withoutIt.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/status", new { status = "COMPLETED", rowVersion = RowVersion(task) })
            : await TryStatusAsync(task, to, withoutIt);
        var problem = await ProblemAsync(response, HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        if (permission != "Task.ChangeStatus")
            problem.GetProperty("meta").GetProperty("permission").GetString().ShouldBe(permission);

        // ... and through the dedicated endpoints (policy-level check).
        if (permission == "Task.Complete")
            await ProblemAsync(await withoutIt.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/complete", new { completeUnresolvedSteps = true, rowVersion = RowVersion(task) }), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        if (permission == "Task.Cancel")
            await ProblemAsync(await withoutIt.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/cancel", new { comment = "no", rowVersion = RowVersion(task) }), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        if (permission == "Task.Reopen")
            await ProblemAsync(await withoutIt.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/reopen", new { rowVersion = RowVersion(task) }), HttpStatusCode.Forbidden, "PERMISSION_DENIED");

        var after = await _h.GetTaskAsync(TaskId(task));
        Status(after).ShouldBe(from);
        RowVersion(after).ShouldBe(RowVersion(task));
        (await _h.AuditAsync(TaskId(task))).Count.ShouldBe(before);
        (await _h.ScalarAsync($"SELECT COUNT(*) AS [Value] FROM dbo.TaskComment WHERE TaskId = {TaskId(task)} AND Purpose <> 'NORMAL'")).ShouldBe(from is "ON_HOLD" or "CANCELLED" ? 1 : 0);
    }

    [Fact]
    public async Task A_user_with_all_the_permissions_can_run_each_transition_exactly_once_per_matrix()
    {
        var full = await _h.UserWithAsync(@"KE\fulltech", TaskHarness.AllTaskPermissions);
        var task = await _h.CreateTaskAsync(_w, ordered: false, client: full);

        var started = await _h.StatusAsync(task, "IN_PROGRESS", client: full);
        var held = await _h.StatusAsync(started, "ON_HOLD", "Waiting on the client", full);
        var resumed = await _h.StatusAsync(held, "IN_PROGRESS", client: full);
        var completed = await _h.CompleteAsync(resumed, client: full);
        var reopened = await _h.PostAsync(TaskId(completed), "reopen", new { rowVersion = RowVersion(completed) }, full);

        Status(reopened).ShouldBe("IN_PROGRESS");
        reopened.GetProperty("completedAtUtc").ValueKind.ShouldBe(JsonValueKind.Null);
        var statusEvents = (await _h.AuditAsync(TaskId(task))).Where(e => e.EventType == "TASK_STATUS_CHANGED").Select(e => $"{e.OldValue}>{e.NewValue}").ToList();
        statusEvents.ShouldBe(["NEW>IN_PROGRESS", "IN_PROGRESS>ON_HOLD", "ON_HOLD>IN_PROGRESS", "IN_PROGRESS>COMPLETED", "COMPLETED>IN_PROGRESS"]);
    }

    // ---- comments

    [Fact]
    public async Task Cancel_and_on_hold_need_a_comment_which_is_stored_escaped_and_cannot_be_deleted()
    {
        var task = await _h.CreateTaskAsync(_w, ordered: false);

        foreach (var blank in new string?[] { null, "", "   " })
        {
            await ProblemAsync(
                await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/status", new { status = "CANCELLED", comment = blank, rowVersion = RowVersion(task) }),
                HttpStatusCode.BadRequest,
                "CANCEL_COMMENT_REQUIRED");
            await ProblemAsync(
                await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/status", new { status = "ON_HOLD", comment = blank, rowVersion = RowVersion(task) }),
                HttpStatusCode.BadRequest,
                "HOLD_COMMENT_REQUIRED");
        }

        await ProblemAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/cancel", new { comment = "  ", rowVersion = RowVersion(task) }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        Status(await _h.GetTaskAsync(TaskId(task))).ShouldBe("NEW");
        (await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.TaskComment")).ShouldBe(0);

        var held = await _h.StatusAsync(task, "ON_HOLD", "Waiting for <b>client</b> & \"counsel\"\nsecond line");
        var reason = held.GetProperty("statusReason");
        reason.GetProperty("purpose").GetString().ShouldBe("ON_HOLD");
        reason.GetProperty("bodyHtml").GetString().ShouldBe("<p>Waiting for &lt;b&gt;client&lt;/b&gt; &amp; &quot;counsel&quot;<br>second line</p>");
        reason.GetProperty("authorName").GetString().ShouldNotBeNullOrWhiteSpace();

        var resumed = await _h.StatusAsync(held, "IN_PROGRESS");
        resumed.GetProperty("statusReason").ValueKind.ShouldBe(JsonValueKind.Null);

        var cancelled = await _h.PostAsync(TaskId(resumed), "cancel", new { comment = "Duplicate of another request", rowVersion = RowVersion(resumed) });
        cancelled.GetProperty("statusReason").GetProperty("purpose").GetString().ShouldBe("CANCEL");
        cancelled.GetProperty("statusReason").GetProperty("bodyHtml").GetString().ShouldBe("<p>Duplicate of another request</p>");

        var events = await _h.AuditAsync(TaskId(task));
        events.Count(e => e.EventType == "COMMENT_ADDED").ShouldBe(2);
        var cancelEvent = events.Last(e => e.EventType == "TASK_STATUS_CHANGED");
        var commentId = await _h.ScalarAsync("SELECT CAST(TaskCommentId AS INT) AS [Value] FROM dbo.TaskComment WHERE Purpose = 'CANCEL'");
        cancelEvent.Summary.ShouldBe($"cause=MANUAL; commentId={commentId}");

        // The reasons cannot be soft-deleted or removed, whatever the caller.
        var soft = await Should.ThrowAsync<Exception>(() => _h.ExecuteAsync("UPDATE dbo.TaskComment SET IsDeleted = 1, DeletedAt = SYSUTCDATETIME() WHERE Purpose <> 'NORMAL'"));
        soft.ToString().ShouldContain("CK_TaskComment_ReasonNotDeletable");
        var hard = await Should.ThrowAsync<Exception>(() => _h.ExecuteAsync("DELETE FROM dbo.TaskComment"));
        hard.ToString().ShouldContain("cannot be deleted");
        var purpose = await Should.ThrowAsync<Exception>(() => _h.ExecuteAsync("UPDATE dbo.TaskComment SET Purpose = 'NORMAL'"));
        purpose.ToString().ShouldContain("cannot change");
    }

    [Fact]
    public async Task A_normal_comment_row_can_be_soft_deleted_but_never_physically_deleted()
    {
        var task = await _h.CreateTaskAsync(_w);
        var authorId = await _h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        await _h.ExecuteAsync($"INSERT dbo.TaskComment (TaskId, AuthorUserId, BodyHtml) VALUES ({TaskId(task)}, {authorId}, N'<p>hi</p>')");

        await _h.ExecuteAsync("UPDATE dbo.TaskComment SET IsDeleted = 1, DeletedAt = SYSUTCDATETIME()");
        (await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.TaskComment WHERE IsDeleted = 1")).ShouldBe(1);
        await Should.ThrowAsync<Exception>(() => _h.ExecuteAsync("DELETE FROM dbo.TaskComment"));
    }

    // ---- reopen

    [Fact]
    public async Task Reopening_needs_an_active_matter_and_only_applies_to_closed_tasks()
    {
        var completed = await _h.ReachAsync(_w, "COMPLETED");
        var cancelled = await _h.ReachAsync(_w, "CANCELLED");
        await _h.SetMatterActiveAsync(_w.MatterId, false);

        var blocked1 = await ProblemAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(completed)}/reopen", new { rowVersion = RowVersion(completed) }), HttpStatusCode.Conflict, "MATTER_INACTIVE");
        blocked1.GetProperty("code").GetString().ShouldBe("MATTER_INACTIVE");
        await ProblemAsync(await TryStatusAsync(cancelled, "IN_PROGRESS"), HttpStatusCode.Conflict, "MATTER_INACTIVE");
        var transitions = (await _h.GetTaskAsync(TaskId(cancelled))).GetProperty("allowedActions").GetProperty("transitions").EnumerateArray().ToList();
        var reopen = transitions.Single(t => t.GetProperty("action").GetString() == "REOPEN");
        reopen.GetProperty("permitted").GetBoolean().ShouldBeFalse();
        reopen.GetProperty("blockedReason").GetString().ShouldBe("MATTER_INACTIVE");
        Status(await _h.GetTaskAsync(TaskId(completed))).ShouldBe("COMPLETED");

        await _h.SetMatterActiveAsync(_w.MatterId, true);
        var reopened = await _h.PostAsync(TaskId(completed), "reopen", new { rowVersion = RowVersion(completed) });
        Status(reopened).ShouldBe("IN_PROGRESS");

        // The reopen endpoint is only for Completed and Cancelled tasks.
        await ProblemAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(reopened)}/reopen", new { rowVersion = RowVersion(reopened) }), HttpStatusCode.Conflict, "INVALID_STATUS_TRANSITION");
    }

    [Fact]
    public async Task A_matter_with_open_tasks_cannot_be_deactivated_until_they_are_closed()
    {
        var task = await _h.CreateTaskAsync(_w);

        await _h.SetMatterActiveAsync(_w.MatterId, false, HttpStatusCode.Conflict);

        var held = await _h.StatusAsync(task, "ON_HOLD", "paused");
        await _h.SetMatterActiveAsync(_w.MatterId, false, HttpStatusCode.Conflict);

        await _h.StatusAsync(held, "CANCELLED", "closing");
        await _h.SetMatterActiveAsync(_w.MatterId, false);
        await _h.SetMatterActiveAsync(_w.MatterId, true);
    }

    // ---- completion and bulk completion

    [Fact]
    public async Task Completing_with_unresolved_steps_is_blocked_and_the_completion_check_names_them()
    {
        var task = await _h.CreateTaskAsync(_w, ordered: true);

        var problem = await ProblemAsync(
            await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/complete", new { completeUnresolvedSteps = false, rowVersion = RowVersion(task) }),
            HttpStatusCode.Conflict,
            "COMPLETION_BLOCKED");
        problem.GetProperty("meta").GetProperty("unresolvedStepIds").GetArrayLength().ShouldBe(3);
        problem.GetProperty("meta").GetProperty("stepsMissingInputs").EnumerateArray().Select(e => e.GetInt32()).ShouldBe([StepIds(task)[0]]);

        var check = await OkAsync(await _h.Admin.GetAsync($"/api/v1/tasks/{TaskId(task)}/completion"));
        check.GetProperty("isReady").GetBoolean().ShouldBeFalse();
        check.GetProperty("canBulkComplete").GetBoolean().ShouldBeFalse();
        check.GetProperty("unresolved").GetArrayLength().ShouldBe(3);
        check.GetProperty("blocked")[0].GetProperty("title").GetString().ShouldBe("Intake review");
        check.GetProperty("bulkCompletable").GetArrayLength().ShouldBe(2);

        Status(await _h.GetTaskAsync(TaskId(task))).ShouldBe("NEW");
        await ProblemAsync(await _h.Admin.GetAsync("/api/v1/tasks/999999/completion"), HttpStatusCode.NotFound, "NOT_FOUND");
    }

    [Fact]
    public async Task Bulk_completion_is_all_or_nothing_when_a_step_lacks_required_inputs()
    {
        var task = await _h.CreateTaskAsync(_w, ordered: true);
        var auditBefore = (await _h.AuditAsync(TaskId(task))).Count;

        var problem = await ProblemAsync(
            await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/complete", new { completeUnresolvedSteps = true, rowVersion = RowVersion(task) }),
            HttpStatusCode.Conflict,
            "COMPLETION_BLOCKED");
        problem.GetProperty("meta").GetProperty("stepsMissingInputs").EnumerateArray().Select(e => e.GetInt32()).ShouldBe([StepIds(task)[0]]);

        var after = await _h.GetTaskAsync(TaskId(task));
        Status(after).ShouldBe("NEW");
        after.GetProperty("workflow").GetProperty("steps").EnumerateArray().ShouldAllBe(s => s.GetProperty("status").GetString() == "PENDING");
        (await _h.AuditAsync(TaskId(task))).Count.ShouldBe(auditBefore);

        // Fill in the missing input and the same request now completes everything in one go.
        var filled = await _h.StepAsync(after, StepIds(after)[0], "values", new { values = new { note = "reviewed" } });
        var completed = await _h.CompleteAsync(filled, bulk: true);

        Status(completed).ShouldBe("COMPLETED");
        completed.GetProperty("workflow").GetProperty("steps").EnumerateArray().ShouldAllBe(s => s.GetProperty("status").GetString() == "COMPLETED");
        completed.GetProperty("bulkCompletedStepInstanceIds").GetArrayLength().ShouldBe(3);
        completed.GetProperty("completedAtUtc").ValueKind.ShouldBe(JsonValueKind.String);
    }

    [Fact]
    public async Task Bulk_completion_audits_each_step_as_bulk_with_one_correlation_id_shared_with_the_task_completion()
    {
        var task = await _h.CreateTaskAsync(_w, ordered: false);

        var completed = await _h.CompleteAsync(task, bulk: true);

        completed.GetProperty("bulkCompletedStepInstanceIds").GetArrayLength().ShouldBe(2);
        var events = await _h.AuditAsync(TaskId(completed));
        var steps = events.Where(e => e.EventType == "STEP_COMPLETED").ToList();
        steps.Count.ShouldBe(2);
        steps.ShouldAllBe(e => e.Summary!.Contains("bulk=true"));
        var statusEvent = events.Single(e => e.EventType == "TASK_STATUS_CHANGED");
        statusEvent.NewValue.ShouldBe("COMPLETED");
        statusEvent.Summary!.ShouldContain("bulk completed 2 step(s)");
        events.Where(e => e.EventType is "STEP_COMPLETED" or "TASK_STATUS_CHANGED").Select(e => e.CorrelationId).Distinct().Count().ShouldBe(1);
    }

    [Fact]
    public async Task Bulk_completion_also_needs_workflow_execute_and_nothing_changes_without_it()
    {
        var task = await _h.CreateTaskAsync(_w, ordered: false);
        var onlyComplete = await _h.UserWithAsync(@"KE\closer", "Task.View", "Task.Complete");

        var problem = await ProblemAsync(
            await onlyComplete.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/complete", new { completeUnresolvedSteps = true, rowVersion = RowVersion(task) }),
            HttpStatusCode.Forbidden,
            "PERMISSION_DENIED");
        problem.GetProperty("meta").GetProperty("permission").GetString().ShouldBe("Workflow.Execute");
        Status(await _h.GetTaskAsync(TaskId(task))).ShouldBe("NEW");

        // Without the bulk flag the Complete permission alone gets the plain completion-blocked answer.
        await ProblemAsync(
            await onlyComplete.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/complete", new { completeUnresolvedSteps = false, rowVersion = RowVersion(task) }),
            HttpStatusCode.Conflict,
            "COMPLETION_BLOCKED");
    }

    [Fact]
    public async Task A_task_whose_steps_are_all_resolved_completes_without_the_bulk_flag_and_steps_skipped_count_as_resolved()
    {
        var task = await _h.CreateTaskAsync(_w, ordered: false);
        var steps = StepIds(task);
        var afterFirst = await _h.StepAsync(task, steps[0], "complete");
        var afterSkip = await _h.StepAsync(afterFirst, steps[1], "skip");

        var completed = await _h.CompleteAsync(afterSkip, bulk: false);

        Status(completed).ShouldBe("COMPLETED");
        completed.GetProperty("bulkCompletedStepInstanceIds").GetArrayLength().ShouldBe(0);
        var check = await OkAsync(await _h.Admin.GetAsync($"/api/v1/tasks/{TaskId(task)}/completion"));
        check.GetProperty("isReady").GetBoolean().ShouldBeTrue();
    }

    [Fact]
    public async Task Cancel_ignores_unresolved_steps_and_a_completed_task_can_be_cancelled_directly()
    {
        var withSteps = await _h.CreateTaskAsync(_w, ordered: true);
        var cancelled = await _h.PostAsync(TaskId(withSteps), "cancel", new { comment = "Client withdrew", rowVersion = RowVersion(withSteps) });
        Status(cancelled).ShouldBe("CANCELLED");
        cancelled.GetProperty("workflow").GetProperty("steps").EnumerateArray().ShouldAllBe(s => s.GetProperty("status").GetString() == "PENDING");

        var completed = await _h.ReachAsync(_w, "COMPLETED");
        var recancelled = await _h.PostAsync(TaskId(completed), "cancel", new { comment = "Cancel after completion", rowVersion = RowVersion(completed) });
        Status(recancelled).ShouldBe("CANCELLED");
        recancelled.GetProperty("completedAtUtc").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    // ---- concurrency and validation

    [Fact]
    public async Task Status_commands_detect_stale_row_versions_and_unknown_codes_and_ids()
    {
        var task = await _h.CreateTaskAsync(_w);
        var started = await _h.StatusAsync(task, "IN_PROGRESS");

        var stale = await ProblemAsync(
            await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/status", new { status = "ON_HOLD", comment = "x", rowVersion = RowVersion(task) }),
            HttpStatusCode.Conflict,
            "CONCURRENCY_CONFLICT");
        stale.GetProperty("meta").GetProperty("currentRowVersion").GetString().ShouldBe(RowVersion(started));

        await ProblemAsync(
            await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/status", new { status = "FINISHED", rowVersion = RowVersion(started) }),
            HttpStatusCode.BadRequest,
            "VALIDATION_FAILED");
        await ProblemAsync(
            await _h.Admin.PostAsJsonAsync("/api/v1/tasks/999999/status", new { status = "IN_PROGRESS", rowVersion = RowVersion(started) }),
            HttpStatusCode.NotFound,
            "NOT_FOUND");
        await ProblemAsync(
            await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/status", new { status = "IN_PROGRESS", rowVersion = RowVersion(started) }),
            HttpStatusCode.Conflict,
            "INVALID_STATUS_TRANSITION");
    }

    [Fact]
    public async Task Two_simultaneous_status_changes_with_the_same_version_let_exactly_one_win()
    {
        var task = await _h.CreateTaskAsync(_w);

        var results = await Task.WhenAll(
            Enumerable.Range(0, 4).Select(_ => TryStatusAsync(task, "ON_HOLD")));

        results.Count(r => r.StatusCode == HttpStatusCode.OK).ShouldBe(1);
        results.Count(r => r.StatusCode == HttpStatusCode.Conflict).ShouldBe(3);
        (await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.TaskComment")).ShouldBe(1);
    }
}
