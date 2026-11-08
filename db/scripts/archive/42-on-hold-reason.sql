-- 42-on-hold-reason.sql
-- Purpose: PM v2 (epic #851, issue #876). A structured reason for putting a task On Hold: dbo.OnHoldReason is an admin-managed list
--   (Waiting for client data, Waiting for approval, ...) and dbo.Task.OnHoldReasonId points at the reason of a task that is currently On Hold.
-- Owner: Configuration (lookup) and WorkManagement (the Task column).
-- Notes:
--   * Lookup rows are never deleted: a reason that was used is deactivated (IsActive = 0) so historical tasks and audit events keep their name.
--   * The default rows are NOT seeded here: the application seeds them idempotently at startup (like Priority), so admin edits are never overwritten.
--   * Task.OnHoldReasonId is NULL for tasks that are not on hold and for on-hold tasks without a reason (the reason is optional unless the
--     configuration switch Tasks:OnHoldReasonRequired is true). The application clears it when the task leaves On Hold.
--   * The free-text comment that is stored with the status change stays; the reason is the structure, the comment is the detail.
--   * Business data: SELECT is granted to mf_report_reader (db/report-access.json, access = allow), like dbo.Priority.

CREATE TABLE dbo.OnHoldReason (
  OnHoldReasonId   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_OnHoldReason PRIMARY KEY,
  Name             NVARCHAR(100) NOT NULL,
  SortOrder        INT           NOT NULL,
  IsActive         BIT           NOT NULL CONSTRAINT DF_OnHoldReason_IsActive DEFAULT 1,
  CreatedAt        DATETIME2     NOT NULL CONSTRAINT DF_OnHoldReason_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT           NULL,
  ModifiedAt       DATETIME2     NULL,
  ModifiedByUserId INT           NULL,
  RowVersion       ROWVERSION    NOT NULL,
  CONSTRAINT FK_OnHoldReason_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_OnHoldReason_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT UQ_OnHoldReason_Name UNIQUE (Name),
  CONSTRAINT CK_OnHoldReason_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0)
);
GO

CREATE INDEX IX_OnHoldReason_Sort ON dbo.OnHoldReason (SortOrder);
GO

ALTER TABLE dbo.Task ADD OnHoldReasonId INT NULL;
GO

ALTER TABLE dbo.Task ADD CONSTRAINT FK_Task_OnHoldReason FOREIGN KEY (OnHoldReasonId) REFERENCES dbo.OnHoldReason (OnHoldReasonId);
GO

-- Lists and filters by reason read the on-hold tasks only.
CREATE INDEX IX_Task_OnHoldReason ON dbo.Task (OnHoldReasonId, MatterId) WHERE OnHoldReasonId IS NOT NULL;
GO

GRANT SELECT ON dbo.OnHoldReason TO mf_report_reader;
GO
