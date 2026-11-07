using System.Globalization;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.Data.SqlClient;
using Shouldly;
using Xunit.Abstractions;
using static MatterFlow.IntegrationTests.Reports.ReportSecurityKit;

namespace MatterFlow.IntegrationTests.Reports;

/// <summary>
/// What the report login itself may do, with the validator out of the way (issue #725, spec 16.3 c, threat 7.2 and 7.3). The tests connect with the real
/// login that <see cref="ReportTestHarness"/> provisioned (database role <c>mf_report_reader</c>) and try everything an author would try if the parser let
/// it through: writes, DDL, procedures, other databases, linked servers, role changes, server state. Every attempt must be refused by SQL Server for a
/// rights reason, and afterwards nothing may have changed. <c>ReportsSchemaTests</c> already proves the per-table rights against the catalogue; this adds
/// the attempts and the server and database level.
/// </summary>
[Collection(SqlServerCollection.Name)]
[Trait("Suite", "ReportsSecurity")]
public sealed class ReportLoginRightsTests(SqlServerFixture sql, ITestOutputHelper output)
{
    /// <summary>Words of a rights refusal. A syntax or name error would also throw, so those are rejected below to keep a typo from passing as a refusal.</summary>
    private static readonly string[] RightsWords = ["permission", "denied", "not able to access", "Cannot open database", "cannot be impersonated", "Login failed", "Ad Hoc Distributed Queries", "Could not find server", "is not supported", "not allowed", "Cannot find the object", "not have permission", "Only members of", "may be an advanced option"];

    private static readonly string[] TypoWords = ["Incorrect syntax", "Invalid column name", "Invalid object name", "Must declare the scalar variable", "Unclosed quotation"];

    private static async Task<SqlException> RefusedAsync(string connectionString, string statement)
    {
        var ex = await Should.ThrowAsync<SqlException>(() => SqlServerFixture.ExecuteAsync(connectionString, statement), statement);
        TypoWords.ShouldNotContain(w => ex.Message.Contains(w, StringComparison.OrdinalIgnoreCase), $"[{statement}] failed for a typo, not for a right: {ex.Message}");
        RightsWords.ShouldContain(w => ex.Message.Contains(w, StringComparison.OrdinalIgnoreCase), $"[{statement}] -> {ex.Message}");
        return ex;
    }

    private async Task<(ReportTestHarness H, string Reader, string User)> StartAsync()
    {
        var h = await ReportTestHarness.StartAsync(sql);
        await AddAppUserAsync(h.AppConnection, "Ann");
        await h.AddReportAsync("SELECT 1 AS one");
        return (h, h.Login.ConnectionString, h.Login.Name);
    }

    private static async Task<string> FingerprintAsync(string admin) => string.Join(
        "|",
        await Task.WhenAll(new[]
        {
            "SELECT COUNT(*) FROM sys.objects", "SELECT COUNT(*) FROM sys.database_principals", "SELECT COUNT(*) FROM sys.database_role_members", "SELECT COUNT(*) FROM sys.database_permissions",
            "SELECT COUNT(*) FROM sys.server_principals", "SELECT COUNT(*) FROM sys.server_role_members", "SELECT COUNT(*) FROM dbo.AppUser", "SELECT COUNT(*) FROM dbo.Role",
            "SELECT COUNT(*) FROM dbo.UserRole", "SELECT COUNT(*) FROM dbo.RoleReport", "SELECT COUNT(*) FROM dbo.AuditEvent", "SELECT COUNT(*) FROM dbo.ReportRun", "SELECT COUNT(*) FROM dbo.ReportVersion",
            "SELECT ISNULL(SUM(CAST(IsActive AS int)), 0) FROM dbo.ReportDefinition", "SELECT ISNULL(CHECKSUM_AGG(CHECKSUM(DisplayName)), 0) FROM dbo.AppUser",
        }.Select(async q => Convert.ToString(await SqlServerFixture.ScalarAsync(admin, q), CultureInfo.InvariantCulture))));

