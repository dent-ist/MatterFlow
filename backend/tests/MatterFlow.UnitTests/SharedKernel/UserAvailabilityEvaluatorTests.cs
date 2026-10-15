using MatterFlow.SharedKernel.Availability;
using Shouldly;

namespace MatterFlow.UnitTests.SharedKernel;

public class UserAvailabilityEvaluatorTests
{
    private const string Ny = "America/New_York";

    private static DateTime Utc(int y, int m, int d, int h = 0, int min = 0) => new(y, m, d, h, min, 0, DateTimeKind.Utc);

    private static UserAvailabilityProfile Available(string zone = Ny) => UserAvailabilityProfile.Default with { ZoneId = zone };

    private static UserAvailabilityProfile Ooo(DateOnly? from, DateOnly? until, string zone = Ny, string? note = "Away") =>
        new(AvailabilityStatuses.OutOfOffice, from, until, note, zone, false, []);

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
        var saturdayOnly = new UserAvailabilityProfile(
            AvailabilityStatuses.Available, null, null, null, Ny, true, [new WorkHourSlot(6, new TimeOnly(10, 0), new TimeOnly(14, 0))]);

        UserAvailabilityEvaluator.Evaluate(saturdayOnly, Utc(2026, 10, 15, 14, 0)).State.ShouldBe(AvailabilityStates.OffHours); // Thursday
        UserAvailabilityEvaluator.Evaluate(saturdayOnly, Utc(2026, 10, 17, 15, 0)).State.ShouldBe(AvailabilityStates.Available); // Saturday 11:00
        UserAvailabilityEvaluator.Evaluate(saturdayOnly, Utc(2026, 10, 15, 14, 0)).NextWorkStartUtc.ShouldBe(Utc(2026, 10, 17, 14, 0));
    }

    [Fact]
    public void A_saved_schedule_without_working_days_is_always_off_hours_with_no_next_start()
    {
        var none = new UserAvailabilityProfile(AvailabilityStatuses.Available, null, null, null, Ny, true, []);

        var result = UserAvailabilityEvaluator.Evaluate(none, Utc(2026, 10, 15, 14, 0));

        result.State.ShouldBe(AvailabilityStates.OffHours);
        result.NextWorkStartUtc.ShouldBeNull();
    }

    [Fact]
    public void Available_status_with_stale_out_of_office_dates_is_not_out_of_office()
    {
        var profile = new UserAvailabilityProfile(AvailabilityStatuses.Available, null, null, null, Ny, false, []);
        UserAvailabilityEvaluator.Evaluate(profile, Utc(2026, 10, 15, 14, 0)).State.ShouldBe(AvailabilityStates.Available);
    }

    [Theory]
    [InlineData(2026, 10, 12, 1)]
    [InlineData(2026, 10, 17, 6)]
    [InlineData(2026, 10, 18, 7)]
    public void Iso_day_numbers_monday_first(int y, int m, int d, int expected) =>
        UserAvailabilityEvaluator.IsoDay(new DateOnly(y, m, d)).ShouldBe(expected);
}
