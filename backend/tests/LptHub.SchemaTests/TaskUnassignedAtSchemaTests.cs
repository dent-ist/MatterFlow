using MatterFlow.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace MatterFlow.SchemaTests;

/// <summary>Baseline (archived 57-task-unassigned-at.sql) (Dashboard v4, epic #1063, issue #1064): the nullable column, no backfill, and the filtered index of open unassigned Tasks.</summary>
[Collection(SqlServerCollection.Name)]
public class TaskUnassignedAtSchemaTests(SqlServerFixture sql)
{
    private static async Task<object?> ScalarAsync(string cs, string text)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = text;
        return await cmd.ExecuteScalarAsync();
    }

    [Fact]
    public async Task The_column_is_a_nullable_datetime2_3_and_the_index_covers_open_unassigned_tasks_only()
    {
        var cs = await sql.CreateDatabaseAsync();
        await new SchemaMigrationRunner(cs, new EmbeddedMigrationScriptSource(), new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();

        (await ScalarAsync(cs, "SELECT CONCAT(t.name, ',', c.scale, ',', c.is_nullable) FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id WHERE c.object_id = OBJECT_ID('dbo.Task') AND c.name = 'UnassignedAt'"))
            .ShouldBe("datetime2,3,1");
        var filter = (string)(await ScalarAsync(cs, "SELECT filter_definition FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.Task') AND name = 'IX_Task_Unassigned'"))!;
        filter.ShouldContain("AssignedUserId");
        filter.ShouldContain("NEW");
        filter.ShouldContain("ON_HOLD");
        filter.ShouldNotContain("COMPLETED");
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.Task WHERE UnassignedAt IS NOT NULL")).ShouldBe(0);
    }
}
