-- 09-workflow-config.sql
-- Purpose: workflow configuration (docs/erd.md section 7, architecture 8.1, baseline 9, addendum A):
--   dbo.StepDefinition (the step library), dbo.WorkflowDefinition, dbo.WorkflowVersion, dbo.WorkflowVersionStep,
--   the immutability triggers for published/retired workflow versions and their steps, and the deferred
--   FK_FormDef_Step from 06-forms.sql.
-- Owner: WorkflowEngine (definition side). WorkflowInstance and StepInstance arrive with the instantiation ticket.
-- Notes:
--   * A WorkflowVersionStep carries a COPY of the library step's text and the pinned PUBLISHED input form version. The copy is
--     (re)taken from the library when the version is published, so editing the library later never changes a published version.
--   * A step appears at most once per version (UQ_WVS_Source).
--   * dbo.TaskTypeWorkflow (script 08, plain WorkflowDefinitionId) gets its FK to dbo.WorkflowDefinition in a later script.

CREATE TABLE dbo.StepDefinition (
  StepDefinitionId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_StepDefinition PRIMARY KEY,
  Title            NVARCHAR(200)  NOT NULL,
  Description      NVARCHAR(1000) NULL,
  Instructions     NVARCHAR(MAX)  NULL,
  DocumentationUrl NVARCHAR(1000) NULL,
  IsActive         BIT            NOT NULL CONSTRAINT DF_StepDefinition_IsActive DEFAULT 1,
  CreatedAt        DATETIME2      NOT NULL CONSTRAINT DF_StepDefinition_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT            NULL,
  ModifiedAt       DATETIME2      NULL,
  ModifiedByUserId INT            NULL,
  RowVersion       ROWVERSION     NOT NULL,
  CONSTRAINT FK_StepDefinition_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_StepDefinition_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT CK_StepDefinition_Title CHECK (LEN(LTRIM(RTRIM(Title))) > 0)
);
GO

-- Titles are unique among ACTIVE steps (a deactivated title can be reused).
CREATE UNIQUE INDEX UQ_StepDefinition_Title ON dbo.StepDefinition (Title) WHERE IsActive = 1;
GO

-- The step's input form is a FormDefinition of scope STEP (06-forms.sql); this adds the owner foreign key it deferred.
ALTER TABLE dbo.FormDefinition ADD CONSTRAINT FK_FormDef_Step FOREIGN KEY (StepDefinitionId) REFERENCES dbo.StepDefinition (StepDefinitionId);
GO

CREATE TABLE dbo.WorkflowDefinition (
  WorkflowDefinitionId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WorkflowDefinition PRIMARY KEY,
  Name                 NVARCHAR(200)  NOT NULL,
  Description          NVARCHAR(1000) NULL,
  IsActive             BIT            NOT NULL CONSTRAINT DF_WorkflowDefinition_IsActive DEFAULT 1,
  CreatedAt            DATETIME2      NOT NULL CONSTRAINT DF_WorkflowDefinition_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId      INT            NULL,
  ModifiedAt           DATETIME2      NULL,
  ModifiedByUserId     INT            NULL,
  RowVersion           ROWVERSION     NOT NULL,
  CONSTRAINT FK_WorkflowDefinition_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_WorkflowDefinition_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT UQ_WorkflowDefinition_Name UNIQUE (Name),
  CONSTRAINT CK_WorkflowDefinition_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0)
);
GO