    [Fact]
    public async Task The_login_cannot_write_any_table_including_the_ones_that_would_grant_it_more_rights()
    {
        var (h, reader, _) = await StartAsync();
        await using var _h = h;
        var before = await FingerprintAsync(h.AppConnection);

        string[] statements =
        [
            "INSERT dbo.Pod (Name) VALUES (N'x')",
            "UPDATE dbo.AppUser SET DisplayName = N'x'",
            "DELETE dbo.Task",
            "TRUNCATE TABLE dbo.Pod",
            "MERGE dbo.Pod AS t USING (SELECT N'x' AS Name) s ON t.Name = s.Name WHEN NOT MATCHED THEN INSERT (Name) VALUES (s.Name);",
            "UPDATE dbo.Matter SET Name = N'x'",
            // privilege escalation inside the application: give itself a role, a permission or a report
            "INSERT dbo.UserRole (UserId, RoleId) SELECT 1, 1",
            "DELETE dbo.UserRole",
            "UPDATE dbo.Role SET Name = N'x'",
            "INSERT dbo.RolePermission (RoleId, PermissionId) SELECT 1, 1",
            "INSERT dbo.RoleReport (RoleId, ReportId) VALUES (1, 1)",
            // the report tables and the audit trail
            "UPDATE dbo.ReportDefinition SET IsActive = 1",
            "UPDATE dbo.ReportVersion SET SqlText = N'SELECT 1'",
            "DELETE dbo.ReportVersion",
            "INSERT dbo.ReportRun DEFAULT VALUES",
            "UPDATE dbo.ReportRun SET Status = N'Succeeded'",
            "DELETE dbo.ReportRun",
            "INSERT dbo.AuditEvent DEFAULT VALUES",
            "UPDATE dbo.AuditEvent SET Summary = N'x'",
            "DELETE dbo.AuditEvent",
            "TRUNCATE TABLE dbo.AuditEvent",
            "EXEC dbo.usp_ReportRunComplete @ReportRunId = 1, @Status = 'Failed'",
            "EXEC dbo.usp_ReportRunPurge",
            // nested and dynamic SQL runs with the caller's rights, never more
            "EXEC sp_executesql N'DELETE dbo.Task'",
            "EXEC sp_executesql N'INSERT dbo.UserRole (UserId, RoleId) SELECT 1, 1'",
            "EXEC('DELETE dbo.Task')",
            "SELECT 1 AS a INTO dbo.Sneaky",
            "SELECT * INTO dbo.SneakyCopy FROM dbo.AppUser",
        ];

        foreach (var statement in statements)
            await RefusedAsync(reader, statement);

        (await FingerprintAsync(h.AppConnection)).ShouldBe(before, "nothing changed");
    }

