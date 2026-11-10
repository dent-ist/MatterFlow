using MatterFlow.SharedKernel.Availability;
using Shouldly;

namespace MatterFlow.UnitTests.SharedKernel;

public class UserAvailabilityEvaluatorTests
{
    private const string Ny = "America/New_York";

    private static DateTime Utc(int y, int m, int d, int h = 0, int min = 0) => new(y, m, d, h, min, 0, DateTimeKind.Utc);

    private static UserAvailabilityProfile Available(string zone = Ny) => UserAvailabilityProfile.Default with { ZoneId = zone };

    private static readonly DateOnly Long_ago = new(2000, 1, 1);

    private static UserAvailabilityProfile Ooo(DateOnly? from, DateOnly? until, string zone = Ny, string? note = "Away") =>
        new([new AbsencePeriod(from ?? Long_ago, until, AbsenceTypes.Vacation, note)], zone, false, [], []);

    // 2026-10-15 is a Thursday (EDT, UTC-4).

    [Fact]
    public void Default_hours_are_available_inside_and_off_hours_outside()
    {
        UserAvailabilityEvaluator.Evaluate(Available(), Utc(2026, 10, 15, 14, 0)).State.ShouldBe(AvailabilityStates.Available); // 10:00 local
        UserAvailabilityEvaluator.Evaluate(Available(), Utc(2026, 10, 15, 13, 0)).State.ShouldBe(AvailabilityStates.Available); // 09:00 local: start is inclusive
        UserAvailabilityEvaluator.Evaluate(Available(), Utc(2026, 10, 15, 12, 59)).State.ShouldBe(AvailabilityStates.OffHours); // 08:59
        UserAvailabilityEvaluator.Evaluate(Available(), Utc(2026, 10, 15, 20, 59)).State.ShouldBe(AvailabilityStates.Available); // 16:59
        UserAvailabilityEvaluator.Evaluate(Available(), Utc(2026, 10, 15, 21, 0)).State.ShouldBe(AvailabilityStates.OffHours); // 17:00: end is exclusive
    }

    [Fact]
    public void Off_hours_reports_the_next_work_start()
    {
        var early = UserAvailabilityEvaluator.Evaluate(Available(), Utc(2026, 10, 15, 11, 0)); // 07:00 Thursday
        early.NextWorkStartUtc.ShouldBe(Utc(2026, 10, 15, 13, 0));

        var evening = UserAvailabilityEvaluator.Evaluate(Available(), Utc(2026, 10, 15, 22, 0)); // 18:00 Thursday
        evening.NextWorkStartUtc.ShouldBe(Utc(2026, 10, 16, 13, 0));

        var friday = UserAvailabilityEvaluator.Evaluate(Available(), Utc(2026, 10, 16, 22, 0)); // Friday 18:00 -> Monday
        friday.State.ShouldBe(AvailabilityStates.OffHours);
        friday.NextWorkStartUtc.ShouldBe(Utc(2026, 10, 19, 13, 0));
    }

    [Fact]
    public void Weekend_is_off_hours()
    {
        UserAvailabilityEvaluator.Evaluate(Available(), Utc(2026, 10, 17, 16, 0)).State.ShouldBe(AvailabilityStates.OffHours); // Saturday noon
        UserAvailabilityEvaluator.Evaluate(Available(), Utc(2026, 10, 18, 16, 0)).State.ShouldBe(AvailabilityStates.OffHours); // Sunday
    }

    [Fact]
    public void Midnight_edges_use_the_users_local_day()
    {
        // Monday 2026-10-19 00:00 local = 04:00Z: off hours, next start 09:00 the same day.
        var atMidnight = UserAvailabilityEvaluator.Evaluate(Available(), Utc(2026, 10, 19, 4, 0));
        atMidnight.State.ShouldBe(AvailabilityStates.OffHours);
        atMidnight.NextWorkStartUtc.ShouldBe(Utc(2026, 10, 19, 13, 0));

        // 23:59 local Sunday = 03:59Z Monday UTC: still Sunday for the user, so off hours although it is Monday in UTC.
        UserAvailabilityEvaluator.Evaluate(Available(), Utc(2026, 10, 19, 3, 59)).State.ShouldBe(AvailabilityStates.OffHours);
    }

