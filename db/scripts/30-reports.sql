-- 30-reports.sql
-- Purpose: Reports epic #671 (WP-RP1, issue #677; docs/ux/reports-review/README.md sections 2 and 8.1): the report tables
--   (ReportCategory, ReportDefinition, ReportVersion, ReportParameter, RoleReport, SavedReportView, ReportFavourite, ReportRecent, ReportRun)
--   and the database role mf_report_reader that every report runs under (through a separate SQL login, see tools/db/provision-report-login.sql).
-- Owner: Reports.
--
-- Notes:
--   * ReportVersion is append-only (INSTEAD OF trigger: no UPDATE, no DELETE, for everybody). A report keeps its history forever.
--   * ReportRun is the run log: rows are inserted by the app, completed once through dbo.usp_ReportRunComplete (Running -> final status), and
--     deleted only when older than two years (owner decision: keep 2 years) through dbo.usp_ReportRunPurge. mf_app has a DENY on UPDATE and
--     DELETE; the procedures run under ownership chaining, so the DENY does not apply inside them. The triggers repeat the rule for everybody else.
--   * mf_report_reader: SELECT only on the tables that db/report-access.json classifies as "allow", an explicit DENY on the rest, and a DENY on
--     every write, EXECUTE and ALTER right on the dbo schema. It is NOT a member of db_datareader (that would grant everything). A unit test
--     requires every table to be classified and every GRANT/DENY of this role in the scripts to match the catalogue; a schema test checks
--     the effective permissions. A later script that adds a table must add its GRANT or DENY line and its catalogue entry.
--   * The SQL login and the database user for the role are NOT created here (server-level, site specific): see docs/runbook.md and
--     tools/db/provision-report-login.sql.
--   * CurrentVersionId / LastPreviewOkVersionId point at ReportVersion, which points back at ReportDefinition: the two columns are nullable and
--     their foreign keys are added after ReportVersion exists.

