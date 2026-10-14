-- 11-workflow-instances.sql
-- Purpose: workflow EXECUTION state (docs/erd.md section 7, architecture 8.1-8.2, baseline 9.4-9.6, addendum A and K):
--   dbo.WorkflowInstance (one running copy of a published workflow version) and dbo.StepInstance (one row per step with its state).
-- Owner: WorkflowEngine (execution side). The Tasks module (script 12) adds Task.WorkflowInstanceId with its FK to this table.
-- Notes:
--   * There is NO TaskId on WorkflowInstance. The link is owned by the Task (Task.WorkflowInstanceId, UNIQUE, added by the Tasks script),
--     so this module never needs the Task table to exist and instantiation can run before the Task row is inserted.
--   * A StepInstance carries a SNAPSHOT of the published version step (title, description, instructions, documentation URL, sequence,
--     skippable, comment-required, input form version). A running instance therefore never changes when a later version is published
--     or when the library step is edited (SCN-014); WorkflowVersionStepId stays as the informational pointer to the copied row.
--   * Step input values live in dbo.FormValueSet (script 06) with OwnerKind = 'STEP_INSTANCE', OwnerId = StepInstanceId and
--     FormDefinitionId = InputFormDefinitionId; that triple is the "values reference". No value column is duplicated here.
--   * WorkflowInstance.RowVersion is the per-instance optimistic concurrency token. Every step operation also increments Revision,
--     so any two concurrent operations on one instance collide on that row (second one gets 409 CONCURRENCY_CONFLICT).
--   * FirstResolvedAt is set once, on the first resolve, and never cleared (ordering guard, architecture 8.2).

