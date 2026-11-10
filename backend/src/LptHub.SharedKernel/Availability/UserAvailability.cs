using LptHub.SharedKernel.Time;

namespace LptHub.SharedKernel.Availability;

/// <summary>Absence types (script 58): the reason of one Out of office entry.</summary>
public static class AbsenceTypes
{
    public const string Vacation = "VACATION";
    public const string Sick = "SICK";
    public const string Training = "TRAINING";
    public const string Conference = "CONFERENCE";
    public const string Other = "OTHER";

    public static IReadOnlyList<string> All { get; } = [Vacation, Sick, Training, Conference, Other];

    public static bool IsValid(string? type) => type is Vacation or Sick or Training or Conference or Other;
}

/// <summary>
/// One Out of office entry: whole calendar days in the person's own zone, <see cref="End"/> inclusive, null = until the person is back (open-ended).
/// </summary>
public readonly record struct AbsencePeriod(DateOnly Start, DateOnly? End, string Type = AbsenceTypes.Other, string? Note = null)
{
    public bool Covers(DateOnly date) => date >= Start && (End is null || date <= End);

    public bool Overlaps(DateOnly from, DateOnly to) => Start <= to && (End is null || End >= from);
}

/// <summary>One holiday on one date for one person: from the person's calendar or an "applies to everyone" calendar.</summary>
/// <param name="ObservedFrom">The date the holiday falls on when it was moved to a weekday (observed day); null otherwise.</param>
public sealed record HolidayDay(DateOnly Date, string Name, int CalendarId, string CalendarName, string ColourKey, bool AppliesToEveryone, DateOnly? ObservedFrom = null);

/// <summary>The evaluated state of a user at one instant.</summary>
public static class AvailabilityStates
{
    public const string Available = "AVAILABLE";
    public const string OutOfOffice = "OUT_OF_OFFICE";

    /// <summary>A soft state: outside the user's work hours or on a holiday. Never treated as unavailable.</summary>
    public const string OffHours = "OFF_HOURS";
}

/// <summary>Why a person is in the soft <see cref="AvailabilityStates.OffHours"/> state, when it is not simply the work hours.</summary>
public static class AvailabilityReasons
{
    /// <summary>A holiday of the person's calendar or of an "applies to everyone" calendar (it wins over Out of office).</summary>
    public const string Holiday = "HOLIDAY";
}

/// <summary>The state of one person on one calendar day (<see cref="UserAvailabilityEvaluator.EvaluateDay"/>).</summary>
public static class DayStates
{
    public const string Available = "AVAILABLE";
    public const string OutOfOffice = "OUT_OF_OFFICE";
    public const string Holiday = "HOLIDAY";

    /// <summary>A weekday without work hours (a part-timer's day off).</summary>
    public const string NonWorking = "NON_WORKING";

    /// <summary>A Saturday or Sunday without work hours.</summary>
    public const string Weekend = "WEEKEND";
}

/// <summary>Result of <see cref="UserAvailabilityEvaluator.EvaluateDay"/>.</summary>
/// <param name="State"><see cref="DayStates"/> value.</param>
/// <param name="Period">The Out of office entry covering the day (state OUT_OF_OFFICE only).</param>
/// <param name="Holidays">The holidays of the day (state HOLIDAY only, otherwise empty).</param>
public sealed record DayEvaluation(string State, AbsencePeriod? Period, IReadOnlyList<HolidayDay> Holidays);

/// <summary>One working day. <see cref="DayOfWeek"/> is ISO: 1 = Monday ... 7 = Sunday.</summary>
public readonly record struct WorkHourSlot(int DayOfWeek, TimeOnly Start, TimeOnly End);

