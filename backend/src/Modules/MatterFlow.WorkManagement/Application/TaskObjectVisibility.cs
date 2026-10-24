using MatterFlow.Identity.Contracts;
using MatterFlow.Notifications.Contracts;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkManagement.Application;

/// <summary>
/// Which Tasks the caller may view, for the notification reads (permission re-check): <c>Task.View</c> and the sensitive-matter task rule (epic #788, mode T),
/// the same set the Task endpoints use, so a notification disappears from the list and the unread count the moment the caller loses access to its task.
/// </summary>
internal sealed class TaskObjectVisibility(TaskAccess access, IPermissionChecker permissions) : IObjectVisibility
{
    public string ObjectKind => NotificationObjectKinds.Task;

    public IQueryable<long>? VisibleObjectIds() =>
        permissions.Has(Permissions.Task.View) ? access.Visible().Select(t => t.Id) : null;
}