CREATE TABLE dbo.WorkflowInstance (
  WorkflowInstanceId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WorkflowInstance PRIMARY KEY,
  WorkflowVersionId  INT        NOT NULL,
  IsOrdered          BIT        NOT NULL,
  Revision           INT        NOT NULL CONSTRAINT DF_WorkflowInstance_Revision DEFAULT 0,
  CreatedAt          DATETIME2  NOT NULL CONSTRAINT DF_WorkflowInstance_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId    INT        NULL,
  ModifiedAt         DATETIME2  NULL,
  ModifiedByUserId   INT        NULL,
  RowVersion         ROWVERSION NOT NULL,
  CONSTRAINT FK_WorkflowInstance_Version FOREIGN KEY (WorkflowVersionId) REFERENCES dbo.WorkflowVersion (WorkflowVersionId),
  CONSTRAINT FK_WorkflowInstance_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_WorkflowInstance_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_WorkflowInstance_Version ON dbo.WorkflowInstance (WorkflowVersionId);
GO

CREATE TABLE dbo.StepInstance (
  StepInstanceId         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_StepInstance PRIMARY KEY,
  WorkflowInstanceId     BIGINT         NOT NULL,
  WorkflowVersionStepId  INT            NOT NULL,
  SequenceNo             INT            NOT NULL,
  Title                  NVARCHAR(200)  NOT NULL,
  Description            NVARCHAR(1000) NULL,
  Instructions           NVARCHAR(MAX)  NULL,
  DocumentationUrl       NVARCHAR(1000) NULL,
  IsSkippable            BIT            NOT NULL,
  SkipCommentRequired    BIT            NOT NULL,
  InputFormVersionId     INT            NULL,
  InputFormDefinitionId  INT            NULL,
  Status                 VARCHAR(12)    NOT NULL CONSTRAINT DF_StepInstance_Status DEFAULT 'PENDING',
  SkipComment            NVARCHAR(2000) NULL,
  FirstResolvedAt        DATETIME2      NULL,
  ResolvedAt             DATETIME2      NULL,
  ResolvedByUserId       INT            NULL,
  CreatedAt              DATETIME2      NOT NULL CONSTRAINT DF_StepInstance_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId        INT            NULL,
  ModifiedAt             DATETIME2      NULL,
  ModifiedByUserId       INT            NULL,
  RowVersion             ROWVERSION     NOT NULL,
  CONSTRAINT FK_StepInstance_Workflow FOREIGN KEY (WorkflowInstanceId) REFERENCES dbo.WorkflowInstance (WorkflowInstanceId),
  CONSTRAINT FK_StepInstance_VersionStep FOREIGN KEY (WorkflowVersionStepId) REFERENCES dbo.WorkflowVersionStep (WorkflowVersionStepId),
  CONSTRAINT FK_StepInstance_FormVersion FOREIGN KEY (InputFormVersionId) REFERENCES dbo.FormVersion (FormVersionId),
  CONSTRAINT FK_StepInstance_FormDefinition FOREIGN KEY (InputFormDefinitionId) REFERENCES dbo.FormDefinition (FormDefinitionId),
  CONSTRAINT FK_StepInstance_ResolvedBy FOREIGN KEY (ResolvedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_StepInstance_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_StepInstance_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT UQ_StepInstance_VersionStep UNIQUE (WorkflowInstanceId, WorkflowVersionStepId),
  CONSTRAINT UQ_StepInstance_Sequence UNIQUE (WorkflowInstanceId, SequenceNo),
  CONSTRAINT CK_StepInstance_Status CHECK (Status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED')),
  CONSTRAINT CK_StepInstance_Sequence CHECK (SequenceNo >= 1),
  CONSTRAINT CK_StepInstance_Title CHECK (LEN(LTRIM(RTRIM(Title))) > 0),
  CONSTRAINT CK_StepInstance_SkipComment CHECK (SkipCommentRequired = 0 OR IsSkippable = 1),
  CONSTRAINT CK_StepInstance_InputForm CHECK ((InputFormVersionId IS NULL AND InputFormDefinitionId IS NULL) OR (InputFormVersionId IS NOT NULL AND InputFormDefinitionId IS NOT NULL)),
  -- A resolved step has been resolved at least once; a PENDING step never has (it cannot go back to PENDING).
  CONSTRAINT CK_StepInstance_Resolved CHECK (
    (Status IN ('COMPLETED', 'SKIPPED') AND FirstResolvedAt IS NOT NULL AND ResolvedAt IS NOT NULL)
    OR (Status = 'IN_PROGRESS')
    OR (Status = 'PENDING' AND FirstResolvedAt IS NULL))
);
GO

CREATE INDEX IX_StepInstance_Workflow ON dbo.StepInstance (WorkflowInstanceId, SequenceNo);
GO

CREATE INDEX IX_StepInstance_Status ON dbo.StepInstance (Status) WHERE Status IN ('PENDING', 'IN_PROGRESS');
GO

CREATE INDEX IX_StepInstance_FormVersion ON dbo.StepInstance (InputFormVersionId) WHERE InputFormVersionId IS NOT NULL;
GO

-- An instance stays pinned to the version (and ordering mode) it was created from; step snapshot fields never change after creation.
CREATE TRIGGER dbo.TR_WorkflowInstance_Immutable ON dbo.WorkflowInstance
AFTER UPDATE
AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (
    SELECT 1 FROM inserted i JOIN deleted d ON d.WorkflowInstanceId = i.WorkflowInstanceId
    WHERE i.WorkflowVersionId <> d.WorkflowVersionId OR i.IsOrdered <> d.IsOrdered)
    THROW 51021, 'A workflow instance is pinned to its workflow version and cannot be moved.', 1;
END;
GO

CREATE TRIGGER dbo.TR_StepInstance_Immutable ON dbo.StepInstance
AFTER UPDATE
AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (
    SELECT 1 FROM inserted i JOIN deleted d ON d.StepInstanceId = i.StepInstanceId
    WHERE i.WorkflowInstanceId <> d.WorkflowInstanceId OR i.WorkflowVersionStepId <> d.WorkflowVersionStepId OR i.SequenceNo <> d.SequenceNo
       OR i.Title <> d.Title OR ISNULL(i.Description, N'') <> ISNULL(d.Description, N'')
       OR ISNULL(i.Instructions, N'') <> ISNULL(d.Instructions, N'') OR ISNULL(i.DocumentationUrl, N'') <> ISNULL(d.DocumentationUrl, N'')
       OR i.IsSkippable <> d.IsSkippable OR i.SkipCommentRequired <> d.SkipCommentRequired
       OR ISNULL(i.InputFormVersionId, 0) <> ISNULL(d.InputFormVersionId, 0)
       OR (d.FirstResolvedAt IS NOT NULL AND (i.FirstResolvedAt IS NULL OR i.FirstResolvedAt <> d.FirstResolvedAt)))
    THROW 51022, 'The configuration snapshot of a step instance cannot be changed.', 1;
END;
GO
