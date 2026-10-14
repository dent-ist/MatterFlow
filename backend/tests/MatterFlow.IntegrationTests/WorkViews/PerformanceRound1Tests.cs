using System.Net;
using MatterFlow.Api.Http;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using MatterFlow.IntegrationTests.Workflows;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// Regression tests for the first performance pass (ticket 64): the dashboard output cache, the read command timeout, the batched step-value
/// read of the Task detail, and the indexes that the Pod Work counts and the comment limit depend on.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class PerformanceRound1Tests(SqlServerFixture sql)
{
    private static readonly string[] DepartmentViewer = [.. AllTaskPermissions, "Dashboard.ViewDepartment"];

    // ---- dashboard output cache (SEC2-03)

    [Fact]
    public async Task The_dashboard_is_served_from_a_short_cache_per_user()
    {
        await using var factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync(), dashboardCacheSeconds: 60);
        var h = new TaskHarness(factory);
        var world = await h.CreateWorldAsync();
        var first = await h.UserWithAsync(@"KE\viewer1", DepartmentViewer);
        var second = await h.UserWithAsync(@"KE\viewer2", DepartmentViewer);
        await h.CreateTaskAsync(world);

        (await OpenCountAsync(first)).ShouldBe(1);
        await h.CreateTaskAsync(world);

        (await OpenCountAsync(first)).ShouldBe(1, "the same user and period within the cache time gets the stored answer");
        (await OpenCountAsync(second)).ShouldBe(2, "another user has a key of their own and sees the current numbers");
        (await OpenCountAsync(first, "?periodDays=7")).ShouldBe(2, "another period is another key");
    }

    [Fact]
    public async Task A_user_without_the_department_right_never_gets_an_answer_cached_for_someone_with_it()
    {
        await using var factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync(), dashboardCacheSeconds: 60);
        var h = new TaskHarness(factory);
        var world = await h.CreateWorldAsync();
        var viewer = await h.UserWithAsync(@"KE\dept", DepartmentViewer);
        var plain = await h.UserWithAsync(@"KE\plain", AllTaskPermissions);
        await h.CreateTaskAsync(world);

        (await OpenCountAsync(viewer)).ShouldBe(1);
        (await OpenCountAsync(plain)).ShouldBe(0, "SEC2-05: department figures stay empty without Dashboard.ViewDepartment");
    }

    [Fact]
    public async Task With_the_cache_off_the_dashboard_follows_every_change()
    {
        await using var factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        var h = new TaskHarness(factory);
        var world = await h.CreateWorldAsync();
        var viewer = await h.UserWithAsync(@"KE\fresh", DepartmentViewer);

        (await OpenCountAsync(viewer)).ShouldBe(0);
        await h.CreateTaskAsync(world);
        (await OpenCountAsync(viewer)).ShouldBe(1);
    }

    private static async Task<int> OpenCountAsync(HttpClient client, string query = "") =>
        (await OkAsync(await client.GetAsync("/api/v1/dashboard" + query))).GetProperty("open").GetProperty("count").GetInt32();

    // ---- read command timeout (SEC2-03)

    [Theory]
    [InlineData("/api/v1/task-queue")]
    [InlineData("/api/v1/my-work")]
    [InlineData("/api/v1/pod-work")]
    [InlineData("/api/v1/search?q=abc")]
    [InlineData("/api/v1/search/advanced?type=task")]
    [InlineData("/api/v1/dashboard")]
    [InlineData("/api/v1/audit/search")]
    public async Task The_scanning_reads_run_with_the_configured_command_timeout(string path)
    {
        var log = new CommandLog();
        await using var factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync(), readTimeoutSeconds: 7);
        var h = new TaskHarness(factory);
        await h.CreateWorldAsync();
        using var logged = factory.WithWebHostBuilder(b => b.ConfigureServices(services => services.AddLogging(logging =>
        {
            logging.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Information);
            logging.AddProvider(log);
        })));
        var client = logged.CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);
        await client.GetAsync("/api/v1/me");

        log.Clear();
        var response = await client.GetAsync(path);
        (await response.Content.ReadAsStringAsync()).ShouldNotBeNull();
        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        var statements = log.Snapshot();
        statements.ShouldContain(s => s.Contains("CommandTimeout='7'", StringComparison.Ordinal), string.Join("\n", statements.Select(s => s.Split('\n')[0])));
    }

    [Fact]
    public async Task Other_reads_and_writes_keep_the_default_command_timeout()
    {
        var log = new CommandLog();
        await using var factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync(), readTimeoutSeconds: 7);
        var h = new TaskHarness(factory);
        var world = await h.CreateWorldAsync();
        var task = await h.CreateTaskAsync(world);
        using var logged = factory.WithWebHostBuilder(b => b.ConfigureServices(services => services.AddLogging(logging =>
        {
            logging.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Information);
            logging.AddProvider(log);
        })));
        var client = logged.CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);
        await client.GetAsync("/api/v1/me");

        log.Clear();
        (await client.GetAsync($"/api/v1/tasks/{TaskId(task)}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        log.Snapshot().ShouldNotContain(s => s.Contains("CommandTimeout='7'", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("GET", "/api/v1/task-queue", true)]
    [InlineData("GET", "/api/v1/TASK-QUEUE", true)]
    [InlineData("GET", "/api/v1/my-work", true)]
    [InlineData("GET", "/api/v1/pod-work", true)]
    [InlineData("GET", "/api/v1/search/advanced", true)]
    [InlineData("GET", "/api/v1/audit/events", true)]
    [InlineData("GET", "/api/v1/dashboard", true)]
    [InlineData("GET", "/api/v1/tasks/5", false)]
    [InlineData("GET", "/api/v1/matters", false)]
    [InlineData("POST", "/api/v1/tasks", false)]
    [InlineData("POST", "/api/v1/search", false)]
    public void The_filter_applies_to_reads_of_the_scanning_endpoints_only(string method, string path, bool applies) =>
        ReadQueryTimeoutFilter.Applies(method, new PathString(path)).ShouldBe(applies);

    [Fact]
    public async Task A_read_that_runs_past_the_timeout_is_answered_with_503_QUERY_TIMEOUT()
    {
        await using var factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        var h = new TaskHarness(factory);
        var problem = await ProblemAsync(await h.Admin.GetAsync("/api/v1/test/slow-read"), HttpStatusCode.ServiceUnavailable, "QUERY_TIMEOUT");
        problem.GetProperty("title").GetString().ShouldBe("The request took too long");
    }

    // ---- task detail: one read for the values of all steps

    [Fact]
    public async Task The_task_detail_reads_the_step_values_in_one_statement_however_many_steps_have_forms()
    {
        var log = new CommandLog();
        await using var factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        var h = new TaskHarness(factory);
        var steps = new List<WorkflowInstanceHarness.Place>();
        for (var i = 1; i <= 6; i++)
            steps.Add(new WorkflowInstanceHarness.Place(await h.Workflows.CreateStepAsync("Step with form " + i, withInputForm: true)));
        var workflow = await h.Workflows.CreatePublishedWorkflowAsync("Six forms", true, [.. steps]);
        var matterId = await h.CreateMatterAsync();
        var typeId = await h.CreateTaskTypeAsync("Six form type", [workflow.WorkflowId]);
        var world = new World(matterId, 0, typeId, workflow.WorkflowId, workflow.WorkflowId, []);
        var task = await h.CreateTaskAsync(world);
        TaskHarness.StepIds(task).Length.ShouldBe(6);

        using var logged = factory.WithWebHostBuilder(b => b.ConfigureServices(services => services.AddLogging(logging =>
        {
            logging.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Information);
            logging.AddProvider(log);
        })));
        var client = logged.CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);
        await client.GetAsync("/api/v1/me");

        log.Clear();
        var detail = await OkAsync(await client.GetAsync($"/api/v1/tasks/{TaskId(task)}"));
        detail.GetProperty("workflow").GetProperty("steps").GetArrayLength().ShouldBe(6);

        var valueReads = log.Snapshot().Count(s => s.Contains("FROM [FormValueSet]", StringComparison.Ordinal));
        valueReads.ShouldBeLessThanOrEqualTo(2, "one read for the Task's own form values and one for all the steps");
    }

    [Fact]
    public async Task The_workflow_view_still_reports_each_steps_saved_values_and_whether_its_required_inputs_are_complete()
    {
        await using var factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        var h = new TaskHarness(factory);
        var world = await h.CreateWorldAsync();
        var task = await h.CreateTaskAsync(world);
        var ids = TaskHarness.StepIds(task);

        // Step 1 has the input form of WorkflowInstanceHarness.InputFormFields (required "note"); the other steps have no form.
        var started = await h.StepAsync(task, ids[0], "start");
        var partial = await h.StepAsync(started, ids[0], "values", new { values = new { has_extra = true } });
        var steps = partial.GetProperty("workflow").GetProperty("steps").EnumerateArray().ToList();
        steps[0].GetProperty("values").GetProperty("has_extra").GetBoolean().ShouldBeTrue();
        steps[0].GetProperty("requiredInputsSatisfied").GetBoolean().ShouldBeFalse("the required note is still missing");
        steps[1].GetProperty("values").EnumerateObject().ShouldBeEmpty();
        steps[1].GetProperty("requiredInputsSatisfied").GetBoolean().ShouldBeTrue("a step without an input form has nothing missing");

        var filled = await h.StepAsync(partial, ids[0], "values", new { values = new { note = "done" } });
        var after = filled.GetProperty("workflow").GetProperty("steps")[0];
        after.GetProperty("values").GetProperty("note").GetString().ShouldBe("done");
        after.GetProperty("requiredInputsSatisfied").GetBoolean().ShouldBeTrue();
    }

    // ---- indexes of script 18

    [Fact]
    public async Task Script_18_widens_the_task_indexes_for_the_overdue_counts_and_adds_the_comment_count_index()
    {
        var connectionString = await sql.CreateMigratedDatabaseAsync();
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync();

        async Task<List<string>> IncludedAsync(string table, string index)
        {
            await using var command = connection.CreateCommand();
            command.CommandText = """
                SELECT c.name FROM sys.indexes i
                JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 1
                JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                WHERE i.object_id = OBJECT_ID(@table) AND i.name = @index
                """;
            command.Parameters.AddWithValue("@table", table);
            command.Parameters.AddWithValue("@index", index);
            var names = new List<string>();
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                names.Add(reader.GetString(0));
            return names;
        }

        foreach (var index in new[] { "IX_Task_Queue", "IX_Task_AssignedUser", "IX_Task_Pod" })
        {
            var included = await IncludedAsync("dbo.Task", index);
            included.ShouldContain("DueDate", index);
            included.ShouldContain("DueAtUtc", index);
        }

        await using var exists = connection.CreateCommand();
        exists.CommandText = "SELECT COUNT(*) FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.TaskComment') AND name = 'IX_TaskComment_TaskAll' AND has_filter = 0";
        ((int)(await exists.ExecuteScalarAsync())!).ShouldBe(1);
    }

    [Fact]
    public async Task The_overdue_count_of_a_pod_and_the_comment_count_of_a_task_are_answered_from_their_indexes()
    {
        var connectionString = await sql.CreateMigratedDatabaseAsync();
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync();

        async Task<string> PlanAsync(string statement)
        {
            await using (var on = connection.CreateCommand())
            {
                on.CommandText = "SET SHOWPLAN_TEXT ON";
                await on.ExecuteNonQueryAsync();
            }

            try
            {
                await using var show = connection.CreateCommand();
                show.CommandText = statement;
                var lines = new List<string>();
                await using var reader = await show.ExecuteReaderAsync();
                do
                {
                    while (await reader.ReadAsync())
                        lines.Add(reader.GetString(0));
                }
                while (await reader.NextResultAsync());
                return string.Join("\n", lines);
            }
            finally
            {
                await using var off = connection.CreateCommand();
                off.CommandText = "SET SHOWPLAN_TEXT OFF";
                await off.ExecuteNonQueryAsync();
            }
        }

        var podCount = await PlanAsync("""
            SELECT COUNT(*) FROM dbo.Task t
            WHERE t.AssignedPodId = 1 AND t.StatusCode IN ('NEW', 'IN_PROGRESS', 'ON_HOLD')
              AND ((t.DueAtUtc IS NOT NULL AND t.DueAtUtc < SYSUTCDATETIME()) OR (t.DueAtUtc IS NULL AND t.DueDate IS NOT NULL AND t.DueDate < CAST(SYSUTCDATETIME() AS DATE)))
            """);
        podCount.ShouldContain("IX_Task_Pod");
        podCount.ShouldNotContain("Key Lookup", Case.Insensitive);
        podCount.ShouldNotContain("PK_Task", Case.Insensitive);

        var commentCount = await PlanAsync("SELECT COUNT(*) FROM dbo.TaskComment WHERE TaskId = 1");
        commentCount.ShouldContain("IX_TaskComment_TaskAll");
    }
}
