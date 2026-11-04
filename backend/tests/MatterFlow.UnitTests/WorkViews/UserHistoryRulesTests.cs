using MatterFlow.WorkViews.Application.Queries;
using Shouldly;

namespace MatterFlow.UnitTests.WorkViews;

/// <summary>Dashboard Users person history (issue #1092): the pure rules of medians, ratios, on-time and the month series.</summary>
public class UserHistoryRulesTests
{
    [Fact]
    public void The_median_needs_five_samples()
    {
        UserHistoryRules.Median([]).ShouldBeNull();
        UserHistoryRules.Median([10, 20, 30, 40]).ShouldBeNull();
        UserHistoryRules.Median([50, 10, 40, 20, 30]).ShouldBe(30);
    }

    [Fact]
    public void The_median_of_an_even_sample_is_the_mean_of_the_two_middle_values_rounded_to_one_decimal()
    {
        UserHistoryRules.Median([1, 2, 3, 4, 5, 6]).ShouldBe(3.5);
        UserHistoryRules.Median([1, 2, 2.5, 3, 4, 9.99]).ShouldBe(2.8);
    }

    [Fact]
    public void An_outlier_does_not_move_the_median()
    {
        UserHistoryRules.Median([10, 10, 10, 10, 10000]).ShouldBe(10);
    }

    [Theory]
    [InlineData(60, 30, 2.0)]
    [InlineData(30, 60, 0.5)]
    [InlineData(100, 300, 0.33)]
    public void The_ratio_is_the_person_over_the_firm(double person, double firm, double expected) =>
        UserHistoryRules.Ratio(person, firm).ShouldBe(expected);

    [Fact]
    public void There_is_no_ratio_without_both_medians_or_with_a_zero_firm_median()
    {
        UserHistoryRules.Ratio(null, 30).ShouldBeNull();
        UserHistoryRules.Ratio(30, null).ShouldBeNull();
        UserHistoryRules.Ratio(30, 0).ShouldBeNull();
    }

    [Fact]
    public void On_time_follows_the_trends_rule()
    {
        static DateTime EndOfDay(DateOnly d) => DateTime.SpecifyKind(d.AddDays(1).ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc);
        var due = new DateOnly(2026, 10, 10);
        var at = new DateTime(2026, 10, 10, 15, 0, 0, DateTimeKind.Utc);

        // A due instant: at or before it is on time.
        UserHistoryRules.IsOnTime(at, null, at, EndOfDay).ShouldBe(true);
        UserHistoryRules.IsOnTime(at.AddMinutes(1), null, at, EndOfDay).ShouldBe(false);
        // A due date only: any time on that day is on time, the next day is late.
        UserHistoryRules.IsOnTime(at, due, null, EndOfDay).ShouldBe(true);
        UserHistoryRules.IsOnTime(EndOfDay(due), due, null, EndOfDay).ShouldBe(false);
        // ASAP: not judged.
        UserHistoryRules.IsOnTime(at, null, null, EndOfDay).ShouldBeNull();
    }

    [Fact]
    public void The_month_series_is_twelve_calendar_months_ending_with_the_current_one()
    {
        var starts = UserHistoryRules.MonthStarts(new DateOnly(2026, 11, 3), 12);
        starts.Count.ShouldBe(12);
        UserHistoryRules.MonthKey(starts[0]).ShouldBe("2025-12");
        UserHistoryRules.MonthKey(starts[^1]).ShouldBe("2026-11");
        starts.Select(UserHistoryRules.MonthKey).Distinct().Count().ShouldBe(12);
    }

    [Fact]
    public void The_windows_are_three_and_twelve_months_and_the_experience_thresholds_are_fixed()
    {
        UserHistoryRules.Windows.ShouldBe([3, 12]);
        UserHistoryRules.DefaultWindowMonths.ShouldBe(12);
        UserHistoryRules.MinSampleSize.ShouldBe(5);
        SkillsRules.ExperiencedMin.ShouldBe(5);
        SkillsRules.ThinMax.ShouldBe(2);
    }
}
