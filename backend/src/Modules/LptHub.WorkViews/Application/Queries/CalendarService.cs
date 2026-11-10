using System.Globalization;
using MatterFlow.Configuration.Contracts;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using MatterFlow.SharedKernel.Availability;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Time;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// Read side of the Dashboard Calendar (epic #1074, decision AT): who can work on each day and where coverage is thin. A fixed number of statements whatever the number of people:
/// the pods and their members, the workers, their roles, their availability profiles (entries and holidays for the asked days), the thresholds and, for the day panel and the summary only,
/// one grouped open-task count. The only task-derived figure is the per-person load as a bare number (decision AS item 12, extended by AT item 21): no task, matter or title is read.
/// The absence type leaves the server only with <c>Dashboard.ViewAbsenceReasons</c>; the note never does.
/// </summary>
public sealed class CalendarService(
    DbContext db,
    IClock clock,
    IConfiguration configuration,
    IUserAvailabilityReader availability,
    ICalendarSettings settings,
    ICalendarAccess access,
    IPermissionChecker permissions,
    IPodDirectory pods,
    IOptions<DashboardOptions> options)
{
    public const int MaxDays = 62;
    public const int RiskWindowDays = 30;
    public const int ForecastWeeks = 4;
    private const int BackOnSearchDays = 90;

    private sealed record Scope(IReadOnlyList<int>? PodIds, int? SinglePodId);

    private sealed class Person
    {
        public int Id { get; init; }

        public string Name { get; init; } = string.Empty;

        public int RoleId { get; init; }

        public string RoleName { get; init; } = string.Empty;

        public List<(int PodId, string Name, bool IsPrimary)> Pods { get; } = [];

        public int AssignedPodId { get; set; }

        public UserAvailabilityProfile Profile { get; set; } = UserAvailabilityProfile.Default;
    }

    private sealed record Population(List<Person> People, Dictionary<int, string> PodNames);

    private sealed record DayEval(DateOnly Date, List<(Person Person, DayEvaluation Eval)> Evals, int Total, int Expected, int Available, int OutOfOffice, int OnHoliday, int OffHours, string Level, List<CalendarPod> Pods, Dictionary<int, (int Expected, int Available, int Minimum)> PodStats);

    // ----- endpoints -----

    public async Task<Result<CalendarDays>> GetDaysAsync(CalendarDaysQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        var range = ParseRange(query.From, query.To);
        if (range.IsFailure)
            return range.Error!;
        var (from, to) = range.Value;
        var scope = await ResolveScopeAsync(query.PodScope, ct);
        if (scope.IsFailure)
            return scope.Error!;

        var thresholds = await settings.GetThresholdsAsync(ct);
        var population = await LoadAsync(scope.Value, from, to, ct);
        var roles = population.People.GroupBy(p => p.RoleId).Select(g => new CalendarRole(g.Key, g.First().RoleName))
            .OrderBy(r => r.Name, StringComparer.InvariantCultureIgnoreCase).ThenBy(r => r.RoleId).ToList();
        var inView = Filter(population.People, query.Role);
        var overrides = thresholds.PodMinimums.ToDictionary(m => m.PodId, m => m.People);
        var days = new List<CalendarDayCell>();
        for (var d = from; d <= to; d = d.AddDays(1))
        {
            var eval = Compute(d, inView, population.PodNames, overrides, thresholds, scope.Value.SinglePodId);
            days.Add(ToCell(eval));
        }

        return new CalendarDays(Utc(clock.UtcNow), FirmToday(), 0, roles, days);
    }

    public async Task<Result<CalendarDay>> GetDayAsync(CalendarDayQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        if (query.Date is not { } date || date < MinDate || date > MaxDate)
            return Error.Validation("date", "INVALID_DATE", "date is required (yyyy-MM-dd).");
        var scope = await ResolveScopeAsync(query.PodScope, ct);
        if (scope.IsFailure)
            return scope.Error!;

        var thresholds = await settings.GetThresholdsAsync(ct);
        var population = await LoadAsync(scope.Value, date, date.AddDays(BackOnSearchDays), ct);
        var inView = Filter(population.People, query.Role);
        var overrides = thresholds.PodMinimums.ToDictionary(m => m.PodId, m => m.People);
        var eval = Compute(date, inView, population.PodNames, overrides, thresholds, scope.Value.SinglePodId);

        var loads = await LoadsAsync(inView.Select(p => p.Id).ToList(), ct);
        var term = string.IsNullOrWhiteSpace(query.Q) ? null : query.Q.Trim();
        bool Matches(Person p) => term is null
            || p.Name.Contains(term, StringComparison.CurrentCultureIgnoreCase)
            || p.Pods.Any(x => x.Name.Contains(term, StringComparison.CurrentCultureIgnoreCase));

        var showReasons = permissions.Has(Permissions.Dashboard.ViewAbsenceReasons);
        var comparer = StringComparer.InvariantCultureIgnoreCase;
        var available = eval.Evals.Where(e => e.Eval.State == DayStates.Available && Matches(e.Person))
            .GroupBy(e => e.Person.RoleId)
            .OrderBy(g => g.First().Person.RoleName, comparer).ThenBy(g => g.Key)
            .Select(g => new CalendarAvailableGroup(
                g.Key,
                g.First().Person.RoleName,
                [.. g.Select(e => e.Person).OrderBy(p => loads.GetValueOrDefault(p.Id)).ThenBy(p => p.Name, comparer).ThenBy(p => p.Id).Select(p => new CalendarPerson(p.Id, p.Name, PodNames(p), loads.GetValueOrDefault(p.Id)))]))
            .ToList();
        var unavailable = eval.Evals.Where(e => e.Eval.State != DayStates.Available && Matches(e.Person))
            .GroupBy(e => e.Person.RoleId)
            .OrderBy(g => g.First().Person.RoleName, comparer).ThenBy(g => g.Key)
            .Select(g => new CalendarUnavailableGroup(
                g.Key,
                g.First().Person.RoleName,
                [.. g.OrderByDescending(e => loads.GetValueOrDefault(e.Person.Id)).ThenBy(e => e.Person.Name, comparer).ThenBy(e => e.Person.Id)
                    .Select(e => ToUnavailable(e.Person, e.Eval, loads.GetValueOrDefault(e.Person.Id), date, showReasons))]))
            .ToList();
        var holidays = DayHolidays(eval).Select(h => new CalendarDayHoliday(h.Name, h.Category, h.ColourKey)).ToList();
        return new CalendarDay(
            date,
            eval.Level,
            holidays,
            new CalendarCounts(eval.Total, eval.Expected, eval.Available, eval.OutOfOffice, eval.OnHoliday, eval.OffHours),
            eval.Pods,
            available,
            unavailable);
    }

    public async Task<Result<CalendarSummary>> GetSummaryAsync(CalendarSummaryQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        var scope = await ResolveScopeAsync(query.PodScope, ct);
        if (scope.IsFailure)
            return scope.Error!;

        var thresholds = await settings.GetThresholdsAsync(ct);
        var today = FirmToday();
        var weekStart = today.AddDays(-(int)today.DayOfWeek);
        var last = weekStart.AddDays((7 * ForecastWeeks) - 1);
        var riskEnd = today.AddDays(RiskWindowDays);
        var population = await LoadAsync(scope.Value, today, last > riskEnd ? last : riskEnd, ct);
        var inView = Filter(population.People, query.Role);
        var overrides = thresholds.PodMinimums.ToDictionary(m => m.PodId, m => m.People);

        var evals = new Dictionary<DateOnly, DayEval>();
        for (var d = today; d <= (last > riskEnd ? last : riskEnd); d = d.AddDays(1))
            evals[d] = Compute(d, inView, population.PodNames, overrides, thresholds, scope.Value.SinglePodId);

        var riskDays = new List<DayEval>();
        var podBreaches = new Dictionary<int, int>();
        for (var k = 0; k <= RiskWindowDays; k++)
        {
            var e = evals[today.AddDays(k)];
            if (e.Expected <= 0 || !CoverageLevels.IsRisk(e.Level))
                continue;
            riskDays.Add(e);
            foreach (var (podId, stat) in e.PodStats)
            {
                if (stat.Expected > 0 && stat.Available < stat.Minimum)
                    podBreaches[podId] = podBreaches.GetValueOrDefault(podId) + 1;
            }
        }

        CalendarWorstPod? worst = null;
        if (podBreaches.Count > 0)
        {
            var top = podBreaches.OrderByDescending(p => p.Value).ThenBy(p => population.PodNames[p.Key], StringComparer.InvariantCultureIgnoreCase).First();
            worst = new CalendarWorstPod(top.Key, population.PodNames[top.Key]);
        }

        var risk = new CalendarRisk(riskDays.Count, riskDays.Count > 0 ? riskDays[0].Date : null, riskDays.Count > 0 ? riskDays[0].Level : null, worst, RiskWindowDays);

        var loads = await LoadsAsync(inView.Select(p => p.Id).ToList(), ct);
        var open = loads.Values.Sum();
        var slots = Math.Clamp(options.Value.Capacity.SlotsPerPerson, 1, 20);
        var forecast = new List<CalendarForecastWeek>();
        for (var w = 0; w < ForecastWeeks; w++)
        {
            var start = weekStart.AddDays(7 * w);
            var perDay = new List<int>();
            for (var k = 0; k < 7; k++)
            {
                var d = start.AddDays(k);
                if (d < today)
                    continue;
                var e = evals[d];
                if (e.Expected > 0)
                    perDay.Add(e.Available);
            }

            var (average, free) = CalendarCoverage.Forecast(perDay, open, slots);
            forecast.Add(new CalendarForecastWeek(start, average, free));
        }

        return new CalendarSummary(new CalendarThresholdsInfo(thresholds.MinCoveragePercent, thresholds.PodMinimumPercent), risk, forecast);
    }

    /// <summary>
    /// Advisory check for an entry (never blocks): which pods of the person would fall below their minimum on which days if the person were out. The pods and people are the firm's,
    /// not the caller's scope. Needs the same right as adding the entry.
    /// </summary>
    public async Task<Result<AbsenceCheckResult>> CheckAsync(int userId, AbsenceCheckRequest request, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (!await db.Set<AppUser>().AnyAsync(u => u.Id == userId, ct))
            return Error.NotFound("The user does not exist.");
        if (!await access.CanEditAbsencesOfAsync(userId, ct))
            return Error.Forbidden("You cannot manage this person's Out of office entries.");
        var start = request.StartDate;
        var end = request.EndDate ?? start.AddDays(RiskWindowDays);
        if (start < MinDate || end > MaxDate || end < start)
            return Error.Validation("startDate", "ABSENCE_RANGE_INVALID", "Choose a valid range.", "ABSENCE_RANGE_INVALID");
        if (end > start.AddDays(366))
            end = start.AddDays(366);

        var thresholds = await settings.GetThresholdsAsync(ct);
        var population = await LoadAsync(new Scope(null, null), start, end, ct);
        var person = population.People.FirstOrDefault(p => p.Id == userId);
        if (person is null)
            return new AbsenceCheckResult([]);

        var overrides = thresholds.PodMinimums.ToDictionary(m => m.PodId, m => m.People);
        var byPod = new Dictionary<int, List<DateOnly>>();
        for (var d = start; d <= end; d = d.AddDays(1))
        {
            var eval = Compute(d, population.People, population.PodNames, overrides, thresholds, null);
            if (eval.Evals.First(e => e.Person.Id == userId).Eval.State != DayStates.Available)
                continue; // the person is not counted as available that day anyway
            var stat = eval.PodStats.GetValueOrDefault(person.AssignedPodId);
            if (stat.Expected > 0 && stat.Available - 1 < stat.Minimum)
            {
                if (!byPod.TryGetValue(person.AssignedPodId, out var list))
                    byPod[person.AssignedPodId] = list = [];
                list.Add(d);
            }
        }

        return new AbsenceCheckResult([.. byPod.Select(p => new AbsenceCheckPod(p.Key, population.PodNames[p.Key], p.Value)).OrderBy(p => p.Name, StringComparer.InvariantCultureIgnoreCase)]);
    }

    // ----- computation -----

    private static readonly DateOnly MinDate = new(2000, 1, 1);
    private static readonly DateOnly MaxDate = new(2100, 12, 31);

    private static DayEval Compute(DateOnly date, IReadOnlyList<Person> people, Dictionary<int, string> podNames, Dictionary<int, int> overrides, CalendarThresholdSettings thresholds, int? singlePod)
    {
        var evals = new List<(Person, DayEvaluation)>(people.Count);
        int oo = 0, holiday = 0, off = 0;
        var podExpected = new Dictionary<int, int>();
        var podAvailable = new Dictionary<int, int>();
        var podHoliday = new Dictionary<int, int>();
        var podTotal = new Dictionary<int, int>();
        foreach (var p in people)
        {
            var e = UserAvailabilityEvaluator.EvaluateDay(p.Profile, date);
            evals.Add((p, e));
            var pod = singlePod ?? p.AssignedPodId;
            podTotal[pod] = podTotal.GetValueOrDefault(pod) + 1;
            switch (e.State)
            {
                case DayStates.Holiday:
                    holiday++;
                    podHoliday[pod] = podHoliday.GetValueOrDefault(pod) + 1;
                    break;
                case DayStates.NonWorking or DayStates.Weekend:
                    off++;
                    break;
                case DayStates.OutOfOffice:
                    oo++;
                    podExpected[pod] = podExpected.GetValueOrDefault(pod) + 1;
                    break;
                default:
                    podExpected[pod] = podExpected.GetValueOrDefault(pod) + 1;
                    podAvailable[pod] = podAvailable.GetValueOrDefault(pod) + 1;
                    break;
            }
        }

        var total = people.Count;
        var expected = total - holiday - off;
        var available = expected - oo;
        var stats = new Dictionary<int, (int Expected, int Available, int Minimum)>();
        var podDtos = new List<CalendarPod>();
        foreach (var podId in podTotal.Keys.OrderBy(id => podNames.GetValueOrDefault(id) ?? string.Empty, StringComparer.InvariantCultureIgnoreCase).ThenBy(id => id))
        {
            var exp = podExpected.GetValueOrDefault(podId);
            var avl = podAvailable.GetValueOrDefault(podId);
            var min = CalendarCoverage.PodMinimum(exp, overrides.TryGetValue(podId, out var o) ? o : null, thresholds.PodMinimumPercent);
            stats[podId] = (exp, avl, min);
            var level = exp > 0
                ? CalendarCoverage.PodLevel(new PodDayStat(podId, exp, avl, min), thresholds.Thresholds)
                : podHoliday.GetValueOrDefault(podId) > 0 ? CoverageLevels.Closed : CoverageLevels.NonWorking;
            podDtos.Add(new CalendarPod(podId, podNames.GetValueOrDefault(podId) ?? string.Empty, exp, avl, min, level));
        }

        var podStats = stats.Select(s => new PodDayStat(s.Key, s.Value.Expected, s.Value.Available, s.Value.Minimum)).ToList();
        var dayLevel = CalendarCoverage.DayLevel(expected, available, holiday, podStats, thresholds.Thresholds);
        return new DayEval(date, evals, total, expected, available, oo, holiday, off, dayLevel, podDtos, stats);
    }

    private static CalendarDayCell ToCell(DayEval e) =>
        new(e.Date, e.Total, e.Expected, e.Available, e.OutOfOffice, e.OnHoliday, e.OffHours, CalendarCoverage.CoveragePercent(e.Expected, e.Available), e.Level, [.. DayHolidays(e)], e.Pods);

    private static IEnumerable<CalendarHoliday> DayHolidays(DayEval e) =>
        e.Evals.Where(x => x.Eval.State == DayStates.Holiday)
            .SelectMany(x => x.Eval.Holidays)
            .GroupBy(h => (h.CalendarId, h.Name))
            .OrderBy(g => g.Key.CalendarId).ThenBy(g => g.Key.Name, StringComparer.InvariantCultureIgnoreCase)
            .Select(g => new CalendarHoliday(g.Key.Name, g.Key.CalendarId, g.First().CalendarName, g.First().ColourKey, g.First().AppliesToEveryone));

    private CalendarUnavailablePerson ToUnavailable(Person p, DayEvaluation eval, int load, DateOnly date, bool showReasons)
    {
        switch (eval.State)
        {
            case DayStates.OutOfOffice:
                var period = eval.Period!.Value;
                DateOnly? backOn = null;
                if (UserAvailabilityEvaluator.ChainEnd(p.Profile.Periods, period) is { } end)
                {
                    for (var d = end.AddDays(1); d <= end.AddDays(BackOnSearchDays); d = d.AddDays(1))
                    {
                        if (UserAvailabilityEvaluator.EvaluateDay(p.Profile, d).State == DayStates.Available)
                        {
                            backOn = d;
                            break;
                        }
                    }
                }

                return new CalendarUnavailablePerson(p.Id, p.Name, PodNames(p), load, "OUT_OF_OFFICE", backOn, showReasons ? period.Type : null);
            case DayStates.Holiday:
                return new CalendarUnavailablePerson(p.Id, p.Name, PodNames(p), load, "HOLIDAY", null, null);
            default:
                return new CalendarUnavailablePerson(p.Id, p.Name, PodNames(p), load, "NOT_WORKING", null, null);
        }
    }

    private static List<string> PodNames(Person p) => [.. p.Pods.Select(x => x.Name).Order(StringComparer.InvariantCultureIgnoreCase)];

    private static List<Person> Filter(List<Person> people, int? roleId) => roleId is { } r ? [.. people.Where(p => p.RoleId == r)] : people;

    // ----- loading -----

    private async Task<Result<Scope>> ResolveScopeAsync(string? podScope, CancellationToken ct)
    {
        var raw = podScope?.Trim();
        var own = await access.OwnPodIdsAsync(ct);
        if (string.IsNullOrEmpty(raw) || string.Equals(raw, DashboardScope.All, StringComparison.OrdinalIgnoreCase))
            return access.SeesAllPods ? new Scope(null, null) : new Scope([.. own.Order()], null);
        if (string.Equals(raw, DashboardScope.Mine, StringComparison.OrdinalIgnoreCase))
            return new Scope([.. own.Order()], null);
        if (!int.TryParse(raw, NumberStyles.None, CultureInfo.InvariantCulture, out var podId) || podId <= 0)
            return Error.Validation("podScope", "INVALID_POD_SCOPE", "podScope must be 'all', 'mine' or a pod id.");
        if (await pods.FindAsync(podId, ct) is null)
            return Error.Validation("podScope", "UNKNOWN_POD", $"Unknown pod {podId}.");
        if (!access.SeesAllPods && !own.Contains(podId))
            return Error.Forbidden("That pod is not available to you.");
        return new Scope([podId], podId);
    }

    private Result<(DateOnly From, DateOnly To)> ParseRange(DateOnly? from, DateOnly? to)
    {
        if (from is null || to is null)
            return Error.Validation("from", "INVALID_RANGE", "from and to are required (yyyy-MM-dd).", "INVALID_RANGE");
        if (from < MinDate || to > MaxDate || to < from)
            return Error.Validation("to", "INVALID_RANGE", "to must not be before from.", "INVALID_RANGE");
        if (to.Value.DayNumber - from.Value.DayNumber > MaxDays)
            return Error.Validation("to", "RANGE_TOO_LONG", $"At most {MaxDays} days can be asked at once.", "RANGE_TOO_LONG");
        return (from.Value, to.Value);
    }

    private async Task<Population> LoadAsync(Scope scope, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var activePods = await db.Set<Pod>().AsNoTracking().Where(p => p.IsActive).Select(p => new { p.Id, p.Name }).ToListAsync(ct);
        var podNames = activePods.ToDictionary(p => p.Id, p => p.Name);
        var inScope = db.Set<PodMember>().AsNoTracking().Where(m => m.Pod.IsActive);
        if (scope.PodIds is { } podIds)
            inScope = inScope.Where(m => podIds.Contains(m.PodId));
        var memberIds = await inScope.Select(m => m.UserId).Distinct().ToListAsync(ct);
        if (memberIds.Count == 0)
            return new Population([], podNames);

        // Workers: active users holding Workflow.Execute through an active role (the System Admin role holds every permission).
        var workers = await db.Set<AppUser>().AsNoTracking()
            .Where(u => u.IsActive && memberIds.Contains(u.Id)
                && u.Roles.Any(ur => ur.Role.IsActive && (ur.Role.IsSystemAdmin || ur.Role.Permissions.Any(rp => rp.Permission.IsActive && rp.Permission.Code == Permissions.Workflow.Execute))))
            .Select(u => new { u.Id, u.DisplayName })
            .ToListAsync(ct);
        if (workers.Count == 0)
            return new Population([], podNames);
        var ids = workers.Select(w => w.Id).ToList();

        var roleRows = await db.Set<UserRole>().AsNoTracking()
            .Where(ur => ids.Contains(ur.UserId) && ur.Role.IsActive
                && (ur.Role.IsSystemAdmin || ur.Role.Permissions.Any(rp => rp.Permission.IsActive && rp.Permission.Code == Permissions.Workflow.Execute)))
            .Select(ur => new { ur.UserId, ur.RoleId, ur.Role.Name })
            .ToListAsync(ct);
        var primaryRole = roleRows.GroupBy(r => r.UserId).ToDictionary(
            g => g.Key,
            g => g.OrderBy(r => r.Name, StringComparer.InvariantCultureIgnoreCase).ThenBy(r => r.RoleId).First());

        var memberships = await db.Set<PodMember>().AsNoTracking()
            .Where(m => m.Pod.IsActive && ids.Contains(m.UserId))
            .Select(m => new { m.UserId, m.PodId, m.IsPrimary })
            .ToListAsync(ct);
        var profiles = await availability.LoadProfilesAsync(ids, from, to, ct);

        var people = new List<Person>(workers.Count);
        foreach (var w in workers)
        {
            if (!primaryRole.TryGetValue(w.Id, out var role))
                continue;
            var person = new Person { Id = w.Id, Name = w.DisplayName, RoleId = role.RoleId, RoleName = role.Name };
            foreach (var m in memberships.Where(m => m.UserId == w.Id))
                person.Pods.Add((m.PodId, podNames[m.PodId], m.IsPrimary));
            var inScopePods = person.Pods.Where(x => scope.PodIds is null || scope.PodIds.Contains(x.PodId)).ToList();
            person.AssignedPodId = scope.SinglePodId
                ?? inScopePods.OrderByDescending(x => x.IsPrimary).ThenBy(x => x.PodId).Select(x => x.PodId).FirstOrDefault();
            person.Profile = profiles[w.Id];
            people.Add(person);
        }

        people.Sort((a, b) => string.Compare(a.Name, b.Name, StringComparison.InvariantCultureIgnoreCase));
        return new Population(people, podNames);
    }

    private async Task<Dictionary<int, int>> LoadsAsync(List<int> userIds, CancellationToken ct)
    {
        if (userIds.Count == 0)
            return [];
        // A bare count per person over ALL their New and In progress Tasks (On hold does not count); nothing else of a Task is selected.
        return await db.Set<WorkTask>().AsNoTracking()
            .Where(t => (t.Status == TaskStatusCode.New || t.Status == TaskStatusCode.InProgress) && t.AssignedUserId != null && userIds.Contains(t.AssignedUserId.Value))
            .GroupBy(t => t.AssignedUserId!.Value)
            .Select(g => new { UserId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.UserId, g => g.Count, ct);
    }

    private DateOnly FirmToday()
    {
        var zone = UserTimeZone.Resolve(configuration["Firm:TimeZoneId"] ?? UserTimeZone.DefaultFirmZoneId).Zone;
        return DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(clock.UtcNow, DateTimeKind.Utc), zone));
    }

    private static DateTime Utc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);
}
