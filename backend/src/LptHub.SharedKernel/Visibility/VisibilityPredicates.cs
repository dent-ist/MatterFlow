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

    private sealed class Joined<T>
    {
        public T Row { get; init; } = default!;

        public IEnumerable<int?> Matches { get; init; } = [];
    }

    private sealed class Flat<T>
    {
        public T Row { get; init; } = default!;

        public int? VisibleMatterId { get; init; }
    }

    /// <summary>
    /// The matter rule OR an extra row predicate, for a set-wide reader over rows that carry only a matter id: <c>LEFT JOIN visible matters ... WHERE (matched OR extra)</c>.
    /// This is the join form the performance work of #791 measured (84 to 236 reads at 24,000 tasks); the same rule written as <c>EXISTS (...) OR extra</c> probes the
    /// matter table once per row (38,500 reads) and must not be used. <paramref name="alsoVisible"/> gets the viewer's user id; a viewer without a person gets the
    /// matter-only form (no OR).
    /// </summary>
    public static IQueryable<T> WhereMatterOr<T>(
        IQueryable<T> source,
        Expression<Func<T, int>> matterId,
        Func<int, Expression<Func<T, bool>>> alsoVisible,
        IQueryable<int> visibleMatterIds,
        Viewer viewer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(matterId);
        ArgumentNullException.ThrowIfNull(alsoVisible);
        ArgumentNullException.ThrowIfNull(visibleMatterIds);
        if (viewer.UserId is not { } user)
            return WhereIn(source, matterId, visibleMatterIds);

        var flat = source
            .GroupJoin(visibleMatterIds, matterId, id => id, (t, g) => new Joined<T> { Row = t, Matches = g.Select(i => (int?)i) })
            .SelectMany(x => x.Matches.DefaultIfEmpty(), (x, m) => new Flat<T> { Row = x.Row, VisibleMatterId = m });

        var f = Expression.Parameter(typeof(Flat<T>), "f");
        var row = Expression.Property(f, nameof(Flat<T>.Row));
        var matched = Expression.NotEqual(Expression.Property(f, nameof(Flat<T>.VisibleMatterId)), Expression.Constant(null, typeof(int?)));
        var extra = Rebind(alsoVisible(user), row);
        var predicate = Expression.Lambda<Func<Flat<T>, bool>>(Expression.OrElse(matched, extra), f);
        return flat.Where(predicate).Select(x => x.Row);
    }

    /// <summary>The task rule for a set-wide reader over rows with a matter id and the task's assignee: the matter rule OR assigned to the viewer (join form, see <see cref="WhereMatterOr{T}"/>).</summary>
    public static IQueryable<T> WhereMatterOrAssigned<T>(
        IQueryable<T> source,
        Expression<Func<T, int>> matterId,
        Expression<Func<T, int?>> assignedUserId,
        IQueryable<int> visibleMatterIds,
        Viewer viewer)
    {
        ArgumentNullException.ThrowIfNull(assignedUserId);
        return WhereMatterOr(
            source,
            matterId,
            user =>
            {
                var parameter = Expression.Parameter(typeof(T), "r");
                return Expression.Lambda<Func<T, bool>>(Expression.Equal(Rebind(assignedUserId, parameter), Parameter(user)), parameter);
            },
            visibleMatterIds,
            viewer);
    }

    /// <summary>The matter rule over rows that carry the matter's columns, OR an extra predicate for the viewer (for example "the asset is linked to a task assigned to the viewer"). No extra join.</summary>
    public static Expression<Func<T, bool>> MatterRowOr<T>(
        Viewer viewer,
        Expression<Func<T, bool>> isSensitive,
        Expression<Func<T, int?>> primaryManagerId,
        Expression<Func<T, int?>> secondaryManagerId,
        Func<int, Expression<Func<T, bool>>> alsoVisible)
    {
        ArgumentNullException.ThrowIfNull(alsoVisible);
        var matter = MatterRow(viewer, isSensitive, primaryManagerId, secondaryManagerId);
        if (viewer.SeeAll || viewer.UserId is not { } user)
            return matter;

        var parameter = matter.Parameters[0];
        return Expression.Lambda<Func<T, bool>>(Expression.OrElse(matter.Body, Rebind(alsoVisible(user), parameter)), parameter);
    }

    private sealed class IdList
    {
        public int[] Ids { get; init; } = [];
    }

    /// <summary>
    /// The task rule for rows that carry the task's own copy of the matter's sensitivity flag (<c>Task.IsMatterSensitive</c>, script 37, issue #810): <c>NOT sensitive OR assigned to the
    /// viewer OR the matter is one the viewer manages</c>. Every term is a test on the row's own columns, so a covering index answers it and an ordered page stays an index walk; the
    /// matters the viewer manages come as a short id list (<paramref name="managedMatterIds"/>, a query parameter) or, when the caller has not loaded it, as a subquery
    /// (<paramref name="managedMatters"/>). A viewer without a person sees non-sensitive matters only; a see-all viewer is not filtered. Same truth table as <see cref="TaskRow{T}"/>.
    /// </summary>
    public static Expression<Func<T, bool>> TaskFlag<T>(
        Viewer viewer,
        Expression<Func<T, int>> matterId,
        Expression<Func<T, bool>> isMatterSensitive,
        Expression<Func<T, int?>> assignedUserId,
        IReadOnlyList<int>? managedMatterIds,
        IQueryable<int> managedMatters)
    {
        ArgumentNullException.ThrowIfNull(matterId);
        ArgumentNullException.ThrowIfNull(isMatterSensitive);
        ArgumentNullException.ThrowIfNull(assignedUserId);
        ArgumentNullException.ThrowIfNull(managedMatters);
        var parameter = isMatterSensitive.Parameters[0];
        if (viewer.SeeAll)
            return Expression.Lambda<Func<T, bool>>(Expression.Constant(true), parameter);

        Expression visible = Expression.Not(isMatterSensitive.Body);
        if (viewer.UserId is not { } user)
            return Expression.Lambda<Func<T, bool>>(visible, parameter);

        visible = Expression.OrElse(visible, Expression.Equal(Rebind(assignedUserId, parameter), Parameter(user)));
        var matter = Rebind(matterId, parameter);
        if (managedMatterIds is null)
            visible = Expression.OrElse(visible, Expression.Call(typeof(Queryable), nameof(Queryable.Contains), [typeof(int)], managedMatters.Expression, matter));
        else if (managedMatterIds.Count > 0)
        {
            var list = Expression.Property(Expression.Constant(new IdList { Ids = [.. managedMatterIds] }), nameof(IdList.Ids));
            visible = Expression.OrElse(visible, Expression.Call(typeof(Enumerable), nameof(Enumerable.Contains), [typeof(int)], list, matter));
        }

        return Expression.Lambda<Func<T, bool>>(visible, parameter);
    }

    /// <summary>The predicate <c>row =&gt; ids.Contains(key(row))</c> with <paramref name="ids"/> translated to a subquery.</summary>
    public static Expression<Func<T, bool>> In<T, TKey>(Expression<Func<T, TKey>> key, IQueryable<TKey> ids)
    {
        ArgumentNullException.ThrowIfNull(key);
        ArgumentNullException.ThrowIfNull(ids);
        var contains = Expression.Call(typeof(Queryable), nameof(Queryable.Contains), [typeof(TKey)], ids.Expression, key.Body);
        return Expression.Lambda<Func<T, bool>>(contains, key.Parameters);
    }

    private sealed class Holder
    {
        public int? Value { get; init; }
    }

    /// <summary>A query parameter (not a literal) holding the user id, so the plan is shared between people.</summary>
    private static MemberExpression Parameter(int user) => Expression.Property(Expression.Constant(new Holder { Value = user }), nameof(Holder.Value));

    private static Expression Rebind<T, TValue>(Expression<Func<T, TValue>> selector, Expression to) =>
        new ReplaceParameter(selector.Parameters[0], to).Visit(selector.Body)!;

    private sealed class ReplaceParameter(ParameterExpression from, Expression to) : ExpressionVisitor
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
