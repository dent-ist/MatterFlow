using System.Globalization;

namespace MatterFlow.SharedKernel.Availability;

/// <summary>Rule kinds of a holiday (script 59).</summary>
public static class HolidayRuleKinds
{
    public const string Fixed = "FIXED";
    public const string NthWeekday = "NTH_WEEKDAY";
    public const string EasterOffset = "EASTER_OFFSET";
    public const string Once = "ONCE";
    public const string Range = "RANGE";

    public static IReadOnlyList<string> All { get; } = [Fixed, NthWeekday, EasterOffset, Once, Range];
}

/// <summary>How a holiday that falls on a weekend moves (script 59).</summary>
public static class WeekendRules
{
    public const string None = "NONE";

    /// <summary>Saturday moves to the Friday before, Sunday to the Monday after.</summary>
    public const string Us = "US";

    /// <summary>Saturday and Sunday move to the Monday after, or the next free day when that one is already a holiday of the calendar.</summary>
    public const string Uk = "UK";

    public static IReadOnlyList<string> All { get; } = [None, Us, Uk];
}

/// <summary>
/// One holiday rule as stored. <see cref="Weekday"/> is 0 = Sunday ... 6 = Saturday; <see cref="Nth"/> is 1 to 4 or -1 for the last. FIXED uses Month and Day;
/// NTH_WEEKDAY uses Month, Nth, Weekday and PlusDays; EASTER_OFFSET uses EasterOffset; ONCE uses OnceDate; RANGE uses Month/Day to RangeEndMonth/RangeEndDay when
/// <see cref="Yearly"/>, otherwise OnceDate to RangeEndDate once.
/// </summary>
public sealed record HolidayRule(
    int Id,
    string Name,
    string Kind,
    int? Month = null,
    int? Day = null,
    int? Nth = null,
    int? Weekday = null,
    int PlusDays = 0,
    int? EasterOffset = null,
    DateOnly? OnceDate = null,
    int? RangeEndMonth = null,
    int? RangeEndDay = null,
    DateOnly? RangeEndDate = null,
    bool Yearly = true,
    string WeekendRule = WeekendRules.None);

/// <summary>A holiday on one date after expanding a rule for a year (ranges give one entry per day).</summary>
/// <param name="ObservedFrom">The date the rule falls on, when the holiday was moved to a weekday; null otherwise.</param>
public sealed record ExpandedHoliday(DateOnly Date, string Name, int RuleId, DateOnly? ObservedFrom = null);

/// <summary>An expanded holiday as the preview shows it: a range collapses into one line.</summary>
public sealed record HolidayPreviewLine(DateOnly Date, DateOnly? EndDate, string Name, DateOnly? ObservedFrom, int RuleId);

/// <summary>
/// Pure holiday-rule expansion (Dashboard Calendar, #1074): the same maths as the mockup (<c>docs/ux/mockups/dashboard-calendar/index.html</c>, <c>easter</c>, <c>nth</c>
/// and <c>expand</c>): Easter by the Gregorian computus, the Nth or last weekday of a month, ranges, and the observed-day rules US and UK. Nothing is stored per year.
/// </summary>
public static class HolidayRulesEngine
{
    /// <summary>Easter Sunday of a year (Gregorian calendar, the "Anonymous" algorithm the mockup uses).</summary>
    public static DateOnly Easter(int year)
    {
        int a = year % 19, b = year / 100, c = year % 100;
        int d = b / 4, e = b % 4, f = (b + 8) / 25, g = (b - f + 1) / 3;
        int h = (19 * a + b - d - g + 15) % 30, i = c / 4, k = c % 4;
        int l = (32 + 2 * e + 2 * i - h - k) % 7;
        int m = (a + 11 * h + 22 * l) / 451;
        int month = (h + l - 7 * m + 114) / 31;
        int day = ((h + l - 7 * m + 114) % 31) + 1;
        return new DateOnly(year, month, day);
    }

    /// <summary>The Nth (1 to 4) or last (-1) weekday (0 = Sunday ... 6 = Saturday) of a month.</summary>
    public static DateOnly NthWeekday(int year, int month, int weekday, int nth)
    {
        if (nth > 0)
        {
            var first = new DateOnly(year, month, 1);
            return first.AddDays(((weekday - (int)first.DayOfWeek + 7) % 7) + (7 * (nth - 1)));
        }

        var last = new DateOnly(year, month, DateTime.DaysInMonth(year, month));
        return last.AddDays(-(((int)last.DayOfWeek - weekday + 7) % 7));
    }