CREATE TABLE dbo.ReportCategory (
  ReportCategoryId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ReportCategory PRIMARY KEY,
  Name             NVARCHAR(100) NOT NULL,
  SortOrder        INT           NOT NULL CONSTRAINT DF_ReportCategory_SortOrder DEFAULT 0,
  IsActive         BIT           NOT NULL CONSTRAINT DF_ReportCategory_IsActive DEFAULT 1,
  CreatedAt        DATETIME2     NOT NULL CONSTRAINT DF_ReportCategory_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT           NULL,
  ModifiedAt       DATETIME2     NULL,
  ModifiedByUserId INT           NULL,
  RowVersion       ROWVERSION    NOT NULL,
  CONSTRAINT UQ_ReportCategory_Name UNIQUE (Name),
  CONSTRAINT CK_ReportCategory_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT FK_ReportCategory_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_ReportCategory_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE TABLE dbo.ReportDefinition (
  ReportId               INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ReportDefinition PRIMARY KEY,
  ReportCategoryId       INT            NOT NULL,
  Name                   NVARCHAR(150)  NOT NULL,
  Description            NVARCHAR(1000) NULL,
  HelpText               NVARCHAR(MAX)  NULL,
  SortOrder              INT            NOT NULL CONSTRAINT DF_ReportDefinition_SortOrder DEFAULT 0,
  IsActive               BIT            NOT NULL CONSTRAINT DF_ReportDefinition_IsActive DEFAULT 0,
  CurrentVersionId       INT            NULL,
  TimeoutSeconds         INT            NULL,
  MaxRows                INT            NULL,
  LastPreviewOkVersionId INT            NULL,
  CreatedAt              DATETIME2      NOT NULL CONSTRAINT DF_ReportDefinition_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId        INT            NULL,
  ModifiedAt             DATETIME2      NULL,
  ModifiedByUserId       INT            NULL,
  RowVersion             ROWVERSION     NOT NULL,
  CONSTRAINT UQ_ReportDefinition_Name UNIQUE (Name),
  CONSTRAINT CK_ReportDefinition_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT CK_ReportDefinition_Timeout CHECK (TimeoutSeconds IS NULL OR TimeoutSeconds BETWEEN 1 AND 300),
  CONSTRAINT CK_ReportDefinition_MaxRows CHECK (MaxRows IS NULL OR MaxRows BETWEEN 1 AND 200000),
  -- Never serve a report that has no version (or whose current version was not previewed).
  CONSTRAINT CK_ReportDefinition_ActiveHasVersion CHECK (IsActive = 0 OR CurrentVersionId IS NOT NULL),
  CONSTRAINT FK_ReportDefinition_Category FOREIGN KEY (ReportCategoryId) REFERENCES dbo.ReportCategory (ReportCategoryId),
  CONSTRAINT FK_ReportDefinition_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_ReportDefinition_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_ReportDefinition_Category ON dbo.ReportDefinition (ReportCategoryId, SortOrder);
GO

CREATE TABLE dbo.ReportVersion (
  ReportVersionId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ReportVersion PRIMARY KEY,
  ReportId        INT           NOT NULL,
  VersionNo       INT           NOT NULL,
  SqlText         NVARCHAR(MAX) NOT NULL,
  SqlHash         BINARY(32)    NOT NULL,
  ParametersJson  NVARCHAR(MAX) NOT NULL CONSTRAINT DF_ReportVersion_ParametersJson DEFAULT N'[]',
  ChangeNote      NVARCHAR(300) NULL,
  CreatedAt       DATETIME2     NOT NULL CONSTRAINT DF_ReportVersion_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId INT           NULL,
  CONSTRAINT UQ_ReportVersion_ReportNo UNIQUE (ReportId, VersionNo),
  CONSTRAINT CK_ReportVersion_VersionNo CHECK (VersionNo >= 1),
  CONSTRAINT CK_ReportVersion_Sql CHECK (LEN(SqlText) > 0),
  CONSTRAINT CK_ReportVersion_ParametersJson CHECK (ISJSON(ParametersJson) = 1),
  CONSTRAINT FK_ReportVersion_Report FOREIGN KEY (ReportId) REFERENCES dbo.ReportDefinition (ReportId),
  CONSTRAINT FK_ReportVersion_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

ALTER TABLE dbo.ReportDefinition ADD
  CONSTRAINT FK_ReportDefinition_CurrentVersion FOREIGN KEY (CurrentVersionId) REFERENCES dbo.ReportVersion (ReportVersionId),
  CONSTRAINT FK_ReportDefinition_LastPreviewOkVersion FOREIGN KEY (LastPreviewOkVersionId) REFERENCES dbo.ReportVersion (ReportVersionId);
GO

CREATE INDEX IX_ReportDefinition_CurrentVersion ON dbo.ReportDefinition (CurrentVersionId) WHERE CurrentVersionId IS NOT NULL;
CREATE INDEX IX_ReportDefinition_PreviewVersion ON dbo.ReportDefinition (LastPreviewOkVersionId) WHERE LastPreviewOkVersionId IS NOT NULL;
GO

-- Append-only: a published version is never changed or removed (not even by a privileged login, short of disabling the trigger).
CREATE TRIGGER dbo.TR_ReportVersion_AppendOnly ON dbo.ReportVersion
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51010, 'Report versions are append-only: they cannot be changed or deleted.', 1;
END;
GO

CREATE TABLE dbo.ReportParameter (
  ReportParameterId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ReportParameter PRIMARY KEY,
  ReportId          INT            NOT NULL,
  Name              VARCHAR(64)    NOT NULL,
  Ordinal           INT            NOT NULL CONSTRAINT DF_ReportParameter_Ordinal DEFAULT 0,
  Type              VARCHAR(20)    NOT NULL,
  LookupKind        VARCHAR(20)    NULL,
  LookupMulti       BIT            NOT NULL CONSTRAINT DF_ReportParameter_LookupMulti DEFAULT 0,
  Label             NVARCHAR(100)  NOT NULL,
  HelpText          NVARCHAR(300)  NULL,
  DefaultJson       NVARCHAR(500)  NULL,
  IsRequired        BIT            NOT NULL CONSTRAINT DF_ReportParameter_IsRequired DEFAULT 0,
  OptionsKind       VARCHAR(10)    NULL,
  OptionsJson       NVARCHAR(MAX)  NULL,
  OptionsSql        NVARCHAR(MAX)  NULL,
  SettingsJson      NVARCHAR(MAX)  NULL,
  CONSTRAINT UQ_ReportParameter_Name UNIQUE (ReportId, Name),
  CONSTRAINT CK_ReportParameter_Name CHECK (Name COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^A-Z0-9_]%' AND Name COLLATE Latin1_General_100_BIN2 NOT LIKE '[0-9]%' AND LEN(Name) > 0),
  CONSTRAINT CK_ReportParameter_Type CHECK (Type IN ('number', 'date', 'text', 'single', 'multi', 'daterange', 'yesno', 'lookup')),
  CONSTRAINT CK_ReportParameter_LookupKind CHECK (LookupKind IS NULL OR LookupKind IN ('matter', 'client', 'user', 'pod', 'role', 'taskType')),
  CONSTRAINT CK_ReportParameter_OptionsKind CHECK (OptionsKind IS NULL OR OptionsKind IN ('fixed', 'query')),
  CONSTRAINT CK_ReportParameter_Json CHECK ((OptionsJson IS NULL OR ISJSON(OptionsJson) = 1) AND (SettingsJson IS NULL OR ISJSON(SettingsJson) = 1)),
  CONSTRAINT FK_ReportParameter_Report FOREIGN KEY (ReportId) REFERENCES dbo.ReportDefinition (ReportId)
);
GO

CREATE TABLE dbo.RoleReport (
  RoleId          INT       NOT NULL,
  ReportId        INT       NOT NULL,
  GrantedAt       DATETIME2 NOT NULL CONSTRAINT DF_RoleReport_GrantedAt DEFAULT SYSUTCDATETIME(),
  GrantedByUserId INT       NULL,
  CONSTRAINT PK_RoleReport PRIMARY KEY (RoleId, ReportId),
  CONSTRAINT FK_RoleReport_Role FOREIGN KEY (RoleId) REFERENCES dbo.Role (RoleId),
  CONSTRAINT FK_RoleReport_Report FOREIGN KEY (ReportId) REFERENCES dbo.ReportDefinition (ReportId),
  CONSTRAINT FK_RoleReport_GrantedBy FOREIGN KEY (GrantedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_RoleReport_Report ON dbo.RoleReport (ReportId);
GO

CREATE TABLE dbo.SavedReportView (
  SavedReportViewId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SavedReportView PRIMARY KEY,
  ReportId          INT           NOT NULL,
  UserId            INT           NOT NULL,
  Name              NVARCHAR(100) NOT NULL,
  IsDefault         BIT           NOT NULL CONSTRAINT DF_SavedReportView_IsDefault DEFAULT 0,
  ViewJson          NVARCHAR(MAX) NOT NULL,
  ParamsJson        NVARCHAR(MAX) NULL,
  CreatedAt         DATETIME2     NOT NULL CONSTRAINT DF_SavedReportView_CreatedAt DEFAULT SYSUTCDATETIME(),
  ModifiedAt        DATETIME2     NULL,
  RowVersion        ROWVERSION    NOT NULL,
  CONSTRAINT UQ_SavedReportView_Name UNIQUE (ReportId, UserId, Name),
  CONSTRAINT CK_SavedReportView_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT CK_SavedReportView_Json CHECK (ISJSON(ViewJson) = 1 AND (ParamsJson IS NULL OR ISJSON(ParamsJson) = 1)),
  CONSTRAINT FK_SavedReportView_Report FOREIGN KEY (ReportId) REFERENCES dbo.ReportDefinition (ReportId),
  CONSTRAINT FK_SavedReportView_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId)
);
GO

-- At most one default view per report and person.
CREATE UNIQUE INDEX UX_SavedReportView_Default ON dbo.SavedReportView (ReportId, UserId) WHERE IsDefault = 1;
CREATE INDEX IX_SavedReportView_User ON dbo.SavedReportView (UserId, ReportId);
GO

CREATE TABLE dbo.ReportFavourite (
  UserId   INT       NOT NULL,
  ReportId INT       NOT NULL,
  PinnedAt DATETIME2 NOT NULL CONSTRAINT DF_ReportFavourite_PinnedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_ReportFavourite PRIMARY KEY (UserId, ReportId),
  CONSTRAINT FK_ReportFavourite_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_ReportFavourite_Report FOREIGN KEY (ReportId) REFERENCES dbo.ReportDefinition (ReportId)
);
GO

CREATE TABLE dbo.ReportRecent (
  UserId    INT       NOT NULL,
  ReportId  INT       NOT NULL,
  LastRunAt DATETIME2 NOT NULL,
  CONSTRAINT PK_ReportRecent PRIMARY KEY (UserId, ReportId),
  CONSTRAINT FK_ReportRecent_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_ReportRecent_Report FOREIGN KEY (ReportId) REFERENCES dbo.ReportDefinition (ReportId)
);
GO

CREATE TABLE dbo.ReportRun (
  ReportRunId      BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ReportRun PRIMARY KEY,
  ReportId         INT              NOT NULL,
  ReportVersionId  INT              NOT NULL,
  UserId           INT              NOT NULL,
  StartedAt        DATETIME2        NOT NULL CONSTRAINT DF_ReportRun_StartedAt DEFAULT SYSUTCDATETIME(),
  FinishedAt       DATETIME2        NULL,
  Status           VARCHAR(12)      NOT NULL,
  Kind             VARCHAR(12)      NOT NULL,
  ParametersJson   NVARCHAR(4000)   NULL,
  [RowCount]       INT              NULL,
  Truncated        BIT              NOT NULL CONSTRAINT DF_ReportRun_Truncated DEFAULT 0,
  DurationMs       INT              NULL,
  ErrorCode        VARCHAR(40)      NULL,
  ExportedRowCount INT              NULL,
  CorrelationId    UNIQUEIDENTIFIER NOT NULL,
  CONSTRAINT CK_ReportRun_Status CHECK (Status IN ('Running', 'Succeeded', 'Failed', 'Cancelled', 'TimedOut', 'Truncated', 'Rejected')),
  CONSTRAINT CK_ReportRun_Kind CHECK (Kind IN ('Run', 'Preview', 'Export', 'ChoiceQuery')),
  CONSTRAINT CK_ReportRun_Json CHECK (ParametersJson IS NULL OR ISJSON(ParametersJson) = 1),
  CONSTRAINT FK_ReportRun_Report FOREIGN KEY (ReportId) REFERENCES dbo.ReportDefinition (ReportId),
  CONSTRAINT FK_ReportRun_Version FOREIGN KEY (ReportVersionId) REFERENCES dbo.ReportVersion (ReportVersionId),
  CONSTRAINT FK_ReportRun_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_ReportRun_User ON dbo.ReportRun (UserId, StartedAt DESC);
CREATE INDEX IX_ReportRun_Report ON dbo.ReportRun (ReportId, StartedAt DESC);
CREATE INDEX IX_ReportRun_Started ON dbo.ReportRun (StartedAt);
GO

-- The run log is append-only: the identity of a run never changes (only the completion columns, once), and a row may be deleted
-- only after the two-year retention (dbo.usp_ReportRunPurge).
CREATE TRIGGER dbo.TR_ReportRun_Guard ON dbo.ReportRun
AFTER UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM inserted)
  BEGIN
    IF EXISTS (SELECT 1 FROM deleted WHERE StartedAt >= DATEADD(YEAR, -2, SYSUTCDATETIME()))
    BEGIN
      ROLLBACK;
      THROW 51011, 'Report runs are kept for two years and cannot be deleted before that.', 1;
    END;
    RETURN;
  END;

  IF UPDATE(ReportRunId) OR UPDATE(ReportId) OR UPDATE(ReportVersionId) OR UPDATE(UserId) OR UPDATE(StartedAt)
     OR UPDATE(Kind) OR UPDATE(ParametersJson) OR UPDATE(CorrelationId)
     OR EXISTS (SELECT 1 FROM deleted WHERE Status <> 'Running')
  BEGIN
    ROLLBACK;
    THROW 51012, 'A report run can only be completed once; its other columns never change.', 1;
  END;
END;
GO

-- The one write path that completes a run (Running -> final status). Runs with the owner's rights, so the DENY UPDATE of mf_app does not apply.
CREATE PROCEDURE dbo.usp_ReportRunComplete
  @ReportRunId      BIGINT,
  @Status           VARCHAR(12),
  @RowCount         INT = NULL,
  @Truncated        BIT = 0,
  @DurationMs       INT = NULL,
  @ErrorCode        VARCHAR(40) = NULL,
  @ExportedRowCount INT = NULL
AS
BEGIN
  SET NOCOUNT ON;
  IF @Status NOT IN ('Succeeded', 'Failed', 'Cancelled', 'TimedOut', 'Truncated', 'Rejected')
    THROW 51013, 'Invalid final status for a report run.', 1;

  UPDATE dbo.ReportRun
  SET FinishedAt = SYSUTCDATETIME(), Status = @Status, [RowCount] = @RowCount, Truncated = @Truncated,
      DurationMs = @DurationMs, ErrorCode = @ErrorCode, ExportedRowCount = @ExportedRowCount
  WHERE ReportRunId = @ReportRunId AND Status = 'Running';

  SELECT @@ROWCOUNT AS Completed;
END;
GO

-- Retention: deletes runs older than two years (the trigger refuses anything younger). Scheduled by the app.
CREATE PROCEDURE dbo.usp_ReportRunPurge
  @MaxRows INT = 5000
AS
BEGIN
  SET NOCOUNT ON;
  DELETE TOP (@MaxRows) FROM dbo.ReportRun WHERE StartedAt < DATEADD(YEAR, -2, SYSUTCDATETIME());
  SELECT @@ROWCOUNT AS Purged;
END;
GO

-- Application identity: no direct writes to the append-only tables (a DENY beats the schema-level GRANT of script 13).
DENY UPDATE, DELETE ON dbo.ReportVersion TO mf_app;
DENY UPDATE, DELETE ON dbo.ReportRun TO mf_app;
DENY ALTER ON dbo.ReportVersion TO mf_app;
DENY ALTER ON dbo.ReportRun TO mf_app;
GO

-- ---------------------------------------------------------------------------------------------------------------------------------
-- The read-only role every report runs under. Membership comes from tools/db/provision-report-login.sql (demo) or the DBA (runbook).
-- ---------------------------------------------------------------------------------------------------------------------------------
IF DATABASE_PRINCIPAL_ID('mf_report_reader') IS NULL
  CREATE ROLE mf_report_reader;
GO

-- Nothing that writes, executes or changes the schema, whatever else the login might inherit.
-- (No DENY CONTROL: CONTROL implies every right, so denying it would also deny the SELECT grants below.)
DENY INSERT, UPDATE, DELETE, EXECUTE, ALTER, REFERENCES, TAKE OWNERSHIP ON SCHEMA::dbo TO mf_report_reader;
DENY CREATE TABLE, CREATE VIEW, CREATE PROCEDURE, CREATE FUNCTION, CREATE SCHEMA, CREATE TYPE, CREATE RULE, CREATE DEFAULT TO mf_report_reader;
GO

-- Allowed (db/report-access.json, access = allow): read-only business data.
GRANT SELECT ON dbo.AppUser TO mf_report_reader;
GRANT SELECT ON dbo.Asset TO mf_report_reader;
GRANT SELECT ON dbo.AssetLinkRole TO mf_report_reader;
GRANT SELECT ON dbo.AssetType TO mf_report_reader;
GRANT SELECT ON dbo.Client TO mf_report_reader;
GRANT SELECT ON dbo.CustomFieldIndex TO mf_report_reader;
GRANT SELECT ON dbo.FormDefinition TO mf_report_reader;
GRANT SELECT ON dbo.FormField TO mf_report_reader;
GRANT SELECT ON dbo.FormFieldOption TO mf_report_reader;
GRANT SELECT ON dbo.FormValueSet TO mf_report_reader;
GRANT SELECT ON dbo.FormVersion TO mf_report_reader;
GRANT SELECT ON dbo.Matter TO mf_report_reader;
GRANT SELECT ON dbo.Pod TO mf_report_reader;
GRANT SELECT ON dbo.PodMember TO mf_report_reader;
GRANT SELECT ON dbo.Priority TO mf_report_reader;
GRANT SELECT ON dbo.Project TO mf_report_reader;
GRANT SELECT ON dbo.Role TO mf_report_reader;
GRANT SELECT ON dbo.StepDefinition TO mf_report_reader;
GRANT SELECT ON dbo.StepDefinitionTag TO mf_report_reader;
GRANT SELECT ON dbo.StepInstance TO mf_report_reader;
GRANT SELECT ON dbo.StepTag TO mf_report_reader;
GRANT SELECT ON dbo.Task TO mf_report_reader;
GRANT SELECT ON dbo.TaskAsset TO mf_report_reader;
GRANT SELECT ON dbo.TaskComment TO mf_report_reader;
GRANT SELECT ON dbo.TaskStatusLabel TO mf_report_reader;
GRANT SELECT ON dbo.TaskType TO mf_report_reader;
GRANT SELECT ON dbo.TaskTypeWorkflowEligibility TO mf_report_reader;
GRANT SELECT ON dbo.UserAvailability TO mf_report_reader;
GRANT SELECT ON dbo.UserRole TO mf_report_reader;
GRANT SELECT ON dbo.UserWorkHour TO mf_report_reader;
GRANT SELECT ON dbo.WorkflowDefinition TO mf_report_reader;
GRANT SELECT ON dbo.WorkflowInstance TO mf_report_reader;
GRANT SELECT ON dbo.WorkflowVersion TO mf_report_reader;
GRANT SELECT ON dbo.WorkflowVersionStep TO mf_report_reader;
GO

-- Denied (db/report-access.json, access = deny): audit, credentials, internal bookkeeping, authorization data and the report tables themselves.
DENY SELECT, VIEW DEFINITION ON dbo.AuditEvent TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.AuditEventGuard TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.UserIdentity TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.SeedMarker TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.SchemaMigration TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.Permission TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.RolePermission TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.Notification TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.NotificationPreference TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.TaskCommentRevision TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.ReportCategory TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.ReportDefinition TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.ReportVersion TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.ReportParameter TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.RoleReport TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.SavedReportView TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.ReportFavourite TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.ReportRecent TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.ReportRun TO mf_report_reader;
GO
