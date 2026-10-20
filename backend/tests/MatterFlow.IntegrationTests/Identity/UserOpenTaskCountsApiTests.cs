using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Organization;
using MatterFlow.IntegrationTests.Tasks;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Identity;

/// <summary>
/// <c>openTaskCount</c> on the user list and the user detail (#426): the New, In Progress and On Hold Tasks assigned to the person (the Task Queue
/// definition, the same as the Task Type and workflow version counts), one grouped statement for the page, and null (never 0) for a caller without
/// <c>Task.View</c>. Existing fields and permissions are unchanged.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class UserOpenTaskCountsApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private static readonly DateTime Now = new(2026, 10, 14, 16, 0, 0, DateTimeKind.Utc);

    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private int _mixed;
    private int _none;
    private int _closedOnly;
    private int _one;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { Clock = new Audit.FixedClock(Now) };
        _h = new TaskHarness(_factory);
        var world = await _h.CreateWorldAsync();
        var admin = await _h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        await _h.UserWithAsync(@"KE\mixed", "Task.View");
        await _h.UserWithAsync(@"KE\none", "Task.View");
        await _h.UserWithAsync(@"KE\closedonly", "Task.View");
        await _h.UserWithAsync(@"KE\one", "Task.View");
        _mixed = await _h.UserIdAsync(@"KE\mixed");
        _none = await _h.UserIdAsync(@"KE\none");
        _closedOnly = await _h.UserIdAsync(@"KE\closedonly");
        _one = await _h.UserIdAsync(@"KE\one");

        var day = new DateOnly(2026, 10, 14);
        var rows = new List<CountsSeed.Row>();
        void Add(string status, int count)
        {
            for (var i = 0; i < count; i++)
                rows.Add(new CountsSeed.Row(world.MatterId, null, status, day.AddDays(i)));
        }

        Add("NEW", 3);
        Add("IN_PROGRESS", 1);
        Add("ON_HOLD", 1);
        Add("COMPLETED", 3);
        Add("CANCELLED", 1);
        Add("NEW", 2); // stays unassigned: nobody's count
        await CountsSeed.InsertTasksAsync(_h, world, admin, rows, Now);

        async Task Assign(int user, string status, int count) =>
            await _h.ExecuteAsync($"UPDATE TOP ({count}) dbo.Task SET AssignedUserId = {user} WHERE AssignedUserId IS NULL AND StatusCode = '{status}'");

        // mixed: 2 New + 1 In Progress + 1 On Hold = 4 open, plus 2 Completed and 1 Cancelled that do not count.
        await Assign(_mixed, "NEW", 2);
        await Assign(_mixed, "IN_PROGRESS", 1);
        await Assign(_mixed, "ON_HOLD", 1);
        await Assign(_mixed, "COMPLETED", 2);
        await Assign(_mixed, "CANCELLED", 1);
        await Assign(_closedOnly, "COMPLETED", 1);
        await Assign(_one, "NEW", 1);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static int? Count(JsonElement user) =>
        user.TryGetProperty("openTaskCount", out var c) && c.ValueKind != JsonValueKind.Null ? c.GetInt32() : null;

    private async Task<JsonElement> ListAsync(HttpClient? client = null) =>
        await OkAsync(await (client ?? _h.Admin).GetAsync("/api/v1/users?status=all&pageSize=100"));

    private static JsonElement Item(JsonElement list, int userId) =>
        list.GetProperty("items").EnumerateArray().Single(u => u.GetProperty("userId").GetInt32() == userId);

    [Fact]
    public async Task The_list_and_the_detail_count_open_tasks_by_status_and_zero_is_zero()
    {
        var list = await ListAsync();
        Count(Item(list, _mixed)).ShouldBe(4, "New, In Progress and On Hold count; Completed and Cancelled do not");
        Count(Item(list, _none)).ShouldBe(0, "a person without tasks is 0, not null");
        Count(Item(list, _closedOnly)).ShouldBe(0, "only closed tasks is 0");
        Count(Item(list, _one)).ShouldBe(1);

        foreach (var id in new[] { _mixed, _none, _closedOnly, _one })
            Count(await OkAsync(await _h.Admin.GetAsync($"/api/v1/users/{id}"))).ShouldBe(Count(Item(list, id)), "the detail says the same as the list");

        // The Task Queue total behind "View their tasks" is the same number.
        var queue = await OkAsync(await _h.Admin.GetAsync($"/api/v1/task-queue?pageSize=1&status=NEW&status=IN_PROGRESS&status=ON_HOLD&assignee={_mixed}"));
        queue.GetProperty("total").GetInt32().ShouldBe(4);
    }

    [Fact]
    public async Task The_count_follows_a_status_change_and_a_reassignment()
    {
        await _h.ExecuteAsync($"UPDATE dbo.Task SET StatusCode = 'COMPLETED', CompletedAt = SYSUTCDATETIME() WHERE AssignedUserId = {_one}");
        Count(await OkAsync(await _h.Admin.GetAsync($"/api/v1/users/{_one}"))).ShouldBe(0);
        await _h.ExecuteAsync($"UPDATE dbo.Task SET StatusCode = 'ON_HOLD', CompletedAt = NULL WHERE AssignedUserId = {_one}");
        Count(await OkAsync(await _h.Admin.GetAsync($"/api/v1/users/{_one}"))).ShouldBe(1);
        await _h.ExecuteAsync($"UPDATE dbo.Task SET AssignedUserId = {_none} WHERE AssignedUserId = {_one}");
        Count(await OkAsync(await _h.Admin.GetAsync($"/api/v1/users/{_one}"))).ShouldBe(0);
        Count(await OkAsync(await _h.Admin.GetAsync($"/api/v1/users/{_none}"))).ShouldBe(1);
    }

    [Fact]
    public async Task A_caller_without_Task_View_gets_no_number_and_existing_permissions_are_unchanged()
    {
        var viewOnly = await _h.UserWithAsync(@"KE\viewonly", "User.View");
        var list = await ListAsync(viewOnly);
        Count(Item(list, _mixed)).ShouldBeNull("User.View without Task.View: the number is left out, never shown as 0");
        Count(await OkAsync(await viewOnly.GetAsync($"/api/v1/users/{_mixed}"))).ShouldBeNull();
        Item(list, _mixed).GetProperty("displayName").GetString().ShouldNotBeNullOrEmpty(); // the rest of the row is unchanged

        var viewAndTasks = await _h.UserWithAsync(@"KE\viewtasks", "User.View", "Task.View");
        Count(Item(await ListAsync(viewAndTasks), _mixed)).ShouldBe(4);
        Count(await OkAsync(await viewAndTasks.GetAsync($"/api/v1/users/{_mixed}"))).ShouldBe(4);

        // The endpoints keep their permission: Task.View alone cannot read the users list.
        var tasksOnly = await _h.UserWithAsync(@"KE\tasksonly", "Task.View");
        (await tasksOnly.GetAsync("/api/v1/users")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await tasksOnly.GetAsync($"/api/v1/users/{_mixed}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Saving_a_user_returns_the_count_in_the_reply_too()
    {
        var detail = await OkAsync(await _h.Admin.GetAsync($"/api/v1/users/{_mixed}"));
        var reply = await OkAsync(await _h.Admin.PutAsJsonAsync($"/api/v1/users/{_mixed}", new
        {
            displayName = "Mixed Renamed",
            email = (string?)null,
            rowVersion = detail.GetProperty("rowVersion").GetString(),
        }));
        Count(reply).ShouldBe(4);
    }
}
