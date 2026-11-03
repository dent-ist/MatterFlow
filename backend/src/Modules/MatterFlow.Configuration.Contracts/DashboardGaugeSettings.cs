using System.Globalization;

namespace MatterFlow.Configuration.Contracts;

/// <summary>
/// The Dashboard unassigned-gauge settings (Dashboard v4, decision AS item 7): the firm's working day used to measure how long the oldest unassigned Task has waited, the age basis, and the level steps.
/// Defaults live in code (no seed row, like the branding): 8 AM to 6 PM, Monday to Friday, working hours, one level per hour up to 5, plus one level per 5 unassigned Tasks at most +2.
/// The time zone is the firm zone (<c>Firm:TimeZoneId</c>), the one the availability rules use.
/// </summary>
/// <param name="WorkdayStart">Start of the working day (firm zone).</param>
/// <param name="WorkdayEnd">End of the working day (firm zone), after <paramref name="WorkdayStart"/>.</param>
/// <param name="WorkDays">ISO weekdays that are working days (1 Monday to 7 Sunday), at least one.</param>
/// <param name="AgeBasis"><see cref="GaugeAgeBasis.Working"/> counts only working minutes, <see cref="GaugeAgeBasis.Clock"/> every minute.</param>
/// <param name="LevelHours">Hours of age that reach level 1, 2, 3, 4 and 5 (five strictly increasing values).</param>
/// <param name="TasksPerLevel">One extra level for each this many unassigned Tasks.</param>
/// <param name="CountBonusMax">The most extra levels the number of Tasks can add.</param>
public sealed record DashboardGaugeSettings(
    TimeOnly WorkdayStart,
    TimeOnly WorkdayEnd,
    IReadOnlyList<int> WorkDays,
    string AgeBasis,
    IReadOnlyList<int> LevelHours,
    int TasksPerLevel,
    int CountBonusMax)
{
    public const int MaxLevel = 5;

    /// <summary>The code defaults.</summary>
    public static DashboardGaugeSettings Default { get; } = new(new TimeOnly(8, 0), new TimeOnly(18, 0), [1, 2, 3, 4, 5], GaugeAgeBasis.Working, [1, 2, 3, 4, 5], 5, 2);

    /// <summary>Checks the values; returns one message per problem (empty = valid). Used by the settings form and the loader.</summary>
    public IReadOnlyList<string> Validate()
    {
        var problems = new List<string>();
        if (WorkdayStart >= WorkdayEnd)
            problems.Add("The working day must start before it ends.");
        if (WorkDays.Count == 0 || WorkDays.Any(d => d is < 1 or > 7) || WorkDays.Distinct().Count() != WorkDays.Count)
            problems.Add("Choose at least one working day (1 Monday to 7 Sunday, each once).");
        if (AgeBasis is not (GaugeAgeBasis.Working or GaugeAgeBasis.Clock))
            problems.Add("The age basis must be WORKING or CLOCK.");
        if (LevelHours.Count != MaxLevel || LevelHours.Any(h => h is < 1 or > 168) || LevelHours.Zip(LevelHours.Skip(1), (a, b) => a >= b).Any(x => x))
            problems.Add("Level hours must be five increasing whole numbers of hours (1 to 168).");
        if (TasksPerLevel is < 1 or > 1000)
            problems.Add("Tasks per level must be between 1 and 1000.");
        if (CountBonusMax is < 0 or > MaxLevel)
            problems.Add("The most extra levels must be between 0 and 5.");
        return problems;
    }

    public static string FormatTime(TimeOnly time) => time.ToString("HH':'mm", CultureInfo.InvariantCulture);

    public static bool TryParseTime(string? text, out TimeOnly time) => TimeOnly.TryParseExact(text, "HH':'mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out time);
}

/// <summary>The age basis values.</summary>
public static class GaugeAgeBasis
{
    public const string Working = "WORKING";
    public const string Clock = "CLOCK";
}

/// <summary>Reads the Dashboard settings for the WorkViews module: the stored values, or the code defaults when nothing (or something invalid) is stored.</summary>
public interface IDashboardSettings
{
    Task<DashboardGaugeSettings> GetGaugeAsync(CancellationToken cancellationToken = default);
}
