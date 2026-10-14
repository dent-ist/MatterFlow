using MatterFlow.Data;
using Microsoft.Data.SqlClient;

namespace MatterFlow.Api.Seeding;

/// <summary>
/// Serializes the startup seeds across API instances that start at the same time (security review SEC-18). The schema runner already
/// takes an application lock; the seeds (permission catalog, starter roles) used to run unprotected, so two instances could both insert
/// catalog rows and one would die on the unique index. The lock is session-owned on a dedicated connection and released on dispose.
/// </summary>
public sealed class SeedLock : IAsyncDisposable
{
    public const string Resource = "MatterFlow.Seed";

    private readonly SqlConnection? _connection;

    private SeedLock(SqlConnection? connection) => _connection = connection;

    public static async Task<SeedLock> AcquireAsync(IConfiguration configuration, CancellationToken cancellationToken = default)
    {
        var connectionString = configuration.GetConnectionString(DataModule.ConnectionStringName);
        if (string.IsNullOrWhiteSpace(connectionString))
            return new SeedLock(null);

        var connection = new SqlConnection(connectionString);
        try
        {
            await connection.OpenAsync(cancellationToken);
            await using var command = connection.CreateCommand();
            command.CommandText =
                """
                DECLARE @result int;
                EXEC @result = sp_getapplock @Resource = N'MatterFlow.Seed', @LockMode = N'Exclusive', @LockOwner = N'Session', @LockTimeout = 120000;
                IF @result < 0 THROW 51000, 'Could not acquire the startup seed lock.', 1;
                """;
            await command.ExecuteNonQueryAsync(cancellationToken);
            return new SeedLock(connection);
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_connection is null)
            return;

        try
        {
            await using var command = _connection.CreateCommand();
            command.CommandText = "EXEC sp_releaseapplock @Resource = N'MatterFlow.Seed', @LockOwner = N'Session'";
            await command.ExecuteNonQueryAsync();
        }
        catch (SqlException)
        {
            // closing the connection releases a session lock anyway
        }
        finally
        {
            await _connection.DisposeAsync();
        }
    }
}
