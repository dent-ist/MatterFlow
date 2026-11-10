using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Tasks;

/// <summary>End-to-end flows against the seeded starter configuration (15 Task Types, 8 workflows, the SME forms).</summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskStarterConfigurationTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync(), seedStarterConfiguration: true);
        _h = new TaskHarness(_factory);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    /// <summary>Values for every unconditionally required field of the Task Type's published request form.</summary>
    private async Task<Dictionary<string, object?>> RequiredValuesAsync(JsonElement taskType)
    {
        var schema = await OkAsync(await _h.Admin.GetAsync($"/api/v1/forms/versions/{taskType.GetProperty("publishedFormVersionId").GetInt32()}/schema"));
        var values = new Dictionary<string, object?>();
        foreach (var field in schema.GetProperty("fields").EnumerateArray())
        {
            var required = field.TryGetProperty("required", out var r) && r.ValueKind == JsonValueKind.True;
            var conditional = field.TryGetProperty("showWhen", out var sw) && sw.ValueKind == JsonValueKind.Object;
            if (!required || conditional)
                continue;

            var key = field.GetProperty("key").GetString()!;
            values[key] = field.GetProperty("control").GetString() switch
            {
                "SELECT" or "RADIO" => field.GetProperty("options")[0].GetProperty("key").GetString(),
                "MULTISELECT" => new[] { field.GetProperty("options")[0].GetProperty("key").GetString() },
                "CHECKBOX" => true,
                "NUMBER" => 5,
                "DATE" => "2030-01-15",
                "DATETIME" => "2030-01-15T12:00:00Z",
                "URL" => "https://example.test/x",
                _ => "seed value",
            };
        }

        return values;
    }

    [Fact]
    public async Task Every_seeded_task_type_with_only_plain_required_fields_can_be_created_on_each_of_its_workflows_and_cancelled()
    {
        var matterId = await _h.CreateMatterAsync();
        var types = await OkAsync(await _h.Admin.GetAsync("/api/v1/task-types?pageSize=100"));
        var items = types.ValueKind == JsonValueKind.Array ? types.EnumerateArray().ToList() : types.GetProperty("items").EnumerateArray().ToList();
        items.Count.ShouldBe(15);

        var generalRequest = items.Single(t => t.GetProperty("name").GetString() == "General / Ad Hoc Request");
        var values = await RequiredValuesAsync(generalRequest);
        var created = 0;
        foreach (var workflowId in generalRequest.GetProperty("eligibleWorkflowIds").EnumerateArray().Select(e => e.GetInt32()))
        {
            var body = new Dictionary<string, object?>
            {
                ["matterId"] = matterId,
                ["taskTypeId"] = generalRequest.GetProperty("id").GetInt32(),
                ["workflowDefinitionId"] = workflowId,
                ["title"] = "Seeded request " + workflowId,
                ["requestorName"] = "Pat Partner",
                ["formValues"] = values,
            };
            var task = await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/tasks", body), HttpStatusCode.Created);
            task.GetProperty("workflow").GetProperty("workflowDefinitionId").GetInt32().ShouldBe(workflowId);
            task.GetProperty("workflow").GetProperty("steps").GetArrayLength().ShouldBeGreaterThan(0);
            task.GetProperty("formValues").GetProperty("category").ValueKind.ShouldNotBe(JsonValueKind.Null);
            created++;
        }

        created.ShouldBeGreaterThan(0);
    }

    [Fact]
    public async Task A_seeded_workflow_blocks_bulk_completion_until_its_required_step_inputs_exist_and_everything_stays_unchanged()
    {
        var matterId = await _h.CreateMatterAsync();
        var types = await OkAsync(await _h.Admin.GetAsync("/api/v1/task-types?pageSize=100"));
        var items = types.ValueKind == JsonValueKind.Array ? types.EnumerateArray().ToList() : types.GetProperty("items").EnumerateArray().ToList();
        var type = items.Single(t => t.GetProperty("name").GetString() == "General / Ad Hoc Request");
        var workflows = await OkAsync(await _h.Admin.GetAsync("/api/v1/workflows?pageSize=100"));
        var list = workflows.ValueKind == JsonValueKind.Array ? workflows : workflows.GetProperty("items");
        var quick = list.EnumerateArray().Single(w => w.GetProperty("name").GetString() == "Quick Request").GetProperty("workflowDefinitionId").GetInt32();

        var task = await OkAsync(
            await _h.Admin.PostAsJsonAsync("/api/v1/tasks", new Dictionary<string, object?>
            {
                ["matterId"] = matterId,
                ["taskTypeId"] = type.GetProperty("id").GetInt32(),
                ["workflowDefinitionId"] = quick,
                ["title"] = "Quick one",
                ["requestorName"] = "Pat",
                ["formValues"] = await RequiredValuesAsync(type),
            }),
            HttpStatusCode.Created);

        var check = await OkAsync(await _h.Admin.GetAsync($"/api/v1/tasks/{TaskId(task)}/completion"));
        check.GetProperty("isReady").GetBoolean().ShouldBeFalse();
        check.GetProperty("unresolved").GetArrayLength().ShouldBe(task.GetProperty("workflow").GetProperty("steps").GetArrayLength());

        if (check.GetProperty("canBulkComplete").GetBoolean())
        {
            var completed = await _h.CompleteAsync(task, bulk: true);
            Status(completed).ShouldBe("COMPLETED");
            completed.GetProperty("workflow").GetProperty("steps").EnumerateArray().ShouldAllBe(s => s.GetProperty("status").GetString() == "COMPLETED");
        }
        else
        {
            var problem = await ProblemAsync(
                await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/complete", new { completeUnresolvedSteps = true, rowVersion = RowVersion(task), workflowRowVersion = WorkflowRowVersion(task) }),
                HttpStatusCode.Conflict,
                "COMPLETION_BLOCKED");
            problem.GetProperty("meta").GetProperty("stepsMissingInputs").GetArrayLength().ShouldBeGreaterThan(0);
            Status(await _h.GetTaskAsync(TaskId(task))).ShouldBe("NEW");
        }
    }
}
