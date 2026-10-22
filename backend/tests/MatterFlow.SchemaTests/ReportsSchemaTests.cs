using System.Text.Json;
using MatterFlow.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace MatterFlow.SchemaTests;

/// <summary>30-reports.sql (epic #671, issue #677): constraints, append-only guards and the effective rights of the role mf_report_reader.</summary>
[Collection(SqlServerCollection.Name)]
public class ReportsSchemaTests(SqlServerFixture sql)
{
    private async Task<string> MigratedAsync()
    {
        var cs = await sql.CreateDatabaseAsync();
        await new SchemaMigrationRunner(cs, new EmbeddedMigrationScriptSource(), new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();
        await ExecAsync(cs, "INSERT dbo.AppUser (DisplayName) VALUES (N'Ann');");
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

    private static async Task<string> LoginInRoleAsync(string adminConnectionString, string role)
    {
        var name = "t_" + Guid.NewGuid().ToString("N")[..12];
        const string password = "Tr1cky!Passw0rd#2026";
        await ExecAsync(adminConnectionString, $"CREATE LOGIN [{name}] WITH PASSWORD = '{password}', CHECK_POLICY = OFF");
        await ExecAsync(adminConnectionString, $"CREATE USER [{name}] FOR LOGIN [{name}]; ALTER ROLE {role} ADD MEMBER [{name}];");
        return new SqlConnectionStringBuilder(adminConnectionString) { UserID = name, Password = password, IntegratedSecurity = false }.ConnectionString;
    }

    private static string RepoFile(params string[] parts)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "global.json")))
            dir = dir.Parent;
        return Path.Combine([dir!.FullName, .. parts]);
    }

    /// <summary>A report with one version; returns (reportId, versionId).</summary>
    private static async Task<(int ReportId, int VersionId)> SeedReportAsync(string cs)
    {
        await ExecAsync(cs, "INSERT dbo.ReportCategory (Name) VALUES (N'Cat');");
        await ExecAsync(cs, "INSERT dbo.ReportDefinition (ReportCategoryId, Name) VALUES (1, N'R1');");
        await ExecAsync(cs, "INSERT dbo.ReportVersion (ReportId, VersionNo, SqlText, SqlHash) VALUES (1, 1, N'SELECT 1', 0x00);");
        return (1, 1);
    }

    private const string InsertRun = "INSERT dbo.ReportRun (ReportId, ReportVersionId, UserId, Status, Kind, CorrelationId) VALUES (1, 1, 1, 'Running', 'Run', NEWID());";

    [Fact]
    public async Task Tables_constraints_and_the_role_exist()
    {
        var cs = await MigratedAsync();

        (await ExecAsync(cs, """
            SELECT COUNT(*) FROM sys.tables WHERE name IN ('ReportCategory','ReportDefinition','ReportVersion','ReportParameter','RoleReport','SavedReportView','ReportFavourite','ReportRecent','ReportRun')
            """)).ShouldBe(9);
        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.database_principals WHERE name = 'mf_report_reader' AND type = 'R'")).ShouldBe(1);

        await SeedReportAsync(cs);
        await ShouldRejectAsync(cs, "INSERT dbo.ReportCategory (Name) VALUES (N'Cat');", "UQ_ReportCategory_Name");
        await ShouldRejectAsync(cs, "INSERT dbo.ReportDefinition (ReportCategoryId, Name) VALUES (1, N'R1');", "UQ_ReportDefinition_Name");
        await ShouldRejectAsync(cs, "INSERT dbo.ReportDefinition (ReportCategoryId, Name, IsActive) VALUES (1, N'R2', 1);", "CK_ReportDefinition_ActiveHasVersion");
        await ShouldRejectAsync(cs, "INSERT dbo.ReportDefinition (ReportCategoryId, Name, MaxRows) VALUES (1, N'R3', 0);", "CK_ReportDefinition_MaxRows");
        await ShouldRejectAsync(cs, "INSERT dbo.ReportVersion (ReportId, VersionNo, SqlText, SqlHash) VALUES (1, 1, N'SELECT 2', 0x00);", "UQ_ReportVersion_ReportNo");
        await ShouldRejectAsync(cs, "INSERT dbo.ReportVersion (ReportId, VersionNo, SqlText, SqlHash, ParametersJson) VALUES (1, 2, N'SELECT 2', 0x00, N'{bad');", "CK_ReportVersion_ParametersJson");
        await ShouldRejectAsync(cs, "INSERT dbo.ReportParameter (ReportId, Name, Type, Label) VALUES (1, 'date', 'date', N'x');", "CK_ReportParameter_Name");
        await ShouldRejectAsync(cs, "INSERT dbo.ReportParameter (ReportId, Name, Type, Label) VALUES (1, 'DATE', 'datetime', N'x');", "CK_ReportParameter_Type");
        await ExecAsync(cs, "INSERT dbo.ReportParameter (ReportId, Name, Type, Label) VALUES (1, 'DATE', 'date', N'x');");
        await ShouldRejectAsync(cs, "INSERT dbo.ReportParameter (ReportId, Name, Type, Label) VALUES (1, 'DATE', 'date', N'x');", "UQ_ReportParameter_Name");
        await ShouldRejectAsync(cs, "INSERT dbo.ReportRun (ReportId, ReportVersionId, UserId, Status, Kind, CorrelationId) VALUES (1, 1, 1, 'Weird', 'Run', NEWID());", "CK_ReportRun_Status");
    }

    [Fact]
    public async Task One_default_view_per_report_and_person()
    {
        var cs = await MigratedAsync();
        await SeedReportAsync(cs);
        const string Insert = "INSERT dbo.SavedReportView (ReportId, UserId, Name, IsDefault, ViewJson) VALUES ";

        await ExecAsync(cs, Insert + "(1, 1, N'a', 1, N'{}');");
        await ExecAsync(cs, Insert + "(1, 1, N'b', 0, N'{}');");
        await ShouldRejectAsync(cs, Insert + "(1, 1, N'c', 1, N'{}');", "UX_SavedReportView_Default");
        await ShouldRejectAsync(cs, Insert + "(1, 1, N'a', 0, N'{}');", "UQ_SavedReportView_Name");
    }

    [Fact]
    public async Task Report_versions_are_append_only_even_for_a_privileged_login()
    {
        var admin = await MigratedAsync();
        await SeedReportAsync(admin);

        await ShouldRejectAsync(admin, "UPDATE dbo.ReportVersion SET SqlText = N'DROP TABLE x'", "append-only");
        await ShouldRejectAsync(admin, "DELETE dbo.ReportVersion", "append-only");
        (await ExecAsync(admin, "SELECT COUNT(*) FROM dbo.ReportVersion WHERE SqlText = N'SELECT 1'")).ShouldBe(1);
    }

    [Fact]
    public async Task The_application_identity_cannot_edit_versions_or_runs_but_completes_a_run_through_the_procedure_once()
    {
        var admin = await MigratedAsync();
        await SeedReportAsync(admin);
        var app = await LoginInRoleAsync(admin, "mf_app");

        await ExecAsync(app, "INSERT dbo.ReportVersion (ReportId, VersionNo, SqlText, SqlHash) VALUES (1, 2, N'SELECT 2', 0x01);");
        await ExecAsync(app, InsertRun);
        (await ExecAsync(app, "SELECT COUNT(*) FROM dbo.ReportRun")).ShouldBe(1);

        await ShouldRejectAsync(app, "UPDATE dbo.ReportVersion SET SqlText = N'x'", "permission was denied");
        await ShouldRejectAsync(app, "DELETE dbo.ReportVersion", "permission was denied");
        await ShouldRejectAsync(app, "UPDATE dbo.ReportRun SET Status = 'Succeeded'", "permission was denied");
        await ShouldRejectAsync(app, "DELETE dbo.ReportRun", "permission was denied");
        await ShouldRejectAsync(app, "ALTER TABLE dbo.ReportRun DISABLE TRIGGER ALL", "permission");
        await ShouldRejectAsync(app, "ALTER TABLE dbo.ReportVersion DISABLE TRIGGER ALL", "permission");

        (await ExecAsync(app, "EXEC dbo.usp_ReportRunComplete @ReportRunId = 1, @Status = 'Succeeded', @RowCount = 7, @DurationMs = 12;")).ShouldBe(1);
        (await ExecAsync(admin, "SELECT [RowCount] FROM dbo.ReportRun WHERE ReportRunId = 1 AND Status = 'Succeeded' AND FinishedAt IS NOT NULL")).ShouldBe(7);
        // Completed once: a second completion changes nothing, and an invalid status is refused.
        (await ExecAsync(app, "EXEC dbo.usp_ReportRunComplete @ReportRunId = 1, @Status = 'Failed';")).ShouldBe(0);
        await ShouldRejectAsync(app, "EXEC dbo.usp_ReportRunComplete @ReportRunId = 1, @Status = 'Running';", "Invalid final status");
        (await ExecAsync(admin, "SELECT COUNT(*) FROM dbo.ReportRun WHERE Status = 'Succeeded'")).ShouldBe(1);
    }

    [Fact]
    public async Task The_run_identity_is_immutable_and_rows_are_kept_for_two_years()
    {
        var admin = await MigratedAsync();
        await SeedReportAsync(admin);
        await ExecAsync(admin, InsertRun);

        await ShouldRejectAsync(admin, "UPDATE dbo.ReportRun SET UserId = 1", "completed once");
        await ShouldRejectAsync(admin, "UPDATE dbo.ReportRun SET StartedAt = SYSUTCDATETIME()", "completed once");
        await ShouldRejectAsync(admin, "UPDATE dbo.ReportRun SET ParametersJson = N'[]'", "completed once");
        await ShouldRejectAsync(admin, "DELETE dbo.ReportRun", "two years");
        (await ExecAsync(admin, "EXEC dbo.usp_ReportRunPurge")).ShouldBe(0);
        (await ExecAsync(admin, "SELECT COUNT(*) FROM dbo.ReportRun")).ShouldBe(1);

        // An old, completed run is purged; a completed run cannot be edited afterwards.
        await ExecAsync(admin, "INSERT dbo.ReportRun (ReportId, ReportVersionId, UserId, StartedAt, FinishedAt, Status, Kind, CorrelationId) VALUES (1, 1, 1, DATEADD(YEAR, -3, SYSUTCDATETIME()), SYSUTCDATETIME(), 'Succeeded', 'Run', NEWID());");
        await ShouldRejectAsync(admin, "UPDATE dbo.ReportRun SET [RowCount] = 5 WHERE Status = 'Succeeded'", "completed once");
        (await ExecAsync(admin, "EXEC dbo.usp_ReportRunPurge")).ShouldBe(1);
        (await ExecAsync(admin, "SELECT COUNT(*) FROM dbo.ReportRun")).ShouldBe(1);
    }

    [Fact]
    public async Task The_catalogue_equals_the_effective_rights_of_the_report_role()
    {
        var admin = await MigratedAsync();
        var reader = await LoginInRoleAsync(admin, "mf_report_reader");
        using var catalogue = JsonDocument.Parse(await File.ReadAllTextAsync(RepoFile("db", "report-access.json")));
        var entries = catalogue.RootElement.GetProperty("tables").EnumerateArray().Select(t => (Name: t.GetProperty("name").GetString()!, Allow: t.GetProperty("access").GetString() == "allow")).ToList();
        entries.Count.ShouldBeGreaterThan(50);

        // Every user table in the database is classified, and each one behaves as classified for a real login in the role.
        var tables = new List<string>();
        await using (var c = new SqlConnection(admin))
        {
            await c.OpenAsync();
            await using var cmd = new SqlCommand("SELECT name FROM sys.tables WHERE schema_id = SCHEMA_ID('dbo')", c);
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync()) tables.Add(r.GetString(0));
        }
        tables.Except(entries.Select(e => e.Name)).ShouldBeEmpty();

        foreach (var (name, allow) in entries)
        {
            var canSelect = await ExecAsync(reader, $"SELECT ISNULL(HAS_PERMS_BY_NAME('dbo.{name}', 'OBJECT', 'SELECT'), 0)");
            canSelect.ShouldBe(allow ? 1 : 0, name);
            foreach (var right in new[] { "INSERT", "UPDATE", "DELETE", "ALTER", "REFERENCES", "CONTROL" })
                (await ExecAsync(reader, $"SELECT ISNULL(HAS_PERMS_BY_NAME('dbo.{name}', 'OBJECT', '{right}'), 0)")).ShouldBe(0, $"{name} {right}");
            if (allow)
                (await ExecAsync(reader, $"SELECT COUNT(*) FROM dbo.[{name}]")).ShouldBeGreaterThanOrEqualTo(0);
            else
                await ShouldRejectAsync(reader, $"SELECT COUNT(*) FROM dbo.[{name}]", "permission was denied");
        }
    }

    [Fact]
    public async Task The_report_login_cannot_write_execute_or_change_anything()
    {
        var admin = await MigratedAsync();
        await SeedReportAsync(admin);
        var reader = await LoginInRoleAsync(admin, "mf_report_reader");

        await ShouldRejectAsync(reader, "INSERT dbo.Pod (Name) VALUES (N'x')", "permission was denied");
        await ShouldRejectAsync(reader, "UPDATE dbo.AppUser SET DisplayName = N'x'", "permission was denied");
        await ShouldRejectAsync(reader, "DELETE dbo.Task", "permission was denied");
        await ShouldRejectAsync(reader, "TRUNCATE TABLE dbo.Pod", "permission");
        await ShouldRejectAsync(reader, "ALTER TABLE dbo.Pod ADD X INT", "permission");
        await ShouldRejectAsync(reader, "DROP TABLE dbo.Pod", "permission");
        await ShouldRejectAsync(reader, "CREATE TABLE dbo.Sneaky (Id INT)", "permission");
        await ShouldRejectAsync(reader, "CREATE VIEW dbo.SneakyView AS SELECT 1 AS X", "permission");
        await ShouldRejectAsync(reader, "EXEC dbo.usp_ReportRunComplete @ReportRunId = 1, @Status = 'Failed'", "permission");
        await ShouldRejectAsync(reader, "EXEC dbo.usp_ReportRunPurge", "permission");
        await ShouldRejectAsync(reader, "EXEC xp_cmdshell 'whoami'", "permission");
        (await ExecAsync(reader, "SELECT COUNT(*) FROM sys.sql_logins WHERE password_hash IS NOT NULL")).ShouldBe(0); // no credential metadata is visible
        await ShouldRejectAsync(reader, "GRANT SELECT ON dbo.AuditEvent TO public", "");
        await ShouldRejectAsync(reader, "SELECT COUNT(*) FROM dbo.AuditEvent", "permission was denied");
        await ShouldRejectAsync(reader, "SELECT COUNT(*) FROM dbo.UserIdentity", "permission was denied");
        await ShouldRejectAsync(reader, "SELECT SqlText FROM dbo.ReportVersion", "permission was denied");

        (await ExecAsync(reader, "SELECT IS_MEMBER('db_owner') + IS_MEMBER('db_datareader') + IS_MEMBER('db_datawriter') + IS_MEMBER('db_ddladmin') + IS_MEMBER('mf_app') + IS_MEMBER('mf_migrator')")).ShouldBe(0);
        (await ExecAsync(reader, "SELECT IS_SRVROLEMEMBER('sysadmin')")).ShouldBe(0);
        (await ExecAsync(reader, "SELECT IS_MEMBER('mf_report_reader')")).ShouldBe(1);
        (await ExecAsync(reader, "SELECT COUNT(*) FROM dbo.Task")).ShouldBe(0);
    }
}
