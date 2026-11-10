using System.Net;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// GET /my-matters/calendar (epic #893, issue #944): one month of the Overview's Calendar. Every day of the month is there, a day's count equals the Task Queue list its query opens, overdue tasks
/// sit on their own due dates (past months too), and the Matter, pre-filter and Focus narrow it.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class MyMattersCalendarTests(SqlServerFixture sql) : MyMattersTestBase(sql)
{
    private static List<JsonElement> Days(JsonElement answer) => [.. answer.GetProperty("days").EnumerateArray()];

    private static string MonthOf(string day) => day[..7];

    private static JsonElement Day(JsonElement answer, string date) => Days(answer).Single(d => d.GetProperty("date").GetString() == date);

    [Fact]
    public async Task A_month_has_every_day_with_counts_that_equal_their_task_queue_lists()
    {
        var month = MonthOf(In(2));
        var c = await Mine($"calendar?month={month}");
        c.GetProperty("month").GetString().ShouldBe(month);
        var days = Days(c);
        var first = DateOnly.Parse(month + "-01");
        days.Count.ShouldBe(DateTime.DaysInMonth(first.Year, first.Month));
        days.Select(d => DateOnly.Parse(d.GetProperty("date").GetString()!)).ShouldBe(Enumerable.Range(0, days.Count).Select(first.AddDays));

        // m1-soon (+2) and m2-in5 (+5) sit on their dates when those fall in the month.
        var soon = Day(c, In(2));
        Titles(soon.GetProperty("items")).ShouldContain("m1-soon");
        soon.GetProperty("items")[0].GetProperty("factCode").GetString().ShouldNotBe("OVERDUE");

        foreach (var day in days)
            (await TotalAsync(A, "task-queue", day.GetProperty("query").GetString()!)).ShouldBe(day.GetProperty("count").GetInt32(), day.GetProperty("date").GetString());
    }

    [Fact]
    public async Task An_overdue_task_sits_on_its_own_due_date_in_a_past_month_and_says_so()
    {
        var c = await Mine("calendar?month=2000-01");
        var day = Day(c, "2000-01-01");
        day.GetProperty("count").GetInt32().ShouldBe(1);
        var item = day.GetProperty("items")[0];
        item.GetProperty("title").GetString().ShouldBe("m1-overdue");
        item.GetProperty("factCode").GetString().ShouldBe("OVERDUE");
        c.GetProperty("total").GetInt32().ShouldBe(1);
        c.GetProperty("overdue").GetInt32().ShouldBe(1);
        (await TotalAsync(A, "task-queue", day.GetProperty("query").GetString()!)).ShouldBe(1);

        // M3 is nobody's: its overdue task is in no manager's calendar.
        Days(c).Sum(d => d.GetProperty("count").GetInt32()).ShouldBe(1);
    }

    [Fact]
    public async Task The_matter_the_pre_filter_and_the_focus_narrow_the_month_and_the_day_links_with_it()
    {
        var m2 = await Mine($"calendar?month={MonthOf(In(5))}&matterId={M2}");
        Days(m2).SelectMany(d => Titles(d.GetProperty("items"))).ShouldAllBe(t => t.StartsWith("m2-"));
        var m1 = await Mine($"calendar?month={MonthOf(In(5))}&matterId={M1}");
        Days(m1).SelectMany(d => Titles(d.GetProperty("items"))).ShouldAllBe(t => t.StartsWith("m1-"));
        foreach (var day in Days(m2).Concat(Days(m1)))
            (await TotalAsync(A, "task-queue", day.GetProperty("query").GetString()!)).ShouldBe(day.GetProperty("count").GetInt32(), "matter " + day.GetProperty("date").GetString());

        // The pre-filter: only the overdue task of the past month; an empty month for Unassigned dated tasks of another month.
        var overdue = await Mine("calendar?month=2000-01&show=overdue");
        overdue.GetProperty("total").GetInt32().ShouldBe(1);
        var onlyDueSoon = await Mine("calendar?month=2000-01&show=dueSoon");
        onlyDueSoon.GetProperty("total").GetInt32().ShouldBe(0);
        foreach (var show in new[] { "overdue", "atRisk", "unassigned", "dueSoon", "onHold" })
        {
            var s = await Mine($"calendar?month={MonthOf(In(2))}&show={show}");
            foreach (var day in Days(s))
                (await TotalAsync(A, "task-queue", day.GetProperty("query").GetString()!)).ShouldBe(day.GetProperty("count").GetInt32(), show + " " + day.GetProperty("date").GetString());
        }

        // The Focus: the fixture's tasks have the world's type; another type leaves none.
        (await Mine($"calendar?month=2000-01&taskTypeId={W.TaskTypeId}")).GetProperty("total").GetInt32().ShouldBe(1);
        (await Mine($"calendar?month=2000-01&taskTypeId={W.TaskTypeId + 1000}")).GetProperty("total").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task A_bad_month_or_pre_filter_is_a_400_and_the_permissions_are_the_summarys()
    {
        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/calendar?month=2026-13"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/calendar?month=October"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/calendar?show=everything"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/calendar?unknown=1"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await Observer.GetAsync("/api/v1/my-matters/calendar"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/calendar?scope=all"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        // No month: the month of today.
        var now = await Mine("calendar");
        now.GetProperty("month").GetString().ShouldBe(MonthOf(now.GetProperty("today").GetString()!));
    }
}
