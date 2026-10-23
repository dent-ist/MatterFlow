using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// GET /my-matters/workload (issue #682): open tasks on my matters by pod and person, out-of-office, links that equal their lists, role and scope.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class MyMattersWorkloadTests(SqlServerFixture sql) : MyMattersTestBase(sql)
{
    [Fact]
    public async Task Workload_groups_open_tasks_by_pod_and_person_with_out_of_office()
    {
        var own = await OkAsync(await TechClient.GetAsync("/api/v1/me/availability"));
        await OkAsync(await TechClient.PutAsJsonAsync("/api/v1/me/availability", new { status = "OUT_OF_OFFICE", until = "2099-12-31", note = "Conference", rowVersion = own.GetProperty("rowVersion").GetString() }));
        H.Factory.InvalidateAll();

        var w = await Mine("workload");
        w.GetProperty("open").GetInt32().ShouldBe(8);
        var pods = w.GetProperty("pods").EnumerateArray().ToList();
        pods.Select(p => p.GetProperty("podName").GetString()).ShouldBe(["Pod X", null]); // pods alphabetically, the tasks with no pod last

        var podX = pods[0];
        (podX.GetProperty("open").GetInt32(), podX.GetProperty("overdue").GetInt32()).ShouldBe((1, 0));
        var tech = podX.GetProperty("people").EnumerateArray().Single();
        tech.GetProperty("userId").GetInt32().ShouldBe(Tech);
        tech.GetProperty("availability").GetProperty("state").GetString().ShouldBe("OUT_OF_OFFICE");
        tech.GetProperty("availability").GetProperty("note").GetString().ShouldBe("Conference");

        var noPod = pods[1];
        (noPod.GetProperty("open").GetInt32(), noPod.GetProperty("overdue").GetInt32(), noPod.GetProperty("onHold").GetInt32()).ShouldBe((7, 1, 2));
        var row = noPod.GetProperty("people").EnumerateArray().Single(); // nobody is assigned: one "not assigned to a person" row
        row.GetProperty("userId").ValueKind.ShouldBe(JsonValueKind.Null);
        row.GetProperty("availability").ValueKind.ShouldBe(JsonValueKind.Null);

        // Every row opens the Task Queue with exactly its tasks, and nothing is ranked or labelled overloaded.
        foreach (var pod in pods)
        {
            (await TotalAsync(A, "task-queue", pod.GetProperty("query").GetString()!)).ShouldBe(pod.GetProperty("open").GetInt32());
            foreach (var person in pod.GetProperty("people").EnumerateArray())
                (await TotalAsync(A, "task-queue", person.GetProperty("query").GetString()!)).ShouldBe(person.GetProperty("open").GetInt32());
        }

        podX.EnumerateObject().Select(p => p.Name).Order().ShouldBe(["onHold", "open", "overdue", "people", "podId", "podName", "query"]);
        tech.EnumerateObject().Select(p => p.Name).Order().ShouldBe(["availability", "displayName", "isActive", "onHold", "open", "overdue", "query", "userId"]);
    }

    [Fact]
    public async Task Workload_follows_role_and_scope_and_shows_nobody_without_work_on_my_matters()
    {
        (await Mine("workload?role=secondary")).GetProperty("open").GetInt32().ShouldBe(3);
        (await Mine("workload", B)).GetProperty("open").GetInt32().ShouldBe(4);
        var empty = await Mine("workload", Director);
        empty.GetProperty("pods").GetArrayLength().ShouldBe(0);
        (await Mine("workload?scope=all", Director)).GetProperty("open").GetInt32().ShouldBe(9);
        await ProblemAsync(await Observer.GetAsync("/api/v1/my-matters/workload"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
    }
}
