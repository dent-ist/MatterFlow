using MatterFlow.SharedKernel.Visibility;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkManagement.Application;

/// <summary>Every task, unfiltered, in the shape the visibility rule needs. Only the visibility port reads it (epic #788).</summary>
internal sealed class TaskAccessSource(DbContext db) : ITaskAccessSource
{
    public IQueryable<TaskAccessRow> Rows() =>
        db.Set<WorkTask>().AsNoTracking().Select(t => new TaskAccessRow
        {
            TaskId = t.Id,
            MatterId = t.MatterId,
            AssignedUserId = t.AssignedUserId,
            IsMatterSensitive = t.IsMatterSensitive,
        });
}