/// <summary>
/// What the evaluator needs to know about a user. <see cref="ZoneId"/> is the user's zone with the firm fallback already applied;
/// <see cref="WorkHours"/> is the schedule as stored (the evaluator applies the default when <see cref="HasCustomWorkHours"/> is false);
/// <see cref="Periods"/> are the Out of office entries and <see cref="Holidays"/> the holiday dates of the person (own calendar plus every "applies to
/// everyone" calendar) that matter for the window the caller evaluates.
/// </summary>
public sealed record UserAvailabilityProfile(
    IReadOnlyList<AbsencePeriod> Periods,
    string? ZoneId,
    bool HasCustomWorkHours,
    IReadOnlyList<WorkHourSlot> WorkHours,
    IReadOnlyList<HolidayDay> Holidays)
{
    /// <summary>The profile of a user who never saved anything: available, default hours, firm zone.</summary>
    public static UserAvailabilityProfile Default { get; } = new([], null, false, [], []);
}

/// <summary>Result of <see cref="UserAvailabilityEvaluator.Evaluate"/>.</summary>
/// <param name="State"><see cref="AvailabilityStates"/> value.</param>
/// <param name="OutUntilUtc">While out of office: the instant it ends (start of the day after the Until date); null when open-ended.</param>
/// <param name="Note">The out-of-office note (only while out of office).</param>
/// <param name="NextWorkStartUtc">The next time work hours begin (off hours, or the first start after the out-of-office period ends); null when unknown.</param>
/// <param name="Reason"><see cref="AvailabilityReasons.Holiday"/> when the soft off-hours state is a holiday; null otherwise.</param>
/// <param name="AbsenceType">While out of office: the type of the entry (never shown without the reasons permission); null otherwise.</param>
public sealed record AvailabilityEvaluation(string State, DateTime? OutUntilUtc, string? Note, DateTime? NextWorkStartUtc, string? Reason = null, string? AbsenceType = null);

