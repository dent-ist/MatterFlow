using LptHub.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace LptHub.SchemaTests;

/// <summary>Script 67 (epic #1330, issue #1332): dbo.Role.LandingPage is a nullable varchar(40) key with a shape check; the starter defaults are set only on untouched starter roles.</summary>
[Collection(SqlServerCollection.Name)]
public class RoleLandingPageSchemaTests(SqlServerFixture sql)
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
    public async Task The_column_is_a_nullable_varchar_40_and_only_a_key_shaped_value_is_accepted()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new EmbeddedMigrationScriptSource());

        (await ScalarAsync(cs, "SELECT CONCAT(t.name, ',', c.max_length, ',', c.is_nullable) FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id WHERE c.object_id = OBJECT_ID('dbo.Role') AND c.name = 'LandingPage'"))
            .ShouldBe("varchar,40,1");
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.Role WHERE LandingPage IS NOT NULL")).ShouldBe(0);

        await ScalarAsync(cs, "INSERT dbo.Role (Name, LandingPage) VALUES (N'ok-1', 'my-matters'), (N'ok-2', NULL)");
        foreach (var bad in new[] { "", "Dashboard", "/dashboard", "my work", "a_b" })
        {
            var ex = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, $"INSERT dbo.Role (Name, LandingPage) VALUES (N'bad', '{bad}')"));
            ex.Message.ShouldContain("CK_Role_LandingPage", Case.Insensitive, bad);
        }
    }

    [Fact]
    public async Task The_script_gives_Director_and_Project_Manager_their_defaults_only_while_they_are_untouched_starter_roles()
    {
        var cs = await sql.CreateDatabaseAsync();
        var all = new EmbeddedMigrationScriptSource().ReadAll();
        await RunAsync(cs, new InMemoryMigrationScriptSource(all.Where(s => s.Name == SchemaMigrationRunner.BaselineScriptName)));
        await ScalarAsync(cs, """
            INSERT dbo.Role (Name, Description) VALUES
              (N'Director', N'Department head: full operational access plus oversight.'),
              (N'Project Manager', N'Manages clients, matters and projects, can be named as a matter''s project manager; works from My Matters.'),
              (N'Pod Lead', N'Leads a pod: manages pod members; sees the Dashboard summary, swimlane and team workload.');
            """);
        await RunAsync(cs, new EmbeddedMigrationScriptSource());

        (await ScalarAsync(cs, "SELECT LandingPage FROM dbo.Role WHERE Name = N'Director'")).ShouldBe("dashboard");
        (await ScalarAsync(cs, "SELECT LandingPage FROM dbo.Role WHERE Name = N'Project Manager'")).ShouldBe("my-matters");
        (await ScalarAsync(cs, "SELECT LandingPage FROM dbo.Role WHERE Name = N'Pod Lead'")).ShouldBe(DBNull.Value);

        // A customised Director (changed description) is left alone.
        var other = await sql.CreateDatabaseAsync();
        await RunAsync(other, new InMemoryMigrationScriptSource(all.Where(s => s.Name == SchemaMigrationRunner.BaselineScriptName)));
        await ScalarAsync(other, "INSERT dbo.Role (Name, Description) VALUES (N'Director', N'My own description')");
        await RunAsync(other, new EmbeddedMigrationScriptSource());
        (await ScalarAsync(other, "SELECT LandingPage FROM dbo.Role WHERE Name = N'Director'")).ShouldBe(DBNull.Value);
    }
}
