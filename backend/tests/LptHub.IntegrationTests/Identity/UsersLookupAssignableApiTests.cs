using System.Globalization;
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
/// The assignee picker lookup (DB-14, <c>assignable=true</c>): only people holding Workflow.Execute, nobody out of office (also in a Pod list and in a search), ordered by
/// load (On Hold not counted), then fewest Tasks of the type completed in the last 3 months (Completed only), then longest since last assigned, then name; and the server
/// refuses to assign a Task to somebody who cannot execute work.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class UsersLookupAssignableApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private static readonly DateTime Now = new(2026, 11, 3, 12, 0, 0, DateTimeKind.Utc);

    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private TaskHarness.World _world = null!;
    private int _otherType;
    private int _admin;
    private int _ann;
    private int _bob;
    private int _cat;
    private int _dan;
    private int _eve;
    private int _fay;
    private int _gus;
    private int _hal;
    private int _pod;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { Clock = new Audit.FixedClock(Now) };
        _h = new TaskHarness(_factory);
        _world = await _h.CreateWorldAsync();
        _otherType = await _h.CreateTaskTypeAsync("Other type", [_world.OrderedWorkflowId]);
        _admin = await _h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        var execute = await _factory.CreateRoleAsync("Doers", "Task.View", "Workflow.Execute");
        var viewOnly = await _factory.CreateRoleAsync("Viewers", "Task.View");
        _ann = await NewUserAsync(@"KE\ann", execute);
        _bob = await NewUserAsync(@"KE\bob", execute);
        _cat = await NewUserAsync(@"KE\cat", execute);
        _dan = await NewUserAsync(@"KE\dan", viewOnly); // no Workflow.Execute
        _eve = await NewUserAsync(@"KE\eve", execute); // out of office
        _fay = await NewUserAsync(@"KE\fay", execute);
        _gus = await NewUserAsync(@"KE\gus", execute);
        _hal = await NewUserAsync(@"KE\hal", execute);

        // ann: 1 open (7 days ago) and 2 completed of the type last month. bob: 1 open (2 days ago). cat: only On Hold (load 0). fay: 1 open (10 days ago) and 3 completed of the
        // type FOUR months ago (outside the window). gus: 1 open (8 days ago) and 5 completed of ANOTHER type. hal: 1 open (6 days ago) and a Cancelled one of the type.
        await SeedAsync(_ann, "NEW", 1, assignedDaysAgo: 7);
        await SeedAsync(_ann, "COMPLETED", 2, assignedDaysAgo: 30, completedDaysAgo: 20);
        await SeedAsync(_bob, "NEW", 1, assignedDaysAgo: 2);
        await SeedAsync(_cat, "ON_HOLD", 2, assignedDaysAgo: 4);
        await SeedAsync(_fay, "NEW", 1, assignedDaysAgo: 10);
        await SeedAsync(_fay, "COMPLETED", 3, assignedDaysAgo: 130, completedDaysAgo: 120);
        await SeedAsync(_gus, "NEW", 1, assignedDaysAgo: 8);
        await SeedAsync(_gus, "COMPLETED", 5, assignedDaysAgo: 30, completedDaysAgo: 20, taskType: _otherType);
        await SeedAsync(_hal, "NEW", 1, assignedDaysAgo: 6);
        await SeedAsync(_hal, "CANCELLED", 1, assignedDaysAgo: 30);
        await _h.Factory.AddAbsenceAsync(_eve, null, "2099-10-20", "Vacation");

        _pod = await _h.CreatePodAsync("Doers pod", _ann, _cat, _dan, _eve);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<int> NewUserAsync(string account, int roleId)
    {
        var id = await _h.UserIdAsync(account);
        await _factory.GrantRoleAsync(account, roleId);
        return id;
    }

    private async Task SeedAsync(int user, string status, int count, int assignedDaysAgo, int? completedDaysAgo = null, int? taskType = null)
    {
        var rows = Enumerable.Range(0, count).Select(_ => new CountsSeed.Row(_world.MatterId, null, status, null, TaskTypeId: taskType)).ToList();
        await CountsSeed.InsertTasksAsync(_h, _world, _admin, rows, Now);
        var type = taskType ?? _world.TaskTypeId;
        var at = Now.AddDays(-assignedDaysAgo).ToString("yyyy-MM-ddTHH:mm:ss.fff", CultureInfo.InvariantCulture);
        var done = completedDaysAgo is { } d ? $", CompletedAt = '{Now.AddDays(-d).ToString("yyyy-MM-ddTHH:mm:ss.fff", CultureInfo.InvariantCulture)}'" : string.Empty;
        await _h.ExecuteAsync($"UPDATE TOP ({count}) dbo.Task SET AssignedUserId = {user}, AssignedAt = '{at}'{done} WHERE AssignedUserId IS NULL AND StatusCode = '{status}' AND TaskTypeId = {type}");
    }

    private int[] Mine => [_ann, _bob, _cat, _dan, _eve, _fay, _gus, _hal];

    private int[] OnlyMine(JsonElement list) => list.EnumerateArray().Select(u => u.GetProperty("userId").GetInt32()).Where(Mine.Contains).ToArray();

    private static JsonElement Item(JsonElement list, int id) => list.EnumerateArray().Single(u => u.GetProperty("userId").GetInt32() == id);

    [Fact]
    public async Task Suggested_lists_only_people_who_can_execute_and_are_not_out_of_office_in_load_then_experience_then_last_assigned_order()
    {
        var list = await OkAsync(await _h.Admin.GetAsync($"/api/v1/users/lookup?suggest=true&assignable=true&limit=50&taskTypeId={_world.TaskTypeId}"));

        // cat: load 0 (On Hold does not count). Then load 1: the four with no experience of the type by last assigned (fay 10 days, gus 8, hal 6, bob 2), ann last (2 completed).
        // dan (no Workflow.Execute) and eve (out of office) are not there; neither is the admin's SQL-seeded company.
        OnlyMine(list).ShouldBe([_cat, _fay, _gus, _hal, _bob, _ann]);
        Item(list, _ann).GetProperty("reason").GetString().ShouldBe("1 open task, 2 completed of this type in 3 months, last assigned 7 days ago");
        Item(list, _fay).GetProperty("reason").GetString().ShouldBe("1 open task, 0 completed of this type in 3 months, last assigned 10 days ago");
        Item(list, _gus).GetProperty("reason").GetString()!.ShouldContain("0 completed of this type", Case.Sensitive, "another type does not count");
        Item(list, _hal).GetProperty("reason").GetString()!.ShouldContain("0 completed of this type", Case.Sensitive, "Cancelled does not count");
        Item(list, _cat).GetProperty("reason").GetString().ShouldBe("0 open tasks, 0 completed of this type in 3 months, last assigned 4 days ago");
        Item(list, _cat).GetProperty("load").GetInt32().ShouldBe(0);
        Item(list, _cat).GetProperty("openTaskCount").GetInt32().ShouldBe(2, "the list still shows every open task, On Hold included");
    }

    [Fact]
    public async Task Without_a_task_type_the_experience_step_is_skipped_and_the_reason_leaves_it_out()
    {
        var list = await OkAsync(await _h.Admin.GetAsync("/api/v1/users/lookup?suggest=true&assignable=true&limit=50"));

        OnlyMine(list).ShouldBe([_cat, _fay, _gus, _ann, _hal, _bob]);
        Item(list, _ann).GetProperty("reason").GetString().ShouldBe("1 open task, last assigned 7 days ago");
    }

    [Fact]
    public async Task A_pod_list_and_a_name_search_also_leave_out_people_who_cannot_execute_or_are_out_of_office()
    {
        var pod = await OkAsync(await _h.Admin.GetAsync($"/api/v1/users/lookup?podId={_pod}&assignable=true&taskTypeId={_world.TaskTypeId}"));
        OnlyMine(pod).ShouldBe([_cat, _ann]);

        // Without the flag the Pod list is unchanged: everybody, the out of office member marked.
        var everyone = await OkAsync(await _h.Admin.GetAsync($"/api/v1/users/lookup?podId={_pod}"));
        OnlyMine(everyone).Order().ShouldBe([.. new[] { _ann, _cat, _dan, _eve }.Order()]);

        OnlyMine(await OkAsync(await _h.Admin.GetAsync("/api/v1/users/lookup?q=eve&assignable=true"))).ShouldBeEmpty();
        OnlyMine(await OkAsync(await _h.Admin.GetAsync("/api/v1/users/lookup?q=dan&assignable=true"))).ShouldBeEmpty();
        OnlyMine(await OkAsync(await _h.Admin.GetAsync("/api/v1/users/lookup?q=ann&assignable=true"))).ShouldBe([_ann]);
        (await OkAsync(await _h.Admin.GetAsync("/api/v1/users/lookup?q=dan"))).EnumerateArray().Select(u => u.GetProperty("userId").GetInt32()).ShouldContain(_dan);

        // A name search is in name order and the limit applies after the people who cannot be assigned are left out.
        var search = await OkAsync(await _h.Admin.GetAsync("/api/v1/users/lookup?assignable=true&limit=50"));
        OnlyMine(search).ShouldBe([_ann, _bob, _cat, _fay, _gus, _hal]);
        var names = search.EnumerateArray().Select(u => u.GetProperty("displayName").GetString()!).ToArray();
        names.ShouldBe([.. names.Order(StringComparer.OrdinalIgnoreCase)]);
    }

    [Fact]
    public async Task The_server_refuses_to_assign_a_task_to_somebody_without_Workflow_Execute()
    {
        var task = await _h.CreateTaskAsync(_world);
        await ProblemAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/assignment", new { userId = _dan, rowVersion = RowVersion(task) }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await _h.Admin.PostAsJsonAsync("/api/v1/tasks", _h.NewTask(_world, extra: new() { ["assignedUserId"] = _dan })), HttpStatusCode.BadRequest, "VALIDATION_FAILED");

        var assigned = await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/assignment", new { userId = _ann, rowVersion = RowVersion(task) }));
        assigned.GetProperty("assignedUser").GetProperty("userId").GetInt32().ShouldBe(_ann);
    }
}