    [Fact]
    public async Task The_login_cannot_define_objects_change_rights_or_run_administration_commands()
    {
        var (h, reader, user) = await StartAsync();
        await using var _h = h;
        var database = new SqlConnectionStringBuilder(h.AppConnection).InitialCatalog;
        var before = await FingerprintAsync(h.AppConnection);

        string[] statements =
        [
            "CREATE TABLE dbo.Sneaky (Id int)",
            "CREATE VIEW dbo.SneakyView AS SELECT 1 AS X",
            "CREATE PROCEDURE dbo.sneaky AS SELECT 1",
            "CREATE FUNCTION dbo.sneakyf() RETURNS int AS BEGIN RETURN 1 END",
            "CREATE TRIGGER dbo.sneakyt ON dbo.Pod AFTER INSERT AS SELECT 1",
            "CREATE INDEX ix_sneaky ON dbo.Pod (Name)",
            "CREATE SCHEMA sneaky",
            "CREATE TYPE dbo.sneakytype FROM int",
            "CREATE SYNONYM dbo.sneakysyn FOR dbo.Pod",
            "CREATE USER sneaky WITHOUT LOGIN",
            "CREATE ROLE sneakyrole",
            "ALTER TABLE dbo.Pod ADD X int",
            "ALTER TABLE dbo.Pod DISABLE TRIGGER ALL",
            "DROP TABLE dbo.Pod",
            "ALTER ROLE db_owner ADD MEMBER [" + user + "]",
            "ALTER ROLE db_datawriter ADD MEMBER [" + user + "]",
            "ALTER ROLE mf_app ADD MEMBER [" + user + "]",
            "ALTER ROLE mf_report_reader DROP MEMBER [" + user + "]",
            "GRANT SELECT ON dbo.AuditEvent TO public",
            "GRANT SELECT ON dbo.AuditEvent TO mf_report_reader",
            "GRANT CONTROL ON DATABASE::[" + database + "] TO public",
            "DENY SELECT ON dbo.AppUser TO mf_report_reader",
            "REVOKE SELECT ON dbo.AppUser FROM mf_report_reader",
            "ALTER AUTHORIZATION ON SCHEMA::dbo TO [" + user + "]",
            "ALTER DATABASE [" + database + "] SET RECOVERY SIMPLE",
            "CREATE DATABASE sneaky_" + Guid.NewGuid().ToString("N")[..8],
            "CREATE LOGIN sneaky WITH PASSWORD = 'Sn3aky!Passw0rd#26'",
            "ALTER SERVER ROLE sysadmin ADD MEMBER [" + user + "]",
            "EXECUTE AS USER = 'dbo'",
            "EXECUTE AS LOGIN = 'sa'",
            "BACKUP DATABASE [" + database + "] TO DISK = N'/var/opt/mssql/data/sneaky.bak'",
            "DBCC CHECKDB",
            "DBCC FREEPROCCACHE",
            "DBCC TRACEON (3604)",
            "DBCC SHRINKDATABASE (0)",
            "RECONFIGURE",
            "CHECKPOINT",
            "SHUTDOWN WITH NOWAIT",
        ];

        foreach (var statement in statements)
            await RefusedAsync(reader, statement);

        // SQL Server ignores a GRANT or DENY that a principal gives to itself without saying so. That is not a refusal, so it is checked by its (non-)effect.
        foreach (var self in new[] { "GRANT SELECT ON dbo.AuditEvent TO [" + user + "]", "GRANT INSERT ON dbo.AppUser TO [" + user + "]", "GRANT CONTROL ON DATABASE::[" + database + "] TO [" + user + "]", "GRANT EXECUTE TO [" + user + "]" })
        {
            try
            {
                await SqlServerFixture.ExecuteAsync(reader, self);
            }
            catch (SqlException)
            {
                // refused is fine too
            }
        }

        (await CountAsync(h.AppConnection, $"SELECT COUNT(*) FROM sys.database_permissions p JOIN sys.database_principals u ON u.principal_id = p.grantee_principal_id WHERE u.name = N'{user}' AND p.permission_name <> N'CONNECT'")).ShouldBe(0, "no right was recorded for the login itself");
        Convert.ToInt32(await SqlServerFixture.ScalarAsync(reader, "SELECT ISNULL(HAS_PERMS_BY_NAME('dbo.AuditEvent', 'OBJECT', 'SELECT'), 0) + ISNULL(HAS_PERMS_BY_NAME('dbo.AppUser', 'OBJECT', 'INSERT'), 0) + ISNULL(HAS_PERMS_BY_NAME(NULL, 'DATABASE', 'CONTROL'), 0)"), CultureInfo.InvariantCulture).ShouldBe(0);
        await RefusedAsync(reader, "SELECT COUNT(*) FROM dbo.AuditEvent");
        (await FingerprintAsync(h.AppConnection)).ShouldBe(before, "nothing changed");
        Convert.ToInt32(await SqlServerFixture.ScalarAsync(reader, "SELECT COUNT(*) FROM dbo.AppUser"), CultureInfo.InvariantCulture).ShouldBeGreaterThan(0); // still the same reader, still working
    }

