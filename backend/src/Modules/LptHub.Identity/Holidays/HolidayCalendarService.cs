using System.Globalization;
using System.Text.RegularExpressions;
using LptHub.Identity.Contracts;
using LptHub.Identity.Domain;
using LptHub.SharedKernel.Availability;
using LptHub.SharedKernel.Results;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Identity.Holidays;

/// <summary>
/// Administration of holiday calendars and holidays (Dashboard Calendar, epic #1074; needs <c>Settings.Manage</c> except the person's calendar, <c>User.Manage</c>): calendars, rules,
/// the expanded preview of a year, the paste import with a dry run, the firm and pod defaults and the calendar of a person. Changes are audited by the audited entities.
/// </summary>
public sealed partial class HolidayCalendarService(DbContext db, IFirmHolidayCalendar settings)
{
    private const int SqlDuplicateKey = 2601;
    private const int SqlUniqueConstraint = 2627;

    // ----- calendars -----

    public async Task<IReadOnlyList<HolidayCalendarDto>> ListAsync(CancellationToken ct)
    {
        var calendars = await db.Set<HolidayCalendar>().AsNoTracking().OrderBy(c => c.SortOrder).ThenBy(c => c.Name).ToListAsync(ct);
        var counts = await db.Set<Holiday>().AsNoTracking().GroupBy(h => h.CalendarId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count, ct);
        var people = await db.Set<AppUser>().AsNoTracking().Where(u => u.HolidayCalendarId != null).GroupBy(u => u.HolidayCalendarId!.Value).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count, ct);
        return [.. calendars.Select(c => ToDto(c, counts.GetValueOrDefault(c.Id), people.GetValueOrDefault(c.Id)))];
    }

    public async Task<Result<HolidayCalendarDto>> GetAsync(int calendarId, CancellationToken ct)
    {
        var c = await db.Set<HolidayCalendar>().AsNoTracking().FirstOrDefaultAsync(x => x.Id == calendarId, ct);
        return c is null ? NotFound() : await ToDtoAsync(c, ct);
    }

    public async Task<Result<HolidayCalendarDto>> CreateAsync(CreateHolidayCalendarRequest request, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);
        var valid = ValidateCalendar(request.Name, request.ColourKey, request.RegionNote);
        if (valid.IsFailure)
            return valid.Error!;
        var (name, colour, note) = valid.Value;
        var calendar = new HolidayCalendar
        {
            Name = name,
            ColourKey = colour,
            RegionNote = note,
            AppliesToEveryone = request.AppliesToEveryone,
            IsActive = request.IsActive,
            SortOrder = (await db.Set<HolidayCalendar>().MaxAsync(c => (int?)c.SortOrder, ct) ?? 0) + 1,
        };
        db.Set<HolidayCalendar>().Add(calendar);
        var failure = await TrySaveAsync(ct);
        return failure is not null ? failure : await ToDtoAsync(calendar, ct);
    }

    public async Task<Result<HolidayCalendarDto>> UpdateAsync(int calendarId, UpdateHolidayCalendarRequest request, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);
        var valid = ValidateCalendar(request.Name, request.ColourKey, request.RegionNote);
        if (valid.IsFailure)
            return valid.Error!;
        var calendar = await db.Set<HolidayCalendar>().FirstOrDefaultAsync(c => c.Id == calendarId, ct);
        if (calendar is null)
            return NotFound();
        if (!VersionMatches(calendar.RowVersion, request.RowVersion))
            return ConcurrencyError();

        var (name, colour, note) = valid.Value;
        calendar.Name = name;
        calendar.ColourKey = colour;
        calendar.RegionNote = note;
        calendar.AppliesToEveryone = request.AppliesToEveryone;
        calendar.IsActive = request.IsActive;
        db.Entry(calendar).Property(x => x.RowVersion).OriginalValue = calendar.RowVersion;
        var failure = await TrySaveAsync(ct);
        return failure is not null ? failure : await ToDtoAsync(calendar, ct);
    }

    /// <summary>Deletes a calendar with its holidays; 409 <c>CALENDAR_IN_USE</c> while a person, a pod or the firm setting uses it (deactivate it instead).</summary>
    public async Task<Result> DeleteAsync(int calendarId, string? rowVersion, CancellationToken ct)
    {
        var calendar = await db.Set<HolidayCalendar>().FirstOrDefaultAsync(c => c.Id == calendarId, ct);
        if (calendar is null)
            return NotFound();
        if (!VersionMatches(calendar.RowVersion, rowVersion))
            return ConcurrencyError();

        var users = await db.Set<AppUser>().CountAsync(u => u.HolidayCalendarId == calendarId, ct);
        var pods = await db.Set<Pod>().CountAsync(p => p.DefaultHolidayCalendarId == calendarId, ct);
        var firm = (await settings.GetFirmCalendarAsync(fresh: true, cancellationToken: ct)).CalendarId == calendarId;
        if (users + pods > 0 || firm)
        {
            return Error.Conflict(
                "CALENDAR_IN_USE",
                $"The calendar is in use ({users} people, {pods} pods{(firm ? ", the firm default" : string.Empty)}). Deactivate it or choose another calendar first.");
        }

        db.Set<Holiday>().RemoveRange(await db.Set<Holiday>().Where(h => h.CalendarId == calendarId).ToListAsync(ct));
        db.Entry(calendar).Property(x => x.RowVersion).OriginalValue = calendar.RowVersion;
        db.Set<HolidayCalendar>().Remove(calendar);
        var failure = await TrySaveAsync(ct);
        return failure is not null ? failure : Result.Success();
    }

    // ----- holidays -----

    public async Task<Result<IReadOnlyList<HolidayDto>>> ListHolidaysAsync(int calendarId, CancellationToken ct)
    {
        if (!await db.Set<HolidayCalendar>().AnyAsync(c => c.Id == calendarId, ct))
            return NotFound();
        var rows = await db.Set<Holiday>().AsNoTracking().Where(h => h.CalendarId == calendarId).OrderBy(h => h.Name).ThenBy(h => h.Id).ToListAsync(ct);
        return Result<IReadOnlyList<HolidayDto>>.Success([.. rows.Select(ToDto)]);
    }

    public async Task<Result<HolidayDto>> CreateHolidayAsync(int calendarId, CreateHolidayRequest request, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (!await db.Set<HolidayCalendar>().AnyAsync(c => c.Id == calendarId, ct))
            return NotFound();
        var holiday = new Holiday { CalendarId = calendarId };
        var applied = Apply(holiday, new HolidayInput(request.Name, request.RuleKind, request.Month, request.Day, request.Nth, request.Weekday, request.PlusDays, request.EasterOffset, request.OnceDate, request.RangeEndMonth, request.RangeEndDay, request.RangeEndDate, request.Yearly, request.WeekendRule, request.RegionNote));
        if (applied is not null)
            return applied;
        db.Set<Holiday>().Add(holiday);
        var failure = await TrySaveAsync(ct);
        return failure is not null ? failure : ToDto(holiday);
    }

    public async Task<Result<HolidayDto>> UpdateHolidayAsync(int calendarId, int holidayId, UpdateHolidayRequest request, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);
        var holiday = await db.Set<Holiday>().FirstOrDefaultAsync(h => h.Id == holidayId && h.CalendarId == calendarId, ct);
        if (holiday is null)
            return Error.NotFound("The holiday does not exist.");
        if (!VersionMatches(holiday.RowVersion, request.RowVersion))
            return ConcurrencyError();
        var applied = Apply(holiday, new HolidayInput(request.Name, request.RuleKind, request.Month, request.Day, request.Nth, request.Weekday, request.PlusDays, request.EasterOffset, request.OnceDate, request.RangeEndMonth, request.RangeEndDay, request.RangeEndDate, request.Yearly, request.WeekendRule, request.RegionNote));
        if (applied is not null)
            return applied;
        db.Entry(holiday).Property(x => x.RowVersion).OriginalValue = holiday.RowVersion;
        var failure = await TrySaveAsync(ct);
        return failure is not null ? failure : ToDto(holiday);
    }

    public async Task<Result> DeleteHolidayAsync(int calendarId, int holidayId, string? rowVersion, CancellationToken ct)
    {
        var holiday = await db.Set<Holiday>().FirstOrDefaultAsync(h => h.Id == holidayId && h.CalendarId == calendarId, ct);
        if (holiday is null)
            return Error.NotFound("The holiday does not exist.");
        if (!VersionMatches(holiday.RowVersion, rowVersion))
            return ConcurrencyError();
        db.Entry(holiday).Property(x => x.RowVersion).OriginalValue = holiday.RowVersion;
        db.Set<Holiday>().Remove(holiday);
        var failure = await TrySaveAsync(ct);
        return failure is not null ? failure : Result.Success();
    }

    public async Task<Result<IReadOnlyList<HolidayPreviewDto>>> PreviewAsync(int calendarId, int year, CancellationToken ct)
    {
        if (year is < 2000 or > 2100)
            return Error.Validation("year", "INVALID", "The year must be between 2000 and 2100.");
        if (!await db.Set<HolidayCalendar>().AnyAsync(c => c.Id == calendarId, ct))
            return NotFound();
        var rules = (await db.Set<Holiday>().AsNoTracking().Where(h => h.CalendarId == calendarId).ToListAsync(ct)).Select(HolidayLoader.ToRule).ToList();
        return Result<IReadOnlyList<HolidayPreviewDto>>.Success([.. HolidayRulesEngine.Preview(rules, year).Select(l => new HolidayPreviewDto(l.Date, l.EndDate, l.Name, l.ObservedFrom))]);
    }

    // ----- import -----

    [GeneratedRegex(@"^\s*(?<a>\d{4}-\d{1,2}-\d{1,2}|\d{1,2}/\d{1,2}(?:/\d{4})?)\s*(?:(?:-|–|to)\s*(?<b>\d{4}-\d{1,2}-\d{1,2}|\d{1,2}/\d{1,2}(?:/\d{4})?)\s*)?[,\t;]\s*(?<name>.+?)\s*$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex ImportLine();

    /// <summary>
    /// Reads a pasted list, one holiday per line: <c>MM/DD/YYYY, Name</c>, <c>YYYY-MM-DD, Name</c> or a range <c>MM/DD/YYYY - MM/DD/YYYY, Name</c>. Every line is reported; a bad line blocks only itself.
    /// With <paramref name="dryRun"/> false the ok lines are saved (as ONCE or one-time RANGE holidays) in one transaction, when no line has an error or <paramref name="acceptOk"/> is true.
    /// </summary>
    public async Task<Result<HolidayImportResult>> ImportAsync(int calendarId, HolidayImportRequest request, bool dryRun, bool acceptOk, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (!await db.Set<HolidayCalendar>().AnyAsync(c => c.Id == calendarId, ct))
            return NotFound();

        var existing = (await db.Set<Holiday>().AsNoTracking().Where(h => h.CalendarId == calendarId).ToListAsync(ct)).Select(HolidayLoader.ToRule).ToList();
        var seen = new Dictionary<(DateOnly, DateOnly, string), int>();
        var lines = new List<HolidayImportLine>();
        var toSave = new List<Holiday>();
        var number = 0;
        foreach (var raw in request.Text.Split('\n'))
        {
            number++;
            var text = raw.TrimEnd('\r');
            if (string.IsNullOrWhiteSpace(text))
                continue;
            var m = ImportLine().Match(text);
            if (!m.Success)
            {
                lines.Add(new HolidayImportLine(number, false, "Use MM/DD/YYYY, Name or MM/DD/YYYY - MM/DD/YYYY, Name.", null));
                continue;
            }

            if (!TryDate(m.Groups["a"].Value, request.Year, out var first) || (m.Groups["b"].Success && !TryDate(m.Groups["b"].Value, request.Year, out _)))
            {
                lines.Add(new HolidayImportLine(number, false, "Not a real date.", null));
                continue;
            }

            var last = first;
            if (m.Groups["b"].Success)
                TryDate(m.Groups["b"].Value, request.Year, out last);
            var name = m.Groups["name"].Value.Trim();
            if (last < first)
            {
                lines.Add(new HolidayImportLine(number, false, "The last day is before the first day.", null));
                continue;
            }

            if (name.Length > 100)
            {
                lines.Add(new HolidayImportLine(number, false, "The name can be at most 100 characters.", null));
                continue;
            }

            var key = (first, last, name.ToUpperInvariant());
            if (seen.TryGetValue(key, out var firstLine))
            {
                lines.Add(new HolidayImportLine(number, false, $"Same as line {firstLine}.", null));
                continue;
            }

            var already = HolidayRulesEngine.ExpandRange(existing, first, last).Any(h => string.Equals(h.Name, name, StringComparison.OrdinalIgnoreCase) && h.Date == first);
            if (already)
            {
                lines.Add(new HolidayImportLine(number, false, "This holiday is already in the calendar.", null));
                continue;
            }

            seen[key] = number;
            lines.Add(new HolidayImportLine(number, true, null, new HolidayPreviewDto(first, last > first ? last : null, name, null)));
            toSave.Add(new Holiday
            {
                CalendarId = calendarId,
                Name = name,
                RuleKind = last > first ? HolidayRuleKinds.Range : HolidayRuleKinds.Once,
                OnceDate = first,
                RangeEndDate = last > first ? last : null,
                Yearly = false,
                WeekendRule = WeekendRules.None,
            });
        }

        var okCount = lines.Count(l => l.Ok);
        var errorCount = lines.Count - okCount;
        var saved = false;
        if (!dryRun && okCount > 0 && (errorCount == 0 || acceptOk))
        {
            db.Set<Holiday>().AddRange(toSave);
            var failure = await TrySaveAsync(ct);
            if (failure is not null)
                return failure;
            saved = true;
        }

        return new HolidayImportResult(lines, okCount, errorCount, saved);
    }

    private static bool TryDate(string text, int defaultYear, out DateOnly date)
    {
        date = default;
        if (text.Contains('-', StringComparison.Ordinal))
            return DateOnly.TryParseExact(text, ["yyyy-M-d", "yyyy-MM-dd"], CultureInfo.InvariantCulture, DateTimeStyles.None, out date);
        var parts = text.Split('/');
        var month = int.Parse(parts[0], CultureInfo.InvariantCulture);
        var day = int.Parse(parts[1], CultureInfo.InvariantCulture);
        var year = parts.Length == 3 ? int.Parse(parts[2], CultureInfo.InvariantCulture) : defaultYear;
        if (year is < 2000 or > 2100 || month is < 1 or > 12 || day < 1 || day > DateTime.DaysInMonth(year, month))
            return false;
        date = new DateOnly(year, month, day);
        return true;
    }

    // ----- firm and pod defaults, person's calendar -----

    public async Task<HolidaySettingsDto> GetSettingsAsync(CancellationToken ct)
    {
        var firm = await settings.GetFirmCalendarAsync(fresh: true, cancellationToken: ct);
        var pods = await db.Set<Pod>().AsNoTracking().Where(p => p.IsActive).OrderBy(p => p.Name).Select(p => new PodHolidayDefaultDto(p.Id, p.Name, p.DefaultHolidayCalendarId)).ToListAsync(ct);
        return new HolidaySettingsDto(firm.CalendarId, pods, firm.RowVersion);
    }

    public async Task<Result<HolidaySettingsDto>> SaveSettingsAsync(SaveHolidaySettingsRequest request, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);
        var calendarIds = await db.Set<HolidayCalendar>().AsNoTracking().Select(c => c.Id).ToListAsync(ct);
        if (request.FirmCalendarId is { } firmId && !calendarIds.Contains(firmId))
            return Error.Validation("firmCalendarId", "UNKNOWN_CALENDAR", "The calendar does not exist.");
        var podIds = request.PodDefaults.Select(p => p.PodId).ToList();
        var pods = await db.Set<Pod>().Where(p => podIds.Contains(p.Id)).ToListAsync(ct);
        foreach (var entry in request.PodDefaults)
        {
            if (pods.All(p => p.Id != entry.PodId))
                return Error.Validation("podDefaults", "UNKNOWN_POD", $"Unknown pod {entry.PodId}.");
            if (entry.CalendarId is { } cid && !calendarIds.Contains(cid))
                return Error.Validation("podDefaults", "UNKNOWN_CALENDAR", "The calendar does not exist.");
        }

        var firm = await settings.SetFirmCalendarAsync(request.FirmCalendarId, request.RowVersion, ct);
        if (firm.IsFailure)
            return firm.Error!;
        foreach (var entry in request.PodDefaults)
            pods.First(p => p.Id == entry.PodId).DefaultHolidayCalendarId = entry.CalendarId;
        var failure = await TrySaveAsync(ct);
        return failure is not null ? failure : await GetSettingsAsync(ct);
    }

    public async Task<Result<UserHolidayCalendarDto>> AssignToUserAsync(int userId, int? calendarId, CancellationToken ct)
    {
        var user = await db.Set<AppUser>().FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null)
            return Error.NotFound("The user does not exist.");
        if (calendarId is { } id && !await db.Set<HolidayCalendar>().AnyAsync(c => c.Id == id, ct))
            return Error.Validation("calendarId", "UNKNOWN_CALENDAR", "The calendar does not exist.");
        if (user.HolidayCalendarId != calendarId)
        {
            user.HolidayCalendarId = calendarId;
            db.Entry(user).Property(x => x.RowVersion).OriginalValue = user.RowVersion;
            var failure = await TrySaveAsync(ct);
            if (failure is not null)
                return failure;
        }

        return new UserHolidayCalendarDto(userId, calendarId);
    }

    // ----- helpers -----

    private static Result<(string Name, string Colour, string? Note)> ValidateCalendar(string? requestName, string? colourKey, string? regionNote)
    {
        var name = (requestName ?? string.Empty).Trim();
        if (name.Length is 0 or > 100)
            return Error.Validation("name", "INVALID", "The name is required and at most 100 characters.");
        var colour = string.IsNullOrWhiteSpace(colourKey) ? "slate" : colourKey.Trim();
        if (!HolidayColours.IsValid(colour))
            return Error.Validation("colourKey", "UNKNOWN_COLOUR", "Choose a colour of the palette.");
        var note = string.IsNullOrWhiteSpace(regionNote) ? null : regionNote.Trim();
        if (note is { Length: > 200 })
            return Error.Validation("regionNote", "TOO_LONG", "The region note can be at most 200 characters.");
        return (name, colour, note);
    }

    private sealed record HolidayInput(string? Name, string? RuleKind, int? Month, int? Day, int? Nth, int? Weekday, int PlusDays, int? EasterOffset, DateOnly? OnceDate, int? RangeEndMonth, int? RangeEndDay, DateOnly? RangeEndDate, bool Yearly, string? WeekendRule, string? RegionNote);

    private static Error? Apply(Holiday holiday, HolidayInput request)
    {
        var name = (request.Name ?? string.Empty).Trim();
        if (name.Length is 0 or > 100)
            return Error.Validation("name", "INVALID", "The name is required and at most 100 characters.");
        var kind = request.RuleKind?.Trim().ToUpperInvariant() ?? string.Empty;
        var yearly = kind is HolidayRuleKinds.Once ? false : kind is not HolidayRuleKinds.Range || request.Yearly;
        var rule = new HolidayRule(
            holiday.Id, name, kind, request.Month, request.Day, request.Nth, request.Weekday, request.PlusDays, request.EasterOffset,
            request.OnceDate, request.RangeEndMonth, request.RangeEndDay, request.RangeEndDate, yearly, request.WeekendRule?.Trim().ToUpperInvariant() ?? WeekendRules.None);
        var problems = HolidayRulesEngine.Validate(rule);
        var note = string.IsNullOrWhiteSpace(request.RegionNote) ? null : request.RegionNote.Trim();
        if (note is { Length: > 200 })
            problems = [.. problems, "The region note can be at most 200 characters."];
        if (problems.Count > 0)
            return Error.Validation("rule", "RULE_INVALID", string.Join(' ', problems), "HOLIDAY_RULE_INVALID");

        holiday.Name = name;
        holiday.RuleKind = kind;
        holiday.Month = kind is HolidayRuleKinds.Fixed or HolidayRuleKinds.NthWeekday || (kind == HolidayRuleKinds.Range && yearly) ? request.Month : null;
        holiday.Day = kind is HolidayRuleKinds.Fixed || (kind == HolidayRuleKinds.Range && yearly) ? request.Day : null;
        holiday.Nth = kind == HolidayRuleKinds.NthWeekday ? request.Nth : null;
        holiday.Weekday = kind == HolidayRuleKinds.NthWeekday ? request.Weekday : null;
        holiday.PlusDays = kind == HolidayRuleKinds.NthWeekday ? request.PlusDays : 0;
        holiday.EasterOffset = kind == HolidayRuleKinds.EasterOffset ? request.EasterOffset : null;
        holiday.OnceDate = kind == HolidayRuleKinds.Once || (kind == HolidayRuleKinds.Range && !yearly) ? request.OnceDate : null;
        holiday.RangeEndMonth = kind == HolidayRuleKinds.Range && yearly ? request.RangeEndMonth : null;
        holiday.RangeEndDay = kind == HolidayRuleKinds.Range && yearly ? request.RangeEndDay : null;
        holiday.RangeEndDate = kind == HolidayRuleKinds.Range && !yearly ? request.RangeEndDate : null;
        holiday.Yearly = yearly;
        holiday.WeekendRule = rule.WeekendRule;
        holiday.RegionNote = note;
        return null;
    }

    private async Task<HolidayCalendarDto> ToDtoAsync(HolidayCalendar c, CancellationToken ct) =>
        ToDto(c, await db.Set<Holiday>().CountAsync(h => h.CalendarId == c.Id, ct), await db.Set<AppUser>().CountAsync(u => u.HolidayCalendarId == c.Id, ct));

    private static HolidayCalendarDto ToDto(HolidayCalendar c, int holidays, int people) =>
        new(c.Id, c.Name, c.ColourKey, c.RegionNote, c.AppliesToEveryone, c.IsActive, holidays, people, Convert.ToBase64String(c.RowVersion));

    private static HolidayDto ToDto(Holiday h) =>
        new(h.Id, h.CalendarId, h.Name, h.RuleKind, h.Month, h.Day, h.Nth, h.Weekday, h.PlusDays, h.EasterOffset, h.OnceDate, h.RangeEndMonth, h.RangeEndDay, h.RangeEndDate, h.Yearly, h.WeekendRule, h.RegionNote, Convert.ToBase64String(h.RowVersion));

    private static bool VersionMatches(byte[] current, string? sent) => string.Equals(sent, Convert.ToBase64String(current), StringComparison.Ordinal);

    private static Error NotFound() => Error.NotFound("The calendar does not exist.");

    private static Error ConcurrencyError() => Error.Conflict(ErrorCodes.ConcurrencyConflict, "It was changed by someone else. Reload and try again.");

    private async Task<Error?> TrySaveAsync(CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
            return null;
        }
        catch (DbUpdateConcurrencyException)
        {
            return ConcurrencyError();
        }
        catch (DbUpdateException ex) when (ex.GetBaseException() is SqlException { Number: SqlDuplicateKey or SqlUniqueConstraint })
        {
            return Error.Conflict(ErrorCodes.DuplicateName, "A calendar with this name already exists.");
        }
    }
}
