using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkManagement.Application;

/// <summary>
/// The unit of work of every Task command (architecture 9, 10): one explicit transaction on the shared DbContext, so the workflow service's own
/// SaveChanges calls (which join it behind a savepoint), the Task update, the comment and the audit rows commit or roll back together.
/// A failed result or any exception rolls everything back and clears the change tracker; no partial result is possible.
/// </summary>
public sealed class TaskTransactions(DbContext db)
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

    /// <summary>Loads the Task tracked under an update lock (per-Task serialization, architecture 10.2). Null when it does not exist.</summary>
    public Task<WorkTask?> LockTaskAsync(long taskId, CancellationToken ct) =>
        db.Set<WorkTask>()
            .FromSql($"SELECT * FROM dbo.Task WITH (UPDLOCK, ROWLOCK) WHERE TaskId = {taskId}")
            .SingleOrDefaultAsync(ct);

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
