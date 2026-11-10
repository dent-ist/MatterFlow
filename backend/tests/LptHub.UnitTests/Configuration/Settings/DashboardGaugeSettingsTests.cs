using LptHub.Configuration.Application.Settings;
using LptHub.Configuration.Contracts;
using Shouldly;

namespace LptHub.UnitTests.Configuration.Settings;

/// <summary>Dashboard v4 (issue #1064): code defaults, validation and the stored JSON of the gauge settings.</summary>
public class DashboardGaugeSettingsTests
{
    private static DashboardGaugeValues Values(string start = "08:00", string end = "18:00", int[]? days = null, string basis = "WORKING", int[]? hours = null, int perLevel = 5, int bonus = 2) =>
        new(start, end, days ?? [1, 2, 3, 4, 5], basis, hours ?? [1, 2, 3, 4, 5], perLevel, bonus);

    [Fact]
    public void The_defaults_are_eight_to_six_on_weekdays_with_working_hours_and_are_valid()
    {
        var d = DashboardGaugeSettings.Default;
        d.WorkdayStart.ShouldBe(new TimeOnly(8, 0));
        d.WorkdayEnd.ShouldBe(new TimeOnly(18, 0));
        d.WorkDays.ShouldBe([1, 2, 3, 4, 5]);
        d.AgeBasis.ShouldBe("WORKING");
        d.LevelHours.ShouldBe([1, 2, 3, 4, 5]);
        d.TasksPerLevel.ShouldBe(5);
        d.CountBonusMax.ShouldBe(2);
        d.Validate().ShouldBeEmpty();
    }

    [Fact]
    public void Valid_form_values_become_settings_and_clock_hours_are_allowed()
    {
        DashboardSettingsService.FromValues(Values(basis: "clock", days: [5, 1])).Value.AgeBasis.ShouldBe("CLOCK");
        DashboardSettingsService.FromValues(Values(days: [5, 1])).Value.WorkDays.ShouldBe([1, 5]);
    }

    [Theory]
    [InlineData("18:00", "08:00")] // start after end
    [InlineData("08:00", "08:00")]
    [InlineData("8am", "18:00")]
    [InlineData("08:00", "25:00")]
    public void The_working_day_must_start_before_it_ends_and_be_a_time(string start, string end)
    {
        DashboardSettingsService.FromValues(Values(start, end)).IsFailure.ShouldBeTrue();
    }

    [Fact]
    public void At_least_one_distinct_weekday_from_one_to_seven_is_required()
    {
        DashboardSettingsService.FromValues(Values(days: [])).IsFailure.ShouldBeTrue();
        DashboardSettingsService.FromValues(Values(days: [0])).IsFailure.ShouldBeTrue();
        DashboardSettingsService.FromValues(Values(days: [8])).IsFailure.ShouldBeTrue();
        DashboardSettingsService.FromValues(Values(days: [1, 1])).IsFailure.ShouldBeTrue();
        DashboardSettingsService.FromValues(Values(days: [7])).IsSuccess.ShouldBeTrue();
    }

    [Fact]
    public void The_basis_the_level_hours_and_the_counts_are_checked()
    {
        DashboardSettingsService.FromValues(Values(basis: "WEEKS")).IsFailure.ShouldBeTrue();
        DashboardSettingsService.FromValues(Values(hours: [1, 2, 3, 4])).IsFailure.ShouldBeTrue();
        DashboardSettingsService.FromValues(Values(hours: [1, 2, 2, 4, 5])).IsFailure.ShouldBeTrue();
        DashboardSettingsService.FromValues(Values(hours: [0, 2, 3, 4, 5])).IsFailure.ShouldBeTrue();
        DashboardSettingsService.FromValues(Values(perLevel: 0)).IsFailure.ShouldBeTrue();
        DashboardSettingsService.FromValues(Values(bonus: 6)).IsFailure.ShouldBeTrue();
        DashboardSettingsService.FromValues(Values(bonus: 0, perLevel: 1000)).IsSuccess.ShouldBeTrue();
    }

    [Fact]
    public void A_stored_value_round_trips_and_a_broken_one_falls_back_to_nothing()
    {
        var saved = DashboardSettingsService.FromValues(Values("07:30", "17:30", [1, 2, 3], "CLOCK", [2, 4, 6, 8, 10], 3, 1)).Value;
        var json = System.Text.Json.JsonSerializer.Serialize(DashboardSettingsService.ToValues(saved), new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));
        var back = DashboardSettingsService.Parse(json)!;
        back.WorkdayStart.ShouldBe(saved.WorkdayStart);
        back.WorkdayEnd.ShouldBe(saved.WorkdayEnd);
        back.WorkDays.ShouldBe(saved.WorkDays);
        back.AgeBasis.ShouldBe("CLOCK");
        back.LevelHours.ShouldBe(saved.LevelHours);
        back.TasksPerLevel.ShouldBe(3);
        back.CountBonusMax.ShouldBe(1);
        DashboardSettingsService.Parse(null).ShouldBeNull();
        DashboardSettingsService.Parse("not json").ShouldBeNull();
        DashboardSettingsService.Parse("""{"workdayStart":"18:00","workdayEnd":"08:00","workDays":[1],"ageBasis":"WORKING","levelHours":[1,2,3,4,5],"tasksPerLevel":5,"countBonusMax":2}""").ShouldBeNull();
    }
}
