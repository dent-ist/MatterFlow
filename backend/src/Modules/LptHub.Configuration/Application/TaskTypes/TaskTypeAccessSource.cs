using LptHub.Configuration.Domain;
using LptHub.SharedKernel.Visibility;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Configuration.Application.TaskTypes;

/// <summary>
/// Every Task Type and its Can View roles, unfiltered, in the shape the Task Type access rule needs (epic #1397). Only the visibility port reads it.
/// Do NOT add <c>AsNoTracking()</c>: EF applies the option to the whole statement the rows are used in as a subquery (issue #1304, <c>VisibilitySourceRulesTests</c>).
/// </summary>
internal sealed class TaskTypeAccessSource(DbContext db) : ITaskTypeAccessSource
{
    public IQueryable<TaskTypeAccessRow> Types() =>
        db.Set<TaskType>().Select(t => new TaskTypeAccessRow { TaskTypeId = t.Id, IsRestricted = t.IsRestricted });

    public IQueryable<TaskTypeViewRoleRow> ViewRoles() =>
        db.Set<TaskTypeRoleAccess>().Where(a => a.CanView).Select(a => new TaskTypeViewRoleRow { TaskTypeId = a.TaskTypeId, RoleId = a.RoleId });
}