    /// <summary>
    /// Every holiday date the rules give in <paramref name="year"/>, sorted by date. A date moved by the weekend rule can fall in the adjacent year (for example a
    /// Saturday 1 January moves to 31 December under the US rule), so callers who need a date range expand the years around it.
    /// </summary>
    public static IReadOnlyList<ExpandedHoliday> Expand(IEnumerable<HolidayRule> rules, int year)
    {
        ArgumentNullException.ThrowIfNull(rules);
        var raw = new List<(ExpandedHoliday Holiday, HolidayRule Rule)>();
        foreach (var rule in rules)
        {
            if (rule.Kind == HolidayRuleKinds.Range)
            {
                if (TryRange(rule, year, out var from, out var to))
                {
                    for (var d = from; d <= to; d = d.AddDays(1))
                        raw.Add((new ExpandedHoliday(d, rule.Name, rule.Id), rule));
                }

                continue;
            }

            if (TrySingle(rule, year) is { } date)
                raw.Add((new ExpandedHoliday(date, rule.Name, rule.Id), rule));
        }

        var used = raw.Select(r => r.Holiday.Date).ToHashSet();
        var result = new List<ExpandedHoliday>(raw.Count);
        foreach (var (holiday, rule) in raw)
        {
            if (rule.Kind != HolidayRuleKinds.Range && rule.WeekendRule != WeekendRules.None && holiday.Date.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday)
            {
                var saturday = holiday.Date.DayOfWeek == DayOfWeek.Saturday;
                var moved = rule.WeekendRule == WeekendRules.Us
                    ? holiday.Date.AddDays(saturday ? -1 : 1)
                    : holiday.Date.AddDays(saturday ? 2 : 1);
                while (used.Contains(moved) && rule.WeekendRule == WeekendRules.Uk)
                    moved = moved.AddDays(1);
                used.Add(moved);
                result.Add(holiday with { Date = moved, ObservedFrom = holiday.Date });
            }
            else
            {
                result.Add(holiday);
            }
        }

        return [.. result.OrderBy(h => h.Date).ThenBy(h => h.Name, StringComparer.Ordinal)];
    }

    /// <summary>The holidays whose date lies in the range, expanding the years around it (observed days can cross a year boundary).</summary>
    public static IReadOnlyList<ExpandedHoliday> ExpandRange(IReadOnlyCollection<HolidayRule> rules, DateOnly from, DateOnly to)
    {
        var all = new List<ExpandedHoliday>();
        if (rules.Count == 0)
            return all;
        for (var year = from.Year - 1; year <= to.Year + 1; year++)
            all.AddRange(Expand(rules, year).Where(h => h.Date >= from && h.Date <= to));
        return all;
    }

    /// <summary>The preview of one year: a range is one line from its first to its last day.</summary>
    public static IReadOnlyList<HolidayPreviewLine> Preview(IEnumerable<HolidayRule> rules, int year)
    {
        var rulesList = rules.ToList();
        var lines = new List<HolidayPreviewLine>();
        foreach (var group in Expand(rulesList, year).GroupBy(h => h.RuleId))
        {
            var rule = rulesList.First(r => r.Id == group.Key);
            if (rule.Kind == HolidayRuleKinds.Range)
            {
                var days = group.OrderBy(h => h.Date).ToList();
                lines.Add(new HolidayPreviewLine(days[0].Date, days.Count > 1 ? days[^1].Date : null, rule.Name, null, rule.Id));
            }
            else
            {
                lines.AddRange(group.Select(h => new HolidayPreviewLine(h.Date, null, h.Name, h.ObservedFrom, h.RuleId)));
            }
        }

        return [.. lines.OrderBy(l => l.Date).ThenBy(l => l.Name, StringComparer.Ordinal)];
    }