    [Fact]
    public async Task The_login_cannot_call_procedures_reach_the_file_system_or_use_linked_servers_or_external_data()
    {
        var (h, reader, user) = await StartAsync();
        await using var _h = h;
        var before = await FingerprintAsync(h.AppConnection);

        string[] statements =
        [
            "EXEC xp_cmdshell 'whoami'",
            "EXEC master.dbo.xp_cmdshell 'whoami'",
            "EXEC sp_configure 'show advanced options', 1",
            "EXEC sp_configure 'xp_cmdshell', 1",
            "EXEC sp_addlinkedserver N'sneaky'",
            "EXEC sp_addlinkedsrvlogin N'sneaky'",
            "EXEC sp_addsrvrolemember N'" + user + "', N'sysadmin'",
            "EXEC sp_addrolemember N'db_owner', N'" + user + "'",
            "EXEC sp_addlogin N'sneaky', N'Sn3aky!Passw0rd#26'",
            "DECLARE @o int; EXEC sp_OACreate N'WScript.Shell', @o OUT",
            "EXEC sp_executesql N'EXEC xp_cmdshell ''whoami'''",
            "EXEC msdb.dbo.sp_start_job N'x'",
            "EXEC sp_detach_db N'master'",
            "EXEC sp_dropserver N'x'",
            // linked servers and external data
            "SELECT * FROM OPENQUERY([sneaky], 'SELECT 1')",
            "SELECT * FROM [sneaky].master.dbo.sysdatabases",
            "SELECT * FROM OPENROWSET('SQLNCLI', 'Server=.;Trusted_Connection=yes;', 'SELECT 1') t",
            "SELECT * FROM OPENROWSET(BULK N'/etc/passwd', SINGLE_CLOB) t",
            "SELECT * FROM OPENDATASOURCE('SQLNCLI', 'Data Source=.;').master.dbo.sysdatabases",
            "BULK INSERT dbo.Pod FROM '/tmp/sneaky.csv'",
            "SELECT * FROM sys.fn_get_audit_file('/var/opt/mssql/data/*.sqlaudit', DEFAULT, DEFAULT)",
            "SELECT * FROM sys.fn_xe_file_target_read_file('/var/opt/mssql/log/*.xel', NULL, NULL, NULL)",
            "SELECT * FROM sys.dm_exec_query_stats",
            "SELECT * FROM sys.dm_exec_connections",
            "SELECT * FROM sys.dm_os_sys_info",
        ];

        foreach (var statement in statements)
            await RefusedAsync(reader, statement);

        (await SqlServerFixture.ScalarAsync(reader, "SELECT COUNT(*) FROM sys.servers WHERE is_linked = 1")).ShouldBe(0);

        // Every procedure and function of ours is closed to the login.
        var objects = new List<(string Name, string Type)>();
        await using (var connection = new SqlConnection(h.AppConnection))
        {
            await connection.OpenAsync();
            await using var command = new SqlCommand("SELECT QUOTENAME(SCHEMA_NAME(schema_id)) + '.' + QUOTENAME(name), type FROM sys.objects WHERE type IN ('P', 'FN', 'IF', 'TF', 'PC', 'FS', 'FT') AND is_ms_shipped = 0", connection);
            await using var rows = await command.ExecuteReaderAsync();
            while (await rows.ReadAsync())
                objects.Add((rows.GetString(0), rows.GetString(1).Trim()));
        }

        objects.Select(o => o.Name).ShouldContain("[dbo].[usp_ReportRunComplete]");
        objects.Select(o => o.Name).ShouldContain("[dbo].[fnMatterVisible]");
        foreach (var (name, type) in objects)
        {
            var right = type is "IF" or "TF" or "FT" ? "SELECT" : "EXECUTE";
            await using var connection = new SqlConnection(reader);
            await connection.OpenAsync();
            await using var command = new SqlCommand("SELECT ISNULL(HAS_PERMS_BY_NAME(@n, 'OBJECT', @r), 0)", connection);
            command.Parameters.AddWithValue("@n", name);
            command.Parameters.AddWithValue("@r", right);
            Convert.ToInt32(await command.ExecuteScalarAsync(), CultureInfo.InvariantCulture).ShouldBe(0, $"{right} on {name}");
        }

        foreach (var function in new[] { "fnMatterVisible", "fnTaskVisible", "fnAssetVisible" })
            await RefusedAsync(reader, $"SELECT * FROM dbo.{function}(1, 1)");

        // What the engine's own system procedures allow every login by default is not ours to change (the database role cannot take it away; master would need a
        // DENY for the login). The application path cannot reach any of it: a report is one SELECT and the validator refuses EXEC, sp_ and xp_ names. The two file
        // system procedures that SQL Server lets every login call are pinned here as a known residual (issue #1292); every other write, run or registry procedure below must stay refused. When the residual is closed, this expectation changes with it.
        var candidates = new (string Name, string Call)[]
        {
            ("xp_dirtree", "EXEC master.dbo.xp_dirtree N'/', 1, 1"), ("xp_fileexist", "EXEC master.dbo.xp_fileexist N'/etc/passwd'"), ("xp_subdirs", "EXEC master.dbo.xp_subdirs N'/'"),
            ("xp_getfiledetails", "EXEC master.dbo.xp_getfiledetails N'/etc/passwd'"), ("xp_fixeddrives", "EXEC master.dbo.xp_fixeddrives"), ("xp_msver", "EXEC master.dbo.xp_msver"),
            ("xp_enumerrorlogs", "EXEC master.dbo.xp_enumerrorlogs"), ("xp_readerrorlog", "EXEC master.dbo.xp_readerrorlog"), ("xp_create_subdir", "EXEC master.dbo.xp_create_subdir N'/tmp/sneaky'"),
            ("xp_delete_file", "EXEC master.dbo.xp_delete_file 0, N'/tmp/x', N'bak'"), ("xp_regread", "EXEC master.dbo.xp_regread N'HKEY_LOCAL_MACHINE', N'SOFTWARE'"), ("xp_cmdshell", "EXEC master.dbo.xp_cmdshell N'whoami'"),
            ("sp_OACreate", "DECLARE @o int; EXEC master.dbo.sp_OACreate N'WScript.Shell', @o OUT"), ("sp_execute_external_script", "EXEC sp_execute_external_script @language = N'Python', @script = N'print(1)'"),
            ("sp_addextendedproc", "EXEC master.dbo.sp_addextendedproc N'xp_sneaky', N'x.dll'"), ("sp_readerrorlog", "EXEC master.dbo.sp_readerrorlog"),
        };
        var callable = new List<string>();
        foreach (var (name, call) in candidates)
        {
            try
            {
                await SqlServerFixture.ExecuteAsync(reader, call);
                callable.Add(name);
            }
            catch (SqlException)
            {
                // refused, as wanted
            }
        }

        output.WriteLine("callable system procedures: " + string.Join(", ", callable));
        callable.Where(n => n is not ("xp_dirtree" or "xp_fileexist" or "xp_fixeddrives" or "xp_msver")).ShouldBeEmpty("no write, run or registry procedure may be callable");
        callable.ShouldContain("xp_dirtree", "known residual: SQL Server lets every login list directories");
        callable.ShouldContain("xp_fileexist", "known residual: SQL Server lets every login test for files");

        (await FingerprintAsync(h.AppConnection)).ShouldBe(before, "nothing changed");
    }

