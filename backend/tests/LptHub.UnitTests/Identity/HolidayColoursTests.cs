using LptHub.Configuration.Contracts;
using LptHub.Identity.Holidays;
using Shouldly;

namespace LptHub.UnitTests.Identity;

/// <summary>The holiday calendar colours repeat the tag palette (Identity may not read the Configuration module): the two lists must stay in step.</summary>
public class HolidayColoursTests
{
    [Fact]
    public void The_holiday_colours_are_the_tag_palette() =>
        HolidayColours.Keys.Order().ShouldBe(TaskTypeColours.All.Select(c => c.Key).Order());

    [Fact]
    public void Only_palette_names_are_valid()
    {
        HolidayColours.IsValid("indigo").ShouldBeTrue();
        HolidayColours.IsValid("hotpink").ShouldBeFalse();
        HolidayColours.IsValid(null).ShouldBeFalse();
    }
}
