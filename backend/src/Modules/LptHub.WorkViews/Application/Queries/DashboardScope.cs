using System.ComponentModel.DataAnnotations;
using System.Globalization;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// The page-wide Dashboard scope (UX review 2, P1, #89): which Tasks a Dashboard number is about. <c>all</c> is every Task (including those with no Pod); a
/// Pod (or the union of the caller's Pods for <c>mine</c>) means the Tasks whose Pod field is one of those Pods, exactly the Task Queue <c>pod</c> filter, so
/// every count equals its drill-through. A scope only ever narrows what the caller's permissions already allow; it never widens it.
/// </summary>
public sealed record DashboardScope(string Value, IReadOnlyList<int> PodIds)
{
    public const string All = "all";
    public const string Mine = "mine";

    public static readonly DashboardScope Everything = new(All, []);

    /// <summary>True for <c>all</c>: no Pod filter, Tasks without a Pod included.</summary>
    public bool IsAll => Value == All;

    /// <summary>Cache key part: the resolved Pods, so a change of membership never serves an answer computed for other Pods.</summary>
    public string Key => IsAll ? All : Value + ":" + string.Join(',', PodIds.Order().Select(i => i.ToString(CultureInfo.InvariantCulture)));

    /// <summary>The Tasks of the scope (the Task Queue <c>pod</c> filter); everything for <c>all</c>. "My pods" with no Pod matches nothing.</summary>
    public IQueryable<WorkTask> Apply(IQueryable<WorkTask> tasks)
    {
        if (IsAll)
            return tasks;
        var ids = PodIds.ToList();
        return tasks.Where(t => t.AssignedPodId != null && ids.Contains(t.AssignedPodId.Value));
    }

    /// <summary>The Task Queue query for a number: its own query plus the <c>pod</c> filter of the scope (<c>pod=0</c>, which matches nothing, for "my pods" without a Pod).</summary>
    public string Scoped(string query)
    {
        if (IsAll)
            return query;
        var pods = PodIds.Count == 0 ? "pod=0" : string.Join('&', PodIds.Order().Select(i => "pod=" + i.ToString(CultureInfo.InvariantCulture)));
        return query.Length == 0 ? pods : query + "&" + pods;
    }
}

/// <summary>
/// Resolves the <c>podScope</c> parameter of the five Dashboard endpoints on the server (the client never says which Pods are "mine"). <c>null</c> or
/// <c>all</c> is every Task; <c>mine</c> is the caller's active Pods; a number is one Pod, which must exist (400 <c>UNKNOWN_POD</c>) and be one the caller may
/// see: their own, or any with <c>Pod.View</c> (403 otherwise).
/// </summary>
public sealed class DashboardScopeResolver(DbContext db, ICurrentUser currentUser, IPodDirectory pods, IPermissionChecker permissions)
{
    /// <summary>The Scope select of the page: own active Pods first (by name), then, with <c>Pod.View</c>, every other active Pod; the default follows membership only.</summary>
    public async Task<Result<DashboardScopeChoices>> ChoicesAsync(CancellationToken ct)
    {
        if (currentUser.UserId is not { } me)
            return Error.Unauthenticated("Sign in to see the dashboard.");
        var mine = await pods.GetUserPodsAsync(me, includeInactive: false, ct);
        var choices = mine.Select(p => new DashboardScopePod(p.Pod.PodId, p.Pod.Name, true)).ToList();
        if (permissions.Has(Permissions.Pod.View))
        {
            var known = choices.Select(c => c.PodId).ToHashSet();
            var others = await db.Set<Pod>().AsNoTracking().Where(p => p.IsActive).OrderBy(p => p.Name).Select(p => new { p.Id, p.Name }).ToListAsync(ct);
            choices.AddRange(others.Where(p => !known.Contains(p.Id)).Select(p => new DashboardScopePod(p.Id, p.Name, false)));
        }

        return new DashboardScopeChoices(mine.Count > 0 ? DashboardScope.Mine : DashboardScope.All, mine.Count > 0, choices);
    }

    public async Task<Result<DashboardScope>> ResolveAsync(string? podScope, int? legacyPodId, CancellationToken ct)
    {
        var raw = podScope?.Trim();
        if (string.IsNullOrEmpty(raw) && legacyPodId is { } legacy)
            raw = legacy.ToString(CultureInfo.InvariantCulture);
        if (string.IsNullOrEmpty(raw) || string.Equals(raw, DashboardScope.All, StringComparison.OrdinalIgnoreCase))
            return DashboardScope.Everything;
        if (currentUser.UserId is not { } me)
            return Error.Unauthenticated("Sign in to see the dashboard.");

        if (string.Equals(raw, DashboardScope.Mine, StringComparison.OrdinalIgnoreCase))
        {
            var mine = await pods.GetUserPodsAsync(me, includeInactive: false, ct);
            return new DashboardScope(DashboardScope.Mine, [.. mine.Select(p => p.Pod.PodId)]);
        }

        if (!int.TryParse(raw, NumberStyles.None, CultureInfo.InvariantCulture, out var podId) || podId <= 0)
            return Error.Validation("podScope", "INVALID_POD_SCOPE", "podScope must be 'all', 'mine' or a pod id.");
        if (await pods.FindAsync(podId, ct) is null)
            return Error.Validation("podScope", "UNKNOWN_POD", $"Unknown pod {podId}.");
        if (!permissions.Has(Permissions.Pod.View))
        {
            var member = (await pods.GetUserPodsAsync(me, includeInactive: true, ct)).Any(p => p.Pod.PodId == podId);
            if (!member)
                return Error.Forbidden("That pod is not available to you.");
        }

        return new DashboardScope(podId.ToString(CultureInfo.InvariantCulture), [podId]);
    }
}

/// <summary>A Pod in the Scope select: <c>IsMine</c> marks the caller's own Pods (listed first).</summary>
public sealed record DashboardScopePod([property: Required] int PodId, [property: Required] string Name, [property: Required] bool IsMine);

/// <summary>
/// What the Scope select offers the caller: the default (<c>mine</c> for a member of at least one active Pod, else <c>all</c>; membership only, never role names),
/// their own Pods first, and the other active Pods only with <c>Pod.View</c>. <c>mine</c> is offered only when <c>HasPods</c>.
/// </summary>
public sealed record DashboardScopeChoices(
    [property: Required] string DefaultScope,
    [property: Required] bool HasPods,
    [property: Required] IReadOnlyList<DashboardScopePod> Pods);

/// <summary>The scope a figure was computed for, echoed on the answer: <c>Scope</c> as asked (<c>all</c>, <c>mine</c> or a Pod id), the resolved Pod ids, and the unassigned Tasks outside every Pod when the scope is not <c>all</c>.</summary>
public sealed record DashboardScopeInfo(
    [property: Required] string Scope,
    [property: Required] IReadOnlyList<int> PodIds,
    [property: Required] int UnassignedNoPod);
