using System.Text.RegularExpressions;
using MatterFlow.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace MatterFlow.SchemaTests;

/// <summary>66-director-be-manager.sql (Identity #976, owner decision 2026-11-07): the starter role "Director" gets Matter.BeManager in an existing database, nothing else changes.</summary>
[Collection(SqlServerCollection.Name)]
public class DirectorBeManagerMigrationTests(SqlServerFixture sql)
{
    private const string DirectorDescription = "Department head: full operational access plus oversight.";

    private sealed class ScriptsBefore(int number) : IMigrationScriptSource
    {
        public IReadOnlyList<(string Name, string Content)> ReadAll() =>
            [.. new EmbeddedMigrationScriptSource().ReadAll().Where(s => int.Parse(Regex.Match(s.Name, @"^\d+").Value) < number)];
    }

    private static Task RunAsync(string cs, IMigrationScriptSource source) =>
        new SchemaMigrationRunner(cs, source, new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();

    private static async Task ExecAsync(string cs, string sqlText)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = sqlText;
        await cmd.ExecuteNonQueryAsync();
    }

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

    private static Task<List<string>> HoldersAsync(string cs) =>
        ReadAsync(cs, "SELECT r.Name FROM dbo.RolePermission rp JOIN dbo.Role r ON r.RoleId = rp.RoleId JOIN dbo.Permission p ON p.PermissionId = rp.PermissionId WHERE p.Code = 'Matter.BeManager' ORDER BY r.Name");

    private static async Task<string> CountAsync(string cs, string sqlText) => (await ReadAsync(cs, sqlText)).Single();

    private const string Seed = """
        INSERT dbo.Role (Name, Description, IsActive) VALUES
          (N'Project Manager', N'Manages clients, matters and projects, can be named as a matter''s project manager; works from My Matters.', 1),
          (N'Director', N'DESC', 1), (N'Director (copy)', N'DESC', 1), (N'Pod Lead', N'Leads a pod', 1), (N'Data Technician', N'Works tasks', 1), (N'Custom', N'Mine', 1);
        INSERT dbo.RolePermission (RoleId, PermissionId) SELECT r.RoleId, p.PermissionId FROM dbo.Role r CROSS JOIN dbo.Permission p
          WHERE r.Name = N'Project Manager' AND p.Code = 'Matter.BeManager';
        """;

    [Fact]
    public async Task The_starter_Director_role_gets_Matter_BeManager_and_no_other_role_changes()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new ScriptsBefore(66));
        await ExecAsync(cs, Seed.Replace("DESC", DirectorDescription));
        (await HoldersAsync(cs)).ShouldBe(["Project Manager"]);
        var before = await CountAsync(cs, "SELECT CAST(COUNT(*) AS VARCHAR(10)) FROM dbo.RolePermission");

        await RunAsync(cs, new EmbeddedMigrationScriptSource());

        // Only the role named "Director" is added; the copy (not the exact name), other starter roles and the built-in System Admin role are not touched.
        (await HoldersAsync(cs)).ShouldBe(["Director", "Project Manager"]);
        (await CountAsync(cs, "SELECT CAST(COUNT(*) AS VARCHAR(10)) FROM dbo.RolePermission")).ShouldBe((int.Parse(before) + 1).ToString());
        (await CountAsync(cs, "SELECT CAST(COUNT(*) AS VARCHAR(10)) FROM dbo.Permission WHERE Code = 'Matter.BeManager'")).ShouldBe("1");
    }

    [Fact]
    public async Task A_customised_Director_role_is_left_alone_and_a_missing_one_is_no_error()
    {
        var customised = await sql.CreateDatabaseAsync();
        await RunAsync(customised, new ScriptsBefore(66));
        await ExecAsync(customised, "INSERT dbo.Role (Name, Description, IsActive) VALUES (N'Director', N'Our own directors', 1);");
        await RunAsync(customised, new EmbeddedMigrationScriptSource());
        (await HoldersAsync(customised)).ShouldBeEmpty();

        var none = await sql.CreateDatabaseAsync();
        await RunAsync(none, new EmbeddedMigrationScriptSource());
        (await HoldersAsync(none)).ShouldBeEmpty();
    }

    [Fact]
    public async Task A_Director_that_already_holds_the_permission_is_not_granted_twice_and_a_second_run_changes_nothing()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new ScriptsBefore(66));
        await ExecAsync(cs, $"""
            INSERT dbo.Role (Name, Description, IsActive) VALUES (N'Director', N'{DirectorDescription}', 1);
            INSERT dbo.RolePermission (RoleId, PermissionId) SELECT r.RoleId, p.PermissionId FROM dbo.Role r CROSS JOIN dbo.Permission p WHERE r.Name = N'Director' AND p.Code = 'Matter.BeManager';
            """);

        await RunAsync(cs, new EmbeddedMigrationScriptSource());
        await RunAsync(cs, new EmbeddedMigrationScriptSource());

        (await HoldersAsync(cs)).ShouldBe(["Director"]);
        (await CountAsync(cs, "SELECT CAST(COUNT(*) AS VARCHAR(10)) FROM dbo.RolePermission")).ShouldBe("1");
    }
}
