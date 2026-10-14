using MatterFlow.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace MatterFlow.SchemaTests;

/// <summary>
/// 13-security-hardening.sql (security review SEC-04): the audit table is append-only for the application identity (mf_app) and
/// cannot be truncated, dropped or stripped of its trigger by accident or from application code, even by a privileged login.
/// </summary>
[Collection(SqlServerCollection.Name)]
public class AuditProtectionSchemaTests(SqlServerFixture sql)
{
    private const string Insert = "INSERT dbo.AuditEvent (EventType, ObjectType, ObjectId, CorrelationId) VALUES ('TEST', 'Test', '1', NEWID())";

    private async Task<string> MigratedAsync()
    {
        var cs = await sql.CreateDatabaseAsync();
        await new SchemaMigrationRunner(cs, new EmbeddedMigrationScriptSource(), new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();
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

    private static async Task ShouldRejectAsync(string cs, string sqlText, string expected)
    {
        var ex = await Should.ThrowAsync<SqlException>(() => ExecAsync(cs, sqlText), sqlText);
        ex.Message.ShouldContain(expected, Case.Insensitive, sqlText);
    }

    /// <summary>Creates a SQL login that is a member of the given database role only, and returns its connection string.</summary>
    private static async Task<string> LoginInRoleAsync(string adminConnectionString, string role)
    {
        var name = "t_" + Guid.NewGuid().ToString("N")[..12];
        const string password = "Tr1cky!Passw0rd#2026";
        await ExecAsync(adminConnectionString, $"CREATE LOGIN [{name}] WITH PASSWORD = '{password}', CHECK_POLICY = OFF");
        await ExecAsync(adminConnectionString, $"CREATE USER [{name}] FOR LOGIN [{name}]; ALTER ROLE {role} ADD MEMBER [{name}];");
        return new SqlConnectionStringBuilder(adminConnectionString) { UserID = name, Password = password, IntegratedSecurity = false }.ConnectionString;
    }

    [Fact]
    public async Task Roles_exist_and_the_audit_permissions_are_applied_unconditionally()
    {
        var cs = await MigratedAsync();

        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.database_principals WHERE name IN ('mf_app','mf_migrator') AND type = 'R'")).ShouldBe(2);
        (await ExecAsync(cs, """
            SELECT COUNT(*) FROM sys.database_permissions p JOIN sys.database_principals g ON g.principal_id = p.grantee_principal_id
            WHERE p.major_id = OBJECT_ID('dbo.AuditEvent') AND g.name = 'mf_app' AND p.state = 'D' AND p.permission_name IN ('UPDATE','DELETE','ALTER')
            """)).ShouldBe(3);
        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.triggers WHERE name = 'TR_Protect_AuditEvent' AND parent_class_desc = 'DATABASE' AND is_disabled = 0")).ShouldBe(1);
    }

    [Fact]
    public async Task The_application_identity_can_append_and_read_but_not_change_the_audit_trail_or_the_schema()
    {
        var admin = await MigratedAsync();
        var app = await LoginInRoleAsync(admin, "mf_app");

        await ExecAsync(app, Insert);
        (await ExecAsync(app, "SELECT COUNT(*) FROM dbo.AuditEvent")).ShouldBe(1);
        (await ExecAsync(app, "SELECT COUNT(*) FROM dbo.AppUser")).ShouldBe(0); // ordinary data access works

        await ShouldRejectAsync(app, "UPDATE dbo.AuditEvent SET Summary = 'x'", "permission was denied");
        await ShouldRejectAsync(app, "DELETE dbo.AuditEvent", "permission was denied");
        await ShouldRejectAsync(app, "TRUNCATE TABLE dbo.AuditEvent", "permission");
        await ShouldRejectAsync(app, "DROP TRIGGER dbo.TR_AuditEvent_AppendOnly", "permission");
        await ShouldRejectAsync(app, "DISABLE TRIGGER dbo.TR_AuditEvent_AppendOnly ON dbo.AuditEvent", "permission");
        await ShouldRejectAsync(app, "ALTER TABLE dbo.AuditEvent ADD Sneaky INT NULL", "permission");
        await ShouldRejectAsync(app, "DROP TABLE dbo.AuditEvent", "permission");
        await ShouldRejectAsync(app, "CREATE TABLE dbo.Sneaky (Id INT)", "permission");
        await ShouldRejectAsync(app, "SELECT COUNT(*) FROM dbo.AuditEventGuard", "permission");

        (await ExecAsync(admin, "SELECT COUNT(*) FROM dbo.AuditEvent")).ShouldBe(1);
    }

    [Fact]
    public async Task The_startup_exposure_probe_distinguishes_a_privileged_identity_from_the_application_role()
    {
        // Same query as MatterFlow.Api.Security.AuditStoreGuard.ExposureSql.
        const string probe = """
            SELECT CAST(CASE WHEN OBJECT_ID('dbo.AuditEvent') IS NOT NULL
                              AND (ISNULL(HAS_PERMS_BY_NAME('dbo.AuditEvent', 'OBJECT', 'UPDATE'), 0) = 1
                                OR ISNULL(HAS_PERMS_BY_NAME('dbo.AuditEvent', 'OBJECT', 'DELETE'), 0) = 1
                                OR ISNULL(HAS_PERMS_BY_NAME('dbo.AuditEvent', 'OBJECT', 'ALTER'), 0) = 1)
                             THEN 1 ELSE 0 END AS int)
            """;
        var admin = await MigratedAsync();
        var app = await LoginInRoleAsync(admin, "mf_app");

        (await ExecAsync(admin, probe)).ShouldBe(1);
        (await ExecAsync(app, probe)).ShouldBe(0);
    }

    [Fact]
    public async Task The_schema_runner_role_cannot_rewrite_audit_rows_either()
    {
        var admin = await MigratedAsync();
        var migrator = await LoginInRoleAsync(admin, "mf_migrator");

        await ExecAsync(migrator, Insert);
        await ShouldRejectAsync(migrator, "UPDATE dbo.AuditEvent SET Summary = 'x'", "permission was denied");
        await ShouldRejectAsync(migrator, "DELETE dbo.AuditEvent", "permission was denied");
    }

    [Fact]
    public async Task Even_a_privileged_login_cannot_truncate_or_drop_the_audit_trail_by_accident()
    {
        var admin = await MigratedAsync();
        await ExecAsync(admin, Insert);

        await ShouldRejectAsync(admin, "DELETE dbo.AuditEvent", "append-only");
        await ShouldRejectAsync(admin, "UPDATE dbo.AuditEvent SET Summary = 'x'", "append-only");
        await ShouldRejectAsync(admin, "TRUNCATE TABLE dbo.AuditEvent", "FOREIGN KEY");
        await ShouldRejectAsync(admin, "DROP TABLE dbo.AuditEventGuard", "protected");
        await ShouldRejectAsync(admin, "DROP TABLE dbo.AuditEvent", "FOREIGN KEY");
        await ShouldRejectAsync(admin, "DROP TRIGGER dbo.TR_AuditEvent_AppendOnly", "protected");
        await ShouldRejectAsync(admin, "ALTER TABLE dbo.AuditEventGuard DROP CONSTRAINT FK_AuditEventGuard_AuditEvent", "protected");

        (await ExecAsync(admin, "SELECT COUNT(*) FROM dbo.AuditEvent")).ShouldBe(1);
        (await ExecAsync(admin, "SELECT COUNT(*) FROM sys.triggers WHERE name = 'TR_AuditEvent_AppendOnly' AND is_disabled = 0")).ShouldBe(1);
        (await ExecAsync(admin, "SELECT COUNT(*) FROM sys.triggers WHERE name = 'TR_Protect_AuditEvent' AND is_disabled = 0")).ShouldBe(1);
    }

    [Fact]
    public async Task Ordinary_schema_changes_to_other_tables_and_to_audit_columns_still_work()
    {
        var admin = await MigratedAsync();

        await ExecAsync(admin, "CREATE TABLE dbo.Scratch (Id INT); DROP TABLE dbo.Scratch;");
        await ExecAsync(admin, "ALTER TABLE dbo.AuditEvent ADD FutureColumn INT NULL"); // later scripts may still extend the table
        await ExecAsync(admin, "DISABLE TRIGGER ALL ON dbo.AppUser; ENABLE TRIGGER ALL ON dbo.AppUser;");
    }
}
