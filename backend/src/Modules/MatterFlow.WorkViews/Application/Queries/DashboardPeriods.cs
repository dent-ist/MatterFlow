using MatterFlow.SharedKernel.Results;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>A resolved Dashboard period: the keyword it came from and the first and last local day (both inclusive, the viewer's zone).</summary>
public readonly record struct ResolvedPeriod(string Key, DateOnly From, DateOnly To)
{
    public int Days => To.DayNumber - From.DayNumber + 1;
}

/// <summary>The period a Dashboard period is compared with (S3, #102): the days directly before it, or for "This month" the same days of the last month.</summary>
/// <param name="Kind"><c>previous</c> (equal length, directly before) or <c>same-days-last-month</c>.</param>
public readonly record struct PreviousPeriod(string Kind, DateOnly From, DateOnly To);

/// <summary>
/// The one period vocabulary of the Dashboard (UX review 2, P3) for Summary, Trends and Coverage: <c>7d</c>, <c>30d</c> (default), <c>90d</c>,
/// <c>this-month</c> (first day to today), <c>last-month</c> (the whole previous calendar month), <c>6m</c> (183 days), <c>12m</c> (365 days) and
/// <c>custom</c> (<c>from</c> and <c>to</c>, both inclusive, at most 366 days). Everything is resolved from the viewer's local "today", so the
/// boundaries follow the viewer's time zone and a fixed clock gives fixed ranges. The old <c>periodDays</c> argument is still understood for one release.
/// </summary>
public static class DashboardPeriods
{
    public const string Custom = "custom";
    public const string Default = "30d";

    public static readonly IReadOnlyList<string> Keys = ["7d", "30d", "90d", "this-month", "last-month", "6m", "12m", Custom];

    /// <summary>
    /// Resolves the arguments of a request. Precedence: <paramref name="from"/> and <paramref name="to"/> (a custom period), then <paramref name="period"/>,
    /// then the legacy <paramref name="periodDays"/>, then the default of 30 days.
    /// </summary>
    public static Result<ResolvedPeriod> Resolve(string? period, DateOnly? from, DateOnly? to, int? periodDays, DateOnly today)
    {
        var key = string.IsNullOrWhiteSpace(period) ? null : period.Trim().ToLowerInvariant();
        if (key is not null && !Keys.Contains(key))
            return Error.Validation("period", "PERIOD_INVALID", $"Unknown period '{period}'. Allowed: {string.Join(", ", Keys)}.");

        if (from is not null || to is not null || key == Custom)
        {
            if (key is not null && key != Custom)
                return Error.Validation("period", "PERIOD_INVALID", "Give either a period or from and to, not both.");
            if (from is null || to is null)
                return Error.Validation("from", "PERIOD_INVALID", "Give both from and to, or neither.");
            if (from > to)
                return Error.Validation("from", "PERIOD_INVALID", "The start of the period is after its end.");
            if (to.Value.DayNumber - from.Value.DayNumber + 1 > DashboardRules.MaxPeriodDays)
                return Error.Validation("to", "PERIOD_TOO_LONG", $"The period can be at most {DashboardRules.MaxPeriodDays} days.");
            return new ResolvedPeriod(Custom, from.Value, to.Value);
        }

        if (key is null)
        {
            if (periodDays is { } days)
                return new ResolvedPeriod(days == 7 ? "7d" : days == 30 ? "30d" : days == 90 ? "90d" : "days", DashboardRules.PeriodStart(today, days), today);
            key = Default;
        }

        return key switch
        {
            "7d" => new ResolvedPeriod(key, DashboardRules.PeriodStart(today, 7), today),
            "30d" => new ResolvedPeriod(key, DashboardRules.PeriodStart(today, 30), today),
            "90d" => new ResolvedPeriod(key, DashboardRules.PeriodStart(today, 90), today),
            "6m" => new ResolvedPeriod(key, DashboardRules.PeriodStart(today, 183), today),
            "12m" => new ResolvedPeriod(key, DashboardRules.PeriodStart(today, 365), today),
            "this-month" => new ResolvedPeriod(key, new DateOnly(today.Year, today.Month, 1), today),
            _ => LastMonth(today),
        };
    }

    /// <summary>
    /// The period the figures of <paramref name="period"/> are compared with: the same number of days directly before it. "This month" (first day to today) is
    /// compared with the same days of the last month (its first day to the same day number, at most the whole month), so a month is never compared with a longer or shorter span.
    /// </summary>
    public static PreviousPeriod Previous(ResolvedPeriod period)
    {
        if (period.Key == "this-month")
        {
            var first = period.From.AddMonths(-1);
            var days = Math.Min(period.Days, DateTime.DaysInMonth(first.Year, first.Month));
            return new PreviousPeriod("same-days-last-month", first, first.AddDays(days - 1));
        }

        var length = period.Days;
        return new PreviousPeriod("previous", period.From.AddDays(-length), period.From.AddDays(-1));
    }

    private static ResolvedPeriod LastMonth(DateOnly today)
    {
        var first = new DateOnly(today.Year, today.Month, 1).AddMonths(-1);
        return new ResolvedPeriod("last-month", first, first.AddMonths(1).AddDays(-1));
    }
}
