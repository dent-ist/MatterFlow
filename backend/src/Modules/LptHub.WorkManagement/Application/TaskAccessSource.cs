using LptHub.SharedKernel.Visibility;
using LptHub.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace LptHub.WorkManagement.Application;

/// <summary>
/// Every task, unfiltered, in the shape the visibility rule needs. Only the visibility port reads it (epic #788).
/// Do NOT add <c>AsNoTracking()</c> here: the rows are a projection and are never tracked anyway, but EF applies the option to the whole statement the rows are used in as a subquery, so every
/// entity a caller loads through the visibility filter would be untracked and <c>SaveChanges</c> would silently save nothing (issue #1304; <c>VisibilitySourceRulesTests</c> guards this).
/// </summary>
internal sealed class TaskAccessSource(DbContext db) : ITaskAccessSource
{
    public IQueryable<TaskAccessRow> Rows() =>
        db.Set<WorkTask>().Select(t => new TaskAccessRow
        {
            TaskId = t.Id,
            MatterId = t.MatterId,
            AssignedUserId = t.AssignedUserId,
            IsMatterSensitive = t.IsMatterSensitive,
        });
}
