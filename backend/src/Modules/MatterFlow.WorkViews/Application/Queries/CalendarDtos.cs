using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>Request of <c>GET /dashboard/calendar/days</c>: at most 62 days, the pod scope of the capacity endpoints and an optional primary-role filter.</summary>
public class CalendarDaysQuery
{
    public static readonly IReadOnlyList<string> Keys = ["from", "to", "podScope", "role"];

    /// <summary>First day (<c>yyyy-MM-dd</c>).</summary>
    [FromQuery(Name = "from")]
    public DateOnly? From { get; init; }

    /// <summary>Last day, included; at most 62 days after <c>from</c>.</summary>
    [FromQuery(Name = "to")]
    public DateOnly? To { get; init; }

    /// <summary><c>all</c> (default), <c>mine</c> or a Pod id. A Pod Lead sees only the pods they belong to: <c>all</c> means those pods and another pod is 403. An unknown pod is 400 <c>UNKNOWN_POD</c>.</summary>
    [FromQuery(Name = "podScope"), StringLength(20)]
    public string? PodScope { get; init; }

    /// <summary>Only people whose primary tech-ops role is this role id.</summary>
    [FromQuery(Name = "role")]
    public int? Role { get; init; }
}

/// <summary>Request of <c>GET /dashboard/calendar/day</c>.</summary>
public class CalendarDayQuery
{
    public static readonly IReadOnlyList<string> Keys = ["date", "podScope", "role", "q"];

    /// <summary>The day (<c>yyyy-MM-dd</c>).</summary>
    [FromQuery(Name = "date")]
    public DateOnly? Date { get; init; }

    [FromQuery(Name = "podScope"), StringLength(20)]
    public string? PodScope { get; init; }

    [FromQuery(Name = "role")]
    public int? Role { get; init; }

    /// <summary>Fragment of a person's name or pod name; narrows the two lists, not the counts.</summary>
    [FromQuery(Name = "q"), StringLength(200)]
    public string? Q { get; init; }
}

/// <summary>Request of <c>GET /dashboard/calendar/summary</c>.</summary>
public class CalendarSummaryQuery
{
    public static readonly IReadOnlyList<string> Keys = ["podScope", "role"];

    [FromQuery(Name = "podScope"), StringLength(20)]
    public string? PodScope { get; init; }

    [FromQuery(Name = "role")]
    public int? Role { get; init; }
}

/// <summary>A role of the role filter.</summary>
public sealed record CalendarRole([property: Required] int RoleId, [property: Required] string Name);

/// <summary>A holiday on a day in the Calendar cell: the holiday name, the calendar it comes from (the category) and the colour.</summary>
public sealed record CalendarHoliday(
    [property: Required] string Name,
    [property: Required] int CalendarId,
    [property: Required] string Category,
    [property: Required] string ColourKey,
    [property: Required] bool AppliesToEveryone);

/// <summary>A holiday in the day panel header.</summary>
public sealed record CalendarDayHoliday([property: Required] string Name, [property: Required] string Category, [property: Required] string ColourKey);

/// <summary>One pod on one day: the people expected, available, the minimum in force and the level (<c>GOOD</c>, <c>WATCH</c>, <c>LOW</c>, <c>CRITICAL</c>, <c>CLOSED</c>).</summary>
public sealed record CalendarPod(
    [property: Required] int PodId,
    [property: Required] string Name,
    [property: Required] int Expected,
    [property: Required] int Available,
    [property: Required] int Minimum,
    [property: Required] string Level);

/// <summary>
/// One day of the Calendar. <c>expected</c> = people in view minus those on holiday or without work hours; <c>available</c> = expected minus out of office; <c>coveragePercent</c> = available over expected (null when nobody is expected).
/// <c>level</c>: <c>CRITICAL</c> (below the pod percent, or a pod with people expected has nobody), <c>LOW</c> (below the firm percent), <c>WATCH</c> (a pod is below its minimum), <c>GOOD</c>, <c>CLOSED</c> (nobody expected because of a holiday), <c>NON_WORKING</c> (weekend or nobody works).
/// </summary>
public sealed record CalendarDayCell(
    [property: Required] DateOnly Date,
    [property: Required] int Total,
    [property: Required] int Expected,
    [property: Required] int Available,
    [property: Required] int OutOfOffice,
    [property: Required] int OnHoliday,
    [property: Required] int OffHours,
    int? CoveragePercent,
    [property: Required] string Level,
    [property: Required] IReadOnlyList<CalendarHoliday> Holidays,
    [property: Required] IReadOnlyList<CalendarPod> Pods);

/// <summary>Answer of <c>GET /dashboard/calendar/days</c>.</summary>
/// <param name="Today">Today in the firm time zone.</param>
/// <param name="FirstDayOfWeek">0 = Sunday (weeks start on Sunday).</param>
/// <param name="Roles">The primary roles of the people in the scope, for the role filter (name A to Z).</param>
public sealed record CalendarDays(
    [property: Required] DateTime AsOfUtc,
    [property: Required] DateOnly Today,
    [property: Required] int FirstDayOfWeek,
    [property: Required] IReadOnlyList<CalendarRole> Roles,
    [property: Required] IReadOnlyList<CalendarDayCell> Days);

