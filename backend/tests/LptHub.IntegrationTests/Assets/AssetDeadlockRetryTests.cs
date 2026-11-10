using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.Data.SqlClient;
using Shouldly;

namespace MatterFlow.IntegrationTests.Assets;

/// <summary>
/// BUG-6 of the Assets UX review: one <c>POST /assets</c> answered 500 among 1,150 creates while another process wrote to the same database.
/// The suspect is a SQL Server deadlock victim (error 1205). The tests make SQL Server pick the asset write as a REAL victim, on purpose and
/// in a fixed order, and check what the caller sees:
/// <list type="bullet">
/// <item>a write that loses once is repeated by the service and succeeds (before the fix it surfaced as an error for a call that works when repeated);</item>
/// <item>a write that loses twice is the retryable 409 CONCURRENCY_CONFLICT, never a 5xx, and saves nothing.</item>
/// </list>
/// How the deadlock is built: a test session takes a table lock on <c>AuditEvent</c> (with the highest deadlock priority), the asset write inserts
/// its row and then waits for that table (its history is written in the same transaction, right after the row), and the test session then reads
/// <c>Asset</c> through its clustered index, which waits for the row the write holds. SQL Server breaks the cycle by rolling the write back (the lower priority).
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class AssetDeadlockRetryTests(SqlServerFixture sql) : IAsyncLifetime
{
    private string _connectionString = null!;
    private DatabaseApiFactory _factory = null!;

    public async Task InitializeAsync()
    {
        _connectionString = await sql.CreateDatabaseAsync();
        _factory = new DatabaseApiFactory(_connectionString);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private HttpClient Admin()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);
        return client;
    }

    private static async Task<JsonElement> BodyAsync(HttpResponseMessage response, HttpStatusCode expected)
    {
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(expected, text);
        return JsonDocument.Parse(text).RootElement;
    }

    private async Task<(int MatterId, int TypeId)> SetUpAsync()
    {
        var admin = Admin();
        var client = await BodyAsync(await admin.PostAsJsonAsync("/api/v1/clients", new { clientNumber = "343", name = "Acme Corp" }), HttpStatusCode.Created);
        var matter = await BodyAsync(
            await admin.PostAsJsonAsync("/api/v1/matters", new { clientId = client.GetProperty("clientId").GetInt32(), matterNumber = "12", name = "Merger Review" }),
            HttpStatusCode.Created);
        var type = await BodyAsync(await admin.PostAsJsonAsync("/api/v1/asset-types", new { name = "Document Set", description = (string?)null }), HttpStatusCode.Created);
        return (matter.GetProperty("matterId").GetInt32(), type.GetProperty("assetTypeId").GetInt32());
    }

    private static StringContent Json(object body) => new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    private async Task<int> CountAssetsAsync(string name)
    {
        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new SqlCommand("SELECT COUNT(*) FROM dbo.Asset WHERE DisplayName = @name", connection);
        command.Parameters.AddWithValue("@name", name);
        return (int)(await command.ExecuteScalarAsync())!;
    }

    private async Task<int> CountAuditAsync(string eventSelector, string name)
    {
        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new SqlCommand(
            $"SELECT COUNT(*) FROM dbo.AuditEvent e WHERE e.ObjectType = 'Asset' AND {eventSelector} AND e.ObjectId IN (SELECT CAST(AssetId AS varchar(20)) FROM dbo.Asset WHERE DisplayName = @name)",
            connection);
        command.Parameters.AddWithValue("@name", name);
        return (int)(await command.ExecuteScalarAsync())!;
    }

    /// <summary>
    /// Runs <paramref name="request"/> while a test session forces SQL Server to pick it as the deadlock victim <paramref name="rounds"/> times in
    /// a row, then lets it go. Returns the response the caller saw.
    /// </summary>
    private async Task<HttpResponseMessage> RunAgainstDeadlocksAsync(Func<Task<HttpResponseMessage>> request, int rounds)
    {
        await using var holder = new SqlConnection(_connectionString);
        await holder.OpenAsync();
        await Exec(holder, "SET DEADLOCK_PRIORITY HIGH;");
        await using var transaction = holder.BeginTransaction();
        // The history table is locked as a whole until the test session ends its transaction.
        await Exec(holder, "SELECT TOP (1) 1 FROM dbo.AuditEvent WITH (TABLOCKX, HOLDLOCK);", transaction);
        var spid = (short)(await Scalar(holder, "SELECT @@SPID;", transaction))!;

        var running = Task.Run(request);
        try
        {
            for (var round = 0; round < rounds; round++)
            {
                await WaitUntilBlockedBySessionAsync(spid);
                // The write now holds its new Asset row and waits for the history table. Reading the table waits for that row: a cycle.
                // This session has the higher priority, so SQL Server rolls the write back and this read completes.
                await Exec(holder, "SELECT COUNT(*) FROM dbo.Asset WITH (INDEX(0), READCOMMITTED);", transaction);
            }
        }
        finally
        {
            await transaction.RollbackAsync(); // the history table is free again: a repeated write can finish
        }

        return await running.WaitAsync(TimeSpan.FromSeconds(90));
    }

    /// <summary>
    /// Waits until a request of this database waits for the test session AND already holds an exclusive lock on an Asset row, so the read of
    /// <c>Asset</c> that follows closes a real cycle (and not merely a queue behind the table lock).
    /// </summary>
    private async Task WaitUntilBlockedBySessionAsync(short spid)
    {
        await using var watcher = new SqlConnection(_connectionString);
        await watcher.OpenAsync();
        var deadline = DateTime.UtcNow.AddSeconds(60);
        while (DateTime.UtcNow < deadline)
        {
            var cycle = await Scalar(
                watcher,
                $"""
                SELECT COUNT(*)
                FROM sys.dm_exec_requests r
                WHERE r.blocking_session_id = {spid}
                  AND r.wait_type LIKE 'LCK%'
                  AND EXISTS (
                    SELECT 1
                    FROM sys.dm_tran_locks l
                    JOIN sys.partitions p ON p.hobt_id = l.resource_associated_entity_id
                    WHERE l.request_session_id = r.session_id
                      AND l.resource_type = 'KEY'
                      AND l.request_mode = 'X'
                      AND l.request_status = 'GRANT'
                      AND OBJECT_NAME(p.object_id) = 'Asset');
                """);
            if (cycle is int count and > 0)
                return;
            await Task.Delay(50);
        }

        throw new TimeoutException("The asset write never waited for the history table while holding its Asset row.");
    }

    private static async Task Exec(SqlConnection connection, string sqlText, SqlTransaction? transaction = null)
    {
        await using var command = new SqlCommand(sqlText, connection, transaction) { CommandTimeout = 90 };
        await command.ExecuteNonQueryAsync();
    }

    private static async Task<object?> Scalar(SqlConnection connection, string sqlText, SqlTransaction? transaction = null)
    {
        await using var command = new SqlCommand(sqlText, connection, transaction) { CommandTimeout = 90 };
        return await command.ExecuteScalarAsync();
    }

    [Fact]
    public async Task A_create_that_loses_a_deadlock_is_repeated_and_succeeds_with_one_asset_and_one_history()
    {
        var (matterId, typeId) = await SetUpAsync();
        var admin = Admin();

        var response = await RunAgainstDeadlocksAsync(
            () => admin.PostAsync("/api/v1/assets", Json(new { matterId, assetTypeId = typeId, displayName = "Raced create", externalReference = "REF-1" })),
            rounds: 1);

        var asset = await BodyAsync(response, HttpStatusCode.Created);
        asset.GetProperty("displayName").GetString().ShouldBe("Raced create");
        (await CountAssetsAsync("Raced create")).ShouldBe(1);
        (await CountAuditAsync("e.EventType = 'FIELD_CHANGED' AND e.FieldKey = 'DisplayName'", "Raced create")).ShouldBe(1);
    }

    [Fact]
    public async Task A_create_that_loses_twice_is_a_retryable_409_and_saves_nothing()
    {
        var (matterId, typeId) = await SetUpAsync();
        var admin = Admin();

        var response = await RunAgainstDeadlocksAsync(
            () => admin.PostAsync("/api/v1/assets", Json(new { matterId, assetTypeId = typeId, displayName = "Lost twice", externalReference = (string?)null })),
            rounds: 2);

        var problem = await BodyAsync(response, HttpStatusCode.Conflict);
        problem.GetProperty("code").GetString().ShouldBe("CONCURRENCY_CONFLICT");
        problem.GetProperty("detail").GetString().ShouldBe("Another change was saved at the same time. Try again.");
        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
        (await CountAssetsAsync("Lost twice")).ShouldBe(0);
    }

    [Fact]
    public async Task An_edit_and_a_deactivation_that_lose_a_deadlock_are_repeated_too()
    {
        var (matterId, typeId) = await SetUpAsync();
        var admin = Admin();
        var created = await BodyAsync(
            await admin.PostAsJsonAsync("/api/v1/assets", new { matterId, assetTypeId = typeId, displayName = "Before", externalReference = (string?)null }),
            HttpStatusCode.Created);
        var assetId = created.GetProperty("assetId").GetInt32();

        var edited = await BodyAsync(
            await RunAgainstDeadlocksAsync(
                () => admin.PutAsync($"/api/v1/assets/{assetId}", Json(new { displayName = "After", externalReference = (string?)null, description = (string?)null, rowVersion = created.GetProperty("rowVersion").GetString() })),
                rounds: 1),
            HttpStatusCode.OK);
        edited.GetProperty("displayName").GetString().ShouldBe("After");

        var deactivated = await BodyAsync(
            await RunAgainstDeadlocksAsync(
                () => admin.PostAsync($"/api/v1/assets/{assetId}/active", Json(new { isActive = false, rowVersion = edited.GetProperty("rowVersion").GetString() })),
                rounds: 1),
            HttpStatusCode.OK);
        deactivated.GetProperty("isActive").GetBoolean().ShouldBeFalse();
    }
}
