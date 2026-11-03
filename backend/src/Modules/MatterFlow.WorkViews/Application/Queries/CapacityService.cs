using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using MatterFlow.SharedKernel.Availability;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Time;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace MatterFlow.WorkViews.Application.Queries;

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
/// The department capacity battery (Dashboard v4, decision AS items 5, 6 and 12): aggregates only, no per-person data. A worker holds <c>Workflow.Execute</c> and is an active member of a Pod in the scope.
/// The battery counts only the workers who can take work now: people out of office or outside their work hours are left out of <c>TotalSlots</c> and the percentages (they still show in <c>States</c>),
/// so the figure never reads 100% used just because it is evening. When nobody can take work now <c>State</c> says why and the percentages are null (show "After hours", not an alarm).
/// A worker's load is counted over all their open Tasks as a bare number; no Task, Matter or title is read for the answer.
/// </summary>
/// <param name="AsOfUtc">The instant the figures were computed for.</param>
/// <param name="State"><c>OK</c> (percentages set), <c>AFTER_HOURS</c> (workers exist but all are outside their work hours or out of office, with at least one outside work hours), <c>ALL_OUT</c> (all workers are out of office) or <c>NO_WORKERS</c> (empty scope).</param>
/// <param name="Workers">Workers in the scope, in every state.</param>
/// <param name="PresentWorkers">Workers who can take work now: not out of office and inside their work hours.</param>
/// <param name="SlotsPerPerson">Open Tasks (New or In progress) one person can hold (default 3).</param>
/// <param name="TotalSlots"><c>PresentWorkers</c> times <c>SlotsPerPerson</c>.</param>
/// <param name="FreeSlots">Free slots among the present workers (slots minus load, never below zero).</param>
/// <param name="UsedPercent">100 minus <c>FreePercent</c>, rounded; null unless <c>State</c> is <c>OK</c>.</param>
/// <param name="FreePercent">Free slots over total slots, rounded; null unless <c>State</c> is <c>OK</c>.</param>
/// <param name="CanTakeWork">Present workers with at least one free slot.</param>
/// <param name="States">All six states in fixed order (Available, Occupied, Busy, Overloaded, Out of office, Off hours) with the number of workers in each; they add up to <c>Workers</c>.</param>
/// <param name="AssignedLastHour">Tasks assigned to workers of the scope in the last hour (from <c>Task.AssignedAt</c>): the rate hint. No trend is kept.</param>
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
    int? AssignedLastHour);

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
    public const string AfterHours = "AFTER_HOURS";
    public const string AllOut = "ALL_OUT";
    public const string NoWorkers = "NO_WORKERS";
}

/// <summary>
/// Read side of the capacity battery and its People list. A fixed number of statements whatever the number of workers: the workers, one grouped load count, the availability of all of them
/// (two queries), the last-hour count and, for the People list only, the Pod names and the out-of-office end dates. The load is deliberately NOT filtered by the sensitive-matter rule
/// (true load matters for capacity); it leaves the database only as an integer per person and no Task, Matter or title is ever selected (decision AS item 12).
/// </summary>
public sealed class CapacityService(DbContext db, IClock clock, IUserAvailabilityReader availability, IOptions<DashboardOptions> options, DashboardScopeResolver scopes)
{
    public const int MaxPeople = 200;

    private sealed record Worker(int UserId, string DisplayName, string State, int Load);

    public async Task<Result<DashboardCapacity>> GetAsync(CapacityQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        var resolved = await scopes.ResolveAsync(query.PodScope, null, ct);
        if (resolved.IsFailure)
            return resolved.Error!;

        var now = clock.UtcNow;
        var workers = await ReadWorkersAsync(resolved.Value, now, ct);
        var slots = SlotsPerPerson;

        var present = workers.Where(w => CapacityRules.IsPresent(w.State)).ToList();
        var free = present.Sum(w => CapacityRules.FreeSlots(w.State, w.Load, slots));
        var total = present.Count * slots;
        var summaryState = workers.Count == 0 ? CapacitySummaryStates.NoWorkers
            : present.Count > 0 ? CapacitySummaryStates.Ok
            : workers.Any(w => w.State == CapacityStates.OffHours) ? CapacitySummaryStates.AfterHours
            : CapacitySummaryStates.AllOut;
        int? freePercent = summaryState == CapacitySummaryStates.Ok ? (int)Math.Round(100.0 * free / total, MidpointRounding.AwayFromZero) : null;

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

        return new DashboardCapacity(
            DateTime.SpecifyKind(now, DateTimeKind.Utc),
            summaryState,
            workers.Count,
            present.Count,
            slots,
            total,
            free,
            freePercent is { } fp ? 100 - fp : null,
            freePercent,
            present.Count(w => CapacityRules.FreeSlots(w.State, w.Load, slots) > 0),
            counts,
            lastHour);
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
    private async Task<List<Worker>> ReadWorkersAsync(DashboardScope scope, DateTime now, CancellationToken ct)
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
        return [.. users.Select(u => new Worker(u.Id, u.DisplayName, CapacityRules.State(loads.GetValueOrDefault(u.Id), states[u.Id].State), loads.GetValueOrDefault(u.Id)))];
    }
}
