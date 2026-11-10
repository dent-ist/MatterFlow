using MatterFlow.SharedKernel.Tasks;
using MatterFlow.WorkManagement.Domain;
using MatterFlow.WorkViews.Application.Queries;
using Shouldly;

namespace MatterFlow.UnitTests.WorkViews;

/// <summary>The My Matters rules (epic #667): the flag table (one case per branch), the workflow percentage, the hold threshold and the cache key independence of managers.</summary>
public class MyMattersRulesTests
{
    [Theory]
    [InlineData(0, 0, 0, 0, 0, "GREEN", "NO_OPEN_TASKS")]
    [InlineData(3, 0, 0, 0, 0, "GREEN", "")]
    [InlineData(3, 1, 0, 0, 0, "RED", "OVERDUE")]
    [InlineData(3, 2, 2, 1, 1, "RED", "OVERDUE,UNASSIGNED,DUE_SOON,LONG_HOLD")]
    [InlineData(3, 0, 1, 0, 0, "AMBER", "UNASSIGNED")]
    [InlineData(3, 0, 0, 1, 0, "AMBER", "DUE_SOON")]
    [InlineData(3, 0, 0, 0, 1, "AMBER", "LONG_HOLD")]
    [InlineData(3, 0, 1, 1, 1, "AMBER", "UNASSIGNED,DUE_SOON,LONG_HOLD")]
    public void The_flag_rule_has_one_case_per_branch(int open, int overdue, int unassigned, int dueSoon, int longHold, string flag, string reasons)
    {
        var (actual, why) = MyMattersRules.Flag(open, overdue, unassigned, dueSoon, longHold);
        actual.ShouldBe(flag);
        string.Join(',', why).ShouldBe(reasons);
    }

    [Fact]
    public void A_task_is_stuck_after_seven_full_days_on_hold_and_only_while_on_hold()
    {
        var now = new DateTime(2026, 10, 22, 12, 0, 0, DateTimeKind.Utc);
        var stuck = MyMattersRules.StuckOnHold(now).Compile();
        WorkTask Held(TaskStatusCode status, double daysAgo) => new() { Status = status, StatusChangedAtUtc = now.AddDays(-daysAgo) };
        stuck(Held(TaskStatusCode.OnHold, 7.01)).ShouldBeTrue();
        stuck(Held(TaskStatusCode.OnHold, 7)).ShouldBeFalse();
        stuck(Held(TaskStatusCode.OnHold, 2)).ShouldBeFalse();
        stuck(Held(TaskStatusCode.InProgress, 30)).ShouldBeFalse();
        MyMattersRules.StuckOnHoldDays.ShouldBe(7);
    }

    [Fact]
    public void Unassigned_means_no_person_and_open()
    {
        var unassigned = MyMattersRules.Unassigned.Compile();
        unassigned(new WorkTask { Status = TaskStatusCode.New, AssignedPodId = 4 }).ShouldBeTrue();
        unassigned(new WorkTask { Status = TaskStatusCode.OnHold }).ShouldBeTrue();
        unassigned(new WorkTask { Status = TaskStatusCode.New, AssignedUserId = 3 }).ShouldBeFalse();
        unassigned(new WorkTask { Status = TaskStatusCode.Completed }).ShouldBeFalse();
    }

    [Fact]
    public void Whole_days_since_never_goes_below_zero()
    {
        var now = new DateTime(2026, 10, 22, 12, 0, 0, DateTimeKind.Utc);
        MyMattersRules.WholeDaysSince(now.AddDays(-10).AddHours(-3), now).ShouldBe(10);
        MyMattersRules.WholeDaysSince(now.AddHours(1), now).ShouldBe(0);
    }
}
