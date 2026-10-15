using System.Globalization;
using MatterFlow.Audit.Contracts;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
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
    public const string StatusInvalid = "STATUS_INVALID";
    public const string OutOfOfficeRangeInvalid = "OOO_RANGE_INVALID";
    public const string WorkHoursInvalid = "WORK_HOURS_INVALID";
    public const string TimeZoneUnknown = "TIMEZONE_UNKNOWN";
    public const string NoteTooLong = "NOTE_TOO_LONG";
}

/// <summary>
/// Availability profile of a user: read, save (own or on behalf), and bulk evaluation for other modules. Every change is audited with
/// readable text ("Set out of office until Oct 20"). Operational capacity only, never a performance measure.
/// </summary>
public sealed class UserAvailabilityService(
    DbContext db,
    IAuditWriter audit,
    ICurrentUser currentUser,
    IClock clock,
    IConfiguration configuration) : IUserAvailabilityReader
{
    public const int MaxNoteLength = 200;
    public const string NewRowVersion = "NEW";

    /// <summary>Plausible date range for out-of-office dates (also keeps date arithmetic away from DateOnly limits).</summary>
    private static readonly DateOnly MinDate = new(2000, 1, 1);

    private static readonly DateOnly MaxDate = new(2100, 12, 31);

    private string FirmZoneId => configuration["Firm:TimeZoneId"] ?? UserTimeZone.DefaultFirmZoneId;

    public async Task<Result<UserAvailabilityDto>> GetAsync(int userId, CancellationToken ct)
    {
        if (!await db.Set<AppUser>().AnyAsync(u => u.Id == userId, ct))
            return Error.NotFound("The user does not exist.");

        var row = await db.Set<UserAvailability>().AsNoTracking().FirstOrDefaultAsync(a => a.UserId == userId, ct);
        var hours = row is { HasCustomWorkHours: true } ? await LoadHoursAsync(userId, tracking: false, ct) : [];
        return ToDto(userId, row, hours);
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
        var oldProfile = ToProfile(row, existingHours);
        var oldZone = row?.TimeZoneId;

        var now = clock.UtcNow;
        var created = row is null;
        row ??= new UserAvailability { UserId = userId };
        row.Status = input.Status;
        row.OutOfOfficeFromDate = input.From;
        row.OutOfOfficeUntilDate = input.Until;
        row.Note = input.Note;
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

        var newProfile = ToProfile(row, newSlots.Select(s => new UserWorkHour { UserId = userId, DayOfWeek = s.DayOfWeek, StartTime = s.Start, EndTime = s.End }).ToList());
        var events = AuditEvents(userId, oldProfile, newProfile, oldZone, input.TimeZoneId);
        if (events.Count == 0 && !created)
            return ToDto(userId, row, existingHours); // nothing changed: no write, no audit event

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

        var ids = userIds.Distinct().ToList();
        var rows = await db.Set<UserAvailability>().AsNoTracking().Where(a => ids.Contains(a.UserId)).ToListAsync(ct);
        var customIds = rows.Where(r => r.HasCustomWorkHours).Select(r => r.UserId).ToList();
        var hourRows = customIds.Count == 0
            ? new List<UserWorkHour>()
            : await db.Set<UserWorkHour>().AsNoTracking().Where(h => customIds.Contains(h.UserId)).ToListAsync(ct);
        var hours = hourRows.ToLookup(h => h.UserId);
        var byUser = rows.ToDictionary(r => r.UserId);
        foreach (var id in ids)
        {
            var profile = byUser.TryGetValue(id, out var row)
                ? ToProfile(row, hours.Contains(id) ? hours[id].ToList() : [])
                : UserAvailabilityProfile.Default with { ZoneId = FirmZoneId };
            result[id] = UserAvailabilityEvaluator.Evaluate(profile, nowUtc);
        }

        return result;
    }

    private Task<List<UserWorkHour>> LoadHoursAsync(int userId, bool tracking, CancellationToken ct)
    {
        var query = db.Set<UserWorkHour>().Where(h => h.UserId == userId);
        return (tracking ? query : query.AsNoTracking()).OrderBy(h => h.DayOfWeek).ToListAsync(ct);
    }

    private UserAvailabilityProfile ToProfile(UserAvailability? row, IReadOnlyCollection<UserWorkHour> hours) =>
        row is null
            ? UserAvailabilityProfile.Default with { ZoneId = FirmZoneId }
            : new UserAvailabilityProfile(
                row.Status,
                row.OutOfOfficeFromDate,
                row.OutOfOfficeUntilDate,
                row.Note,
                row.TimeZoneId ?? FirmZoneId,
                row.HasCustomWorkHours,
                hours.Select(h => new WorkHourSlot(h.DayOfWeek, h.StartTime, h.EndTime)).OrderBy(s => s.DayOfWeek).ToList());

    private UserAvailabilityDto ToDto(int userId, UserAvailability? row, IReadOnlyCollection<UserWorkHour> hours)
    {
        var profile = ToProfile(row, hours);
        var evaluation = UserAvailabilityEvaluator.Evaluate(profile, clock.UtcNow);
        var zoneId = UserTimeZone.Resolve(profile.ZoneId).Id;
        return new UserAvailabilityDto(
            userId,
            row?.Status ?? AvailabilityStatuses.Available,
            row?.OutOfOfficeFromDate,
            row?.OutOfOfficeUntilDate,
            row?.Note,
            row?.TimeZoneId,
            zoneId,
            !(row?.HasCustomWorkHours ?? false),
            UserAvailabilityEvaluator.EffectiveWorkHours(profile).OrderBy(s => s.DayOfWeek).Select(s => new WorkHourDto(s.DayOfWeek, FormatTime(s.Start), FormatTime(s.End))).ToList(),
            new CurrentAvailabilityDto(evaluation.State, evaluation.OutUntilUtc, evaluation.Note, evaluation.NextWorkStartUtc),
            row is null ? null : DateTime.SpecifyKind(row.UpdatedAtUtc, DateTimeKind.Utc),
            row?.UpdatedByUserId,
            row is null ? NewRowVersion : Convert.ToBase64String(row.RowVersion));
    }

    private sealed record ValidInput(string Status, DateOnly? From, DateOnly? Until, string? Note, string? TimeZoneId, List<WorkHourSlot>? WorkHours);

    private static Result<ValidInput> Validate(SaveAvailabilityRequest request)
    {
        var status = request.Status?.Trim().ToUpperInvariant();
        if (!AvailabilityStatuses.IsValid(status))
            return Error.Validation("status", AvailabilityErrorCodes.StatusInvalid, "status must be AVAILABLE or OUT_OF_OFFICE.", AvailabilityErrorCodes.StatusInvalid);

        string? zone = null;
        if (!string.IsNullOrWhiteSpace(request.TimeZoneId))
        {
            zone = request.TimeZoneId.Trim();
            if (!UserTimeZone.IsValidIanaId(zone))
                return Error.Validation("timeZoneId", AvailabilityErrorCodes.TimeZoneUnknown, "The time zone is not a known IANA id (for example America/Chicago).", AvailabilityErrorCodes.TimeZoneUnknown);
            zone = UserTimeZone.Resolve(zone).Id;
        }

        DateOnly? from = null;
        DateOnly? until = null;
        string? note = null;
        if (status == AvailabilityStatuses.OutOfOffice)
        {
            from = request.From;
            until = request.Until;
            if ((from is { } f && (f < MinDate || f > MaxDate)) || (until is { } u && (u < MinDate || u > MaxDate)))
                return Error.Validation("from", AvailabilityErrorCodes.OutOfOfficeRangeInvalid, "Out-of-office dates must be between 2000 and 2100.", AvailabilityErrorCodes.OutOfOfficeRangeInvalid);
            if (from is { } start && until is { } end && end < start)
                return Error.Validation("until", AvailabilityErrorCodes.OutOfOfficeRangeInvalid, "The last day out of office cannot be before the first day.", AvailabilityErrorCodes.OutOfOfficeRangeInvalid);

            note = CleanNote(request.Note);
            if (note is { Length: > MaxNoteLength })
                return Error.Validation("note", AvailabilityErrorCodes.NoteTooLong, $"The note can be at most {MaxNoteLength} characters.", AvailabilityErrorCodes.NoteTooLong);
        }
        else if (request.Note is { } raw && CleanNote(raw) is { Length: > MaxNoteLength })
        {
            return Error.Validation("note", AvailabilityErrorCodes.NoteTooLong, $"The note can be at most {MaxNoteLength} characters.", AvailabilityErrorCodes.NoteTooLong);
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

        return new ValidInput(status!, from, until, note, zone, slots);
    }

    private static Error WorkHoursError(string message) =>
        Error.Validation("workHours", AvailabilityErrorCodes.WorkHoursInvalid, message, AvailabilityErrorCodes.WorkHoursInvalid);

    /// <summary>Plain text: control characters (including line breaks) become spaces, then trimmed. Rendering as text is the client's job.</summary>
    private static string? CleanNote(string? note)
    {
        if (string.IsNullOrWhiteSpace(note))
            return null;
        var chars = note.Select(c => char.IsControl(c) ? ' ' : c).ToArray();
        var clean = new string(chars).Trim();
        return clean.Length == 0 ? null : clean;
    }

    private static bool TryParseTime(string? text, out TimeOnly time) =>
        TimeOnly.TryParseExact(text?.Trim(), ["HH:mm", "HH:mm:ss"], CultureInfo.InvariantCulture, DateTimeStyles.None, out time);

    private static string FormatTime(TimeOnly time) => time.ToString("HH:mm", CultureInfo.InvariantCulture);

    private static Error ConflictError() =>
        Error.Conflict(ErrorCodes.ConcurrencyConflict, "The availability was changed by someone else. Reload and try again.");

    private List<AuditEntry> AuditEvents(int userId, UserAvailabilityProfile before, UserAvailabilityProfile after, string? zoneBefore, string? newZone)
    {
        var onBehalf = currentUser.UserId is { } actor && actor != userId ? " (on behalf)" : string.Empty;
        var events = new List<AuditEntry>();
        var availabilityChanged = before.Status != after.Status
            || before.OutOfOfficeFromDate != after.OutOfOfficeFromDate
            || before.OutOfOfficeUntilDate != after.OutOfOfficeUntilDate
            || before.Note != after.Note;
        if (availabilityChanged)
        {
            events.Add(new AuditEntry
            {
                EventType = "USER_AVAILABILITY_CHANGED",
                ObjectType = "User",
                ObjectId = userId.ToString(CultureInfo.InvariantCulture),
                FieldKey = "availability",
                OldValue = Describe(before),
                NewValue = Describe(after),
                Summary = AvailabilityText(before, after) + onBehalf,
            });
        }

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

        var hoursBefore = DescribeHours(before);
        var hoursAfter = DescribeHours(after);
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
                Summary = (after.HasCustomWorkHours ? "Changed work hours" : "Work hours reset to the default (Mon-Fri 09:00-17:00)") + onBehalf,
            });
        }

        return events;
    }

    private static string AvailabilityText(UserAvailabilityProfile before, UserAvailabilityProfile after)
    {
        if (after.Status == AvailabilityStatuses.Available)
            return "Set available";

        var statusChanged = before.Status != after.Status;
        var datesChanged = before.OutOfOfficeFromDate != after.OutOfOfficeFromDate || before.OutOfOfficeUntilDate != after.OutOfOfficeUntilDate;
        if (!statusChanged && !datesChanged)
            return "Changed the out-of-office note";

        var verb = statusChanged ? "Set out of office" : "Changed out of office";
        return (after.OutOfOfficeFromDate, after.OutOfOfficeUntilDate) switch
        {
            ({ } f, { } u) => $"{verb} from {ShortDate(f)} until {ShortDate(u)}",
            ({ } f, null) => $"{verb} from {ShortDate(f)}",
            (null, { } u) => $"{verb} until {ShortDate(u)}",
            _ => verb,
        };
    }

    private static string ShortDate(DateOnly date) => date.ToString("MMM d", CultureInfo.InvariantCulture);

    private static string Describe(UserAvailabilityProfile p) =>
        p.Status == AvailabilityStatuses.Available
            ? p.Status
            : $"{p.Status} {p.OutOfOfficeFromDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "-"}..{p.OutOfOfficeUntilDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "-"}{(p.Note is null ? string.Empty : " " + p.Note)}";

    private static string DescribeHours(UserAvailabilityProfile p) =>
        p.HasCustomWorkHours
            ? string.Join("; ", p.WorkHours.OrderBy(s => s.DayOfWeek).Select(s => $"{s.DayOfWeek} {FormatTime(s.Start)}-{FormatTime(s.End)}"))
            : "default";
}
