-- 12-tasks.sql
-- Purpose: the Task core (docs/erd.md section 5, architecture 8.3/8.4/10, decisions addendum A, C, G, M, O):
--   dbo.Task and dbo.TaskComment (minimal comment storage: the cancel / on-hold reason and, later, user comments).
-- Owner: WorkManagement.
--
-- Notes:
--   * TaskNumber is 'TSK-' + dbo.TaskNumberSeq (01-init.sql). The application takes the next sequence value and formats it with the domain helper;
--     the column default does the same for raw inserts, so the number is never null and never reused.
--   * Project must belong to the Task's Matter: composite FK (ProjectId, MatterId) -> Project (UQ_Project_IdMatter). SQL Server skips a
--     composite FK when any column is NULL, so Tasks without a Project are valid.
--   * WorkflowInstanceId is UNIQUE (exactly one workflow instance per Task) and the link is owned by the Task (script 11 has no TaskId).
--   * FormVersionId is the request form version captured at creation. It is NULL when the Task Type has no request form fields.
--     The request form VALUES live in dbo.FormValueSet (OwnerKind 'TASK'), pinned to that version; there is no FormValuesJson column.
--   * Due semantics (addendum M): DueDate NULL = ASAP (never overdue); DueAtUtc only when a time was chosen; DueSortKey is the ordering
--     key (the instant, or the date at 23:59:59 treated as UTC). The exact overdue flag is computed at query time in the viewer's zone.
--   * TR_Task_Immutable blocks changes to MatterId, TaskTypeId, WorkflowInstanceId, FormVersionId and TaskNumber (defense in depth).
--   * CANCEL / ON_HOLD comments are the stored reason of a status change: they can never be soft-deleted (CHECK) and no comment can be
--     hard-deleted (trigger). A Task is never deleted either.