    [Fact]
    public void The_users_zone_not_the_firm_zone_decides()
    {
        // 15:00Z is 11:00 in New York but 08:00 in Los Angeles.
        UserAvailabilityEvaluator.Evaluate(Available("America/New_York"), Utc(2026, 10, 15, 15, 0)).State.ShouldBe(AvailabilityStates.Available);
        UserAvailabilityEvaluator.Evaluate(Available("America/Los_Angeles"), Utc(2026, 10, 15, 15, 0)).State.ShouldBe(AvailabilityStates.OffHours);
        UserAvailabilityEvaluator.Evaluate(Available("America/Los_Angeles"), Utc(2026, 10, 15, 16, 0)).State.ShouldBe(AvailabilityStates.Available);
    }

    [Fact]
    public void An_unknown_zone_falls_back_to_the_firm_zone()
    {
        UserAvailabilityEvaluator.Evaluate(Available("Nowhere/Land"), Utc(2026, 10, 15, 14, 0)).State.ShouldBe(AvailabilityStates.Available);
    }

    [Fact]
    public void Out_of_office_without_dates_lasts_until_the_user_changes_it()
    {
        var result = UserAvailabilityEvaluator.Evaluate(Ooo(null, null), Utc(2026, 10, 15, 14, 0));

        result.State.ShouldBe(AvailabilityStates.OutOfOffice);
        result.OutUntilUtc.ShouldBeNull();
        result.Note.ShouldBe("Away");
        result.AbsenceType.ShouldBe(AbsenceTypes.Vacation);
        result.NextWorkStartUtc.ShouldBeNull();
        UserAvailabilityEvaluator.Evaluate(Ooo(null, null), Utc(2030, 1, 1)).State.ShouldBe(AvailabilityStates.OutOfOffice);
    }

    [Fact]
    public void Out_of_office_wins_even_during_work_hours_and_off_hours_are_not_out_of_office()
    {
        UserAvailabilityEvaluator.Evaluate(Ooo(null, null), Utc(2026, 10, 15, 14, 0)).State.ShouldBe(AvailabilityStates.OutOfOffice);
        UserAvailabilityEvaluator.Evaluate(Ooo(null, null), Utc(2026, 10, 17, 14, 0)).State.ShouldBe(AvailabilityStates.OutOfOffice); // weekend too
    }

    [Fact]
    public void Multi_day_range_covers_whole_local_days()
    {
        var profile = Ooo(new DateOnly(2026, 10, 16), new DateOnly(2026, 10, 20));

        UserAvailabilityEvaluator.Evaluate(profile, Utc(2026, 10, 16, 3, 59)).State.ShouldBe(AvailabilityStates.OffHours); // 23:59 on the 15th local: not yet out
        UserAvailabilityEvaluator.Evaluate(profile, Utc(2026, 10, 15, 14, 0)).State.ShouldBe(AvailabilityStates.Available);
        UserAvailabilityEvaluator.Evaluate(profile, Utc(2026, 10, 16, 4, 0)).State.ShouldBe(AvailabilityStates.OutOfOffice); // 00:00 on the 16th
        UserAvailabilityEvaluator.Evaluate(profile, Utc(2026, 10, 21, 3, 59)).State.ShouldBe(AvailabilityStates.OutOfOffice); // 23:59 on the 20th

        var after = UserAvailabilityEvaluator.Evaluate(profile, Utc(2026, 10, 21, 14, 0)); // Wednesday the 21st, 10:00
        after.State.ShouldBe(AvailabilityStates.Available);
    }

