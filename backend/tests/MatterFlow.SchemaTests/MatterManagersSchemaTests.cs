using System.Text.RegularExpressions;
using MatterFlow.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace MatterFlow.SchemaTests;

/// <summary>28-matter-managers.sql (epic #667): the two optional manager columns of Matter, their constraints and indexes, and the grants of the two new permissions.</summary>
[Collection(SqlServerCollection.Name)]
public class MatterManagersSchemaTests(SqlServerFixture sql)
{
    private sealed class ScriptsBefore(int number) : IMigrationScriptSource
    {
        public IReadOnlyList<(string Name, string Content)> ReadAll() =>
            [.. new EmbeddedMigrationScriptSource().ReadAll().Where(s => int.Parse(Regex.Match(s.Name, @"^\d+").Value) < number)];
    }

    private static Task RunAsync(string cs, IMigrationScriptSource source) =>
        new SchemaMigrationRunner(cs, source, new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();

    private async Task<string> MigratedAsync()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new EmbeddedMigrationScriptSource());
        await ExecAsync(cs, """
            INSERT dbo.AppUser (DisplayName) VALUES (N'Ann'), (N'Bob');
            INSERT dbo.Client (ClientNumber, Name) VALUES ('00343', N'Acme');
            INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name) VALUES (1, '00343', '00012', N'One');
            """);
        return cs;
    }

    private static async Task<int> ExecAsync(string cs, string sqlText)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = sqlText;
        return Convert.ToInt32(await cmd.ExecuteScalarAsync() ?? 0);
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

    private static async Task ShouldRejectAsync(string cs, string sqlText, string expected)
    {
        var ex = await Should.ThrowAsync<SqlException>(() => ExecAsync(cs, sqlText));
        ex.Message.ShouldContain(expected, Case.Insensitive, sqlText);
    }

    private static Task<List<string>> GrantsAsync(string cs, string role) =>
        ReadAsync(cs, $"SELECT p.Code FROM dbo.RolePermission rp JOIN dbo.Role r ON r.RoleId = rp.RoleId JOIN dbo.Permission p ON p.PermissionId = rp.PermissionId WHERE r.Name = N'{role}' AND p.Code LIKE 'Matter.%Manager%' ORDER BY p.Code");

    [Fact]
    public async Task Both_columns_are_nullable_and_existing_matters_have_no_manager()
    {
        var cs = await MigratedAsync();

        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Matter') AND name IN ('PrimaryManagerId','SecondaryManagerId') AND is_nullable = 1")).ShouldBe(2);
        (await ExecAsync(cs, "SELECT COUNT(*) FROM dbo.Matter WHERE PrimaryManagerId IS NULL AND SecondaryManagerId IS NULL")).ShouldBe(1);
    }

    [Fact]
    public async Task Any_mix_of_set_and_empty_is_allowed_but_not_the_same_person_twice()
    {
        var cs = await MigratedAsync();

        await ExecAsync(cs, "UPDATE dbo.Matter SET PrimaryManagerId = 1;");
        await ExecAsync(cs, "UPDATE dbo.Matter SET PrimaryManagerId = NULL, SecondaryManagerId = 2;"); // a Secondary without a Primary is allowed
        await ExecAsync(cs, "UPDATE dbo.Matter SET PrimaryManagerId = 1, SecondaryManagerId = 2;");
        await ShouldRejectAsync(cs, "UPDATE dbo.Matter SET PrimaryManagerId = 2, SecondaryManagerId = 2;", "CK_Matter_ManagersDiffer");
    }

    [Fact]
    public async Task Managers_must_be_real_users()
    {
        var cs = await MigratedAsync();

        await ShouldRejectAsync(cs, "UPDATE dbo.Matter SET PrimaryManagerId = 99;", "FK_Matter_PrimaryManager");
        await ShouldRejectAsync(cs, "UPDATE dbo.Matter SET SecondaryManagerId = 99;", "FK_Matter_SecondaryManager");
        // No cascade, like the other user references: a user who has a matter cannot be deleted.
        await ExecAsync(cs, "UPDATE dbo.Matter SET PrimaryManagerId = 1;");
        await ShouldRejectAsync(cs, "DELETE dbo.AppUser WHERE UserId = 1;", "FK_Matter_PrimaryManager");
    }

    [Fact]
    public async Task The_two_filtered_indexes_exist()
    {
        var cs = await MigratedAsync();

        (await ReadAsync(cs, "SELECT name + '|' + filter_definition FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.Matter') AND name IN ('IX_Matter_PrimaryManager','IX_Matter_SecondaryManager') ORDER BY name"))
            .ShouldBe(["IX_Matter_PrimaryManager|([PrimaryManagerId] IS NOT NULL)", "IX_Matter_SecondaryManager|([SecondaryManagerId] IS NOT NULL)"]);
    }

    [Fact]
    public async Task The_permissions_go_to_Project_Manager_and_Director_only_and_custom_roles_are_left_alone()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new ScriptsBefore(28));
        await ExecAsync(cs, """
            INSERT dbo.Role (Name, Description, IsActive) VALUES
              (N'Project Manager', N'Manages clients, matters and projects; sees the Dashboard summary and swimlane.', 1),
              (N'Director', N'Department head', 1), (N'Pod Lead', N'Leads a pod', 1), (N'Custom', N'My own role', 1),
              (N'Renamed PM', N'Manages clients, matters and projects; sees the Dashboard summary and swimlane.', 1);
            """);

        await RunAsync(cs, new EmbeddedMigrationScriptSource());
        await RunAsync(cs, new EmbeddedMigrationScriptSource()); // nothing more to apply: the runner is idempotent too

        (await GrantsAsync(cs, "Project Manager")).ShouldBe(["Matter.AssignManagers", "Matter.BeManager"]);
        (await GrantsAsync(cs, "Director")).ShouldBe(["Matter.AssignManagers"]);
        (await GrantsAsync(cs, "Pod Lead")).ShouldBeEmpty();
        (await GrantsAsync(cs, "Custom")).ShouldBeEmpty();
        (await GrantsAsync(cs, "Renamed PM")).ShouldBeEmpty();
        (await ReadAsync(cs, "SELECT Description FROM dbo.Role WHERE Name = N'Project Manager'")).Single().ShouldContain("can be named as a matter's project manager");
        (await ReadAsync(cs, "SELECT Description FROM dbo.Role WHERE Name = N'Custom'")).Single().ShouldBe("My own role");
        (await ReadAsync(cs, "SELECT Code FROM dbo.Permission WHERE GroupName = 'Client/Matter' AND Code LIKE 'Matter.%Manager%' ORDER BY Code")).ShouldBe(["Matter.AssignManagers", "Matter.BeManager"]);
    }
}
