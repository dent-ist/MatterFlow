using System.Net;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// GET /my-matters/trends (epic #758, PX-09, #767): weekly created / completed / overdue-at-week-end derived from existing columns, today's figures, the stated limitation, and the same
/// scope and access rules as the other My Matters calls. Every weekly count that has a list opens exactly the tasks it counted.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class MyMattersTrendsTests(SqlServerFixture sql) : MyMattersTestBase(sql)
{
    private static List<JsonElement> Points(JsonElement trends) => [.. trends.GetProperty("points").EnumerateArray()];

    [Fact]
    public async Task The_default_is_eight_weeks_ending_with_the_current_one_and_says_it_is_approximate()
    {
        var trends = await Mine("trends");
        trends.GetProperty("weeks").GetInt32().ShouldBe(8);
        trends.GetProperty("approximate").GetBoolean().ShouldBeTrue();
        trends.GetProperty("limitations").EnumerateArray().Select(l => l.GetString()).ShouldBe(["CURRENT_DUE_DATES", "CURRENT_STATUS", "CURRENT_MATTER_SET"]);

        var points = Points(trends);
        points.Count.ShouldBe(8);
        points.ShouldAllBe(p => DateOnly.Parse(p.GetProperty("weekStart").GetString()!).DayOfWeek == DayOfWeek.Monday);
        points.ShouldAllBe(p => DateOnly.Parse(p.GetProperty("weekEnd").GetString()!) == DateOnly.Parse(p.GetProperty("weekStart").GetString()!).AddDays(6));
        points.Select(p => p.GetProperty("isCurrent").GetBoolean()).ShouldBe([false, false, false, false, false, false, false, true]);

        // A's matters hold eight tasks, all created now: this week. The overdue 2000 task is overdue now and was not before it existed.
        points.Take(7).ShouldAllBe(p => p.GetProperty("created").GetInt32() == 0 && p.GetProperty("overdueAtWeekEnd").GetInt32() == 0);
        var current = points[7];
        current.GetProperty("created").GetInt32().ShouldBe(8);
        current.GetProperty("closed").GetInt32().ShouldBe(0);
        current.GetProperty("overdueAtWeekEnd").GetInt32().ShouldBe(1);
        (await TotalAsync(A, "task-queue", current.GetProperty("createdQuery").GetString()!)).ShouldBe(8);

        var now = trends.GetProperty("now");
        now.GetProperty("open").GetInt32().ShouldBe(8);
        now.GetProperty("onHold").GetInt32().ShouldBe(2);
        now.GetProperty("oldestOnHoldDays").GetInt32().ShouldBe(10);
        (await TotalAsync(A, "task-queue", now.GetProperty("openQuery").GetString()!)).ShouldBe(8);
        (await TotalAsync(A, "task-queue", now.GetProperty("onHoldQuery").GetString()!)).ShouldBe(2);
        (await TotalAsync(A, "task-queue", now.GetProperty("overdueQuery").GetString()!)).ShouldBe(1);
    }

    [Fact]
    public async Task History_is_derived_from_creation_completion_and_due_dates_and_each_weekly_count_opens_its_list()
    {
        // The overdue task was created 40 days ago; one task was completed 15 days ago.
        await H.ExecuteAsync($"UPDATE dbo.Task SET CreatedAt = DATEADD(day, -40, SYSUTCDATETIME()) WHERE TaskId = {Ids["m1-overdue"]}");
        await H.CompleteAsync(await H.GetTaskAsync(Ids["m2-in5"]));
        await H.ExecuteAsync($"UPDATE dbo.Task SET StatusChangedAt = DATEADD(day, -15, SYSUTCDATETIME()), CompletedAt = DATEADD(day, -15, SYSUTCDATETIME()) WHERE TaskId = {Ids["m2-in5"]}");
        H.Factory.InvalidateAll();

        var trends = await Mine("trends");
        var points = Points(trends);
        points[0].GetProperty("overdueAtWeekEnd").GetInt32().ShouldBe(0); // before the task existed
        points[2].GetProperty("overdueAtWeekEnd").GetInt32().ShouldBe(1);
        points[7].GetProperty("overdueAtWeekEnd").GetInt32().ShouldBe(1);

        points.Sum(p => p.GetProperty("created").GetInt32()).ShouldBe(8); // seven created now and the old one, created 40 days ago inside the 8 weeks
        foreach (var p in points)
        {
            (await TotalAsync(A, "task-queue", p.GetProperty("createdQuery").GetString()!)).ShouldBe(p.GetProperty("created").GetInt32(), p.GetProperty("weekStart").GetString());
            (await TotalAsync(A, "task-queue", p.GetProperty("closedQuery").GetString()!)).ShouldBe(p.GetProperty("closed").GetInt32(), p.GetProperty("weekStart").GetString());
        }

        points.Sum(p => p.GetProperty("closed").GetInt32()).ShouldBe(1);
        trends.GetProperty("now").GetProperty("open").GetInt32().ShouldBe(7);
        var age = trends.GetProperty("now").GetProperty("averageAgeDays").GetDouble();
        age.ShouldBeInRange(5.4, 6.0); // 40 days over seven open tasks, the rest created now
    }

    [Fact]
    public async Task Twelve_and_twenty_six_weeks_are_allowed_other_values_and_unknown_parameters_are_refused_and_the_date_range_is_ignored()
    {
        Points(await Mine("trends?weeks=12")).Count.ShouldBe(12);
        Points(await Mine("trends?weeks=26")).Count.ShouldBe(26);
        Points(await Mine("trends?weeks=8&from=2020-01-01&to=2020-02-01")).Count.ShouldBe(8);
        (await A.GetAsync("/api/v1/my-matters/trends?weeks=9")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await A.GetAsync("/api/v1/my-matters/trends?days=14")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task The_scope_and_access_rules_are_those_of_the_other_my_matters_calls()
    {
        // Scope all (a director) includes the matter nobody manages: its overdue task is one more.
        var all = await Mine("trends?scope=all", Director);
        Points(all)[7].GetProperty("created").GetInt32().ShouldBe(9); // the eight tasks of A's matters plus the one of the matter nobody manages
        Points(all)[7].GetProperty("overdueAtWeekEnd").GetInt32().ShouldBe(2);
        (await Director.GetAsync("/api/v1/my-matters/trends")).StatusCode.ShouldBe(HttpStatusCode.OK); // mine for a director: nothing managed
        Points(await Mine("trends", Director)).ShouldAllBe(p => p.GetProperty("created").GetInt32() == 0);

        (await A.GetAsync("/api/v1/my-matters/trends?scope=all")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await Observer.GetAsync("/api/v1/my-matters/trends")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await NoTaskView.GetAsync("/api/v1/my-matters/trends")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }
}
