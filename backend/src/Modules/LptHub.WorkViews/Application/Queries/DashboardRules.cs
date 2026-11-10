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
    public const int MaxPeriodDays = 366;

    /// <summary>Most Task Types the Trends tab draws a line for at once.</summary>
    public const int MaxTrendTypes = 8;

    public static readonly IReadOnlyList<string> TrendMetrics = ["created", "completed", "overdue", "ontime", "late", "open"];

    /// <summary>Longest period (in days) the Trends tab draws one point per day for; longer ones are bucketed by week (Monday to Sunday).</summary>
    public const int MaxDailyTrendDays = 31;

    public const string DayGranularity = "day";
    public const string WeekGranularity = "week";

    /// <summary>"day" up to <see cref="MaxDailyTrendDays"/> days, else "week".</summary>
    public static string TrendGranularity(int days) => days > MaxDailyTrendDays ? WeekGranularity : DayGranularity;

    /// <summary>The Monday of the week the date is in (weeks run Monday to Sunday whatever the locale).</summary>
    public static DateOnly WeekStart(DateOnly date) => date.AddDays(-(((int)date.DayOfWeek + 6) % 7));

    /// <summary>
    /// Buckets daily points by week (Monday to Sunday): flows are summed, the stocks (Overdue, Open) take the value of the last day of the bucket (the
    /// current week: now). A bucket is dated by its Monday, which can be before the first day of the period; the first and last buckets only hold the days
    /// of the period.
    /// </summary>
    public static IReadOnlyList<DashboardTrendDay> ToWeeks(IReadOnlyList<DashboardTrendDay> days)
    {
        ArgumentNullException.ThrowIfNull(days);
        var weeks = new List<DashboardTrendDay>();
        foreach (var d in days)
        {
            var monday = WeekStart(d.Date);
            if (weeks.Count > 0 && weeks[^1].Date == monday)
            {
                var w = weeks[^1];
                weeks[^1] = new DashboardTrendDay(monday, w.Created + d.Created, w.Completed + d.Completed, d.Overdue, w.OnTime + d.OnTime, w.Late + d.Late, d.Open);
            }
            else
            {
                weeks.Add(d with { Date = monday });
            }
        }

        return weeks;
    }

    /// <summary>Task Types shown individually before the rest is folded into "Other task types".</summary>
    public const int TopTypes = 8;

    public static readonly IReadOnlyList<AgingBand> AgingBands =
    [
        new("0-2", "0-2 days", 0, 2),
        new("3-7", "3-7 days", 3, 7),
        new("8-14", "8-14 days", 8, 14),
        new("15-30", "15-30 days", 15, 30),
        new("31-60", "31-60 days", 31, 60),
        new("61+", "More than 60 days", 61, null),
    ];

    /// <summary>The Task Queue status filter for open Tasks.</summary>
    public static string OpenQuery { get; } = Join(StatusParams(TaskStatusCode.New, TaskStatusCode.InProgress, TaskStatusCode.OnHold));

    public static string Unassigned { get; } = Open("unassigned=true");

    public static string Overdue { get; } = Open("overdue=true");

    /// <summary>Overdue and one of the given priorities (the plain overdue query when there are none).</summary>
    public static string OverdueWith(IReadOnlyList<int> priorityIds) => Open(["overdue=true", .. priorityIds.Order().Select(id => "priority=" + id)]);

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

    /// <summary>Completed Tasks from <paramref name="from"/>; <paramref name="to"/> is given only when the period ends before today (a period that ends today stays open-ended, so the list grows with the day).</summary>
    public static string Completed(DateOnly from, DateOnly? to = null) =>
        Status(TaskStatusCode.Completed, to is { } end ? ["completedFrom=" + Date(from), "completedTo=" + Date(end)] : ["completedFrom=" + Date(from)]);

    /// <summary>Created Tasks from <paramref name="from"/>; see <see cref="Completed"/> for <paramref name="to"/>.</summary>
    public static string Created(DateOnly from, DateOnly? to = null) =>
        to is { } end ? "createdFrom=" + Date(from) + "&createdTo=" + Date(end) : "createdFrom=" + Date(from);

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
        kept.Add(new DashboardBreakdownItem(null, null, otherLabel, rest, restQuery?.Invoke(folded), true, null, folded.Sum(i => i.Overdue)));
        return kept;
    }

    /// <summary>
    /// The daily series per Task Type: one point per local day from <paramref name="from"/> to <paramref name="today"/>, with each instant counted into the viewer's local day it falls in (<paramref name="startOfDayUtc"/> maps a local date to the UTC instant it starts, so DST days work). Returns the department series (<c>All</c>, the sum of every type), the series of each id in <paramref name="wanted"/> (in that order, zeros when the type has no Task) and the totals of every type that has any.
    /// <para>
    /// <b>Overdue</b> is a snapshot per day: the Tasks that, at the end of that local day, were created, had a due moment that had passed (a timed due: the
    /// instant; a date-only due: after 23:59:59 of that date in the viewer's zone, as the Task Queue does) and were not yet closed. For today the snapshot is taken
    /// at <paramref name="nowUtc"/>. A Task is closed from its last status change when it is Completed or Cancelled; a Task that is open now counts as open for its
    /// whole life (the status history is not replayed), and the current due date is used for every day. <b>Open</b> is the same kind of snapshot: the Tasks
    /// created by the snapshot instant and not yet Completed or Cancelled at it (New, In Progress and On hold count, ASAP too). <paramref name="openAtStart"/>
    /// holds, per Task Type, the Tasks created by the first snapshot that are still open now; <paramref name="openTasks"/> every other Task created by the
    /// last snapshot that is not closed by the first one (created later in the period, or closed during it). Periods longer than
    /// <see cref="MaxDailyTrendDays"/> days come back bucketed by week (<see cref="ToWeeks"/>). <b>On time</b> / <b>Late</b> count, per local day,
    /// the Tasks with a due date completed that day on or before / after their due moment. Tasks without a due date (ASAP) are in neither.
    /// </para>
    /// </summary>
    public static TrendByType TrendByTaskType(
        DateOnly from,
        DateOnly today,
        IEnumerable<(int TypeId, DateTime At)> created,
        IEnumerable<(int TypeId, DateTime At)> completed,
        IEnumerable<DueTask> dueTasks,
        Func<DateOnly, DateTime> startOfDayUtc,
        DateTime nowUtc,
        IReadOnlyList<int> wanted,
        IEnumerable<OpenTask>? openTasks = null,
        IReadOnlyDictionary<int, int>? openAtStart = null)
    {
        ArgumentNullException.ThrowIfNull(created);
        ArgumentNullException.ThrowIfNull(completed);
        ArgumentNullException.ThrowIfNull(dueTasks);
        ArgumentNullException.ThrowIfNull(startOfDayUtc);
        ArgumentNullException.ThrowIfNull(wanted);
        var days = today.DayNumber - from.DayNumber + 1;
        if (days <= 0)
            return new TrendByType([], [.. wanted.Select(id => new DashboardTypeSeries(id, []))], new Dictionary<int, TrendTypeTotals>(), DayGranularity);

        var edges = Enumerable.Range(0, days + 1).Select(i => startOfDayUtc(from.AddDays(i)).Ticks).ToArray();
        // The instant each day's snapshot is taken: its end, or now for today.
        var snaps = Enumerable.Range(0, days).Select(i => Math.Min(edges[i + 1], Math.Max(edges[i], nowUtc.Ticks))).ToArray();
        var boundary = new Dictionary<DateOnly, long>();
        long EndOfDueDate(DateOnly d)
        {
            if (!boundary.TryGetValue(d, out var ticks))
                boundary[d] = ticks = d == DateOnly.MaxValue ? long.MaxValue : startOfDayUtc(d.AddDays(1)).Ticks;
            return ticks;
        }

        var perType = new Dictionary<int, int[][]>(); // [created, completed, overdue, onTime, late]
        var all = Enumerable.Range(0, 5).Select(_ => new int[days]).ToArray();

        int[][] Row(int id)
        {
            if (!perType.TryGetValue(id, out var row))
                perType[id] = row = [.. Enumerable.Range(0, 5).Select(_ => new int[days + 1])];
            return row;
        }

        int DayOf(DateTime at)
        {
            var found = Array.BinarySearch(edges, at.Ticks);
            var day = found >= 0 ? found : ~found - 1;
            return day >= 0 && day < days ? day : -1;
        }

        void Add(int typeId, int measure, int day)
        {
            Row(typeId)[measure][day]++;
            all[measure][day]++;
        }

        foreach (var (typeId, at) in created)
        {
            if (DayOf(at) is var day and >= 0)
                Add(typeId, 0, day);
        }

        foreach (var (typeId, at) in completed)
        {
            if (DayOf(at) is var day and >= 0)
                Add(typeId, 1, day);
        }

        // Smallest day whose snapshot is at or after the instant (days when none is).
        int FirstSnapAtOrAfter(long ticks)
        {
            int lo = 0, hi = days;
            while (lo < hi)
            {
                var mid = (lo + hi) / 2;
                if (snaps[mid] >= ticks)
                    hi = mid;
                else
                    lo = mid + 1;
            }

            return lo;
        }

        var overdueDiff = new Dictionary<int, int[]>();
        var overdueAll = new int[days + 1];
        foreach (var t in dueTasks)
        {
            if (t.DueAtUtc is null && t.DueDate is null)
                continue;
            var dueTicks = t.DueAtUtc is { } at ? at.Ticks : EndOfDueDate(t.DueDate!.Value);
            var closed = t.Status is TaskStatusCode.Completed or TaskStatusCode.Cancelled;

            if (closed && t.Status == TaskStatusCode.Completed && DayOf(t.StatusChangedAtUtc) is var day and >= 0)
            {
                var onTime = t.DueAtUtc is not null ? t.StatusChangedAtUtc.Ticks <= dueTicks : t.StatusChangedAtUtc.Ticks < dueTicks;
                Add(t.TypeId, onTime ? 3 : 4, day);
            }

            var start = FirstSnapAtOrAfter(Math.Max(t.CreatedAtUtc.Ticks, dueTicks));
            var end = closed ? FirstSnapAtOrAfter(t.StatusChangedAtUtc.Ticks) : days;
            if (start >= end)
                continue;
            if (!overdueDiff.TryGetValue(t.TypeId, out var diff))
                overdueDiff[t.TypeId] = diff = new int[days + 1];
            diff[start]++;
            diff[end]--;
            overdueAll[start]++;
            overdueAll[end]--;
        }

        // Open at the end of each day: baseline at the first snapshot, then +1 from the first snapshot at or after creation, -1 from the first one at or after closing.
        var openDiff = new Dictionary<int, int[]>();
        var openAll = new int[days + 1];
        int[] OpenRow(int typeId)
        {
            if (!openDiff.TryGetValue(typeId, out var diff))
                openDiff[typeId] = diff = new int[days + 1];
            return diff;
        }

        foreach (var (typeId, count) in openAtStart ?? new Dictionary<int, int>())
        {
            OpenRow(typeId)[0] += count;
            openAll[0] += count;
        }

        foreach (var t in openTasks ?? [])
        {
            var start = FirstSnapAtOrAfter(t.CreatedAtUtc.Ticks);
            var end = t.Closed ? FirstSnapAtOrAfter(t.StatusChangedAtUtc.Ticks) : days;
            if (start >= end)
                continue;
            var diff = OpenRow(t.TypeId);
            diff[start]++;
            diff[end]--;
            openAll[start]++;
            openAll[end]--;
        }

        int[] Running(int[] diff)
        {
            var values = new int[days];
            var sum = 0;
            for (var i = 0; i < days; i++)
            {
                sum += diff[i];
                values[i] = sum;
            }

            return values;
        }

        var overdueByType = overdueDiff.ToDictionary(p => p.Key, p => Running(p.Value));
        all[2] = Running(overdueAll);
        var openByType = openDiff.ToDictionary(p => p.Key, p => Running(p.Value));
        var openTotal = Running(openAll);
        var granularity = TrendGranularity(days);

        IReadOnlyList<DashboardTrendDay> Points(int[] c, int[] d, int[] o, int[] ot, int[] l, int[] open)
        {
            IReadOnlyList<DashboardTrendDay> daily =
                [.. Enumerable.Range(0, days).Select(i => new DashboardTrendDay(from.AddDays(i), c[i], d[i], o[i], ot[i], l[i], open[i]))];
            return granularity == WeekGranularity ? ToWeeks(daily) : daily;
        }

        int[] Zeros() => new int[days];
        var series = wanted.Select(id =>
        {
            var row = perType.GetValueOrDefault(id);
            return new DashboardTypeSeries(
                id,
                Points(row?[0] ?? Zeros(), row?[1] ?? Zeros(), overdueByType.GetValueOrDefault(id) ?? Zeros(), row?[3] ?? Zeros(), row?[4] ?? Zeros(), openByType.GetValueOrDefault(id) ?? Zeros()));
        }).ToList();

        var ids = perType.Keys.Union(overdueByType.Keys).Union(openByType.Keys).ToList();
        var totals = ids.ToDictionary(
            id => id,
            id =>
            {
                var row = perType.GetValueOrDefault(id);
                return new TrendTypeTotals(
                    row?[0].Take(days).Sum() ?? 0,
                    row?[1].Take(days).Sum() ?? 0,
                    overdueByType.TryGetValue(id, out var o) ? o[days - 1] : 0,
                    row?[3].Take(days).Sum() ?? 0,
                    row?[4].Take(days).Sum() ?? 0,
                    openByType.TryGetValue(id, out var open) ? open[days - 1] : 0);
            });
        return new TrendByType(Points(all[0], all[1], all[2], all[3], all[4], openTotal), series, totals, granularity);
    }

    private static IEnumerable<string> StatusParams(params TaskStatusCode[] statuses) => statuses.Select(s => "status=" + s.ToCode());
}

