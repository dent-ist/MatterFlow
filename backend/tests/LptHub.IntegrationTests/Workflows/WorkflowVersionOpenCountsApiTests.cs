using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Organization;
using MatterFlow.IntegrationTests.Tasks;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;
using Place = MatterFlow.IntegrationTests.Workflows.WorkflowInstanceHarness.Place;

namespace MatterFlow.IntegrationTests.Workflows;

/// <summary>
/// <c>openTaskCount</c>, <c>createdByUserId</c> and <c>createdByName</c> on each workflow version (#391) and the read policy of the version endpoint
/// (#416: Task.View or Workflow.Manage). The count is the number of New, In Progress and On Hold Tasks running on that version (the Task Queue
/// definition; completed Tasks are not counted), over every pod; null, not 0, without Task.View; and read in a fixed number of statements however
/// many versions a workflow has.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class WorkflowVersionOpenCountsApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private static readonly DateTime Now = new(2026, 10, 14, 16, 0, 0, DateTimeKind.Utc);

    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private TaskHarness.World _world = null!;
    private int _workflowId;
    private int _v1;
    private int _v2;
    private int _v3Draft;
    private int _adminId;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { Clock = new Audit.FixedClock(Now) };
        _h = new TaskHarness(_factory);
        _world = await _h.CreateWorldAsync();
        _adminId = await _h.UserIdAsync(DatabaseApiFactory.AdminAccount);

        // A workflow with v1 (retired), v2 (published) and an open draft v3, all created through the real admin API.
        var step = await _h.Workflows.CreateStepAsync("Version count step");
        var created = await _h.Workflows.CreatePublishedWorkflowAsync("Counted flow", true, new Place(step));
        _workflowId = created.WorkflowId;
        _v1 = created.VersionId;
        _v2 = await _h.Workflows.PublishNextVersionAsync(_workflowId, true, new Place(step));
        var draft = await OkAsync(await _h.Admin.PostAsync($"/api/v1/workflows/{_workflowId}/versions", Json("{}")), HttpStatusCode.Created);
        _v3Draft = draft.GetProperty("version").GetProperty("workflowVersionId").GetInt32();

        // Tasks per version: v1 has 2 New + 1 On Hold open and 3 Completed + 1 Cancelled; v2 has 2 In Progress + 1 New open and 2 Completed.
        var day = new DateOnly(2026, 10, 14);
        var rows = new List<CountsSeed.Row>();
        void Add(int version, string status, int count)
        {
            for (var i = 0; i < count; i++)
                rows.Add(new CountsSeed.Row(_world.MatterId, i % 2 == 0 ? _world.ProjectId : null, status, day.AddDays(i), WorkflowVersionId: version));
        }

        Add(_v1, "NEW", 2);
        Add(_v1, "ON_HOLD", 1);
        Add(_v1, "COMPLETED", 3);
        Add(_v1, "CANCELLED", 1);
        Add(_v2, "IN_PROGRESS", 2);
        Add(_v2, "NEW", 1);
        Add(_v2, "COMPLETED", 2);
        await CountsSeed.InsertTasksAsync(_h, _world, _adminId, rows, Now);

        // Tasks on another workflow's versions (the world's) must not leak into these numbers: the world's workflow has 4 open Tasks of its own.
        var otherVersion = await _h.ScalarAsync($"SELECT TOP 1 WorkflowVersionId AS [Value] FROM dbo.WorkflowVersion WHERE WorkflowDefinitionId = {_world.OrderedWorkflowId} AND Status = 'PUBLISHED'");
        await CountsSeed.InsertTasksAsync(_h, _world, _adminId, [.. Enumerable.Range(0, 4).Select(i => new CountsSeed.Row(_world.MatterId, null, "NEW", day, WorkflowVersionId: otherVersion))], Now);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static JsonElement VersionRow(JsonElement detail, int versionId) =>
        detail.GetProperty("versions").EnumerateArray().Single(v => v.GetProperty("workflowVersionId").GetInt32() == versionId);

    private static int? Count(JsonElement version) => version.GetProperty("openTaskCount").ValueKind == JsonValueKind.Null ? null : version.GetProperty("openTaskCount").GetInt32();

    private async Task<JsonElement> WorkflowAsync(HttpClient? client = null) => await OkAsync(await (client ?? _h.Admin).GetAsync($"/api/v1/workflows/{_workflowId}"));

    private async Task<JsonElement> VersionAsync(int versionId, HttpClient? client = null) =>
        await OkAsync(await (client ?? _h.Admin).GetAsync($"/api/v1/workflows/{_workflowId}/versions/{versionId}"));

    [Fact]
    public async Task Each_version_counts_its_own_open_tasks_and_the_counts_add_up_to_the_task_queue_total_of_the_workflow()
    {
        var detail = await WorkflowAsync();
        Count(VersionRow(detail, _v1)).ShouldBe(3, "2 New and 1 On Hold; completed and cancelled Tasks are not counted");
        Count(VersionRow(detail, _v2)).ShouldBe(3, "2 In Progress and 1 New");
        Count(VersionRow(detail, _v3Draft)).ShouldBe(0, "a draft has no Task, and 0 is a real zero");

        // The single-version read says the same, with the version's own row.
        Count((await VersionAsync(_v1)).GetProperty("version")).ShouldBe(3);
        Count((await VersionAsync(_v2)).GetProperty("version")).ShouldBe(3);
        Count((await VersionAsync(_v3Draft)).GetProperty("version")).ShouldBe(0);

        // The versions of the workflow add up to the Task Queue's total for the workflow (the queue filters by workflow, not by version).
        var queue = await OkAsync(await _h.Admin.GetAsync($"/api/v1/task-queue?pageSize=1&status=NEW&status=IN_PROGRESS&status=ON_HOLD&workflow={_workflowId}"));
        queue.GetProperty("total").GetInt32().ShouldBe(6);
        var reference = await _h.ScalarAsync(
            $"SELECT COUNT(*) AS [Value] FROM dbo.Task t JOIN dbo.WorkflowInstance i ON i.WorkflowInstanceId = t.WorkflowInstanceId JOIN dbo.WorkflowVersion v ON v.WorkflowVersionId = i.WorkflowVersionId WHERE v.WorkflowDefinitionId = {_workflowId} AND t.StatusCode IN ('NEW', 'IN_PROGRESS', 'ON_HOLD')");
        reference.ShouldBe(6);

        // The other workflow's Tasks are counted on its own version only.
        var other = await OkAsync(await _h.Admin.GetAsync($"/api/v1/workflows/{_world.OrderedWorkflowId}"));
        other.GetProperty("versions").EnumerateArray().Sum(v => Count(v)!.Value).ShouldBe(4);
    }

    [Fact]
    public async Task The_count_follows_the_task_status_and_the_publish_retire_and_draft_replies_carry_it()
    {
        await _h.ExecuteAsync($"UPDATE TOP (1) t SET StatusCode = 'COMPLETED', CompletedAt = SYSUTCDATETIME() FROM dbo.Task t JOIN dbo.WorkflowInstance i ON i.WorkflowInstanceId = t.WorkflowInstanceId WHERE i.WorkflowVersionId = {_v1} AND t.StatusCode = 'NEW'");
        Count(VersionRow(await WorkflowAsync(), _v1)).ShouldBe(2);

        // Retire v2: the reply carries the number of Tasks still running on it; they stay open and counted.
        var v2 = await VersionAsync(_v2);
        var retired = await OkAsync(await _h.Admin.PostAsJsonAsync(
            $"/api/v1/workflows/{_workflowId}/versions/{_v2}/retire",
            new { rowVersion = v2.GetProperty("version").GetProperty("rowVersion").GetString() }));
        retired.GetProperty("version").GetProperty("status").GetString().ShouldBe("Retired");
        Count(retired.GetProperty("version")).ShouldBe(3);
        Count(VersionRow(await WorkflowAsync(), _v2)).ShouldBe(3);

        // Publishing the draft: the new published version starts with no Task.
        var draft = await VersionAsync(_v3Draft);
        var published = await OkAsync(await _h.Admin.PostAsJsonAsync(
            $"/api/v1/workflows/{_workflowId}/versions/{_v3Draft}/publish",
            new { rowVersion = draft.GetProperty("version").GetProperty("rowVersion").GetString() }));
        Count(published.GetProperty("version")).ShouldBe(0);
    }

    [Fact]
    public async Task The_version_says_who_created_it_and_when()
    {
        var detail = await WorkflowAsync();
        var me = await OkAsync(await _h.Admin.GetAsync("/api/v1/me"));
        foreach (var version in detail.GetProperty("versions").EnumerateArray())
        {
            version.GetProperty("createdByUserId").GetInt32().ShouldBe(_adminId);
            version.GetProperty("createdByName").GetString().ShouldBe(me.GetProperty("displayName").GetString());
            version.GetProperty("createdAtUtc").GetDateTime().Ticks.ShouldBe(Now.Ticks, "the host clock of this test is fixed");
        }

        var single = (await VersionAsync(_v1)).GetProperty("version");
        single.GetProperty("createdByUserId").GetInt32().ShouldBe(_adminId);
        single.GetProperty("createdByName").GetString().ShouldNotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task Permissions_the_version_read_accepts_Task_View_or_Workflow_Manage_and_the_count_is_null_without_Task_View()
    {
        // Workflow.Manage only (#416): can open published, retired and draft versions and the workflow; the counts are null, not 0.
        var designer = await _h.UserWithAsync(@"KE\wfonly", "Workflow.Manage");
        foreach (var version in new[] { _v1, _v2, _v3Draft })
            Count((await VersionAsync(version, designer)).GetProperty("version")).ShouldBeNull($"version {version}");
        Count(VersionRow(await WorkflowAsync(designer), _v2)).ShouldBeNull();
        VersionRow(await WorkflowAsync(designer), _v1).GetProperty("createdByName").GetString().ShouldNotBeNullOrWhiteSpace();

        // Task.View with Workflow.Manage: numbers.
        var both = await _h.UserWithAsync(@"KE\wfboth", "Workflow.Manage", "Task.View");
        Count((await VersionAsync(_v1, both)).GetProperty("version")).ShouldBe(3);

        // Task.View only: published and retired versions with numbers, a draft is 403, the workflow endpoint is 403 (unchanged).
        var viewer = await _h.UserWithAsync(@"KE\viewer", "Task.View");
        Count((await VersionAsync(_v2, viewer)).GetProperty("version")).ShouldBe(3);
        (await viewer.GetAsync($"/api/v1/workflows/{_workflowId}/versions/{_v3Draft}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await viewer.GetAsync($"/api/v1/workflows/{_workflowId}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        // TaskType.Manage with Task.View: no workflow design permission, so the same as a viewer.
        var typeAdmin = await _h.UserWithAsync(@"KE\ttonly", "TaskType.Manage", "Task.View");
        (await typeAdmin.GetAsync($"/api/v1/workflows/{_workflowId}/versions/{_v2}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await typeAdmin.GetAsync($"/api/v1/workflows/{_workflowId}/versions/{_v3Draft}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        // Neither permission: 403 PERMISSION_DENIED; a missing version is 404 for the designer; every write stays Workflow.Manage.
        var nobody = await _h.UserWithAsync(@"KE\nobody", "Client.View");
        await ProblemAsync(await nobody.GetAsync($"/api/v1/workflows/{_workflowId}/versions/{_v2}"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        await ProblemAsync(await designer.GetAsync($"/api/v1/workflows/{_workflowId}/versions/999999"), HttpStatusCode.NotFound, "NOT_FOUND");
        (await viewer.PostAsync($"/api/v1/workflows/{_workflowId}/versions", Json("{}"))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        var v3 = await VersionAsync(_v3Draft);
        (await viewer.PutAsJsonAsync($"/api/v1/workflows/{_workflowId}/versions/{_v3Draft}", new { isOrdered = true, steps = Array.Empty<object>(), rowVersion = v3.GetProperty("version").GetProperty("rowVersion").GetString() })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await typeAdmin.PostAsJsonAsync($"/api/v1/workflows/{_workflowId}/versions/{_v3Draft}/publish", new { rowVersion = v3.GetProperty("version").GetProperty("rowVersion").GetString() })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await typeAdmin.DeleteAsync($"/api/v1/workflows/{_workflowId}/versions/{_v3Draft}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await viewer.PostAsJsonAsync($"/api/v1/workflows/{_workflowId}/versions/{_v2}/retire", new { rowVersion = "AAAA" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task The_workflow_read_takes_the_same_number_of_statements_for_three_versions_as_for_forty()
    {
        var logs = new CommandLog();
        using var logged = _factory.WithWebHostBuilder(builder => builder.ConfigureServices(services => services.AddLogging(logging =>
        {
            logging.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Information);
            logging.AddProvider(logs);
        })));
        var http = logged.CreateClient();
        http.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        http.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);

        async Task<(int Statements, JsonElement Detail)> ReadAsync()
        {
            await OkAsync(await http.GetAsync($"/api/v1/workflows/{_workflowId}"));
            logs.Clear();
            var detail = await OkAsync(await http.GetAsync($"/api/v1/workflows/{_workflowId}"));
            return (logs.Snapshot().Count, detail);
        }

        var (few, _) = await ReadAsync();

        // 37 more retired versions (version numbers 4 to 40), each with a running Task, inserted directly (set-based).
        await _h.ExecuteAsync($"""
            SET NOCOUNT ON;
            INSERT dbo.WorkflowVersion (WorkflowDefinitionId, VersionNo, Status, PublishedAt)
            SELECT {_workflowId}, n + 3, 'RETIRED', SYSUTCDATETIME() FROM (SELECT TOP 37 ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects) x;
            """);
        var manyIds = new List<int>();
        for (var i = 4; i <= 40; i++)
            manyIds.Add(await _h.ScalarAsync($"SELECT WorkflowVersionId AS [Value] FROM dbo.WorkflowVersion WHERE WorkflowDefinitionId = {_workflowId} AND VersionNo = {i}"));
        await CountsSeed.InsertTasksAsync(_h, _world, _adminId, [.. manyIds.Select(id => new CountsSeed.Row(_world.MatterId, null, "NEW", new DateOnly(2026, 10, 14), WorkflowVersionId: id))], Now);

        var (many, detail) = await ReadAsync();
        detail.GetProperty("versions").GetArrayLength().ShouldBe(40);
        detail.GetProperty("versions").EnumerateArray().Count(v => Count(v) == 1).ShouldBe(37);
        many.ShouldBe(few, "the number of statements must not grow with the versions");
        many.ShouldBeLessThan(10);
    }
}
