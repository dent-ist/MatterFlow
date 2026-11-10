using System.Linq.Expressions;
using MatterFlow.SharedKernel.Results;

namespace MatterFlow.SharedKernel.Visibility;

/// <summary>Which place of a matter a manager holds: either of the two (identical rights, epic #667), only the Primary or only the Secondary.</summary>
public enum ManagerPlace
{
    Either,
    Primary,
    Secondary,
}

/// <summary>The resolved "linked to matters managed by me" filter of a list: whose matters and which place they hold.</summary>
/// <param name="Manager">The person whose matters are meant (always the caller for the <c>matterManagedByMe</c> filters).</param>
/// <param name="Place">Primary, Secondary or either.</param>
public sealed record ManagedFilter(int Manager, ManagerPlace Place);

/// <summary>
/// "Matters managed by X", resolved in one place (epic #758, PX-02, issue #760). Before this seam the rule existed three times (Matters list, Task Queue,
/// My Matters); every list, count and filter that means "my matters" now asks here, so the new Assets, Clients, Projects, search and tab endpoints cannot
/// drift, and so the sensitive-matter rule (<see cref="IMatterVisibility"/>, epic #788) is applied in exactly one place: every query built here passes
/// through <see cref="IMatterVisibility.WhereMatterVisible{T}"/>, which lets everything through until the go-live switch is turned on.
/// </summary>
public interface IManagedMatterScope
{
    /// <summary>True when the caller may use the All scope and look at other people's matters (<c>Matter.AssignManagers</c>).</summary>
    bool CanUseAllScope { get; }

    /// <summary>Success, or the 403 <c>PERMISSION_DENIED</c> (meta permission <c>Matter.AssignManagers</c>) for scope=all or another person's matters.</summary>
    Result RequireAllScope();

    /// <summary>The caller's user id, or null without a person (no user, no matters: callers use 0, which is never a user id).</summary>
    int? CurrentUserId { get; }

    /// <summary>
    /// Keeps the rows that are matters the person manages (and the caller may see). For rows that carry the manager columns themselves (a list of
    /// matters, the matters of a scope): the selectors name the two columns and the matter id.
    /// </summary>
    IQueryable<T> WhereManagedBy<T>(
        IQueryable<T> matters,
        Expression<Func<T, int?>> primaryManagerId,
        Expression<Func<T, int?>> secondaryManagerId,
        Expression<Func<T, int>> matterId,
        int manager,
        ManagerPlace place = ManagerPlace.Either);

    /// <summary>Keeps the rows whose matter the person manages (and the caller may see): tasks, assets, projects, clients through their matter.</summary>
    IQueryable<T> WhereMatterManagedBy<T>(IQueryable<T> source, Expression<Func<T, int>> matterId, int manager, ManagerPlace place = ManagerPlace.Either);

    /// <summary>
    /// The shared query parameters <c>matterManagedByMe</c> and <c>role</c> (<c>primary</c>, <c>secondary</c>, <c>both</c>) of the Assets, Clients, Projects and search lists (epic #758): null when
    /// the filter is not asked for, the caller's filter when <c>matterManagedByMe=true</c>. <c>role</c> without <c>matterManagedByMe=true</c> or with an unknown value is a 400, never ignored.
    /// </summary>
    Result<ManagedFilter?> ResolveFilter(bool? matterManagedByMe, string? role);

    /// <summary>The ids of the matters the person manages that the caller may see, as a subquery.</summary>
    IQueryable<int> ManagedMatterIds(int manager, ManagerPlace place = ManagerPlace.Either);
}

/// <summary>The one definition of "this person manages this matter", as an expression over any row shape.</summary>
public static class ManagedMatterRule
{
    private sealed class Holder
    {
        public int? Value { get; init; }
    }

    /// <summary>
    /// <c>Primary = manager</c>, <c>Secondary = manager</c> or either, over the given selectors. A matter without a manager never matches. The manager id is
    /// a parameter of the query (not a literal), so the plan is shared between people.
    /// </summary>
    public static Expression<Func<T, bool>> Predicate<T>(
        Expression<Func<T, int?>> primaryManagerId,
        Expression<Func<T, int?>> secondaryManagerId,
        int manager,
        ManagerPlace place)
    {
        ArgumentNullException.ThrowIfNull(primaryManagerId);
        ArgumentNullException.ThrowIfNull(secondaryManagerId);
        var parameter = primaryManagerId.Parameters[0];
        var value = Expression.Property(Expression.Constant(new Holder { Value = manager }), nameof(Holder.Value));
        var primary = Expression.Equal(primaryManagerId.Body, value);
        var secondaryBody = new Rebind(secondaryManagerId.Parameters[0], parameter).Visit(secondaryManagerId.Body)!;
        var secondary = Expression.Equal(secondaryBody, value);
        Expression body = place switch
        {
            ManagerPlace.Primary => primary,
            ManagerPlace.Secondary => secondary,
            _ => Expression.OrElse(primary, secondary),
        };
        return Expression.Lambda<Func<T, bool>>(body, parameter);
    }

    private sealed class Rebind(ParameterExpression from, ParameterExpression to) : ExpressionVisitor
    {
        protected override Expression VisitParameter(ParameterExpression node) => node == from ? to : base.VisitParameter(node);
    }
}
