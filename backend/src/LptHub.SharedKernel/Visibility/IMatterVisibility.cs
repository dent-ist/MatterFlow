using System.Linq.Expressions;
using LptHub.SharedKernel.Results;

namespace LptHub.SharedKernel.Visibility;

/// <summary>
/// The one port every read path and every command uses to apply the sensitive-matter rule (epic #788, README section 4; for the "matters managed
/// by me" scope see <c>IManagedMatterScope</c>). Implemented once (Identity module, scoped). While the go-live switch
/// (<see cref="SensitiveMatterAccessOptions"/>) is off, every method behaves as if the rule did not exist.
/// </summary>
public interface IMatterVisibility
{
    /// <summary>True when the rule is enforced (<c>Features:SensitiveMatterAccess</c>).</summary>
    bool Enabled { get; }

    /// <summary>True when the Task Type access rule is enforced (<c>Features:TaskTypeAccess</c>, epic #1397). Independent of <see cref="Enabled"/>: each rule has its own switch.</summary>
    bool TaskTypeAccessEnabled { get; }

    /// <summary>True when any rule that hides tasks is on (<see cref="Enabled"/> or <see cref="TaskTypeAccessEnabled"/>): the guard for "skip the task check entirely".</summary>
    bool TaskRulesEnabled => Enabled || TaskTypeAccessEnabled;

    /// <summary>True when the Task Type term applies to the caller of this request: the switch is on and the caller is not the System Admin. Guards extra work that is pointless otherwise.</summary>
    bool TaskTypeRuleApplies { get; }

    /// <summary>The caller of this request: person and see-all flag, from the current permissions (a role change is effective on the next request).</summary>
    Viewer Current { get; }

    /// <summary>
    /// The viewer for another person (background jobs, notification recipients), resolved from that person's current role grants without any cache.
    /// An inactive or unknown user sees non-sensitive matters only. A job never runs as "see all".
    /// </summary>
    Task<Viewer> ForAsync(int userId, CancellationToken cancellationToken = default);

    /// <summary>The matters the viewer may see (all matters while the rule is off). Mode M.</summary>
    IQueryable<MatterAccessRow> VisibleMatters(Viewer? viewer = null);

    /// <summary>
    /// The tasks the viewer may see: (those of a visible matter, plus those currently assigned to the viewer) AND whose type the viewer may see (Task Type access rule: a restricted type whose Can View
    /// roles the viewer holds none of hides its tasks, even from the assignee; the System Admin is exempt). All tasks while both rules are off. Mode T.
    /// </summary>
    IQueryable<TaskAccessRow> VisibleTasks(Viewer? viewer = null);

    /// <summary>Keeps the rows whose matter the viewer may see. A no-op while the rule is off or for a see-all viewer. Mode M.</summary>
    IQueryable<T> WhereMatterVisible<T>(IQueryable<T> source, Expression<Func<T, int>> matterId, Viewer? viewer = null);

    /// <summary>Keeps the rows whose task the viewer may see (matter rule or assigned to the viewer). A no-op while the rule is off. Mode T.</summary>
    IQueryable<T> WhereTaskVisible<T>(IQueryable<T> source, Expression<Func<T, long>> taskId, Viewer? viewer = null);

    /// <summary>
    /// Mode T for set-wide readers over rows that carry a matter id and the task's assignee: the matter rule OR assigned to the viewer, written as the LEFT JOIN form
    /// (never <c>EXISTS ... OR assignee</c>, which costs about 38,500 reads at 24,000 tasks). A no-op while the rule is off or for a see-all viewer.
    /// </summary>
    IQueryable<T> WhereTaskVisibleBy<T>(IQueryable<T> source, Expression<Func<T, int>> matterId, Expression<Func<T, int?>> assignedUserId, Expression<Func<T, int>> taskTypeId, Viewer? viewer = null);

    /// <summary>
    /// Mode T for set-wide readers over rows that carry the task's own copy of the matter's sensitivity (<c>Task.IsMatterSensitive</c>): not sensitive, OR assigned to the viewer, OR a matter the
    /// viewer manages. Every term is a test on the row, so no join to the matter table is needed and a covering index answers it (issue #810); same result as <see cref="WhereTaskVisibleBy{T}"/>.
    /// A no-op while both rules are off; the Task Type term (<paramref name="taskTypeId"/>) is applied on top whenever <see cref="TaskTypeAccessEnabled"/> and the viewer is not the System Admin.
    /// </summary>
    IQueryable<T> WhereTaskFlagVisible<T>(
        IQueryable<T> source,
        Expression<Func<T, int>> matterId,
        Expression<Func<T, bool>> isMatterSensitive,
        Expression<Func<T, int?>> assignedUserId,
        Expression<Func<T, int>> taskTypeId,
        Viewer? viewer = null);

    /// <summary>
    /// The matter rule OR an extra predicate that depends on the viewer's user id (for example "the asset is linked to a task assigned to the viewer", mode A), over rows
    /// that carry only a matter id: the LEFT JOIN form. <paramref name="alsoVisible"/> is only called for a viewer with a person. A no-op while the rule is off or for a see-all viewer.
    /// </summary>
    IQueryable<T> WhereMatterVisibleOr<T>(IQueryable<T> source, Expression<Func<T, int>> matterId, Func<int, Expression<Func<T, bool>>> alsoVisible, Viewer? viewer = null);

    /// <summary>The same for rows that already carry the matter's columns (no extra join): the matter rule OR the extra predicate. A no-op while the rule is off or for a see-all viewer.</summary>
    IQueryable<T> WhereMatterRowVisibleOr<T>(
        IQueryable<T> source,
        Expression<Func<T, bool>> isSensitive,
        Expression<Func<T, int?>> primaryManagerId,
        Expression<Func<T, int?>> secondaryManagerId,
        Func<int, Expression<Func<T, bool>>> alsoVisible,
        Viewer? viewer = null);

