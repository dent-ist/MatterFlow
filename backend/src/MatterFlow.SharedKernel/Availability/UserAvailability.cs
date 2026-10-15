using MatterFlow.SharedKernel.Time;

namespace MatterFlow.SharedKernel.Availability;

/// <summary>Stored availability status codes.</summary>
public static class AvailabilityStatuses
{
    public const string Available = "AVAILABLE";
    public const string OutOfOffice = "OUT_OF_OFFICE";

    public static bool IsValid(string? status) => status is Available or OutOfOffice;
}

/// <summary>The evaluated state of a user at one instant.</summary>
public static class AvailabilityStates
{
    public const string Available = "AVAILABLE";
    public const string OutOfOffice = "OUT_OF_OFFICE";

    /// <summary>A soft state: outside the user's work hours. Never treated as unavailable.</summary>
    public const string OffHours = "OFF_HOURS";
}

/// <summary>One working day. <see cref="DayOfWeek"/> is ISO: 1 = Monday ... 7 = Sunday.</summary>
public readonly record struct WorkHourSlot(int DayOfWeek, TimeOnly Start, TimeOnly End);

/// <summary>
/// What the evaluator needs to know about a user. <see cref="ZoneId"/> is the user's zone with the firm fallback already applied;
/// <see cref="WorkHours"/> is the schedule as stored (the evaluator applies the default when <see cref="HasCustomWorkHours"/> is false).
/// </summary>
public sealed record UserAvailabilityProfile(
    string Status,
    DateOnly? OutOfOfficeFromDate,
    DateOnly? OutOfOfficeUntilDate,
    string? Note,
    string? ZoneId,
    bool HasCustomWorkHours,
    IReadOnlyList<WorkHourSlot> WorkHours)
{
    /// <summary>The profile of a user who never saved anything: available, default hours, firm zone.</summary>
    public static UserAvailabilityProfile Default { get; } = new(AvailabilityStatuses.Available, null, null, null, null, false, []);
}

/// <summary>Result of <see cref="UserAvailabilityEvaluator.Evaluate"/>.</summary>
/// <param name="State"><see cref="AvailabilityStates"/> value.</param>
/// <param name="OutUntilUtc">While out of office: the instant it ends (start of the day after the Until date); null when open-ended.</param>
/// <param name="Note">The out-of-office note (only while out of office).</param>
/// <param name="NextWorkStartUtc">The next time work hours begin (off hours, or the first start after the out-of-office period ends); null when unknown.</param>
public sealed record AvailabilityEvaluation(string State, DateTime? OutUntilUtc, string? Note, DateTime? NextWorkStartUtc);

/// <summary>
/// Pure availability rules (epic #68). Out of office wins over everything; otherwise the weekly work hours decide between
/// <c>AVAILABLE</c> and the soft <c>OFF_HOURS</c>. All local-time decisions use the user's own zone, so DST days are 23 or 25 hours long.
/// </summary>
public static class UserAvailabilityEvaluator
{
    public const int FirstWeekday = 1;
    public const int LastWeekday = 5;

    /// <summary>Default schedule: Monday to Friday 09:00-17:00 in the user's zone.</summary>
    public static IReadOnlyList<WorkHourSlot> DefaultWorkHours { get; } =
        Enumerable.Range(FirstWeekday, LastWeekday).Select(d => new WorkHourSlot(d, new TimeOnly(9, 0), new TimeOnly(17, 0))).ToArray();

    /// <summary>Slots in effect: the saved ones for a custom schedule, otherwise the default.</summary>
    public static IReadOnlyList<WorkHourSlot> EffectiveWorkHours(UserAvailabilityProfile profile) =>
        profile.HasCustomWorkHours ? profile.WorkHours : DefaultWorkHours;

    /// <summary>ISO weekday number of a date (Monday = 1 ... Sunday = 7).</summary>
    public static int IsoDay(DateOnly date) => date.DayOfWeek == DayOfWeek.Sunday ? 7 : (int)date.DayOfWeek;