    /// <summary>Checks the fields a rule kind needs; returns one message per problem (empty = valid). Dates are not checked for existence in every year (29 February is skipped in other years).</summary>
    public static IReadOnlyList<string> Validate(HolidayRule rule)
    {
        var problems = new List<string>();
        switch (rule.Kind)
        {
            case HolidayRuleKinds.Fixed:
                if (!ValidMonthDay(rule.Month, rule.Day))
                    problems.Add("Choose a real month and day (for example 12/25).");
                break;
            case HolidayRuleKinds.NthWeekday:
                if (rule.Month is not (>= 1 and <= 12))
                    problems.Add("Choose a month.");
                if (rule.Nth is not (1 or 2 or 3 or 4 or -1))
                    problems.Add("Choose 1st, 2nd, 3rd, 4th or last.");
                if (rule.Weekday is not (>= 0 and <= 6))
                    problems.Add("Choose a weekday.");
                if (rule.PlusDays is < 0 or > 6)
                    problems.Add("Plus days must be 0 to 6.");
                break;
            case HolidayRuleKinds.EasterOffset:
                if (rule.EasterOffset is not (>= -60 and <= 60))
                    problems.Add("Days from Easter must be between -60 and 60.");
                break;
            case HolidayRuleKinds.Once:
                if (rule.OnceDate is null)
                    problems.Add("Choose the date.");
                break;
            case HolidayRuleKinds.Range:
                if (rule.Yearly)
                {
                    if (!ValidMonthDay(rule.Month, rule.Day) || !ValidMonthDay(rule.RangeEndMonth, rule.RangeEndDay))
                        problems.Add("Choose a real first and last day.");
                    else if (new DateOnly(2000, rule.RangeEndMonth!.Value, rule.RangeEndDay!.Value) < new DateOnly(2000, rule.Month!.Value, rule.Day!.Value))
                        problems.Add("The last day cannot be before the first day (a range cannot cross New Year; enter two holidays).");
                }
                else if (rule.OnceDate is null || rule.RangeEndDate is null)
                {
                    problems.Add("Choose the first and last day.");
                }
                else if (rule.RangeEndDate < rule.OnceDate)
                {
                    problems.Add("The last day cannot be before the first day.");
                }

                break;
            default:
                problems.Add("Unknown rule kind.");
                break;
        }

        if (!WeekendRules.All.Contains(rule.WeekendRule))
            problems.Add("The weekend rule must be NONE, US or UK.");
        if (rule.WeekendRule != WeekendRules.None && rule.Kind is HolidayRuleKinds.Range)
            problems.Add("A range does not move with the weekend rule.");
        return problems;
    }

    private static bool ValidMonthDay(int? month, int? day) =>
        month is >= 1 and <= 12 && day is >= 1 && day <= DateTime.DaysInMonth(2000, month.Value); // 2000 is a leap year: 29 February is allowed

    private static DateOnly? TrySingle(HolidayRule rule, int year)
    {
        switch (rule.Kind)
        {
            case HolidayRuleKinds.Fixed when rule.Month is { } m && rule.Day is { } d:
                return d <= DateTime.DaysInMonth(year, m) ? new DateOnly(year, m, d) : null;
            case HolidayRuleKinds.NthWeekday when rule.Month is { } m && rule.Nth is { } n && rule.Weekday is { } w:
                return NthWeekday(year, m, w, n).AddDays(rule.PlusDays);
            case HolidayRuleKinds.EasterOffset when rule.EasterOffset is { } o:
                return Easter(year).AddDays(o);
            case HolidayRuleKinds.Once when rule.OnceDate is { } once && once.Year == year:
                return once;
            default:
                return null;
        }
    }

    private static bool TryRange(HolidayRule rule, int year, out DateOnly from, out DateOnly to)
    {
        from = default;
        to = default;
        if (rule.Yearly)
        {
            if (rule.Month is not { } m || rule.Day is not { } d || rule.RangeEndMonth is not { } m2 || rule.RangeEndDay is not { } d2
                || d > DateTime.DaysInMonth(year, m) || d2 > DateTime.DaysInMonth(year, m2))
                return false;
            from = new DateOnly(year, m, d);
            to = new DateOnly(year, m2, d2);
            return to >= from;
        }

        if (rule.OnceDate is not { } start || rule.RangeEndDate is not { } end)
            return false;
        // A one-time range can cross New Year: it belongs to the year of each of its days.
        from = start.Year == year ? start : new DateOnly(year, 1, 1);
        to = end.Year == year ? end : new DateOnly(year, 12, 31);
        if (start.Year > year || end.Year < year)
            return false;
        return to >= from;
    }

    /// <summary>Formats a date as the import and preview text does (<c>MM/dd/yyyy</c>).</summary>
    public static string Format(DateOnly date) => date.ToString("MM'/'dd'/'yyyy", CultureInfo.InvariantCulture);
}
