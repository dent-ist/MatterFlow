-- provision-report-login.sql
-- DEMO / DEVELOPMENT ONLY. Creates the read-only SQL login that every report runs under, and puts it into the database role mf_report_reader.
-- The password below is public (same as the dev sa password: the dev database is bound to loopback). NEVER run this against a corporate
-- server; there the owner/DBA follows docs/runbook.md section 8 with a long random password kept in the secret store.
--
-- Idempotent and cheap: safe to run on every start. Run it in the MatterFlow database (sqlcmd -d MatterFlow -i ...).
--   * The login and the database user are created when missing.
--   * The role mf_report_reader comes from schema script 30-reports.sql, which the API applies at its first start. Until then the script only
--     creates the login and the user; running it again after the API has started (npm run db:report-login) adds the membership.
SET NOCOUNT ON;

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'mf_reports')
    CREATE LOGIN [mf_reports] WITH PASSWORD = N'MatterFlow_Reports1!', CHECK_POLICY = OFF;

IF DATABASE_PRINCIPAL_ID(N'mf_reports') IS NULL
    CREATE USER [mf_reports] FOR LOGIN [mf_reports];

IF DATABASE_PRINCIPAL_ID(N'mf_report_reader') IS NOT NULL AND ISNULL(IS_ROLEMEMBER(N'mf_report_reader', N'mf_reports'), 0) = 0
    ALTER ROLE [mf_report_reader] ADD MEMBER [mf_reports];

SELECT CASE WHEN DATABASE_PRINCIPAL_ID(N'mf_report_reader') IS NULL THEN N'login and user ready; role mf_report_reader does not exist yet (the API creates it at its first start)'
            ELSE N'login mf_reports is a member of mf_report_reader' END AS ReportLogin;
