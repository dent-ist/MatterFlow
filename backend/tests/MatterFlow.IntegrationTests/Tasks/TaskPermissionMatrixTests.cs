using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Tasks;

/// <summary>
/// The Task rows of the permission matrix (docs/qa/permission-matrix-tests.md section 3): per operation an unauthenticated caller, a user with no
/// permission (Access Pending), a user holding everything except the required code, and a user holding exactly the required code.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskPermissionMatrixTests(SqlServerFixture sql) : IAsyncLifetime
{
    private sealed record Request(HttpMethod Method, string Url, object? Body, HttpStatusCode Success);

    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private World _w = null!;
    private int _selfId;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        _w = await _h.CreateWorldAsync();
        _selfId = await _h.UserIdAsync(DatabaseApiFactory.AdminAccount);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    public static TheoryData<string, string> Operations() => new()
    {
        { "list", "Task.View" },
        { "get", "Task.View" },
        { "workflow", "Task.View" },
        { "completion-check", "Task.View" },
        { "create", "Task.Create" },
        { "update", "Task.Edit" },
        { "assign", "Task.Assign" },
        { "priority", "Task.SetPriority" },
        { "status", "Task.ChangeStatus" },
        { "complete", "Task.Complete" },
        { "cancel", "Task.Cancel" },
        { "reopen", "Task.Reopen" },
        { "step-start", "Workflow.Execute" },
        { "step-values", "Workflow.Execute" },
        { "step-complete", "Workflow.Execute" },
        { "step-skip", "Workflow.Execute" },
        { "step-reopen", "Workflow.StepReopen" },
    };

    private async Task<Request> PrepareAsync(string operation)
    {
        JsonElement task;
        switch (operation)
        {
            case "list":
                return new(HttpMethod.Get, "/api/v1/tasks", null, HttpStatusCode.OK);
            case "create":
                return new(HttpMethod.Post, "/api/v1/tasks", _h.NewTask(_w), HttpStatusCode.Created);
            case "get":
                task = await _h.CreateTaskAsync(_w);
                return new(HttpMethod.Get, $"/api/v1/tasks/{TaskId(task)}", null, HttpStatusCode.OK);
            case "workflow":
                task = await _h.CreateTaskAsync(_w);
                return new(HttpMethod.Get, $"/api/v1/tasks/{TaskId(task)}/workflow", null, HttpStatusCode.OK);
            case "completion-check":
                task = await _h.CreateTaskAsync(_w);
                return new(HttpMethod.Get, $"/api/v1/tasks/{TaskId(task)}/completion", null, HttpStatusCode.OK);
            case "update":
                task = await _h.CreateTaskAsync(_w);
                return new(HttpMethod.Put, $"/api/v1/tasks/{TaskId(task)}", new { rowVersion = RowVersion(task), title = "Renamed", requestorName = "Pat Partner" }, HttpStatusCode.OK);
            case "assign":
                task = await _h.CreateTaskAsync(_w);
                return new(HttpMethod.Post, $"/api/v1/tasks/{TaskId(task)}/assignment", new { userId = _selfId, rowVersion = RowVersion(task) }, HttpStatusCode.OK);
            case "priority":
                task = await _h.CreateTaskAsync(_w);
                var priorities = await OkAsync(await _h.Admin.GetAsync("/api/v1/priorities"));
                var low = priorities.EnumerateArray().First(p => p.GetProperty("label").GetString() == "Low").GetProperty("id").GetInt32();
                return new(HttpMethod.Post, $"/api/v1/tasks/{TaskId(task)}/priority", new { priorityId = low, rowVersion = RowVersion(task) }, HttpStatusCode.OK);
            case "status":
                task = await _h.CreateTaskAsync(_w);
                return new(HttpMethod.Post, $"/api/v1/tasks/{TaskId(task)}/status", new { status = "IN_PROGRESS", rowVersion = RowVersion(task) }, HttpStatusCode.OK);
            case "complete":
                task = await _h.CreateTaskAsync(_w, ordered: false);
                var steps = StepIds(task);
                task = await _h.StepAsync(task, steps[0], "complete");
                task = await _h.StepAsync(task, steps[1], "skip");
                return new(HttpMethod.Post, $"/api/v1/tasks/{TaskId(task)}/complete", new { completeUnresolvedSteps = false, rowVersion = RowVersion(task) }, HttpStatusCode.OK);
            case "cancel":
                task = await _h.CreateTaskAsync(_w);
                return new(HttpMethod.Post, $"/api/v1/tasks/{TaskId(task)}/cancel", new { comment = "Not needed", rowVersion = RowVersion(task) }, HttpStatusCode.OK);
            case "reopen":
                task = await _h.ReachAsync(_w, "CANCELLED");
                return new(HttpMethod.Post, $"/api/v1/tasks/{TaskId(task)}/reopen", new { rowVersion = RowVersion(task) }, HttpStatusCode.OK);
            case "step-start":
                task = await _h.CreateTaskAsync(_w, ordered: false);
                return new(HttpMethod.Post, $"/api/v1/tasks/{TaskId(task)}/workflow/steps/{StepIds(task)[0]}/start", new { }, HttpStatusCode.OK);
            case "step-values":
                task = await _h.CreateTaskAsync(_w, ordered: false);
                return new(HttpMethod.Post, $"/api/v1/tasks/{TaskId(task)}/workflow/steps/{StepIds(task)[0]}/values", new { values = new { } }, HttpStatusCode.OK);
            case "step-complete":
                task = await _h.CreateTaskAsync(_w, ordered: false);
                return new(HttpMethod.Post, $"/api/v1/tasks/{TaskId(task)}/workflow/steps/{StepIds(task)[0]}/complete", new { }, HttpStatusCode.OK);
            case "step-skip":
                task = await _h.CreateTaskAsync(_w, ordered: false);
                return new(HttpMethod.Post, $"/api/v1/tasks/{TaskId(task)}/workflow/steps/{StepIds(task)[1]}/skip", new { }, HttpStatusCode.OK);
            case "step-reopen":
                task = await _h.CreateTaskAsync(_w, ordered: false);
                task = await _h.StepAsync(task, StepIds(task)[0], "complete");
                return new(HttpMethod.Post, $"/api/v1/tasks/{TaskId(task)}/workflow/steps/{StepIds(task)[0]}/reopen", new { }, HttpStatusCode.OK);
            default:
                throw new ArgumentOutOfRangeException(nameof(operation));
        }
    }

    private static Task<HttpResponseMessage> SendAsync(HttpClient client, Request r) =>
        client.SendAsync(new HttpRequestMessage(r.Method, r.Url) { Content = r.Body is null ? null : Body(r.Body) });

    [Theory]
    [MemberData(nameof(Operations))]
    public async Task Every_task_operation_enforces_its_permission(string operation, string required)
    {
        var request = await PrepareAsync(operation);

        var noRole = _h.As(@"KE\norole-" + operation);
        (await noRole.GetAsync("/api/v1/me")).StatusCode.ShouldBe(HttpStatusCode.OK);
        var missing = await _h.UserWithAsync(@"KE\missing-" + operation, TaskHarness.AllTaskPermissions.Where(p => p != required).ToArray());
        var auditBefore = await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.AuditEvent");
        var tasksBefore = await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.Task");

        // (a) Not signed in.
        var anonymous = _factory.CreateClient();
        anonymous.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        (await SendAsync(anonymous, request)).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);

        // (b) Signed in but without any permission.
        await ProblemAsync(await SendAsync(noRole, request), HttpStatusCode.Forbidden, "ACCESS_PENDING");

        // (c) Everything the Task area offers except the required code.
        var denied = await ProblemAsync(await SendAsync(missing, request), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        denied.TryGetProperty("code", out _).ShouldBeTrue();

        (await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.AuditEvent")).ShouldBe(auditBefore, "a denied request must not leave audit rows");
        (await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.Task")).ShouldBe(tasksBefore);

        // (d) Exactly the required code succeeds.
        var exact = await _h.UserWithAsync(@"KE\exact-" + operation, required);
        var ok = await SendAsync(exact, request);
        ok.StatusCode.ShouldBe(request.Success, await ok.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task A_denied_request_for_a_task_that_does_not_exist_is_still_forbidden()
    {
        var noEdit = await _h.UserWithAsync(@"KE\noedit", "Task.View");

        await ProblemAsync(await noEdit.PutAsJsonAsync("/api/v1/tasks/999999", new { rowVersion = "AAAA", title = "x", requestorName = "r" }), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        await ProblemAsync(await noEdit.PostAsJsonAsync("/api/v1/tasks/999999/cancel", new { comment = "x", rowVersion = "AAAA" }), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
    }

    [Fact]
    public async Task Phase_one_visibility_anyone_with_task_view_sees_every_task_on_every_matter()
    {
        var otherMatter = await _h.CreateMatterAsync("999", "1");
        var hidden = await OkAsync(
            await _h.Admin.PostAsJsonAsync("/api/v1/tasks", new { matterId = otherMatter, taskTypeId = _w.TaskTypeId, workflowDefinitionId = _w.UnorderedWorkflowId, title = "Other client", requestorName = "R" }),
            HttpStatusCode.Created);
        var viewer = await _h.UserWithAsync(@"KE\anyviewer", "Task.View");

        (await viewer.GetAsync($"/api/v1/tasks/{TaskId(hidden)}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await OkAsync(await viewer.GetAsync("/api/v1/tasks"))).GetProperty("total").GetInt32().ShouldBe(1);
    }
}
