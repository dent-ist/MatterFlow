using MatterFlow.Configuration.Application.Settings;
using MatterFlow.Configuration.Domain.Settings;
using MatterFlow.SharedKernel.Time;
using Shouldly;

namespace MatterFlow.UnitTests.Configuration.Settings;

public class AppSettingsCacheTests
{
    private sealed class FakeClock(DateTime now) : IClock
    {
        public DateTime UtcNow { get; set; } = now;
    }

    private static IReadOnlyDictionary<string, AppSettingValue> Snapshot(string name) =>
        new Dictionary<string, AppSettingValue>
        {
            [SettingDefinitions.BrandingAppNameKey] = new(SettingDefinitions.BrandingAppNameKey, name, null, null, null, DateTime.UtcNow, 1, [1, 2, 3, 4, 5, 6, 7, 8]),
        };

    [Fact]
    public void A_stored_snapshot_is_served_for_30_seconds_and_then_dropped()
    {
        var clock = new FakeClock(new DateTime(2026, 10, 27, 9, 0, 0, DateTimeKind.Utc));
        var cache = new AppSettingsCache(clock);
        cache.TryGet().ShouldBeNull();

        var snapshot = Snapshot("A");
        cache.Store(snapshot, cache.Generation);

        cache.TryGet().ShouldBeSameAs(snapshot);
        clock.UtcNow = clock.UtcNow.AddSeconds(29.9);
        cache.TryGet().ShouldBeSameAs(snapshot);
        clock.UtcNow = clock.UtcNow.AddSeconds(0.2);
        cache.TryGet().ShouldBeNull();
    }

    [Fact]
    public void A_write_invalidates_the_snapshot_at_once()
    {
        var cache = new AppSettingsCache(new FakeClock(DateTime.UtcNow));
        cache.Store(Snapshot("A"), cache.Generation);

        cache.Invalidate();

        cache.TryGet().ShouldBeNull();
    }

    [Fact]
    public void A_snapshot_read_before_a_write_is_not_stored_after_it()
    {
        var cache = new AppSettingsCache(new FakeClock(DateTime.UtcNow));
        var generationBeforeRead = cache.Generation;
        cache.Invalidate(); // another request saved while this one was reading

        cache.Store(Snapshot("stale"), generationBeforeRead);

        cache.TryGet().ShouldBeNull();
    }

    [Fact]
    public void The_time_to_live_is_30_seconds() => AppSettingsCache.TimeToLive.ShouldBe(TimeSpan.FromSeconds(30));

    [Fact]
    public void Definitions_name_the_audit_events_and_the_defaults_live_in_code()
    {
        SettingDefinitions.BrandingAppName.DefaultText.ShouldBe("MatterFlow");
        SettingDefinitions.BrandingIcon.DefaultText.ShouldBeNull();
        SettingDefinitions.BrandingAppName.ChangedEvent.ShouldBe("SETTINGS_BRANDING_NAME_CHANGED");
        SettingDefinitions.BrandingIcon.ChangedEvent.ShouldBe("SETTINGS_BRANDING_ICON_CHANGED");
        SettingDefinitions.BrandingAppName.ResetEvent.ShouldBe("SETTINGS_BRANDING_RESET");
        SettingDefinitions.All.Select(d => d.Key).ShouldBe(["Branding.AppName", "Branding.Icon"]);
        SettingDefinitions.All.ShouldAllBe(d => d.Key.Length <= 100);
    }

    [Fact]
    public void Describe_names_type_size_and_hash_but_never_the_bytes()
    {
        var text = AppSettingsService.Describe("image/png", 2048, [0xAB, 0xCD]);
        text.ShouldBe("image/png, 2048 bytes, sha256 abcd");
    }
}
