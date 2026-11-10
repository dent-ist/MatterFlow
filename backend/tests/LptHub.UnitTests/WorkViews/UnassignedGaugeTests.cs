using LptHub.Configuration.Contracts;
using LptHub.SharedKernel.Time;
using LptHub.WorkViews.Application.Queries;
using Shouldly;

namespace LptHub.UnitTests.WorkViews;

/// <summary>Dashboard v4 (issue #1064): working-time age in the firm zone, and the one gauge level function.</summary>
public class UnassignedGaugeTests
{
    private static readonly TimeZoneInfo NewYork = UserTimeZone.Resolve("America/New_York").Zone;
    private static readonly DashboardGaugeSettings Working = DashboardGaugeSettings.Default;
    private static readonly DashboardGaugeSettings Clock = Working with { AgeBasis = GaugeAgeBasis.Clock };

    /// <summary>A New York wall-clock time as a UTC instant.</summary>
    private static DateTime Ny(int year, int month, int day, int hour, int minute = 0) =>
        TimeZoneInfo.ConvertTimeToUtc(new DateTime(year, month, day, hour, minute, 0, DateTimeKind.Unspecified), NewYork);

    [Fact]
    public void Friday_555_pm_to_Monday_805_am_is_ten_working_minutes()
    {
        // 2026-10-09 is a Friday, 2026-10-12 a Monday.
        WorkingTime.Minutes(Ny(2026, 10, 9, 17, 55), Ny(2026, 10, 12, 8, 5), Working, NewYork).ShouldBe(10);
    }

    [Fact]
    public void The_clock_basis_counts_every_minute_over_the_same_span()
    {
        var from = Ny(2026, 10, 9, 17, 55);
        var to = Ny(2026, 10, 12, 8, 5);
        WorkingTime.Minutes(from, to, Clock, NewYork).ShouldBe((int)(to - from).TotalMinutes);
    }

    [Fact]
    public void A_full_working_day_is_ten_hours_and_nights_do_not_count()
    {
        WorkingTime.Minutes(Ny(2026, 10, 7, 0, 0), Ny(2026, 10, 8, 0, 0), Working, NewYork).ShouldBe(600);
        WorkingTime.Minutes(Ny(2026, 10, 7, 18, 0), Ny(2026, 10, 8, 8, 0), Working, NewYork).ShouldBe(0);
        WorkingTime.Minutes(Ny(2026, 10, 7, 12, 0), Ny(2026, 10, 7, 13, 30), Working, NewYork).ShouldBe(90);
    }

    [Fact]
    public void Weekends_do_not_count_and_a_week_is_fifty_hours()
    {
        WorkingTime.Minutes(Ny(2026, 10, 10, 0, 0), Ny(2026, 10, 12, 0, 0), Working, NewYork).ShouldBe(0); // Saturday and Sunday
        WorkingTime.Minutes(Ny(2026, 10, 5, 0, 0), Ny(2026, 10, 12, 0, 0), Working, NewYork).ShouldBe(5 * 600);
    }

    [Fact]
    public void Custom_hours_and_days_are_used()
    {
        var saturdays = Working with { WorkDays = [6], WorkdayStart = new TimeOnly(9, 0), WorkdayEnd = new TimeOnly(13, 0) };
        WorkingTime.Minutes(Ny(2026, 10, 9, 0, 0), Ny(2026, 10, 12, 0, 0), saturdays, NewYork).ShouldBe(240);
    }

