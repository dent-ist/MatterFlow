using System.Globalization;
using MatterFlow.SharedKernel.Tasks;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>One age band: whole calendar days since creation, counted in the viewer's zone (<c>MaxDays</c> null: no upper limit).</summary>
public sealed record AgingBand(string Key, string Label, int MinDays, int? MaxDays);

/// <summary>
/// The pure Dashboard rules: period dates, aging bands, top-N folding and the Task Queue query strings behind every number. The query strings use
/// exactly the parameter names of the Task Queue so a drill-through lists the counted Tasks (checked end to end by the integration tests).
/// </summary>
public static class DashboardRules
{
    public const int DefaultPeriodDays = 30;
    public const int MaxPeriodDays = 365;
    public const int TopN = 8;
    public const int RecentCount = 10;

    public static readonly IReadOnlyList<AgingBand> AgingBands =
    [
        new("0-2", "0-2 days", 0, 2),
        new("3-7", "3-7 days", 3, 7),
        new("8-14", "8-14 days", 8, 14),
        new("15-30", "15-30 days", 15, 30),
        new("30+", "Over 30 days", 31, null),
    ];

    /// <summary>The Task Queue status filter for open Tasks.</summary>
    public static string OpenQuery { get; } = Join(StatusParams(TaskStatusCode.New, TaskStatusCode.InProgress, TaskStatusCode.OnHold));

    public static string Unassigned { get; } = Open("unassigned=true");

    public static string Overdue { get; } = Open("overdue=true");

    public static string OnHold { get; } = Status(TaskStatusCode.OnHold);

    public static string AsapOpen { get; } = Open("asap=true");

    /// <summary>The first local day of a period of <paramref name="days"/> days that ends today.</summary>
    public static DateOnly PeriodStart(DateOnly today, int days) => today.AddDays(-(days - 1));

    public static string Date(DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>Open Tasks plus the given extra parameters.</summary>
    public static string Open(params string[] extra) => Join([OpenQuery, .. extra]);

    public static string Status(TaskStatusCode status, params string[] extra) => Join([.. StatusParams(status), .. extra]);

    /// <summary>Due soon: open with an explicit due date, not yet overdue, due by the end of <paramref name="lastDay"/> (ASAP excluded).</summary>
    public static string DueSoon(DateOnly lastDay) => Open("asap=false", "overdue=false", "dueTo=" + Date(lastDay));

    public static string Completed(DateOnly from) => Status(TaskStatusCode.Completed, "completedFrom=" + Date(from));

    public static string Created(DateOnly from) => "createdFrom=" + Date(from);

    public static string Join(IEnumerable<string> parts) => string.Join('&', parts);

    /// <summary>The query of an age band: open Tasks created between <c>today - max</c> and <c>today - min</c> (local dates).</summary>
    public static string Aging(AgingBand band, DateOnly today)
    {
        ArgumentNullException.ThrowIfNull(band);
        var extra = new List<string>();
        if (band.MaxDays is { } max)
            extra.Add("createdFrom=" + Date(today.AddDays(-max)));
        extra.Add("createdTo=" + Date(today.AddDays(-band.MinDays)));
        return Open([.. extra]);
    }

    /// <summary>
    /// Keeps the <paramref name="top"/> largest items (ties by label) and folds the rest into one "Other" row without a drill-through (the Task
    /// Queue cannot express "all but these"). Items with a count of zero are dropped. The result is ordered largest first, "Other" last.
    /// </summary>
    public static IReadOnlyList<DashboardBreakdownItem> TopWithOther(IEnumerable<DashboardBreakdownItem> items, int top, string otherLabel)
    {
        ArgumentNullException.ThrowIfNull(items);
        var ordered = items.Where(i => i.Count > 0).OrderByDescending(i => i.Count).ThenBy(i => i.Label, StringComparer.CurrentCultureIgnoreCase).ToList();
        if (ordered.Count <= top)
            return ordered;

        var kept = ordered.Take(top).ToList();
        var rest = ordered.Skip(top).Sum(i => i.Count);
        kept.Add(new DashboardBreakdownItem(null, null, otherLabel, rest, null, true));
        return kept;
    }

    private static IEnumerable<string> StatusParams(params TaskStatusCode[] statuses) => statuses.Select(s => "status=" + s.ToCode());
}
