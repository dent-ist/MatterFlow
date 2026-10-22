using MatterFlow.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace MatterFlow.SchemaTests;

/// <summary>31-my-matters-activity-seen.sql (epic #667, issue #683): one watermark row per person, never negative, one row per user.</summary>
[Collection(SqlServerCollection.Name)]
public class ActivitySeenSchemaTests(SqlServerFixture sql)
{
    private static async Task<object?> ScalarAsync(string cs, string sqlText)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = sqlText;
        return await cmd.ExecuteScalarAsync();
    }

    [Fact]
    public async Task The_table_keeps_one_non_negative_watermark_per_user()
    {
        var cs = await sql.CreateDatabaseAsync();
        await new SchemaMigrationRunner(cs, new EmbeddedMigrationScriptSource(), new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();
        await ScalarAsync(cs, "INSERT dbo.AppUser (DisplayName) VALUES (N'Ann')");
        var user = Convert.ToInt32(await ScalarAsync(cs, "SELECT MIN(UserId) FROM dbo.AppUser"));

        await ScalarAsync(cs, $"INSERT dbo.UserMatterActivitySeen (UserId) VALUES ({user})");
        Convert.ToInt64(await ScalarAsync(cs, $"SELECT SeenAuditEventId FROM dbo.UserMatterActivitySeen WHERE UserId = {user}")).ShouldBe(0);

        (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, $"INSERT dbo.UserMatterActivitySeen (UserId) VALUES ({user})"))).Message.ShouldContain("PRIMARY KEY", Case.Insensitive);
        (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, $"UPDATE dbo.UserMatterActivitySeen SET SeenAuditEventId = -1 WHERE UserId = {user}"))).Message.ShouldContain("CK_UserMatterActivitySeen_Event");
        (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.UserMatterActivitySeen (UserId) VALUES (999999)"))).Message.ShouldContain("FK_UserMatterActivitySeen_User");
    }
}
