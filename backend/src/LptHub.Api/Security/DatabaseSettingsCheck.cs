using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Api.Security;

/// <summary>
/// Startup check for security review SEC-17: without <c>READ_COMMITTED_SNAPSHOT</c> readers block writers, which turns concurrent
/// administrative changes into deadlocks. The setting cannot be applied by a migration script (it needs exclusive access to the
/// database), so the DBA sets it once and the API warns when it is missing.
/// </summary>
public static class DatabaseSettingsCheck
{
    internal const string Sql = "SELECT CAST(is_read_committed_snapshot_on AS int) AS [Value] FROM sys.databases WHERE database_id = DB_ID()";

    public static async Task VerifyAsync(IServiceProvider services, CancellationToken cancellationToken = default)
    {
        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("MatterFlow.Database");
        await using var scope = services.CreateAsyncScope();
        try
        {
            var db = scope.ServiceProvider.GetRequiredService<DbContext>();
            var enabled = await db.Database.SqlQueryRaw<int>(Sql).SingleOrDefaultAsync(cancellationToken);
            if (enabled == 0)
            {
                logger.LogWarning(
                    "READ_COMMITTED_SNAPSHOT is off for this database: readers block writers and concurrent administrative changes can deadlock. "
                    + "A DBA should run ALTER DATABASE [<name>] SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE (docs/runbook.md section 3).");
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Could not read the database settings.");
        }
    }
}
