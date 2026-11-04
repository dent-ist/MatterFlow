using MatterFlow.Configuration.Application.Settings;
using MatterFlow.Configuration.Contracts;
using Shouldly;

namespace MatterFlow.UnitTests.Configuration.Settings;

/// <summary>Decision AV (issue #1103): the capacity battery setting defaults to counting people outside work hours.</summary>
public class DashboardCapacitySettingsTests
{
    [Fact]
    public void The_default_counts_people_outside_work_hours()
    {
        DashboardCapacitySettings.Default.CountOffHours.ShouldBeTrue();
    }

    [Fact]
    public void Nothing_unreadable_or_without_the_flag_falls_back_to_the_default()
    {
        DashboardSettingsService.ParseCapacity(null).ShouldBeNull();
        DashboardSettingsService.ParseCapacity("").ShouldBeNull();
        DashboardSettingsService.ParseCapacity("not json").ShouldBeNull();
        DashboardSettingsService.ParseCapacity("{}").ShouldBeNull();
    }

    [Fact]
    public void A_stored_flag_is_read_back_either_way()
    {
        DashboardSettingsService.ParseCapacity("""{"countOffHours":false}""")!.CountOffHours.ShouldBeFalse();
        DashboardSettingsService.ParseCapacity("""{"countOffHours":true}""")!.CountOffHours.ShouldBeTrue();
    }
}
