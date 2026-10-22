using MatterFlow.Identity.Contracts;
using MatterFlow.Notifications.Contracts;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkManagement.Application;

/// <summary>
/// Which Tasks the caller may view, for the notification reads (permission re-check). The rule is the one the Task endpoints use: the
/// <c>Task.View</c> permission (there is no per-Task scoping), so a caller without it sees none and a caller with it sees every Task.
/// </summary>
internal sealed class TaskObjectVisibility(DbContext db, IPermissionChecker permissions) : IObjectVisibility
{
    public string ObjectKind => NotificationObjectKinds.Task;

    public IQueryable<long>? VisibleObjectIds() =>
        permissions.Has(Permissions.Task.View) ? db.Set<WorkTask>().AsNoTracking().Select(t => t.Id) : null;
}