    [Fact]
    public void Out_until_is_the_start_of_the_day_after_and_next_work_start_follows()
    {
        var profile = Ooo(null, new DateOnly(2026, 10, 16)); // until Friday

        var result = UserAvailabilityEvaluator.Evaluate(profile, Utc(2026, 10, 15, 14, 0));

        result.OutUntilUtc.ShouldBe(Utc(2026, 10, 17, 4, 0)); // Saturday 00:00 EDT
        result.NextWorkStartUtc.ShouldBe(Utc(2026, 10, 19, 13, 0)); // Monday 09:00 EDT
    }

    [Fact]
    public void Dst_spring_forward_day_is_23_hours_long()
    {
        // 2026-03-08: clocks jump 02:00 -> 03:00 in New York. Out until Mar 7 ends at Mar 8 00:00 EST = 05:00Z.
        var profile = Ooo(null, new DateOnly(2026, 3, 7));
        UserAvailabilityEvaluator.Evaluate(profile, Utc(2026, 3, 8, 4, 59)).State.ShouldBe(AvailabilityStates.OutOfOffice);
        UserAvailabilityEvaluator.Evaluate(profile, Utc(2026, 3, 8, 5, 0)).State.ShouldBe(AvailabilityStates.OffHours); // Sunday

        // Out until Mar 8 ends at Mar 9 00:00 EDT = 04:00Z (23 hours later than the day's start of 05:00Z).
        var sunday = UserAvailabilityEvaluator.Evaluate(Ooo(null, new DateOnly(2026, 3, 8)), Utc(2026, 3, 8, 12, 0));
        sunday.OutUntilUtc.ShouldBe(Utc(2026, 3, 9, 4, 0));
        sunday.NextWorkStartUtc.ShouldBe(Utc(2026, 3, 9, 13, 0)); // Monday 09:00 EDT
    }

    [Fact]
    public void Dst_fall_back_day_is_25_hours_long()
    {
        // 2026-11-01: clocks fall back 02:00 -> 01:00. Out until Oct 31 ends at Nov 1 00:00 EDT = 04:00Z; out until Nov 1 ends Nov 2 00:00 EST = 05:00Z.
        UserAvailabilityEvaluator.Evaluate(Ooo(null, new DateOnly(2026, 10, 31)), Utc(2026, 10, 31, 12, 0)).OutUntilUtc.ShouldBe(Utc(2026, 11, 1, 4, 0));
        var sunday = UserAvailabilityEvaluator.Evaluate(Ooo(null, new DateOnly(2026, 11, 1)), Utc(2026, 11, 1, 12, 0));
        sunday.OutUntilUtc.ShouldBe(Utc(2026, 11, 2, 5, 0));
        sunday.NextWorkStartUtc.ShouldBe(Utc(2026, 11, 2, 14, 0)); // Monday 09:00 EST

        UserAvailabilityEvaluator.Evaluate(Ooo(null, new DateOnly(2026, 11, 1)), Utc(2026, 11, 2, 4, 59)).State.ShouldBe(AvailabilityStates.OutOfOffice);
    }

    [Fact]
    public void Work_hours_across_dst_stay_at_local_wall_clock_time()
    {
        // Monday 09:00 local is 13:00Z in EDT but 14:00Z in EST.
        UserAvailabilityEvaluator.Evaluate(Available(), Utc(2026, 11, 2, 13, 59)).State.ShouldBe(AvailabilityStates.OffHours);
        UserAvailabilityEvaluator.Evaluate(Available(), Utc(2026, 11, 2, 14, 0)).State.ShouldBe(AvailabilityStates.Available);
    }

    [Fact]
    public void Custom_schedule_replaces_the_default_and_a_missing_weekday_is_a_day_off()
    {
        var saturdayOnly = new UserAvailabilityProfile([], Ny, true, [new WorkHourSlot(6, new TimeOnly(10, 0), new TimeOnly(14, 0))], []);

        UserAvailabilityEvaluator.Evaluate(saturdayOnly, Utc(2026, 10, 15, 14, 0)).State.ShouldBe(AvailabilityStates.OffHours); // Thursday
        UserAvailabilityEvaluator.Evaluate(saturdayOnly, Utc(2026, 10, 17, 15, 0)).State.ShouldBe(AvailabilityStates.Available); // Saturday 11:00
        UserAvailabilityEvaluator.Evaluate(saturdayOnly, Utc(2026, 10, 15, 14, 0)).NextWorkStartUtc.ShouldBe(Utc(2026, 10, 17, 14, 0));
    }

