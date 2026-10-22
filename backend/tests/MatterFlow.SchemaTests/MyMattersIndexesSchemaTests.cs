using MatterFlow.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace MatterFlow.SchemaTests;

/// <summary>33-my-matters-indexes.sql (epic #667, issue #686): the two covering indexes keep their names and carry the columns the My Matters reads need.</summary>
[Collection(SqlServerCollection.Name)]
public class MyMattersIndexesSchemaTests(SqlServerFixture sql)
{
    private static async Task<List<string>> ColumnsAsync(string cs, string table, string index, bool included)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = $"""
            SELECT col.name
            FROM sys.indexes i
            JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
            JOIN sys.columns col ON col.object_id = ic.object_id AND col.column_id = ic.column_id
            WHERE i.object_id = OBJECT_ID('{table}') AND i.name = '{index}' AND ic.is_included_column = {(included ? 1 : 0)}
            ORDER BY ic.key_ordinal, col.name
            """;
        var names = new List<string>();
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
            names.Add(r.GetString(0));
        return names;
    }

    [Fact]
    public async Task The_task_and_step_indexes_are_covering_and_keep_their_keys()
    {
        var cs = await sql.CreateDatabaseAsync();
        await new SchemaMigrationRunner(cs, new EmbeddedMigrationScriptSource(), new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();

        (await ColumnsAsync(cs, "dbo.Task", "IX_Task_Matter", included: false)).ShouldBe(["MatterId", "StatusCode"]);
        (await ColumnsAsync(cs, "dbo.Task", "IX_Task_Matter", included: true)).Order()
            .ShouldBe(new[] { "AssignedPodId", "AssignedUserId", "CreatedAt", "DueAtUtc", "DueDate", "DueSortKey", "StatusChangedAt", "WorkflowInstanceId" }.Order());
        (await ColumnsAsync(cs, "dbo.StepInstance", "IX_StepInstance_Workflow", included: false)).ShouldBe(["WorkflowInstanceId", "SequenceNo"]);
        (await ColumnsAsync(cs, "dbo.StepInstance", "IX_StepInstance_Workflow", included: true)).ShouldBe(["Status"]);
    }
}