/// <summary>
/// Pure availability rules (epic #68, Dashboard Calendar #1074). A holiday of the day wins over everything and gives the soft <c>OFF_HOURS</c> state with reason
/// <c>HOLIDAY</c> (assignment stays possible); otherwise an Out of office entry covering the day wins; otherwise the weekly work hours decide between
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

        var local = TimeZoneInfo.ConvertTimeFromUtc(now, zone);
        var today = DateOnly.FromDateTime(local);

        // A holiday wins over an Out of office entry: the day counts once, as the soft off-hours state.
        if (HolidaysOn(profile, today).Count > 0)
            return new AvailabilityEvaluation(AvailabilityStates.OffHours, null, null, NextWorkStart(profile, zone, now), AvailabilityReasons.Holiday);

        if (CoveringPeriod(profile.Periods, today) is { } period)
        {
            var end = ChainEnd(profile.Periods, period);
            DateTime? outUntil = end is { } last ? StartOfDayUtc(last.AddDays(1), zone) : null;
            var next = outUntil is { } over ? NextWorkStart(profile, zone, over) : null;
            return new AvailabilityEvaluation(AvailabilityStates.OutOfOffice, outUntil, period.Note, next, null, period.Type);
        }

        var time = TimeOnly.FromDateTime(local);
        var slots = EffectiveWorkHours(profile);
        var slot = slots.Where(s => s.DayOfWeek == IsoDay(today)).Cast<WorkHourSlot?>().FirstOrDefault();
        if (slot is { } s && time >= s.Start && time < s.End)
            return new AvailabilityEvaluation(AvailabilityStates.Available, null, null, null);

        return new AvailabilityEvaluation(AvailabilityStates.OffHours, null, null, NextWorkStart(profile, zone, now));
    }

    /// <summary>
    /// The state of a person on one calendar day (a floating date in the person's zone), used by the Calendar. Order: a weekend or a weekday without work hours
    /// is not a working day for the person (not expected, whatever else is entered); then a holiday wins over Out of office; then an entry covering the day; else available.
    /// The reference is the mockup of the Calendar (<c>docs/ux/mockups/dashboard-calendar</c>).
    /// </summary>
    public static DayEvaluation EvaluateDay(UserAvailabilityProfile profile, DateOnly date)
    {
        ArgumentNullException.ThrowIfNull(profile);
        var iso = IsoDay(date);
        var hasHours = EffectiveWorkHours(profile).Any(s => s.DayOfWeek == iso);
        if (!hasHours && iso >= 6)
            return new DayEvaluation(DayStates.Weekend, null, []);

        var holidays = HolidaysOn(profile, date);
        if (holidays.Count > 0)
            return new DayEvaluation(DayStates.Holiday, null, holidays);

        if (!hasHours)
            return new DayEvaluation(DayStates.NonWorking, null, []);

        return CoveringPeriod(profile.Periods, date) is { } period
            ? new DayEvaluation(DayStates.OutOfOffice, period, [])
            : new DayEvaluation(DayStates.Available, null, []);
    }

    /// <summary>The holidays of a date (in the order given).</summary>
    public static IReadOnlyList<HolidayDay> HolidaysOn(UserAvailabilityProfile profile, DateOnly date)
    {
        var list = profile.Holidays;
        if (list.Count == 0)
            return [];
        List<HolidayDay>? hits = null;
        foreach (var h in list)
        {
            if (h.Date == date)
                (hits ??= []).Add(h);
        }

        return hits ?? [];
    }

    /// <summary>The entry covering the date; when several do (not possible through the API) the one that lasts longest.</summary>
    public static AbsencePeriod? CoveringPeriod(IReadOnlyList<AbsencePeriod> periods, DateOnly date)
    {
        AbsencePeriod? best = null;
        foreach (var p in periods)
        {
            if (!p.Covers(date))
                continue;
            if (best is null || (p.End ?? DateOnly.MaxValue) > (best.Value.End ?? DateOnly.MaxValue))
                best = p;
        }

        return best;
    }

    /// <summary>
    /// The last day out of office of the run that contains <paramref name="period"/>: entries that touch (the next one starts the day after, or earlier) are one absence
    /// for the person coming back. Null when the run is open-ended.
    /// </summary>
    public static DateOnly? ChainEnd(IReadOnlyList<AbsencePeriod> periods, AbsencePeriod period)
    {
        var end = period.End;
        while (end is { } last)
        {
            var nextEnd = (DateOnly?)null;
            var extended = false;
            foreach (var p in periods)
            {
                if (p.Start > last.AddDays(1) || (p.End is { } e && e <= last))
                    continue;
                if (!extended || (p.End ?? DateOnly.MaxValue) > (nextEnd ?? DateOnly.MaxValue))
                    nextEnd = p.End;
                extended = true;
            }

            if (!extended)
                break;
            end = nextEnd;
        }

        return end;
    }

    /// <summary>
    /// The first work start strictly after <paramref name="afterUtc"/> (looks ahead 8 days; null for a schedule without working days). Holiday dates of the profile are skipped.
    /// </summary>
    public static DateTime? NextWorkStart(UserAvailabilityProfile profile, TimeZoneInfo zone, DateTime afterUtc)
    {
        var slots = EffectiveWorkHours(profile);
        if (slots.Count == 0)
            return null;

        var local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(afterUtc, DateTimeKind.Utc), zone);
        var day = DateOnly.FromDateTime(local);
        for (var i = 0; i <= 8; i++, day = day.AddDays(1))
        {
            if (HolidaysOn(profile, day).Count > 0)
                continue;
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

        // Spring-forward gap: the wall-clock time does not exist, so it means the first valid instant after the gap (the moment
        // Evaluate first sees a local time at or after it). Stepping by minutes handles 30-minute gaps (Lord Howe) as well as hours.
        while (zone.IsInvalidTime(local))
            local = local.AddMinutes(1);

        // Fall-back overlap: the time happens twice; the first occurrence (the larger offset, so the earlier instant) is when it first
        // shows on the clock, which is what Evaluate reports as "available" or "out of office from".
        if (zone.IsAmbiguousTime(local))
            return DateTime.SpecifyKind(local - zone.GetAmbiguousTimeOffsets(local).Max(), DateTimeKind.Utc);

        return DateTime.SpecifyKind(TimeZoneInfo.ConvertTimeToUtc(local, zone), DateTimeKind.Utc);
    }
}
