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

    /// <summary>Most Task Types the Trends tab draws a line for at once.</summary>
    public const int MaxTrendTypes = 8;

    public static readonly IReadOnlyList<string> TrendMetrics = ["created", "completed"];

    /// <summary>Task Types shown individually before the rest is folded into "Other task types".</summary>
    public const int TopTypes = 8;

    public static readonly IReadOnlyList<AgingBand> AgingBands =
    [
        new("0-2", "0-2 days", 0, 2),
        new("3-7", "3-7 days", 3, 7),
        new("8-14", "8-14 days", 8, 14),
        new("15+", "15+ days", 15, null),
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
    public static IReadOnlyList<DashboardBreakdownItem> TopWithOther(
        IEnumerable<DashboardBreakdownItem> items,
        int top,
        string otherLabel,
        Func<IReadOnlyList<DashboardBreakdownItem>, string?>? restQuery = null)
    {
        ArgumentNullException.ThrowIfNull(items);
        var ordered = items.Where(i => i.Count > 0).OrderByDescending(i => i.Count).ThenBy(i => i.Label, StringComparer.CurrentCultureIgnoreCase).ToList();
        if (ordered.Count <= top)
            return ordered;

        var kept = ordered.Take(top).ToList();
        var rest = ordered.Skip(top).Sum(i => i.Count);
        var folded = ordered.Skip(top).ToList();
        kept.Add(new DashboardBreakdownItem(null, null, otherLabel, rest, restQuery?.Invoke(folded), true));
        return kept;
    }

    /// <summary>
    /// The daily series of a period: one point per local day from <paramref name="from"/> to <paramref name="today"/> (both inclusive), counting the given
    /// instants into the local day they fall in. <paramref name="startOfDayUtc"/> maps a local date to the UTC instant it starts, so DST days work.
    /// </summary>
    public static IReadOnlyList<DashboardTrendPoint> Trend(
        DateOnly from,
        DateOnly today,
        IEnumerable<DateTime> created,
        IEnumerable<DateTime> completed,
        Func<DateOnly, DateTime> startOfDayUtc)
    {
        ArgumentNullException.ThrowIfNull(created);
        ArgumentNullException.ThrowIfNull(completed);
        ArgumentNullException.ThrowIfNull(startOfDayUtc);
        var days = today.DayNumber - from.DayNumber + 1;
        if (days <= 0)
            return [];

        var edges = Enumerable.Range(0, days + 1).Select(i => startOfDayUtc(from.AddDays(i)).Ticks).ToArray();
        var createdCounts = new int[days];
        var completedCounts = new int[days];

        void Count(IEnumerable<DateTime> instants, int[] into)
        {
            foreach (var instant in instants)
            {
                var found = Array.BinarySearch(edges, instant.Ticks);
                var day = found >= 0 ? found : ~found - 1;
                if (day >= 0 && day < days)
                    into[day]++;
            }
        }

        Count(created, createdCounts);
        Count(completed, completedCounts);
        return [.. Enumerable.Range(0, days).Select(i => new DashboardTrendPoint(from.AddDays(i), createdCounts[i], completedCounts[i]))];
    }

    /// <summary>
    /// The daily series per Task Type: one point per local day from <paramref name="from"/> to <paramref name="today"/>, with the same day assignment as
    /// <see cref="Trend"/>. Returns the department series (<c>All</c>, the sum of every type, so it equals <see cref="Trend"/> for the same instants), the
    /// series of each id in <paramref name="wanted"/> (in that order, zeros when the type has no Task) and the in-period totals of every type that has any.
    /// </summary>
    public static TrendByType TrendByTaskType(
        DateOnly from,
        DateOnly today,
        IEnumerable<(int TypeId, DateTime At)> created,
        IEnumerable<(int TypeId, DateTime At)> completed,
        Func<DateOnly, DateTime> startOfDayUtc,
        IReadOnlyList<int> wanted)
    {
        ArgumentNullException.ThrowIfNull(created);
        ArgumentNullException.ThrowIfNull(completed);
        ArgumentNullException.ThrowIfNull(startOfDayUtc);
        ArgumentNullException.ThrowIfNull(wanted);
        var days = today.DayNumber - from.DayNumber + 1;
        if (days <= 0)
            return new TrendByType([], [.. wanted.Select(id => new DashboardTypeSeries(id, []))], new Dictionary<int, (int, int)>());

        var edges = Enumerable.Range(0, days + 1).Select(i => startOfDayUtc(from.AddDays(i)).Ticks).ToArray();
        var perType = new Dictionary<int, (int[] Created, int[] Completed)>();
        var all = (Created: new int[days], Completed: new int[days]);

        (int[] Created, int[] Completed) Row(int id)
        {
            if (!perType.TryGetValue(id, out var row))
                perType[id] = row = (new int[days], new int[days]);
            return row;
        }

        void Count(IEnumerable<(int TypeId, DateTime At)> items, bool isCreated)
        {
            foreach (var (typeId, at) in items)
            {
                var found = Array.BinarySearch(edges, at.Ticks);
                var day = found >= 0 ? found : ~found - 1;
                if (day < 0 || day >= days)
                    continue;
                var row = Row(typeId);
                (isCreated ? row.Created : row.Completed)[day]++;
                (isCreated ? all.Created : all.Completed)[day]++;
            }
        }

        Count(created, true);
        Count(completed, false);

        IReadOnlyList<DashboardTrendPoint> Points(int[] c, int[] d) => [.. Enumerable.Range(0, days).Select(i => new DashboardTrendPoint(from.AddDays(i), c[i], d[i]))];

        var series = wanted.Select(id => perType.TryGetValue(id, out var row)
            ? new DashboardTypeSeries(id, Points(row.Created, row.Completed))
            : new DashboardTypeSeries(id, Points(new int[days], new int[days]))).ToList();
        var totals = perType.ToDictionary(p => p.Key, p => (p.Value.Created.Sum(), p.Value.Completed.Sum()));
        return new TrendByType(Points(all.Created, all.Completed), series, totals);
    }

    private static IEnumerable<string> StatusParams(params TaskStatusCode[] statuses) => statuses.Select(s => "status=" + s.ToCode());
}

/// <summary>Result of <see cref="DashboardRules.TrendByTaskType"/>: the department series, the requested type series and every type's in-period totals.</summary>
public sealed record TrendByType(
    IReadOnlyList<DashboardTrendPoint> All,
    IReadOnlyList<DashboardTypeSeries> Series,
    IReadOnlyDictionary<int, (int Created, int Completed)> Totals);
