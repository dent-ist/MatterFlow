using System.Net;
using System.Net.Http.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Tasks;

/// <summary>
/// Failure injection: a database trigger makes the LAST write of a command fail, after the workflow engine and the other writes of the same
/// command already ran. Everything - workflow rows, steps, comment, form values and audit rows - must be gone afterwards (architecture 9, 10).
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskAtomicityTests(SqlServerFixture sql) : IAsyncLifetime
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

    private sealed record Counts(int Tasks, int Instances, int Steps, int Comments, int FormValues, int Audit);

    private async Task<Counts> CountsAsync() => new(
        await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.Task"),
        await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.WorkflowInstance"),
        await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.StepInstance"),
        await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.TaskComment"),
        await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.FormValueSet WHERE OwnerKind = 'TASK'"),
        await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.AuditEvent"));

    private Task InstallFailureAsync(string name, string table, string timing, string condition) =>
        _h.ExecuteAsync($"CREATE TRIGGER dbo.{name} ON dbo.{table} {timing} AS BEGIN SET NOCOUNT ON; {condition} THROW 59999, 'Injected failure', 1; END");

    private Task RemoveFailureAsync(string name) => _h.ExecuteAsync($"DROP TRIGGER dbo.{name}");

    [Fact]
    public async Task A_failure_while_inserting_the_task_rolls_back_the_workflow_instance_form_values_and_audit_rows()
    {
        var before = await CountsAsync();
        await InstallFailureAsync("TR_Inject_Insert", "Task", "AFTER INSERT", string.Empty);

        var body = _h.NewTask(_w, extra: new() { ["formValues"] = new Dictionary<string, object?> { ["notes"] = "n" } });
        var response = await _h.Admin.PostAsJsonAsync("/api/v1/tasks", body);

        response.StatusCode.ShouldBe(HttpStatusCode.InternalServerError);
        (await CountsAsync()).ShouldBe(before);
        (await _h.AuditAsync("TASK_CREATED")).ShouldBeEmpty();

        await RemoveFailureAsync("TR_Inject_Insert");
        var ok = await _h.Admin.PostAsJsonAsync("/api/v1/tasks", body);
        ok.StatusCode.ShouldBe(HttpStatusCode.Created);
        var after = await CountsAsync();
        (after.Tasks, after.Instances, after.Steps, after.FormValues).ShouldBe((1, 1, 3, 1));
    }

    [Fact]
    public async Task A_failure_after_the_form_values_are_saved_still_rolls_everything_back()
    {
        var before = await CountsAsync();
        await InstallFailureAsync("TR_Inject_Values", "FormValueSet", "AFTER INSERT", "IF EXISTS (SELECT 1 FROM inserted WHERE OwnerKind = 'TASK')");

        var response = await _h.Admin.PostAsJsonAsync("/api/v1/tasks", _h.NewTask(_w, extra: new() { ["formValues"] = new Dictionary<string, object?> { ["notes"] = "n" } }));

        response.StatusCode.ShouldBe(HttpStatusCode.InternalServerError);
        (await CountsAsync()).ShouldBe(before);
    }

    [Fact]
    public async Task A_failure_while_completing_rolls_back_the_bulk_completed_steps_and_their_audit_rows()
    {
        var task = await _h.CreateTaskAsync(_w, ordered: false);
        var before = await CountsAsync();
        await InstallFailureAsync("TR_Inject_Complete", "Task", "AFTER UPDATE", "IF EXISTS (SELECT 1 FROM inserted WHERE StatusCode = 'COMPLETED')");

        var request = new { completeUnresolvedSteps = true, rowVersion = RowVersion(task) };
        var response = await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/complete", request);

        response.StatusCode.ShouldBe(HttpStatusCode.InternalServerError);
        (await CountsAsync()).ShouldBe(before);
        var after = await _h.GetTaskAsync(TaskId(task));
        Status(after).ShouldBe("NEW");
        RowVersion(after).ShouldBe(RowVersion(task));
        after.GetProperty("workflow").GetProperty("steps").EnumerateArray().ShouldAllBe(s => s.GetProperty("status").GetString() == "PENDING");
        (await _h.AuditAsync(TaskId(task))).ShouldNotContain(e => e.EventType == "STEP_COMPLETED" || e.EventType == "TASK_STATUS_CHANGED");

        await RemoveFailureAsync("TR_Inject_Complete");
        var retried = await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/complete", request));
        Status(retried).ShouldBe("COMPLETED");
        (await _h.AuditAsync(TaskId(task))).Count(e => e.EventType == "STEP_COMPLETED").ShouldBe(2);
    }

    [Fact]
    public async Task A_failure_while_reopening_a_step_of_a_completed_task_leaves_the_step_and_the_task_untouched()
    {
        var completed = await _h.ReachAsync(_w, "COMPLETED");
        var step = StepIds(completed)[0];
        var before = await CountsAsync();
        await InstallFailureAsync(
            "TR_Inject_Reopen",
            "Task",
            "AFTER UPDATE",
            "IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.TaskId = i.TaskId WHERE d.StatusCode = 'COMPLETED' AND i.StatusCode = 'IN_PROGRESS')");

        var url = $"/api/v1/tasks/{TaskId(completed)}/workflow/steps/{step}/reopen";
        var response = await _h.Admin.PostAsJsonAsync(url, new { });

        response.StatusCode.ShouldBe(HttpStatusCode.InternalServerError);
        (await CountsAsync()).ShouldBe(before);
        var after = await _h.GetTaskAsync(TaskId(completed));
        Status(after).ShouldBe("COMPLETED");
        StepStatus(after, step).ShouldBe("COMPLETED");
        (await _h.AuditAsync(TaskId(completed))).ShouldNotContain(e => e.EventType == "STEP_REOPENED");

        await RemoveFailureAsync("TR_Inject_Reopen");
        var ok = await OkAsync(await _h.Admin.PostAsJsonAsync(url, new { }));
        ok.GetProperty("task").GetProperty("status").GetString().ShouldBe("IN_PROGRESS");
    }

    [Fact]
    public async Task A_failure_while_cancelling_leaves_no_comment_behind()
    {
        var task = await _h.CreateTaskAsync(_w, ordered: false);
        var before = await CountsAsync();
        await InstallFailureAsync("TR_Inject_Cancel", "Task", "AFTER UPDATE", "IF EXISTS (SELECT 1 FROM inserted WHERE StatusCode = 'CANCELLED')");

        var request = new { comment = "Client withdrew", rowVersion = RowVersion(task) };
        var response = await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/cancel", request);

        response.StatusCode.ShouldBe(HttpStatusCode.InternalServerError);
        (await CountsAsync()).ShouldBe(before);
        Status(await _h.GetTaskAsync(TaskId(task))).ShouldBe("NEW");

        await RemoveFailureAsync("TR_Inject_Cancel");
        var cancelled = await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/cancel", request));
        Status(cancelled).ShouldBe("CANCELLED");
        (await CountsAsync()).Comments.ShouldBe(1);
    }

    [Fact]
    public async Task A_failure_while_assigning_rolls_back_the_assignment_and_the_auto_start()
    {
        var task = await _h.CreateTaskAsync(_w);
        await _h.UserWithAsync(@"KE\target", TaskHarness.AllTaskPermissions);
        var userId = await _h.UserIdAsync(@"KE\target");
        var before = await CountsAsync();
        await InstallFailureAsync("TR_Inject_Assign", "Task", "AFTER UPDATE", "IF EXISTS (SELECT 1 FROM inserted WHERE AssignedUserId IS NOT NULL)");

        var response = await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/assignment", new { userId, rowVersion = RowVersion(task) });

        response.StatusCode.ShouldBe(HttpStatusCode.InternalServerError);
        (await CountsAsync()).ShouldBe(before);
        var after = await _h.GetTaskAsync(TaskId(task));
        Status(after).ShouldBe("NEW");
        after.GetProperty("assignedUser").ValueKind.ShouldBe(System.Text.Json.JsonValueKind.Null);
    }
}
