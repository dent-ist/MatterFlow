using MatterFlow.SharedKernel.Time;
using Shouldly;

namespace MatterFlow.UnitTests.SharedKernel;

public class UserTimeZoneTests
{
    [Theory]
    [InlineData("America/Chicago")]
    [InlineData("America/Los_Angeles")]
    [InlineData("Europe/London")]
    [InlineData(" America/Denver ")]
    [InlineData("UTC")]
    public void Valid_header_zone_is_used(string header)
    {
        var tz = UserTimeZone.Resolve(header);

        tz.IsFromRequest.ShouldBeTrue();
        tz.Id.ShouldBe(header.Trim());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("Not/AZone")]
    [InlineData("Eastern Standard Time")]
    [InlineData("EST")]
    [InlineData("+05:00")]
    [InlineData("../etc/passwd")]
    [InlineData("America/New_York; DROP TABLE")]
    public void Missing_or_invalid_header_falls_back_to_the_firm_zone(string? header)
    {
        var tz = UserTimeZone.Resolve(header);

        tz.IsFromRequest.ShouldBeFalse();
        tz.Id.ShouldBe("America/New_York");
    }

    [Fact]
    public void Fallback_follows_the_configured_firm_zone_and_survives_a_bad_configuration()
    {
        UserTimeZone.Resolve(null, "America/Chicago").Id.ShouldBe("America/Chicago");
        UserTimeZone.Resolve("garbage", "America/Chicago").Id.ShouldBe("America/Chicago");
        UserTimeZone.Resolve(null, "bad/zone").Id.ShouldBe("America/New_York");
        UserTimeZone.Resolve(null, null).Id.ShouldBe("America/New_York");
    }

    [Fact]
    public void IsValidIanaId_accepts_only_iana_ids()
    {
        UserTimeZone.IsValidIanaId("America/New_York").ShouldBeTrue();
        UserTimeZone.IsValidIanaId("Eastern Standard Time").ShouldBeFalse();
        UserTimeZone.IsValidIanaId(null).ShouldBeFalse();
    }

    [Fact]
    public void ToLocal_converts_utc_and_tracks_daylight_saving()
    {
        var ny = UserTimeZone.Resolve("America/New_York");

        ny.ToLocal(new DateTime(2026, 1, 15, 17, 0, 0, DateTimeKind.Utc)).ShouldBe(new DateTime(2026, 1, 15, 12, 0, 0)); // EST
        ny.ToLocal(new DateTime(2026, 7, 15, 17, 0, 0, DateTimeKind.Utc)).ShouldBe(new DateTime(2026, 7, 15, 13, 0, 0)); // EDT
    }

    [Fact]
    public void ToUtc_converts_local_entry_and_handles_the_spring_forward_gap()
    {
        var ny = UserTimeZone.Resolve("America/New_York");

        ny.ToUtc(new DateTime(2026, 7, 15, 9, 0, 0)).ShouldBe(new DateTime(2026, 7, 15, 13, 0, 0));
        // 02:30 on 2026-03-08 does not exist in New York; it is moved forward past the gap (03:30 EDT = 07:30Z).
        ny.ToUtc(new DateTime(2026, 3, 8, 2, 30, 0)).ShouldBe(new DateTime(2026, 3, 8, 7, 30, 0));
    }

    [Theory]
    [InlineData("America/New_York", 2026, 1, 15, "EST")]
    [InlineData("America/New_York", 2026, 7, 15, "EDT")]
    [InlineData("America/Chicago", 2026, 7, 15, "CDT")]
    [InlineData("America/Phoenix", 2026, 7, 15, "MST")]
    [InlineData("America/Los_Angeles", 2026, 1, 15, "PST")]
    [InlineData("Asia/Kolkata", 2026, 1, 15, "UTC+05:30")]
    public void Abbreviation_labels_us_zones_and_falls_back_to_an_offset(string zone, int y, int m, int d, string expected)
    {
        UserTimeZone.Resolve(zone).Abbreviation(new DateTime(y, m, d, 12, 0, 0, DateTimeKind.Utc)).ShouldBe(expected);
    }
}
