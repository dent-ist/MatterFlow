using MatterFlow.Identity.Authorization;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Holidays;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Identity.Api;

/// <summary>
/// Administration of holiday calendars and their holidays (Dashboard Calendar, epic #1074). Needs <c>Settings.Manage</c>. A calendar holds holiday rules (fixed date, Nth weekday of a month, days from Easter, one-time day,
/// range) that are expanded for any year; nothing is entered per year. Writes are audited and use row versions (409 when someone changed it meanwhile).
/// </summary>
[ApiController]
[Route("api/v1/admin/holiday-calendars")]
[Produces("application/json")]
public class HolidayCalendarsController(HolidayCalendarService calendars) : ControllerBase
{
    /// <summary>All calendars (inactive ones too) with their holiday and people counts.</summary>
    [HttpGet(Name = "ListHolidayCalendars")]
    [RequirePermission(Permissions.Settings.Manage)]
    [ProducesResponseType<HolidayCalendarDto[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List(CancellationToken cancellationToken) => Ok(await calendars.ListAsync(cancellationToken));

    /// <summary>One calendar.</summary>
    [HttpGet("{calendarId:int}", Name = "GetHolidayCalendar")]
    [RequirePermission(Permissions.Settings.Manage)]
    [ProducesResponseType<HolidayCalendarDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(int calendarId, CancellationToken cancellationToken) => this.ToActionResult(await calendars.GetAsync(calendarId, cancellationToken));

    /// <summary>Creates a calendar. 400 for a bad name or colour, 409 <c>DUPLICATE_NAME</c>.</summary>
    [HttpPost(Name = "CreateHolidayCalendar")]
    [RequirePermission(Permissions.Settings.Manage)]
    [ProducesResponseType<HolidayCalendarDto>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create([FromBody] SaveHolidayCalendarRequest request, CancellationToken cancellationToken)
    {
        var result = await calendars.CreateAsync(request, cancellationToken);
        return result.IsFailure ? this.Problem(result.Error!) : StatusCode(StatusCodes.Status201Created, result.Value);
    }

    /// <summary>Changes a calendar (row version required).</summary>
    [HttpPut("{calendarId:int}", Name = "UpdateHolidayCalendar")]
    [RequirePermission(Permissions.Settings.Manage)]
    [ProducesResponseType<HolidayCalendarDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(int calendarId, [FromBody] SaveHolidayCalendarRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await calendars.UpdateAsync(calendarId, request, cancellationToken));

    /// <summary>Deletes a calendar and its holidays; 409 <c>CALENDAR_IN_USE</c> while a person, a pod or the firm default uses it.</summary>
    [HttpDelete("{calendarId:int}", Name = "DeleteHolidayCalendar")]
    [RequirePermission(Permissions.Settings.Manage)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int calendarId, [FromQuery] string? rowVersion, CancellationToken cancellationToken) =>
        this.ToActionResult(await calendars.DeleteAsync(calendarId, rowVersion, cancellationToken));

    /// <summary>The holiday rules of a calendar.</summary>
    [HttpGet("{calendarId:int}/holidays", Name = "ListHolidays")]
    [RequirePermission(Permissions.Settings.Manage)]
    [ProducesResponseType<HolidayDto[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> ListHolidays(int calendarId, CancellationToken cancellationToken) =>
        this.ToActionResult(await calendars.ListHolidaysAsync(calendarId, cancellationToken));

    /// <summary>Adds a holiday rule. 400 <c>HOLIDAY_RULE_INVALID</c> when the fields do not fit the rule kind.</summary>
    [HttpPost("{calendarId:int}/holidays", Name = "CreateHoliday")]
    [RequirePermission(Permissions.Settings.Manage)]
    [ProducesResponseType<HolidayDto>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> CreateHoliday(int calendarId, [FromBody] SaveHolidayRequest request, CancellationToken cancellationToken)
    {
        var result = await calendars.CreateHolidayAsync(calendarId, request, cancellationToken);
        return result.IsFailure ? this.Problem(result.Error!) : StatusCode(StatusCodes.Status201Created, result.Value);
    }

    /// <summary>Changes a holiday rule (row version required).</summary>
    [HttpPut("{calendarId:int}/holidays/{holidayId:int}", Name = "UpdateHoliday")]
    [RequirePermission(Permissions.Settings.Manage)]
    [ProducesResponseType<HolidayDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> UpdateHoliday(int calendarId, int holidayId, [FromBody] SaveHolidayRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await calendars.UpdateHolidayAsync(calendarId, holidayId, request, cancellationToken));

    /// <summary>Deletes a holiday rule.</summary>
    [HttpDelete("{calendarId:int}/holidays/{holidayId:int}", Name = "DeleteHoliday")]
    [RequirePermission(Permissions.Settings.Manage)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> DeleteHoliday(int calendarId, int holidayId, [FromQuery] string? rowVersion, CancellationToken cancellationToken) =>
        this.ToActionResult(await calendars.DeleteHolidayAsync(calendarId, holidayId, rowVersion, cancellationToken));

    /// <summary>The expanded holidays of a year (this year and next in the UI); a range is one line, a moved holiday names the day it fell on.</summary>
    [HttpGet("{calendarId:int}/preview", Name = "PreviewHolidayCalendar")]
    [RequirePermission(Permissions.Settings.Manage)]
    [ProducesResponseType<HolidayPreviewDto[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Preview(int calendarId, [FromQuery] int year, CancellationToken cancellationToken) =>
        this.ToActionResult(await calendars.PreviewAsync(calendarId, year, cancellationToken));

    /// <summary>
    /// Reads a pasted list of holidays. With <c>dryRun=true</c> (default) nothing is saved and every line is reported; with <c>dryRun=false</c> the ok lines are saved in one transaction when no line
    /// has an error or <c>acceptOk=true</c>.
    /// </summary>
    [HttpPost("{calendarId:int}/holidays/import", Name = "ImportHolidays")]
    [RequirePermission(Permissions.Settings.Manage)]
    [ProducesResponseType<HolidayImportResult>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Import(int calendarId, [FromBody] HolidayImportRequest request, [FromQuery] bool dryRun = true, [FromQuery] bool acceptOk = false, CancellationToken cancellationToken = default) =>
        this.ToActionResult(await calendars.ImportAsync(calendarId, request, dryRun, acceptOk, cancellationToken));
}

/// <summary>The firm holiday calendar and the default calendar of each pod (<c>Settings.Manage</c>).</summary>
[ApiController]
[Route("api/v1/admin/settings/holidays")]
[Produces("application/json")]
public class SettingsHolidaysController(HolidayCalendarService calendars) : ControllerBase
{
    /// <summary>The firm calendar, the active pods with their default calendar, and the row version of the firm setting.</summary>
    [HttpGet(Name = "GetHolidaySettings")]
    [RequirePermission(Permissions.Settings.Manage)]
    [ProducesResponseType<HolidaySettingsDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(CancellationToken cancellationToken) => Ok(await calendars.GetSettingsAsync(cancellationToken));

    /// <summary>Sets the firm calendar (null = none) and the default of the listed pods.</summary>
    [HttpPut(Name = "SetHolidaySettings")]
    [RequirePermission(Permissions.Settings.Manage)]
    [ProducesResponseType<HolidaySettingsDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Set([FromBody] SaveHolidaySettingsRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await calendars.SaveSettingsAsync(request, cancellationToken));
}

/// <summary>The holiday calendar of a person (<c>User.Manage</c>); the calendar in force is part of <c>GET /api/v1/users/{id}/availability</c>.</summary>
[ApiController]
[Route("api/v1/users/{userId:int}/holiday-calendar")]
[Produces("application/json")]
public class UserHolidayCalendarController(HolidayCalendarService calendars) : ControllerBase
{
    /// <summary>Assigns a calendar to the person; null = the default of their pod, then the firm.</summary>
    [HttpPut(Name = "SetUserHolidayCalendar")]
    [RequirePermission(Permissions.User.Manage)]
    [ProducesResponseType<UserHolidayCalendarDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Put(int userId, [FromBody] AssignHolidayCalendarRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await calendars.AssignToUserAsync(userId, request.CalendarId, cancellationToken));
}
