using System.ComponentModel.DataAnnotations;
using LptHub.Configuration.Contracts;
using LptHub.Identity.Contracts;
using LptHub.Identity.Domain;
using LptHub.SharedKernel.Availability;
using LptHub.SharedKernel.Identity;
using LptHub.SharedKernel.Results;
using LptHub.SharedKernel.Tasks;
using LptHub.SharedKernel.Time;
using LptHub.SharedKernel.Visibility;
using LptHub.WorkManagement.Domain;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace LptHub.WorkViews.Application.Queries;

/// <summary>Request of the capacity battery: the page-wide scope.</summary>
public class CapacityQuery
{
    public static readonly IReadOnlyList<string> Keys = ["podScope"];

    /// <summary><c>all</c> (default), <c>mine</c> (the caller's active Pods, resolved on the server) or a Pod id. A Pod that does not exist is 400 <c>UNKNOWN_POD</c>; one the caller may not see is 403.</summary>
    [FromQuery(Name = "podScope"), StringLength(20)]
    public string? PodScope { get; init; }
}

/// <summary>Request of the People list: the page-wide scope plus an optional name fragment and state.</summary>
public class CapacityPeopleQuery : CapacityQuery
{
    public static new readonly IReadOnlyList<string> Keys = ["podScope", "q", "state"];

    /// <summary>Fragment of the person's name.</summary>
    [FromQuery(Name = "q"), StringLength(200)]
    public string? Q { get; init; }

    /// <summary>Only people in this state: <c>AVAILABLE</c>, <c>OCCUPIED</c>, <c>BUSY</c>, <c>OVERLOADED</c>, <c>OUT_OF_OFFICE</c> or <c>OFF_HOURS</c>. Anything else is 400 <c>UNKNOWN_STATE</c>.</summary>
    [FromQuery(Name = "state"), StringLength(20)]
    public string? State { get; init; }
}

/// <summary>How many workers are in one capacity state.</summary>
public sealed record CapacityStateCount([property: Required] string State, [property: Required] int Count);

/// <summary>
/// The department capacity battery (Dashboard v4, decision AS items 5, 6 and 12, changed by decision AV): aggregates only, no per-person data. A worker holds <c>Workflow.Execute</c> and is an active member of a Pod in the scope.
/// Capacity counts by absence, not by the clock: a worker counts unless out of office or on a holiday; a person who is only outside their work hours still counts (3 slots, free = slots minus load) while the setting
/// <c>Dashboard.Capacity.countOffHours</c> is on (default). With it off, off-hours people are left out of <c>TotalSlots</c> (the old behaviour) and <c>State</c> is <c>AFTER_HOURS</c> when nobody is left.
/// A worker's load is counted over all their open Tasks as a bare number; no Task, Matter or title is read for the answer.
/// </summary>
/// <param name="AsOfUtc">The instant the figures were computed for.</param>
/// <param name="State"><c>OK</c> (at least one worker counts; percentages set), <c>HOLIDAY</c> (nobody counts and everybody who is off hours is off for a holiday, for example a firm closure; show "Holiday", not an alarm), <c>AFTER_HOURS</c> (only with <c>countOffHours</c> off: workers exist but all are outside their work hours or out of office, with at least one outside work hours), <c>ALL_OUT</c> (all workers are out of office or on a holiday and none is merely off hours) or <c>NO_WORKERS</c> (empty scope).</param>
/// <param name="Workers">Workers in the scope, in every state.</param>
/// <param name="PresentWorkers">Workers who count as capacity: not out of office, not on a holiday and, only when <c>countOffHours</c> is off, inside their work hours.</param>
/// <param name="SlotsPerPerson">Open Tasks (New or In progress) one person can hold (default 3).</param>
/// <param name="TotalSlots"><c>PresentWorkers</c> times <c>SlotsPerPerson</c>.</param>
/// <param name="FreeSlots">Free slots among the counted workers (slots minus load, never below zero).</param>
/// <param name="UsedPercent">100 minus <c>FreePercent</c>, rounded; null unless <c>State</c> is <c>OK</c>. Slots based: slack elsewhere can hide overload, see <c>OverCapacityTasks</c>.</param>
/// <param name="FreePercent">Free slots over total slots, rounded; null unless <c>State</c> is <c>OK</c>.</param>
/// <param name="CanTakeWork">Counted workers with at least one free slot.</param>
/// <param name="States">All six states in fixed order (Available, Occupied, Busy, Overloaded, Out of office, Off hours) with the number of workers in each; they add up to <c>Workers</c>. Off hours keeps its own count (people outside work hours, also when they are counted as capacity).</param>
/// <param name="AssignedLastHour">Tasks assigned to workers of the scope in the last hour (from <c>Task.AssignedAt</c>): the rate hint. No trend is kept.</param>
/// <param name="CountOffHours">The setting in force: people outside their work hours count as capacity.</param>
/// <param name="OverCapacityTasks">Sum over the counted workers of the open Tasks above their slot count (max(0, load minus slots)); zero when nobody counts.</param>
/// <param name="UnassignedWaiting">Open Tasks nobody is assigned to in the scope, the visibility-filtered number of the Summary's Unassigned card; null unless the caller also holds <c>Dashboard.ViewSummary</c> or <c>Dashboard.ViewUnassigned</c>.</param>
public sealed record DashboardCapacity(
    [property: Required] DateTime AsOfUtc,
    [property: Required] string State,
    [property: Required] int Workers,
    [property: Required] int PresentWorkers,
    [property: Required] int SlotsPerPerson,
    [property: Required] int TotalSlots,
    [property: Required] int FreeSlots,
    int? UsedPercent,
    int? FreePercent,
    [property: Required] int CanTakeWork,
    [property: Required] IReadOnlyList<CapacityStateCount> States,
    int? AssignedLastHour,
    [property: Required] bool CountOffHours,
    [property: Required] int OverCapacityTasks,
    int? UnassignedWaiting);

