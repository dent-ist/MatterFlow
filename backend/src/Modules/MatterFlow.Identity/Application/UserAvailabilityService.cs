using System.Globalization;
using MatterFlow.Audit.Contracts;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using MatterFlow.Identity.Holidays;
using MatterFlow.SharedKernel.Availability;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace MatterFlow.Identity.Application;

/// <summary>Stable error codes of the availability API.</summary>
public static class AvailabilityErrorCodes
{
    public const string WorkHoursInvalid = "WORK_HOURS_INVALID";
    public const string TimeZoneUnknown = "TIMEZONE_UNKNOWN";
}

/// <summary>
/// Availability profile of a user: time zone and work hours (read, save own or on behalf, audited with readable text) and the bulk evaluation for other modules, which
/// combines them with the Out of office entries (<see cref="AbsenceService"/>) and the holidays (<see cref="HolidayLoader"/>). Operational capacity only, never a performance measure.
/// </summary>
public sealed class UserAvailabilityService(
    DbContext db,
    IAuditWriter audit,
    ICurrentUser currentUser,
    IClock clock,
    IConfiguration configuration,
    HolidayLoader holidays) : IUserAvailabilityReader
{
    public const string NewRowVersion = "NEW";

    private string FirmZoneId => configuration["Firm:TimeZoneId"] ?? UserTimeZone.DefaultFirmZoneId;

    public async Task<Result<UserAvailabilityDto>> GetAsync(int userId, CancellationToken ct)
    {
        if (!await db.Set<AppUser>().AnyAsync(u => u.Id == userId, ct))
            return Error.NotFound("The user does not exist.");

        var row = await db.Set<UserAvailability>().AsNoTracking().FirstOrDefaultAsync(a => a.UserId == userId, ct);
        var hours = row is { HasCustomWorkHours: true } ? await LoadHoursAsync(userId, tracking: false, ct) : [];
        return await ToDtoAsync(userId, row, hours, ct);
    }

    public async Task<Result<UserAvailabilityDto>> SaveAsync(int userId, SaveAvailabilityRequest request, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (!await db.Set<AppUser>().AnyAsync(u => u.Id == userId, ct))
            return Error.NotFound("The user does not exist.");

        var parsed = Validate(request);
        if (parsed.IsFailure)
            return parsed.Error!;
        var input = parsed.Value!;

        var row = await db.Set<UserAvailability>().FirstOrDefaultAsync(a => a.UserId == userId, ct);
        var currentVersion = row is null ? NewRowVersion : Convert.ToBase64String(row.RowVersion);
        if (!string.Equals(request.RowVersion, currentVersion, StringComparison.Ordinal))
            return ConflictError();

        var existingHours = row is { HasCustomWorkHours: true } ? await LoadHoursAsync(userId, tracking: true, ct) : [];
        var oldHours = DescribeHours(row?.HasCustomWorkHours ?? false, existingHours.Select(h => new WorkHourSlot(h.DayOfWeek, h.StartTime, h.EndTime)).OrderBy(x => x.DayOfWeek).ToList());
        var oldZone = row?.TimeZoneId;

        var now = clock.UtcNow;
        var created = row is null;
        row ??= new UserAvailability { UserId = userId };
        row.TimeZoneId = input.TimeZoneId;
        row.HasCustomWorkHours = input.WorkHours is not null;

        var newSlots = input.WorkHours ?? [];
        var existingByDay = existingHours.ToDictionary(h => h.DayOfWeek);
        foreach (var gone in existingHours.Where(h => newSlots.All(s => s.DayOfWeek != h.DayOfWeek)))
            db.Set<UserWorkHour>().Remove(gone);
        foreach (var slot in newSlots)
        {
            if (existingByDay.TryGetValue(slot.DayOfWeek, out var current))
            {
                current.StartTime = slot.Start;
                current.EndTime = slot.End;
            }
            else
            {
                db.Set<UserWorkHour>().Add(new UserWorkHour { UserId = userId, DayOfWeek = slot.DayOfWeek, StartTime = slot.Start, EndTime = slot.End });
            }
        }

        var events = AuditEvents(userId, oldHours, DescribeHours(input.WorkHours is not null, newSlots), oldZone, input.TimeZoneId);
        if (events.Count == 0 && !created)
            return await ToDtoAsync(userId, row, existingHours, ct); // nothing changed: no write, no audit event

        row.UpdatedAtUtc = now;
        row.UpdatedByUserId = currentUser.UserId;
        if (created)
            db.Set<UserAvailability>().Add(row);
        foreach (var e in events)
            audit.Write(e);

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            audit.DiscardPending();
            return ConflictError();
        }
        catch (DbUpdateException ex) when (created && ex.InnerException is Microsoft.Data.SqlClient.SqlException { Number: 2627 or 2601 })
        {
            audit.DiscardPending();
            return ConflictError(); // someone created the profile at the same moment
        }

        return await GetAsync(userId, ct);
    }

    public async Task<IReadOnlyDictionary<int, AvailabilityEvaluation>> EvaluateAsync(IReadOnlyCollection<int> userIds, DateTime nowUtc, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(userIds);
        var result = new Dictionary<int, AvailabilityEvaluation>();
        if (userIds.Count == 0)
            return result;

        // The window covers every zone's "today" and the 8 days the next-work-start search looks ahead.
        var utcDay = DateOnly.FromDateTime(DateTime.SpecifyKind(nowUtc, DateTimeKind.Utc));
        var profiles = await LoadProfilesAsync(userIds, utcDay.AddDays(-2), utcDay.AddDays(11), ct);
        foreach (var (id, profile) in profiles)
            result[id] = UserAvailabilityEvaluator.Evaluate(profile, nowUtc);
        return result;
    }

    public async Task<IReadOnlyDictionary<int, UserAvailabilityProfile>> LoadProfilesAsync(IReadOnlyCollection<int> userIds, DateOnly from, DateOnly to, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(userIds);
        var result = new Dictionary<int, UserAvailabilityProfile>();
        if (userIds.Count == 0)
            return result;

        var ids = userIds.Distinct().ToList();
        var rows = await db.Set<UserAvailability>().AsNoTracking().Where(a => ids.Contains(a.UserId)).ToListAsync(ct);
        var customIds = rows.Where(r => r.HasCustomWorkHours).Select(r => r.UserId).ToList();
        var hourRows = customIds.Count == 0
            ? new List<UserWorkHour>()
            : await db.Set<UserWorkHour>().AsNoTracking().Where(h => customIds.Contains(h.UserId)).ToListAsync(ct);
        var hours = hourRows.ToLookup(h => h.UserId);
        var absences = (await db.Set<UserAbsence>().AsNoTracking()
                .Where(a => ids.Contains(a.UserId) && (a.EndDate == null || a.EndDate >= from))
                .Select(a => new { a.UserId, a.StartDate, a.EndDate, a.AbsenceType, a.Note })
                .ToListAsync(ct))
            .ToLookup(a => a.UserId);
        var holidayDays = await holidays.LoadAsync(ids, from, to, ct);
        var byUser = rows.ToDictionary(r => r.UserId);
        foreach (var id in ids)
        {
            var periods = absences[id].Select(a => new AbsencePeriod(a.StartDate, a.EndDate, a.AbsenceType, a.Note)).OrderBy(p => p.Start).ToList();
            var holidaysOfUser = holidayDays.TryGetValue(id, out var list) ? list : [];
            result[id] = byUser.TryGetValue(id, out var row)
                ? ToProfile(row, hours.Contains(id) ? hours[id].ToList() : [], periods, holidaysOfUser)
                : UserAvailabilityProfile.Default with { ZoneId = FirmZoneId, Periods = periods, Holidays = holidaysOfUser };
        }

        return result;
    }

    public async Task<IReadOnlyDictionary<int, AwayWindow>> AwayWindowsAsync(IReadOnlyCollection<int> userIds, DateOnly from, DateOnly to, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(userIds);
        var result = new Dictionary<int, AwayWindow>();
        if (userIds.Count == 0)
            return result;

        var ids = userIds.Distinct().ToList();
        var rows = await db.Set<UserAbsence>().AsNoTracking()
            .Where(a => ids.Contains(a.UserId) && (a.EndDate == null || a.EndDate >= from))
            .Select(a => new { a.UserId, a.StartDate, a.EndDate })
            .ToListAsync(ct);
        foreach (var group in rows.GroupBy(r => r.UserId))
        {
            // Entries that touch are one window; the first window that overlaps the asked days is the answer.
            DateOnly? windowStart = null;
            DateOnly? windowEnd = null;
            var open = false;
            foreach (var a in group.OrderBy(r => r.StartDate))
            {
                if (open || (windowStart is not null && (windowEnd is null || a.StartDate <= windowEnd.Value.AddDays(1))))
                {
                    if (a.EndDate is null)
                        windowEnd = null;
                    else if (windowEnd is { } we && a.EndDate > we)
                        windowEnd = a.EndDate;
                    open = windowEnd is null;
                    continue;
                }

                if (windowStart is { } ws && Overlaps(ws, windowEnd, from, to))
                    break;
                windowStart = a.StartDate;
                windowEnd = a.EndDate;
                open = a.EndDate is null;
            }

            if (windowStart is { } start && Overlaps(start, windowEnd, from, to))
                result[group.Key] = new AwayWindow(start, windowEnd);
        }

        return result;
    }

    private static bool Overlaps(DateOnly start, DateOnly? end, DateOnly from, DateOnly to) => start <= to && (end is null || end >= from);

    private Task<List<UserWorkHour>> LoadHoursAsync(int userId, bool tracking, CancellationToken ct)
    {
        var query = db.Set<UserWorkHour>().Where(h => h.UserId == userId);
        return (tracking ? query : query.AsNoTracking()).OrderBy(h => h.DayOfWeek).ToListAsync(ct);
    }

    private UserAvailabilityProfile ToProfile(UserAvailability row, IReadOnlyCollection<UserWorkHour> hours, IReadOnlyList<AbsencePeriod> periods, IReadOnlyList<HolidayDay> holidayDays) =>
        new(
            periods,
            row.TimeZoneId ?? FirmZoneId,
            row.HasCustomWorkHours,
            hours.Select(h => new WorkHourSlot(h.DayOfWeek, h.StartTime, h.EndTime)).OrderBy(s => s.DayOfWeek).ToList(),
            holidayDays);

    private async Task<UserAvailabilityDto> ToDtoAsync(int userId, UserAvailability? row, IReadOnlyCollection<UserWorkHour> hours, CancellationToken ct)
    {
        var now = clock.UtcNow;
        var today = DateOnly.FromDateTime(now);
        var window = await LoadProfilesAsync([userId], today.AddDays(-2), today.AddDays(400), ct);
        var loaded = window[userId];
        var profile = loaded with
        {
            ZoneId = row?.TimeZoneId ?? FirmZoneId,
            HasCustomWorkHours = row?.HasCustomWorkHours ?? false,
            WorkHours = hours.Select(h => new WorkHourSlot(h.DayOfWeek, h.StartTime, h.EndTime)).OrderBy(s => s.DayOfWeek).ToList(),
        };
        var evaluation = UserAvailabilityEvaluator.Evaluate(profile, now);
        var zone = UserTimeZone.Resolve(profile.ZoneId);
        var localToday = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(now, DateTimeKind.Utc), zone.Zone));

        var entries = await db.Set<UserAbsence>().AsNoTracking()
            .Where(a => a.UserId == userId && (a.EndDate == null || a.EndDate >= localToday))
            .OrderBy(a => a.StartDate).ThenBy(a => a.Id)
            .ToListAsync(ct);
        var absences = entries.Select(a => AbsenceService.ToDto(a, localToday, profile)).ToList();

        var effective = (await holidays.EffectiveCalendarsAsync([userId], ct)).GetValueOrDefault(userId);
        var next = profile.Holidays.Where(h => h.Date >= localToday).OrderBy(h => h.Date).Take(5).Select(h => new NextHolidayDto(h.Date, h.Name)).ToList();
        return new UserAvailabilityDto(
            userId,
            row?.TimeZoneId,
            zone.Id,
            !(row?.HasCustomWorkHours ?? false),
            UserAvailabilityEvaluator.EffectiveWorkHours(profile).OrderBy(s => s.DayOfWeek).Select(s => new WorkHourDto(s.DayOfWeek, FormatTime(s.Start), FormatTime(s.End))).ToList(),
            new CurrentAvailabilityDto(evaluation.State, evaluation.OutUntilUtc, evaluation.Note, evaluation.NextWorkStartUtc, evaluation.Reason, evaluation.AbsenceType),
            absences,
            effective is null ? null : new HolidayCalendarRefDto(effective.CalendarId, effective.Name, effective.Source),
            next,
            row is null ? null : DateTime.SpecifyKind(row.UpdatedAtUtc, DateTimeKind.Utc),
            row?.UpdatedByUserId,
            row is null ? NewRowVersion : Convert.ToBase64String(row.RowVersion));
    }

    private sealed record ValidInput(string? TimeZoneId, List<WorkHourSlot>? WorkHours);

    private static Result<ValidInput> Validate(SaveAvailabilityRequest request)
    {
        string? zone = null;
        if (!string.IsNullOrWhiteSpace(request.TimeZoneId))
        {
            zone = request.TimeZoneId.Trim();
            if (!UserTimeZone.IsValidIanaId(zone))
                return Error.Validation("timeZoneId", AvailabilityErrorCodes.TimeZoneUnknown, "The time zone is not a known IANA id (for example America/Chicago).", AvailabilityErrorCodes.TimeZoneUnknown);
            zone = UserTimeZone.Resolve(zone).Id;
        }

        List<WorkHourSlot>? slots = null;
        if (request.WorkHours is { } hours)
        {
            slots = [];
            foreach (var h in hours)
            {
                if (h is null || h.DayOfWeek is < 1 or > 7)
                    return WorkHoursError("dayOfWeek must be 1 (Monday) to 7 (Sunday).");
                if (!TryParseTime(h.Start, out var s) || !TryParseTime(h.End, out var e))
                    return WorkHoursError("Start and end must be times like 09:00.");
                if (e <= s)
                    return WorkHoursError("The end time must be after the start time.");
                if (slots.Any(x => x.DayOfWeek == h.DayOfWeek))
                    return WorkHoursError("A weekday can appear only once.");
                slots.Add(new WorkHourSlot(h.DayOfWeek, s, e));
            }

            slots.Sort((a, b) => a.DayOfWeek.CompareTo(b.DayOfWeek));
        }

        return new ValidInput(zone, slots);
    }

    private static Error WorkHoursError(string message) =>
        Error.Validation("workHours", AvailabilityErrorCodes.WorkHoursInvalid, message, AvailabilityErrorCodes.WorkHoursInvalid);

    private static bool TryParseTime(string? text, out TimeOnly time) =>
        TimeOnly.TryParseExact(text?.Trim(), ["HH:mm", "HH:mm:ss"], CultureInfo.InvariantCulture, DateTimeStyles.None, out time);

    private static string FormatTime(TimeOnly time) => time.ToString("HH:mm", CultureInfo.InvariantCulture);

    private static Error ConflictError() =>
        Error.Conflict(ErrorCodes.ConcurrencyConflict, "The availability was changed by someone else. Reload and try again.");

    private List<AuditEntry> AuditEvents(int userId, string hoursBefore, string hoursAfter, string? zoneBefore, string? newZone)
    {
        var onBehalf = currentUser.UserId is { } actor && actor != userId ? " (on behalf)" : string.Empty;
        var events = new List<AuditEntry>();
        if (!string.Equals(zoneBefore, newZone, StringComparison.Ordinal))
        {
            events.Add(new AuditEntry
            {
                EventType = "USER_TIME_ZONE_CHANGED",
                ObjectType = "User",
                ObjectId = userId.ToString(CultureInfo.InvariantCulture),
                FieldKey = "timeZone",
                OldValue = zoneBefore,
                NewValue = newZone,
                Summary = (newZone is null ? "Time zone reset to the firm zone" : $"Time zone set to {newZone}") + onBehalf,
            });
        }

        if (hoursBefore != hoursAfter)
        {
            events.Add(new AuditEntry
            {
                EventType = "USER_WORK_HOURS_CHANGED",
                ObjectType = "User",
                ObjectId = userId.ToString(CultureInfo.InvariantCulture),
                FieldKey = "workHours",
                OldValue = hoursBefore,
                NewValue = hoursAfter,
                Summary = (hoursAfter == "default" ? "Work hours reset to the default (Mon-Fri 09:00-17:00)" : "Changed work hours") + onBehalf,
            });
        }

        return events;
    }

    private static string DescribeHours(bool custom, IReadOnlyCollection<WorkHourSlot> slots) =>
        custom
            ? string.Join("; ", slots.OrderBy(s => s.DayOfWeek).Select(s => $"{s.DayOfWeek} {FormatTime(s.Start)}-{FormatTime(s.End)}"))
            : "default";
}