    [Fact]
    public void A_saved_schedule_without_working_days_is_always_off_hours_with_no_next_start()
    {
        var none = new UserAvailabilityProfile([], Ny, true, [], []);

        var result = UserAvailabilityEvaluator.Evaluate(none, Utc(2026, 10, 15, 14, 0));

        result.State.ShouldBe(AvailabilityStates.OffHours);
        result.NextWorkStartUtc.ShouldBeNull();
    }

    private static UserAvailabilityProfile Custom(string zone, params WorkHourSlot[] slots) =>
        new([], zone, true, slots, []);

    [Fact]
    public void A_work_start_inside_the_spring_forward_gap_begins_when_the_clock_first_passes_it()
    {
        // Sunday 2026-03-08 in New York: 02:00 -> 03:00. A 02:30 start does not exist; Evaluate shows "available" from the first local time
        // at or after it (03:00 EDT = 07:00Z), and the "next work starts" instant must say the same, not 03:30.
        var sunday = Custom(Ny, new WorkHourSlot(7, new TimeOnly(2, 30), new TimeOnly(10, 0)));
        UserAvailabilityEvaluator.Evaluate(sunday, Utc(2026, 3, 8, 6, 59)).State.ShouldBe(AvailabilityStates.OffHours);
        UserAvailabilityEvaluator.Evaluate(sunday, Utc(2026, 3, 8, 7, 0)).State.ShouldBe(AvailabilityStates.Available);
        UserAvailabilityEvaluator.Evaluate(sunday, Utc(2026, 3, 7, 15, 0)).NextWorkStartUtc.ShouldBe(Utc(2026, 3, 8, 7, 0));
    }

    [Fact]
    public void A_work_start_in_the_fall_back_hour_begins_at_its_first_occurrence()
    {
        // Sunday 2026-11-01 in New York: 02:00 EDT -> 01:00 EST, so 01:30 happens twice (05:30Z and 06:30Z). The first one is when it shows.
        var sunday = Custom(Ny, new WorkHourSlot(7, new TimeOnly(1, 30), new TimeOnly(10, 0)));
        UserAvailabilityEvaluator.Evaluate(sunday, Utc(2026, 11, 1, 5, 29)).State.ShouldBe(AvailabilityStates.OffHours);
        UserAvailabilityEvaluator.Evaluate(sunday, Utc(2026, 11, 1, 5, 30)).State.ShouldBe(AvailabilityStates.Available);
        UserAvailabilityEvaluator.Evaluate(sunday, Utc(2026, 10, 31, 15, 0)).NextWorkStartUtc.ShouldBe(Utc(2026, 11, 1, 5, 30));
    }

    [Fact]
    public void A_half_hour_gap_and_a_quarter_hour_offset_are_handled()
    {
        // Lord Howe (UTC+10:30, +11:00 in summer): on Sunday 2026-10-04 the clock goes 02:00 -> 02:30 (the instant is 15:30Z the day before).
        var lordHowe = Custom("Australia/Lord_Howe", new WorkHourSlot(7, new TimeOnly(2, 15), new TimeOnly(9, 0)));
        UserAvailabilityEvaluator.Evaluate(lordHowe, Utc(2026, 10, 3, 15, 29)).State.ShouldBe(AvailabilityStates.OffHours);
        UserAvailabilityEvaluator.Evaluate(lordHowe, Utc(2026, 10, 3, 15, 30)).State.ShouldBe(AvailabilityStates.Available);
        UserAvailabilityEvaluator.Evaluate(lordHowe, Utc(2026, 10, 2, 12, 0)).NextWorkStartUtc.ShouldBe(Utc(2026, 10, 3, 15, 30));

        // Kathmandu is UTC+05:45 all year: Monday 09:00 local is 03:15Z.
        var kathmandu = Available("Asia/Kathmandu");
        UserAvailabilityEvaluator.Evaluate(kathmandu, Utc(2026, 10, 19, 3, 14)).State.ShouldBe(AvailabilityStates.OffHours);
        UserAvailabilityEvaluator.Evaluate(kathmandu, Utc(2026, 10, 19, 3, 15)).State.ShouldBe(AvailabilityStates.Available);
    }

