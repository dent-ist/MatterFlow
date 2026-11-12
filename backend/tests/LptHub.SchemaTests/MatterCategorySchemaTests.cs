using LptHub.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace LptHub.SchemaTests;

/// <summary>Script 68 (epic #1368, issue #1369): dbo.MatterCategory (no starter rows, unique non-blank name) and the optional dbo.Matter.MatterCategoryId.</summary>
[Collection(SqlServerCollection.Name)]
public class MatterCategorySchemaTests(SqlServerFixture sql)
{
    private static async Task<object?> ScalarAsync(string cs, string text)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = text;
        return await cmd.ExecuteScalarAsync();
    }

    private async Task<string> MigratedAsync()
    {
        var cs = await sql.CreateDatabaseAsync();
        await new SchemaMigrationRunner(cs, new EmbeddedMigrationScriptSource(), new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();
        return cs;
    }

    [Fact]
    public async Task The_list_starts_empty_names_are_unique_and_not_blank_and_the_matter_column_is_nullable()
    {
        var cs = await MigratedAsync();
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.MatterCategory")).ShouldBe(0);
        (await ScalarAsync(cs, "SELECT c.is_nullable FROM sys.columns c WHERE c.object_id = OBJECT_ID('dbo.Matter') AND c.name = 'MatterCategoryId'")).ShouldBe(true);

        await ScalarAsync(cs, "INSERT dbo.MatterCategory (Name, SortOrder) VALUES (N'Advisory', 1)");
        var duplicate = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.MatterCategory (Name, SortOrder) VALUES (N'ADVISORY', 2)"));
        duplicate.Message.ShouldContain("UQ_MatterCategory_Name");
        var blank = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.MatterCategory (Name, SortOrder) VALUES (N'   ', 2)"));
        blank.Message.ShouldContain("CK_MatterCategory_Name");
    }

    [Fact]
    public async Task A_category_a_matter_uses_cannot_be_deleted()
    {
        var cs = await MigratedAsync();
        await ScalarAsync(cs, "INSERT dbo.Client (ClientNumber, Name) VALUES ('00001', N'Client')");
        await ScalarAsync(cs, "INSERT dbo.MatterCategory (Name, SortOrder) VALUES (N'Advisory', 1)");
        await ScalarAsync(cs, "INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name, MatterCategoryId) SELECT ClientId, ClientNumber, '00001', N'M', (SELECT MatterCategoryId FROM dbo.MatterCategory) FROM dbo.Client");
        var ex = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "DELETE dbo.MatterCategory"));
        ex.Message.ShouldContain("FK_Matter_MatterCategory");
    }
}
