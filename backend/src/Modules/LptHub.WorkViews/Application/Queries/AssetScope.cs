using MatterFlow.Assets.Domain;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Data;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Visibility;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// The matters one asset call is about and the assets in them (epic #851): the matters the caller manages (<c>mine</c>, either place or the one named by <c>role</c>) or, with
/// <c>Matter.AssignManagers</c>, every matter the caller may see (<c>all</c>), optionally narrowed to a list of matters. Unlike the My Matters task scope it keeps
/// INACTIVE matters: an asset waits for its disposition most often after its matter was closed. Matters are a SQL subquery, so the statement count does not depend on their number.
/// </summary>
public sealed class AssetScope
{
    internal AssetScope(DbContext db, int me, IQueryable<Matter> matters, bool all, string role)
    {
        Db = db;
        Me = me;
        Matters = matters;
        All = all;
        Role = role;
    }

    public DbContext Db { get; }

    public int Me { get; }

    /// <summary>The matters of the scope that the caller may see.</summary>
    public IQueryable<Matter> Matters { get; }

    public bool All { get; }

    /// <summary><c>both</c>, <c>primary</c> or <c>secondary</c> (only for <c>mine</c>).</summary>
    public string Role { get; }

    /// <summary>The assets of the scope's matters, all dispositions.</summary>
    public IQueryable<Asset> Assets()
    {
        var ids = Matters.Select(m => m.Id);
        // Tagged: these statements are made for the average caller, not for whoever asked first (issue #938).
        return Db.Set<Asset>().AsNoTracking().TagWith(QueryPlanTags.StablePlan).Where(a => ids.Contains(a.MatterId));
    }

    /// <summary>
    /// The Assets list query string (no leading <c>?</c>) that lists exactly the scope's assets, plus <paramref name="extra"/> parameters, so a count and the list it opens agree.
    /// For All the list is not narrowed by matter.
    /// </summary>
    public string AssetsQuery(params string[] extra)
    {
        var parts = new List<string>();
        if (!All)
        {
            parts.Add("matterManagedByMe=true");
            if (Role != "both")
                parts.Add("role=" + Role);
        }

        parts.AddRange(extra);
        return string.Join('&', parts);
    }
}

/// <summary>
/// Validates the scope parameters of the Data tab and the asset reports and builds the <see cref="AssetScope"/>. <c>scope=all</c> needs <c>Matter.AssignManagers</c> (403). The
/// sensitive-matter rule applies through <see cref="IManagedMatterScope"/> and <see cref="IMatterVisibility"/>: a matter the caller may not see contributes nothing.
/// </summary>
public sealed class AssetScopeResolver(DbContext db, ICurrentUser currentUser, IManagedMatterScope managed, IMatterVisibility visibility)
{
    public const string ScopeMine = "mine";
    public const string ScopeAll = "all";

    public Result<AssetScope> Resolve(string? scopeText, string? roleText, IReadOnlyCollection<int>? matterIds = null)
    {
        if (currentUser.UserId is not { } me)
            return Error.Unauthenticated("Sign in to see asset data.");

        var scope = string.IsNullOrWhiteSpace(scopeText) ? ScopeMine : scopeText.Trim().ToLowerInvariant();
        if (scope is not (ScopeMine or ScopeAll))
            return Error.Validation("scope", "UNKNOWN_SCOPE", $"Unknown scope '{scopeText}'. Allowed: mine, all.");

        var role = "both";
        if (!string.IsNullOrWhiteSpace(roleText))
        {
            role = roleText.Trim().ToLowerInvariant();
            if (role is not ("both" or "primary" or "secondary"))
                return Error.Validation("role", "UNKNOWN_ROLE", $"Unknown role '{roleText}'. Allowed: primary, secondary, both.");
        }

        var all = scope == ScopeAll;
        if (all)
        {
            var allowed = managed.RequireAllScope();
            if (allowed.IsFailure)
                return allowed.Error!;
        }

        var matters = db.Set<Matter>().AsNoTracking();
        if (matterIds is { Count: > 0 })
        {
            var wanted = matterIds.ToArray();
            matters = matters.Where(m => wanted.Contains(m.Id));
        }

        if (all)
        {
            matters = visibility.WhereMatterVisible(matters, m => m.Id);
        }
        else
        {
            var place = role switch
            {
                "primary" => ManagerPlace.Primary,
                "secondary" => ManagerPlace.Secondary,
                _ => ManagerPlace.Either,
            };
            matters = managed.WhereManagedBy(matters, m => m.PrimaryManagerId, m => m.SecondaryManagerId, m => m.Id, me, place);
        }

        return new AssetScope(db, me, matters, all, role);
    }
}
