using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.Configuration.Application.TaskTypes;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Organization;
using MatterFlow.IntegrationTests.Tasks;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Configuration;

/// <summary>
/// <c>openTaskCount</c> on the Task Type list, Get, create and update responses (#372): the number of New, In Progress and On Hold Tasks of the type
/// (the Task Queue definition), over every Matter, Project and pod; equal to the total behind the Task Queue link; null (not 0) without Task.View;
/// sortable; the same number of statements for any number of types; permissions unchanged.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskTypeOpenCountsApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private static readonly DateTime Now = new(2026, 10, 14, 16, 0, 0, DateTimeKind.Utc);
    private const string OpenStatuses = "status=NEW&status=IN_PROGRESS&status=ON_HOLD";

    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private TaskHarness.World _world = null!;
    private readonly Dictionary<string, int> _types = [];
    private int _expectedOpenOfMain;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { Clock = new Audit.FixedClock(Now) };
        _h = new TaskHarness(_factory);
        _world = await _h.CreateWorldAsync();
        var admin = await _h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        _types["main"] = _world.TaskTypeId;
        _types["small"] = await _h.CreateTaskTypeAsync("Small type", [_world.OrderedWorkflowId], withForm: false);
        _types["closed"] = await _h.CreateTaskTypeAsync("Closed only type", [_world.OrderedWorkflowId], withForm: false);
        _types["empty"] = await _h.CreateTaskTypeAsync("Empty type", [_world.UnorderedWorkflowId], withForm: false);
        _types["zinactive"] = await _h.CreateTaskTypeAsync("Zinactive type", [_world.OrderedWorkflowId], withForm: false);

        var otherMatter = await _h.CreateMatterAsync("500", "7");
        var pod = await _h.CreatePodAsync("Review pod", admin);
        var day = new DateOnly(2026, 10, 14);

        // main: 3 New + 2 In Progress + 1 On Hold = 6 open, plus 4 Completed and 2 Cancelled that are not counted.
        var rows = new List<CountsSeed.Row>();
        void Add(int type, int matter, int? project, string status, int count)
        {
            for (var i = 0; i < count; i++)
                rows.Add(new CountsSeed.Row(matter, project, status, day.AddDays(i - 2), TaskTypeId: type));
        }

        Add(_types["main"], _world.MatterId, null, "NEW", 2);
        Add(_types["main"], otherMatter, null, "NEW", 1);
        Add(_types["main"], _world.MatterId, _world.ProjectId, "IN_PROGRESS", 2);
        Add(_types["main"], otherMatter, null, "ON_HOLD", 1);
        Add(_types["main"], _world.MatterId, null, "COMPLETED", 4);
        Add(_types["main"], otherMatter, null, "CANCELLED", 2);
        _expectedOpenOfMain = 6;
        Add(_types["small"], _world.MatterId, null, "NEW", 1);
        Add(_types["closed"], _world.MatterId, null, "COMPLETED", 3);
        Add(_types["closed"], _world.MatterId, null, "CANCELLED", 1);
        Add(_types["zinactive"], otherMatter, null, "IN_PROGRESS", 5);
        await CountsSeed.InsertTasksAsync(_h, _world, admin, rows, Now);

        // Some Tasks sit in a pod, an inactive Matter and an archived Project: they still count (configuration data, not trimmed).
        await _h.ExecuteAsync($"UPDATE TOP (3) dbo.Task SET AssignedPodId = {pod} WHERE TaskTypeId = {_types["main"]} AND StatusCode IN ('NEW', 'IN_PROGRESS')");
        await _h.SetProjectActiveAsync(_world.ProjectId, false);
        await _h.ExecuteAsync($"UPDATE dbo.Matter SET IsActive = 0 WHERE MatterId = {otherMatter}");

        // The inactive type keeps its Tasks and its count.
        await DeactivateAsync(_types["zinactive"]);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task DeactivateAsync(int id)
    {
        var type = await OkAsync(await _h.Admin.GetAsync($"/api/v1/task-types/{id}"));
        await OkAsync(await _h.Admin.PutAsJsonAsync($"/api/v1/task-types/{id}", Update(type, isActive: false)));
    }

    private static object Update(JsonElement type, bool? isActive = null, string? name = null) => new
    {
        name = name ?? type.GetProperty("name").GetString(),
        description = (string?)null,
        isActive = isActive ?? type.GetProperty("isActive").GetBoolean(),
        eligibleWorkflowIds = type.GetProperty("eligibleWorkflowIds").EnumerateArray().Select(e => e.GetInt32()).ToArray(),
        defaultWorkflowDefinitionId = type.GetProperty("defaultWorkflowDefinitionId").ValueKind == JsonValueKind.Null ? (int?)null : type.GetProperty("defaultWorkflowDefinitionId").GetInt32(),
        rowVersion = type.GetProperty("rowVersion").GetString(),
        iconKey = type.GetProperty("iconKey").GetString(),
    };

    private static int? Count(JsonElement type) => type.GetProperty("openTaskCount").ValueKind == JsonValueKind.Null ? null : type.GetProperty("openTaskCount").GetInt32();

    private static JsonElement ByName(JsonElement list, string name) => list.EnumerateArray().Single(t => t.GetProperty("name").GetString() == name);

    private async Task<JsonElement> ListAsync(string query = "", HttpClient? client = null) => await OkAsync(await (client ?? _h.Admin).GetAsync("/api/v1/task-types" + query));

    private async Task<int> QueueTotalAsync(int typeId) =>
        (await OkAsync(await _h.Admin.GetAsync($"/api/v1/task-queue?pageSize=1&{OpenStatuses}&type={typeId}"))).GetProperty("total").GetInt32();

    [Fact]
    public async Task The_list_and_the_detail_count_the_open_tasks_of_each_type_with_each_status_and_equal_the_task_queue()
    {
        var list = await ListAsync();
        Count(ByName(list, "Data Processing")).ShouldBe(_expectedOpenOfMain);
        Count(ByName(list, "Small type")).ShouldBe(1);
        Count(ByName(list, "Closed only type")).ShouldBe(0, "completed and cancelled Tasks are not open");
        Count(ByName(list, "Empty type")).ShouldBe(0, "a type without Tasks is 0, not null");
        Count(ByName(list, "Zinactive type")).ShouldBe(5, "deactivating a type keeps its Tasks and the count");

        foreach (var item in list.EnumerateArray())
        {
            var id = item.GetProperty("id").GetInt32();
            Count(item).ShouldBe(await QueueTotalAsync(id), $"{item.GetProperty("name").GetString()}: the number equals the total behind the Task Queue link");
            Count(await OkAsync(await _h.Admin.GetAsync($"/api/v1/task-types/{id}"))).ShouldBe(Count(item), "the detail says the same as the list");
        }

        // The filtered list carries the counts too.
        var filtered = await ListAsync($"?workflowId={_world.UnorderedWorkflowId}");
        Count(ByName(filtered, "Data Processing")).ShouldBe(_expectedOpenOfMain);
        Count(ByName(filtered, "Empty type")).ShouldBe(0);
    }

    [Fact]
    public async Task The_count_moves_with_a_task_status_and_ignores_pods_matter_state_and_the_viewer()
    {
        var before = Count(ByName(await ListAsync(), "Small type"));
        before.ShouldBe(1);
        await _h.ExecuteAsync($"UPDATE dbo.Task SET StatusCode = 'COMPLETED', CompletedAt = SYSUTCDATETIME() WHERE TaskTypeId = {_types["small"]}");
        Count(ByName(await ListAsync(), "Small type")).ShouldBe(0);
        await _h.ExecuteAsync($"UPDATE dbo.Task SET StatusCode = 'ON_HOLD', CompletedAt = NULL WHERE TaskTypeId = {_types["small"]}");
        Count(ByName(await ListAsync(), "Small type")).ShouldBe(1);

        // A person outside every pod sees the same numbers as the administrator.
        var outsider = await _h.UserWithAsync(@"KE\outsider", "Task.View");
        var seen = await ListAsync(client: outsider);
        Count(ByName(seen, "Data Processing")).ShouldBe(_expectedOpenOfMain);
        Count(ByName(seen, "Zinactive type")).ShouldBe(5);
    }

    [Fact]
    public async Task Create_and_update_replies_carry_the_count()
    {
        var created = await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/task-types", new { name = "Fresh type", eligibleWorkflowIds = new[] { _world.OrderedWorkflowId }, defaultWorkflowDefinitionId = _world.OrderedWorkflowId }), HttpStatusCode.Created);
        Count(created).ShouldBe(0);
        var main = await OkAsync(await _h.Admin.GetAsync($"/api/v1/task-types/{_types["main"]}"));
        var updated = await OkAsync(await _h.Admin.PutAsJsonAsync($"/api/v1/task-types/{_types["main"]}", Update(main, name: "Data Processing renamed")));
        Count(updated).ShouldBe(_expectedOpenOfMain);
    }

    [Fact]
    public async Task The_list_sorts_by_the_open_count_in_both_directions_and_by_name_with_ties_in_name_order()
    {
        // Counts: Zinactive 5... main 6, Zinactive 5, Small 1, Closed 0, Empty 0.
        string[] Names(JsonElement l) => [.. l.EnumerateArray().Select(t => t.GetProperty("name").GetString()!)];
        Names(await ListAsync("?sort=-openTaskCount")).ShouldBe(["Data Processing", "Zinactive type", "Small type", "Closed only type", "Empty type"]);
        Names(await ListAsync("?sort=openTaskCount")).ShouldBe(["Closed only type", "Empty type", "Small type", "Zinactive type", "Data Processing"]);
        Names(await ListAsync()).ShouldBe(["Closed only type", "Data Processing", "Empty type", "Small type", "Zinactive type"]);
        Names(await ListAsync("?sort=name")).ShouldBe(["Closed only type", "Data Processing", "Empty type", "Small type", "Zinactive type"]);
        Names(await ListAsync("?sort=-name")).ShouldBe(["Zinactive type", "Small type", "Empty type", "Data Processing", "Closed only type"]);
        Names(await ListAsync($"?sort=-openTaskCount&workflowId={_world.OrderedWorkflowId}")).ShouldBe(["Data Processing", "Zinactive type", "Small type", "Closed only type"]);

        await ProblemAsync(await _h.Admin.GetAsync("/api/v1/task-types?sort=bogus"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task Permissions_are_unchanged_and_the_service_returns_null_counts_without_Task_View()
    {
        var typeAdmin = await _h.UserWithAsync(@"KE\ttonly", "TaskType.Manage", "Task.View");
        Count(ByName(await ListAsync(client: typeAdmin), "Data Processing")).ShouldBe(_expectedOpenOfMain);

        // Task.View only: the lookup stays readable with its numbers, changes stay 403.
        var viewer = await _h.UserWithAsync(@"KE\viewer", "Task.View");
        Count(ByName(await ListAsync(client: viewer), "Data Processing")).ShouldBe(_expectedOpenOfMain);
        var main = await OkAsync(await _h.Admin.GetAsync($"/api/v1/task-types/{_types["main"]}"));
        (await viewer.PutAsJsonAsync($"/api/v1/task-types/{_types["main"]}", Update(main))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await viewer.PostAsJsonAsync("/api/v1/task-types", new { name = "Nope" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        // Without Task.View the endpoint itself is 403 (unchanged) ...
        var workflowOnly = await _h.UserWithAsync(@"KE\wfonly", "Workflow.Manage");
        (await workflowOnly.GetAsync("/api/v1/task-types")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await workflowOnly.GetAsync($"/api/v1/task-types/{_types["main"]}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        // ... and a service call on behalf of someone who may not see Tasks (a seeder, a job) gets null, never a made-up 0.
        using var denied = _factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
            services.Replace(ServiceDescriptor.Scoped<IPermissionChecker>(_ => new NoPermissions()))));
        using var scope = denied.Services.CreateScope();
        var service = scope.ServiceProvider.GetRequiredService<TaskTypeService>();
        var views = await service.ListViewsAsync(null, CancellationToken.None);
        views.Count.ShouldBe(5);
        views.ShouldAllBe(v => v.OpenTaskCount == null);
        (await service.GetViewAsync(_types["main"])).Value.OpenTaskCount.ShouldBeNull();
        (await service.ListViewsAsync(null, "-openTaskCount")).Value.Select(v => v.Name).ShouldBe(["Closed only type", "Data Processing", "Empty type", "Small type", "Zinactive type"], "a count sort falls back to the name order");
    }

    private sealed class NoPermissions : IPermissionChecker
    {
        public bool Has(string permissionCode) => false;

        public Result Require(string permissionCode) => Result.Failure(Error.Forbidden(permissionCode));
    }
}