/// <summary>The counts of a day.</summary>
public sealed record CalendarCounts(
    [property: Required] int Total,
    [property: Required] int Expected,
    [property: Required] int Available,
    [property: Required] int OutOfOffice,
    [property: Required] int OnHoliday,
    [property: Required] int OffHours);

/// <summary>A person on the list of the day panel. <c>load</c> is the number of open assigned tasks (New and In progress), a bare number; no task or matter is named.</summary>
public sealed record CalendarPerson(
    [property: Required] int UserId,
    [property: Required] string DisplayName,
    [property: Required] IReadOnlyList<string> PodNames,
    [property: Required] int Load);

/// <summary>An unavailable person. <c>reason</c> is <c>OUT_OF_OFFICE</c>, <c>HOLIDAY</c> or <c>NOT_WORKING</c>; <c>backOn</c> the first working day after the Out of office entry (null when open-ended or another reason).</summary>
/// <param name="AbsenceType">The type of the entry; the property is absent from the response without <c>Dashboard.ViewAbsenceReasons</c>. The note never appears in the Calendar.</param>
public sealed record CalendarUnavailablePerson(
    [property: Required] int UserId,
    [property: Required] string DisplayName,
    [property: Required] IReadOnlyList<string> PodNames,
    [property: Required] int Load,
    [property: Required] string Reason,
    DateOnly? BackOn,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? AbsenceType);

/// <summary>Available people of one role.</summary>
public sealed record CalendarAvailableGroup([property: Required] int RoleId, [property: Required] string RoleName, [property: Required] IReadOnlyList<CalendarPerson> People);

/// <summary>Unavailable people of one role.</summary>
public sealed record CalendarUnavailableGroup([property: Required] int RoleId, [property: Required] string RoleName, [property: Required] IReadOnlyList<CalendarUnavailablePerson> People);

/// <summary>
/// Answer of <c>GET /dashboard/calendar/day</c> (the right panel): counts, holidays, coverage by pod, then Available people (lightest load first) and Unavailable people (heaviest load first),
/// each grouped by primary tech-ops role (the first role A to Z that holds Workflow.Execute); ties by name.
/// </summary>
public sealed record CalendarDay(
    [property: Required] DateOnly Date,
    [property: Required] string Level,
    [property: Required] IReadOnlyList<CalendarDayHoliday> Holidays,
    [property: Required] CalendarCounts Counts,
    [property: Required] IReadOnlyList<CalendarPod> Pods,
    [property: Required] IReadOnlyList<CalendarAvailableGroup> Available,
    [property: Required] IReadOnlyList<CalendarUnavailableGroup> Unavailable);

/// <summary>The thresholds in force.</summary>
public sealed record CalendarThresholdsInfo([property: Required] int MinCoveragePercent, [property: Required] int PodMinimumPercent);

/// <summary>The pod that is below its minimum on most of the risk days.</summary>
public sealed record CalendarWorstPod([property: Required] int PodId, [property: Required] string Name);

/// <summary>The 30-day coverage-risk banner: days (working days) whose level is WATCH, LOW or CRITICAL.</summary>
public sealed record CalendarRisk(
    [property: Required] int DaysAtRisk,
    DateOnly? FirstRiskDate,
    string? FirstRiskLevel,
    CalendarWorstPod? WorstPod,
    [property: Required] int WindowDays);

/// <summary>Free capacity of one week: <c>freePercent</c> = (slots x average people available - open tasks) / (slots x average available), 0 to 100; null when nobody is available.</summary>
public sealed record CalendarForecastWeek(
    [property: Required] DateOnly WeekStart,
    [property: Required] double AvailablePeople,
    int? FreePercent);

/// <summary>Answer of <c>GET /dashboard/calendar/summary</c>: thresholds, the risk banner and the four-week forecast (numbers only; no task is named).</summary>
public sealed record CalendarSummary(
    [property: Required] CalendarThresholdsInfo Thresholds,
    [property: Required] CalendarRisk Risk,
    [property: Required] IReadOnlyList<CalendarForecastWeek> Forecast);

/// <summary>Pods that would fall below their minimum if the person were out, with the days.</summary>
public sealed record AbsenceCheckPod([property: Required] int PodId, [property: Required] string Name, [property: Required] IReadOnlyList<DateOnly> Days);

/// <summary>Body of the advisory overlap check; <c>endDate</c> null = open-ended (checks the next 30 days).</summary>
public sealed record AbsenceCheckRequest([Required] DateOnly StartDate, DateOnly? EndDate);

/// <summary>Answer of the advisory check: never blocks a save.</summary>
public sealed record AbsenceCheckResult([property: Required] IReadOnlyList<AbsenceCheckPod> PodsBelowMinimum);
