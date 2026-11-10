using System.Globalization;
using MatterFlow.SharedKernel.Time;

namespace MatterFlow.IntegrationTests.Fixtures;

/// <summary>
/// "Today" the way the viewer sees it. The firm's default zone is New York, so between 00:00 and 04:00 UTC the viewer's day is still the day before the UTC
/// one; a test that builds due dates from the UTC day then lands a day off. Tests take their dates from here. <c>MF_TEST_NOW</c> (an ISO instant) makes the
/// host's clock and <see cref="Now"/> fixed at that instant, to run a test at another time of day (for example <c>2026-10-28T02:00:00Z</c>, the hard hour).
/// </summary>
public static class ViewerDay
{
    private static readonly TimeZoneInfo Zone = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");

    private static readonly DateTime? Fixed =
        Environment.GetEnvironmentVariable("MF_TEST_NOW") is { Length: > 0 } text
            ? DateTime.Parse(text, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal)
            : null;

    /// <summary>The instant the test world is built around: the fixed one, else the real time.</summary>
    public static DateTime Now => Fixed ?? DateTime.UtcNow;

    /// <summary>The host's clock to inject when the time is fixed; null (the real clock) otherwise.</summary>
    public static IClock? HostClock => Fixed is { } at ? new FixedClock(at) : null;

    /// <summary>The viewer's calendar day at <paramref name="utcNow"/>.</summary>
    public static DateOnly Today(DateTime utcNow) => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utcNow, DateTimeKind.Utc), Zone));

    /// <summary>The viewer's calendar day now.</summary>
    public static DateOnly Today() => Today(Now);

    private sealed class FixedClock(DateTime now) : IClock
    {
        public DateTime UtcNow { get; } = now;
    }
}