    [Fact]
    public void Out_of_office_ends_at_the_first_valid_instant_when_midnight_falls_in_a_gap()
    {
        // Havana: on Sunday 2026-03-08 the clock goes 00:00 -> 01:00 (CST -5 -> CDT -4), so the day starts at 01:00 CDT = 05:00Z.
        var result = UserAvailabilityEvaluator.Evaluate(Ooo(null, new DateOnly(2026, 3, 7), "America/Havana"), Utc(2026, 3, 7, 12, 0));
        result.OutUntilUtc.ShouldBe(Utc(2026, 3, 8, 5, 0));
        UserAvailabilityEvaluator.Evaluate(Ooo(null, new DateOnly(2026, 3, 7), "America/Havana"), Utc(2026, 3, 8, 4, 59)).State.ShouldBe(AvailabilityStates.OutOfOffice);
        UserAvailabilityEvaluator.Evaluate(Ooo(null, new DateOnly(2026, 3, 7), "America/Havana"), Utc(2026, 3, 8, 5, 0)).State.ShouldBe(AvailabilityStates.OffHours); // Sunday
    }

    [Fact]
    public void Out_of_office_from_a_day_that_starts_twice_begins_at_the_first_midnight()
    {
        // Havana falls back on Sunday 2026-11-01 at 01:00 CDT -> 00:00 CST, so 00:00 happens twice (04:00Z and 05:00Z): the day starts at the first.
        var profile = Ooo(new DateOnly(2026, 11, 1), new DateOnly(2026, 11, 1), "America/Havana");
        UserAvailabilityEvaluator.Evaluate(profile, Utc(2026, 11, 1, 3, 59)).State.ShouldNotBe(AvailabilityStates.OutOfOffice);
        UserAvailabilityEvaluator.Evaluate(profile, Utc(2026, 11, 1, 4, 0)).State.ShouldBe(AvailabilityStates.OutOfOffice);
    }

    [Theory]
    [InlineData(2026, 10, 12, 1)]
    [InlineData(2026, 10, 17, 6)]
    [InlineData(2026, 10, 18, 7)]
    public void Iso_day_numbers_monday_first(int y, int m, int d, int expected) =>
        UserAvailabilityEvaluator.IsoDay(new DateOnly(y, m, d)).ShouldBe(expected);

    // ----- several periods and holidays (Dashboard Calendar, #1076) -----

    private static AbsencePeriod Period(DateOnly start, DateOnly? end, string type = AbsenceTypes.Vacation) => new(start, end, type);

    private static UserAvailabilityProfile WithPeriods(params AbsencePeriod[] periods) => Available() with { Periods = periods };

    private static HolidayDay Holiday(DateOnly date, string name = "Day off", int calendar = 1, bool everyone = false) =>
        new(date, name, calendar, "US Holiday", "indigo", everyone);

    [Fact]
    public void A_person_with_two_entries_is_out_on_both_and_available_between_them()
    {
        var profile = WithPeriods(Period(new DateOnly(2026, 10, 12), new DateOnly(2026, 10, 13)), Period(new DateOnly(2026, 10, 19), new DateOnly(2026, 10, 20)));

        UserAvailabilityEvaluator.Evaluate(profile, Utc(2026, 10, 12, 15)).State.ShouldBe(AvailabilityStates.OutOfOffice);
        UserAvailabilityEvaluator.Evaluate(profile, Utc(2026, 10, 15, 15)).State.ShouldBe(AvailabilityStates.Available); // Thursday between them
        UserAvailabilityEvaluator.Evaluate(profile, Utc(2026, 10, 20, 15)).State.ShouldBe(AvailabilityStates.OutOfOffice);
        UserAvailabilityEvaluator.Evaluate(profile, Utc(2026, 10, 21, 15)).State.ShouldBe(AvailabilityStates.Available);
        UserAvailabilityEvaluator.Evaluate(profile, Utc(2026, 10, 12, 15)).OutUntilUtc.ShouldBe(Utc(2026, 10, 14, 4, 0)); // the first run ends after the 13th: the 14th is free
    }

