using MatterFlow.SharedKernel.Time;
using Shouldly;

namespace MatterFlow.UnitTests.SharedKernel;

public class DueDatesTests
{
    private static readonly TimeZoneInfo NewYork = UserTimeZone.Resolve("America/New_York").Zone;
    private static readonly TimeZoneInfo LosAngeles = UserTimeZone.Resolve("America/Los_Angeles").Zone;
    private static readonly TimeZoneInfo Tokyo = UserTimeZone.Resolve("Asia/Tokyo").Zone;

    private static DateTime Utc(int y, int m, int d, int h = 0, int min = 0, int s = 0) => new(y, m, d, h, min, s, DateTimeKind.Utc);

    [Fact]
    public void Asap_is_never_overdue()
    {
        DueDates.IsOverdue(null, null, Utc(2099, 1, 1), NewYork).ShouldBeFalse();
        DueDates.IsOverdue(null, null, DateTime.MaxValue.AddDays(-2), Tokyo).ShouldBeFalse();
    }

    [Fact]
    public void Date_only_is_not_overdue_through_23_59_59_local_and_overdue_after()
    {
        var due = new DateOnly(2026, 10, 14);

        // 23:59:59 EDT on Oct 14 = 03:59:59Z Oct 15
        DueDates.IsOverdue(due, null, Utc(2026, 10, 15, 3, 59, 59), NewYork).ShouldBeFalse();
        // 00:00:00 EDT on Oct 15
        DueDates.IsOverdue(due, null, Utc(2026, 10, 15, 4, 0, 0), NewYork).ShouldBeTrue();
        // earlier on the due day
        DueDates.IsOverdue(due, null, Utc(2026, 10, 14, 12, 0, 0), NewYork).ShouldBeFalse();
    }

    [Fact]
    public void Date_only_is_judged_in_the_viewers_zone_so_two_viewers_can_disagree()
    {
        var due = new DateOnly(2026, 10, 14);
        var now = Utc(2026, 10, 15, 5, 0, 0); // 01:00 Oct 15 in New York, 22:00 Oct 14 in Los Angeles, 14:00 Oct 15 in Tokyo

        DueDates.IsOverdue(due, null, now, NewYork).ShouldBeTrue();
        DueDates.IsOverdue(due, null, now, LosAngeles).ShouldBeFalse();
        DueDates.IsOverdue(due, null, now, Tokyo).ShouldBeTrue();
    }

    [Fact]
    public void Timed_due_is_an_absolute_instant_and_identical_for_every_viewer()
    {
        var due = new DateOnly(2026, 10, 14);
        var instant = Utc(2026, 10, 14, 18, 0, 0);

        foreach (var zone in new[] { NewYork, LosAngeles, Tokyo })
        {
            DueDates.IsOverdue(due, instant, instant, zone).ShouldBeFalse(); // exactly at the instant
            DueDates.IsOverdue(due, instant, instant.AddSeconds(1), zone).ShouldBeTrue();
            DueDates.IsOverdue(due, instant, instant.AddSeconds(-1), zone).ShouldBeFalse();
        }
    }

    [Fact]
    public void Timed_due_takes_precedence_over_the_date_part()
    {
        // The date says Oct 14 but the instant is earlier on Oct 14 UTC; the instant wins.
        var overdue = DueDates.IsOverdue(new DateOnly(2026, 10, 14), Utc(2026, 10, 14, 1, 0, 0), Utc(2026, 10, 14, 2, 0, 0), NewYork);

        overdue.ShouldBeTrue();
    }

    [Theory]
    // Spring forward: 2026-03-08 is a 23-hour day in New York (EST -> EDT at 02:00).
    [InlineData("2026-03-08", "2026-03-09T03:59:59Z", false)] // 23:59:59 EDT on Mar 8
    [InlineData("2026-03-08", "2026-03-09T04:00:00Z", true)] // 00:00:00 EDT on Mar 9
    [InlineData("2026-03-08", "2026-03-08T04:59:59Z", false)] // 23:59:59 EST on Mar 7
    // Fall back: 2026-11-01 is a 25-hour day in New York (EDT -> EST at 02:00).
    [InlineData("2026-11-01", "2026-11-02T04:59:59Z", false)] // 23:59:59 EST on Nov 1
    [InlineData("2026-11-01", "2026-11-02T05:00:00Z", true)] // 00:00:00 EST on Nov 2
    [InlineData("2026-11-01", "2026-11-01T05:30:00Z", false)] // 01:30 EST (second pass of the repeated hour)
    public void Date_only_overdue_boundary_is_correct_across_dst_changes(string dueDate, string nowUtc, bool expected)
    {
        var now = DateTime.Parse(nowUtc, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AdjustToUniversal);

        DueDates.IsOverdue(DateOnly.Parse(dueDate, System.Globalization.CultureInfo.InvariantCulture), null, now, NewYork).ShouldBe(expected);
    }

    [Fact]
    public void Timed_due_across_a_dst_change_is_still_a_single_instant()
    {
        // 09:00 EDT on 2026-03-09 (after spring forward) = 13:00Z.
        var instant = UserTimeZone.Resolve("America/New_York").ToUtc(new DateTime(2026, 3, 9, 9, 0, 0));

        instant.ShouldBe(Utc(2026, 3, 9, 13, 0, 0));
        DueDates.IsOverdue(new DateOnly(2026, 3, 9), instant, Utc(2026, 3, 9, 13, 0, 1), LosAngeles).ShouldBeTrue();
    }

    [Fact]
    public void UserTimeZone_IsOverdue_delegates_with_its_zone()
    {
        var chicago = UserTimeZone.Resolve("America/Chicago");
        var due = new DateOnly(2026, 10, 14);

        chicago.IsOverdue(due, null, Utc(2026, 10, 15, 4, 59, 59)).ShouldBeFalse(); // 23:59:59 CDT
        chicago.IsOverdue(due, null, Utc(2026, 10, 15, 5, 0, 0)).ShouldBeTrue();
    }

    [Fact]
    public void SortKey_is_the_instant_or_end_of_date_treated_as_utc_or_null_for_asap()
    {
        DueDates.SortKey(null, null).ShouldBeNull();

        var instant = Utc(2026, 10, 14, 18, 0, 0);
        DueDates.SortKey(new DateOnly(2026, 10, 14), instant).ShouldBe(instant);

        var key = DueDates.SortKey(new DateOnly(2026, 10, 14), null)!.Value;
        key.Kind.ShouldBe(DateTimeKind.Utc);
        key.Date.ShouldBe(new DateTime(2026, 10, 14));
        key.TimeOfDay.ShouldBe(TimeOnly.MaxValue.ToTimeSpan());
    }
}
