using System.Linq.Expressions;
using MatterFlow.SharedKernel.Results;

namespace MatterFlow.SharedKernel.Visibility;

/// <summary>
/// The one port every read path and every command uses to apply the sensitive-matter rule (epic #788, README section 4; for the "matters managed
/// by me" scope see <c>IManagedMatterScope</c>). Implemented once (Identity module, scoped). While the go-live switch
/// (<see cref="SensitiveMatterAccessOptions"/>) is off, every method behaves as if the rule did not exist.
/// </summary>
public interface IMatterVisibility
{
    /// <summary>True when the rule is enforced (<c>Features:SensitiveMatterAccess</c>).</summary>
    bool Enabled { get; }

    /// <summary>The caller of this request: person and see-all flag, from the current permissions (a role change is effective on the next request).</summary>
    Viewer Current { get; }

    /// <summary>
    /// The viewer for another person (background jobs, notification recipients), resolved from that person's current role grants without any cache.
    /// An inactive or unknown user sees non-sensitive matters only. A job never runs as "see all".
    /// </summary>
    Task<Viewer> ForAsync(int userId, CancellationToken cancellationToken = default);

    /// <summary>The matters the viewer may see (all matters while the rule is off). Mode M.</summary>
    IQueryable<MatterAccessRow> VisibleMatters(Viewer? viewer = null);

    /// <summary>The tasks the viewer may see: those of a visible matter, plus those currently assigned to the viewer (all tasks while the rule is off). Mode T.</summary>
    IQueryable<TaskAccessRow> VisibleTasks(Viewer? viewer = null);

    /// <summary>Keeps the rows whose matter the viewer may see. A no-op while the rule is off or for a see-all viewer. Mode M.</summary>
    IQueryable<T> WhereMatterVisible<T>(IQueryable<T> source, Expression<Func<T, int>> matterId, Viewer? viewer = null);

    /// <summary>Keeps the rows whose task the viewer may see (matter rule or assigned to the viewer). A no-op while the rule is off. Mode T.</summary>
    IQueryable<T> WhereTaskVisible<T>(IQueryable<T> source, Expression<Func<T, long>> taskId, Viewer? viewer = null);

    /// <summary>
    /// Mode T for set-wide readers over rows that carry a matter id and the task's assignee: the matter rule OR assigned to the viewer, written as the LEFT JOIN form
    /// (never <c>EXISTS ... OR assignee</c>, which costs about 38,500 reads at 24,000 tasks). A no-op while the rule is off or for a see-all viewer.
    /// </summary>
    IQueryable<T> WhereTaskVisibleBy<T>(IQueryable<T> source, Expression<Func<T, int>> matterId, Expression<Func<T, int?>> assignedUserId, Viewer? viewer = null);

    /// <summary>
    /// Mode T for set-wide readers over rows that carry the task's own copy of the matter's sensitivity (<c>Task.IsMatterSensitive</c>): not sensitive, OR assigned to the viewer, OR a matter the
    /// viewer manages. Every term is a test on the row, so no join to the matter table is needed and a covering index answers it (issue #810); same result as <see cref="WhereTaskVisibleBy{T}"/>.
    /// A no-op while the rule is off or for a see-all viewer.
    /// </summary>
    IQueryable<T> WhereTaskFlagVisible<T>(
        IQueryable<T> source,
        Expression<Func<T, int>> matterId,
        Expression<Func<T, bool>> isMatterSensitive,
        Expression<Func<T, int?>> assignedUserId,
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

    /// <summary>The same for rows that also carry the task's assignee: the matter rule OR currently assigned to the viewer. Mode T.</summary>
    IQueryable<T> WhereTaskRowVisible<T>(
        IQueryable<T> source,
        Expression<Func<T, bool>> isSensitive,
        Expression<Func<T, int?>> primaryManagerId,
        Expression<Func<T, int?>> secondaryManagerId,
        Expression<Func<T, int?>> assignedUserId,
        Viewer? viewer = null);

    /// <summary>True when the matter exists and the caller may see it. For single-record gates and for ids that come from a client.</summary>
    Task<bool> CanSeeMatterAsync(int matterId, CancellationToken cancellationToken = default);

    /// <summary>True when the task exists and the caller may see it.</summary>
    Task<bool> CanSeeTaskAsync(long taskId, CancellationToken cancellationToken = default);

    /// <summary>
    /// A short key that changes whenever what the caller may see changes (a matter marked or un-marked, a manager added or removed, a sensitive-matter task assigned to or away
    /// from the caller, the see-all permission): <c>off</c> while the rule is off, <c>all</c> for a see-all caller. Part of every cache key that holds viewer-dependent numbers
    /// (README section 10). One indexed statement, shared with the request's preparation (<see cref="PreparesViewerAttribute"/>).
    /// </summary>
    Task<string> AccessStampAsync(CancellationToken cancellationToken = default);

    /// <summary>The 404 for a hidden record: identical to the one for a record that does not exist (README section 5).</summary>
    Error NotFound();
}
