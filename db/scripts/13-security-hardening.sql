-- 13-security-hardening.sql
-- Purpose: make the append-only audit trail enforceable in a default install (security review SEC-04).
-- Owner: Audit / Platform.
--
-- Before this script the DENY on dbo.AuditEvent in 03-audit.sql ran only when a principal named mf_app already existed, which no script
-- or document step created, so a default install had no permissions on the table at all. TRUNCATE TABLE also bypassed the INSTEAD OF
-- trigger. This script (all idempotent in effect, applied once by the runner):
--   1. creates the database roles mf_app (application: DML + EXECUTE only, no DDL) and mf_migrator (schema runner: DDL + DML), unless a
--      principal with that name already exists (then the permissions below are applied to it);
--   2. applies the audit permissions unconditionally: mf_app and mf_migrator may INSERT and SELECT but never UPDATE or DELETE rows;
--      mf_app additionally cannot ALTER the table (this also denies TRUNCATE TABLE and DROP/DISABLE TRIGGER for the app identity);
--   3. makes TRUNCATE TABLE impossible for everybody by giving dbo.AuditEvent a (permanently empty) referencing table: SQL Server refuses
--      to truncate a table that a foreign key references, even from sysadmin;
--   4. adds a database DDL trigger that refuses DROP TABLE of the audit tables, ALTER TABLE of the guard table and DROP/ALTER of the
--      append-only trigger. SQL Server raises no DDL event for DISABLE TRIGGER or for dropping a DDL trigger, so a privileged login
--      (sysadmin, db_owner) can still disable the INSTEAD OF trigger or this DDL trigger deliberately; the application identity cannot (it is denied ALTER on the table), and
--      the API verifies at startup that it has no such rights. Detection of deliberate tampering is a monitoring task (runbook).
--
-- DBA step after the first deployment (not possible in a script because logins are server-level and site specific):
--   CREATE USER [DOMAIN\app-pool-gmsa$] FOR LOGIN [DOMAIN\app-pool-gmsa$];  ALTER ROLE mf_app ADD MEMBER [DOMAIN\app-pool-gmsa$];
--   and, if a separate migration login is used:  ALTER ROLE mf_migrator ADD MEMBER [<migration user>];
-- The application identity must NOT be db_owner or sysadmin; the API verifies this at startup (docs/runbook.md section 3).

IF DATABASE_PRINCIPAL_ID('mf_app') IS NULL
    CREATE ROLE mf_app;
IF DATABASE_PRINCIPAL_ID('mf_migrator') IS NULL
    CREATE ROLE mf_migrator;
GO

-- Application: data access only.
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON SCHEMA::dbo TO mf_app;
-- Schema runner: DDL plus data (structural seeds).
ALTER ROLE db_ddladmin ADD MEMBER mf_migrator;
ALTER ROLE db_datareader ADD MEMBER mf_migrator;
ALTER ROLE db_datawriter ADD MEMBER mf_migrator;
GRANT EXECUTE ON SCHEMA::dbo TO mf_migrator;
GO

-- The audit table: append-only for both. An object-level DENY wins over the schema-level GRANT above.
GRANT INSERT, SELECT ON dbo.AuditEvent TO mf_app;
GRANT INSERT, SELECT ON dbo.AuditEvent TO mf_migrator;
DENY UPDATE, DELETE ON dbo.AuditEvent TO mf_app;
DENY UPDATE, DELETE ON dbo.AuditEvent TO mf_migrator;
DENY ALTER ON dbo.AuditEvent TO mf_app;
GO

-- TRUNCATE guard: an empty table whose foreign key references AuditEvent (error 4712 "Cannot truncate table ... referenced by a FOREIGN KEY").
CREATE TABLE dbo.AuditEventGuard (
    AuditEventId BIGINT NOT NULL,
    CONSTRAINT PK_AuditEventGuard PRIMARY KEY CLUSTERED (AuditEventId),
    CONSTRAINT FK_AuditEventGuard_AuditEvent FOREIGN KEY (AuditEventId) REFERENCES dbo.AuditEvent (AuditEventId)
);
GO

DENY SELECT, INSERT, UPDATE, DELETE, REFERENCES, ALTER ON dbo.AuditEventGuard TO mf_app;
GO

CREATE TRIGGER TR_Protect_AuditEvent ON DATABASE
FOR DROP_TABLE, ALTER_TABLE, DROP_TRIGGER, ALTER_TRIGGER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @event xml = EVENTDATA();
    DECLARE @object sysname = @event.value('(/EVENT_INSTANCE/ObjectName)[1]', 'sysname');
    DECLARE @target sysname = @event.value('(/EVENT_INSTANCE/TargetObjectName)[1]', 'sysname');
    DECLARE @type sysname = @event.value('(/EVENT_INSTANCE/EventType)[1]', 'sysname');

    -- ALTER TABLE on the audit table stays possible for later schema scripts (new columns, FKs); the guard table may not be altered at
    -- all (that would allow dropping its foreign key, and with it the TRUNCATE guard).
    IF (@type = N'ALTER_TABLE' AND @object = N'AuditEventGuard')
       OR (@type <> N'ALTER_TABLE' AND (@object IN (N'AuditEvent', N'AuditEventGuard', N'TR_AuditEvent_AppendOnly', N'TR_Protect_AuditEvent')
                                        OR @target IN (N'AuditEvent', N'AuditEventGuard')))
    BEGIN
        ROLLBACK;
        THROW 51001, 'The audit trail is protected: its tables and the append-only trigger cannot be dropped or altered this way.', 1;
    END;
END;
GO
