using System.Linq.Expressions;

namespace MatterFlow.SharedKernel.Visibility;

/// <summary>
/// The sensitive-matter rule as expression trees (README section 1), one definition for every module. The same rule exists in SQL as
/// <c>dbo.fnMatterVisible</c> / <c>dbo.fnTaskVisible</c> (see db/scripts); a parity test keeps the two identical.
/// <list type="bullet">
/// <item>MatterVisible = NOT IsSensitive OR SeeAll OR Primary = user OR Secondary = user.</item>
/// <item>TaskVisible = MatterVisible OR AssignedUserId = user.</item>
/// </list>
/// A viewer without a person (<see cref="Viewer.UserId"/> null) never matches a manager or an assignee: the comparison is not written against a
/// null parameter, which SQL would turn into IS NULL and match every matter that has no manager.
/// </summary>
public static class VisibilityPredicates
{
    /// <summary>Matter rows the viewer may see (mode M).</summary>
    public static Expression<Func<MatterAccessRow, bool>> Matter(Viewer viewer)
    {
        if (viewer.SeeAll)
            return r => true;

        if (viewer.UserId is not { } user)
            return r => !r.IsSensitive;

        return r => !r.IsSensitive || r.PrimaryManagerId == user || r.SecondaryManagerId == user;
    }

    /// <summary>Task rows the viewer may see through the assignee rule only (mode T minus the matter part).</summary>
    public static Expression<Func<TaskAccessRow, bool>> AssignedToViewer(Viewer viewer)
    {
        if (viewer.UserId is not { } user)
            return r => false;

        return r => r.AssignedUserId == user;
    }

    /// <summary>
    /// The matter rule over any row that carries the matter's columns itself (the Matter entity, or a join that already has the matter): the selectors name
    /// <c>IsSensitive</c> and the two manager columns. Same truth table as <see cref="Matter"/>; no extra join or subquery.
    /// </summary>
    public static Expression<Func<T, bool>> MatterRow<T>(
        Viewer viewer,
        Expression<Func<T, bool>> isSensitive,
        Expression<Func<T, int?>> primaryManagerId,
        Expression<Func<T, int?>> secondaryManagerId)
    {
        ArgumentNullException.ThrowIfNull(isSensitive);
        ArgumentNullException.ThrowIfNull(primaryManagerId);
        ArgumentNullException.ThrowIfNull(secondaryManagerId);
        var parameter = isSensitive.Parameters[0];
        if (viewer.SeeAll)
            return Expression.Lambda<Func<T, bool>>(Expression.Constant(true), parameter);

        Expression notSensitive = Expression.Not(isSensitive.Body);
        if (viewer.UserId is not { } user)
            return Expression.Lambda<Func<T, bool>>(notSensitive, parameter);

        var value = Parameter(user);
        var primary = Expression.Equal(Rebind(primaryManagerId, parameter), value);
        var secondary = Expression.Equal(Rebind(secondaryManagerId, parameter), value);
        return Expression.Lambda<Func<T, bool>>(Expression.OrElse(notSensitive, Expression.OrElse(primary, secondary)), parameter);
    }

    /// <summary>The task rule over a row that carries the matter's columns and the task's assignee: the matter rule OR assigned to the viewer.</summary>
    public static Expression<Func<T, bool>> TaskRow<T>(
        Viewer viewer,
        Expression<Func<T, bool>> isSensitive,
        Expression<Func<T, int?>> primaryManagerId,
        Expression<Func<T, int?>> secondaryManagerId,
        Expression<Func<T, int?>> assignedUserId)
    {
        ArgumentNullException.ThrowIfNull(assignedUserId);
        var matter = MatterRow(viewer, isSensitive, primaryManagerId, secondaryManagerId);
        if (viewer.SeeAll || viewer.UserId is not { } user)
            return matter;

        var parameter = matter.Parameters[0];
        var assigned = Expression.Equal(Rebind(assignedUserId, parameter), Parameter(user));
        return Expression.Lambda<Func<T, bool>>(Expression.OrElse(matter.Body, assigned), parameter);
    }

    private sealed class Holder
    {
        public int? Value { get; init; }
    }

    /// <summary>A query parameter (not a literal) holding the user id, so the plan is shared between people.</summary>
    private static MemberExpression Parameter(int user) => Expression.Property(Expression.Constant(new Holder { Value = user }), nameof(Holder.Value));

    private static Expression Rebind<T, TValue>(Expression<Func<T, TValue>> selector, ParameterExpression to) =>
        new ReplaceParameter(selector.Parameters[0], to).Visit(selector.Body)!;

    private sealed class ReplaceParameter(ParameterExpression from, ParameterExpression to) : ExpressionVisitor
    {
        protected override Expression VisitParameter(ParameterExpression node) => node == from ? to : base.VisitParameter(node);
    }

    /// <summary>
    /// <c>source.Where(x =&gt; ids.Contains(matterId(x)))</c> with <paramref name="ids"/> an <see cref="IQueryable{T}"/> that EF translates to a subquery.
    /// </summary>
    public static IQueryable<T> WhereIn<T, TKey>(IQueryable<T> source, Expression<Func<T, TKey>> key, IQueryable<TKey> ids)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(key);
        ArgumentNullException.ThrowIfNull(ids);
        var contains = Expression.Call(typeof(Queryable), nameof(Queryable.Contains), [typeof(TKey)], ids.Expression, key.Body);
        return source.Where(Expression.Lambda<Func<T, bool>>(contains, key.Parameters));
    }
}
