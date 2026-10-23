using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>POST /matters/{id}/tasks/bulk (epic #667, issue #685): per-task results, the single-task rules, permissions per field, the pod warning and one correlation id.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class MatterBulkTasksTests(SqlServerFixture sql) : MyMattersTestBase(sql)
{
    private int _otherPriority;
    private HttpClient _assignOnly = null!;
    private HttpClient _priorityOnly = null!;

    private string Url(int matterId) => $"/api/v1/matters/{matterId}/tasks/bulk";

    private static List<JsonElement> Results(JsonElement body) => [.. body.GetProperty("results").EnumerateArray()];

    public override async Task InitializeAsync()
    {
        await base.InitializeAsync();
        _assignOnly = await H.UserWithAsync(@"KE\assignonly", "Task.View", "Task.Assign");
        _priorityOnly = await H.UserWithAsync(@"KE\priorityonly", "Task.View", "Task.SetPriority");
        var defaultPriority = (await H.GetTaskAsync(Ids["m1-soon"])).GetProperty("priority").GetProperty("priorityId").GetInt32();
        _otherPriority = await H.ScalarAsync($"SELECT TOP 1 PriorityId AS [Value] FROM dbo.Priority WHERE IsActive = 1 AND PriorityId <> {defaultPriority} ORDER BY PriorityId");
    }

    private static async Task ValidationAsync(HttpResponseMessage response, string code)
    {
        var problem = await ProblemAsync(response, HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        problem.GetProperty("errors").EnumerateObject().SelectMany(e => e.Value.EnumerateArray()).Select(e => e.GetProperty("code").GetString()).ShouldContain(code);
    }

    private Task<JsonElement> TaskAsync(string title) => H.GetTaskAsync(Ids[title]);

    [Fact]
    public async Task Reassigning_and_reprioritising_changes_every_task_and_groups_the_audit_by_one_correlation_id()
    {
        var ids = new[] { Ids["m1-soon"], Ids["m1-overdue"], Ids["m1-asap"] };
        var body = await OkAsync(await H.Admin.PostAsJsonAsync(Url(M1), new { taskIds = ids, reassignTo = new { userId = Tech }, priorityId = _otherPriority }));

        (body.GetProperty("changed").GetInt32(), body.GetProperty("failed").GetInt32()).ShouldBe((3, 0));
        Results(body).Select(r => r.GetProperty("taskId").GetInt64()).ShouldBe(ids); // request order
        Results(body).ShouldAllBe(r => r.GetProperty("ok").GetBoolean() && r.GetProperty("code").ValueKind == JsonValueKind.Null);
        foreach (var title in new[] { "m1-soon", "m1-overdue", "m1-asap" })
        {
            var task = await TaskAsync(title);
            task.GetProperty("assignedUser").GetProperty("userId").GetInt32().ShouldBe(Tech);
            task.GetProperty("priority").GetProperty("priorityId").GetInt32().ShouldBe(_otherPriority);
            Status(task).ShouldBe("IN_PROGRESS"); // assigning a New task starts it, as in the single-task command
        }

        // One correlation id for the whole batch: the assignment and priority entries of the three tasks all carry the id of the answer.
        var correlation = body.GetProperty("correlationId").GetGuid();
        correlation.ShouldNotBe(Guid.Empty);
        foreach (var id in ids)
        {
            var events = (await H.AuditAsync(id)).Where(e => e.EventType is "TASK_ASSIGNED" || (e.EventType == "FIELD_CHANGED" && e.FieldKey == "priority")).ToList();
            events.Count.ShouldBe(2);
            events.ShouldAllBe(e => e.CorrelationId == correlation);
        }
    }

    [Fact]
    public async Task One_field_at_a_time_and_an_unchanged_task_still_counts_as_ok()
    {
        var priorityOnly = await OkAsync(await H.Admin.PostAsJsonAsync(Url(M1), new { taskIds = new[] { Ids["m1-soon"] }, priorityId = _otherPriority }));
        priorityOnly.GetProperty("changed").GetInt32().ShouldBe(1);
        (await TaskAsync("m1-soon")).GetProperty("assignedUser").ValueKind.ShouldBe(JsonValueKind.Null);

        var assignOnly = await OkAsync(await H.Admin.PostAsJsonAsync(Url(M1), new { taskIds = new[] { Ids["m1-soon"] }, reassignTo = new { userId = Tech } }));
        assignOnly.GetProperty("changed").GetInt32().ShouldBe(1);
        (await TaskAsync("m1-soon")).GetProperty("priority").GetProperty("priorityId").GetInt32().ShouldBe(_otherPriority);

        // The same change again is a no-op and is reported as fine.
        var again = await OkAsync(await H.Admin.PostAsJsonAsync(Url(M1), new { taskIds = new[] { Ids["m1-soon"] }, reassignTo = new { userId = Tech }, priorityId = _otherPriority }));
        (again.GetProperty("changed").GetInt32(), again.GetProperty("failed").GetInt32()).ShouldBe((1, 0));
    }

    [Fact]
    public async Task A_mixed_batch_reports_each_task_and_changes_the_ones_that_can_change()
    {
        var done = await H.CompleteAsync(await TaskAsync("m1-asap"));
        Status(done).ShouldBe("COMPLETED");
        var ids = new long[] { Ids["m1-soon"], Ids["m1-asap"], Ids["m1-hold"], Ids["m2-far"], 9_999_999 };
        var body = await OkAsync(await H.Admin.PostAsJsonAsync(Url(M1), new { taskIds = ids, reassignTo = new { userId = Tech } }));

        var results = Results(body);
        (body.GetProperty("changed").GetInt32(), body.GetProperty("failed").GetInt32()).ShouldBe((2, 3));
        string Code(int i) => results[i].GetProperty("code").GetString()!;
        results[0].GetProperty("ok").GetBoolean().ShouldBeTrue();
        Code(1).ShouldBe("TASK_NOT_EDITABLE"); // completed
        results[2].GetProperty("ok").GetBoolean().ShouldBeTrue(); // on hold is still open: it can be reassigned
        Code(3).ShouldBe("NOT_IN_MATTER"); // a task of another matter is rejected, not changed
        Code(4).ShouldBe("NOT_FOUND");
        results.Where((_, i) => i is 1 or 3 or 4).ShouldAllBe(r => !r.GetProperty("ok").GetBoolean() && !string.IsNullOrEmpty(r.GetProperty("message").GetString()));
        (await TaskAsync("m1-hold")).GetProperty("assignedUser").GetProperty("userId").GetInt32().ShouldBe(Tech);
        (await TaskAsync("m2-far")).GetProperty("assignedUser").ValueKind.ShouldBe(JsonValueKind.Null);
        (await TaskAsync("m1-soon")).GetProperty("assignedUser").GetProperty("userId").GetInt32().ShouldBe(Tech);
    }

    [Fact]
    public async Task A_person_outside_the_pod_is_a_warning_and_a_pod_alone_moves_the_task_to_the_queue()
    {
        var warned = await OkAsync(await H.Admin.PostAsJsonAsync(Url(M1), new { taskIds = new[] { Ids["m1-soon"] }, reassignTo = new { userId = PmB, podId = PodX } }));
        var result = Results(warned).Single();
        result.GetProperty("ok").GetBoolean().ShouldBeTrue();
        result.GetProperty("warnings").EnumerateArray().Select(w => w.GetString()).ShouldBe(["USER_NOT_IN_POD"]);
        var task = await TaskAsync("m1-soon");
        (task.GetProperty("assignedUser").GetProperty("userId").GetInt32(), task.GetProperty("assignedPod").GetProperty("podId").GetInt32()).ShouldBe((PmB, PodX));

        var podOnly = await OkAsync(await H.Admin.PostAsJsonAsync(Url(M1), new { taskIds = new[] { Ids["m1-soon"] }, reassignTo = new { podId = PodX } }));
        Results(podOnly).Single().GetProperty("warnings").GetArrayLength().ShouldBe(0);
        var queued = await TaskAsync("m1-soon");
        queued.GetProperty("assignedUser").ValueKind.ShouldBe(JsonValueKind.Null);
        queued.GetProperty("assignedPod").GetProperty("podId").GetInt32().ShouldBe(PodX);

        // A person alone keeps the pod the task is in.
        await OkAsync(await H.Admin.PostAsJsonAsync(Url(M1), new { taskIds = new[] { Ids["m1-soon"] }, reassignTo = new { userId = Tech } }));
        (await TaskAsync("m1-soon")).GetProperty("assignedPod").GetProperty("podId").GetInt32().ShouldBe(PodX);
    }

    [Fact]
    public async Task A_bad_request_is_refused_as_a_whole_and_nothing_changes()
    {
        var one = new[] { Ids["m1-soon"] };
        await ProblemAsync(await H.Admin.PostAsJsonAsync(Url(M1), new { taskIds = Array.Empty<long>(), priorityId = _otherPriority }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await H.Admin.PostAsJsonAsync(Url(M1), new { taskIds = Enumerable.Range(1, 101).Select(i => (long)i).ToArray(), priorityId = _otherPriority }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ValidationAsync(await H.Admin.PostAsJsonAsync(Url(M1), new { taskIds = new[] { one[0], one[0] }, priorityId = _otherPriority }), "DUPLICATE");
        await ValidationAsync(await H.Admin.PostAsJsonAsync(Url(M1), new { taskIds = one }), "NOTHING_TO_CHANGE");
        await ValidationAsync(await H.Admin.PostAsJsonAsync(Url(M1), new { taskIds = one, reassignTo = new { } }), "NOTHING_TO_CHANGE");
        await ValidationAsync(await H.Admin.PostAsJsonAsync(Url(M1), new { taskIds = one, reassignTo = new { userId = 987654 } }), "NOT_FOUND");
        await ValidationAsync(await H.Admin.PostAsJsonAsync(Url(M1), new { taskIds = one, reassignTo = new { podId = 987654 } }), "NOT_FOUND");
        await ValidationAsync(await H.Admin.PostAsJsonAsync(Url(M1), new { taskIds = one, priorityId = 987654 }), "NOT_AVAILABLE");
        await ProblemAsync(await H.Admin.PostAsJsonAsync(Url(987654), new { taskIds = one, priorityId = _otherPriority }), HttpStatusCode.NotFound, "NOT_FOUND");
        await H.ExecuteAsync($"UPDATE dbo.AppUser SET IsActive = 0 WHERE UserId = {PmB}");
        await ValidationAsync(await H.Admin.PostAsJsonAsync(Url(M1), new { taskIds = one, reassignTo = new { userId = PmB } }), "USER_INACTIVE");
        (await TaskAsync("m1-soon")).GetProperty("assignedUser").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task Each_field_needs_its_own_permission_and_nothing_is_changed_without_it()
    {
        var one = new[] { Ids["m1-soon"] };
        var denied = await ProblemAsync(await _assignOnly.PostAsJsonAsync(Url(M1), new { taskIds = one, priorityId = _otherPriority }), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        denied.GetProperty("meta").GetProperty("permission").GetString().ShouldBe("Task.SetPriority");
        var both = await ProblemAsync(await _assignOnly.PostAsJsonAsync(Url(M1), new { taskIds = one, reassignTo = new { userId = Tech }, priorityId = _otherPriority }), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        both.GetProperty("meta").GetProperty("permission").GetString().ShouldBe("Task.SetPriority");
        var other = await ProblemAsync(await _priorityOnly.PostAsJsonAsync(Url(M1), new { taskIds = one, reassignTo = new { userId = Tech } }), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        other.GetProperty("meta").GetProperty("permission").GetString().ShouldBe("Task.Assign");
        (await TaskAsync("m1-soon")).GetProperty("assignedUser").ValueKind.ShouldBe(JsonValueKind.Null);

        // The permitted field works for the person who holds only that permission.
        var ok = await OkAsync(await _assignOnly.PostAsJsonAsync(Url(M1), new { taskIds = one, reassignTo = new { userId = Tech } }));
        ok.GetProperty("changed").GetInt32().ShouldBe(1);
        (await OkAsync(await _priorityOnly.PostAsJsonAsync(Url(M1), new { taskIds = one, priorityId = _otherPriority }))).GetProperty("changed").GetInt32().ShouldBe(1);

        // Not only project managers: a manager, a director and a read-only user are ruled by the task permissions alone.
        await ProblemAsync(await Observer.PostAsJsonAsync(Url(M1), new { taskIds = one, priorityId = _otherPriority }), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        await ProblemAsync(await A.PostAsJsonAsync(Url(M1), new { taskIds = one, priorityId = _otherPriority }), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        using var anonymous = H.Factory.CreateClient();
        anonymous.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        (await anonymous.PostAsJsonAsync(Url(M1), new { taskIds = one, priorityId = _otherPriority })).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }
}
