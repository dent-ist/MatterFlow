using System.ComponentModel.DataAnnotations;

namespace LptHub.Identity.Application;

/// <summary>One working day. <see cref="DayOfWeek"/> is ISO (1 = Monday ... 7 = Sunday); times are local wall-clock <c>HH:mm</c> in the user's zone.</summary>
public sealed record WorkHourDto([Required] int DayOfWeek, [Required] string Start, [Required] string End);

/// <summary>The evaluated state right now.</summary>
/// <param name="State"><c>AVAILABLE</c>, <c>OUT_OF_OFFICE</c> or <c>OFF_HOURS</c>.</param>
/// <param name="OutUntilUtc">While out of office: when it ends (entries that touch count as one absence); null when open-ended.</param>
/// <param name="Note">The out-of-office note while out of office.</param>
/// <param name="NextWorkStartUtc">Off hours or out of office with an end: the next time work hours begin.</param>
/// <param name="Reason"><c>HOLIDAY</c> when the soft off-hours state is a holiday (it wins over an Out of office entry); otherwise absent.</param>
/// <param name="AbsenceType">While out of office: the type of the entry.</param>
public sealed record CurrentAvailabilityDto(
    [property: Required] string State,
    DateTime? OutUntilUtc,
    string? Note,
    DateTime? NextWorkStartUtc,
    string? Reason = null,
    string? AbsenceType = null);

/// <summary>One Out of office entry (script 58).</summary>
/// <param name="AbsenceId">Id of the entry.</param>
/// <param name="UserId">The person.</param>
/// <param name="Type"><c>VACATION</c>, <c>SICK</c>, <c>TRAINING</c>, <c>CONFERENCE</c> or <c>OTHER</c>.</param>
/// <param name="StartDate">First day (a floating date in the person's zone).</param>
/// <param name="EndDate">Last day out of office (inclusive); null = until the person is back.</param>
/// <param name="Note">Short plain-text note (max 200); only the owner and the managers who may edit the entry see it.</param>
/// <param name="State"><c>NOW</c> (covers today), <c>UPCOMING</c> or <c>PAST</c> (read-only history).</param>
/// <param name="WorkingDays">The person's working days in the entry (their work hours, without weekends and holidays); null when open-ended.</param>
/// <param name="RowVersion">Send back on change or delete.</param>
public sealed record AbsenceDto(
    [property: Required] int AbsenceId,
    [property: Required] int UserId,
    [property: Required] string Type,
    [property: Required] DateOnly StartDate,
    DateOnly? EndDate,
    string? Note,
    [property: Required] string State,
    int? WorkingDays,
    [property: Required] string RowVersion);

/// <summary>The holiday calendar in force for a person.</summary>
/// <param name="Source"><c>PERSON</c> (set by an administrator), <c>POD</c> (default of the person's pod) or <c>FIRM</c>.</param>
public sealed record HolidayCalendarRefDto([property: Required] int CalendarId, [property: Required] string Name, [property: Required] string Source);

/// <summary>The next holiday of the person on a date.</summary>
public sealed record NextHolidayDto([property: Required] DateOnly Date, [property: Required] string Name);

/// <summary>
/// A user's availability: time zone, work hours, the Out of office entries that are current or coming, the holiday calendar and the next holidays. A user who never saved a profile
/// gets the defaults and <c>rowVersion = "NEW"</c>. The Out of office status of the old single value is derived from <c>absences</c> (<c>current</c>).
/// </summary>
/// <param name="TimeZoneId">The zone the user chose (IANA); null = the firm zone.</param>
/// <param name="EffectiveTimeZoneId">The zone in force (the chosen one or the firm zone).</param>
/// <param name="UsesDefaultWorkHours">True while the schedule is the default Mon-Fri 09:00-17:00 (nothing saved).</param>
/// <param name="WorkHours">The effective schedule, one entry per working day; a weekday without an entry is a non-working day.</param>
/// <param name="Absences">Current and upcoming entries, earliest first (past entries: <c>GET /users/{id}/absences?includePast=true</c>).</param>
/// <param name="HolidayCalendar">The calendar in force; null when the person has none and neither has the pod or the firm.</param>
/// <param name="NextHolidays">The next holidays of the person (own calendar and firm closures), at most 5.</param>
/// <param name="RowVersion">Send back on save of the zone and work hours. <c>NEW</c> means no profile exists yet (the save creates it).</param>
public sealed record UserAvailabilityDto(
    [property: Required] int UserId,
    string? TimeZoneId,
    [property: Required] string EffectiveTimeZoneId,
    [property: Required] bool UsesDefaultWorkHours,
    [property: Required] IReadOnlyList<WorkHourDto> WorkHours,
    [property: Required] CurrentAvailabilityDto Current,
    [property: Required] IReadOnlyList<AbsenceDto> Absences,
    HolidayCalendarRefDto? HolidayCalendar,
    [property: Required] IReadOnlyList<NextHolidayDto> NextHolidays,
    DateTime? UpdatedAtUtc,
    int? UpdatedByUserId,
    [property: Required] string RowVersion);

/// <summary>Saves the time zone and the work hours. <c>workHours</c> null = use the default schedule; an array (possibly empty = no working days) is a custom schedule.</summary>
public sealed record SaveAvailabilityRequest(
    [StringLength(100)] string? TimeZoneId,
    List<WorkHourDto>? WorkHours,
    [Required] string RowVersion);

/// <summary>Body to add an Out of office entry. <c>endDate</c> null = until the person is back (only starting today).</summary>
public sealed record CreateAbsenceRequest(
    [Required] string Type,
    [Required] DateOnly StartDate,
    DateOnly? EndDate,
    [StringLength(1000)] string? Note);

/// <summary>Body to change an Out of office entry that has not ended; the row version of the last read is required.</summary>
public sealed record UpdateAbsenceRequest(
    [Required] string Type,
    [Required] DateOnly StartDate,
    DateOnly? EndDate,
    [StringLength(1000)] string? Note,
    [Required] string RowVersion);

/// <summary>The entry a new or changed entry would overlap (409 body).</summary>
public sealed record AbsenceOverlapDto([property: Required] int AbsenceId, [property: Required] string Type, [property: Required] DateOnly StartDate, DateOnly? EndDate);