/// <summary>One row of the People list: name, state and the load number. No Task, Matter or note text.</summary>
/// <param name="OutUntil">While out of office: the last day out (date only, no note); null when open-ended or not out of office.</param>
/// <param name="PodNames">The active Pods the person belongs to.</param>
public sealed record CapacityPerson(
    [property: Required] int UserId,
    [property: Required] string DisplayName,
    [property: Required] string State,
    [property: Required] int Load,
    DateOnly? OutUntil,
    [property: Required] IReadOnlyList<string> PodNames);

/// <summary>Values of the capacity <c>State</c> field.</summary>
public static class CapacitySummaryStates
{
    public const string Ok = "OK";
    public const string Holiday = "HOLIDAY";
    public const string AfterHours = "AFTER_HOURS";
    public const string AllOut = "ALL_OUT";
    public const string NoWorkers = "NO_WORKERS";
}

/// <summary>One worker as the battery rules see them: the capacity state, the open-task load and whether the person is off for a holiday.</summary>
public sealed record CapacityWorkerFact(string State, int Load, bool OnHoliday);

/// <summary>The figures of the battery for one scope.</summary>
public sealed record CapacityTotals(string SummaryState, int Counted, int TotalSlots, int FreeSlots, int OverCapacityTasks, int CanTakeWork, int? FreePercent);

/// <summary>Pure rules of the battery (decision AV): who counts, the totals and the summary state. Tested without a database.</summary>
public static class CapacitySummary
{
    /// <summary>Counts as capacity: not out of office, not on a holiday; a person merely outside work hours only while <paramref name="countOffHours"/> is on.</summary>
    public static bool Counts(CapacityWorkerFact w, bool countOffHours) => w.State switch
    {
        CapacityStates.OutOfOffice => false,
        CapacityStates.OffHours => countOffHours && !w.OnHoliday,
        _ => true,
    };

    public static CapacityTotals Compute(IReadOnlyCollection<CapacityWorkerFact> workers, int slots, bool countOffHours)
    {
        ArgumentNullException.ThrowIfNull(workers);
        var counted = workers.Where(w => Counts(w, countOffHours)).ToList();
        var free = counted.Sum(w => Math.Max(0, slots - Math.Max(0, w.Load)));
        var over = counted.Sum(w => Math.Max(0, w.Load - slots));
        var total = counted.Count * slots;
        var offHours = workers.Where(w => w.State == CapacityStates.OffHours && !Counts(w, countOffHours)).ToList();
        var state = workers.Count == 0 ? CapacitySummaryStates.NoWorkers
            : counted.Count > 0 ? CapacitySummaryStates.Ok
            : offHours.Count > 0 ? (offHours.All(w => w.OnHoliday) ? CapacitySummaryStates.Holiday : CapacitySummaryStates.AfterHours)
            : CapacitySummaryStates.AllOut;
        int? freePercent = state == CapacitySummaryStates.Ok ? (int)Math.Round(100.0 * free / total, MidpointRounding.AwayFromZero) : null;
        return new CapacityTotals(state, counted.Count, total, free, over, counted.Count(w => slots - w.Load > 0), freePercent);
    }
}