    [Fact]
    public async Task The_login_cannot_read_audit_credentials_the_report_tables_or_other_databases()
    {
        var (h, reader, _) = await StartAsync();
        await using var _h = h;
        var other = await sql.CreateDatabaseAsync();
        var otherName = new SqlConnectionStringBuilder(other).InitialCatalog;
        await SqlServerFixture.ExecuteAsync(other, "CREATE TABLE dbo.secret (id int, v nvarchar(50)); INSERT dbo.secret VALUES (1, N'top secret');");
        (await SqlServerFixture.ScalarAsync(other, "SELECT COUNT(*) FROM dbo.secret")).ShouldBe(1);

        foreach (var denied in new[]
                 {
                     "SELECT COUNT(*) FROM dbo.AuditEvent", "SELECT IsSensitiveScope FROM dbo.AuditEvent", "SELECT COUNT(*) FROM dbo.AuditEventGuard", "SELECT COUNT(*) FROM dbo.UserIdentity",
                     "SELECT COUNT(*) FROM dbo.SeedMarker", "SELECT COUNT(*) FROM dbo.SchemaMigration", "SELECT COUNT(*) FROM dbo.AppSetting", "SELECT COUNT(*) FROM dbo.ReportDefinition",
                     "SELECT SqlText FROM dbo.ReportVersion", "SELECT ParametersJson FROM dbo.ReportRun", "SELECT COUNT(*) FROM dbo.RoleReport", "SELECT COUNT(*) FROM dbo.SavedReportView",
                     // other databases: the login has no user there
                     $"SELECT * FROM [{otherName}].dbo.secret", $"USE [{otherName}]", $"DROP DATABASE [{otherName}]", $"SELECT COUNT(*) FROM [{otherName}].sys.tables", "SELECT * FROM msdb.dbo.sysjobs", "SELECT * FROM msdb.dbo.sysjobsteps",
                 })
            await RefusedAsync(reader, denied);

        (await SqlServerFixture.ScalarAsync(other, "SELECT COUNT(*) FROM dbo.secret")).ShouldBe(1);

        // A direct connection to another database is refused at login.
        var direct = new SqlConnectionStringBuilder(reader) { InitialCatalog = otherName }.ConnectionString;
        var login = await Should.ThrowAsync<SqlException>(() => SqlServerFixture.ScalarAsync(direct, "SELECT 1"));
        login.Message.ShouldContain("Cannot open database", Case.Insensitive);

        // No credential metadata is visible, in this database or in master.
        (await SqlServerFixture.ScalarAsync(reader, "SELECT COUNT(*) FROM sys.sql_logins WHERE password_hash IS NOT NULL")).ShouldBe(0);
        (await SqlServerFixture.ScalarAsync(reader, "SELECT COUNT(*) FROM master.sys.sql_logins WHERE password_hash IS NOT NULL")).ShouldBe(0);
        (await SqlServerFixture.ScalarAsync(reader, "SELECT COUNT(*) FROM sys.database_scoped_credentials")).ShouldBe(0);
        // The server state views show nothing of other sessions without VIEW SERVER STATE.
        (await SqlServerFixture.ScalarAsync(reader, "SELECT COUNT(*) FROM sys.dm_exec_sessions WHERE session_id <> @@SPID")).ShouldBe(0);
    }

