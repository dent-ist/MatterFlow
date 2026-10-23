using System.Linq.Expressions;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Visibility;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace MatterFlow.Identity.Access;

/// <summary>
/// The implementation of <see cref="IMatterVisibility"/> (epic #788, SM-02). It lives in Identity because the see-all flag is a role grant; the matter and task
/// columns come from the sources the Organization and WorkManagement modules register, so no module sees another module's entity.
/// Nothing here is cached beyond the request: <see cref="Current"/> reads the caller's permission snapshot (invalidated at once when roles or grants change),
/// <see cref="ForAsync"/> reads the grants from the database.
/// </summary>
public sealed class MatterVisibility(
    ICurrentUser currentUser,
    IPermissionChecker permissions,
    IMatterAccessSource matters,
    ITaskAccessSource tasks,
    DbContext db,
    IOptions<SensitiveMatterAccessOptions> options) : IMatterVisibility
{
    private static readonly Error Hidden = Error.NotFound("The resource was not found.");

    public bool Enabled => options.Value.SensitiveMatterAccess;

    public Viewer Current =>
        currentUser.UserId is { } user ? new Viewer(user, permissions.Has(Permissions.Matter.ViewSensitive)) : Viewer.Nobody;

    public async Task<Viewer> ForAsync(int userId, CancellationToken cancellationToken = default)
    {
        if (currentUser.UserId == userId)
            return Current;

        var seeAll = await db.Set<AppUser>().AsNoTracking()
            .Where(u => u.Id == userId && u.IsActive)
            .AnyAsync(u => u.Roles.Any(ur => ur.Role.IsActive
                && (ur.Role.IsSystemAdmin
                    || ur.Role.Permissions.Any(rp => rp.Permission.IsActive && rp.Permission.Code == Permissions.Matter.ViewSensitive))), cancellationToken);
        return new Viewer(userId, seeAll);
    }

    public IQueryable<MatterAccessRow> VisibleMatters(Viewer? viewer = null)
    {
        var rows = matters.Rows();
        var v = viewer ?? Current;
        return !Enabled || v.SeeAll ? rows : rows.Where(VisibilityPredicates.Matter(v));
    }

    public IQueryable<TaskAccessRow> VisibleTasks(Viewer? viewer = null)
    {
        var rows = tasks.Rows();
        var v = viewer ?? Current;
        if (!Enabled || v.SeeAll)
            return rows;

        var visibleMatters = VisibleMatters(v).Select(m => m.MatterId);
        var assigned = VisibilityPredicates.AssignedToViewer(v);
        return rows.Where(Or(t => visibleMatters.Contains(t.MatterId), assigned));
    }

    public IQueryable<T> WhereMatterVisible<T>(IQueryable<T> source, Expression<Func<T, int>> matterId, Viewer? viewer = null)
    {
        var v = viewer ?? Current;
        return !Enabled || v.SeeAll
            ? source
            : VisibilityPredicates.WhereIn(source, matterId, VisibleMatters(v).Select(m => m.MatterId));
    }

    public IQueryable<T> WhereTaskVisible<T>(IQueryable<T> source, Expression<Func<T, long>> taskId, Viewer? viewer = null)
    {
        var v = viewer ?? Current;
        return !Enabled || v.SeeAll
            ? source
            : VisibilityPredicates.WhereIn(source, taskId, VisibleTasks(v).Select(t => t.TaskId));
    }

    public Task<bool> CanSeeMatterAsync(int matterId, CancellationToken cancellationToken = default) =>
        VisibleMatters().AnyAsync(m => m.MatterId == matterId, cancellationToken);

    public Task<bool> CanSeeTaskAsync(long taskId, CancellationToken cancellationToken = default) =>
        VisibleTasks().AnyAsync(t => t.TaskId == taskId, cancellationToken);

    public Error NotFound() => Hidden;

    private static Expression<Func<TaskAccessRow, bool>> Or(Expression<Func<TaskAccessRow, bool>> left, Expression<Func<TaskAccessRow, bool>> right)
    {
        var parameter = left.Parameters[0];
        var rightBody = new ReplaceParameter(right.Parameters[0], parameter).Visit(right.Body)!;
        return Expression.Lambda<Func<TaskAccessRow, bool>>(Expression.OrElse(left.Body, rightBody), parameter);
    }

    private sealed class ReplaceParameter(ParameterExpression from, ParameterExpression to) : ExpressionVisitor
    {
        protected override Expression VisitParameter(ParameterExpression node) => node == from ? to : base.VisitParameter(node);
    }
}
