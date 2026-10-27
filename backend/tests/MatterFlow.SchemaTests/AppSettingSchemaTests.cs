using MatterFlow.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace MatterFlow.SchemaTests;

/// <summary>48-app-settings.sql (epic #850, BR-01): the permission row, dbo.AppSetting with its checks, and the grants.</summary>
[Collection(SqlServerCollection.Name)]
public class AppSettingSchemaTests(SqlServerFixture sql)
{
    private static Task RunAsync(string cs) =>
        new SchemaMigrationRunner(cs, new EmbeddedMigrationScriptSource(), new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();

    private static async Task<object?> ScalarAsync(string cs, string sqlText)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = sqlText;
        return await cmd.ExecuteScalarAsync();
    }

    private static async Task<int> UserIdAsync(string cs)
    {
        return (int)(await ScalarAsync(cs, "INSERT dbo.AppUser (DisplayName, IsActive) VALUES (N'Settings Admin', 1); SELECT CAST(SCOPE_IDENTITY() AS INT);"))!;
    }

    [Fact]
    public async Task The_script_adds_the_permission_row_without_any_role_grant()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs);

        (await ScalarAsync(cs, "SELECT GroupName FROM dbo.Permission WHERE Code = 'Settings.Manage'")).ShouldBe("Administration");
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.RolePermission rp JOIN dbo.Permission p ON p.PermissionId = rp.PermissionId WHERE p.Code = 'Settings.Manage'")).ShouldBe(0);
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.AppSetting")).ShouldBe(0); // no seed row: defaults live in code
    }

    [Fact]
    public async Task A_text_row_and_a_binary_row_can_be_stored_and_the_checks_hold()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs);
        var user = await UserIdAsync(cs);

        await ScalarAsync(cs, $"INSERT dbo.AppSetting (SettingKey, ValueText, UpdatedByUserId) VALUES ('Branding.AppName', N'Smith & Co', {user})");
        await ScalarAsync(cs, $"INSERT dbo.AppSetting (SettingKey, ValueBinary, ContentType, ContentSha256, UpdatedByUserId) VALUES ('Branding.Icon', 0x89504E47, 'image/png', 0x{new string('A', 64)}, {user})");
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.AppSetting")).ShouldBe(2);

        // More than 256 KB is refused by the table itself.
        var tooBig = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs,
            $"INSERT dbo.AppSetting (SettingKey, ValueBinary, ContentType, ContentSha256, UpdatedByUserId) VALUES ('Too.Big', CAST(REPLICATE(CAST('x' AS VARCHAR(MAX)), 262145) AS VARBINARY(MAX)), 'image/png', 0x{new string('B', 64)}, {user})"));
        tooBig.Message.ShouldContain("CK_AppSetting_Size");

        // Binary value, content type and hash travel together.
        var half = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs,
            $"INSERT dbo.AppSetting (SettingKey, ValueBinary, UpdatedByUserId) VALUES ('Half.Done', 0x01, {user})"));
        half.Message.ShouldContain("CK_AppSetting_Binary");

        // The writer must be a real user.
        var orphan = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs,
            "INSERT dbo.AppSetting (SettingKey, ValueText, UpdatedByUserId) VALUES ('No.User', N'x', 999999)"));
        orphan.Message.ShouldContain("FK_AppSetting_UpdatedBy");
    }

    [Fact]
    public async Task Every_update_changes_the_row_version()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs);
        var user = await UserIdAsync(cs);
        await ScalarAsync(cs, $"INSERT dbo.AppSetting (SettingKey, ValueText, UpdatedByUserId) VALUES ('Branding.AppName', N'A', {user})");
        var before = (byte[])(await ScalarAsync(cs, "SELECT RowVersion FROM dbo.AppSetting"))!;

        await ScalarAsync(cs, "UPDATE dbo.AppSetting SET ValueText = N'B'");

        var after = (byte[])(await ScalarAsync(cs, "SELECT RowVersion FROM dbo.AppSetting"))!;
        after.ShouldNotBe(before);
    }

    [Fact]
    public async Task The_report_login_role_cannot_read_the_table_and_the_app_role_cannot_alter_it()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs);

        var reader = await ScalarAsync(cs, "SELECT COUNT(*) FROM sys.database_permissions WHERE major_id = OBJECT_ID('dbo.AppSetting') AND state_desc = 'DENY' AND permission_name IN ('SELECT','VIEW DEFINITION') AND USER_NAME(grantee_principal_id) = 'mf_report_reader'");
        reader.ShouldBe(2);
        var app = await ScalarAsync(cs, "SELECT COUNT(*) FROM sys.database_permissions WHERE major_id = OBJECT_ID('dbo.AppSetting') AND state_desc = 'GRANT' AND permission_name = 'DELETE' AND USER_NAME(grantee_principal_id) = 'mf_app'");
        app.ShouldBe(1);
        var alter = await ScalarAsync(cs, "SELECT COUNT(*) FROM sys.database_permissions WHERE major_id = OBJECT_ID('dbo.AppSetting') AND state_desc = 'DENY' AND permission_name = 'ALTER' AND USER_NAME(grantee_principal_id) = 'mf_app'");
        alter.ShouldBe(1);
    }
}
