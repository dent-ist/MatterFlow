namespace LptHub.SharedKernel.Availability;

/// <summary>Coverage levels of a day or a pod (Dashboard Calendar, plan section 3).</summary>
public static class CoverageLevels
{
    public const string Good = "GOOD";
    public const string Watch = "WATCH";
    public const string Low = "LOW";
    public const string Critical = "CRITICAL";

    /// <summary>Nobody is expected because of a holiday (a firm closure).</summary>
    public const string Closed = "CLOSED";

    /// <summary>A weekend or a day nobody works.</summary>
    public const string NonWorking = "NON_WORKING";

    /// <summary>True for the levels that make a day a risk day.</summary>
    public static bool IsRisk(string level) => level is Watch or Low or Critical;
}

/// <summary>The coverage thresholds in force: the firm minimum and the pod minimum, both as a percent of the people expected.</summary>
public sealed record CoverageThresholds(int MinCoveragePercent, int PodMinimumPercent)
{
    public const int DefaultMinCoveragePercent = 75;
    public const int DefaultPodMinimumPercent = 60;

    public static CoverageThresholds Default { get; } = new(DefaultMinCoveragePercent, DefaultPodMinimumPercent);
}

/// <summary>One pod on one day: the people expected, the people available and the minimum in force.</summary>
public sealed record PodDayStat(int PodId, int Expected, int Available, int Minimum);

/// <summary>
/// Pure coverage maths of the Dashboard Calendar (plan section 3), ported from the mockup (<c>dayStat</c>, <c>level</c>, <c>podLevel</c>, <c>forecast</c>) with the
/// level rules of the plan: CRITICAL below the pod percent or when a pod with people expected has nobody available, LOW below the firm percent, WATCH when the firm is
/// fine but a pod is below its minimum, GOOD otherwise, CLOSED when nobody is expected because of a holiday, NON_WORKING when nobody is expected for any other reason.
/// </summary>
public static class CalendarCoverage
{
    /// <summary>Available over expected as a whole percent (half away from zero); null when nobody is expected (no division by zero).</summary>
    public static int? CoveragePercent(int expected, int available) =>
        expected <= 0 ? null : (int)Math.Round(100.0 * available / expected, MidpointRounding.AwayFromZero);

    /// <summary>The minimum people of a pod: the per-pod override when set, otherwise the pod percent of the people expected rounded up; never more than the people expected.</summary>
    public static int PodMinimum(int expected, int? overridePeople, int podMinimumPercent)
    {
        var minimum = overridePeople ?? (int)Math.Ceiling(podMinimumPercent * expected / 100.0);
        return Math.Max(0, Math.Min(minimum, expected));
    }

    /// <summary>The level of a day. <paramref name="onHoliday"/> only decides between CLOSED and NON_WORKING when nobody is expected.</summary>
    public static string DayLevel(int expected, int available, int onHoliday, IReadOnlyCollection<PodDayStat> pods, CoverageThresholds thresholds)
    {
        ArgumentNullException.ThrowIfNull(pods);
        ArgumentNullException.ThrowIfNull(thresholds);
        if (expected <= 0)
            return onHoliday > 0 ? CoverageLevels.Closed : CoverageLevels.NonWorking;

        var below = (long)available * 100 < (long)thresholds.PodMinimumPercent * expected;
        if (below || pods.Any(p => p.Expected > 0 && p.Available == 0))
            return CoverageLevels.Critical;
        if ((long)available * 100 < (long)thresholds.MinCoveragePercent * expected)
            return CoverageLevels.Low;
        return pods.Any(p => p.Available < p.Minimum) ? CoverageLevels.Watch : CoverageLevels.Good;
    }

    /// <summary>The level of one pod: CLOSED when nobody is expected; CRITICAL with nobody available; at or above its minimum GOOD or WATCH by the firm percent; below it LOW, or CRITICAL at half the minimum or less.</summary>
    public static string PodLevel(PodDayStat pod, CoverageThresholds thresholds)
    {
        ArgumentNullException.ThrowIfNull(pod);
        ArgumentNullException.ThrowIfNull(thresholds);
        if (pod.Expected <= 0)
            return CoverageLevels.Closed;
        if (pod.Available == 0)
            return CoverageLevels.Critical;
        if (pod.Available >= Math.Min(pod.Minimum, pod.Expected))
            return (long)pod.Available * 100 >= (long)thresholds.MinCoveragePercent * pod.Expected ? CoverageLevels.Good : CoverageLevels.Watch;
        return pod.Available <= pod.Minimum / 2 ? CoverageLevels.Critical : CoverageLevels.Low;
    }

    /// <summary>
    /// Free capacity of one week: <c>(slots x average available - open) / (slots x average available)</c> as a whole percent clamped to 0 to 100 (half away from zero);
    /// null when nobody is available on any working day of the week. <paramref name="availablePerWorkingDay"/> has one entry per working day (a day with people expected).
    /// </summary>
    public static (double AveragePeople, int? FreePercent) Forecast(IReadOnlyCollection<int> availablePerWorkingDay, int openTasks, int slotsPerPerson)
    {
        ArgumentNullException.ThrowIfNull(availablePerWorkingDay);
        if (availablePerWorkingDay.Count == 0)
            return (0, null);
        var average = availablePerWorkingDay.Average();
        if (average <= 0)
            return (0, null);
        var slots = slotsPerPerson * average;
        var free = (slots - openTasks) / slots * 100.0;
        return (Math.Round(average, 1, MidpointRounding.AwayFromZero), (int)Math.Round(Math.Clamp(free, 0, 100), MidpointRounding.AwayFromZero));
    }
}