/// <summary>
/// Read side of the capacity battery and its People list. A fixed number of statements whatever the number of workers: the workers, one grouped load count, the availability of all of them
/// (two queries), the last-hour count and, for the People list only, the Pod names and the out-of-office end dates. The load is deliberately NOT filtered by the sensitive-matter rule
/// (true load matters for capacity); it leaves the database only as an integer per person and no Task, Matter or title is ever selected (decision AS item 12).
/// </summary>
public sealed class CapacityService(DbContext db, IClock clock, IUserAvailabilityReader availability, IOptions<DashboardOptions> options, DashboardScopeResolver scopes, IDashboardSettings dashboardSettings, IPermissionChecker permissions, IMatterVisibility visibility)
{
    public const int MaxPeople = 200;

    internal sealed record Worker(int UserId, string DisplayName, string State, int Load, bool OnHoliday);

    public async Task<Result<DashboardCapacity>> GetAsync(CapacityQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        var resolved = await scopes.ResolveAsync(query.PodScope, null, ct);
        if (resolved.IsFailure)
            return resolved.Error!;

        var now = clock.UtcNow;
        var workers = await ReadWorkersAsync(resolved.Value, now, ct);
        var slots = SlotsPerPerson;

        var countOffHours = (await dashboardSettings.GetCapacityAsync(ct)).CountOffHours;
        var totals = CapacitySummary.Compute([.. workers.Select(w => new CapacityWorkerFact(w.State, w.Load, w.OnHoliday))], slots, countOffHours);

        var counts = CapacityStates.All.Select(s => new CapacityStateCount(s, workers.Count(w => w.State == s))).ToList();
        int? lastHour = null;
        if (workers.Count > 0)
        {
            var ids = workers.Select(w => w.UserId).ToList();
            var since = now.AddHours(-1);
            lastHour = await db.Set<WorkTask>().AsNoTracking().CountAsync(t => t.AssignedAtUtc != null && t.AssignedAtUtc >= since && t.AssignedUserId != null && ids.Contains(t.AssignedUserId.Value), ct);
        }
        else
        {
            lastHour = 0;
        }

        // The Summary's visibility-filtered unassigned number (VisibleTasks.OpenUnassigned), only for callers who may see unassigned counts.
        int? unassignedWaiting = permissions.Has(Permissions.Dashboard.ViewSummary) || permissions.Has(Permissions.Dashboard.ViewUnassigned)
            ? await VisibleTasks.OpenUnassigned(db, visibility, resolved.Value).CountAsync(ct)
            : null;

        return new DashboardCapacity(
            DateTime.SpecifyKind(now, DateTimeKind.Utc),
            totals.SummaryState,
            workers.Count,
            totals.Counted,
            slots,
            totals.TotalSlots,
            totals.FreeSlots,
            totals.FreePercent is { } fp ? 100 - fp : null,
            totals.FreePercent,
            totals.CanTakeWork,
            counts,
            lastHour,
            countOffHours,
            totals.OverCapacityTasks,
            unassignedWaiting);
    }

