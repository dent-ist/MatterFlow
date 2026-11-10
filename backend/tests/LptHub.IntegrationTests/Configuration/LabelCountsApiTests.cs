using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.Configuration.Application.Lookups;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Organization;
using MatterFlow.IntegrationTests.Tasks;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Configuration;

/// <summary>
/// <c>openTaskCount</c> on the priorities and <c>taskCount</c> on the status labels (#599): open = New, In Progress, On Hold (the Task Queue
/// definition) for a priority, every Task of the status for a status label; over every Matter, Project and pod; equal to the total behind the Task
/// Queue link (<c>priority=&lt;id&gt;</c> with the open statuses, <c>status=&lt;code&gt;</c>); null (not 0) without Task.View; the same number of
/// statements for 4 and 80 priorities; reads and writes keep their permissions.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class LabelCountsApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private static readonly DateTime Now = new(2026, 10, 14, 16, 0, 0, DateTimeKind.Utc);
    private const string OpenStatuses = "status=NEW&status=IN_PROGRESS&status=ON_HOLD";

    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private TaskHarness.World _world = null!;
    private int _admin;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { Clock = new Audit.FixedClock(Now) };
        _h = new TaskHarness(_factory);
        _world = await _h.CreateWorldAsync();
        _admin = await _h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        var otherMatter = await _h.CreateMatterAsync("500", "7");
        var day = new DateOnly(2026, 10, 14);

        // 3 New + 2 In Progress + 1 On Hold open, 4 Completed + 2 Cancelled closed: 12 Tasks, all seeded on the least urgent priority.
        var rows = new List<CountsSeed.Row>();
        void Add(int matter, int? project, string status, int count)
        {
            for (var i = 0; i < count; i++)
                rows.Add(new CountsSeed.Row(matter, project, status, day.AddDays(i - 2)));
        }

        Add(_world.MatterId, null, "NEW", 2);
        Add(otherMatter, null, "NEW", 1);
        Add(_world.MatterId, _world.ProjectId, "IN_PROGRESS", 2);
        Add(otherMatter, null, "ON_HOLD", 1);
        Add(_world.MatterId, null, "COMPLETED", 4);
        Add(otherMatter, null, "CANCELLED", 2);
        await CountsSeed.InsertTasksAsync(_h, _world, _admin, rows, Now);
        // Spread over the priorities: the first four Tasks (open) on High, the next two (open) on Critical, a closed one on Critical, the rest stay on Low.
        await _h.ExecuteAsync("""
            ;WITH t AS (SELECT TaskId, ROW_NUMBER() OVER (ORDER BY TaskId) rn FROM dbo.Task)
            UPDATE k SET PriorityId = (SELECT PriorityId FROM dbo.Priority WHERE Label = CASE WHEN t.rn <= 4 THEN 'High' WHEN t.rn <= 6 OR t.rn = 12 THEN 'Critical' ELSE 'Low' END)
            FROM dbo.Task k JOIN t ON t.TaskId = k.TaskId;
            """);
        await _h.ExecuteAsync($"UPDATE TOP (1) dbo.Task SET AssignedPodId = {await _h.CreatePodAsync("Count pod", _admin)} WHERE StatusCode = 'NEW'");
        await _h.SetProjectActiveAsync(_world.ProjectId, false);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static int? Count(JsonElement item, string name) => item.GetProperty(name).ValueKind == JsonValueKind.Null ? null : item.GetProperty(name).GetInt32();

    private static JsonElement ByLabel(JsonElement list, string label) => list.EnumerateArray().Single(p => p.GetProperty("label").GetString() == label);

    private async Task<int> QueueTotalAsync(string query) =>
        (await OkAsync(await _h.Admin.GetAsync($"/api/v1/task-queue?pageSize=1&{query}"))).GetProperty("total").GetInt32();

    [Fact]
    public async Task Priorities_carry_the_open_count_and_equal_the_task_queue()
    {
        var list = await OkAsync(await _h.Admin.GetAsync("/api/v1/priorities"));
        foreach (var priority in list.EnumerateArray())
        {
            var id = priority.GetProperty("id").GetInt32();
            Count(priority, "openTaskCount").ShouldBe(await QueueTotalAsync($"{OpenStatuses}&priority={id}"), priority.GetProperty("label").GetString());
        }

        Count(ByLabel(list, "High"), "openTaskCount").ShouldBe(4);
        Count(ByLabel(list, "Critical"), "openTaskCount").ShouldBe(2, "a closed Task on the priority is not open");
        Count(ByLabel(list, "Normal"), "openTaskCount").ShouldBe(0, "a priority without Tasks is 0, not null");
        list.EnumerateArray().Sum(p => Count(p, "openTaskCount")!.Value).ShouldBe(6, "every open Task is on exactly one priority");
    }

    [Fact]
    public async Task Status_labels_carry_the_task_count_of_each_status_and_equal_the_task_queue()
    {
        var list = await OkAsync(await _h.Admin.GetAsync("/api/v1/status-labels"));
        var expected = new Dictionary<string, int> { ["NEW"] = 3, ["IN_PROGRESS"] = 2, ["ON_HOLD"] = 1, ["COMPLETED"] = 4, ["CANCELLED"] = 2 };
        list.GetArrayLength().ShouldBe(expected.Count);
        foreach (var label in list.EnumerateArray())
        {
            var code = label.GetProperty("code").GetString()!;
            Count(label, "taskCount").ShouldBe(expected[code], code);
            Count(label, "taskCount").ShouldBe(await QueueTotalAsync($"status={code}"), $"{code}: equals the Task Queue total");
        }
    }

    [Fact]
    public async Task Create_update_default_and_reorder_replies_carry_the_count()
    {
        var created = await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/priorities", new { label = "Fresh", color = "low" }), HttpStatusCode.Created);
        Count(created, "openTaskCount").ShouldBe(0);

        var list = await OkAsync(await _h.Admin.GetAsync("/api/v1/priorities"));
        var high = ByLabel(list, "High");
        var updated = await OkAsync(await _h.Admin.PutAsJsonAsync($"/api/v1/priorities/{high.GetProperty("id").GetInt32()}", new
        {
            label = "High renamed",
            color = high.GetProperty("color").GetString(),
            isActive = true,
            rowVersion = high.GetProperty("rowVersion").GetString(),
        }));
        Count(updated, "openTaskCount").ShouldBe(4);

        var made = await OkAsync(await _h.Admin.PostAsync($"/api/v1/priorities/{high.GetProperty("id").GetInt32()}/default", null));
        Count(ByLabel(made, "High renamed"), "openTaskCount").ShouldBe(4);
        var ids = made.EnumerateArray().Select(p => p.GetProperty("id").GetInt32()).Reverse().ToArray();
        var reordered = await OkAsync(await _h.Admin.PutAsJsonAsync("/api/v1/priorities/order", new { ids }));
        Count(ByLabel(reordered, "Critical"), "openTaskCount").ShouldBe(2);

        var statuses = await OkAsync(await _h.Admin.GetAsync("/api/v1/status-labels"));
        var hold = statuses.EnumerateArray().Single(s => s.GetProperty("code").GetString() == "ON_HOLD");
        var renamed = await OkAsync(await _h.Admin.PutAsJsonAsync("/api/v1/status-labels/ON_HOLD", new { displayLabel = "Waiting", rowVersion = hold.GetProperty("rowVersion").GetString() }));
        Count(renamed, "taskCount").ShouldBe(1);
    }

    [Fact]
    public async Task The_counts_follow_a_task_and_ignore_pods_matter_state_and_the_viewer()
    {
        await _h.ExecuteAsync("UPDATE dbo.Task SET StatusCode = 'COMPLETED', CompletedAt = SYSUTCDATETIME() WHERE StatusCode = 'ON_HOLD'");
        var list = await OkAsync(await _h.Admin.GetAsync("/api/v1/priorities"));
        list.EnumerateArray().Sum(p => Count(p, "openTaskCount")!.Value).ShouldBe(5);
        var statuses = await OkAsync(await _h.Admin.GetAsync("/api/v1/status-labels"));
        Count(statuses.EnumerateArray().Single(s => s.GetProperty("code").GetString() == "ON_HOLD"), "taskCount").ShouldBe(0);
        Count(statuses.EnumerateArray().Single(s => s.GetProperty("code").GetString() == "COMPLETED"), "taskCount").ShouldBe(5);

        // A person outside every pod sees the same numbers as the administrator.
        var outsider = await _h.UserWithAsync(@"KE\outsider", "Task.View");
        var seen = await OkAsync(await outsider.GetAsync("/api/v1/priorities"));
        Count(ByLabel(seen, "High"), "openTaskCount").ShouldBe(4);
    }

    [Fact]
    public async Task Without_Task_View_the_counts_are_null_and_the_permissions_are_unchanged()
    {
        // Priority.Manage / StatusLabel.Manage read what they manage (#519) but may not see Tasks: null, never a made-up 0.
        var priorityAdmin = await _h.UserWithAsync(@"KE\prioonly", "Priority.Manage");
        var priorities = await OkAsync(await priorityAdmin.GetAsync("/api/v1/priorities"));
        priorities.EnumerateArray().ShouldAllBe(p => p.GetProperty("openTaskCount").ValueKind == JsonValueKind.Null);
        var created = await OkAsync(await priorityAdmin.PostAsJsonAsync("/api/v1/priorities", new { label = "Later", color = "low" }), HttpStatusCode.Created);
        created.GetProperty("openTaskCount").ValueKind.ShouldBe(JsonValueKind.Null);

        var statusAdmin = await _h.UserWithAsync(@"KE\statusonly", "StatusLabel.Manage");
        var statuses = await OkAsync(await statusAdmin.GetAsync("/api/v1/status-labels"));
        statuses.EnumerateArray().ShouldAllBe(s => s.GetProperty("taskCount").ValueKind == JsonValueKind.Null);

        // Task.View alone reads with the numbers, and still cannot change anything; a person with neither is refused.
        var viewer = await _h.UserWithAsync(@"KE\viewer", "Task.View");
        Count(ByLabel(await OkAsync(await viewer.GetAsync("/api/v1/priorities")), "High"), "openTaskCount").ShouldBe(4);
        (await viewer.PostAsJsonAsync("/api/v1/priorities", new { label = "Nope", color = "low" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        var nobody = await _h.UserWithAsync(@"KE\nobody", "Client.View");
        (await nobody.GetAsync("/api/v1/priorities")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await nobody.GetAsync("/api/v1/status-labels")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        // A service call on behalf of someone who may not see Tasks (a seeder, a job) gets null as well.
        using var denied = _factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
            services.Replace(ServiceDescriptor.Scoped<IPermissionChecker>(_ => new NoPermissions()))));
        using var scope = denied.Services.CreateScope();
        (await scope.ServiceProvider.GetRequiredService<PriorityService>().ListViewsAsync()).ShouldAllBe(v => v.OpenTaskCount == null);
        (await scope.ServiceProvider.GetRequiredService<StatusLabelService>().ListViewsAsync()).ShouldAllBe(v => v.TaskCount == null);
    }

    [Fact]
    public async Task The_number_of_statements_does_not_grow_with_the_number_of_priorities()
    {
        var commands = new CommandLog();
        using var logged = _factory.WithWebHostBuilder(builder => builder.ConfigureServices(services => services.AddLogging(logging =>
        {
            logging.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Information);
            logging.AddProvider(commands);
        })));
        var http = logged.CreateClient();
        http.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        http.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);

        async Task<(int Statements, int Grouped, int Rows)> MeasureAsync()
        {
            await OkAsync(await http.GetAsync("/api/v1/priorities"));
            commands.Clear();
            var list = await OkAsync(await http.GetAsync("/api/v1/priorities"));
            var statements = commands.Snapshot();
            return (statements.Count, statements.Count(c => c.Contains("GROUP BY", StringComparison.OrdinalIgnoreCase) && c.Contains("[PriorityId]", StringComparison.Ordinal)), list.GetArrayLength());
        }

        var few = await MeasureAsync();
        for (var i = 0; i < 76; i++)
            await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/priorities", new { label = $"Bulk {i:D2}", color = "low" }), HttpStatusCode.Created);
        var many = await MeasureAsync();

        few.Rows.ShouldBe(4);
        many.Rows.ShouldBe(80);
        many.Statements.ShouldBe(few.Statements, "a fixed number of statements, none per priority");
        many.Grouped.ShouldBe(1);
        few.Grouped.ShouldBe(1);
    }

    private sealed class NoPermissions : IPermissionChecker
    {
        public bool Has(string permissionCode) => false;

        public Result Require(string permissionCode) => Result.Failure(Error.Forbidden(permissionCode));
    }
}
