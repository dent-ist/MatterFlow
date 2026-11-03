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

/// <summary>Stable error codes of the absence API.</summary>
public static class AbsenceErrorCodes
{
    public const string TypeInvalid = "ABSENCE_TYPE_INVALID";
    public const string RangeInvalid = "ABSENCE_RANGE_INVALID";
    public const string NoteTooLong = "NOTE_TOO_LONG";
    public const string InPast = "ABSENCE_IN_PAST";
    public const string OpenEndedNotToday = "ABSENCE_OPEN_ENDED_NOT_TODAY";
    public const string ReadOnly = "ABSENCE_READ_ONLY";
    public const string Overlap = "ABSENCE_OVERLAP";
}

/// <summary>
/// The Out of office entries of a person (script 58, decision AT items 4, 5 and 15): list, add, change, delete and "I'm back". Rules: the end day is inclusive; an entry
/// may not overlap another entry of the same person (409 naming the other entry, checked in one transaction with a range lock on the person's rows); a start in the past is refused
/// except Sick (up to 14 days back) and a manager entering for someone else; past entries are read-only; an open-ended entry must start today (the header quick action);
/// the note is at most 200 characters. Every write is a semantic audit event. Who may do what: <see cref="ICalendarAccess.CanEditAbsencesOfAsync"/>.
/// </summary>
public sealed class AbsenceService(
    DbContext db,
    IAuditWriter audit,
    ICurrentUser currentUser,
    IClock clock,
    IConfiguration configuration,
    ICalendarAccess access,
    UserAvailabilityService availability)
{
    public const int MaxNoteLength = 200;

    /// <summary>How far back a Sick entry may start.</summary>
    public const int SickBackDays = 14;

    private static readonly DateOnly MinDate = new(2000, 1, 1);
    private static readonly DateOnly MaxDate = new(2100, 12, 31);

    public async Task<Result<IReadOnlyList<AbsenceDto>>> ListAsync(int userId, bool includePast, CancellationToken ct)
    {
        var denied = await GuardAsync(userId, ct);
        if (denied is not null)
            return denied;

        var zone = await ZoneAsync(userId, ct);
        var today = TodayIn(zone);
        var query = db.Set<UserAbsence>().AsNoTracking().Where(a => a.UserId == userId);
        if (!includePast)
            query = query.Where(a => a.EndDate == null || a.EndDate >= today);
        var rows = await query.OrderBy(a => a.StartDate).ThenBy(a => a.Id).ToListAsync(ct);
        return Result<IReadOnlyList<AbsenceDto>>.Success(await ToDtosAsync(userId, rows, today, ct));
    }

    public async Task<Result<AbsenceDto>> CreateAsync(int userId, CreateAbsenceRequest request, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);
        var denied = await GuardAsync(userId, ct);
        if (denied is not null)
            return denied;

        var zone = await ZoneAsync(userId, ct);
        var today = TodayIn(zone);
        var valid = Validate(request.Type, request.StartDate, request.EndDate, request.Note, today, existing: null, ActorIsManager(userId));
        if (valid.IsFailure)
            return valid.Error!;
        var input = valid.Value!;

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var overlap = await FindOverlapAsync(userId, null, input.Start, input.End, ct);
        if (overlap is not null)
            return OverlapError(overlap);

        var now = clock.UtcNow;
        var row = new UserAbsence
        {
            UserId = userId,
            AbsenceType = input.Type,
            StartDate = input.Start,
            EndDate = input.End,
            Note = input.Note,
            CreatedAtUtc = now,
            CreatedByUserId = currentUser.UserId,
            UpdatedAtUtc = now,
            UpdatedByUserId = currentUser.UserId,
        };
        db.Set<UserAbsence>().Add(row);
        var subject = await SubjectNameAsync(userId, ct);
        audit.Write(Event("USER_ABSENCE_ADDED", userId, null, Describe(input.Type, input.Start, input.End, input.Note), $"Added {Text(input.Type, input.Start, input.End)}{For(userId, subject)}"));
        var failure = await TrySaveAsync(tx, ct);
        if (failure is not null)
            return failure;

        return (await ToDtosAsync(userId, [row], today, ct))[0];
    }

    public async Task<Result<AbsenceDto>> UpdateAsync(int userId, int absenceId, UpdateAbsenceRequest request, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);
        var denied = await GuardAsync(userId, ct);
        if (denied is not null)
            return denied;

        var zone = await ZoneAsync(userId, ct);
        var today = TodayIn(zone);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var row = await db.Set<UserAbsence>().FirstOrDefaultAsync(a => a.Id == absenceId && a.UserId == userId, ct);
        if (row is null)
            return Error.NotFound("The entry does not exist.");
        if (!string.Equals(request.RowVersion, Convert.ToBase64String(row.RowVersion), StringComparison.Ordinal))
            return ConflictError();
        if (IsPast(row, today))
            return Error.Validation("absenceId", AbsenceErrorCodes.ReadOnly, "An entry that has ended is history and cannot be changed.", AbsenceErrorCodes.ReadOnly);

        var valid = Validate(request.Type, request.StartDate, request.EndDate, request.Note, today, row, ActorIsManager(userId));
        if (valid.IsFailure)
            return valid.Error!;
        var input = valid.Value!;
        var overlap = await FindOverlapAsync(userId, absenceId, input.Start, input.End, ct);
        if (overlap is not null)
            return OverlapError(overlap);

        var before = Describe(row.AbsenceType, row.StartDate, row.EndDate, row.Note);
        var changed = row.AbsenceType != input.Type || row.StartDate != input.Start || row.EndDate != input.End || row.Note != input.Note;
        if (changed)
        {
            row.AbsenceType = input.Type;
            row.StartDate = input.Start;
            row.EndDate = input.End;
            row.Note = input.Note;
            row.UpdatedAtUtc = clock.UtcNow;
            row.UpdatedByUserId = currentUser.UserId;
            db.Entry(row).Property(x => x.RowVersion).OriginalValue = row.RowVersion;
            var subject = await SubjectNameAsync(userId, ct);
            audit.Write(Event("USER_ABSENCE_CHANGED", userId, before, Describe(input.Type, input.Start, input.End, input.Note), $"Changed {Text(input.Type, input.Start, input.End)}{For(userId, subject)}"));
            var failure = await TrySaveAsync(tx, ct);
            if (failure is not null)
                return failure;
        }

        return (await ToDtosAsync(userId, [row], today, ct))[0];
    }

    public async Task<Result> DeleteAsync(int userId, int absenceId, string? rowVersion, CancellationToken ct)
    {
        var denied = await GuardAsync(userId, ct);
        if (denied is not null)
            return denied;

        var today = TodayIn(await ZoneAsync(userId, ct));
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var row = await db.Set<UserAbsence>().FirstOrDefaultAsync(a => a.Id == absenceId && a.UserId == userId, ct);
        if (row is null)
            return Error.NotFound("The entry does not exist.");
        if (!string.Equals(rowVersion, Convert.ToBase64String(row.RowVersion), StringComparison.Ordinal))
            return ConflictError();
        if (IsPast(row, today))
            return Error.Validation("absenceId", AbsenceErrorCodes.ReadOnly, "An entry that has ended is history and cannot be deleted.", AbsenceErrorCodes.ReadOnly);

        db.Entry(row).Property(x => x.RowVersion).OriginalValue = row.RowVersion;
        db.Set<UserAbsence>().Remove(row);
        var subject = await SubjectNameAsync(userId, ct);
        audit.Write(Event("USER_ABSENCE_DELETED", userId, Describe(row.AbsenceType, row.StartDate, row.EndDate, row.Note), null, $"Deleted {Text(row.AbsenceType, row.StartDate, row.EndDate)}{For(userId, subject)}"));
        var failure = await TrySaveAsync(tx, ct);
        return failure is null ? Result.Success() : failure;
    }

    /// <summary>"I'm back": ends the entry that covers today yesterday; an entry that has not started (or starts today) is deleted instead.</summary>
    public async Task<Result<AbsenceBackResult>> BackAsync(int userId, int absenceId, CancellationToken ct)
    {
        var denied = await GuardAsync(userId, ct);
        if (denied is not null)
            return denied;

        var today = TodayIn(await ZoneAsync(userId, ct));
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var row = await db.Set<UserAbsence>().FirstOrDefaultAsync(a => a.Id == absenceId && a.UserId == userId, ct);
        if (row is null)
            return Error.NotFound("The entry does not exist.");
        if (IsPast(row, today))
            return Error.Validation("absenceId", AbsenceErrorCodes.ReadOnly, "An entry that has ended is history and cannot be changed.", AbsenceErrorCodes.ReadOnly);

        var subject = await SubjectNameAsync(userId, ct);
        var before = Describe(row.AbsenceType, row.StartDate, row.EndDate, row.Note);
        if (row.StartDate >= today)
        {
            db.Entry(row).Property(x => x.RowVersion).OriginalValue = row.RowVersion;
            db.Set<UserAbsence>().Remove(row);
            audit.Write(Event("USER_ABSENCE_DELETED", userId, before, null, $"Is back: removed {Text(row.AbsenceType, row.StartDate, row.EndDate)}{For(userId, subject)}"));
            var removed = await TrySaveAsync(tx, ct);
            return removed is not null ? removed : new AbsenceBackResult(true, null);
        }

        row.EndDate = today.AddDays(-1);
        row.UpdatedAtUtc = clock.UtcNow;
        row.UpdatedByUserId = currentUser.UserId;
        db.Entry(row).Property(x => x.RowVersion).OriginalValue = row.RowVersion;
        audit.Write(Event("USER_ABSENCE_CHANGED", userId, before, Describe(row.AbsenceType, row.StartDate, row.EndDate, row.Note), $"Is back: ended {Text(row.AbsenceType, row.StartDate, row.EndDate)}{For(userId, subject)}"));
        var failure = await TrySaveAsync(tx, ct);
        if (failure is not null)
            return failure;
        return new AbsenceBackResult(false, (await ToDtosAsync(userId, [row], today, ct))[0]);
    }

    /// <summary>The entry as the API shows it (state, working days). <paramref name="profile"/> supplies the work hours and holidays for the working-day count.</summary>
    public static AbsenceDto ToDto(UserAbsence a, DateOnly today, UserAvailabilityProfile profile)
    {
        var state = IsPast(a, today) ? "PAST" : a.StartDate > today ? "UPCOMING" : "NOW";
        int? workingDays = null;
        if (a.EndDate is { } end && end >= a.StartDate && (end.DayNumber - a.StartDate.DayNumber) <= 800)
        {
            var bare = profile with { Periods = [] };
            workingDays = 0;
            for (var d = a.StartDate; d <= end; d = d.AddDays(1))
            {
                if (UserAvailabilityEvaluator.EvaluateDay(bare, d).State == DayStates.Available)
                    workingDays++;
            }
        }

        return new AbsenceDto(a.Id, a.UserId, a.AbsenceType, a.StartDate, a.EndDate, a.Note, state, workingDays, Convert.ToBase64String(a.RowVersion));
    }

    private static bool IsPast(UserAbsence a, DateOnly today) => a.EndDate is { } end && end < today;

    private async Task<List<AbsenceDto>> ToDtosAsync(int userId, IReadOnlyCollection<UserAbsence> rows, DateOnly today, CancellationToken ct)
    {
        if (rows.Count == 0)
            return [];
        var from = rows.Min(r => r.StartDate);
        var to = rows.Max(r => r.EndDate ?? r.StartDate);
        var profile = (await availability.LoadProfilesAsync([userId], from, to, ct))[userId];
        return [.. rows.Select(r => ToDto(r, today, profile))];
    }

    private sealed record ValidInput(string Type, DateOnly Start, DateOnly? End, string? Note);

    private Result<ValidInput> Validate(string? requestType, DateOnly startDate, DateOnly? endDate, string? requestNote, DateOnly today, UserAbsence? existing, bool managerForOther)
    {
        var type = requestType?.Trim().ToUpperInvariant();
        if (!AbsenceTypes.IsValid(type))
            return Error.Validation("type", AbsenceErrorCodes.TypeInvalid, "type must be VACATION, SICK, TRAINING, CONFERENCE or OTHER.", AbsenceErrorCodes.TypeInvalid);

        var start = startDate;
        var end = endDate;
        if (start < MinDate || start > MaxDate || (end is { } e && (e < MinDate || e > MaxDate)))
            return Error.Validation("startDate", AbsenceErrorCodes.RangeInvalid, "Dates must be between 2000 and 2100.", AbsenceErrorCodes.RangeInvalid);
        if (end is { } last && last < start)
            return Error.Validation("endDate", AbsenceErrorCodes.RangeInvalid, "The last day out of office cannot be before the first day.", AbsenceErrorCodes.RangeInvalid);

        string? note = CleanNote(requestNote);
        if (note is { Length: > MaxNoteLength })
            return Error.Validation("note", AbsenceErrorCodes.NoteTooLong, $"The note can be at most {MaxNoteLength} characters.", AbsenceErrorCodes.NoteTooLong);

        // A start in the past: only for Sick (14 days back) and for a manager entering for someone else. An unchanged start of a running entry stays as it is.
        var startChanged = existing is null || existing.StartDate != start;
        if (startChanged && start < today && !managerForOther)
        {
            var sickOk = type == AbsenceTypes.Sick && start >= today.AddDays(-SickBackDays);
            if (!sickOk)
            {
                return Error.Validation(
                    "startDate",
                    AbsenceErrorCodes.InPast,
                    type == AbsenceTypes.Sick ? $"A sick entry can start at most {SickBackDays} days back." : "The first day cannot be in the past.",
                    AbsenceErrorCodes.InPast);
            }
        }

        // Open-ended ("until I'm back") is the header quick action: it starts today. A running open-ended entry may be saved again as it is.
        if (end is null && start != today && !(existing is { EndDate: null }))
            return Error.Validation("endDate", AbsenceErrorCodes.OpenEndedNotToday, "Choose the last day out of office (an open-ended entry starts today).", AbsenceErrorCodes.OpenEndedNotToday);

        return new ValidInput(type!, start, end, note);
    }

    private bool ActorIsManager(int userId) => currentUser.UserId is { } actor && actor != userId;

    private async Task<Error?> GuardAsync(int userId, CancellationToken ct)
    {
        if (!await db.Set<AppUser>().AnyAsync(u => u.Id == userId, ct))
            return Error.NotFound("The user does not exist.");
        if (!await access.CanEditAbsencesOfAsync(userId, ct))
            return Error.Forbidden("You cannot manage this person's Out of office entries.");
        return null;
    }

    private async Task<TimeZoneInfo> ZoneAsync(int userId, CancellationToken ct)
    {
        var zoneId = await db.Set<UserAvailability>().AsNoTracking().Where(a => a.UserId == userId).Select(a => a.TimeZoneId).FirstOrDefaultAsync(ct);
        return UserTimeZone.Resolve(zoneId ?? configuration["Firm:TimeZoneId"] ?? UserTimeZone.DefaultFirmZoneId).Zone;
    }

    private DateOnly TodayIn(TimeZoneInfo zone) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(clock.UtcNow, DateTimeKind.Utc), zone));

    private async Task<UserAbsence?> FindOverlapAsync(int userId, int? exceptId, DateOnly start, DateOnly? end, CancellationToken ct)
    {
        // The range lock on the person's rows makes two concurrent adds for one person take turns.
        var locked = db.Set<UserAbsence>().FromSqlInterpolated($"SELECT * FROM dbo.UserAbsence WITH (UPDLOCK, HOLDLOCK) WHERE UserId = {userId}");
        var last = end ?? DateOnly.MaxValue;
        return await locked.AsNoTracking()
            .Where(a => (exceptId == null || a.Id != exceptId) && a.StartDate <= last && (a.EndDate == null || a.EndDate >= start))
            .OrderBy(a => a.StartDate)
            .FirstOrDefaultAsync(ct);
    }

    private static Error OverlapError(UserAbsence other) =>
        Error.Conflict(
            AbsenceErrorCodes.Overlap,
            $"This overlaps your {Pretty(other.AbsenceType)} entry {RangeText(other.StartDate, other.EndDate)}.",
            new Dictionary<string, object?> { ["overlapsWith"] = new AbsenceOverlapDto(other.Id, other.AbsenceType, other.StartDate, other.EndDate) });

    private async Task<Error?> TrySaveAsync(Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction tx, CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return null;
        }
        catch (DbUpdateConcurrencyException)
        {
            audit.DiscardPending();
            return ConflictError();
        }
    }

    private static Error ConflictError() => Error.Conflict(ErrorCodes.ConcurrencyConflict, "The entry was changed by someone else. Reload and try again.");

    private string For(int userId, string? subject) => currentUser.UserId == userId || subject is null ? string.Empty : $" for {subject}";

    private async Task<string?> SubjectNameAsync(int userId, CancellationToken ct) =>
        currentUser.UserId == userId ? null : await db.Set<AppUser>().AsNoTracking().Where(u => u.Id == userId).Select(u => u.DisplayName).FirstOrDefaultAsync(ct);

    private static AuditEntry Event(string type, int userId, string? oldValue, string? newValue, string summary) => new()
    {
        EventType = type,
        ObjectType = "User",
        ObjectId = userId.ToString(CultureInfo.InvariantCulture),
        FieldKey = "absence",
        OldValue = oldValue,
        NewValue = newValue,
        Summary = summary,
    };

    private static string Pretty(string type) => type switch
    {
        AbsenceTypes.Vacation => "Vacation",
        AbsenceTypes.Sick => "Sick",
        AbsenceTypes.Training => "Training",
        AbsenceTypes.Conference => "Conference",
        _ => "Other",
    };

    private static string RangeText(DateOnly start, DateOnly? end) =>
        end is { } last ? $"{HolidayDateText(start)} to {HolidayDateText(last)}" : $"from {HolidayDateText(start)} until back";

    private static string HolidayDateText(DateOnly date) => date.ToString("MM'/'dd'/'yyyy", CultureInfo.InvariantCulture);

    private static string Text(string type, DateOnly start, DateOnly? end) => $"{Pretty(type)} {RangeText(start, end)}";

    private static string Describe(string type, DateOnly start, DateOnly? end, string? note) =>
        $"{type} {start:yyyy-MM-dd}..{(end is { } e ? e.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : "-")}{(note is null ? string.Empty : " " + note)}";

    /// <summary>Plain text: control characters (including line breaks) become spaces, then trimmed. Rendering as text is the client's job.</summary>
    private static string? CleanNote(string? note)
    {
        if (string.IsNullOrWhiteSpace(note))
            return null;
        var chars = note.Select(c => char.IsControl(c) ? ' ' : c).ToArray();
        var clean = new string(chars).Trim();
        return clean.Length == 0 ? null : clean;
    }
}

/// <summary>Result of "I'm back": the entry was removed (it had not started) or ended yesterday.</summary>
public sealed record AbsenceBackResult([property: System.ComponentModel.DataAnnotations.Required] bool Deleted, AbsenceDto? Absence);
