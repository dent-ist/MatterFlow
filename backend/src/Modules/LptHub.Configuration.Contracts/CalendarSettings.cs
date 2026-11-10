using LptHub.SharedKernel.Availability;

namespace LptHub.Configuration.Contracts;

/// <summary>The people minimum of one pod (an override of the percent rule).</summary>
public sealed record PodMinimum(int PodId, int People);

/// <summary>
/// The Dashboard Calendar thresholds (decision AT item 10): the firm minimum and the pod minimum as a percent of the people expected (defaults 75 and 60, in code, no seed row)
/// and the optional per-pod minimum in people.
/// </summary>
public sealed record CalendarThresholdSettings(int MinCoveragePercent, int PodMinimumPercent, IReadOnlyList<PodMinimum> PodMinimums)
{
    public static CalendarThresholdSettings Default { get; } = new(CoverageThresholds.DefaultMinCoveragePercent, CoverageThresholds.DefaultPodMinimumPercent, []);

    public CoverageThresholds Thresholds => new(MinCoveragePercent, PodMinimumPercent);

    /// <summary>Checks the values; one message per problem (empty = valid).</summary>
    public IReadOnlyList<string> Validate()
    {
        var problems = new List<string>();
        if (MinCoveragePercent is < 10 or > 100)
            problems.Add("The minimum coverage must be between 10 and 100 percent.");
        if (PodMinimumPercent is < 10 or > 100)
            problems.Add("The pod minimum must be between 10 and 100 percent.");
        if (PodMinimums.Any(p => p.People is < 0 or > 1000) || PodMinimums.Select(p => p.PodId).Distinct().Count() != PodMinimums.Count)
            problems.Add("Each pod can have one minimum of 0 to 1000 people.");
        return problems;
    }
}

/// <summary>Reads the Calendar thresholds kept in <c>dbo.AppSetting</c> for the WorkViews module.</summary>
public interface ICalendarSettings
{
    /// <summary>The thresholds in force: the stored value, or the defaults when nothing (or something invalid) is stored.</summary>
    Task<CalendarThresholdSettings> GetThresholdsAsync(CancellationToken cancellationToken = default);
}
