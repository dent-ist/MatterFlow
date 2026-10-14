using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Identity.Application;

/// <summary>
/// Serializes every operation that can change who the active System Admins are (SEC-03). Takes the transaction-owned application lock
/// <c>MatterFlow.AdminGuard</c>; callers must already be inside a transaction, and the lock is released when it ends.
/// </summary>
internal static class AdminGuardLock
{
    public const string Resource = "MatterFlow.AdminGuard";

    public static async Task AcquireAsync(DbContext db, CancellationToken ct)
    {
        await db.Database.ExecuteSqlRawAsync(
            """
            DECLARE @result int;
            EXEC @result = sp_getapplock @Resource = N'MatterFlow.AdminGuard', @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 15000;
            IF @result < 0 THROW 51000, 'Could not acquire the administration lock.', 1;
            """,
            ct);
    }
}
