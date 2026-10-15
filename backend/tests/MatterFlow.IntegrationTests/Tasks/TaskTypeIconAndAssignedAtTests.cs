using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Tasks;

/// <summary>
/// The Task Type icon on every read that shows a Task (detail, list, task queue, dashboard breakdown) and the queue row's <c>assignedAtUtc</c>
/// (when the current assignee was assigned; My Work's "New" marker).
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskTypeIconAndAssignedAtTests(SqlServerFixture sql) : IAsyncLifetime
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

    private async Task<JsonElement> QueueRowAsync(long taskId)
    {
        var page = await OkAsync(await _h.Admin.GetAsync("/api/v1/task-queue?pageSize=100"));
        return page.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("taskId").GetInt64() == taskId);
    }

    [Fact]
    public async Task The_task_type_icon_follows_the_type_on_the_detail_the_list_the_queue_and_the_dashboard()
    {
        var task = await _h.CreateTaskAsync(_w);
        task.GetProperty("taskType").GetProperty("iconKey").GetString().ShouldBe("file-text");
        (await QueueRowAsync(TaskId(task))).GetProperty("taskTypeIconKey").GetString().ShouldBe("file-text");

        var type = await OkAsync(await _h.Admin.GetAsync($"/api/v1/task-types/{_w.TaskTypeId}"));
        var update = await _h.Admin.PutAsJsonAsync($"/api/v1/task-types/{_w.TaskTypeId}", new
        {
            name = type.GetProperty("name").GetString(),
            iconKey = "cpu-2",
            isActive = true,
            eligibleWorkflowIds = type.GetProperty("eligibleWorkflowIds").EnumerateArray().Select(e => e.GetInt32()).ToArray(),
            defaultWorkflowDefinitionId = type.GetProperty("defaultWorkflowDefinitionId").GetInt32(),
            rowVersion = type.GetProperty("rowVersion").GetString(),
        });
        await OkAsync(update);

        (await _h.GetTaskAsync(TaskId(task))).GetProperty("taskType").GetProperty("iconKey").GetString().ShouldBe("cpu-2");
        (await QueueRowAsync(TaskId(task))).GetProperty("taskTypeIconKey").GetString().ShouldBe("cpu-2");

        var list = await OkAsync(await _h.Admin.GetAsync("/api/v1/tasks?pageSize=50"));
        list.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("taskId").GetInt64() == TaskId(task))
            .GetProperty("taskTypeIconKey").GetString().ShouldBe("cpu-2");

        var dashboard = await OkAsync(await _h.Admin.GetAsync("/api/v1/dashboard"));
        dashboard.GetProperty("byTaskType").EnumerateArray().Single(i => i.GetProperty("label").GetString() == "Data Processing")
            .GetProperty("iconKey").GetString().ShouldBe("cpu-2");
    }

    [Fact]
    public async Task Assigned_at_is_set_when_a_user_is_assigned_kept_by_pod_only_changes_and_cleared_on_unassign()
    {
        var created = await _h.CreateTaskAsync(_w);
        (await QueueRowAsync(TaskId(created))).GetProperty("assignedAtUtc").ValueKind.ShouldBe(JsonValueKind.Null);

        var userId = await _h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        var before = DateTime.UtcNow.AddSeconds(-5);
        var assigned = await _h.PostAsync(TaskId(created), "assignment", new { userId, rowVersion = RowVersion(created) });
        var row = await QueueRowAsync(TaskId(created));
        var assignedAt = row.GetProperty("assignedAtUtc").GetDateTime();
        assignedAt.ShouldBeGreaterThan(before);
        assignedAt.ShouldBeLessThan(DateTime.UtcNow.AddSeconds(5));

        // Created long before the assignment: the marker date is the assignment, not the creation.
        row.GetProperty("createdAtUtc").GetDateTime().ShouldBeLessThanOrEqualTo(assignedAt);

        var podId = await _h.CreatePodAsync("Pod for assigned-at", userId);
        var task = await _h.GetTaskAsync(TaskId(created));
        await _h.PostAsync(TaskId(created), "assignment", new { podId, userId, rowVersion = RowVersion(task) });
        (await QueueRowAsync(TaskId(created))).GetProperty("assignedAtUtc").GetDateTime().ShouldBe(assignedAt);

        task = await _h.GetTaskAsync(TaskId(created));
        await _h.PostAsync(TaskId(created), "assignment", new { podId, rowVersion = RowVersion(task) });
        (await QueueRowAsync(TaskId(created))).GetProperty("assignedAtUtc").ValueKind.ShouldBe(JsonValueKind.Null);
        assigned.ValueKind.ShouldNotBe(JsonValueKind.Undefined);
    }

    [Fact]
    public async Task A_task_created_with_its_assignee_has_assigned_at_from_the_start()
    {
        var userId = await _h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        var created = await _h.CreateTaskAsync(_w, extra: new() { ["assignedUserId"] = userId });
        (await QueueRowAsync(TaskId(created))).GetProperty("assignedAtUtc").ValueKind.ShouldBe(JsonValueKind.String);
    }
}
