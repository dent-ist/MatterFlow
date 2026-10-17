using MatterFlow.Configuration.Contracts;
using MatterFlow.Organization.Contracts;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.WorkManagement.Contracts;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkManagement.Application;

/// <summary>Read-only Task lookups for other modules (<see cref="ITaskDirectory"/>).</summary>
internal sealed class TaskDirectory(DbContext db) : ITaskDirectory, MatterFlow.Identity.Contracts.IUserWorkSource
{
    public Task<bool> HasOpenAssignedWorkAsync(int userId, CancellationToken cancellationToken = default) =>
        db.Set<WorkTask>().AsNoTracking().AnyAsync(
            t => t.AssignedUserId == userId && (t.Status == TaskStatusCode.New || t.Status == TaskStatusCode.InProgress || t.Status == TaskStatusCode.OnHold),
            cancellationToken);


    public async Task<TaskSummary?> FindAsync(long taskId, CancellationToken cancellationToken = default) =>
        (await db.Set<WorkTask>().AsNoTracking().Where(t => t.Id == taskId).ToListAsync(cancellationToken)).Select(ToSummary).SingleOrDefault();

    public async Task<IReadOnlyList<TaskSummary>> FindManyAsync(IReadOnlyCollection<long> taskIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(taskIds);
        if (taskIds.Count == 0)
            return [];

        var ids = taskIds.Distinct().ToList();
        return [.. (await db.Set<WorkTask>().AsNoTracking().Where(t => ids.Contains(t.Id)).ToListAsync(cancellationToken)).Select(ToSummary)];
    }

    public async Task<TaskSummary?> FindByNumberAsync(string taskNumber, CancellationToken cancellationToken = default)
    {
        if (!TaskNumber.TryParse(taskNumber, out var sequence))
            return null;

        var number = TaskNumber.Format(sequence);
        return (await db.Set<WorkTask>().AsNoTracking().Where(t => t.Number == number).ToListAsync(cancellationToken)).Select(ToSummary).SingleOrDefault();
    }

    public async Task<IReadOnlyList<TaskSummary>> ListForMatterAsync(int matterId, bool includeClosed = true, int limit = 200, CancellationToken cancellationToken = default)
    {
        var rows = db.Set<WorkTask>().AsNoTracking().Where(t => t.MatterId == matterId);
        if (!includeClosed)
            rows = rows.Where(t => t.Status == TaskStatusCode.New || t.Status == TaskStatusCode.InProgress || t.Status == TaskStatusCode.OnHold);

        var tasks = await rows.OrderByDescending(t => t.CreatedAtUtc).ThenByDescending(t => t.Id).Take(Math.Clamp(limit, 1, 1000)).ToListAsync(cancellationToken);
        return [.. tasks.Select(ToSummary)];
    }

    public async Task<IReadOnlyDictionary<TaskStatusCode, int>> CountByStatusAsync(int matterId, CancellationToken cancellationToken = default)
    {
        var counts = await db.Set<WorkTask>().AsNoTracking()
            .Where(t => t.MatterId == matterId)
            .GroupBy(t => t.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        return counts.ToDictionary(c => c.Status, c => c.Count);
    }

    private static TaskSummary ToSummary(WorkTask t) =>
        new(
            t.Id,
            t.Number,
            t.MatterId,
            t.ProjectId,
            t.TaskTypeId,
            t.Title,
            t.Status,
            t.PriorityId,
            t.AssignedPodId,
            t.AssignedUserId,
            t.DueDate,
            TaskSupport.Utc(t.DueAtUtc),
            t.WorkflowInstanceId,
            TaskSupport.Utc(t.CreatedAtUtc));
}

/// <summary>
/// The real <see cref="IMatterTaskGuard"/>: counts the Matter's Tasks that are NEW, IN_PROGRESS or ON_HOLD. Replaces the Organization module's
/// default (which reports no open Tasks) so a Matter with open work cannot be deactivated (addendum B).
/// </summary>
internal sealed class MatterTaskGuard(DbContext db) : IMatterTaskGuard
{
    public Task<int> CountOpenTasksAsync(int matterId, CancellationToken cancellationToken = default) =>
        db.Set<WorkTask>().AsNoTracking()
            .CountAsync(t => t.MatterId == matterId && (t.Status == TaskStatusCode.New || t.Status == TaskStatusCode.InProgress || t.Status == TaskStatusCode.OnHold), cancellationToken);
}

/// <summary>Tells the Configuration module which Priorities Tasks reference, so those can only be deactivated, never deleted.</summary>
internal sealed class TaskPriorityUsage(DbContext db) : IPriorityUsage
{
    public Task<bool> IsInUseAsync(int priorityId, CancellationToken cancellationToken = default) =>
        db.Set<WorkTask>().AsNoTracking().AnyAsync(t => t.PriorityId == priorityId, cancellationToken);
}
