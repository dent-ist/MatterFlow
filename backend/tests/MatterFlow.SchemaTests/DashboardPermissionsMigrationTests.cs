using System.Text.RegularExpressions;
using MatterFlow.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace MatterFlow.SchemaTests;

/// <summary>24-dashboard-permissions.sql: Dashboard.ViewDepartment becomes Dashboard.View plus one permission per tab, and nobody loses access.</summary>
[Collection(SqlServerCollection.Name)]
public class DashboardPermissionsMigrationTests(SqlServerFixture sql)
{
    private static readonly string[] Tabs = ["Dashboard.ViewSummary", "Dashboard.ViewBreakdowns", "Dashboard.ViewTrends", "Dashboard.ViewSwimlane", "Dashboard.ViewUsers"];

    /// <summary>The embedded scripts below a number, so the database can be filled the way a release before this one left it.</summary>
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

    private static Task<List<string>> GrantsAsync(string cs, string role) =>
        ReadAsync(cs, $"SELECT p.Code FROM dbo.RolePermission rp JOIN dbo.Role r ON r.RoleId = rp.RoleId JOIN dbo.Permission p ON p.PermissionId = rp.PermissionId WHERE r.Name = N'{role}' ORDER BY p.Code");

    [Fact]
    public async Task Existing_grants_are_moved_so_nobody_loses_access()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new ScriptsBefore(24));

        // The way release N-1 left it: the old code, Task.Assign, and roles that hold them in different mixes.
        await ExecAsync(cs, """
            INSERT dbo.Permission (Code, GroupName, Description) VALUES
              ('Dashboard.ViewDepartment', 'Oversight', N'View the department dashboard'),
              ('Task.Assign', 'Task', N'Assign tasks'),
              ('Task.View', 'Task', N'View tasks');
            INSERT dbo.Role (Name, IsActive) VALUES (N'Lead', 1), (N'Worker', 1), (N'Viewer', 1), (N'Retired lead', 0), (N'Custom', 1);
            INSERT dbo.RolePermission (RoleId, PermissionId)
            SELECT r.RoleId, p.PermissionId FROM dbo.Role r JOIN dbo.Permission p ON
              (r.Name = N'Lead' AND p.Code IN ('Dashboard.ViewDepartment', 'Task.Assign', 'Task.View'))
              OR (r.Name = N'Worker' AND p.Code IN ('Task.Assign', 'Task.View'))
              OR (r.Name = N'Viewer' AND p.Code = 'Task.View')
              OR (r.Name = N'Retired lead' AND p.Code = 'Dashboard.ViewDepartment')
              OR (r.Name = N'Custom' AND p.Code = 'Task.View');
            """);
        var systemAdminRows = (await ReadAsync(cs, "SELECT CAST(COUNT(*) AS VARCHAR(10)) FROM dbo.RolePermission rp JOIN dbo.Role r ON r.RoleId = rp.RoleId WHERE r.IsSystemAdmin = 1")).Single();

        await RunAsync(cs, new EmbeddedMigrationScriptSource());

        // Everyone gets Dashboard.View; holders of the old right get every tab; Task.Assign brings Summary.
        (await GrantsAsync(cs, "Lead")).ShouldBe(["Dashboard.View", .. Tabs.Order(StringComparer.Ordinal), "Task.Assign", "Task.View"]);
        (await GrantsAsync(cs, "Retired lead")).ShouldBe(["Dashboard.View", .. Tabs.Order(StringComparer.Ordinal)]);
        (await GrantsAsync(cs, "Worker")).ShouldBe(["Dashboard.View", "Dashboard.ViewSummary", "Task.Assign", "Task.View"]);
        (await GrantsAsync(cs, "Viewer")).ShouldBe(["Dashboard.View", "Task.View"]);
        (await GrantsAsync(cs, "Custom")).ShouldBe(["Dashboard.View", "Task.View"]);

        // The built-in System Admin role holds everything implicitly and gets no rows; the old code and its grants are gone.
        (await ReadAsync(cs, "SELECT CAST(COUNT(*) AS VARCHAR(10)) FROM dbo.RolePermission rp JOIN dbo.Role r ON r.RoleId = rp.RoleId WHERE r.IsSystemAdmin = 1")).Single().ShouldBe(systemAdminRows);
        (await ReadAsync(cs, "SELECT Code FROM dbo.Permission WHERE Code = 'Dashboard.ViewDepartment'")).ShouldBeEmpty();

        // The new rows carry the catalog group, so the roles page lists them under Dashboard even before the startup sync.
        (await ReadAsync(cs, "SELECT Code FROM dbo.Permission WHERE GroupName = 'Dashboard' ORDER BY Code")).ShouldBe(["Dashboard.View", .. Tabs.Order(StringComparer.Ordinal)]);
    }

    [Fact]
    public async Task A_fresh_database_gets_the_permission_rows_and_no_grants()
    {
        var cs = await sql.CreateDatabaseAsync();

        await RunAsync(cs, new EmbeddedMigrationScriptSource());

        (await ReadAsync(cs, "SELECT Code FROM dbo.Permission WHERE GroupName = 'Dashboard' ORDER BY Code")).Count.ShouldBe(6);
        (await ReadAsync(cs, "SELECT CAST(COUNT(*) AS VARCHAR(10)) FROM dbo.RolePermission")).Single().ShouldBe("0");
    }
}
