-- provision-report-login.sql
-- DEMO / DEVELOPMENT ONLY. Creates the read-only SQL login that every report runs under, and puts it into the database role lpt_report_reader.
-- The password below is public (same as the dev sa password: the dev database is bound to loopback). NEVER run this against a corporate
-- server; there the owner/DBA follows docs/runbook.md section 8 with a long random password kept in the secret store.
--
-- Idempotent and cheap: safe to run on every start. Run it in the LPT Hub database (sqlcmd -d LptHub -i ...).
--   * The login and the database user are created when missing.
--   * In master (one-time server step, issue #1292): the login gets a user with no rights except DENY EXECUTE on the extended procedures
--     (xp_dirtree, xp_fileexist, xp_fixeddrives, xp_msver, xp_regread, ...) that SQL Server grants to PUBLIC. It runs through
--     EXEC master.sys.sp_executesql, so the script needs no USE and no GO. It must be run by an administrator (sysadmin): SQL Server ignores a
--     DENY that a login gives to itself. The same block is in docs/runbook.md section 11 for the corporate server.
--   * The role lpt_report_reader comes from the schema baseline (db/scripts/00-baseline.sql), which the API applies at its first start. Until then the script only
--     creates the login and the user; running it again after the API has started (npm run db:report-login) adds the membership.
SET NOCOUNT ON;

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'lpt_reports')
    CREATE LOGIN [lpt_reports] WITH PASSWORD = N'LptHub_Reports1!', CHECK_POLICY = OFF;

IF DATABASE_PRINCIPAL_ID(N'lpt_reports') IS NULL
    CREATE USER [lpt_reports] FOR LOGIN [lpt_reports];

-- Server step in master. @login is the only thing to change for another login (Windows: N'DOMAIN\account'). Cheap and repeatable: it creates the
-- user when missing and denies every extended procedure that PUBLIC may execute, except four that only format strings or serve replication.
EXEC master.sys.sp_executesql N'
IF SUSER_ID(@login) IS NOT NULL
BEGIN
    DECLARE @sql nvarchar(max);
    IF DATABASE_PRINCIPAL_ID(@login) IS NULL
    BEGIN
        SET @sql = N''CREATE USER '' + QUOTENAME(@login) + N'' FOR LOGIN '' + QUOTENAME(@login) + N'';'';
        EXEC (@sql);
    END;
    SET @sql = N'''';
    SELECT @sql += N''DENY EXECUTE ON OBJECT::'' + QUOTENAME(SCHEMA_NAME(o.schema_id)) + N''.'' + QUOTENAME(o.name) + N'' TO '' + QUOTENAME(@login) + N'';''
    FROM sys.all_objects AS o
    WHERE o.type = ''X'' AND o.name LIKE N''xp[_]%''
      AND o.name NOT IN (N''xp_sprintf'', N''xp_sscanf'', N''xp_qv'', N''xp_replposteor'')
      AND EXISTS (SELECT 1 FROM sys.database_permissions AS p
                  WHERE p.class = 1 AND p.major_id = o.object_id AND p.permission_name = N''EXECUTE'' AND p.state IN (''G'', ''W'')
                    AND p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N''public''));
    IF @sql <> N'''' EXEC (@sql);
END;', N'@login sysname', @login = N'lpt_reports';

IF DATABASE_PRINCIPAL_ID(N'lpt_report_reader') IS NOT NULL AND ISNULL(IS_ROLEMEMBER(N'lpt_report_reader', N'lpt_reports'), 0) = 0
    ALTER ROLE [lpt_report_reader] ADD MEMBER [lpt_reports];

SELECT CASE WHEN DATABASE_PRINCIPAL_ID(N'lpt_report_reader') IS NULL THEN N'login and user ready; role lpt_report_reader does not exist yet (the API creates it at its first start)'
            ELSE N'login lpt_reports is a member of lpt_report_reader' END AS ReportLogin;