    /// <summary>
    /// Keeps the rows whose matter the viewer may see, for rows that already carry the matter's columns (the Matter entity itself, or a join that has the
    /// matter): no extra join. A no-op while the rule is off or for a see-all viewer. Mode M.
    /// </summary>
    IQueryable<T> WhereMatterRowVisible<T>(
        IQueryable<T> source,
        Expression<Func<T, bool>> isSensitive,
        Expression<Func<T, int?>> primaryManagerId,
        Expression<Func<T, int?>> secondaryManagerId,
        Viewer? viewer = null);

    /// <summary>The same for rows that also carry the task's assignee: the matter rule OR currently assigned to the viewer, AND the Task Type rule over <paramref name="taskTypeId"/>. Mode T.</summary>
    IQueryable<T> WhereTaskRowVisible<T>(
        IQueryable<T> source,
        Expression<Func<T, bool>> isSensitive,
        Expression<Func<T, int?>> primaryManagerId,
        Expression<Func<T, int?>> secondaryManagerId,
        Expression<Func<T, int?>> assignedUserId,
        Expression<Func<T, int>> taskTypeId,
        Viewer? viewer = null);

    /// <summary>
    /// ONLY the Task Type term of the rule, for task rows whose matter is already known to be visible (the matter's own task list, a project's tasks, My Matters, whose matters were narrowed by mode M): a
    /// restricted type the viewer holds no Can View role of hides its tasks even inside a visible matter, and from the project manager and the assignee alike. A no-op while the Task Type switch is off
    /// or for the System Admin.
    /// </summary>
    IQueryable<T> WhereTaskTypeVisible<T>(IQueryable<T> source, Expression<Func<T, int>> taskTypeId, Viewer? viewer = null);

    /// <summary>
    /// For rows that point at a task by id without carrying its columns (audit events, activity): hides the rows whose task is of a type the viewer may not see (the task's CURRENT type; a type cannot change on a task).
    /// Rows without a task id are unchanged. Only the Task Type term: the matter side of audit stays with the audit module's own sensitive-scope rule. A no-op while the switch is off or for the System Admin.
    /// </summary>
    IQueryable<T> WhereTaskEventVisible<T>(IQueryable<T> source, Expression<Func<T, long?>> taskId, Viewer? viewer = null);

    /// <summary>True when the matter exists and the caller may see it. For single-record gates and for ids that come from a client.</summary>
    Task<bool> CanSeeMatterAsync(int matterId, CancellationToken cancellationToken = default);

    /// <summary>True when the task exists and the caller may see it.</summary>
    Task<bool> CanSeeTaskAsync(long taskId, CancellationToken cancellationToken = default);

    /// <summary>
    /// The task types the caller may not see (restricted, and none of the caller's active roles is in Can View): empty while the Task Type rule is off, for the System Admin and when no type is
    /// restricted. Used for the one rule that cannot go through a task row (audit events, which carry a task id only).
    /// </summary>
    Task<IReadOnlyList<int>> HiddenTaskTypeIdsAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// True when the caller may change tasks of this type and create tasks of it (Task Type access rule, issue #1401, README section 1.2): the switch is off, the caller is the System Admin, the
    /// type is open, or the caller may view it and the type's Can Edit list is empty or holds one of the caller's active roles. False for a type the caller may not see. Reads the database
    /// (a role change is effective on the next request); single-record gate for commands.
    /// </summary>
    Task<bool> CanEditTaskTypeAsync(int taskTypeId, CancellationToken cancellationToken = default);

    /// <summary>
    /// The restricted task types the caller may NOT edit (neither hidden nor editable: a non-empty Can Edit list that holds none of the caller's active roles, plus every hidden type): empty while the
    /// rule is off or for the System Admin. The Create Task type list is "viewable and not in here".
    /// </summary>
    Task<IReadOnlyList<int>> NotEditableTaskTypeIdsAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// The people who may be assigned tasks of this type (<c>TypeAssignable</c>, README section 1.2) as a query of user ids, or null when everybody may (the switch is off, the type is open). On a
    /// restricted type: the holders of a role in Can Be Assigned; when that list is empty, the people who may see the type (the System Admin among them: no admin exception for a non-empty list).
    /// The other assignee checks (active, holds <c>Workflow.Execute</c>) stay with the caller.
    /// </summary>
    Task<IQueryable<int>?> AssignableUserIdsAsync(int taskTypeId, CancellationToken cancellationToken = default);

    /// <summary>True when <paramref name="userId"/> may be assigned tasks of this type (see <see cref="AssignableUserIdsAsync"/>).</summary>
    Task<bool> CanBeAssignedAsync(int userId, int taskTypeId, CancellationToken cancellationToken = default);

    /// <summary>
    /// A short key that changes whenever what the caller may see changes (a matter marked or un-marked, a manager added or removed, a sensitive-matter task assigned to or away
    /// from the caller, the see-all permission, the set of hidden task types): <c>off</c> while both rules are off, <c>all</c> for a see-all caller who is not subject to the type rule. Part of every cache key that holds viewer-dependent numbers
    /// (README section 10). One indexed statement, shared with the request's preparation (<see cref="PreparesViewerAttribute"/>).
    /// </summary>
    Task<string> AccessStampAsync(CancellationToken cancellationToken = default);

    /// <summary>The 404 for a hidden record: identical to the one for a record that does not exist (README section 5).</summary>
    Error NotFound();
}
