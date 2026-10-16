using MatterFlow.SharedKernel.Results;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>A resolved Dashboard period: the keyword it came from and the first and last local day (both inclusive, the viewer's zone).</summary>
public readonly record struct ResolvedPeriod(string Key, DateOnly From, DateOnly To)
{
    public int Days => To.DayNumber - From.DayNumber + 1;
}

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

    private static ResolvedPeriod LastMonth(DateOnly today)
    {
        var first = new DateOnly(today.Year, today.Month, 1).AddMonths(-1);
        return new ResolvedPeriod("last-month", first, first.AddMonths(1).AddDays(-1));
    }
}
