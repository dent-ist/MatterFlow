using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Tasks;

/// <summary>A clock a test moves forward by hand.</summary>
public sealed class MutableClock(DateTime now) : IClock
{
    public DateTime UtcNow { get; set; } = now;
}

/// <summary>
/// Dashboard v4 (issue #1064, script 57): <c>Task.UnassignedAt</c> is set when a task is created without an assignee and whenever the assignee is cleared (single unassign, bulk move to a pod,
/// every path goes through <c>AssignCoreAsync</c>), cleared when a user is assigned, and untouched by a Pod-only change. A row from before the script (null column) shows its creation time.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskUnassignedAtTests(SqlServerFixture sql) : IAsyncLifetime
{
    // Friday 2026-10-09 5:55 PM in New York.
    private static readonly DateTime Start = new(2026, 10, 9, 21, 55, 0, DateTimeKind.Utc);

    private MutableClock _clock = null!;
    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private World _w = null!;
    private int _admin;
    private int _other;

    public async Task InitializeAsync()
    {
        _clock = new MutableClock(Start);
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { Clock = _clock };
        _h = new TaskHarness(_factory);
        _w = await _h.CreateWorldAsync();
        _admin = await _h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        await _h.UserWithAsync(@"KE\other", "Task.View", "Workflow.Execute");
        _other = await _h.UserIdAsync(@"KE\other");
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<JsonElement> RowAsync(long taskId)
    {
        var page = await OkAsync(await _h.Admin.GetAsync("/api/v1/task-queue?pageSize=100&sort=unassignedSince"));
        return page.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("taskId").GetInt64() == taskId);
    }

    private async Task<DateTime?> ColumnAsync(long taskId)
    {
        var value = await _factory.WithDbAsync(async db => (await db.Database.SqlQueryRaw<DateTime?>("SELECT UnassignedAt AS [Value] FROM dbo.Task WHERE TaskId = {0}", taskId).ToListAsync()).Single());
        return value is { } d ? DateTime.SpecifyKind(d, DateTimeKind.Utc) : null;
    }

    private async Task AssignAsync(long taskId, object body)
    {
        var task = await _h.GetTaskAsync(taskId);
        var fields = JsonSerializer.SerializeToElement(body).EnumerateObject().ToDictionary(p => p.Name, p => (object?)p.Value);
        fields["rowVersion"] = RowVersion(task);
        await _h.PostAsync(taskId, "assignment", fields);
    }

    [Fact]
    public async Task A_task_created_without_an_assignee_is_unassigned_since_its_creation()
    {
        var id = TaskId(await _h.CreateTaskAsync(_w));
        (await ColumnAsync(id)).ShouldBe(Start);
        var row = await RowAsync(id);
        row.GetProperty("unassignedSinceUtc").GetDateTime().ShouldBe(Start);
        row.GetProperty("createdAtUtc").GetDateTime().ShouldBe(Start);
    }

    [Fact]
    public async Task A_task_created_with_an_assignee_has_no_unassigned_time()
    {
        var id = TaskId(await _h.CreateTaskAsync(_w, extra: new() { ["assignedUserId"] = _admin }));
        (await ColumnAsync(id)).ShouldBeNull();
        var row = await RowAsync(id);
        row.GetProperty("unassignedSinceUtc").ValueKind.ShouldBe(JsonValueKind.Null);
        row.GetProperty("unassignedForMinutes").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task Unassigning_sets_the_time_assigning_clears_it_a_pod_only_change_keeps_it_and_reassigning_to_someone_else_keeps_it_clear()
    {
        var id = TaskId(await _h.CreateTaskAsync(_w));

        _clock.UtcNow = Start.AddHours(1);
        await AssignAsync(id, new { userId = _admin });
        (await ColumnAsync(id)).ShouldBeNull();
        (await RowAsync(id)).GetProperty("unassignedSinceUtc").ValueKind.ShouldBe(JsonValueKind.Null);

        _clock.UtcNow = Start.AddHours(2);
        await AssignAsync(id, new { userId = _other });
        (await ColumnAsync(id)).ShouldBeNull();

        _clock.UtcNow = Start.AddHours(3);
        await AssignAsync(id, new { });
        (await ColumnAsync(id)).ShouldBe(Start.AddHours(3));
        (await RowAsync(id)).GetProperty("unassignedSinceUtc").GetDateTime().ShouldBe(Start.AddHours(3));

        // A Pod-only change leaves it unassigned and keeps the original time.
        var pod = await _h.CreatePodAsync("Unassigned pod", _admin);
        _clock.UtcNow = Start.AddHours(4);
        await AssignAsync(id, new { podId = pod });
        (await ColumnAsync(id)).ShouldBe(Start.AddHours(3));

        // Assign again and unassign again: the clock restarts.
        _clock.UtcNow = Start.AddHours(5);
        await AssignAsync(id, new { podId = pod, userId = _admin });
        (await ColumnAsync(id)).ShouldBeNull();
        _clock.UtcNow = Start.AddHours(6);
        await AssignAsync(id, new { podId = pod });
        (await ColumnAsync(id)).ShouldBe(Start.AddHours(6));
    }

    [Fact]
    public async Task The_bulk_move_to_a_pod_clears_the_person_and_starts_the_unassigned_time()
    {
        var id = TaskId(await _h.CreateTaskAsync(_w, extra: new() { ["assignedUserId"] = _admin }));
        var pod = await _h.CreatePodAsync("Bulk pod", _admin);
        (await ColumnAsync(id)).ShouldBeNull();

        _clock.UtcNow = Start.AddHours(2);
        var body = await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/matters/{_w.MatterId}/tasks/bulk", new { taskIds = new[] { id }, reassignTo = new { podId = pod } }));
        body.GetProperty("changed").GetInt32().ShouldBe(1);
        (await ColumnAsync(id)).ShouldBe(Start.AddHours(2));
    }

    [Fact]
    public async Task A_row_from_before_the_script_shows_its_creation_time()
    {
        var id = TaskId(await _h.CreateTaskAsync(_w));
        _clock.UtcNow = Start.AddDays(3);
        await _h.ExecuteAsync($"UPDATE dbo.Task SET UnassignedAt = NULL WHERE TaskId = {id}");
        var row = await RowAsync(id);
        row.GetProperty("unassignedSinceUtc").GetDateTime().ShouldBe(Start);
    }

    [Fact]
    public async Task The_age_is_in_working_minutes_and_the_unassigned_since_sort_lists_the_longest_waiting_first()
    {
        var first = TaskId(await _h.CreateTaskAsync(_w)); // Friday 5:55 PM
        _clock.UtcNow = Start.AddDays(1);
        var second = TaskId(await _h.CreateTaskAsync(_w)); // Saturday 5:55 PM
        var assigned = TaskId(await _h.CreateTaskAsync(_w, extra: new() { ["assignedUserId"] = _admin }));

        // Monday 8:05 AM New York: the Friday 5:55 PM task has 5 minutes on Friday plus 5 on Monday, the Saturday one only the 5 on Monday.
        _clock.UtcNow = new DateTime(2026, 10, 12, 12, 5, 0, DateTimeKind.Utc);
        var page = await OkAsync(await _h.Admin.GetAsync("/api/v1/task-queue?pageSize=100&sort=unassignedSince"));
        var ids = page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("taskId").GetInt64()).ToList();
        ids.ShouldBe([first, second, assigned]);
        var items = page.GetProperty("items").EnumerateArray().ToList();
        items[0].GetProperty("unassignedForMinutes").GetInt32().ShouldBe(10);
        items[1].GetProperty("unassignedForMinutes").GetInt32().ShouldBe(5);
        items[2].GetProperty("unassignedForMinutes").ValueKind.ShouldBe(JsonValueKind.Null);
    }
}
