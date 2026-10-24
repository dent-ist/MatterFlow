using System.Text.RegularExpressions;
using MatterFlow.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace MatterFlow.SchemaTests;

/// <summary>38-project-manager-no-dashboard.sql (epic #758, issue #764): the starter role loses the Dashboard grants only while it still equals the old starter definition.</summary>
[Collection(SqlServerCollection.Name)]
public class ProjectManagerNoDashboardSchemaTests(SqlServerFixture sql)
{
    private const string OldStarter = "Asset.Create Asset.Edit Asset.Link Asset.View Client.Create Client.Edit Client.EditNumber Client.View Matter.AssignManagers Matter.BeManager Matter.Create Matter.Edit Matter.EditNumber Matter.SetActive Matter.View Pod.View Project.Archive Project.Create Project.Edit Project.View Task.Assign Task.Cancel Task.ChangeStatus Task.Comment Task.Complete Task.Create Task.Edit Task.Reopen Task.SetPriority Task.View Workflow.Execute Workflow.StepReopen Dashboard.View Dashboard.ViewSummary Dashboard.ViewSwimlane";
    private const string OldDescription = "Manages clients, matters and projects, can be named as a matter's project manager; sees the Dashboard summary and swimlane.";

    private sealed class ScriptsBefore(int number) : IMigrationScriptSource
    {
        public IReadOnlyList<(string Name, string Content)> ReadAll() =>
            [.. new EmbeddedMigrationScriptSource().ReadAll().Where(s => int.Parse(Regex.Match(s.Name, @"^\d+").Value) < number)];
    }

    private static Task RunAsync(string cs, IMigrationScriptSource source) =>
        new SchemaMigrationRunner(cs, source, new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();

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

    private static async Task ExecAsync(string cs, string sqlText)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = sqlText;
        await cmd.ExecuteNonQueryAsync();
    }

    private static Task<List<string>> GrantsAsync(string cs, string role) =>
        ReadAsync(cs, $"SELECT p.Code FROM dbo.RolePermission rp JOIN dbo.Role r ON r.RoleId = rp.RoleId JOIN dbo.Permission p ON p.PermissionId = rp.PermissionId WHERE r.Name = N'{role}' ORDER BY p.Code");

    private static string Grant(string role, IEnumerable<string> codes) =>
        $"INSERT dbo.RolePermission (RoleId, PermissionId) SELECT r.RoleId, p.PermissionId FROM dbo.Role r JOIN dbo.Permission p ON p.Code IN ({string.Join(", ", codes.Select(c => "'" + c + "'"))}) WHERE r.Name = N'{role}';";

    private static string[] Codes(string extra = "") => [.. (OldStarter + " " + extra).Split(' ', StringSplitOptions.RemoveEmptyEntries)];

    private async Task<string> DatabaseBefore38Async(params (string Name, string Description, string[] Codes)[] roles)
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new ScriptsBefore(38));
        foreach (var (name, description, codes) in roles)
        {
            await ExecAsync(cs, $"INSERT dbo.Role (Name, Description, IsActive) VALUES (N'{name}', N'{description.Replace("'", "''")}', 1);");
            var all = codes.Except(await ReadAsync(cs, "SELECT Code FROM dbo.Permission")).ToList();
            foreach (var code in all)
                await ExecAsync(cs, $"INSERT dbo.Permission (Code, GroupName, Description, IsActive) VALUES ('{code}', 'Test', N'{code}', 1);");
            await ExecAsync(cs, Grant(name, codes));
        }

        return cs;
    }

    [Fact]
    public async Task The_starter_role_loses_the_three_Dashboard_grants_and_the_old_description_once()
    {
        var cs = await DatabaseBefore38Async(("Project Manager", OldDescription, Codes()));

        await RunAsync(cs, new EmbeddedMigrationScriptSource());

        var grants = await GrantsAsync(cs, "Project Manager");
        grants.ShouldNotContain("Dashboard.View");
        grants.ShouldNotContain("Dashboard.ViewSummary");
        grants.ShouldNotContain("Dashboard.ViewSwimlane");
        grants.Count.ShouldBe(Codes().Length - 3);
        (await ReadAsync(cs, "SELECT Description FROM dbo.Role WHERE Name = N'Project Manager'")).ShouldBe(["Manages clients, matters and projects, can be named as a matter's project manager; works from My Matters."]);

        await RunAsync(cs, new EmbeddedMigrationScriptSource()); // nothing left to apply: the runner is idempotent too
        (await GrantsAsync(cs, "Project Manager")).Count.ShouldBe(Codes().Length - 3);
    }

    [Fact]
    public async Task A_customised_role_a_renamed_role_and_a_role_with_a_dashboard_tab_added_are_left_alone()
    {
        var cs = await DatabaseBefore38Async(
            ("Project Manager", "Edited by an administrator", Codes("Audit.View")), // one permission added
            ("Renamed PM", OldDescription, Codes()), // not named Project Manager
            ("Other", OldDescription, Codes()));
        // A second database: the starter role with a permission taken away.
        var cs2 = await DatabaseBefore38Async(("Project Manager", OldDescription, [.. Codes().Where(c => c != "Task.Cancel")]));
        // A third: a Dashboard tab granted on top.
        var cs3 = await DatabaseBefore38Async(("Project Manager", OldDescription, Codes("Dashboard.ViewBreakdowns")));

        await RunAsync(cs, new EmbeddedMigrationScriptSource());
        await RunAsync(cs2, new EmbeddedMigrationScriptSource());
        await RunAsync(cs3, new EmbeddedMigrationScriptSource());

        (await GrantsAsync(cs, "Project Manager")).ShouldContain("Dashboard.View");
        (await GrantsAsync(cs, "Project Manager")).ShouldContain("Audit.View");
        (await GrantsAsync(cs, "Renamed PM")).Count.ShouldBe(Codes().Length);
        (await GrantsAsync(cs, "Other")).Count.ShouldBe(Codes().Length);
        (await GrantsAsync(cs2, "Project Manager")).ShouldContain("Dashboard.ViewSummary");
        (await GrantsAsync(cs3, "Project Manager")).ShouldContain("Dashboard.ViewBreakdowns");
        (await GrantsAsync(cs3, "Project Manager")).ShouldContain("Dashboard.ViewSwimlane");
        (await ReadAsync(cs, "SELECT Description FROM dbo.Role WHERE Name = N'Project Manager'")).ShouldBe(["Edited by an administrator"]);
        (await ReadAsync(cs, "SELECT Description FROM dbo.Role WHERE Name = N'Renamed PM'")).ShouldBe([OldDescription]);
    }

    [Fact]
    public async Task A_database_without_the_role_is_fine()
    {
        var cs = await DatabaseBefore38Async();

        await Should.NotThrowAsync(() => RunAsync(cs, new EmbeddedMigrationScriptSource()));
    }
}
