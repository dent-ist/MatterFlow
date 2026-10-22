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
        // Script 27 then moves the technician-type role (Summary + Task.Assign, no department tab) to the unassigned queue only; the lead keeps Summary.
        (await GrantsAsync(cs, "Worker")).ShouldBe(["Dashboard.View", "Dashboard.ViewUnassigned", "Task.Assign", "Task.View"]);
        (await GrantsAsync(cs, "Viewer")).ShouldBe(["Dashboard.View", "Task.View"]);
        (await GrantsAsync(cs, "Custom")).ShouldBe(["Dashboard.View", "Task.View"]);

        // The built-in System Admin role holds everything implicitly and gets no rows; the old code and its grants are gone.
        (await ReadAsync(cs, "SELECT CAST(COUNT(*) AS VARCHAR(10)) FROM dbo.RolePermission rp JOIN dbo.Role r ON r.RoleId = rp.RoleId WHERE r.IsSystemAdmin = 1")).Single().ShouldBe(systemAdminRows);
        (await ReadAsync(cs, "SELECT Code FROM dbo.Permission WHERE Code = 'Dashboard.ViewDepartment'")).ShouldBeEmpty();

        // The new rows carry the catalog group, so the roles page lists them under Dashboard even before the startup sync.
        (await ReadAsync(cs, "SELECT Code FROM dbo.Permission WHERE GroupName = 'Dashboard' ORDER BY Code")).ShouldBe(["Dashboard.View", .. Tabs.Append("Dashboard.ViewCoverage").Append("Dashboard.ViewUnassigned").Order(StringComparer.Ordinal)]);
    }

    [Fact]
    public async Task A_fresh_database_gets_the_permission_rows_and_no_grants()
    {
        var cs = await sql.CreateDatabaseAsync();

        await RunAsync(cs, new EmbeddedMigrationScriptSource());

        (await ReadAsync(cs, "SELECT Code FROM dbo.Permission WHERE GroupName = 'Dashboard' ORDER BY Code")).Count.ShouldBe(8);
        (await ReadAsync(cs, "SELECT CAST(COUNT(*) AS VARCHAR(10)) FROM dbo.RolePermission")).Single().ShouldBe("0");
    }

    [Fact]
    public async Task The_coverage_permission_goes_to_Director_and_Pod_Lead_only_and_the_covering_index_exists()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new ScriptsBefore(25));
        await ExecAsync(cs, "INSERT dbo.Role (Name, IsActive) VALUES (N'Director', 1), (N'Pod Lead', 1), (N'Project Manager', 1), (N'Custom', 1);");

        await RunAsync(cs, new ScriptsBefore(28)); // script 28 grants other permissions to the same role names

        (await GrantsAsync(cs, "Director")).ShouldBe(["Dashboard.ViewCoverage"]);
        (await GrantsAsync(cs, "Pod Lead")).ShouldBe(["Dashboard.ViewCoverage"]);
        (await GrantsAsync(cs, "Project Manager")).ShouldBeEmpty();
        (await GrantsAsync(cs, "Custom")).ShouldBeEmpty();
        (await ReadAsync(cs, "SELECT name FROM sys.indexes WHERE name = 'IX_Task_CompletedCoverage'")).ShouldBe(["IX_Task_CompletedCoverage"]);
    }

    [Fact]
    public async Task Technician_type_roles_move_from_Summary_to_the_unassigned_queue_and_the_others_keep_Summary()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new ScriptsBefore(27));
        await ExecAsync(cs, """
            INSERT dbo.Permission (Code, GroupName, Description) VALUES
              ('Task.Assign', 'Task', N'Assign tasks'), ('Task.View', 'Task', N'View tasks');
            INSERT dbo.Role (Name, IsActive) VALUES (N'Technician', 1), (N'Project Manager', 1), (N'Pod Lead', 1), (N'Director', 1), (N'Observer', 1), (N'Custom', 1), (N'Summary only', 1);
            INSERT dbo.RolePermission (RoleId, PermissionId)
            SELECT r.RoleId, p.PermissionId FROM dbo.Role r JOIN dbo.Permission p ON
              (r.Name = N'Technician' AND p.Code IN ('Dashboard.View', 'Dashboard.ViewSummary', 'Task.Assign', 'Task.View'))
              OR (r.Name = N'Project Manager' AND p.Code IN ('Dashboard.View', 'Dashboard.ViewSummary', 'Dashboard.ViewSwimlane', 'Task.Assign', 'Task.View'))
              OR (r.Name = N'Pod Lead' AND p.Code IN ('Dashboard.View', 'Dashboard.ViewSummary', 'Dashboard.ViewUsers', 'Task.Assign', 'Task.View'))
              OR (r.Name = N'Director' AND p.Code IN ('Dashboard.View', 'Dashboard.ViewSummary', 'Dashboard.ViewBreakdowns', 'Dashboard.ViewTrends', 'Task.Assign', 'Task.View'))
              OR (r.Name = N'Observer' AND p.Code IN ('Dashboard.View', 'Dashboard.ViewSummary', 'Dashboard.ViewBreakdowns', 'Task.View'))
              OR (r.Name = N'Summary only' AND p.Code IN ('Dashboard.View', 'Dashboard.ViewSummary', 'Task.View'))
              OR (r.Name = N'Custom' AND p.Code IN ('Task.Assign', 'Task.View'));
            """);

        await RunAsync(cs, new ScriptsBefore(28)); // script 28 grants other permissions to the same role names

        (await GrantsAsync(cs, "Technician")).ShouldBe(["Dashboard.View", "Dashboard.ViewUnassigned", "Task.Assign", "Task.View"]);
        (await GrantsAsync(cs, "Project Manager")).ShouldBe(["Dashboard.View", "Dashboard.ViewSummary", "Dashboard.ViewSwimlane", "Task.Assign", "Task.View"]);
        (await GrantsAsync(cs, "Pod Lead")).ShouldBe(["Dashboard.View", "Dashboard.ViewSummary", "Dashboard.ViewUsers", "Task.Assign", "Task.View"]);
        (await GrantsAsync(cs, "Director")).ShouldBe(["Dashboard.View", "Dashboard.ViewBreakdowns", "Dashboard.ViewSummary", "Dashboard.ViewTrends", "Task.Assign", "Task.View"]);
        // No Task.Assign: nothing changes (Read-Only Observer, Compliance Auditor and any custom summary-only role keep their counts).
        (await GrantsAsync(cs, "Observer")).ShouldBe(["Dashboard.View", "Dashboard.ViewBreakdowns", "Dashboard.ViewSummary", "Task.View"]);
        (await GrantsAsync(cs, "Summary only")).ShouldBe(["Dashboard.View", "Dashboard.ViewSummary", "Task.View"]);
        (await GrantsAsync(cs, "Custom")).ShouldBe(["Task.Assign", "Task.View"]);
        (await ReadAsync(cs, "SELECT GroupName FROM dbo.Permission WHERE Code = 'Dashboard.ViewUnassigned'")).ShouldBe(["Dashboard"]);
    }
}
