using LptHub.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace LptHub.SchemaTests;

/// <summary>Baseline (archived 34-matter-view-sensitive.sql) (epic #788, SM-01): the permission row and its default grants to Director.</summary>
[Collection(SqlServerCollection.Name)]
public class MatterViewSensitiveSchemaTests(SqlServerFixture sql)
{
    private static Task RunAsync(string cs, IMigrationScriptSource source) =>
        new SchemaMigrationRunner(cs, source, new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();

    private static async Task<List<string>> ReadAsync(string cs, string sqlText)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = sqlText;
        var rows = new List<string>();
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
            rows.Add(r.GetString(0));
        return rows;
    }

    private static async Task ExecAsync(string cs, string sqlText)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = sqlText;
        await cmd.ExecuteNonQueryAsync();
    }

    private static Task<List<string>> HoldersAsync(string cs) =>
        ReadAsync(cs, "SELECT r.Name FROM dbo.RolePermission rp JOIN dbo.Role r ON r.RoleId = rp.RoleId JOIN dbo.Permission p ON p.PermissionId = rp.PermissionId WHERE p.Code = 'Matter.ViewSensitive' ORDER BY r.Name");

    [Fact]
    public async Task A_fresh_database_gets_the_permission_row_and_no_grants()
    {
        var cs = await sql.CreateDatabaseAsync();

        await RunAsync(cs, new EmbeddedMigrationScriptSource());

        (await ReadAsync(cs, "SELECT Code FROM dbo.Permission WHERE Code = 'Matter.ViewSensitive'")).ShouldBe(["Matter.ViewSensitive"]);
        (await HoldersAsync(cs)).ShouldBeEmpty();
    }
}