CREATE TABLE dbo.Task (
  TaskId             BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Task PRIMARY KEY,
  TaskNumber         VARCHAR(20)    NOT NULL CONSTRAINT DF_Task_Number DEFAULT ('TSK-' + CAST(NEXT VALUE FOR dbo.TaskNumberSeq AS VARCHAR(18))),
  MatterId           INT            NOT NULL,
  ProjectId          INT            NULL,
  TaskTypeId         INT            NOT NULL,
  FormVersionId      INT            NULL,
  WorkflowInstanceId BIGINT         NOT NULL,
  Title              NVARCHAR(300)  NOT NULL,
  Description        NVARCHAR(MAX)  NULL,
  PriorityId         INT            NOT NULL,
  StatusCode         VARCHAR(20)    NOT NULL CONSTRAINT DF_Task_StatusCode DEFAULT 'NEW',
  AssignedPodId      INT            NULL,
  AssignedUserId     INT            NULL,
  RequestorName      NVARCHAR(200)  NOT NULL,
  RequestorEmail     NVARCHAR(320)  NULL,
  RequestedAt        DATETIME2(3)   NULL,
  DueDate            DATE           NULL,
  DueAtUtc           DATETIME2(3)   NULL,
  DueSortKey         DATETIME2(3)   NULL,
  StatusChangedAt    DATETIME2(3)   NOT NULL CONSTRAINT DF_Task_StatusChangedAt DEFAULT SYSUTCDATETIME(),
  CompletedAt        DATETIME2(3)   NULL,
  CreatedAt          DATETIME2      NOT NULL CONSTRAINT DF_Task_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId    INT            NULL,
  ModifiedAt         DATETIME2      NULL,
  ModifiedByUserId   INT            NULL,
  RowVersion         ROWVERSION     NOT NULL,
  CONSTRAINT UQ_Task_Number UNIQUE (TaskNumber),
  CONSTRAINT UQ_Task_IdMatter UNIQUE (TaskId, MatterId),
  CONSTRAINT UQ_Task_WorkflowInstance UNIQUE (WorkflowInstanceId),
  CONSTRAINT FK_Task_Matter FOREIGN KEY (MatterId) REFERENCES dbo.Matter (MatterId),
  CONSTRAINT FK_Task_Project_SameMatter FOREIGN KEY (ProjectId, MatterId) REFERENCES dbo.Project (ProjectId, MatterId),
  CONSTRAINT FK_Task_TaskType FOREIGN KEY (TaskTypeId) REFERENCES dbo.TaskType (TaskTypeId),
  CONSTRAINT FK_Task_FormVersion FOREIGN KEY (FormVersionId) REFERENCES dbo.FormVersion (FormVersionId),
  CONSTRAINT FK_Task_WorkflowInstance FOREIGN KEY (WorkflowInstanceId) REFERENCES dbo.WorkflowInstance (WorkflowInstanceId),
  CONSTRAINT FK_Task_Priority FOREIGN KEY (PriorityId) REFERENCES dbo.Priority (PriorityId),
  CONSTRAINT FK_Task_Status FOREIGN KEY (StatusCode) REFERENCES dbo.TaskStatusLabel (StatusCode),
  CONSTRAINT FK_Task_AssignedPod FOREIGN KEY (AssignedPodId) REFERENCES dbo.Pod (PodId),
  CONSTRAINT FK_Task_AssignedUser FOREIGN KEY (AssignedUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Task_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Task_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT CK_Task_StatusCode CHECK (StatusCode IN ('NEW', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT CK_Task_Title CHECK (LEN(LTRIM(RTRIM(Title))) > 0),
  CONSTRAINT CK_Task_RequestorName CHECK (LEN(LTRIM(RTRIM(RequestorName))) > 0),
  CONSTRAINT CK_Task_RequestorEmail CHECK (RequestorEmail IS NULL OR RequestorEmail LIKE '%_@_%'),
  CONSTRAINT CK_Task_DueAt CHECK (DueAtUtc IS NULL OR DueDate IS NOT NULL),
  CONSTRAINT CK_Task_DueSortKey CHECK ((DueDate IS NULL AND DueSortKey IS NULL) OR (DueDate IS NOT NULL AND DueSortKey IS NOT NULL)),
  -- CompletedAt is set on COMPLETED and cleared on leaving it (architecture 8.3 rule 8).
  CONSTRAINT CK_Task_CompletedAt CHECK ((StatusCode = 'COMPLETED' AND CompletedAt IS NOT NULL) OR (StatusCode <> 'COMPLETED' AND CompletedAt IS NULL))
);
GO

-- Queue / My Work / Pod Work / dashboard / search (docs/erd.md section 5).
CREATE INDEX IX_Task_Queue ON dbo.Task (StatusCode, PriorityId, DueSortKey, CreatedAt) INCLUDE (MatterId, AssignedUserId, AssignedPodId);
CREATE INDEX IX_Task_AssignedUser ON dbo.Task (AssignedUserId, StatusCode) INCLUDE (PriorityId, DueSortKey);
CREATE INDEX IX_Task_Pod ON dbo.Task (AssignedPodId, StatusCode) INCLUDE (AssignedUserId, PriorityId);
CREATE INDEX IX_Task_Matter ON dbo.Task (MatterId, StatusCode);
CREATE INDEX IX_Task_Project ON dbo.Task (ProjectId) WHERE ProjectId IS NOT NULL;
CREATE INDEX IX_Task_Creator ON dbo.Task (CreatedByUserId, CreatedAt);
CREATE INDEX IX_Task_Type ON dbo.Task (TaskTypeId, StatusCode);
CREATE INDEX IX_Task_Priority ON dbo.Task (PriorityId);
CREATE INDEX IX_Task_Completed ON dbo.Task (CompletedAt) WHERE CompletedAt IS NOT NULL;
CREATE INDEX IX_Task_Title ON dbo.Task (Title);
CREATE INDEX IX_Task_Requestor ON dbo.Task (RequestorName);
GO

CREATE TRIGGER dbo.TR_Task_Immutable ON dbo.Task
AFTER UPDATE
AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (
    SELECT 1 FROM inserted i JOIN deleted d ON d.TaskId = i.TaskId
    WHERE i.MatterId <> d.MatterId
       OR i.TaskTypeId <> d.TaskTypeId
       OR i.WorkflowInstanceId <> d.WorkflowInstanceId
       OR i.TaskNumber <> d.TaskNumber
       OR ISNULL(i.FormVersionId, 0) <> ISNULL(d.FormVersionId, 0))
    THROW 51030, 'A task''s matter, task type, workflow and request form version cannot be changed after creation.', 1;
END;
GO

-- Tasks are retained for good: Cancel instead of delete.
CREATE TRIGGER dbo.TR_Task_NoDelete ON dbo.Task
INSTEAD OF DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51031, 'Tasks cannot be deleted; cancel the task instead.', 1;
END;
GO

CREATE TABLE dbo.TaskComment (
  TaskCommentId    BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_TaskComment PRIMARY KEY,
  TaskId           BIGINT         NOT NULL,
  AuthorUserId     INT            NOT NULL,
  Purpose          VARCHAR(12)    NOT NULL CONSTRAINT DF_TaskComment_Purpose DEFAULT 'NORMAL',
  BodyHtml         NVARCHAR(MAX)  NOT NULL,
  EditedAt         DATETIME2(3)   NULL,
  IsDeleted        BIT            NOT NULL CONSTRAINT DF_TaskComment_IsDeleted DEFAULT 0,
  DeletedAt        DATETIME2(3)   NULL,
  DeletedByUserId  INT            NULL,
  CreatedAt        DATETIME2      NOT NULL CONSTRAINT DF_TaskComment_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT            NULL,
  ModifiedAt       DATETIME2      NULL,
  ModifiedByUserId INT            NULL,
  RowVersion       ROWVERSION     NOT NULL,
  CONSTRAINT FK_TaskComment_Task FOREIGN KEY (TaskId) REFERENCES dbo.Task (TaskId),
  CONSTRAINT FK_TaskComment_Author FOREIGN KEY (AuthorUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_TaskComment_DeletedBy FOREIGN KEY (DeletedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_TaskComment_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_TaskComment_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT CK_TaskComment_Purpose CHECK (Purpose IN ('NORMAL', 'CANCEL', 'ON_HOLD')),
  CONSTRAINT CK_TaskComment_Body CHECK (LEN(LTRIM(RTRIM(BodyHtml))) > 0),
  -- The reason given for Cancel / On Hold is part of the audit trail and cannot be soft-deleted (addendum O, FND-11).
  CONSTRAINT CK_TaskComment_ReasonNotDeletable CHECK (Purpose = 'NORMAL' OR IsDeleted = 0),
  CONSTRAINT CK_TaskComment_Deleted CHECK ((IsDeleted = 0 AND DeletedAt IS NULL) OR (IsDeleted = 1 AND DeletedAt IS NOT NULL))
);
GO

CREATE INDEX IX_TaskComment_Task ON dbo.TaskComment (TaskId, CreatedAt) WHERE IsDeleted = 0;
CREATE INDEX IX_TaskComment_Author ON dbo.TaskComment (AuthorUserId);
GO

-- A comment never moves to another Task or changes its purpose, and no comment is ever physically deleted (soft delete only).
CREATE TRIGGER dbo.TR_TaskComment_Guard ON dbo.TaskComment
AFTER UPDATE
AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (
    SELECT 1 FROM inserted i JOIN deleted d ON d.TaskCommentId = i.TaskCommentId
    WHERE i.TaskId <> d.TaskId OR i.Purpose <> d.Purpose OR i.AuthorUserId <> d.AuthorUserId)
    THROW 51032, 'A task comment cannot change its task, author or purpose.', 1;
END;
GO

CREATE TRIGGER dbo.TR_TaskComment_NoDelete ON dbo.TaskComment
INSTEAD OF DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51033, 'Task comments cannot be deleted; they are soft-deleted and retained.', 1;
END;
GO
