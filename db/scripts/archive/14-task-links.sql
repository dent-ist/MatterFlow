-- 14-task-links.sql
-- Purpose: Task-Asset links with relationship roles (dbo.TaskAsset, ticket 45) and the edit history of Task comments
--   (dbo.TaskCommentRevision, ticket 43).
-- Owner: WorkManagement.
-- Notes:
--   * TaskAsset has TWO composite foreign keys, (TaskId, MatterId) -> Task and (AssetId, MatterId) -> Asset, so a link whose Task and
--     Asset belong to different Matters cannot exist (erd invariant I-4); the API reports it as CROSS_MATTER_REFERENCE first.
--   * Unlinking removes the row (the audit trail keeps TASK_ASSET_UNLINKED with the old role).
--   * TaskCommentRevision is append-only: each edit stores the body as it was before the edit; a delete stores the final body.

CREATE TABLE dbo.TaskAsset (
  TaskId           BIGINT     NOT NULL,
  AssetId          INT        NOT NULL,
  MatterId         INT        NOT NULL,
  AssetLinkRoleId  INT        NULL,
  CreatedAt        DATETIME2  NOT NULL CONSTRAINT DF_TaskAsset_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT        NULL,
  ModifiedAt       DATETIME2  NULL,
  ModifiedByUserId INT        NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_TaskAsset PRIMARY KEY (TaskId, AssetId),
  CONSTRAINT FK_TaskAsset_Task FOREIGN KEY (TaskId, MatterId) REFERENCES dbo.Task (TaskId, MatterId),
  CONSTRAINT FK_TaskAsset_Asset FOREIGN KEY (AssetId, MatterId) REFERENCES dbo.Asset (AssetId, MatterId),
  CONSTRAINT FK_TaskAsset_Role FOREIGN KEY (AssetLinkRoleId) REFERENCES dbo.AssetLinkRole (AssetLinkRoleId),
  CONSTRAINT FK_TaskAsset_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_TaskAsset_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

-- "Tasks using this asset" and "links using this role".
CREATE INDEX IX_TaskAsset_Asset ON dbo.TaskAsset (AssetId);
CREATE INDEX IX_TaskAsset_Role ON dbo.TaskAsset (AssetLinkRoleId) WHERE AssetLinkRoleId IS NOT NULL;
GO

CREATE TABLE dbo.TaskCommentRevision (
  TaskCommentRevisionId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_TaskCommentRevision PRIMARY KEY,
  TaskCommentId         BIGINT        NOT NULL,
  BodyHtml              NVARCHAR(MAX) NOT NULL,
  Reason                VARCHAR(10)   NOT NULL,
  RevisedAt             DATETIME2(3)  NOT NULL CONSTRAINT DF_TaskCommentRevision_RevisedAt DEFAULT SYSUTCDATETIME(),
  RevisedByUserId       INT           NULL,
  CONSTRAINT FK_TaskCommentRevision_Comment FOREIGN KEY (TaskCommentId) REFERENCES dbo.TaskComment (TaskCommentId),
  CONSTRAINT FK_TaskCommentRevision_RevisedBy FOREIGN KEY (RevisedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT CK_TaskCommentRevision_Reason CHECK (Reason IN ('EDIT', 'DELETE'))
);
GO

CREATE INDEX IX_TaskCommentRevision_Comment ON dbo.TaskCommentRevision (TaskCommentId, RevisedAt);
GO

CREATE TRIGGER dbo.TR_TaskCommentRevision_AppendOnly ON dbo.TaskCommentRevision
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51040, 'Comment revisions are append-only: UPDATE and DELETE are not allowed.', 1;
END;
GO
