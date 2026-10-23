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
