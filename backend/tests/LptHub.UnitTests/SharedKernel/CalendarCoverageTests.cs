using LptHub.SharedKernel.Availability;
using Shouldly;

namespace LptHub.UnitTests.SharedKernel;

/// <summary>The coverage maths of the Dashboard Calendar (plan section 3): percent, pod minimum, levels, forecast.</summary>
public class CalendarCoverageTests
{
    private static readonly CoverageThresholds Defaults = CoverageThresholds.Default;

    private static PodDayStat Pod(int id, int expected, int available, int minimum) => new(id, expected, available, minimum);

    [Theory]
    [InlineData(36, 30, 83)]
    [InlineData(6, 6, 100)]
    [InlineData(7, 4, 57)]
    [InlineData(8, 5, 63)]
    public void Coverage_percent_is_available_over_expected_rounded(int expected, int available, int percent) =>
        CalendarCoverage.CoveragePercent(expected, available).ShouldBe(percent);

    [Fact]
    public void Coverage_percent_has_no_division_by_zero() => CalendarCoverage.CoveragePercent(0, 0).ShouldBeNull();

    [Theory]
    [InlineData(10, null, 60, 6)]
    [InlineData(7, null, 60, 5)] // ceil(4.2)
    [InlineData(3, null, 60, 2)]
    [InlineData(10, 4, 60, 4)] // override
    [InlineData(3, 8, 60, 3)] // never more than the people expected
    [InlineData(0, null, 60, 0)]
    public void Pod_minimum_is_the_override_or_the_rounded_up_percent_never_above_expected(int expected, int? overridePeople, int percent, int minimum) =>
        CalendarCoverage.PodMinimum(expected, overridePeople, percent).ShouldBe(minimum);

    [Fact]
    public void Thanksgiving_for_a_us_firm_with_uk_colleagues_is_six_of_six_expected_and_good()
    {
        // 36 people in view, 30 on holiday, 6 UK colleagues all in: coverage 6 of 6 expected, not 6 of 36.
        var level = CalendarCoverage.DayLevel(6, 6, 30, [Pod(1, 6, 6, 4)], Defaults);
        level.ShouldBe(CoverageLevels.Good);
        CalendarCoverage.CoveragePercent(6, 6).ShouldBe(100);
    }

    [Fact]
    public void Levels_follow_the_thresholds()
    {
        CalendarCoverage.DayLevel(20, 20, 0, [Pod(1, 20, 20, 12)], Defaults).ShouldBe(CoverageLevels.Good);
        CalendarCoverage.DayLevel(20, 15, 0, [Pod(1, 20, 15, 12)], Defaults).ShouldBe(CoverageLevels.Good); // exactly 75 percent
        CalendarCoverage.DayLevel(20, 14, 0, [Pod(1, 20, 14, 12)], Defaults).ShouldBe(CoverageLevels.Low); // 70 percent
        CalendarCoverage.DayLevel(20, 12, 0, [Pod(1, 20, 12, 12)], Defaults).ShouldBe(CoverageLevels.Low); // exactly 60 percent is not below the pod percent
        CalendarCoverage.DayLevel(20, 11, 0, [Pod(1, 20, 11, 12)], Defaults).ShouldBe(CoverageLevels.Critical); // 55 percent
    }

    [Fact]
    public void A_pod_below_its_minimum_makes_a_good_day_watch_and_an_empty_pod_makes_it_critical()
    {
        var pods = new[] { Pod(1, 10, 10, 6), Pod(2, 10, 5, 6) }; // firm 15 of 20 = 75 percent, pod 2 below its minimum
        CalendarCoverage.DayLevel(20, 15, 0, pods, Defaults).ShouldBe(CoverageLevels.Watch);
        CalendarCoverage.DayLevel(20, 18, 0, [Pod(1, 18, 18, 11), Pod(2, 2, 0, 2)], Defaults).ShouldBe(CoverageLevels.Critical);
        CalendarCoverage.DayLevel(20, 18, 0, [Pod(1, 18, 18, 11), Pod(2, 0, 0, 0)], Defaults).ShouldBe(CoverageLevels.Good); // a pod with nobody expected is not at zero
    }

    [Fact]
    public void Nobody_expected_is_closed_for_a_holiday_and_non_working_otherwise()
    {
        CalendarCoverage.DayLevel(0, 0, 36, [], Defaults).ShouldBe(CoverageLevels.Closed);
        CalendarCoverage.DayLevel(0, 0, 0, [], Defaults).ShouldBe(CoverageLevels.NonWorking);
    }

    [Fact]
    public void Pod_levels()
    {
        CalendarCoverage.PodLevel(Pod(1, 0, 0, 0), Defaults).ShouldBe(CoverageLevels.Closed);
        CalendarCoverage.PodLevel(Pod(1, 8, 0, 5), Defaults).ShouldBe(CoverageLevels.Critical);
        CalendarCoverage.PodLevel(Pod(1, 8, 8, 5), Defaults).ShouldBe(CoverageLevels.Good);
        CalendarCoverage.PodLevel(Pod(1, 10, 7, 6), Defaults).ShouldBe(CoverageLevels.Watch); // at the minimum but under 75 percent
        CalendarCoverage.PodLevel(Pod(1, 10, 4, 6), Defaults).ShouldBe(CoverageLevels.Low);
        CalendarCoverage.PodLevel(Pod(1, 10, 3, 6), Defaults).ShouldBe(CoverageLevels.Critical); // at or below half the minimum
    }

    [Fact]
    public void Forecast_uses_the_average_available_people_and_all_open_tasks()
    {
        // 4 working days with 10, 10, 8, 8 people (average 9) and 3 slots each = 27 slots; 12 open tasks -> 15/27 = 56 percent.
        var (average, free) = CalendarCoverage.Forecast([10, 10, 8, 8], 12, 3);
        average.ShouldBe(9);
        free.ShouldBe(56);
        CalendarCoverage.Forecast([10, 10], 100, 3).FreePercent.ShouldBe(0); // clamped
        CalendarCoverage.Forecast([0, 0], 5, 3).FreePercent.ShouldBeNull();
        CalendarCoverage.Forecast([], 5, 3).FreePercent.ShouldBeNull();
    }
}