    [Fact]
    public async Task The_login_holds_no_server_or_database_rights_beyond_reading_the_allowed_tables()
    {
        var (h, reader, _) = await StartAsync();
        await using var _h = h;

        async Task<List<string>> Names(string query)
        {
            var names = new List<string>();
            await using var connection = new SqlConnection(reader);
            await connection.OpenAsync();
            await using var command = new SqlCommand(query, connection);
            await using var rows = await command.ExecuteReaderAsync();
            while (await rows.ReadAsync())
                names.Add(rows.GetString(0));
            return names;
        }

        var server = await Names("SELECT permission_name FROM sys.fn_my_permissions(NULL, 'SERVER')");
        string[] forbiddenServer =
        [
            "CONTROL SERVER", "ALTER ANY LOGIN", "ALTER ANY DATABASE", "CREATE ANY DATABASE", "VIEW SERVER STATE", "ALTER SETTINGS", "ALTER TRACE", "ADMINISTER BULK OPERATIONS", "ALTER ANY LINKED SERVER",
            "IMPERSONATE ANY LOGIN", "CONNECT ANY DATABASE", "SELECT ALL USER SECURABLES", "SHUTDOWN", "EXTERNAL ACCESS ASSEMBLY", "UNSAFE ASSEMBLY", "VIEW ANY DEFINITION", "ALTER ANY SERVER ROLE", "ALTER ANY CREDENTIAL",
            "ALTER ANY CONNECTION", "ALTER RESOURCES", "AUTHENTICATE SERVER", "ALTER SERVER STATE", "VIEW SERVER PERFORMANCE STATE", "VIEW SERVER SECURITY STATE",
        ];
        server.ShouldContain("CONNECT SQL");
        server.Intersect(forbiddenServer).ShouldBeEmpty("server rights: " + string.Join(", ", server));

        var database = await Names("SELECT permission_name FROM sys.fn_my_permissions(NULL, 'DATABASE')");
        string[] forbiddenDatabase =
        [
            "CONTROL", "ALTER", "INSERT", "UPDATE", "DELETE", "EXECUTE", "REFERENCES", "TAKE OWNERSHIP", "CREATE TABLE", "CREATE VIEW", "CREATE PROCEDURE", "CREATE FUNCTION", "CREATE SCHEMA", "CREATE TYPE", "CREATE ROLE",
            "ALTER ANY USER", "ALTER ANY ROLE", "ALTER ANY SCHEMA", "ALTER ANY DATABASE DDL TRIGGER", "ALTER ANY DATABASE AUDIT", "ALTER ANY EXTERNAL DATA SOURCE", "BACKUP DATABASE", "BACKUP LOG", "CHECKPOINT",
            "SUBSCRIBE QUERY NOTIFICATIONS", "VIEW DATABASE STATE", "IMPERSONATE", "EXECUTE ANY EXTERNAL SCRIPT", "ADMINISTER DATABASE BULK OPERATIONS", "UNMASK", "VIEW DATABASE PERFORMANCE STATE", "VIEW DATABASE SECURITY STATE",
        ];
        database.ShouldContain("CONNECT");
        database.Intersect(forbiddenDatabase).ShouldBeEmpty("database rights: " + string.Join(", ", database));
        output.WriteLine("server: " + string.Join(", ", server));
        output.WriteLine("database: " + string.Join(", ", database));

        // Role membership, one by one: fixed server roles, fixed database roles and the application's own roles.
        var serverRoles = new[] { "sysadmin", "securityadmin", "serveradmin", "setupadmin", "processadmin", "diskadmin", "dbcreator", "bulkadmin" };
        foreach (var role in serverRoles)
            Convert.ToInt32(await SqlServerFixture.ScalarAsync(reader, $"SELECT ISNULL(IS_SRVROLEMEMBER('{role}'), 0)"), CultureInfo.InvariantCulture).ShouldBe(0, role);
        var databaseRoles = new[] { "db_owner", "db_securityadmin", "db_accessadmin", "db_backupoperator", "db_ddladmin", "db_datawriter", "db_datareader", "db_denydatareader", "db_denydatawriter", "mf_app", "mf_migrator" };
        foreach (var role in databaseRoles)
            Convert.ToInt32(await SqlServerFixture.ScalarAsync(reader, $"SELECT ISNULL(IS_MEMBER('{role}'), 0)"), CultureInfo.InvariantCulture).ShouldBe(0, role);
        Convert.ToInt32(await SqlServerFixture.ScalarAsync(reader, "SELECT IS_MEMBER('mf_report_reader')"), CultureInfo.InvariantCulture).ShouldBe(1);

        // Reading is the only right it has, and only on the allowed tables: none of the write rights on any table at all.
        (await SqlServerFixture.ScalarAsync(reader, "SELECT COUNT(*) FROM sys.tables t WHERE HAS_PERMS_BY_NAME(QUOTENAME(SCHEMA_NAME(t.schema_id)) + '.' + QUOTENAME(t.name), 'OBJECT', 'INSERT') = 1 OR HAS_PERMS_BY_NAME(QUOTENAME(SCHEMA_NAME(t.schema_id)) + '.' + QUOTENAME(t.name), 'OBJECT', 'UPDATE') = 1 OR HAS_PERMS_BY_NAME(QUOTENAME(SCHEMA_NAME(t.schema_id)) + '.' + QUOTENAME(t.name), 'OBJECT', 'DELETE') = 1"))
            .ShouldBe(0);
    }
}
