using LptHub.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace LptHub.SchemaTests;

/// <summary>Script 81 (epic #1397, issue #1399): the Task Type access table, its constraints, the restriction flag, and who may read or change them.</summary>
[Collection(SqlServerCollection.Name)]
public class TaskTypeAccessSchemaTests(SqlServerFixture sql)
{
    private async Task<string> MigratedAsync()
    {
        var cs = await sql.CreateDatabaseAsync();
        await new SchemaMigrationRunner(cs, new EmbeddedMigrationScriptSource(), new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();
        await ScalarAsync(cs, "INSERT dbo.TaskType (Name) VALUES (N'Type A'), (N'Type B'); INSERT dbo.Role (Name) VALUES (N'Role X'), (N'Role Y');");
        return cs;
    }

    private static async Task<object?> ScalarAsync(string cs, string text)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = text;
        return await cmd.ExecuteScalarAsync();
    }

    private static async Task<string> FailureAsync(string cs, string text) => (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, text), text)).Message;

    private static async Task<string> LoginInRoleAsync(string adminConnectionString, string role)
    {
        var name = "t_" + Guid.NewGuid().ToString("N")[..10];
        const string password = "Pw_1234567890!ab";
        await ScalarAsync(adminConnectionString, $"CREATE LOGIN [{name}] WITH PASSWORD = '{password}', CHECK_POLICY = OFF");
        await ScalarAsync(adminConnectionString, $"CREATE USER [{name}] FOR LOGIN [{name}]; ALTER ROLE {role} ADD MEMBER [{name}];");
        return new SqlConnectionStringBuilder(adminConnectionString) { UserID = name, Password = password, IntegratedSecurity = false }.ConnectionString;
    }

    [Fact]
    public async Task Existing_task_types_start_unrestricted_and_the_flag_defaults_to_false()
    {
        var cs = await MigratedAsync();

        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.TaskType WHERE IsRestricted = 0")).ShouldBe(2);
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.TaskTypeRoleAccess")).ShouldBe(0);
    }

    [Fact]
    public async Task Edit_and_assign_imply_view_and_an_empty_row_is_refused()
    {
        var cs = await MigratedAsync();

        await ScalarAsync(cs, "INSERT dbo.TaskTypeRoleAccess (TaskTypeId, RoleId, CanView, CanEdit, CanAssign) VALUES (1, 1, 1, 1, 1), (1, 2, 1, 0, 0), (2, 1, 1, 0, 1)");
        (await FailureAsync(cs, "INSERT dbo.TaskTypeRoleAccess (TaskTypeId, RoleId, CanView, CanEdit) VALUES (2, 2, 0, 1)")).ShouldContain("CK_TaskTypeRoleAccess_Implies");
        (await FailureAsync(cs, "INSERT dbo.TaskTypeRoleAccess (TaskTypeId, RoleId, CanView, CanAssign) VALUES (2, 2, 0, 1)")).ShouldContain("CK_TaskTypeRoleAccess_Implies");
        (await FailureAsync(cs, "INSERT dbo.TaskTypeRoleAccess (TaskTypeId, RoleId, CanView, CanEdit, CanAssign) VALUES (2, 2, 0, 0, 0)")).ShouldContain("CK_TaskTypeRoleAccess_NotEmpty");
        (await FailureAsync(cs, "UPDATE dbo.TaskTypeRoleAccess SET CanView = 0 WHERE TaskTypeId = 1 AND RoleId = 1")).ShouldContain("CK_TaskTypeRoleAccess_Implies");
    }

    [Fact]
    public async Task A_role_appears_once_per_type_and_both_keys_must_exist()
    {
        var cs = await MigratedAsync();

        await ScalarAsync(cs, "INSERT dbo.TaskTypeRoleAccess (TaskTypeId, RoleId, CanView) VALUES (1, 1, 1)");
        (await FailureAsync(cs, "INSERT dbo.TaskTypeRoleAccess (TaskTypeId, RoleId, CanView) VALUES (1, 1, 1)")).ShouldContain("PK_TaskTypeRoleAccess");
        (await FailureAsync(cs, "INSERT dbo.TaskTypeRoleAccess (TaskTypeId, RoleId, CanView) VALUES (99, 1, 1)")).ShouldContain("FK_TaskTypeRoleAccess_TaskType");
        (await FailureAsync(cs, "INSERT dbo.TaskTypeRoleAccess (TaskTypeId, RoleId, CanView) VALUES (1, 99, 1)")).ShouldContain("FK_TaskTypeRoleAccess_Role");
        (await FailureAsync(cs, "DELETE dbo.Role WHERE RoleId = 1")).ShouldContain("FK_TaskTypeRoleAccess_Role");
    }

    [Fact]
    public async Task The_application_may_replace_the_lists_but_not_change_the_schema_and_the_report_login_cannot_read_the_table()
    {
        var admin = await MigratedAsync();
        var app = await LoginInRoleAsync(admin, "lpt_app");

        await ScalarAsync(app, "INSERT dbo.TaskTypeRoleAccess (TaskTypeId, RoleId, CanView) VALUES (1, 1, 1)");
        await ScalarAsync(app, "UPDATE dbo.TaskTypeRoleAccess SET CanEdit = 1 WHERE TaskTypeId = 1");
        await ScalarAsync(app, "UPDATE dbo.TaskType SET IsRestricted = 1 WHERE TaskTypeId = 1");
        await ScalarAsync(app, "DELETE dbo.TaskTypeRoleAccess WHERE TaskTypeId = 1");
        (await FailureAsync(app, "ALTER TABLE dbo.TaskTypeRoleAccess ADD X INT")).ShouldContain("permission");

        var reader = await LoginInRoleAsync(admin, "lpt_report_reader");
        (await FailureAsync(reader, "SELECT COUNT(*) FROM dbo.TaskTypeRoleAccess")).ShouldContain("permission was denied");
        (await ScalarAsync(reader, "SELECT COUNT(*) FROM dbo.TaskType WHERE IsRestricted = 0")).ShouldBe(1, "the report login may still read the flag column of dbo.TaskType");
    }
}
