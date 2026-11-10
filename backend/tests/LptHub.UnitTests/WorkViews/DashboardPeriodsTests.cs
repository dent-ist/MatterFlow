using MatterFlow.SharedKernel.Time;
using MatterFlow.WorkViews.Application.Queries;
using Shouldly;

namespace MatterFlow.UnitTests.WorkViews;

/// <summary>The one Dashboard period vocabulary (P3): keys, month edges, the viewer's zone at fixed instants, custom limits and the old periodDays argument.</summary>
public class DashboardPeriodsTests
{
    private static ResolvedPeriod Ok(string? key, DateOnly today, DateOnly? from = null, DateOnly? to = null, int? days = null)
    {
        var r = DashboardPeriods.Resolve(key, from, to, days, today);
        r.IsFailure.ShouldBeFalse(r.Error?.Message);
        return r.Value;
    }

    private static string Range(ResolvedPeriod p) => $"{DashboardRules.Date(p.From)}..{DashboardRules.Date(p.To)}";

    [Theory]
    [InlineData(null, "2026-09-15..2026-10-14", "30d")]
    [InlineData("7d", "2026-10-08..2026-10-14", "7d")]
    [InlineData("30d", "2026-09-15..2026-10-14", "30d")]
    [InlineData("90d", "2026-07-17..2026-10-14", "90d")]
    [InlineData("this-month", "2026-10-01..2026-10-14", "this-month")]
    [InlineData("last-month", "2026-09-01..2026-09-30", "last-month")]
    [InlineData("6m", "2026-04-15..2026-10-14", "6m")]
    [InlineData("12m", "2025-10-15..2026-10-14", "12m")]
    [InlineData(" 90D ", "2026-07-17..2026-10-14", "90d")]
    public void Each_key_resolves_from_the_viewers_today(string? key, string expected, string resolvedKey)
    {
        var p = Ok(key, new DateOnly(2026, 10, 14));
        Range(p).ShouldBe(expected);
        p.Key.ShouldBe(resolvedKey);
    }

    [Theory]
    [InlineData("2026-01-01", "2026-01-01..2026-01-01", "2025-12-01..2025-12-31")] // the first of the year
    [InlineData("2026-03-01", "2026-03-01..2026-03-01", "2026-02-01..2026-02-28")]
    [InlineData("2028-03-01", "2028-03-01..2028-03-01", "2028-02-01..2028-02-29")] // leap year
    [InlineData("2026-03-31", "2026-03-01..2026-03-31", "2026-02-01..2026-02-28")] // a longer month than the previous one
    [InlineData("2026-12-31", "2026-12-01..2026-12-31", "2026-11-01..2026-11-30")]
    public void Month_edges(string today, string thisMonth, string lastMonth)
    {
        var t = DateOnly.Parse(today);
        Range(Ok("this-month", t)).ShouldBe(thisMonth);
        Range(Ok("last-month", t)).ShouldBe(lastMonth);
    }

    [Theory]
    [InlineData("America/New_York", "2026-11-01T02:30:00Z", "2026-10-01..2026-10-31", "2026-09-01..2026-09-30")] // still October 31 in New York
    [InlineData("Pacific/Kiritimati", "2026-11-01T02:30:00Z", "2026-11-01..2026-11-01", "2026-10-01..2026-10-31")] // already November 1
    [InlineData("Pacific/Pago_Pago", "2026-11-01T02:30:00Z", "2026-10-01..2026-10-31", "2026-09-01..2026-09-30")]
    [InlineData("America/New_York", "2027-01-01T04:59:00Z", "2026-12-01..2026-12-31", "2026-11-01..2026-11-30")] // the last minute of the year in New York
    [InlineData("America/New_York", "2027-01-01T05:00:00Z", "2027-01-01..2027-01-01", "2026-12-01..2026-12-31")]
    [InlineData("Europe/Berlin", "2026-03-29T00:30:00Z", "2026-03-01..2026-03-29", "2026-02-01..2026-02-28")] // spring-forward day
    public void Months_follow_the_viewers_zone_at_a_fixed_instant(string zone, string instant, string thisMonth, string lastMonth)
    {
        var now = DateTime.Parse(instant, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AdjustToUniversal);
        var today = QueueClock.Create(now, UserTimeZone.Resolve(zone)).Today;
        Range(Ok("this-month", today)).ShouldBe(thisMonth);
        Range(Ok("last-month", today)).ShouldBe(lastMonth);
    }

    [Fact]
    public void A_rolling_window_over_a_clock_change_still_counts_calendar_days()
    {
        // New York ends daylight time on 2026-11-01: the 7 days ending 2026-11-03 are Oct 28 to Nov 3, the Nov 1 day is 25 hours long.
        var clock = QueueClock.Create(new DateTime(2026, 11, 3, 15, 0, 0, DateTimeKind.Utc), UserTimeZone.Resolve("America/New_York"));
        var p = Ok("7d", clock.Today);
        Range(p).ShouldBe("2026-10-28..2026-11-03");
        p.Days.ShouldBe(7);
        (clock.StartOfDayUtc(p.From)).ShouldBe(new DateTime(2026, 10, 28, 4, 0, 0, DateTimeKind.Utc));
        (clock.EndOfDayUtc(p.To)).ShouldBe(new DateTime(2026, 11, 4, 5, 0, 0, DateTimeKind.Utc));
    }

