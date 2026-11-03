using System.ComponentModel.DataAnnotations;

namespace MatterFlow.Identity.Holidays;

/// <summary>A holiday calendar for the administration.</summary>
/// <param name="ColourKey">A name of the tag palette (<c>contracts/task-type-colours.json</c>).</param>
/// <param name="AppliesToEveryone">A firm closure calendar: its holidays count for every person, whatever their own calendar.</param>
/// <param name="HolidayCount">Holiday rules in the calendar.</param>
/// <param name="PeopleCount">People who have this calendar assigned (not counting those who get it from their pod or the firm).</param>
public sealed record HolidayCalendarDto(
    [property: Required] int CalendarId,
    [property: Required] string Name,
    [property: Required] string ColourKey,
    string? RegionNote,
    [property: Required] bool AppliesToEveryone,
    [property: Required] bool IsActive,
    [property: Required] int HolidayCount,
    [property: Required] int PeopleCount,
    [property: Required] string RowVersion);

/// <summary>Body to create or change a calendar. <c>rowVersion</c> is required on change.</summary>
public sealed record SaveHolidayCalendarRequest(
    [Required, StringLength(200)] string Name,
    [StringLength(20)] string? ColourKey,
    [StringLength(1000)] string? RegionNote,
    bool AppliesToEveryone,
    bool IsActive = true,
    string? RowVersion = null);

/// <summary>One holiday rule. <c>weekday</c> is 0 = Sunday ... 6 = Saturday; <c>nth</c> is 1 to 4 or -1 for the last.</summary>
/// <param name="RuleKind"><c>FIXED</c> (month, day), <c>NTH_WEEKDAY</c> (month, nth, weekday, plusDays), <c>EASTER_OFFSET</c> (easterOffset), <c>ONCE</c> (onceDate) or <c>RANGE</c> (yearly: month, day to rangeEndMonth, rangeEndDay; otherwise onceDate to rangeEndDate).</param>
/// <param name="WeekendRule"><c>NONE</c>, <c>US</c> (Saturday to Friday, Sunday to Monday) or <c>UK</c> (Saturday and Sunday to Monday).</param>
public sealed record HolidayDto(
    [property: Required] int HolidayId,
    [property: Required] int CalendarId,
    [property: Required] string Name,
    [property: Required] string RuleKind,
    int? Month,
    int? Day,
    int? Nth,
    int? Weekday,
    [property: Required] int PlusDays,
    int? EasterOffset,
    DateOnly? OnceDate,
    int? RangeEndMonth,
    int? RangeEndDay,
    DateOnly? RangeEndDate,
    [property: Required] bool Yearly,
    [property: Required] string WeekendRule,
    string? RegionNote,
    [property: Required] string RowVersion);

/// <summary>Body to create or change a holiday rule. <c>rowVersion</c> is required on change.</summary>
public sealed record SaveHolidayRequest(
    [Required, StringLength(200)] string Name,
    [Required] string RuleKind,
    int? Month,
    int? Day,
    int? Nth,
    int? Weekday,
    int PlusDays,
    int? EasterOffset,
    DateOnly? OnceDate,
    int? RangeEndMonth,
    int? RangeEndDay,
    DateOnly? RangeEndDate,
    bool Yearly = true,
    string WeekendRule = "NONE",
    [StringLength(1000)] string? RegionNote = null,
    string? RowVersion = null);

/// <summary>One holiday of a year as the preview shows it: a range is one line from <c>date</c> to <c>endDate</c>; a moved holiday carries the day it fell on in <c>observedFrom</c>.</summary>
public sealed record HolidayPreviewDto([property: Required] DateOnly Date, DateOnly? EndDate, [property: Required] string Name, DateOnly? ObservedFrom);

/// <summary>Body of the paste import: lines like <c>11/26/2026, Day of mourning</c> or <c>12/24/2026 - 12/31/2026, Year-end closure</c> (also <c>2026-12-24</c>; <c>12/24</c> uses <c>year</c>).</summary>
public sealed record HolidayImportRequest([Required, StringLength(100000)] string Text, [Range(2000, 2100)] int Year);

/// <summary>One line of the import: what it was parsed as, or why it cannot be imported.</summary>
public sealed record HolidayImportLine([property: Required] int Line, [property: Required] bool Ok, string? Message, HolidayPreviewDto? Parsed);

/// <summary>The import report. <c>saved</c> is true when the ok lines were stored (never on a dry run).</summary>
public sealed record HolidayImportResult(
    [property: Required] IReadOnlyList<HolidayImportLine> Lines,
    [property: Required] int OkCount,
    [property: Required] int ErrorCount,
    [property: Required] bool Saved);

/// <summary>The default calendar of one pod.</summary>
public sealed record PodHolidayDefaultDto([property: Required] int PodId, string? PodName, int? CalendarId);

/// <summary>The firm calendar and the pod defaults; the row version is that of the firm setting.</summary>
public sealed record HolidaySettingsDto(
    int? FirmCalendarId,
    [property: Required] IReadOnlyList<PodHolidayDefaultDto> PodDefaults,
    [property: Required] string RowVersion);

/// <summary>The default calendar to set for one pod (null clears it).</summary>
public sealed record PodHolidayDefaultRequest(int PodId, int? CalendarId);

/// <summary>Body to change the firm calendar and the defaults of the listed pods (pods not listed stay as they are).</summary>
public sealed record SaveHolidaySettingsRequest(
    int? FirmCalendarId,
    [Required] IReadOnlyList<PodHolidayDefaultRequest> PodDefaults,
    [Required(AllowEmptyStrings = true)] string RowVersion);

/// <summary>Body to assign a holiday calendar to a person (null = the default of their pod, then the firm).</summary>
public sealed record AssignHolidayCalendarRequest(int? CalendarId);

/// <summary>The calendar a person now has assigned.</summary>
public sealed record UserHolidayCalendarDto([property: Required] int UserId, int? CalendarId);
