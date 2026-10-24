using MatterFlow.WorkViews.Application.Queries;
using Shouldly;

namespace MatterFlow.UnitTests.WorkViews;

/// <summary>The week arithmetic of My Matters trends (epic #758, PX-09): weeks are the viewer's, "overdue at week end" is derived and approximate.</summary>
public sealed class MyMattersTrendRulesTests
{
    private static readonly DateTime Start = new(2026, 3, 2, 0, 0, 0, DateTimeKind.Utc); // a Monday

    private static DateTime[] Edges(int weeks) => [.. Enumerable.Range(0, weeks + 1).Select(i => Start.AddDays(7 * i))];

    private static DateTime StartOfDay(DateOnly d) => DateTime.SpecifyKind(d.ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc);

    [Fact]
    public void Instants_are_counted_in_the_week_that_holds_them_and_the_edges_belong_to_the_later_week()
    {
        var counts = MyMattersTrendRules.CountPerWeek([Start, Start.AddDays(6.5), Start.AddDays(7), Start.AddDays(20), Start.AddSeconds(-1), Start.AddDays(28)], Edges(4));
        counts.ShouldBe([2, 1, 1, 0]);
    }

    [Fact]
    public void A_task_is_overdue_from_the_end_of_its_due_day_until_it_is_closed()
    {
        // Due on Wednesday of week 1 (index 0): overdue at the end of weeks 1, 2 (index 0, 1) and closed during week 3.
        var open = new MyMattersTrendRules.DatedTask(Start.AddDays(-30), null, new DateOnly(2026, 3, 4), true, Start.AddDays(15));
        MyMattersTrendRules.OverdueAtWeekEnd([open], Edges(4), Start.AddDays(40), StartOfDay).ShouldBe([1, 1, 0, 0]);

        // Still open: overdue at the end of every week from the first.
        var still = open with { Closed = false };
        MyMattersTrendRules.OverdueAtWeekEnd([still], Edges(4), Start.AddDays(40), StartOfDay).ShouldBe([1, 1, 1, 1]);
    }

    [Fact]
    public void A_task_created_after_its_due_date_counts_from_the_week_it_was_created_and_a_future_task_does_not_count_yet()
    {
        var late = new MyMattersTrendRules.DatedTask(Start.AddDays(9), null, new DateOnly(2026, 3, 1), false, Start.AddDays(9));
        var future = new MyMattersTrendRules.DatedTask(Start.AddDays(-5), null, new DateOnly(2026, 3, 25), false, Start.AddDays(-5));
        MyMattersTrendRules.OverdueAtWeekEnd([late, future], Edges(4), Start.AddDays(40), StartOfDay).ShouldBe([0, 1, 1, 2]);
    }

    [Fact]
    public void The_current_week_is_judged_at_now_and_a_timed_due_uses_its_instant()
    {
        var now = Start.AddDays(10); // Thursday of the second week
        var passed = new MyMattersTrendRules.DatedTask(Start.AddDays(-3), Start.AddDays(9), null, false, Start.AddDays(-3));
        var notYet = new MyMattersTrendRules.DatedTask(Start.AddDays(-3), Start.AddDays(11), null, false, Start.AddDays(-3));
        MyMattersTrendRules.OverdueAtWeekEnd([passed, notYet], Edges(2), now, StartOfDay).ShouldBe([0, 1]);
    }

    [Fact]
    public void Tasks_without_a_due_moment_are_never_overdue()
    {
        MyMattersTrendRules.OverdueAtWeekEnd([new(Start.AddDays(-3), null, null, false, Start)], Edges(2), Start.AddDays(20), StartOfDay).ShouldBe([0, 0]);
    }
}