    public static AvailabilityEvaluation Evaluate(UserAvailabilityProfile profile, DateTime nowUtc)
    {
        ArgumentNullException.ThrowIfNull(profile);
        var now = DateTime.SpecifyKind(nowUtc, DateTimeKind.Utc);
        var zone = UserTimeZone.Resolve(profile.ZoneId).Zone;

        var (start, end) = OutOfOfficeWindow(profile, zone);
        if (profile.Status == AvailabilityStatuses.OutOfOffice && now >= start && (end is null || now < end))
        {
            var next = end is { } over ? NextWorkStart(profile, zone, over) : null;
            return new AvailabilityEvaluation(AvailabilityStates.OutOfOffice, end, profile.Note, next);
        }

        var local = TimeZoneInfo.ConvertTimeFromUtc(now, zone);
        var today = DateOnly.FromDateTime(local);
        var time = TimeOnly.FromDateTime(local);
        var slots = EffectiveWorkHours(profile);
        var slot = slots.Where(s => s.DayOfWeek == IsoDay(today)).Cast<WorkHourSlot?>().FirstOrDefault();
        if (slot is { } s && time >= s.Start && time < s.End)
            return new AvailabilityEvaluation(AvailabilityStates.Available, null, null, null);

        return new AvailabilityEvaluation(AvailabilityStates.OffHours, null, null, NextWorkStart(profile, zone, now));
    }

    /// <summary>The out-of-office window as instants: start (the beginning of From, or the beginning of time) and the exclusive end (null = open-ended).</summary>
    private static (DateTime Start, DateTime? End) OutOfOfficeWindow(UserAvailabilityProfile profile, TimeZoneInfo zone)
    {
        var start = profile.OutOfOfficeFromDate is { } from ? StartOfDayUtc(from, zone) : DateTime.MinValue;
        DateTime? end = profile.OutOfOfficeUntilDate is { } until ? StartOfDayUtc(until.AddDays(1), zone) : null;
        return (DateTime.SpecifyKind(start, DateTimeKind.Utc), end is { } e ? DateTime.SpecifyKind(e, DateTimeKind.Utc) : null);
    }

    /// <summary>The first work start strictly after <paramref name="afterUtc"/> (looks ahead 8 days; null for a schedule without working days).</summary>
    public static DateTime? NextWorkStart(UserAvailabilityProfile profile, TimeZoneInfo zone, DateTime afterUtc)
    {
        var slots = EffectiveWorkHours(profile);
        if (slots.Count == 0)
            return null;

        var local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(afterUtc, DateTimeKind.Utc), zone);
        var day = DateOnly.FromDateTime(local);
        for (var i = 0; i <= 8; i++, day = day.AddDays(1))
        {
            foreach (var s in slots.Where(x => x.DayOfWeek == IsoDay(day)))
            {
                var startUtc = LocalToUtc(day, s.Start, zone);
                if (startUtc > afterUtc)
                    return startUtc;
            }
        }

        return null;
    }

    /// <summary>Start of a local calendar day as a UTC instant (a day whose midnight falls into a DST gap starts at the first valid instant).</summary>
    public static DateTime StartOfDayUtc(DateOnly date, TimeZoneInfo zone) => LocalToUtc(date, TimeOnly.MinValue, zone);

    private static DateTime LocalToUtc(DateOnly date, TimeOnly time, TimeZoneInfo zone)
    {
        var local = DateTime.SpecifyKind(date.ToDateTime(time), DateTimeKind.Unspecified);
        if (zone.IsInvalidTime(local))
            local = local.AddHours(1); // spring-forward gap: the first valid instant after it
        return DateTime.SpecifyKind(TimeZoneInfo.ConvertTimeToUtc(local, zone), DateTimeKind.Utc);
    }
}