    [Fact]
    public void Entries_that_touch_are_one_absence_for_the_return_time()
    {
        var profile = WithPeriods(
            Period(new DateOnly(2026, 10, 12), new DateOnly(2026, 10, 14)),
            Period(new DateOnly(2026, 10, 15), new DateOnly(2026, 10, 16), AbsenceTypes.Sick),
            Period(new DateOnly(2026, 10, 19), new DateOnly(2026, 10, 19)));

        var result = UserAvailabilityEvaluator.Evaluate(profile, Utc(2026, 10, 13, 15));

        result.OutUntilUtc.ShouldBe(Utc(2026, 10, 17, 4, 0)); // through the 16th; the 19th does not touch (17th and 18th are free)
        result.NextWorkStartUtc.ShouldBe(Utc(2026, 10, 19, 13, 0));
    }

    [Fact]
    public void An_open_ended_entry_that_touches_makes_the_absence_open_ended()
    {
        var profile = WithPeriods(Period(new DateOnly(2026, 10, 12), new DateOnly(2026, 10, 14)), Period(new DateOnly(2026, 10, 15), null));

        var result = UserAvailabilityEvaluator.Evaluate(profile, Utc(2026, 10, 13, 15));

        result.State.ShouldBe(AvailabilityStates.OutOfOffice);
        result.OutUntilUtc.ShouldBeNull();
        result.NextWorkStartUtc.ShouldBeNull();
    }

    [Fact]
    public void A_future_entry_does_not_make_the_person_out_today()
    {
        UserAvailabilityEvaluator.Evaluate(WithPeriods(Period(new DateOnly(2026, 10, 20), null)), Utc(2026, 10, 15, 15)).State.ShouldBe(AvailabilityStates.Available);
    }

    [Fact]
    public void A_holiday_is_the_soft_off_hours_state_with_reason_holiday_and_wins_over_out_of_office()
    {
        var thursday = new DateOnly(2026, 10, 15);
        var profile = Available() with { Holidays = [Holiday(thursday)], Periods = [Period(new DateOnly(2026, 10, 14), new DateOnly(2026, 10, 16))] };

        var result = UserAvailabilityEvaluator.Evaluate(profile, Utc(2026, 10, 15, 15));

        result.State.ShouldBe(AvailabilityStates.OffHours);
        result.Reason.ShouldBe(AvailabilityReasons.Holiday);
        result.AbsenceType.ShouldBeNull();
        UserAvailabilityEvaluator.Evaluate(profile, Utc(2026, 10, 16, 15)).State.ShouldBe(AvailabilityStates.OutOfOffice); // the next day is still the entry
    }

    [Fact]
    public void The_next_work_start_skips_a_holiday()
    {
        var profile = Available() with { Holidays = [Holiday(new DateOnly(2026, 10, 16))] };

        var result = UserAvailabilityEvaluator.Evaluate(profile, Utc(2026, 10, 15, 22, 0)); // Thursday 18:00

        result.State.ShouldBe(AvailabilityStates.OffHours);
        result.NextWorkStartUtc.ShouldBe(Utc(2026, 10, 19, 13, 0)); // Friday is a holiday: Monday
    }

