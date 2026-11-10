using MatterFlow.SharedKernel.Results;

namespace MatterFlow.Identity.Contracts;

/// <summary>The firm holiday calendar setting: its id (null = none) and the row version (base64, empty when no row) that edits send back.</summary>
public sealed record FirmCalendarSetting(int? CalendarId, string RowVersion);

/// <summary>
/// The firm holiday calendar (the one used by people whose pod has no default calendar; Dashboard Calendar, epic #1074). The value is an application setting
/// owned by the Configuration module, which implements this port, so Identity reads and writes it without depending on Configuration.
/// </summary>
public interface IFirmHolidayCalendar
{
    /// <summary>The firm calendar, fresh from the database when <paramref name="fresh"/> is set.</summary>
    Task<FirmCalendarSetting> GetFirmCalendarAsync(bool fresh = false, CancellationToken cancellationToken = default);

    /// <summary>Sets the firm calendar (null clears it). <paramref name="rowVersion"/> is the one read before; a mismatch is a concurrency conflict.</summary>
    Task<Result<FirmCalendarSetting>> SetFirmCalendarAsync(int? calendarId, string rowVersion, CancellationToken cancellationToken = default);
}