/// <summary>A Task with a due date as the trend sees it: when it was created, its due moment (<c>DueAtUtc</c> for a timed due, else the date-only <c>DueDate</c>) and its current status with the time of its last status change.</summary>
public sealed record DueTask(int TypeId, DateTime CreatedAtUtc, DateTime? DueAtUtc, DateOnly? DueDate, TaskStatusCode Status, DateTime StatusChangedAtUtc);

/// <summary>The totals of one Task Type in the period: created, completed, overdue at the end of the period (now), completed on time, completed late and open at the end of the period (now).</summary>
public sealed record TrendTypeTotals(int Created, int Completed, int Overdue, int OnTime, int Late, int Open = 0);

/// <summary>A Task as the Open series sees it: when it was created and, if it is Completed or Cancelled now, that it is <c>Closed</c> and when it last changed status.</summary>
public sealed record OpenTask(int TypeId, DateTime CreatedAtUtc, bool Closed, DateTime StatusChangedAtUtc);

/// <summary>Result of <see cref="DashboardRules.TrendByTaskType"/>: the department series, the requested type series and every type's totals.</summary>
public sealed record TrendByType(
    IReadOnlyList<DashboardTrendDay> All,
    IReadOnlyList<DashboardTypeSeries> Series,
    IReadOnlyDictionary<int, TrendTypeTotals> Totals,
    string Granularity = DashboardRules.DayGranularity);