    [Fact]
    public void A_daylight_saving_week_counts_the_real_working_minutes()
    {
        // Fall back on Sunday 2026-11-01 and spring forward on Sunday 2026-03-08 (New York): with every day a working day the 8 AM to 6 PM window is still ten hours, the long and short night are outside it.
        var everyDay = Working with { WorkDays = [1, 2, 3, 4, 5, 6, 7] };
        WorkingTime.Minutes(Ny(2026, 10, 31, 8, 0), Ny(2026, 11, 2, 18, 0), everyDay, NewYork).ShouldBe(3 * 600);
        WorkingTime.Minutes(Ny(2026, 3, 7, 8, 0), Ny(2026, 3, 9, 18, 0), everyDay, NewYork).ShouldBe(3 * 600);
        // A window that includes the changing hour is 25 / 23 hours long on the clock basis.
        var overnight = Working with { WorkdayStart = new TimeOnly(0, 0), WorkdayEnd = new TimeOnly(23, 59), WorkDays = [1, 2, 3, 4, 5, 6, 7] };
        WorkingTime.Minutes(Ny(2026, 11, 1, 0, 0), Ny(2026, 11, 2, 0, 0), overnight, NewYork).ShouldBe(25 * 60 - 1);
        WorkingTime.Minutes(Ny(2026, 3, 8, 0, 0), Ny(2026, 3, 9, 0, 0), overnight, NewYork).ShouldBe(23 * 60 - 1);
    }

    [Fact]
    public void An_end_before_the_start_is_zero()
    {
        WorkingTime.Minutes(Ny(2026, 10, 8, 12, 0), Ny(2026, 10, 8, 11, 0), Working, NewYork).ShouldBe(0);
        WorkingTime.Minutes(Ny(2026, 10, 8, 12, 0), Ny(2026, 10, 8, 12, 0), Clock, NewYork).ShouldBe(0);
    }

    [Theory]
    [InlineData(0, 0, 0)] // nothing unassigned: all clear whatever the age
    [InlineData(1, 0, 0)]
    [InlineData(1, 59, 0)]
    [InlineData(1, 60, 1)]
    [InlineData(1, 120, 2)]
    [InlineData(1, 180, 3)]
    [InlineData(1, 240, 4)]
    [InlineData(1, 299, 4)]
    [InlineData(1, 300, 5)]
    [InlineData(1, 5000, 5)]
    [InlineData(4, 0, 0)]
    [InlineData(5, 0, 1)] // 5 tasks add one level
    [InlineData(10, 0, 2)]
    [InlineData(50, 0, 2)] // capped at +2
    [InlineData(10, 180, 5)] // 3 h plus 10 tasks = 5
    [InlineData(50, 5000, 5)] // total capped at 5
    [InlineData(5, 120, 3)]
    public void The_level_follows_the_age_steps_plus_the_count_bonus(int count, int ageMinutes, int expected)
    {
        UnassignedGaugeRules.Level(count, ageMinutes, Working).ShouldBe(expected);
    }

    [Fact]
    public void The_level_steps_are_configurable()
    {
        var settings = Working with { LevelHours = [2, 4, 6, 8, 10], TasksPerLevel = 3, CountBonusMax = 1 };
        UnassignedGaugeRules.Level(1, 119, settings).ShouldBe(0);
        UnassignedGaugeRules.Level(1, 120, settings).ShouldBe(1);
        UnassignedGaugeRules.Level(3, 0, settings).ShouldBe(1);
        UnassignedGaugeRules.Level(30, 0, settings).ShouldBe(1);
    }

    [Fact]
    public void The_unassigned_since_sort_puts_the_longest_waiting_first_and_assigned_tasks_after()
    {
        var t = new DateTime(2026, 10, 14, 12, 0, 0, DateTimeKind.Utc);
        var rows = new[]
        {
            new TaskSortRow { Id = 1, UnassignedSinceUtc = t.AddHours(-1) },
            new TaskSortRow { Id = 2, UnassignedSinceUtc = null },
            new TaskSortRow { Id = 3, UnassignedSinceUtc = t.AddHours(-30) },
            new TaskSortRow { Id = 4, UnassignedSinceUtc = t.AddHours(-5) },
        }.AsQueryable();

        TaskQueueRules.SortFields.ShouldContain(TaskQueueRules.SortUnassignedSince);
        TaskQueueRules.Order(rows, TaskQueueRules.SortUnassignedSince, false).Select(r => r.Id).ToList().ShouldBe([3, 4, 1, 2]);
        TaskQueueRules.Order(rows, TaskQueueRules.SortUnassignedSince, true).Select(r => r.Id).ToList().ShouldBe([1, 4, 3, 2]);
    }
}
