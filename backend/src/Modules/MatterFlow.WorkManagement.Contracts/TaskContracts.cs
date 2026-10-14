using MatterFlow.SharedKernel.Tasks;

namespace MatterFlow.WorkManagement.Contracts;

/// <summary>A Task in short, as other modules (Assets "linked tasks", work views, search) see it.</summary>
/// <param name="TaskId">Internal id.</param>
/// <param name="TaskNumber">Human-friendly reference, for example <c>TSK-1042</c>.</param>
/// <param name="MatterId">The Matter the Task belongs to; it never changes.</param>
/// <param name="ProjectId">Optional Project (always of the same Matter).</param>
/// <param name="TaskTypeId">Task Type; it never changes.</param>
/// <param name="Title">Title.</param>
/// <param name="Status">Lifecycle status.</param>
/// <param name="PriorityId">Priority.</param>
/// <param name="AssignedPodId">Assigned Pod, if any.</param>
/// <param name="AssignedUserId">Assigned user, if any.</param>
/// <param name="DueDate">Floating calendar due date; null means ASAP (never overdue).</param>
/// <param name="DueAtUtc">Absolute due instant when a time was chosen.</param>
/// <param name="WorkflowInstanceId">The Task's workflow instance.</param>
/// <param name="CreatedAtUtc">When the Task was created (UTC).</param>
public sealed record TaskSummary(
    long TaskId,
    string TaskNumber,
    int MatterId,
    int? ProjectId,
    int TaskTypeId,
    string Title,
    TaskStatusCode Status,
    int PriorityId,
    int? AssignedPodId,
    int? AssignedUserId,
    DateOnly? DueDate,
    DateTime? DueAtUtc,
    long WorkflowInstanceId,
    DateTime CreatedAtUtc);

/// <summary>Read-only Task lookups for other modules. Writes always go through the Tasks module's own API.</summary>
public interface ITaskDirectory
{
    /// <summary>The Task with the given id, or null.</summary>
    Task<TaskSummary?> FindAsync(long taskId, CancellationToken cancellationToken = default);

    /// <summary>The Tasks with the given ids that exist (missing ids are skipped), in no particular order.</summary>
    Task<IReadOnlyList<TaskSummary>> FindManyAsync(IReadOnlyCollection<long> taskIds, CancellationToken cancellationToken = default);

    /// <summary>Resolves <c>TSK-1042</c> (or bare <c>1042</c>) to a Task, or null.</summary>
    Task<TaskSummary?> FindByNumberAsync(string taskNumber, CancellationToken cancellationToken = default);

    /// <summary>The Matter's Tasks, newest first, at most <paramref name="limit"/>. Closed (Completed, Cancelled) ones only when asked.</summary>
    Task<IReadOnlyList<TaskSummary>> ListForMatterAsync(int matterId, bool includeClosed = true, int limit = 200, CancellationToken cancellationToken = default);

    /// <summary>Number of Tasks per status for a Matter (statuses without Tasks are absent).</summary>
    Task<IReadOnlyDictionary<TaskStatusCode, int>> CountByStatusAsync(int matterId, CancellationToken cancellationToken = default);
}