    [Fact]
    public void Evaluate_day_orders_weekend_holiday_non_working_out_of_office_available()
    {
        var thursday = new DateOnly(2026, 10, 15);
        var saturday = new DateOnly(2026, 10, 17);
        var profile = Available() with
        {
            Holidays = [Holiday(thursday, "Thanksgiving"), Holiday(saturday, "Saturday holiday")],
            Periods = [Period(new DateOnly(2026, 10, 12), new DateOnly(2026, 10, 18))],
        };

        UserAvailabilityEvaluator.EvaluateDay(profile, new DateOnly(2026, 10, 13)).State.ShouldBe(DayStates.OutOfOffice);
        UserAvailabilityEvaluator.EvaluateDay(profile, new DateOnly(2026, 10, 13)).Period!.Value.Type.ShouldBe(AbsenceTypes.Vacation);
        var holiday = UserAvailabilityEvaluator.EvaluateDay(profile, thursday);
        holiday.State.ShouldBe(DayStates.Holiday); // a holiday wins over the entry that covers it
        holiday.Holidays.Single().Name.ShouldBe("Thanksgiving");
        UserAvailabilityEvaluator.EvaluateDay(profile, saturday).State.ShouldBe(DayStates.Weekend); // a weekend is not a working day whatever else is entered
        UserAvailabilityEvaluator.EvaluateDay(Available(), new DateOnly(2026, 10, 14)).State.ShouldBe(DayStates.Available);
    }

    [Fact]
    public void A_part_timers_day_without_hours_is_non_working_even_inside_an_entry()
    {
        var partTime = Custom(Ny, new WorkHourSlot(1, new TimeOnly(9, 0), new TimeOnly(17, 0)), new WorkHourSlot(2, new TimeOnly(9, 0), new TimeOnly(17, 0))) with
        {
            Periods = [Period(new DateOnly(2026, 10, 12), new DateOnly(2026, 10, 16))],
        };

        UserAvailabilityEvaluator.EvaluateDay(partTime, new DateOnly(2026, 10, 12)).State.ShouldBe(DayStates.OutOfOffice); // Monday
        UserAvailabilityEvaluator.EvaluateDay(partTime, new DateOnly(2026, 10, 14)).State.ShouldBe(DayStates.NonWorking); // Wednesday: no hours
        UserAvailabilityEvaluator.EvaluateDay(partTime, new DateOnly(2026, 10, 17)).State.ShouldBe(DayStates.Weekend);
    }

    [Fact]
    public void A_person_in_another_zone_is_out_by_their_own_local_day()
    {
        var tokyo = WithPeriods(Period(new DateOnly(2026, 10, 16), new DateOnly(2026, 10, 16))) with { ZoneId = "Asia/Tokyo" };

        // 2026-10-15 15:00Z is already 00:00 on the 16th in Tokyo (UTC+9).
        UserAvailabilityEvaluator.Evaluate(tokyo, Utc(2026, 10, 15, 15, 0)).State.ShouldBe(AvailabilityStates.OutOfOffice);
        UserAvailabilityEvaluator.Evaluate(tokyo, Utc(2026, 10, 15, 14, 59)).State.ShouldBe(AvailabilityStates.OffHours);
        UserAvailabilityEvaluator.Evaluate(tokyo, Utc(2026, 10, 16, 15, 0)).State.ShouldNotBe(AvailabilityStates.OutOfOffice);
    }

    [Fact]
    public void Entries_across_a_dst_change_cover_whole_local_days()
    {
        // The fall-back Sunday 2026-11-01 is 25 hours long; an entry on that day alone covers all of it.
        var profile = WithPeriods(Period(new DateOnly(2026, 11, 1), new DateOnly(2026, 11, 1)));
        UserAvailabilityEvaluator.Evaluate(profile, Utc(2026, 11, 1, 4, 0)).State.ShouldBe(AvailabilityStates.OutOfOffice);
        UserAvailabilityEvaluator.Evaluate(profile, Utc(2026, 11, 2, 4, 59)).State.ShouldBe(AvailabilityStates.OutOfOffice);
        UserAvailabilityEvaluator.Evaluate(profile, Utc(2026, 11, 2, 5, 0)).State.ShouldBe(AvailabilityStates.OffHours);
    }
}
