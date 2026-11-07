using System.Text.RegularExpressions;
using MatterFlow.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace MatterFlow.SchemaTests;

/// <summary>61-project-manager-report-run.sql (Reports, owner decision 8): the starter role "Project Manager" gets Report.Run in an existing database, nobody else does.</summary>
[Collection(SqlServerCollection.Name)]
public class ProjectManagerReportRunMigrationTests(SqlServerFixture sql)
{
    private const string StarterDescription = "Manages clients, matters and projects, can be named as a matter''s project manager; works from My Matters.";

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
        ReadAsync(cs, "SELECT r.Name FROM dbo.RolePermission rp JOIN dbo.Role r ON r.RoleId = rp.RoleId JOIN dbo.Permission p ON p.PermissionId = rp.PermissionId WHERE p.Code = 'Report.Run' ORDER BY r.Name");

    [Fact]
    public async Task The_starter_Project_Manager_role_gets_Report_Run_and_no_other_role_does()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new ScriptsBefore(61));
        await ExecAsync(cs, $"""
            INSERT dbo.Role (Name, Description, IsActive) VALUES
              (N'Project Manager', N'{StarterDescription}', 1), (N'Director', N'Department head', 1), (N'Pod Lead', N'Leads a pod', 1),
              (N'Data Technician', N'Works tasks', 1), (N'Project Manager (copy)', N'{StarterDescription}', 1), (N'Custom', N'Mine', 1);
            """);
        (await HoldersAsync(cs)).ShouldBeEmpty();

        await RunAsync(cs, new EmbeddedMigrationScriptSource());

        (await HoldersAsync(cs)).ShouldBe(["Project Manager"]);
        (await ReadAsync(cs, "SELECT GroupName FROM dbo.Permission WHERE Code = 'Report.Run'")).ShouldBe(["Reports"]);
        // The built-in System Admin role holds every permission implicitly and gets no row; no report is assigned to any role by the script.
        (await ReadAsync(cs, "SELECT CAST(COUNT(*) AS VARCHAR(10)) FROM dbo.RoleReport")).Single().ShouldBe("0");
    }

    [Fact]
    public async Task A_customised_Project_Manager_role_is_left_alone_and_a_missing_one_is_no_error()
    {
        var customised = await sql.CreateDatabaseAsync();
        await RunAsync(customised, new ScriptsBefore(61));
        await ExecAsync(customised, "INSERT dbo.Role (Name, Description, IsActive) VALUES (N'Project Manager', N'Our own managers', 1);");
        await RunAsync(customised, new EmbeddedMigrationScriptSource());
        (await HoldersAsync(customised)).ShouldBeEmpty();

        var none = await sql.CreateDatabaseAsync();
        await RunAsync(none, new EmbeddedMigrationScriptSource());
        (await HoldersAsync(none)).ShouldBeEmpty();
        // The permission row exists for the grants of the role editor even before the startup sync.
        (await ReadAsync(none, "SELECT Code FROM dbo.Permission WHERE Code = 'Report.Run'")).ShouldBe(["Report.Run"]);
    }

    [Fact]
    public async Task A_role_that_already_holds_the_permission_is_not_granted_twice()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new ScriptsBefore(61));
        await ExecAsync(cs, $"""
            INSERT dbo.Permission (Code, GroupName, Description, IsActive) VALUES ('Report.Run', 'Reports', N'Run the reports assigned to your roles, keep personal views and download the result as CSV', 1);
            INSERT dbo.Role (Name, Description, IsActive) VALUES (N'Project Manager', N'{StarterDescription}', 1);
            INSERT dbo.RolePermission (RoleId, PermissionId) SELECT r.RoleId, p.PermissionId FROM dbo.Role r CROSS JOIN dbo.Permission p WHERE r.Name = N'Project Manager' AND p.Code = 'Report.Run';
            """);

        await RunAsync(cs, new EmbeddedMigrationScriptSource());

        (await HoldersAsync(cs)).ShouldBe(["Project Manager"]);
        (await ReadAsync(cs, "SELECT CAST(COUNT(*) AS VARCHAR(10)) FROM dbo.Permission WHERE Code = 'Report.Run'")).Single().ShouldBe("1");
    }
}
