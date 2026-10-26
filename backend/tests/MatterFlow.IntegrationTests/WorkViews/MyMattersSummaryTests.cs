using System.Net;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>GET /my-matters/summary (epic #667, issue #678): every count equals the list it opens, for three managers and every role; permissions.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class MyMattersSummaryTests(SqlServerFixture sql) : MyMattersTestBase(sql)
{
    private static readonly string[] TaskCells = ["openTasks", "overdue", "dueIn3Days", "dueIn7Days", "unassigned", "onHold", "atRisk"];

    private static int Count(JsonElement summary, string cell) => summary.GetProperty(cell).GetProperty("count").GetInt32();

    [Fact]
    public async Task A_managers_strip_counts_only_their_active_matters_and_never_the_unmanaged_one()
    {
        var s = await Mine("summary");
        s.GetProperty("scope").GetString().ShouldBe("mine");
        s.GetProperty("role").GetString().ShouldBe("both");
        // A: M1 (primary), M2 (secondary), M4 (primary), M6 (primary, no tasks); M5 is inactive and M3 has no manager.
        Count(s, "matters").ShouldBe(4);
        Count(s, "openTasks").ShouldBe(8);
        Count(s, "overdue").ShouldBe(1);
        Count(s, "dueIn3Days").ShouldBe(1);
        Count(s, "dueIn7Days").ShouldBe(2);
        Count(s, "unassigned").ShouldBe(7);
        Count(s, "onHold").ShouldBe(2);
        s.GetProperty("oldestHoldDays").GetInt32().ShouldBe(10);
        s.GetProperty("timeZone").GetString().ShouldNotBeNullOrEmpty();

        var primary = await Mine("summary?role=primary");
        (Count(primary, "matters"), Count(primary, "openTasks"), Count(primary, "overdue")).ShouldBe((3, 5, 1));
        var secondary = await Mine("summary?role=secondary");
        (Count(secondary, "matters"), Count(secondary, "openTasks"), Count(secondary, "onHold")).ShouldBe((1, 3, 1));
        secondary.GetProperty("oldestHoldDays").GetInt32().ShouldBe(2);

        // The other manager sees other numbers, and the unmanaged matter's overdue task is in nobody's strip.
        var b = await Mine("summary", B);
        (Count(b, "matters"), Count(b, "openTasks"), Count(b, "overdue")).ShouldBe((2, 4, 0));
        var client344 = await Mine("summary?clientId=" + (await ClientOfAsync(M4)));
        (Count(client344, "matters"), Count(client344, "openTasks")).ShouldBe((1, 1));
        client344.GetProperty("oldestHoldDays").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task Every_count_equals_the_list_it_opens()
    {
        foreach (var (client, who) in new[] { (A, "A"), (B, "B"), (Director, "director") })
        {
            foreach (var query in who == "director" ? new[] { $"scope=all&managerId={PmA}", "scope=all", $"scope=all&managerId={PmA}&role=secondary" } : new[] { "", "role=primary", "role=secondary" })
            {
                var s = await Mine("summary?" + query, client);
                foreach (var cell in TaskCells)
                {
                    var count = s.GetProperty(cell);
                    (await TotalAsync(client, "task-queue", count.GetProperty("query").GetString()!))
                        .ShouldBe(count.GetProperty("count").GetInt32(), $"{who} [{query}] {cell}: {count.GetProperty("query").GetString()}");
                }

                var matters = s.GetProperty("matters");
                (await TotalAsync(client, "matters", matters.GetProperty("query").GetString()!))
                    .ShouldBe(matters.GetProperty("count").GetInt32(), $"{who} [{query}] matters: {matters.GetProperty("query").GetString()}");
            }
        }
    }

    [Fact]
    public async Task The_date_range_narrows_the_counts_and_their_links_alike()
    {
        var s = await Mine($"summary?from={In(1)}&to={In(6)}");
        Count(s, "openTasks").ShouldBe(2); // m1-soon (+2) and m2-in5 (+5); ASAP and dateless tasks are left out while a range is set
        Count(s, "overdue").ShouldBe(0);
        foreach (var cell in TaskCells)
            (await TotalAsync(A, "task-queue", s.GetProperty(cell).GetProperty("query").GetString()!)).ShouldBe(Count(s, cell), cell);

        await ProblemAsync(await A.GetAsync($"/api/v1/my-matters/summary?from={In(5)}&to={In(1)}"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task All_matters_and_a_named_manager_need_AssignManagers()
    {
        var denied = await ProblemAsync(await A.GetAsync("/api/v1/my-matters/summary?scope=all"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        denied.GetProperty("meta").GetProperty("permission").GetString().ShouldBe("Matter.AssignManagers");
        await ProblemAsync(await A.GetAsync($"/api/v1/my-matters/summary?managerId={PmB}"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await Director.GetAsync("/api/v1/my-matters/summary?scope=nowhere"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await Director.GetAsync("/api/v1/my-matters/summary?role=boss"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await Director.GetAsync("/api/v1/my-matters/summary?unknown=1"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");

        var all = await Mine("summary?scope=all", Director);
        Count(all, "matters").ShouldBe(5); // M1 M2 M3 M4 M6 (M5 inactive)
        Count(all, "openTasks").ShouldBe(9); // including the unmanaged matter's overdue task
        Count(all, "overdue").ShouldBe(2);
        var theirs = await Mine($"summary?scope=all&managerId={PmB}", Director);
        (Count(theirs, "matters"), Count(theirs, "openTasks")).ShouldBe((2, 4));
    }

    [Fact]
    public async Task Only_people_who_can_be_managers_and_see_tasks_may_ask()
    {
        await ProblemAsync(await Observer.GetAsync("/api/v1/my-matters/summary"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        await ProblemAsync(await TechClient.GetAsync("/api/v1/my-matters/summary"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        await ProblemAsync(await NoTaskView.GetAsync("/api/v1/my-matters/summary"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        // A holder of Matter.AssignManagers alone may look; a manager with no matter gets zeros, not an error.
        var empty = await Mine("summary", Director);
        (Count(empty, "matters"), Count(empty, "openTasks")).ShouldBe((0, 0));
        using var anonymous = H.Factory.CreateClient();
        (await anonymous.GetAsync("/api/v1/my-matters/summary")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task A_second_call_is_served_from_the_short_cache_unless_fresh_is_asked_for()
    {
        // The test host switches the dashboard cache off (CacheSeconds 0): the answer is always current, and fresh=true is accepted.
        var before = Count(await Mine("summary"), "openTasks");
        await MakeAsync("m6-new", M6, new() { ["dueDate"] = In(9) });
        Count(await Mine("summary"), "openTasks").ShouldBe(before + 1);
        Count(await Mine("summary?fresh=true"), "openTasks").ShouldBe(before + 1);
    }

    private async Task<int> ClientOfAsync(int matterId) =>
        (await OkAsync(await H.Admin.GetAsync($"/api/v1/matters/{matterId}"))).GetProperty("clientId").GetInt32();
}
