using LptHub.SharedKernel.Results;
using LptHub.SharedKernel.Visibility;
using LptHub.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace LptHub.WorkManagement.Application;

/// <summary>
/// The unit of work of every Task command (architecture 9, 10): one explicit transaction on the shared DbContext, so the workflow service's own
/// SaveChanges calls (which join it behind a savepoint), the Task update, the comment and the audit rows commit or roll back together.
/// A failed result or any exception rolls everything back and clears the change tracker; no partial result is possible.
/// </summary>
public sealed class TaskTransactions(DbContext db, IMatterVisibility visibility)
{
    public async Task<Result<T>> RunAsync<T>(Func<CancellationToken, Task<Result<T>>> body, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        try
        {
            var result = await body(ct);
            if (result.IsFailure)
            {
                await transaction.RollbackAsync(CancellationToken.None);
                db.ChangeTracker.Clear();
                return result;
            }

            await transaction.CommitAsync(ct);
            db.ChangeTracker.Clear();
            return result;
        }
        catch (DbUpdateConcurrencyException)
        {
            db.ChangeTracker.Clear();
            return TaskSupport.Concurrency();
        }
        catch
        {
            db.ChangeTracker.Clear();
            throw;
        }
    }

    /// <summary>
    /// Loads the Task tracked under an update lock (per-Task serialization, architecture 10.2) for a command that changes it. A Task the caller may not see (sensitive-matter rule, Task Type
    /// access rule, mode T) is "not found" exactly like a missing one, before any other check; a visible Task whose type the caller may see but not edit is the 403
    /// <c>TASK_TYPE_READ_ONLY</c> (epic #1397, issue #1401). Every command that changes a Task loads it here, so the edit gate cannot be forgotten on one endpoint; there is no load without the gate.
    /// </summary>
    public async Task<Result<WorkTask>> LockForEditAsync(long taskId, CancellationToken ct)
    {
        if (visibility.TaskRulesEnabled && !await visibility.CanSeeTaskAsync(taskId, ct))
            return TaskSupport.NotFound();

        var task = await db.Set<WorkTask>()
            .FromSql($"SELECT * FROM dbo.Task WITH (UPDLOCK, ROWLOCK) WHERE TaskId = {taskId}")
            .SingleOrDefaultAsync(ct);
        if (task is null)
            return TaskSupport.NotFound();

        return await EditGateAsync(task.TaskTypeId, ct) is { } readOnly ? readOnly : task;
    }

    /// <summary>
    /// The edit gate for a command that already loaded a visible task (comments): null when the caller may change tasks of the type, else the 403 <c>TASK_TYPE_READ_ONLY</c>. A no-op while the
    /// Task Type switch is off.
    /// </summary>
    public async Task<Error?> EditGateAsync(int taskTypeId, CancellationToken ct) =>
        visibility.TaskTypeAccessEnabled && !await visibility.CanEditTaskTypeAsync(taskTypeId, ct) ? TaskSupport.ReadOnly() : null;

    /// <summary>
    /// Takes the Matter row lock shared with Matter deactivation, so a Task cannot be created or reopened while the Matter is being made inactive
    /// (architecture 8.3 rule 7, 10.3). Must run inside the command transaction, before reading the Matter's state.
    /// </summary>
    public async Task LockMatterAsync(int matterId, CancellationToken ct) =>
        _ = await db.Database
            .SqlQuery<int>($"SELECT MatterId AS [Value] FROM dbo.Matter WITH (UPDLOCK, ROWLOCK) WHERE MatterId = {matterId}")
            .ToListAsync(ct);

    /// <summary>The next value of the Task number sequence.</summary>
    public async Task<long> NextTaskNumberAsync(CancellationToken ct)
    {
        var values = await db.Database.SqlQuery<long>($"SELECT NEXT VALUE FOR dbo.TaskNumberSeq AS [Value]").ToListAsync(ct);
        return values.Single();
    }
}
