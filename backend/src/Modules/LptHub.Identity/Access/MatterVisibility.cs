using System.Linq.Expressions;
using System.Security.Cryptography;
using System.Text;
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

    // The sensitive matters the caller manages, loaded once at the start of the request (PrepareAsync) so that set-wide readers can write the rule as an id list instead of a
    // subquery (issue #810). Dropped as soon as the request saves anything, so a read after a write falls back to the subquery form and never sees a stale list.
    private int[]? _managed;
    private int? _managedFor;

    private string? _stamp;
    private bool _subscribed;

    public bool Enabled => options.Value.SensitiveMatterAccess;

    /// <summary>
    /// Loads, for a caller who is neither see-all nor anonymous, the sensitive matters they manage (a few ids from a filtered index), and with <paramref name="withStamp"/> the
    /// <see cref="AccessStampAsync"/> in the same statement. Called once per request by <see cref="ViewerPreparationFilter"/>; the rule gives the same answer without it, only a
    /// little slower on large task sets.
    /// </summary>
    public async Task PrepareAsync(bool withStamp, CancellationToken cancellationToken = default)
    {
        if (!Enabled || (_managed is not null && (!withStamp || _stamp is not null)))
            return;

        var viewer = Current;
        if (viewer.SeeAll || viewer.UserId is not { } user)
            return;

        int[] ids;
        string? stamp = null;
        if (withStamp)
        {
            // One statement (UNION ALL of three small index-only reads): the sensitive matters that exist (kind 1), the ones this person manages (kind 2) and the sensitive-matter
            // tasks assigned to them (kind 3). Nothing about other people's managers or assignments is read, so the key reveals none of it.
            var sensitive = matters.Rows().Where(m => m.IsSensitive);
            var parts = await sensitive.Select(m => new StampPart { Kind = 1, Id = m.MatterId })
                .Concat(sensitive.Where(ManagedMatterRule.Predicate<MatterAccessRow>(r => r.PrimaryManagerId, r => r.SecondaryManagerId, user, ManagerPlace.Either)).Select(m => new StampPart { Kind = 2, Id = m.MatterId }))
                .Concat(tasks.Rows().Where(t => t.AssignedUserId == user && t.IsMatterSensitive).Select(t => new StampPart { Kind = 3, Id = t.TaskId }))
                .ToListAsync(cancellationToken);
            ids = [.. parts.Where(p => p.Kind == 2).Select(p => (int)p.Id).Order()];
            string Of(int kind) => string.Join(',', parts.Where(p => p.Kind == kind).Select(p => p.Id).Order());
            stamp = "u" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{Of(1)}|{Of(2)}|{Of(3)}")))[..16];
        }
        else
            ids = await matters.Rows().Where(m => m.IsSensitive).Where(ManagedMatterRule.Predicate<MatterAccessRow>(r => r.PrimaryManagerId, r => r.SecondaryManagerId, user, ManagerPlace.Either)).Select(m => m.MatterId).ToArrayAsync(cancellationToken);

        if (!_subscribed)
        {
            db.SavedChanges += (_, _) =>
            {
                _managed = null;
                _stamp = null;
            };
            _subscribed = true;
        }

        _managed = ids;
        _managedFor = user;
        _stamp = stamp ?? _stamp;
    }

    public async Task<string> AccessStampAsync(CancellationToken cancellationToken = default)
    {
        if (!Enabled)
            return "off";

        var viewer = Current;
        if (viewer.SeeAll)
            return "all";

        if (viewer.UserId is null)
            return "none";

        if (_stamp is null || _managed is null)
            await PrepareAsync(true, cancellationToken);

        return _stamp ?? "none";
    }

    private sealed class StampPart
    {
        public int Kind { get; init; }

        public long Id { get; init; }
    }

    /// <summary>The prepared list for this viewer, or null when it was not loaded (another person, a write happened, no filter ran).</summary>
    private int[]? ManagedFor(Viewer viewer) => _managed is not null && viewer.UserId is { } user && _managedFor == user && currentUser.UserId == user ? _managed : null;

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

    public IQueryable<T> WhereTaskVisibleBy<T>(IQueryable<T> source, Expression<Func<T, int>> matterId, Expression<Func<T, int?>> assignedUserId, Viewer? viewer = null)
    {
        var v = viewer ?? Current;
        return !Enabled || v.SeeAll
            ? source
            : VisibilityPredicates.WhereMatterOrAssigned(source, matterId, assignedUserId, VisibleMatters(v).Select(m => m.MatterId), v);
    }

    public IQueryable<T> WhereTaskFlagVisible<T>(IQueryable<T> source, Expression<Func<T, int>> matterId, Expression<Func<T, bool>> isMatterSensitive, Expression<Func<T, int?>> assignedUserId, Viewer? viewer = null)
    {
        var v = viewer ?? Current;
        if (!Enabled || v.SeeAll)
            return source;

        var managedQuery = VisibleMatters(v).Where(m => m.IsSensitive).Select(m => m.MatterId);
        return source.Where(VisibilityPredicates.TaskFlag(v, matterId, isMatterSensitive, assignedUserId, ManagedFor(v), managedQuery));
    }

    public IQueryable<T> WhereMatterVisibleOr<T>(IQueryable<T> source, Expression<Func<T, int>> matterId, Func<int, Expression<Func<T, bool>>> alsoVisible, Viewer? viewer = null)
    {
        var v = viewer ?? Current;
        return !Enabled || v.SeeAll
            ? source
            : VisibilityPredicates.WhereMatterOr(source, matterId, alsoVisible, VisibleMatters(v).Select(m => m.MatterId), v);
    }

    public IQueryable<T> WhereMatterRowVisibleOr<T>(
        IQueryable<T> source,
        Expression<Func<T, bool>> isSensitive,
        Expression<Func<T, int?>> primaryManagerId,
        Expression<Func<T, int?>> secondaryManagerId,
        Func<int, Expression<Func<T, bool>>> alsoVisible,
        Viewer? viewer = null)
    {
        var v = viewer ?? Current;
        return !Enabled || v.SeeAll ? source : source.Where(VisibilityPredicates.MatterRowOr(v, isSensitive, primaryManagerId, secondaryManagerId, alsoVisible));
    }

    public IQueryable<T> WhereMatterRowVisible<T>(
        IQueryable<T> source,
        Expression<Func<T, bool>> isSensitive,
        Expression<Func<T, int?>> primaryManagerId,
        Expression<Func<T, int?>> secondaryManagerId,
        Viewer? viewer = null)
    {
        var v = viewer ?? Current;
        return !Enabled || v.SeeAll ? source : source.Where(VisibilityPredicates.MatterRow(v, isSensitive, primaryManagerId, secondaryManagerId));
    }

    public IQueryable<T> WhereTaskRowVisible<T>(
        IQueryable<T> source,
        Expression<Func<T, bool>> isSensitive,
        Expression<Func<T, int?>> primaryManagerId,
        Expression<Func<T, int?>> secondaryManagerId,
        Expression<Func<T, int?>> assignedUserId,
        Viewer? viewer = null)
    {
        var v = viewer ?? Current;
        return !Enabled || v.SeeAll ? source : source.Where(VisibilityPredicates.TaskRow(v, isSensitive, primaryManagerId, secondaryManagerId, assignedUserId));
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
