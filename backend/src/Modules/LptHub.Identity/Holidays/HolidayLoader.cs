using LptHub.Identity.Contracts;
using LptHub.Identity.Domain;
using LptHub.SharedKernel.Availability;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Identity.Holidays;

/// <summary>Where a person's holiday calendar comes from.</summary>
public static class HolidayCalendarSources
{
    public const string Person = "PERSON";
    public const string Pod = "POD";
    public const string Firm = "FIRM";
}

/// <summary>The holiday calendar in force for one person and where it was chosen.</summary>
public sealed record EffectiveCalendar(int CalendarId, string Name, string Source);

/// <summary>
/// Loads the holiday dates of many people in a fixed number of statements (users, pod memberships, calendars, rules, plus the firm setting) and expands the rules for the
/// requested dates. A person's calendar is: their own (set by an administrator), else the default of their primary pod (the pod with the lowest id when no pod is primary),
/// else the firm calendar; plus every active "applies to everyone" calendar. Inactive calendars are ignored.
/// </summary>
public sealed class HolidayLoader(DbContext db, IFirmHolidayCalendar settings)
{
    private sealed record CalendarInfo(int Id, string Name, string ColourKey, bool AppliesToEveryone);

    private sealed record Loaded(
        Dictionary<int, CalendarInfo> Calendars,
        Dictionary<int, EffectiveCalendar?> Effective,
        IReadOnlyList<int> EveryoneIds,
        Dictionary<int, List<HolidayRule>> Rules);

    /// <summary>The holiday days of each person for <paramref name="from"/> to <paramref name="to"/> (both included).</summary>
    public async Task<IReadOnlyDictionary<int, List<HolidayDay>>> LoadAsync(IReadOnlyCollection<int> userIds, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var result = new Dictionary<int, List<HolidayDay>>();
        if (userIds.Count == 0)
            return result;

        var loaded = await LoadCoreAsync(userIds, needRules: true, ct);
        var expanded = new Dictionary<int, IReadOnlyList<HolidayDay>>();
        IReadOnlyList<HolidayDay> Expanded(int calendarId)
        {
            if (expanded.TryGetValue(calendarId, out var cached))
                return cached;
            var info = loaded.Calendars[calendarId];
            var days = HolidayRulesEngine.ExpandRange(loaded.Rules.GetValueOrDefault(calendarId) ?? [], from, to)
                .Select(h => new HolidayDay(h.Date, h.Name, info.Id, info.Name, info.ColourKey, info.AppliesToEveryone, h.ObservedFrom))
                .ToList();
            expanded[calendarId] = days;
            return days;
        }

        foreach (var id in userIds.Distinct())
        {
            var list = new List<HolidayDay>();
            var own = loaded.Effective.GetValueOrDefault(id);
            if (own is not null && loaded.Calendars.ContainsKey(own.CalendarId))
                list.AddRange(Expanded(own.CalendarId));
            foreach (var everyone in loaded.EveryoneIds.Where(c => c != own?.CalendarId))
                list.AddRange(Expanded(everyone));
            result[id] = [.. list.OrderBy(h => h.Date).ThenBy(h => h.CalendarId)];
        }

        return result;
    }

    /// <summary>The calendar in force for each person (without the "applies to everyone" ones); people without any are absent.</summary>
    public async Task<IReadOnlyDictionary<int, EffectiveCalendar>> EffectiveCalendarsAsync(IReadOnlyCollection<int> userIds, CancellationToken ct)
    {
        if (userIds.Count == 0)
            return new Dictionary<int, EffectiveCalendar>();
        var loaded = await LoadCoreAsync(userIds, needRules: false, ct);
        return loaded.Effective.Where(e => e.Value is not null).ToDictionary(e => e.Key, e => e.Value!);
    }

    private async Task<Loaded> LoadCoreAsync(IReadOnlyCollection<int> userIds, bool needRules, CancellationToken ct)
    {
        var ids = userIds.Distinct().ToList();
        var calendars = (await db.Set<HolidayCalendar>().AsNoTracking().Where(c => c.IsActive)
                .Select(c => new CalendarInfo(c.Id, c.Name, c.ColourKey, c.AppliesToEveryone)).ToListAsync(ct))
            .ToDictionary(c => c.Id);
        var own = await db.Set<AppUser>().AsNoTracking().Where(u => ids.Contains(u.Id)).Select(u => new { u.Id, u.HolidayCalendarId }).ToListAsync(ct);
        var memberships = await db.Set<PodMember>().AsNoTracking().Where(m => ids.Contains(m.UserId) && m.Pod.IsActive)
            .Select(m => new { m.UserId, m.PodId, m.IsPrimary, m.Pod.DefaultHolidayCalendarId }).ToListAsync(ct);
        var firmId = (await settings.GetFirmCalendarAsync(cancellationToken: ct)).CalendarId;

        var podByUser = memberships.GroupBy(m => m.UserId).ToDictionary(
            g => g.Key,
            g => g.OrderByDescending(m => m.IsPrimary).ThenBy(m => m.PodId).First().DefaultHolidayCalendarId);
        var effective = new Dictionary<int, EffectiveCalendar?>();
        foreach (var u in own)
        {
            EffectiveCalendar? chosen = null;
            if (u.HolidayCalendarId is { } mine && calendars.TryGetValue(mine, out var c1))
                chosen = new EffectiveCalendar(c1.Id, c1.Name, HolidayCalendarSources.Person);
            else if (podByUser.GetValueOrDefault(u.Id) is { } podCal && calendars.TryGetValue(podCal, out var c2))
                chosen = new EffectiveCalendar(c2.Id, c2.Name, HolidayCalendarSources.Pod);
            else if (firmId is { } firm && calendars.TryGetValue(firm, out var c3))
                chosen = new EffectiveCalendar(c3.Id, c3.Name, HolidayCalendarSources.Firm);
            effective[u.Id] = chosen;
        }

        var everyoneIds = calendars.Values.Where(c => c.AppliesToEveryone).OrderBy(c => c.Id).Select(c => c.Id).ToList();
        var rules = new Dictionary<int, List<HolidayRule>>();
        if (needRules)
        {
            var needed = effective.Values.Where(e => e is not null).Select(e => e!.CalendarId).Concat(everyoneIds).Distinct().ToList();
            if (needed.Count > 0)
            {
                var rows = await db.Set<Holiday>().AsNoTracking().Where(h => needed.Contains(h.CalendarId)).ToListAsync(ct);
                foreach (var h in rows)
                {
                    if (!rules.TryGetValue(h.CalendarId, out var list))
                        rules[h.CalendarId] = list = [];
                    list.Add(ToRule(h));
                }
            }
        }

        return new Loaded(calendars, effective, everyoneIds, rules);
    }

    /// <summary>The domain rule of a stored holiday.</summary>
    public static HolidayRule ToRule(Holiday h) =>
        new(h.Id, h.Name, h.RuleKind, h.Month, h.Day, h.Nth, h.Weekday, h.PlusDays, h.EasterOffset, h.OnceDate, h.RangeEndMonth, h.RangeEndDay, h.RangeEndDate, h.Yearly, h.WeekendRule);
}
