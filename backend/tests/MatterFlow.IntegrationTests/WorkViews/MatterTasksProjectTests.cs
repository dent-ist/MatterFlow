using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// POST /matters/{id}/tasks/project (MD-05, #1006): links tasks of one matter to a project of that matter or unlinks them; per-task results, the project rules
/// (same matter, active), the editability rule, permission and the audit line per task.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class MatterTasksProjectTests(SqlServerFixture sql) : MyMattersTestBase(sql)
{
    private string Url(int matterId) => $"/api/v1/matters/{matterId}/tasks/project";

    private async Task<int> ProjectAsync(int matterId, string name)
    {
        var project = await OkAsync(await H.Admin.PostAsJsonAsync("/api/v1/projects", new { matterId, name }), HttpStatusCode.Created);
        return project.GetProperty("projectId").GetInt32();
    }

    private async Task<int?> ProjectOfAsync(string title)
    {
        var task = await H.GetTaskAsync(Ids[title]);
        return task.TryGetProperty("project", out var p) && p.ValueKind == JsonValueKind.Object ? p.GetProperty("projectId").GetInt32() : null;
    }

    [Fact]
    public async Task Linking_puts_the_tasks_in_the_project_and_writes_one_project_line_per_task()
    {
        var project = await ProjectAsync(M1, "Wave 1");
        var ids = new[] { Ids["m1-soon"], Ids["m1-overdue"] };
        var body = await OkAsync(await H.Admin.PostAsJsonAsync(Url(M1), new { taskIds = ids, projectId = project }));

        (body.GetProperty("changed").GetInt32(), body.GetProperty("failed").GetInt32()).ShouldBe((2, 0));
        (await ProjectOfAsync("m1-soon")).ShouldBe(project);
        (await ProjectOfAsync("m1-overdue")).ShouldBe(project);
        (await ProjectOfAsync("m1-asap")).ShouldBeNull();
        foreach (var id in ids)
            (await H.AuditAsync(id)).Count(e => e.EventType == "FIELD_CHANGED" && e.FieldKey == "project" && e.NewValue == "Wave 1").ShouldBe(1);
    }

    [Fact]
    public async Task A_task_belongs_to_one_project_so_linking_moves_it_and_omitting_the_project_unlinks()
    {
        var first = await ProjectAsync(M1, "First");
        var second = await ProjectAsync(M1, "Second");
        await OkAsync(await H.Admin.PostAsJsonAsync(Url(M1), new { taskIds = new[] { Ids["m1-soon"] }, projectId = first }));
        await OkAsync(await H.Admin.PostAsJsonAsync(Url(M1), new { taskIds = new[] { Ids["m1-soon"] }, projectId = second }));
        (await ProjectOfAsync("m1-soon")).ShouldBe(second);
        (await H.AuditAsync(Ids["m1-soon"])).Last(e => e.FieldKey == "project").OldValue.ShouldBe("First");

        var unlinked = await OkAsync(await H.Admin.PostAsJsonAsync(Url(M1), new { taskIds = new[] { Ids["m1-soon"] } }));
        unlinked.GetProperty("changed").GetInt32().ShouldBe(1);
        (await ProjectOfAsync("m1-soon")).ShouldBeNull();
    }

    [Fact]
    public async Task A_project_of_another_matter_is_refused_and_changes_nothing()
    {
        var foreign = await ProjectAsync(M2, "Elsewhere");
        var response = await H.Admin.PostAsJsonAsync(Url(M1), new { taskIds = new[] { Ids["m1-soon"] }, projectId = foreign });
        response.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ProjectOfAsync("m1-soon")).ShouldBeNull();
    }

    [Fact]
    public async Task A_mixed_batch_reports_each_task()
    {
        var project = await ProjectAsync(M1, "Mixed");
        await H.CompleteAsync(await H.GetTaskAsync(Ids["m1-asap"]));
        var ids = new long[] { Ids["m1-soon"], Ids["m1-asap"], Ids["m2-far"], 9_999_999 };
        var body = await OkAsync(await H.Admin.PostAsJsonAsync(Url(M1), new { taskIds = ids, projectId = project }));

        (body.GetProperty("changed").GetInt32(), body.GetProperty("failed").GetInt32()).ShouldBe((1, 3));
        var results = body.GetProperty("results").EnumerateArray().ToList();
        results[0].GetProperty("ok").GetBoolean().ShouldBeTrue();
        results[1].GetProperty("code").GetString().ShouldBe("TASK_NOT_EDITABLE"); // completed
        results[2].GetProperty("code").GetString().ShouldBe("NOT_IN_MATTER");
        results[3].GetProperty("code").GetString().ShouldBe("NOT_FOUND");
        (await ProjectOfAsync("m2-far")).ShouldBeNull();
    }

    [Fact]
    public async Task Without_Task_Edit_the_request_is_forbidden()
    {
        var project = await ProjectAsync(M1, "Locked");
        var response = await Observer.PostAsJsonAsync(Url(M1), new { taskIds = new[] { Ids["m1-soon"] }, projectId = project });
        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await ProjectOfAsync("m1-soon")).ShouldBeNull();
    }

    [Fact]
    public async Task The_size_of_the_batch_is_checked()
    {
        var response = await H.Admin.PostAsJsonAsync(Url(M1), new { taskIds = Array.Empty<long>() });
        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }
}