CREATE TABLE dbo.WorkflowVersion (
  WorkflowVersionId    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WorkflowVersion PRIMARY KEY,
  WorkflowDefinitionId INT         NOT NULL,
  VersionNo            INT         NOT NULL,
  Status               VARCHAR(12) NOT NULL,
  IsOrdered            BIT         NOT NULL CONSTRAINT DF_WorkflowVersion_IsOrdered DEFAULT 1,
  PublishedAt          DATETIME2   NULL,
  PublishedByUserId    INT         NULL,
  CreatedAt            DATETIME2   NOT NULL CONSTRAINT DF_WorkflowVersion_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId      INT         NULL,
  ModifiedAt           DATETIME2   NULL,
  ModifiedByUserId     INT         NULL,
  RowVersion           ROWVERSION  NOT NULL,
  CONSTRAINT FK_WorkflowVersion_Definition FOREIGN KEY (WorkflowDefinitionId) REFERENCES dbo.WorkflowDefinition (WorkflowDefinitionId),
  CONSTRAINT FK_WorkflowVersion_PublishedBy FOREIGN KEY (PublishedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_WorkflowVersion_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_WorkflowVersion_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT UQ_WorkflowVersion_No UNIQUE (WorkflowDefinitionId, VersionNo),
  CONSTRAINT CK_WorkflowVersion_Status CHECK (Status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  CONSTRAINT CK_WorkflowVersion_PublishedAt CHECK (Status = 'DRAFT' OR PublishedAt IS NOT NULL)
);
GO

CREATE UNIQUE INDEX UQ_WorkflowVersion_Published ON dbo.WorkflowVersion (WorkflowDefinitionId) WHERE Status = 'PUBLISHED';
GO

CREATE UNIQUE INDEX UQ_WorkflowVersion_Draft ON dbo.WorkflowVersion (WorkflowDefinitionId) WHERE Status = 'DRAFT';
GO

CREATE TABLE dbo.WorkflowVersionStep (
  WorkflowVersionStepId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WorkflowVersionStep PRIMARY KEY,
  WorkflowVersionId     INT            NOT NULL,
  SequenceNo            INT            NOT NULL,
  SourceStepDefinitionId INT           NOT NULL,
  Title                 NVARCHAR(200)  NOT NULL,
  Description           NVARCHAR(1000) NULL,
  Instructions          NVARCHAR(MAX)  NULL,
  DocumentationUrl      NVARCHAR(1000) NULL,
  StepFormVersionId     INT            NULL,
  IsSkippable           BIT            NOT NULL CONSTRAINT DF_WVS_IsSkippable DEFAULT 0,
  SkipCommentRequired   BIT            NOT NULL CONSTRAINT DF_WVS_SkipCommentRequired DEFAULT 0,
  CONSTRAINT FK_WVS_Version FOREIGN KEY (WorkflowVersionId) REFERENCES dbo.WorkflowVersion (WorkflowVersionId),
  CONSTRAINT FK_WVS_Source FOREIGN KEY (SourceStepDefinitionId) REFERENCES dbo.StepDefinition (StepDefinitionId),
  CONSTRAINT FK_WVS_FormVersion FOREIGN KEY (StepFormVersionId) REFERENCES dbo.FormVersion (FormVersionId),
  CONSTRAINT UQ_WVS_Sequence UNIQUE (WorkflowVersionId, SequenceNo),
  CONSTRAINT UQ_WVS_Source UNIQUE (WorkflowVersionId, SourceStepDefinitionId),
  CONSTRAINT CK_WVS_Sequence CHECK (SequenceNo >= 1),
  CONSTRAINT CK_WVS_Title CHECK (LEN(LTRIM(RTRIM(Title))) > 0),
  CONSTRAINT CK_WVS_SkipComment CHECK (SkipCommentRequired = 0 OR IsSkippable = 1)
);
GO

CREATE INDEX IX_WVS_Source ON dbo.WorkflowVersionStep (SourceStepDefinitionId);
GO

CREATE INDEX IX_WVS_FormVersion ON dbo.WorkflowVersionStep (StepFormVersionId) WHERE StepFormVersionId IS NOT NULL;
GO

-- Immutability (same pattern as forms, TR_FormVersion_Immutable). A version may change freely while DRAFT. Once PUBLISHED it can only
-- become RETIRED (every other column stays equal; audit stamps and the rowversion may move), and it is never deleted. Retired is final.
CREATE TRIGGER dbo.TR_WorkflowVersion_Immutable ON dbo.WorkflowVersion
AFTER UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (SELECT 1 FROM deleted d WHERE d.Status <> 'DRAFT')
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM inserted)
      THROW 51011, 'A published or retired workflow version is immutable and cannot be deleted.', 1;

    IF EXISTS (
      SELECT 1 FROM deleted d JOIN inserted i ON i.WorkflowVersionId = d.WorkflowVersionId
      WHERE d.Status <> 'DRAFT' AND NOT (d.Status = 'PUBLISHED' AND i.Status = 'RETIRED'))
      THROW 51012, 'A published or retired workflow version is immutable (only PUBLISHED to RETIRED is allowed).', 1;

    IF EXISTS (
      SELECT d.WorkflowVersionId, d.WorkflowDefinitionId, d.VersionNo, d.IsOrdered, d.PublishedAt, d.PublishedByUserId, d.CreatedAt, d.CreatedByUserId
      FROM deleted d WHERE d.Status <> 'DRAFT'
      EXCEPT
      SELECT i.WorkflowVersionId, i.WorkflowDefinitionId, i.VersionNo, i.IsOrdered, i.PublishedAt, i.PublishedByUserId, i.CreatedAt, i.CreatedByUserId
      FROM inserted i)
      THROW 51013, 'A published or retired workflow version is immutable (only its status may change to RETIRED).', 1;
  END
END;
GO

CREATE TRIGGER dbo.TR_WorkflowVersionStep_Immutable ON dbo.WorkflowVersionStep
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (
    SELECT 1
    FROM (SELECT WorkflowVersionId FROM inserted UNION SELECT WorkflowVersionId FROM deleted) x
    JOIN dbo.WorkflowVersion v ON v.WorkflowVersionId = x.WorkflowVersionId
    WHERE v.Status <> 'DRAFT')
    THROW 51014, 'Steps of a published or retired workflow version are immutable.', 1;
END;
GO
