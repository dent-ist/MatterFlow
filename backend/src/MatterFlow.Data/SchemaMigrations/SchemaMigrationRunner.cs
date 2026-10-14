using System.Data;
using System.Diagnostics;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;

namespace MatterFlow.Data.SchemaMigrations;

/// <summary>
/// Applies pending numbered SQL scripts under an <c>sp_getapplock</c> so concurrent instances serialize
/// (docs/architecture.md section 4.3). Any problem throws <see cref="SchemaMigrationException"/>.
/// </summary>
public sealed class SchemaMigrationRunner(
    string connectionString,
    IMigrationScriptSource source,
    MigrationsOptions options,
    ILogger<SchemaMigrationRunner> logger)
{
    public const string LockResource = "MatterFlow.SchemaMigration";

    private const string EnsureTableSql = """
        IF OBJECT_ID(N'dbo.SchemaMigration', N'U') IS NULL
        CREATE TABLE dbo.SchemaMigration (
          SchemaMigrationId INT IDENTITY(1,1) CONSTRAINT PK_SchemaMigration PRIMARY KEY,
          ScriptName        NVARCHAR(260) NOT NULL CONSTRAINT UQ_SchemaMigration_Name UNIQUE,
          Prefix            INT           NOT NULL CONSTRAINT UQ_SchemaMigration_Prefix UNIQUE,
          Checksum          CHAR(64)      NOT NULL,
          AppliedAtUtc      DATETIME2(3)  NOT NULL CONSTRAINT DF_SchemaMigration_Applied DEFAULT SYSUTCDATETIME(),
          DurationMs        INT           NOT NULL,
          Success           BIT           NOT NULL,
          AppliedBy         NVARCHAR(256) NULL,
          AppVersion        NVARCHAR(64)  NULL
        );
        """;

    private const string InsertSql = """
        INSERT INTO dbo.SchemaMigration (ScriptName, Prefix, Checksum, DurationMs, Success, AppliedBy, AppVersion)
        VALUES (@name, @prefix, @checksum, @duration, @success, SUSER_SNAME(), @version);
        """;

    private readonly string _appVersion = typeof(SchemaMigrationRunner).Assembly.GetName().Version?.ToString() ?? "unknown";

    /// <summary>Returns the names of scripts applied by this call, in order.</summary>
    public async Task<IReadOnlyList<string>> RunAsync(CancellationToken cancellationToken = default)
    {
        var scripts = ScriptCatalog.Load(source);

        await using var connection = new SqlConnection(connectionString);
        try
        {
            await connection.OpenAsync(cancellationToken);
        }
        catch (SqlException ex)
        {
            throw new SchemaMigrationException($"Cannot connect to the database for schema migration: {ex.Message}", ex);
        }

        await AcquireLockAsync(connection, cancellationToken);
        try
        {
            await ExecuteAsync(connection, null, EnsureTableSql, cancellationToken);
            var applied = await LoadAppliedAsync(connection, cancellationToken);
            var pending = Validate(scripts, applied);

            var done = new List<string>();
            foreach (var script in pending)
            {
                await ApplyAsync(connection, script, cancellationToken);
                done.Add(script.Name);
            }

            if (done.Count == 0)
            {
                logger.LogInformation("Schema is up to date ({Count} scripts applied previously).", applied.Count);
            }

            return done;
        }
        finally
        {
            await ReleaseLockAsync(connection);
        }
    }

    private static List<MigrationScript> Validate(IReadOnlyList<MigrationScript> scripts, List<AppliedRow> applied)
    {
        var failed = applied.FirstOrDefault(a => !a.Success);
        if (failed is not null)
        {
            throw new SchemaMigrationException(
                $"Script '{failed.Name}' is recorded as failed/partially applied (Success=0). An operator must repair the database and delete the dbo.SchemaMigration row before startup can continue.");
        }

        var byName = scripts.ToDictionary(s => s.Name, StringComparer.Ordinal);
        foreach (var row in applied)
        {
            if (!byName.TryGetValue(row.Name, out var script))
            {
                throw new SchemaMigrationException(
                    $"Applied script '{row.Name}' (prefix {row.Prefix}) is missing from the application. Applied scripts must never be removed or renamed.");
            }

            if (script.Prefix != row.Prefix)
            {
                throw new SchemaMigrationException(
                    $"Applied script '{row.Name}' has prefix {row.Prefix} in the database but {script.Prefix} in the application.");
            }

            if (!string.Equals(script.Checksum, row.Checksum, StringComparison.OrdinalIgnoreCase))
            {
                throw new SchemaMigrationException(
                    $"Checksum mismatch for already-applied script '{script.Name}': database has {row.Checksum}, application has {script.Checksum}. Applied scripts are immutable; revert the edit and add a new script instead.");
            }
        }

        var appliedNames = applied.Select(a => a.Name).ToHashSet(StringComparer.Ordinal);
        var pending = scripts.Where(s => !appliedNames.Contains(s.Name)).ToList();
        var maxApplied = applied.Count == 0 ? int.MinValue : applied.Max(a => a.Prefix);
        var outOfOrder = pending.FirstOrDefault(s => s.Prefix < maxApplied);
        if (outOfOrder is not null)
        {
            throw new SchemaMigrationException(
                $"Pending script '{outOfOrder.Name}' has a lower prefix than the highest applied prefix ({maxApplied}). Rename it to the next free number.");
        }

        return pending;
    }

    private async Task ApplyAsync(SqlConnection connection, MigrationScript script, CancellationToken ct)
    {
        logger.LogInformation("Applying schema script {Script}...", script.Name);
        var batches = SqlBatchSplitter.Split(script.Content);
        var stopwatch = Stopwatch.StartNew();

        if (script.NoTransaction)
        {
            await InsertRowAsync(connection, null, script, 0, success: false, ct);
            await RunBatchesAsync(connection, null, script, batches, ct);
            await using var update = connection.CreateCommand();
            update.CommandText = "UPDATE dbo.SchemaMigration SET Success = 1, DurationMs = @d WHERE ScriptName = @n;";
            update.Parameters.AddWithValue("@d", (int)stopwatch.ElapsedMilliseconds);
            update.Parameters.AddWithValue("@n", script.Name);
            await update.ExecuteNonQueryAsync(ct);
        }
        else
        {
            await using var tx = (SqlTransaction)await connection.BeginTransactionAsync(ct);
            try
            {
                await ExecuteAsync(connection, tx, "SET XACT_ABORT ON;", ct);
                await RunBatchesAsync(connection, tx, script, batches, ct);
                await InsertRowAsync(connection, tx, script, (int)stopwatch.ElapsedMilliseconds, success: true, ct);
                await tx.CommitAsync(ct);
            }
            catch
            {
                try
                {
                    await tx.RollbackAsync(CancellationToken.None);
                }
                catch (Exception rollbackEx) when (rollbackEx is InvalidOperationException or SqlException)
                {
                    // Transaction already rolled back by the server (XACT_ABORT).
                }

                throw;
            }
        }

        logger.LogInformation("Applied {Script} in {Ms} ms.", script.Name, stopwatch.ElapsedMilliseconds);
    }

    private async Task RunBatchesAsync(
        SqlConnection connection, SqlTransaction? tx, MigrationScript script, IReadOnlyList<string> batches, CancellationToken ct)
    {
        for (var i = 0; i < batches.Count; i++)
        {
            try
            {
                await ExecuteAsync(connection, tx, batches[i], ct);
            }
            catch (SqlException ex)
            {
                throw new SchemaMigrationException(
                    $"Script '{script.Name}' failed in batch {i + 1} of {batches.Count} (SQL error {ex.Number}, line {ex.LineNumber}): {ex.Message}",
                    ex);
            }
        }
    }

    private async Task InsertRowAsync(
        SqlConnection connection, SqlTransaction? tx, MigrationScript script, int durationMs, bool success, CancellationToken ct)
    {
        await using var cmd = connection.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = InsertSql;
        cmd.Parameters.AddWithValue("@name", script.Name);
        cmd.Parameters.AddWithValue("@prefix", script.Prefix);
        cmd.Parameters.Add("@checksum", SqlDbType.Char, 64).Value = script.Checksum;
        cmd.Parameters.AddWithValue("@duration", durationMs);
        cmd.Parameters.AddWithValue("@success", success);
        cmd.Parameters.AddWithValue("@version", _appVersion);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    private async Task<List<AppliedRow>> LoadAppliedAsync(SqlConnection connection, CancellationToken ct)
    {
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = "SELECT ScriptName, Prefix, Checksum, Success FROM dbo.SchemaMigration ORDER BY Prefix;";
        cmd.CommandTimeout = options.CommandTimeoutSeconds;
        var rows = new List<AppliedRow>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            rows.Add(new AppliedRow(reader.GetString(0), reader.GetInt32(1), reader.GetString(2).Trim(), reader.GetBoolean(3)));
        }

        return rows;
    }

    private async Task AcquireLockAsync(SqlConnection connection, CancellationToken ct)
    {
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = "EXEC @rc = sp_getapplock @Resource = @res, @LockMode = 'Exclusive', @LockOwner = 'Session', @LockTimeout = @timeout;";
        cmd.CommandTimeout = options.LockTimeoutSeconds + 30;
        cmd.Parameters.AddWithValue("@res", LockResource);
        cmd.Parameters.AddWithValue("@timeout", options.LockTimeoutSeconds * 1000);
        var rc = cmd.Parameters.Add("@rc", SqlDbType.Int);
        rc.Direction = ParameterDirection.Output;
        await cmd.ExecuteNonQueryAsync(ct);
        if ((int)rc.Value < 0)
        {
            throw new SchemaMigrationException(
                $"Could not acquire the schema migration lock '{LockResource}' within {options.LockTimeoutSeconds}s (sp_getapplock returned {rc.Value}).");
        }
    }

    private async Task ReleaseLockAsync(SqlConnection connection)
    {
        try
        {
            await using var cmd = connection.CreateCommand();
            cmd.CommandText = "EXEC sp_releaseapplock @Resource = @res, @LockOwner = 'Session';";
            cmd.Parameters.AddWithValue("@res", LockResource);
            await cmd.ExecuteNonQueryAsync(CancellationToken.None);
        }
        catch (Exception ex) when (ex is SqlException or InvalidOperationException)
        {
            logger.LogWarning(ex, "Could not release the schema migration lock explicitly; closing the connection releases it.");
        }
    }

    private async Task ExecuteAsync(SqlConnection connection, SqlTransaction? tx, string sql, CancellationToken ct)
    {
        await using var cmd = connection.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = sql;
        cmd.CommandTimeout = options.CommandTimeoutSeconds;
        await cmd.ExecuteNonQueryAsync(ct);
    }

    private sealed record AppliedRow(string Name, int Prefix, string Checksum, bool Success);
}
