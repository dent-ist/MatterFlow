using MatterFlow.SharedKernel.Tasks;
using MatterFlow.WorkViews.Application.Queries;
using Shouldly;

namespace MatterFlow.UnitTests.WorkViews;

/// <summary>The At risk rule (PM v2): open, not overdue, a target on the type, and at least 80 percent of it used since creation.</summary>
public class AtRiskRulesTests
{
    private static readonly DateTime Now = new(2026, 10, 26, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void The_fraction_is_eighty_percent_and_a_target_day_is_1152_minutes()
    {
        AtRiskRules.Fraction.ShouldBe(0.8);
        AtRiskRules.MinutesPerTargetDay.ShouldBe((int)(24 * 60 * AtRiskRules.Fraction));
    }

    [Theory]
    [InlineData(3, 4320, true)] // 3 days old, target 3: used 100 percent
    [InlineData(3, 3456, true)] // exactly 80 percent of 3 days
    [InlineData(3, 3455, false)] // one minute under
    [InlineData(1, 1300, true)]
    [InlineData(1, 1000, false)]
    public void At_risk_once_80_percent_of_the_target_is_used(int targetDays, int ageMinutes, bool expected)
    {
        AtRiskRules.IsAtRisk(TaskStatusCode.InProgress, overdue: false, Now.AddMinutes(-ageMinutes), targetDays, Now).ShouldBe(expected);
    }

    [Theory]
    [InlineData(TaskStatusCode.OnHold)]
    [InlineData(TaskStatusCode.Completed)]
    [InlineData(TaskStatusCode.Cancelled)]
    public void Only_New_and_In_Progress_tasks_can_be_at_risk(TaskStatusCode status) =>
        AtRiskRules.IsAtRisk(status, overdue: false, Now.AddDays(-30), 3, Now).ShouldBeFalse();

    [Fact]
    public void An_overdue_task_or_a_type_without_a_target_is_never_at_risk()
    {
        AtRiskRules.IsAtRisk(TaskStatusCode.New, overdue: true, Now.AddDays(-30), 3, Now).ShouldBeFalse();
        AtRiskRules.IsAtRisk(TaskStatusCode.New, overdue: false, Now.AddDays(-30), null, Now).ShouldBeFalse();
        AtRiskRules.IsAtRisk(TaskStatusCode.New, overdue: false, Now.AddDays(-30), 3, Now).ShouldBeTrue();
    }
}
