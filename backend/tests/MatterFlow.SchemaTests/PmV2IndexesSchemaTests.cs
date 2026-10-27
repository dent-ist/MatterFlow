using MatterFlow.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace MatterFlow.SchemaTests;

/// <summary>47-pm-v2-performance-indexes.sql (PM v2, epic #851, issue #887): the covering index of the Data tab and the asset reports and the task index of the Breakdown exist, are not filtered and keep the older indexes.</summary>
[Collection(SqlServerCollection.Name)]
public class PmV2IndexesSchemaTests(SqlServerFixture sql)
{
    private static async Task<List<string>> ColumnsAsync(string cs, string index, bool included, string table = "dbo.CustomFieldIndex")
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
    public async Task The_field_owner_index_covers_one_field_of_the_typed_index_for_a_number_and_a_select()
    {
        var cs = await sql.CreateDatabaseAsync();
        await new SchemaMigrationRunner(cs, new EmbeddedMigrationScriptSource(), new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();

        (await ColumnsAsync(cs, "IX_CFI_Kind_Field_Owner", included: false)).ShouldBe(["OwnerKind", "FieldKey", "OwnerId"]);
        (await ColumnsAsync(cs, "IX_CFI_Kind_Field_Owner", included: true)).Order().ShouldBe(["ValueNumber", "ValueText"]);

        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var filtered = c.CreateCommand();
        filtered.CommandText = "SELECT has_filter FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.CustomFieldIndex') AND name = 'IX_CFI_Kind_Field_Owner'";
        ((bool)(await filtered.ExecuteScalarAsync())!).ShouldBeFalse("a left join over the select value needs the rows with no value as well");

        // The five older indexes of script 06 stay: the Assets list and the Task Queue filters use them.
        await using var others = c.CreateCommand();
        others.CommandText = "SELECT COUNT(*) FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.CustomFieldIndex') AND name IN ('IX_CFI_Text', 'IX_CFI_Number', 'IX_CFI_Date', 'IX_CFI_DateTime', 'IX_CFI_Bool', 'IX_CFI_Owner')";
        ((int)(await others.ExecuteScalarAsync())!).ShouldBe(6);
    }

    [Fact]
    public async Task The_task_matter_type_index_carries_the_type_and_the_columns_the_counts_read_and_the_matter_index_stays()
    {
        var cs = await sql.CreateDatabaseAsync();
        await new SchemaMigrationRunner(cs, new EmbeddedMigrationScriptSource(), new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();

        (await ColumnsAsync(cs, "IX_Task_Matter_Type", included: false, "dbo.Task")).ShouldBe(["MatterId", "TaskTypeId", "StatusCode"]);
        (await ColumnsAsync(cs, "IX_Task_Matter_Type", included: true, "dbo.Task")).Order()
            .ShouldBe(new[] { "AssignedPodId", "AssignedUserId", "CreatedAt", "DueAtUtc", "DueDate", "DueSortKey", "OnHoldReasonId", "PriorityId", "StatusChangedAt" }.Order());
        (await ColumnsAsync(cs, "IX_Task_Matter", included: false, "dbo.Task")).ShouldBe(["MatterId", "StatusCode"]);
    }
}