    [Fact]
    public void A_custom_range_is_inclusive_and_at_most_366_days()
    {
        var today = new DateOnly(2026, 10, 14);
        var p = Ok("custom", today, new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 3));
        (p.Key, p.Days).ShouldBe(("custom", 3));
        Ok(null, today, new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 1)).Days.ShouldBe(1);
        Ok(null, today, new DateOnly(2025, 10, 14), new DateOnly(2026, 10, 14)).Days.ShouldBe(366);
    }

    [Theory]
    [InlineData("2025-10-13", "2026-10-14", "PERIOD_TOO_LONG")] // 367 days
    [InlineData("2026-10-05", "2026-10-04", "PERIOD_INVALID")]
    [InlineData("2026-10-05", null, "PERIOD_INVALID")]
    [InlineData(null, "2026-10-05", "PERIOD_INVALID")]
    public void A_bad_custom_range_is_rejected(string? from, string? to, string code)
    {
        var r = DashboardPeriods.Resolve(null, from is null ? null : DateOnly.Parse(from), to is null ? null : DateOnly.Parse(to), null, new DateOnly(2026, 10, 14));
        r.IsFailure.ShouldBeTrue();
        r.Error!.FieldErrors!.Values.SelectMany(v => v).Select(f => f.Code).ShouldContain(code);
    }

    [Theory]
    [InlineData("quarter")]
    [InlineData("week")]
    [InlineData("90")]
    public void The_old_front_end_names_are_not_keys(string key) =>
        DashboardPeriods.Resolve(key, null, null, null, new DateOnly(2026, 10, 14)).IsFailure.ShouldBeTrue();

    [Fact]
    public void A_key_together_with_dates_is_ambiguous_and_custom_needs_dates()
    {
        var d = new DateOnly(2026, 10, 1);
        DashboardPeriods.Resolve("90d", d, d, null, d).IsFailure.ShouldBeTrue();
        DashboardPeriods.Resolve("custom", null, null, null, d).IsFailure.ShouldBeTrue();
    }

    [Fact]
    public void The_old_periodDays_argument_still_works_for_one_release_and_the_new_arguments_win()
    {
        var today = new DateOnly(2026, 10, 14);
        Range(Ok(null, today, days: 60)).ShouldBe("2026-08-16..2026-10-14");
        Ok(null, today, days: 90).Key.ShouldBe("90d");
        Ok(null, today, days: 60).Key.ShouldBe("days");
        Range(Ok("7d", today, days: 60)).ShouldBe("2026-10-08..2026-10-14");
    }

    [Fact]
    public void The_drill_through_queries_close_the_period_only_when_it_ended_before_today()
    {
        DashboardRules.Created(new DateOnly(2026, 9, 1)).ShouldBe("createdFrom=2026-09-01");
        DashboardRules.Created(new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30)).ShouldBe("createdFrom=2026-09-01&createdTo=2026-09-30");
        DashboardRules.Completed(new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30)).ShouldBe("status=COMPLETED&completedFrom=2026-09-01&completedTo=2026-09-30");
    }

    private static string PreviousRange(string? key, string today, string? from = null, string? to = null)
    {
        var period = Ok(key, DateOnly.Parse(today), from is null ? null : DateOnly.Parse(from), to is null ? null : DateOnly.Parse(to));
        var previous = DashboardPeriods.Previous(period);
        return $"{previous.Kind} {DashboardRules.Date(previous.From)}..{DashboardRules.Date(previous.To)}";
    }

    [Theory]
    [InlineData("7d", "2026-10-14", "previous 2026-10-01..2026-10-07")]
    [InlineData("30d", "2026-10-14", "previous 2026-08-16..2026-09-14")]
    [InlineData("90d", "2026-10-14", "previous 2026-04-18..2026-07-16")]
    [InlineData("last-month", "2026-10-14", "previous 2026-08-02..2026-08-31")] // September has 30 days: the 30 days before it
    [InlineData("last-month", "2026-03-14", "previous 2026-01-04..2026-01-31")] // February has 28
    [InlineData("12m", "2026-10-14", "previous 2024-10-15..2025-10-14")]
    public void The_previous_period_is_the_same_number_of_days_directly_before(string key, string today, string expected) =>
        PreviousRange(key, today).ShouldBe(expected);

    [Theory]
    [InlineData("2026-10-14", "same-days-last-month 2026-09-01..2026-09-14")]
    [InlineData("2026-10-01", "same-days-last-month 2026-09-01..2026-09-01")]
    [InlineData("2026-03-31", "same-days-last-month 2026-02-01..2026-02-28")] // the month has more days than the last one: never beyond its end
    [InlineData("2028-03-31", "same-days-last-month 2028-02-01..2028-02-29")] // leap year
    [InlineData("2026-01-10", "same-days-last-month 2025-12-01..2025-12-10")] // across the year
    public void This_month_is_compared_with_the_same_days_of_the_last_month(string today, string expected) =>
        PreviousRange("this-month", today).ShouldBe(expected);

    [Fact]
    public void A_custom_period_is_compared_with_the_equal_span_before_it_and_leap_days_count()
    {
        PreviousRange("custom", "2026-10-14", "2026-03-01", "2026-03-10").ShouldBe("previous 2026-02-19..2026-02-28");
        PreviousRange("custom", "2028-03-14", "2028-03-01", "2028-03-10").ShouldBe("previous 2028-02-20..2028-02-29");
        PreviousRange("custom", "2026-10-14", "2025-10-14", "2026-10-14").ShouldBe("previous 2024-10-13..2025-10-13"); // 366 days
    }
}
