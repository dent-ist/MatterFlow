using System.Net;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// GET /my-matters/deadlines?groupBy=day|matter (epic #758, PX-07, #765): the calendar buckets and the matters with their next deadlines. Every count equals the Task Queue list its query
/// opens, the viewer's day decides the bucket, weekends are in, and the flat list of #681 is unchanged when groupBy is absent.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class MyMattersDeadlinesGroupedTests(SqlServerFixture sql) : MyMattersTestBase(sql)
{
    private static List<JsonElement> Days(JsonElement answer) => [.. answer.GetProperty("byDay").EnumerateArray()];

    private static List<JsonElement> Matters(JsonElement answer) => [.. answer.GetProperty("byMatter").EnumerateArray()];

    [Fact]
    public async Task The_day_grouping_has_every_day_of_the_window_with_counts_that_equal_their_task_queue_lists()
    {
        var d = await Mine("deadlines?groupBy=day");
        d.GetProperty("groupBy").GetString().ShouldBe("day");
        d.GetProperty("items").GetArrayLength().ShouldBe(0); // the flat list is not repeated
        d.TryGetProperty("byMatter", out var none).ShouldBeTrue();
        none.ValueKind.ShouldBe(JsonValueKind.Null);

        var days = Days(d);
        days.Count.ShouldBe(15); // today and the next 14 days
        var today = DateOnly.Parse(d.GetProperty("fromDate").GetString()!);
        days.Select(x => DateOnly.Parse(x.GetProperty("date").GetString()!)).ShouldBe(Enumerable.Range(0, 15).Select(today.AddDays));
        days[0].GetProperty("isToday").GetBoolean().ShouldBeTrue();
        days.Skip(1).ShouldAllBe(x => !x.GetProperty("isToday").GetBoolean());
        foreach (var day in days)
        {
            var weekday = DateOnly.Parse(day.GetProperty("date").GetString()!).DayOfWeek;
            day.GetProperty("isWeekend").GetBoolean().ShouldBe(weekday == DayOfWeek.Saturday || weekday == DayOfWeek.Sunday);
        }

        // m1-soon is due in 2 days, m2-in5 in 5; nothing else of A's is open, not overdue and dated inside the window.
        d.GetProperty("total").GetInt32().ShouldBe(2);
        days.Select(x => x.GetProperty("count").GetInt32()).ToList().ShouldBe([0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        Titles(days[2].GetProperty("items")).ShouldBe(["m1-soon"]);
        Titles(days[5].GetProperty("items")).ShouldBe(["m2-in5"]);
        days[0].GetProperty("items").GetArrayLength().ShouldBe(0);

        // Every bucket's query lists exactly the counted tasks, the empty ones too.
        foreach (var day in days)
            (await TotalAsync(A, "task-queue", day.GetProperty("query").GetString()!)).ShouldBe(day.GetProperty("count").GetInt32(), day.GetProperty("date").GetString());
    }

    [Fact]
    public async Task A_busy_day_shows_its_first_five_tasks_and_counts_all_of_them()
    {
        for (var i = 0; i < 7; i++)
            await MakeAsync($"busy-{i}", M6, new() { ["dueDate"] = In(3) });
        await MakeAsync("busy-timed", M6, new() { ["dueDate"] = In(3), ["dueAt"] = DateTime.UtcNow.AddDays(3).ToString("yyyy-MM-ddT23:00:00Z") });

        var d = await Mine("deadlines?groupBy=day");
        var day = Days(d)[3];
        day.GetProperty("count").GetInt32().ShouldBe(8);
        day.GetProperty("items").GetArrayLength().ShouldBe(5);
        (await TotalAsync(A, "task-queue", day.GetProperty("query").GetString()!)).ShouldBe(8);
        d.GetProperty("total").GetInt32().ShouldBe(10);

        // The window can be four weeks; the calendar then has 29 days.
        Days(await Mine("deadlines?groupBy=day&days=28")).Count.ShouldBe(29);
    }

    [Fact]
    public async Task The_matter_grouping_lists_the_matters_with_the_soonest_deadline_first_and_their_next_tasks()
    {
        for (var i = 0; i < 6; i++)
            await MakeAsync($"m6-{i}", M6, new() { ["dueDate"] = In(1 + i) });

        var d = await Mine("deadlines?groupBy=matter");
        d.GetProperty("groupBy").GetString().ShouldBe("matter");
        d.GetProperty("items").GetArrayLength().ShouldBe(0);
        d.GetProperty("matterTotal").GetInt32().ShouldBe(3);
        d.GetProperty("total").GetInt32().ShouldBe(8);

        var matters = Matters(d);
        matters.Select(m => m.GetProperty("matterId").GetInt32()).ShouldBe([M6, M1, M2]); // M6 has a task due tomorrow, M1 in 2 days, M2 in 5
        var m6 = matters[0];
        m6.GetProperty("total").GetInt32().ShouldBe(6);
        Titles(m6.GetProperty("items")).ShouldBe(["m6-0", "m6-1", "m6-2", "m6-3", "m6-4"]); // soonest first, five of six
        m6.GetProperty("nextDueDate").GetString().ShouldBe(In(1));
        m6.GetProperty("matterRef").GetString().ShouldNotBeNullOrEmpty();
        m6.GetProperty("clientName").GetString().ShouldStartWith("Acme");
        Titles(matters[1].GetProperty("items")).ShouldBe(["m1-soon"]);
        Titles(matters[2].GetProperty("items")).ShouldBe(["m2-in5"]);

        foreach (var m in matters)
            (await TotalAsync(A, "task-queue", m.GetProperty("query").GetString()!)).ShouldBe(m.GetProperty("total").GetInt32(), m.GetProperty("matterRef").GetString());
    }

    [Fact]
    public async Task The_scope_the_date_range_and_the_bad_values_work_as_for_the_flat_list()
    {
        // B manages M2 (Primary) and M4 (Secondary): m2-in5 is theirs; the All scope adds A's matters; a person who manages nothing has empty buckets.
        Matters(await Mine("deadlines?groupBy=matter", B)).Select(m => m.GetProperty("matterId").GetInt32()).ShouldBe([M2]);
        Matters(await Mine("deadlines?groupBy=matter&scope=all", Director)).Select(m => m.GetProperty("matterId").GetInt32()).ShouldBe([M1, M2]);
        var none = await Mine("deadlines?groupBy=day", Director);
        none.GetProperty("total").GetInt32().ShouldBe(0);
        Days(none).ShouldAllBe(x => x.GetProperty("count").GetInt32() == 0);
        var noMatters = await Mine("deadlines?groupBy=matter", Director);
        noMatters.GetProperty("matterTotal").GetInt32().ShouldBe(0);
        Matters(noMatters).ShouldBeEmpty();

        // A date range narrows the buckets and a bucket's link does not repeat the range keys.
        var ranged = await Mine($"deadlines?groupBy=day&days=28&from={In(4)}");
        ranged.GetProperty("total").GetInt32().ShouldBe(1);
        var withTask = Days(ranged).Single(x => x.GetProperty("count").GetInt32() == 1);
        var query = withTask.GetProperty("query").GetString()!;
        query.Split('&').Count(p => p.StartsWith("dueFrom=", StringComparison.Ordinal)).ShouldBe(1);
        (await TotalAsync(A, "task-queue", query)).ShouldBe(1);

        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/deadlines?groupBy=week"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        (await Mine("deadlines")).TryGetProperty("byDay", out var absent).ShouldBeTrue();
        absent.ValueKind.ShouldBe(JsonValueKind.Null);
    }
}
