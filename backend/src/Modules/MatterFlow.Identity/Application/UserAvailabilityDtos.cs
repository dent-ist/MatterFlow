using System.ComponentModel.DataAnnotations;

namespace MatterFlow.Identity.Application;

/// <summary>One working day. <see cref="DayOfWeek"/> is ISO (1 = Monday ... 7 = Sunday); times are local wall-clock <c>HH:mm</c> in the user's zone.</summary>
public sealed record WorkHourDto([Required] int DayOfWeek, [Required] string Start, [Required] string End);

/// <summary>The evaluated state right now.</summary>
/// <param name="State"><c>AVAILABLE</c>, <c>OUT_OF_OFFICE</c> or <c>OFF_HOURS</c>.</param>
/// <param name="OutUntilUtc">While out of office: when it ends; null when open-ended.</param>
/// <param name="Note">The out-of-office note while out of office.</param>
/// <param name="NextWorkStartUtc">Off hours or out of office with an end: the next time work hours begin.</param>
public sealed record CurrentAvailabilityDto(
    [property: Required] string State,
    DateTime? OutUntilUtc,
    string? Note,
    DateTime? NextWorkStartUtc);

/// <summary>A user's availability profile. A user who never saved one gets the defaults and <c>rowVersion = "NEW"</c>.</summary>
/// <param name="Status"><c>AVAILABLE</c> or <c>OUT_OF_OFFICE</c> (manual).</param>
/// <param name="From">First day out of office (local date in the user's zone); null = from now.</param>
/// <param name="Until">Last day out of office; null = until the user sets Available again.</param>
/// <param name="Note">Short plain-text note (max 200).</param>
/// <param name="TimeZoneId">The zone the user chose (IANA); null = the firm zone.</param>
/// <param name="EffectiveTimeZoneId">The zone in force (the chosen one or the firm zone).</param>
/// <param name="UsesDefaultWorkHours">True while the schedule is the default Mon-Fri 09:00-17:00 (nothing saved).</param>
/// <param name="WorkHours">The effective schedule, one entry per working day; a weekday without an entry is a non-working day.</param>
/// <param name="RowVersion">Send back on save. <c>NEW</c> means no profile exists yet (the save creates it).</param>
public sealed record UserAvailabilityDto(
    [property: Required] int UserId,
    [property: Required] string Status,
    DateOnly? From,
    DateOnly? Until,
    string? Note,
    string? TimeZoneId,
    [property: Required] string EffectiveTimeZoneId,
    [property: Required] bool UsesDefaultWorkHours,
    [property: Required] IReadOnlyList<WorkHourDto> WorkHours,
    [property: Required] CurrentAvailabilityDto Current,
    DateTime? UpdatedAtUtc,
    int? UpdatedByUserId,
    [property: Required] string RowVersion);

/// <summary>
/// Saves the whole availability profile. <c>workHours</c> null = use the default schedule; an array (possibly empty = no working days)
/// is a custom schedule. When <c>status</c> is <c>AVAILABLE</c> the dates and the note are cleared.
/// </summary>
public sealed record SaveAvailabilityRequest(
    [Required] string Status,
    DateOnly? From,
    DateOnly? Until,
    [StringLength(1000)] string? Note,
    [StringLength(100)] string? TimeZoneId,
    List<WorkHourDto>? WorkHours,
    [Required] string RowVersion);
