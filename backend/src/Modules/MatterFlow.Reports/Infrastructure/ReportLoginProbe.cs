using System.Data;
using System.Text.Json;
using MatterFlow.Reports.Application;
using Microsoft.Data.SqlClient;

namespace MatterFlow.Reports.Infrastructure;

/// <summary>
/// Startup probe of the report login (spec 6.3 layer 4). It connects with the report connection and asks SQL Server what the login may do:
/// <c>IS_MEMBER</c>, <c>IS_SRVROLEMEMBER</c> and <c>HAS_PERMS_BY_NAME</c> only, never a write and never a data read. The effective rights are compared
/// with the access catalogue.
/// </summary>
internal static class ReportLoginProbe
{
    internal const string FactsSql =
        """
        SELECT
          SUSER_SNAME() AS LoginName,
          CAST(ISNULL(IS_SRVROLEMEMBER('sysadmin'), 0) AS int) AS IsSysAdmin,
          CAST(ISNULL(IS_MEMBER('db_owner'), 0) AS int) AS IsDbOwner,
          CAST(ISNULL(IS_MEMBER('db_datareader'), 0) + ISNULL(IS_MEMBER('db_datawriter'), 0) + ISNULL(IS_MEMBER('db_ddladmin'), 0)
             + ISNULL(IS_MEMBER('db_securityadmin'), 0) + ISNULL(IS_MEMBER('db_accessadmin'), 0)
             + ISNULL(IS_MEMBER('mf_app'), 0) + ISNULL(IS_MEMBER('mf_migrator'), 0) AS int) AS BroadRoleCount,
          CAST(ISNULL(IS_MEMBER('mf_report_reader'), 0) AS int) AS InReaderRole,
          (SELECT COUNT(*) FROM sys.tables t
            WHERE ISNULL(HAS_PERMS_BY_NAME(QUOTENAME(SCHEMA_NAME(t.schema_id)) + N'.' + QUOTENAME(t.name), 'OBJECT', 'INSERT'), 0) = 1
               OR ISNULL(HAS_PERMS_BY_NAME(QUOTENAME(SCHEMA_NAME(t.schema_id)) + N'.' + QUOTENAME(t.name), 'OBJECT', 'UPDATE'), 0) = 1
               OR ISNULL(HAS_PERMS_BY_NAME(QUOTENAME(SCHEMA_NAME(t.schema_id)) + N'.' + QUOTENAME(t.name), 'OBJECT', 'DELETE'), 0) = 1
               OR ISNULL(HAS_PERMS_BY_NAME(QUOTENAME(SCHEMA_NAME(t.schema_id)) + N'.' + QUOTENAME(t.name), 'OBJECT', 'ALTER'), 0) = 1) AS WritableTables,
          (SELECT COUNT(*) FROM OPENJSON(@denied) d
            WHERE ISNULL(HAS_PERMS_BY_NAME(N'dbo.' + QUOTENAME(d.[value]), 'OBJECT', 'SELECT'), 0) = 1) AS DeniedReadable,
          (SELECT COUNT(*) FROM sys.tables t
            WHERE ISNULL(HAS_PERMS_BY_NAME(QUOTENAME(SCHEMA_NAME(t.schema_id)) + N'.' + QUOTENAME(t.name), 'OBJECT', 'SELECT'), 0) = 1
              AND NOT (SCHEMA_NAME(t.schema_id) = N'dbo' AND t.name IN (SELECT a.[value] FROM OPENJSON(@allowed) a))) AS ReadableOutsideAllowList,
          CAST(ISNULL(HAS_PERMS_BY_NAME(N'dbo', 'SCHEMA', 'EXECUTE'), 0) AS int) AS CanExecute,
          CAST(ISNULL(HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CREATE TABLE'), 0) AS int) AS CanCreate,
          (SELECT COUNT(*) FROM sys.tables t
            WHERE ISNULL(HAS_PERMS_BY_NAME(QUOTENAME(SCHEMA_NAME(t.schema_id)) + N'.' + QUOTENAME(t.name), 'OBJECT', 'SELECT'), 0) = 1) AS ReadableTables,
          (SELECT compatibility_level FROM sys.databases WHERE database_id = DB_ID()) AS CompatibilityLevel
        """;

    public static async Task<ReportsStatus> ProbeAsync(string connectionString, ReportAccessCatalogue catalogue, DateTime nowUtc, CancellationToken cancellationToken)
    {
        try
        {
            await using var connection = new SqlConnection(connectionString);
            await connection.OpenAsync(cancellationToken);
            await using var command = connection.CreateCommand();
            command.CommandText = FactsSql;
            command.CommandTimeout = 15;
            command.Parameters.Add(new SqlParameter("@denied", SqlDbType.NVarChar, -1) { Value = JsonSerializer.Serialize(catalogue.Denied) });
            command.Parameters.Add(new SqlParameter("@allowed", SqlDbType.NVarChar, -1) { Value = JsonSerializer.Serialize(catalogue.Allowed) });

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
                return Failed("The report login returned no answer to the permission probe.");

            var facts = new ReportLoginFacts(
                LoginName: reader.GetString(0),
                IsSysAdmin: reader.GetInt32(1) == 1,
                IsDbOwner: reader.GetInt32(2) == 1,
                BroadRoleCount: reader.GetInt32(3),
                InReaderRole: reader.GetInt32(4) == 1,
                WritableTables: reader.GetInt32(5),
                DeniedReadable: reader.GetInt32(6),
                ReadableOutsideAllowList: reader.GetInt32(7),
                CanExecute: reader.GetInt32(8) == 1,
                CanCreate: reader.GetInt32(9) == 1,
                ReadableTables: reader.GetInt32(10),
                CompatibilityLevel: reader.IsDBNull(11) ? 0 : Convert.ToInt32(reader.GetValue(11), System.Globalization.CultureInfo.InvariantCulture));
            return ReportLoginAssessment.Evaluate(facts, nowUtc);
        }
        catch (SqlException ex)
        {
            // Never echo the server's text: it can contain the login name or the server name. The number is enough to look it up.
            return Failed($"The report login could not connect or be checked (SQL error {ex.Number}). Check the user name, password and that the database user exists (docs/runbook.md section 11).");
        }
        catch (InvalidOperationException ex)
        {
            return Failed($"The report login could not be used: {ex.GetType().Name}.");
        }

        static ReportsStatus Failed(string message) => new(false, ReportsStates.LoginFailed, message);
    }
}
