using System.Linq.Expressions;
using System.Security.Cryptography;
using System.Text;
using LptHub.Identity.Contracts;
using LptHub.Identity.Domain;
using LptHub.SharedKernel.Identity;
using LptHub.SharedKernel.Results;
using LptHub.SharedKernel.Visibility;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace LptHub.Identity.Access;

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
    IOptions<SensitiveMatterAccessOptions> options,
    ITaskTypeAccessSource taskTypes,
    IActiveRoleSource roles,
    IOptions<TaskTypeAccessOptions> typeOptions) : IMatterVisibility
{
    private static readonly Error Hidden = Error.NotFound("The resource was not found.");

    // The sensitive matters the caller manages, loaded once at the start of the request (PrepareAsync) so that set-wide readers can write the rule as an id list instead of a
    // subquery (issue #810). Dropped as soon as the request saves anything, so a read after a write falls back to the subquery form and never sees a stale list.
    private int[]? _managed;
    private int? _managedFor;

    private string? _stamp;
    private bool _subscribed;

    // The task types the caller may not see (Task Type access rule, README section 4.2), loaded once at the start of the request next to the managed matters. Dropped on every save, like _managed.
    private int[]? _hidden;
    private int? _hiddenFor;

    public bool Enabled => options.Value.SensitiveMatterAccess;

    public bool TaskTypeAccessEnabled => typeOptions.Value.TaskTypeAccess;

    public bool TaskTypeRuleApplies => TypeRuleApplies(Current);

    public bool TaskRulesEnabled => Enabled || TaskTypeAccessEnabled;

    /// <summary>True when the sensitive-matter term applies to this viewer.</summary>
    private bool MatterRuleApplies(Viewer v) => Enabled && !v.SeeAll;

    /// <summary>True when the Task Type term applies to this viewer (the switch is on and the viewer is not the System Admin).</summary>
    private bool TypeRuleApplies(Viewer v) => TaskTypeAccessEnabled && !v.IsSystemAdmin;

    /// <summary>
    /// Loads, for a caller who is neither see-all nor anonymous, the sensitive matters they manage (a few ids from a filtered index), and with <paramref name="withStamp"/> the
    /// <see cref="AccessStampAsync"/> in the same statement; with the Task Type switch on it also loads the task types the caller may not see (one more small indexed statement; none while the
    /// switch is off or for the System Admin). Called once per request by <see cref="ViewerPreparationFilter"/>; the rule gives the same answer without it, only a
    /// little slower on large task sets.
    /// </summary>
    public async Task PrepareAsync(bool withStamp, CancellationToken cancellationToken = default)
    {
        await PrepareMattersAsync(withStamp, cancellationToken);
        await PrepareTypesAsync(cancellationToken);
    }

    private void Subscribe()
    {
        if (_subscribed)
            return;

        db.SavedChanges += (_, _) =>
        {
            _managed = null;
            _stamp = null;
            _hidden = null;
        };
        _subscribed = true;
    }

    private async Task PrepareTypesAsync(CancellationToken cancellationToken)
    {
        var viewer = Current;
        if (!TypeRuleApplies(viewer) || viewer.UserId is not { } user || (_hidden is not null && _hiddenFor == user))
            return;

        var ids = await ReadHiddenAsync(viewer, cancellationToken);
        Subscribe();
        _hidden = [.. ids.Order()];
        _hiddenFor = user;
    }

    private async Task PrepareMattersAsync(bool withStamp, CancellationToken cancellationToken)
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

        Subscribe();
        _managed = ids;
        _managedFor = user;
        _stamp = stamp ?? _stamp;
    }

    public async Task<string> AccessStampAsync(CancellationToken cancellationToken = default)
    {
        var viewer = Current;
        string matterPart;
        if (!Enabled)
            matterPart = "off";
        else if (viewer.SeeAll)
            matterPart = "all";
        else if (viewer.UserId is null)
            matterPart = "none";
        else
        {
            if (_stamp is null || _managed is null)
                await PrepareMattersAsync(true, cancellationToken);

            matterPart = _stamp ?? "none";
        }

        // The hidden task types are part of the key (README section 10): with the switch on and nothing restricted the list is empty and the key is exactly today's.
        var hidden = await HiddenTaskTypeIdsAsync(cancellationToken);
        return hidden.Count == 0
            ? matterPart
            : matterPart + ".t" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join(',', hidden.Order()))))[..16];
    }

    public async Task<IReadOnlyList<int>> HiddenTaskTypeIdsAsync(CancellationToken cancellationToken = default)
    {
        var viewer = Current;
        if (!TypeRuleApplies(viewer))
            return [];

        if (HiddenFor(viewer) is { } loaded)
            return loaded;

        return await ReadHiddenAsync(viewer, cancellationToken);
    }

    /// <summary>
    /// The restricted task types none of whose Can View roles the viewer holds (active roles only; a viewer without a person holds none, so every restricted type is hidden). Written as one
    /// query over the access rows and the viewer's roles: the list read once per request, or the subquery of the predicates when the list was not loaded.
    /// </summary>
    private IQueryable<int> HiddenTypes(Viewer viewer)
    {
        var restricted = taskTypes.Types().Where(t => t.IsRestricted);
        if (viewer.UserId is not { } user)
            return restricted.Select(t => t.TaskTypeId);

        var viewRoles = taskTypes.ViewRoles();
        var userRoles = roles.RoleIdsOf(user);
        return restricted
            .Where(t => !viewRoles.Any(a => a.TaskTypeId == t.TaskTypeId && userRoles.Contains(a.RoleId)))
            .Select(t => t.TaskTypeId);
    }

    // A database query is read asynchronously; the unit tests feed in-memory rows, which are read synchronously.
    private async Task<int[]> ReadHiddenAsync(Viewer viewer, CancellationToken cancellationToken)
    {
        var query = HiddenTypes(viewer);
        return query is IAsyncEnumerable<int> ? await query.ToArrayAsync(cancellationToken) : [.. query];
    }

    /// <summary>
    /// The restricted types with a non-empty Can Edit list that holds none of the viewer's active roles (README section 1.2: <c>TypeEditable</c> fails for them). A viewer without a person holds no role, so every
    /// type with an Edit list is read-only for them; a type with an empty Edit list is "no extra limit" and is not here.
    /// </summary>
    private IQueryable<int> ReadOnlyTypes(Viewer viewer)
    {
        var restricted = taskTypes.Types().Where(t => t.IsRestricted);
        var editRows = taskTypes.Roles().Where(a => a.CanEdit);
        if (viewer.UserId is not { } user)
            return restricted.Where(t => editRows.Any(a => a.TaskTypeId == t.TaskTypeId)).Select(t => t.TaskTypeId);

        var userRoles = roles.RoleIdsOf(user);
        return restricted
            .Where(t => editRows.Any(a => a.TaskTypeId == t.TaskTypeId) && !editRows.Any(a => a.TaskTypeId == t.TaskTypeId && userRoles.Contains(a.RoleId)))
            .Select(t => t.TaskTypeId);
    }

    private static async Task<bool> AnyAsync(IQueryable<int> query, CancellationToken cancellationToken) =>
        query is IAsyncEnumerable<int> ? await query.AnyAsync(cancellationToken) : query.Any();

    public async Task<bool> CanEditTaskTypeAsync(int taskTypeId, CancellationToken cancellationToken = default)
    {
        var viewer = Current;
        if (!TypeRuleApplies(viewer))
            return true;

        // Hidden types are "not found" before anything else (the prepared list when this request has one, else one indexed statement).
        if (HiddenFor(viewer) is { } hidden ? hidden.Contains(taskTypeId) : await AnyAsync(HiddenTypes(viewer).Where(id => id == taskTypeId), cancellationToken))
            return false;

        return !await AnyAsync(ReadOnlyTypes(viewer).Where(id => id == taskTypeId), cancellationToken);
    }

    public async Task<IReadOnlyList<int>> NotEditableTaskTypeIdsAsync(CancellationToken cancellationToken = default)
    {
        var viewer = Current;
        if (!TypeRuleApplies(viewer))
            return [];

        var hidden = await HiddenTaskTypeIdsAsync(cancellationToken);
        var query = ReadOnlyTypes(viewer);
        var readOnly = query is IAsyncEnumerable<int> ? await query.ToArrayAsync(cancellationToken) : [.. query];
        return [.. hidden.Concat(readOnly).Distinct().Order()];
    }

    public async Task<IQueryable<int>?> AssignableUserIdsAsync(int taskTypeId, CancellationToken cancellationToken = default)
    {
        if (!TaskTypeAccessEnabled)
            return null;

        var restricted = taskTypes.Types().Where(t => t.TaskTypeId == taskTypeId && t.IsRestricted).Select(t => t.TaskTypeId);
        if (!await AnyAsync(restricted, cancellationToken))
            return null;

        var rowsQuery = taskTypes.Roles().Where(a => a.TaskTypeId == taskTypeId);
        var rows = rowsQuery is IAsyncEnumerable<TaskTypeRoleRow> ? await rowsQuery.ToArrayAsync(cancellationToken) : [.. rowsQuery];
        var assign = rows.Where(r => r.CanAssign).Select(r => r.RoleId).ToArray();
        var view = rows.Where(r => r.CanView).Select(r => r.RoleId).ToArray();
        var holders = roles.ActiveUserRoles();
        // A non-empty Can Be Assigned list is the whole answer (no admin exception); an empty one means "no extra limit": whoever may see the type, the System Admin included.
        return assign.Length > 0
            ? holders.Where(r => assign.Contains(r.RoleId)).Select(r => r.UserId)
            : holders.Where(r => r.IsSystemAdmin || view.Contains(r.RoleId)).Select(r => r.UserId);
    }

    public async Task<bool> CanBeAssignedAsync(int userId, int taskTypeId, CancellationToken cancellationToken = default)
    {
        var allowed = await AssignableUserIdsAsync(taskTypeId, cancellationToken);
        return allowed is null || await AnyAsync(allowed.Where(id => id == userId), cancellationToken);
    }

    /// <summary>The loaded hidden-type list for this viewer, or null when it was not loaded (another person, a write happened, no filter ran): the subquery form is used then.</summary>
    private int[]? HiddenFor(Viewer viewer) => _hidden is not null && viewer.UserId is { } user && _hiddenFor == user && currentUser.UserId == user ? _hidden : null;

    private Expression<Func<T, bool>>? TypeTerm<T>(Expression<Func<T, int>> taskTypeId, Viewer viewer) =>
        TypeRuleApplies(viewer) ? VisibilityPredicates.TypeNotHidden(taskTypeId, HiddenFor(viewer), HiddenTypes(viewer)) : null;

    private IQueryable<T> WhereType<T>(IQueryable<T> source, Expression<Func<T, int>> taskTypeId, Viewer viewer) =>
        TypeTerm(taskTypeId, viewer) is { } term ? source.Where(term) : source;

    private sealed class StampPart
    {
        public int Kind { get; init; }

        public long Id { get; init; }
    }

    /// <summary>The prepared list for this viewer, or null when it was not loaded (another person, a write happened, no filter ran).</summary>
    private int[]? ManagedFor(Viewer viewer) => _managed is not null && viewer.UserId is { } user && _managedFor == user && currentUser.UserId == user ? _managed : null;

    public Viewer Current =>
        currentUser.UserId is { } user ? new Viewer(user, permissions.Has(Permissions.Matter.ViewSensitive), currentUser.IsSystemAdmin) : Viewer.Nobody;

    public async Task<Viewer> ForAsync(int userId, CancellationToken cancellationToken = default)
    {
        if (currentUser.UserId == userId)
            return Current;

        var seeAll = await db.Set<AppUser>().AsNoTracking()
            .Where(u => u.Id == userId && u.IsActive)
            .AnyAsync(u => u.Roles.Any(ur => ur.Role.IsActive
                && (ur.Role.IsSystemAdmin
                    || ur.Role.Permissions.Any(rp => rp.Permission.IsActive && rp.Permission.Code == Permissions.Matter.ViewSensitive))), cancellationToken);
        // The System Admin flag matters for the Task Type rule only: read it only while that switch is on (no extra statement otherwise).
        var isAdmin = TaskTypeAccessEnabled
            && await db.Set<AppUser>().AsNoTracking().Where(u => u.Id == userId && u.IsActive).AnyAsync(u => u.Roles.Any(ur => ur.Role.IsActive && ur.Role.IsSystemAdmin), cancellationToken);
        return new Viewer(userId, seeAll, isAdmin);
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
        if (MatterRuleApplies(v))
        {
            var visibleMatters = VisibleMatters(v).Select(m => m.MatterId);
            var assigned = VisibilityPredicates.AssignedToViewer(v);
            rows = rows.Where(Or(t => visibleMatters.Contains(t.MatterId), assigned));
        }

        return WhereType(rows, t => t.TaskTypeId, v);
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
        return !MatterRuleApplies(v) && !TypeRuleApplies(v)
            ? source
            : VisibilityPredicates.WhereIn(source, taskId, VisibleTasks(v).Select(t => t.TaskId));
    }

    public IQueryable<T> WhereTaskVisibleBy<T>(IQueryable<T> source, Expression<Func<T, int>> matterId, Expression<Func<T, int?>> assignedUserId, Expression<Func<T, int>> taskTypeId, Viewer? viewer = null)
    {
        var v = viewer ?? Current;
        var rows = MatterRuleApplies(v)
            ? VisibilityPredicates.WhereMatterOrAssigned(source, matterId, assignedUserId, VisibleMatters(v).Select(m => m.MatterId), v)
            : source;
        return WhereType(rows, taskTypeId, v);
    }

    public IQueryable<T> WhereTaskFlagVisible<T>(
        IQueryable<T> source,
        Expression<Func<T, int>> matterId,
        Expression<Func<T, bool>> isMatterSensitive,
        Expression<Func<T, int?>> assignedUserId,
        Expression<Func<T, int>> taskTypeId,
        Viewer? viewer = null)
    {
        var v = viewer ?? Current;
        var rows = source;
        if (MatterRuleApplies(v))
        {
            var managedQuery = VisibleMatters(v).Where(m => m.IsSensitive).Select(m => m.MatterId);
            rows = rows.Where(VisibilityPredicates.TaskFlag(v, matterId, isMatterSensitive, assignedUserId, ManagedFor(v), managedQuery));
        }

        return WhereType(rows, taskTypeId, v);
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
        Expression<Func<T, int>> taskTypeId,
        Viewer? viewer = null)
    {
        var v = viewer ?? Current;
        var rows = MatterRuleApplies(v) ? source.Where(VisibilityPredicates.TaskRow(v, isSensitive, primaryManagerId, secondaryManagerId, assignedUserId)) : source;
        return WhereType(rows, taskTypeId, v);
    }

    public IQueryable<T> WhereTaskEventVisible<T>(IQueryable<T> source, Expression<Func<T, long?>> taskId, Viewer? viewer = null)
    {
        var v = viewer ?? Current;
        if (TypeTerm<TaskAccessRow>(r => r.TaskTypeId, v) is not { } notHidden)
            return source;

        var negated = Expression.Lambda<Func<TaskAccessRow, bool>>(Expression.Not(notHidden.Body), notHidden.Parameters);
        return source.Where(VisibilityPredicates.TaskNotHidden(taskId, tasks.Rows().Where(negated)));
    }

    public IQueryable<T> WhereTaskTypeVisible<T>(IQueryable<T> source, Expression<Func<T, int>> taskTypeId, Viewer? viewer = null) => WhereType(source, taskTypeId, viewer ?? Current);

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
