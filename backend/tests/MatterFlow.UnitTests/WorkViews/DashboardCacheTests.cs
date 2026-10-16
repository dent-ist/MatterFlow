using MatterFlow.WorkViews.Application.Queries;
using Microsoft.Extensions.Options;
using Shouldly;

namespace MatterFlow.UnitTests.WorkViews;

/// <summary>The short dashboard output cache (SEC2-03): entries live for the configured seconds, are keyed per caller, and 0 switches the cache off.</summary>
public class DashboardCacheTests
{
    private static DashboardSummary Summary(int open) =>
        new(
            new DashboardPeriod(30, new DateOnly(2026, 9, 15), new DateOnly(2026, 10, 14)),
            "America/New_York",
            new DateTime(2026, 10, 14, 12, 0, 0, DateTimeKind.Utc),
            new DashboardCount(open, "q"),
            new DashboardCount(0, "q"),
            new DashboardCount(0, "q"),
            new DashboardCount(0, "q"),
            new DashboardCount(0, "q"),
            new DashboardCount(0, "q"),
            new DashboardCount(0, "q"),
            new DashboardCount(0, "q"),
            [],
            [],
            [],
            [],
            new DashboardCount(0, "q"),
            new DashboardCount(0, "q"));

    private static DashboardCache Cache(int seconds, FakeTime time) => new(Options.Create(new DashboardOptions { CacheSeconds = seconds }), time);

    [Fact]
    public void An_entry_is_served_until_it_is_fifteen_seconds_old()
    {
        var time = new FakeTime();
        var cache = Cache(15, time);
        cache.Set("7|30|America/New_York|2026-10-14|1", Summary(5));

        time.Advance(TimeSpan.FromSeconds(14.9));
        cache.TryGet("7|30|America/New_York|2026-10-14|1", out var hit).ShouldBeTrue();
        hit.Open.Count.ShouldBe(5);

        time.Advance(TimeSpan.FromSeconds(0.2));
        cache.TryGet("7|30|America/New_York|2026-10-14|1", out _).ShouldBeFalse();
        cache.Count.ShouldBe(0, "an expired entry is dropped when it is looked up");
    }

    [Fact]
    public void Entries_of_other_users_periods_and_visibility_are_separate()
    {
        var cache = Cache(15, new FakeTime());
        cache.Set("7|30|z|d|1", Summary(5));

        cache.TryGet("8|30|z|d|1", out _).ShouldBeFalse("another user");
        cache.TryGet("7|7|z|d|1", out _).ShouldBeFalse("another period");
        cache.TryGet("7|30|z|d|0", out _).ShouldBeFalse("the same user without the department right");
    }

    [Fact]
    public void Zero_seconds_switches_the_cache_off()
    {
        var cache = Cache(0, new FakeTime());
        cache.Enabled.ShouldBeFalse();
        cache.Set("k", Summary(1));
        cache.Count.ShouldBe(0);
        cache.TryGet("k", out _).ShouldBeFalse();
    }

    [Fact]
    public void A_newer_answer_replaces_the_older_one()
    {
        var cache = Cache(15, new FakeTime());
        cache.Set("k", Summary(1));
        cache.Set("k", Summary(2));
        cache.TryGet("k", out var hit).ShouldBeTrue();
        hit.Open.Count.ShouldBe(2);
        cache.Count.ShouldBe(1);
    }

    [Fact]
    public void Expired_entries_are_purged_when_the_cache_grows_large()
    {
        var time = new FakeTime();
        var cache = Cache(15, time);
        for (var i = 0; i < 2001; i++)
            cache.Set("old" + i, Summary(i));

        time.Advance(TimeSpan.FromSeconds(16));
        cache.Set("fresh", Summary(1));

        cache.Count.ShouldBe(1);
        cache.TryGet("fresh", out _).ShouldBeTrue();
    }

    /// <summary>A clock the test moves by hand.</summary>
    private sealed class FakeTime : TimeProvider
    {
        private long _ticks = 1_000_000;

        public override long TimestampFrequency => 1000;

        public override long GetTimestamp() => _ticks;

        public void Advance(TimeSpan by) => _ticks += (long)(by.TotalSeconds * TimestampFrequency);
    }
}
