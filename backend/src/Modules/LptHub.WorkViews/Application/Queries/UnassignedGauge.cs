using System.ComponentModel.DataAnnotations;
using MatterFlow.Configuration.Contracts;
using MatterFlow.SharedKernel.Time;
using Microsoft.Extensions.Configuration;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// The unassigned gauge of the Dashboard Summary (Dashboard v4, decision AS item 7): how long the oldest unassigned Task has waited and the one level (0 to 5) the gauge shows for every viewer.
/// Counted over the Tasks the caller may see in the page scope (the sensitive-matter rule: hidden Tasks are neither counted nor named). Present only with <c>Dashboard.ViewSummary</c>.
/// </summary>
/// <param name="Count">Unassigned open Tasks in scope (the Unassigned card's number).</param>
/// <param name="OldestSinceUtc">Since when the oldest of them has been unassigned (<c>UnassignedAt</c>, or the creation time for rows from before script 57); null when none.</param>
/// <param name="OldestAgeMinutes">The age of that Task in minutes: working minutes when <c>AgeBasis</c> is <c>WORKING</c>, every minute when <c>CLOCK</c>; 0 when none.</param>
/// <param name="AgeBasis"><c>WORKING</c> or <c>CLOCK</c>.</param>
/// <param name="Level">0 (all clear or under the first step) to 5.</param>
/// <param name="AsOfUtc">The instant the age and level were computed for.</param>
public sealed record DashboardUnassignedGauge(
    [property: Required] int Count,
    DateTime? OldestSinceUtc,
    [property: Required] int OldestAgeMinutes,
    [property: Required] string AgeBasis,
    [property: Required] int Level,
    [property: Required] DateTime AsOfUtc);

/// <summary>
/// Pure working-time arithmetic: the minutes between two instants that fall inside the working day of the firm (start and end time on the working weekdays, in the firm's time zone).
/// Daylight-saving safe because each day's window is converted to UTC on its own, so a 23 or 25 hour day counts its real working minutes. With the <c>CLOCK</c> basis every minute counts.
/// </summary>
public static class WorkingTime
{
    /// <summary>Whole minutes (rounded down) from <paramref name="fromUtc"/> to <paramref name="toUtc"/>; 0 when the end is not after the start.</summary>
    public static int Minutes(DateTime fromUtc, DateTime toUtc, DashboardGaugeSettings settings, TimeZoneInfo zone)
    {
        ArgumentNullException.ThrowIfNull(settings);
        ArgumentNullException.ThrowIfNull(zone);
        var from = DateTime.SpecifyKind(fromUtc, DateTimeKind.Utc);
        var to = DateTime.SpecifyKind(toUtc, DateTimeKind.Utc);
        if (to <= from)
            return 0;

        if (settings.AgeBasis == GaugeAgeBasis.Clock)
            return (int)Math.Min(int.MaxValue, (to - from).TotalMinutes);

        var firstDay = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(from, zone));
        var lastDay = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(to, zone));
        double total = 0;
        for (var day = firstDay; day <= lastDay; day = day.AddDays(1))
        {
            if (!settings.WorkDays.Contains(IsoDay(day)))
                continue;

            var open = LocalToUtc(day, settings.WorkdayStart, zone);
            var close = LocalToUtc(day, settings.WorkdayEnd, zone);
            var start = open > from ? open : from;
            var end = close < to ? close : to;
            if (end > start)
                total += (end - start).TotalMinutes;
        }

        return (int)Math.Min(int.MaxValue, Math.Floor(total));
    }

    /// <summary>ISO weekday: Monday 1 to Sunday 7.</summary>
    public static int IsoDay(DateOnly date) => date.DayOfWeek == DayOfWeek.Sunday ? 7 : (int)date.DayOfWeek;

    private static DateTime LocalToUtc(DateOnly day, TimeOnly time, TimeZoneInfo zone)
    {
        var local = DateTime.SpecifyKind(day.ToDateTime(time), DateTimeKind.Unspecified);
        while (zone.IsInvalidTime(local))
            local = local.AddMinutes(1);
        if (zone.IsAmbiguousTime(local))
            return DateTime.SpecifyKind(local - zone.GetAmbiguousTimeOffsets(local).Max(), DateTimeKind.Utc);
        return DateTime.SpecifyKind(TimeZoneInfo.ConvertTimeToUtc(local, zone), DateTimeKind.Utc);
    }
}

/// <summary>The one level function of the gauge, shared by the summary and its tests.</summary>
public static class UnassignedGaugeRules
{
    /// <summary>
    /// Nothing unassigned is 0 (all clear). Otherwise the age gives one level per reached step of <c>LevelHours</c> (default 1, 2, 3, 4 and 5 hours: under an hour is 0), plus one level for each
    /// <c>TasksPerLevel</c> unassigned Tasks, at most <c>CountBonusMax</c>; the total is at most 5.
    /// </summary>
    public static int Level(int count, int ageMinutes, DashboardGaugeSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        if (count <= 0)
            return 0;

        var byAge = settings.LevelHours.Count(h => ageMinutes >= h * 60);
        var byCount = Math.Min(settings.CountBonusMax, count / Math.Max(1, settings.TasksPerLevel));
        return Math.Min(DashboardGaugeSettings.MaxLevel, byAge + byCount);
    }
}

/// <summary>
/// The age of unassigned Tasks for the Dashboard gauge and the Task Queue column, in one place so they use the same settings and the same firm time zone (<c>Firm:TimeZoneId</c>, the zone the
/// availability rules use). Settings come through the 30 second settings copy.
/// </summary>
public sealed class UnassignedAge(IDashboardSettings settings, IConfiguration configuration)
{
    private (DashboardGaugeSettings Settings, TimeZoneInfo Zone)? _loaded;

    public async Task<(DashboardGaugeSettings Settings, TimeZoneInfo Zone)> LoadAsync(CancellationToken ct)
    {
        _loaded ??= (await settings.GetGaugeAsync(ct), UserTimeZone.Resolve(null, configuration["Firm:TimeZoneId"]).Zone);
        return _loaded.Value;
    }

    public async Task<int> MinutesAsync(DateTime sinceUtc, DateTime nowUtc, CancellationToken ct)
    {
        var (s, zone) = await LoadAsync(ct);
        return WorkingTime.Minutes(sinceUtc, nowUtc, s, zone);
    }
}
