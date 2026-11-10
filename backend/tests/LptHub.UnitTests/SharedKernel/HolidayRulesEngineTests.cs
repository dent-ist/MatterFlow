using LptHub.SharedKernel.Availability;
using Shouldly;

namespace LptHub.UnitTests.SharedKernel;

/// <summary>The holiday-rule expansion against the dates of the mockup calendars (US federal and England and Wales) for 2026 and 2027, and the rule maths.</summary>
public class HolidayRulesEngineTests
{
    private static HolidayRule Fixed(int id, string name, int month, int day, string weekend = WeekendRules.None) =>
        new(id, name, HolidayRuleKinds.Fixed, Month: month, Day: day, WeekendRule: weekend);

    private static HolidayRule Nth(int id, string name, int month, int weekday, int nth, int plus = 0) =>
        new(id, name, HolidayRuleKinds.NthWeekday, Month: month, Nth: nth, Weekday: weekday, PlusDays: plus);

    private static HolidayRule EasterOffset(int id, string name, int offset) => new(id, name, HolidayRuleKinds.EasterOffset, EasterOffset: offset);

    private static readonly HolidayRule[] Us =
    [
        Fixed(1, "New Year's Day", 1, 1, WeekendRules.Us), Nth(2, "Martin Luther King Jr. Day", 1, 1, 3), Nth(3, "Presidents' Day", 2, 1, 3), Nth(4, "Memorial Day", 5, 1, -1),
        Fixed(5, "Juneteenth", 6, 19, WeekendRules.Us), Fixed(6, "Independence Day", 7, 4, WeekendRules.Us), Nth(7, "Labor Day", 9, 1, 1), Nth(8, "Thanksgiving", 11, 4, 4),
        Nth(9, "Day after Thanksgiving", 11, 4, 4, 1), Fixed(10, "Christmas Day", 12, 25, WeekendRules.Us),
    ];

    private static readonly HolidayRule[] Uk =
    [
        Fixed(1, "New Year's Day", 1, 1, WeekendRules.Uk), EasterOffset(2, "Good Friday", -2), EasterOffset(3, "Easter Monday", 1), Nth(4, "Early May bank holiday", 5, 1, 1),
        Nth(5, "Spring bank holiday", 5, 1, -1), Nth(6, "Summer bank holiday", 8, 1, -1), Fixed(7, "Christmas Day", 12, 25, WeekendRules.Uk), Fixed(8, "Boxing Day", 12, 26, WeekendRules.Uk),
    ];

    private static DateOnly D(int y, int m, int d) => new(y, m, d);

    private static string Dump(IEnumerable<HolidayRule> rules, int year) =>
        string.Join("; ", HolidayRulesEngine.Expand(rules, year).Select(h => $"{h.Date:MM-dd} {h.Name}{(h.ObservedFrom is { } f ? $" (from {f:MM-dd})" : string.Empty)}"));

    [Theory]
    [InlineData(2026, 4, 5)]
    [InlineData(2027, 3, 28)]
    [InlineData(2025, 4, 20)]
    [InlineData(2024, 3, 31)]
    [InlineData(2038, 4, 25)]
    public void Easter_sunday_is_the_gregorian_computus(int year, int month, int day) => HolidayRulesEngine.Easter(year).ShouldBe(D(year, month, day));

    [Fact]
    public void Nth_and_last_weekday_of_a_month()
    {
        HolidayRulesEngine.NthWeekday(2026, 11, 4, 4).ShouldBe(D(2026, 11, 26)); // 4th Thursday of November 2026
        HolidayRulesEngine.NthWeekday(2027, 11, 4, 4).ShouldBe(D(2027, 11, 25));
        HolidayRulesEngine.NthWeekday(2026, 5, 1, -1).ShouldBe(D(2026, 5, 25)); // Memorial Day
        HolidayRulesEngine.NthWeekday(2027, 5, 1, -1).ShouldBe(D(2027, 5, 31));
        HolidayRulesEngine.NthWeekday(2026, 9, 1, 1).ShouldBe(D(2026, 9, 7)); // Labor Day
        HolidayRulesEngine.NthWeekday(2026, 2, 0, -1).ShouldBe(D(2026, 2, 22)); // last Sunday of February
    }

    [Fact]
    public void Us_federal_holidays_2026()
    {
        Dump(Us, 2026).ShouldBe(
            "01-01 New Year's Day; 01-19 Martin Luther King Jr. Day; 02-16 Presidents' Day; 05-25 Memorial Day; 06-19 Juneteenth; 07-03 Independence Day (from 07-04); "
            + "09-07 Labor Day; 11-26 Thanksgiving; 11-27 Day after Thanksgiving; 12-25 Christmas Day");
    }

