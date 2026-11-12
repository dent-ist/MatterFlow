using LptHub.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace LptHub.SchemaTests;

/// <summary>Script 69 (epic #1368, issue #1370): Matter Types become a multi-select (dbo.MatterMatterType); each existing single value is carried over as one selected type.</summary>
[Collection(SqlServerCollection.Name)]
public class MatterMatterTypeSchemaTests(SqlServerFixture sql)
{
    private static async Task<object?> ScalarAsync(string cs, string text)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = text;
        return await cmd.ExecuteScalarAsync();
    }

    private static Task RunAsync(string cs, IMigrationScriptSource source) =>
        new SchemaMigrationRunner(cs, source, new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();

    [Fact]
    public async Task Each_existing_single_type_is_copied_as_one_selected_type_and_a_matter_without_a_type_gets_no_row()
    {
        var cs = await sql.CreateDatabaseAsync();
        var all = new EmbeddedMigrationScriptSource().ReadAll();
        await RunAsync(cs, new InMemoryMigrationScriptSource(all.Where(s => s.Name == SchemaMigrationRunner.BaselineScriptName)));
        await ScalarAsync(cs, """
            INSERT dbo.Client (ClientNumber, Name) VALUES ('00001', N'Client');
            INSERT dbo.MatterType (Name, SortOrder) VALUES (N'Litigation', 1), (N'Investigation', 2);
            INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name, MatterTypeId)
              SELECT c.ClientId, c.ClientNumber, '00001', N'With type', (SELECT MatterTypeId FROM dbo.MatterType WHERE Name = N'Investigation') FROM dbo.Client c;
            INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name)
              SELECT c.ClientId, c.ClientNumber, '00002', N'Without type' FROM dbo.Client c;
            """);

        await RunAsync(cs, new EmbeddedMigrationScriptSource());

        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.MatterMatterType")).ShouldBe(1);
        (await ScalarAsync(cs, "SELECT t.Name FROM dbo.MatterMatterType j JOIN dbo.MatterType t ON t.MatterTypeId = j.MatterTypeId JOIN dbo.Matter m ON m.MatterId = j.MatterId WHERE m.Name = N'With type'")).ShouldBe("Investigation");
    }

    [Fact]
    public async Task A_matter_can_carry_several_types_once_each_and_a_used_type_cannot_be_deleted_while_the_old_column_no_longer_blocks()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new EmbeddedMigrationScriptSource());
        await ScalarAsync(cs, """
            INSERT dbo.Client (ClientNumber, Name) VALUES ('00001', N'Client');
            INSERT dbo.MatterType (Name, SortOrder) VALUES (N'Litigation', 1), (N'Investigation', 2);
            INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name) SELECT ClientId, ClientNumber, '00001', N'M' FROM dbo.Client;
            INSERT dbo.MatterMatterType (MatterId, MatterTypeId) SELECT m.MatterId, t.MatterTypeId FROM dbo.Matter m CROSS JOIN dbo.MatterType t;
            """);
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.MatterMatterType")).ShouldBe(2);

        var twice = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.MatterMatterType (MatterId, MatterTypeId) SELECT TOP 1 MatterId, MatterTypeId FROM dbo.MatterMatterType"));
        twice.Message.ShouldContain("PK_MatterMatterType");
        var used = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "DELETE dbo.MatterType WHERE Name = N'Litigation'"));
        used.Message.ShouldContain("FK_MatterMatterType_MatterType");

        // The old column and its foreign key are gone from the rules: a stale value there does not block deleting an unused type.
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM sys.foreign_keys WHERE name = 'FK_Matter_MatterType'")).ShouldBe(0);
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Matter') AND name = 'MatterTypeId'")).ShouldBe(1);
    }
}
