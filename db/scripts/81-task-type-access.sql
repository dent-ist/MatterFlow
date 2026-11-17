-- 81-task-type-access.sql
-- Purpose: Task Type access by role, data model (epic #1397, issue #1399; design docs/ux/task-type-access/README.md, decisions-addendum.md section AW).
--   Each Task Type has three role lists: Can View, Can Edit, Can Be Assigned. One row per (Task Type, role) with three flags.
-- Owner: Configuration (module LptHub.Configuration).
-- Notes:
--   * dbo.TaskTypeRoleAccess: PK (TaskTypeId, RoleId). CK_TaskTypeRoleAccess_Implies makes Edit and Assign imply View (the database refuses "Edit without View");
--     CK_TaskTypeRoleAccess_NotEmpty refuses a row with no flag at all (a role that is in no list has no row).
--   * No role in Can View = open to everyone. dbo.TaskType.IsRestricted is true exactly when at least one row of the type has CanView = 1. It is a plain column maintained in the same
--     transaction as the access rows by the one service that writes them (TaskTypeAccessService). A type with the flag and no View row, or the reverse, is a defect;
--     tools/db/task-type-access-consistency.sql finds it.
--   * The foreign key to dbo.Role also means a role that is named in a list cannot be deleted by accident; the application refuses the delete first with a message naming the Task Types.
--   * dbo.TaskTypeRoleAccess is classified DENY in db/report-access.json (access configuration is not report data; reports stay as they are, design section 14).
--   * Not deployed, so no backfill: every existing Task Type starts unrestricted (IsRestricted = 0, no rows), i.e. behaviour exactly as today.
--   * The SQL twin dbo.fnTaskVisible is NOT changed here; the read-path filtering (and the Features:TaskTypeAccess switch's effect) belongs to issue #1400.

ALTER TABLE dbo.TaskType ADD IsRestricted BIT NOT NULL CONSTRAINT DF_TaskType_IsRestricted DEFAULT 0;
GO

CREATE TABLE dbo.TaskTypeRoleAccess (
  TaskTypeId      INT NOT NULL,
  RoleId          INT NOT NULL,
  CanView         BIT NOT NULL CONSTRAINT DF_TaskTypeRoleAccess_CanView DEFAULT 0,
  CanEdit         BIT NOT NULL CONSTRAINT DF_TaskTypeRoleAccess_CanEdit DEFAULT 0,
  CanAssign       BIT NOT NULL CONSTRAINT DF_TaskTypeRoleAccess_CanAssign DEFAULT 0,
  CreatedAt       DATETIME2 NOT NULL CONSTRAINT DF_TaskTypeRoleAccess_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId INT NULL,
  CONSTRAINT PK_TaskTypeRoleAccess PRIMARY KEY (TaskTypeId, RoleId),
  CONSTRAINT FK_TaskTypeRoleAccess_TaskType FOREIGN KEY (TaskTypeId) REFERENCES dbo.TaskType (TaskTypeId),
  CONSTRAINT FK_TaskTypeRoleAccess_Role FOREIGN KEY (RoleId) REFERENCES dbo.Role (RoleId),
  CONSTRAINT FK_TaskTypeRoleAccess_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT CK_TaskTypeRoleAccess_Implies CHECK (CanView = 1 OR (CanEdit = 0 AND CanAssign = 0)),
  CONSTRAINT CK_TaskTypeRoleAccess_NotEmpty CHECK (CanView = 1 OR CanEdit = 1 OR CanAssign = 1)
);
GO

-- The viewer lookup is "the rows of my roles".
CREATE INDEX IX_TaskTypeRoleAccess_Role ON dbo.TaskTypeRoleAccess (RoleId) INCLUDE (TaskTypeId, CanView, CanEdit, CanAssign);
GO

-- The lists are replaced as a set, so the application needs DELETE as well.
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.TaskTypeRoleAccess TO lpt_app;
DENY ALTER ON dbo.TaskTypeRoleAccess TO lpt_app;
DENY SELECT, VIEW DEFINITION ON dbo.TaskTypeRoleAccess TO lpt_report_reader;
GO