    public async Task<Result<IReadOnlyList<CapacityPerson>>> GetPeopleAsync(CapacityPeopleQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        string? stateFilter = null;
        if (!string.IsNullOrWhiteSpace(query.State))
        {
            stateFilter = CapacityStates.All.FirstOrDefault(s => string.Equals(s, query.State.Trim(), StringComparison.OrdinalIgnoreCase));
            if (stateFilter is null)
                return Error.Validation("state", "UNKNOWN_STATE", $"Unknown state '{query.State}'. Allowed: {string.Join(", ", CapacityStates.All)}.");
        }

        var resolved = await scopes.ResolveAsync(query.PodScope, null, ct);
        if (resolved.IsFailure)
            return resolved.Error!;

        var now = clock.UtcNow;
        IEnumerable<Worker> workers = await ReadWorkersAsync(resolved.Value, now, ct);
        if (!string.IsNullOrWhiteSpace(query.Q))
        {
            var term = query.Q.Trim();
            workers = workers.Where(w => w.DisplayName.Contains(term, StringComparison.CurrentCultureIgnoreCase));
        }

        if (stateFilter is not null)
            workers = workers.Where(w => w.State == stateFilter);

        var shown = workers
            .OrderBy(w => CapacityStates.Severity(w.State))
            .ThenBy(w => w.DisplayName, StringComparer.CurrentCultureIgnoreCase)
            .ThenBy(w => w.UserId)
            .Take(MaxPeople)
            .ToList();
        if (shown.Count == 0)
            return Result<IReadOnlyList<CapacityPerson>>.Success([]);

        var ids = shown.Select(w => w.UserId).ToList();
        var pods = (await db.Set<PodMember>().AsNoTracking().Where(m => ids.Contains(m.UserId) && m.Pod.IsActive).Select(m => new { m.UserId, m.Pod.Name }).ToListAsync(ct)).ToLookup(m => m.UserId);
        var away = shown.Any(w => w.State == CapacityStates.OutOfOffice)
            ? await availability.AwayWindowsAsync(shown.Where(w => w.State == CapacityStates.OutOfOffice).Select(w => w.UserId).ToList(), DateOnly.FromDateTime(now.AddDays(-1)), DateOnly.FromDateTime(now.AddDays(1)), ct)
            : new Dictionary<int, AwayWindow>();

        IReadOnlyList<CapacityPerson> people =
        [
            .. shown.Select(w => new CapacityPerson(
                w.UserId,
                w.DisplayName,
                w.State,
                w.Load,
                w.State == CapacityStates.OutOfOffice && away.TryGetValue(w.UserId, out var window) ? window.Until : null,
                [.. pods[w.UserId].Select(p => p.Name).Order(StringComparer.CurrentCultureIgnoreCase)])),
        ];
        return Result<IReadOnlyList<CapacityPerson>>.Success(people);
    }

    private int SlotsPerPerson => Math.Clamp(options.Value.Capacity.SlotsPerPerson, 1, 20);

    /// <summary>
    /// The workers of the scope with their state: active users holding Workflow.Execute (through an active role, the way the workload board joins roles; the System Admin role holds every permission) who are active members of
    /// an active Pod of the scope. Their load is the count of their open Tasks that are New or In progress, over every Task in the database.
    /// </summary>
    internal async Task<List<Worker>> ReadWorkersAsync(DashboardScope scope, DateTime now, CancellationToken ct)
    {
        var members = db.Set<PodMember>().AsNoTracking().Where(m => m.Pod.IsActive);
        if (!scope.IsAll)
        {
            var scopePods = scope.PodIds.ToList();
            members = members.Where(m => scopePods.Contains(m.PodId));
        }

        var people = db.Set<AppUser>().AsNoTracking().Where(u => u.IsActive
            && u.Roles.Any(ur => ur.Role.IsActive && (ur.Role.IsSystemAdmin || ur.Role.Permissions.Any(rp => rp.Permission.IsActive && rp.Permission.Code == Permissions.Workflow.Execute)))
            && members.Any(m => m.UserId == u.Id));
        var users = await people.Select(u => new { u.Id, u.DisplayName }).ToListAsync(ct);
        if (users.Count == 0)
            return [];

        var ids = users.Select(u => u.Id).ToList();
        // Load: a bare count per person over ALL their New and In progress Tasks (On hold does not count); nothing else of a Task is selected.
        var loads = await db.Set<WorkTask>().AsNoTracking()
            .Where(t => (t.Status == TaskStatusCode.New || t.Status == TaskStatusCode.InProgress) && t.AssignedUserId != null && ids.Contains(t.AssignedUserId.Value))
            .GroupBy(t => t.AssignedUserId!.Value)
            .Select(g => new { UserId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.UserId, g => g.Count, ct);
        var states = await availability.EvaluateAsync(ids, now, ct);
        return [.. users.Select(u => new Worker(u.Id, u.DisplayName, CapacityRules.State(loads.GetValueOrDefault(u.Id), states[u.Id].State), loads.GetValueOrDefault(u.Id), states[u.Id].Reason == AvailabilityReasons.Holiday))];
    }
}