    [Fact]
    public void Us_federal_holidays_2027_with_observed_days()
    {
        // 2027: 1 January is a Friday; 19 June a Saturday (observed Friday 18th); 4 July a Sunday (observed Monday 5th); 25 December a Saturday (observed Friday 24th).
        Dump(Us, 2027).ShouldBe(
            "01-01 New Year's Day; 01-18 Martin Luther King Jr. Day; 02-15 Presidents' Day; 05-31 Memorial Day; 06-18 Juneteenth (from 06-19); 07-05 Independence Day (from 07-04); "
            + "09-06 Labor Day; 11-25 Thanksgiving; 11-26 Day after Thanksgiving; 12-24 Christmas Day (from 12-25)");
    }

    [Fact]
    public void A_us_holiday_on_a_saturday_new_year_moves_into_the_previous_year()
    {
        // 1 January 2028 is a Saturday: observed on Friday 31 December 2027, which belongs to the expansion of 2028.
        HolidayRulesEngine.Expand(Us, 2028).First().Date.ShouldBe(D(2027, 12, 31));
        HolidayRulesEngine.ExpandRange(Us, D(2027, 12, 30), D(2028, 1, 2)).Select(h => h.Date).ShouldBe([D(2027, 12, 31)]);
    }

    [Fact]
    public void England_and_wales_bank_holidays_2026()
    {
        // Good Friday 3 April, Easter Monday 6 April 2026; 25 December a Friday, 26 December a Saturday moves to Monday 28th.
        Dump(Uk, 2026).ShouldBe(
            "01-01 New Year's Day; 04-03 Good Friday; 04-06 Easter Monday; 05-04 Early May bank holiday; 05-25 Spring bank holiday; 08-31 Summer bank holiday; 12-25 Christmas Day; 12-28 Boxing Day (from 12-26)");
    }

    [Fact]
    public void England_and_wales_bank_holidays_2027_christmas_week()
    {
        // 2027: Easter 28 March (Good Friday 26th, Monday 29th); 25 December a Saturday -> Monday 27th; 26 December a Sunday -> Monday 27th is taken -> Tuesday 28th.
        Dump(Uk, 2027).ShouldBe(
            "01-01 New Year's Day; 03-26 Good Friday; 03-29 Easter Monday; 05-03 Early May bank holiday; 05-31 Spring bank holiday; 08-30 Summer bank holiday; 12-27 Christmas Day (from 12-25); 12-28 Boxing Day (from 12-26)");
    }

    [Fact]
    public void Ranges_once_and_the_preview_collapse()
    {
        var rules = new[]
        {
            new HolidayRule(1, "Year-end closure", HolidayRuleKinds.Range, Month: 12, Day: 28, RangeEndMonth: 12, RangeEndDay: 31, Yearly: true),
            new HolidayRule(2, "Office move day", HolidayRuleKinds.Once, OnceDate: D(2027, 2, 12), Yearly: false),
            new HolidayRule(3, "Offsite", HolidayRuleKinds.Range, OnceDate: D(2026, 12, 30), RangeEndDate: D(2027, 1, 2), Yearly: false),
        };

        HolidayRulesEngine.Expand(rules, 2026).Select(h => h.Date).ShouldBe([D(2026, 12, 28), D(2026, 12, 29), D(2026, 12, 30), D(2026, 12, 30), D(2026, 12, 31), D(2026, 12, 31)]);
        HolidayRulesEngine.Expand(rules, 2027).Where(h => h.RuleId == 2).Select(h => h.Date).ShouldBe([D(2027, 2, 12)]);
        HolidayRulesEngine.Expand(rules, 2027).Where(h => h.RuleId == 3).Select(h => h.Date).ShouldBe([D(2027, 1, 1), D(2027, 1, 2)]);

        var preview = HolidayRulesEngine.Preview(rules, 2026);
        preview.Single(l => l.RuleId == 1).ShouldBe(new HolidayPreviewLine(D(2026, 12, 28), D(2026, 12, 31), "Year-end closure", null, 1));
        HolidayRulesEngine.Preview(rules, 2027).Single(l => l.RuleId == 2).EndDate.ShouldBeNull();
    }

    [Fact]
    public void A_feb_29_rule_is_skipped_in_other_years_and_validation_names_the_problem()
    {
        var leap = Fixed(1, "Leap day", 2, 29);
        HolidayRulesEngine.Expand([leap], 2027).ShouldBeEmpty();
        HolidayRulesEngine.Expand([leap], 2028).Single().Date.ShouldBe(D(2028, 2, 29));

        HolidayRulesEngine.Validate(leap).ShouldBeEmpty();
        HolidayRulesEngine.Validate(Fixed(2, "Bad", 4, 31)).ShouldNotBeEmpty();
        HolidayRulesEngine.Validate(Nth(3, "Bad nth", 5, 1, 5)).ShouldNotBeEmpty();
        HolidayRulesEngine.Validate(new HolidayRule(4, "Backwards", HolidayRuleKinds.Range, Month: 12, Day: 31, RangeEndMonth: 12, RangeEndDay: 28)).ShouldNotBeEmpty();
        HolidayRulesEngine.Validate(new HolidayRule(5, "Odd", "WEEKLY")).ShouldNotBeEmpty();
    }
}
