using LptHub.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace LptHub.SchemaTests;

/// <summary>Scripts 68 and 70 (epic #1368, issues #1369, #1380): dbo.MatterCategory (starter rows from script 70, unique non-blank name) and the optional dbo.Matter.MatterCategoryId.</summary>
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
    public async Task The_list_starts_with_the_starter_categories_names_are_unique_and_not_blank_and_the_matter_column_is_nullable()
    {
        var cs = await MigratedAsync();
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.MatterCategory")).ShouldBe(7); // script 70
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
        await ScalarAsync(cs, "INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name, MatterCategoryId) SELECT ClientId, ClientNumber, '00001', N'M', (SELECT MatterCategoryId FROM dbo.MatterCategory WHERE Name = N'Advisory') FROM dbo.Client");
        var ex = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "DELETE dbo.MatterCategory"));
        ex.Message.ShouldContain("FK_Matter_MatterCategory");
    }

    [Fact]
    public async Task Script_70_seeds_the_seven_starter_categories_in_order_and_never_touches_an_administrators_list()
    {
        var cs = await MigratedAsync();
        (await ScalarAsync(cs, "SELECT STRING_AGG(Name, ', ') WITHIN GROUP (ORDER BY SortOrder) FROM dbo.MatterCategory"))
            .ShouldBe("Litigation, Investigation, Regulatory Inquiry, Arbitration, Second Request, Internal Review, Other");

        // A database whose list the administrator already changed (everything deleted, one own item) keeps exactly that list.
        var own = await sql.CreateDatabaseAsync();
        var all = new EmbeddedMigrationScriptSource().ReadAll();
        await new SchemaMigrationRunner(own, new InMemoryMigrationScriptSource(all.Where(s => !s.Name.StartsWith("70-", StringComparison.Ordinal))), new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();
        await ScalarAsync(own, "INSERT dbo.MatterCategory (Name, SortOrder) VALUES (N'Mine', 1)");
        await new SchemaMigrationRunner(own, new EmbeddedMigrationScriptSource(), new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();
        (await ScalarAsync(own, "SELECT STRING_AGG(Name, ', ') FROM dbo.MatterCategory")).ShouldBe("Mine");
    }
}
