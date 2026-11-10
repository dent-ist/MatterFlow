using LptHub.SharedKernel.Visibility;
using LptHub.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace LptHub.WorkViews.Application.Queries;

/// <summary>
/// The task set every WorkViews reader starts from (epic #788, mode T): the tasks of a visible matter plus those assigned to the caller, as tests on the task's own columns
/// (<c>IsMatterSensitive</c>, <c>AssignedUserId</c>, the caller's managed matters; issue #810), no join to the matter table. While the go-live switch is off it is the plain task set. Counts, tab badges, pagers,
/// quick-view numbers and member loads are all computed from this set, never from the full table minus something.
/// </summary>
internal static class VisibleTasks
{
    public static IQueryable<WorkTask> Of(DbContext db, IMatterVisibility visibility, Viewer? viewer = null) =>
        visibility.WhereTaskFlagVisible(db.Set<WorkTask>().AsNoTracking(), t => t.MatterId, t => t.IsMatterSensitive, t => t.AssignedUserId, viewer);

    /// <summary>
    /// The open Tasks of the scope that nobody is assigned to, under the sensitive-matter rule: the number behind the Summary's Unassigned card and the capacity battery's "waiting" hint
    /// (one definition: <c>TaskQueueRules.Open</c> and no assigned person; a Pod may be set).
    /// </summary>
    public static IQueryable<WorkTask> OpenUnassigned(DbContext db, IMatterVisibility visibility, DashboardScope scope, Viewer? viewer = null) =>
        scope.Apply(Of(db, visibility, viewer)).Where(TaskQueueRules.Open).Where(t => t.AssignedUserId == null);
}
