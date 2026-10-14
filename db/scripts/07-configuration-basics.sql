-- 07-configuration-basics.sql
-- Purpose: configuration lookups (docs/erd.md "Priority", "TaskStatusLabel", "AssetLinkRole"; baseline 7.2, 7.4, 5.3;
--   addendum G, M, O): dbo.Priority, dbo.TaskStatusLabel (the five fixed lifecycle codes) and dbo.AssetLinkRole.
-- Owner: Configuration.
-- Not in this script: the default Priority and AssetLinkRole rows (seeded idempotently by the app at startup, so admin edits are
--   never overwritten), and the foreign keys from Task / TaskAsset (created with those tables).
-- TaskStatusLabel is the exception: its five rows are structural (Task.StatusCode references them) so they are seeded here, and a
--   trigger then freezes the code set: no insert, no delete, no code change. Only DisplayLabel (and SortOrder) may change.

CREATE TABLE dbo.Priority (
  PriorityId       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Priority PRIMARY KEY,
  Label            NVARCHAR(50)  NOT NULL,
  SortOrder        INT           NOT NULL,   -- lower = more urgent
  Color            VARCHAR(20)   NOT NULL CONSTRAINT DF_Priority_Color DEFAULT 'neutral', -- badge token (critical/high/normal/low/neutral) or #RRGGBB
  IsActive         BIT           NOT NULL CONSTRAINT DF_Priority_IsActive DEFAULT 1,
  IsDefault        BIT           NOT NULL CONSTRAINT DF_Priority_IsDefault DEFAULT 0,
  CreatedAt        DATETIME2     NOT NULL CONSTRAINT DF_Priority_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT           NULL,
  ModifiedAt       DATETIME2     NULL,
  ModifiedByUserId INT           NULL,
  RowVersion       ROWVERSION    NOT NULL,
  CONSTRAINT FK_Priority_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Priority_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT UQ_Priority_Label UNIQUE (Label),
  CONSTRAINT CK_Priority_Label CHECK (LEN(LTRIM(RTRIM(Label))) > 0),
  CONSTRAINT CK_Priority_DefaultActive CHECK (IsDefault = 0 OR IsActive = 1)
);
GO

-- At most one default priority (the application also guarantees at least one).
CREATE UNIQUE INDEX UQ_Priority_Default ON dbo.Priority (IsDefault) WHERE IsDefault = 1;
GO

CREATE INDEX IX_Priority_Sort ON dbo.Priority (SortOrder);
GO

CREATE TABLE dbo.TaskStatusLabel (
  StatusCode       VARCHAR(20)   NOT NULL CONSTRAINT PK_TaskStatusLabel PRIMARY KEY,
  DisplayLabel     NVARCHAR(50)  NOT NULL,
  SortOrder        INT           NOT NULL,
  CreatedAt        DATETIME2     NOT NULL CONSTRAINT DF_TaskStatusLabel_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT           NULL,
  ModifiedAt       DATETIME2     NULL,
  ModifiedByUserId INT           NULL,
  RowVersion       ROWVERSION    NOT NULL,
  CONSTRAINT FK_TaskStatusLabel_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_TaskStatusLabel_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT UQ_TaskStatusLabel_Label UNIQUE (DisplayLabel),
  CONSTRAINT CK_TaskStatusLabel_Code CHECK (StatusCode IN ('NEW', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT CK_TaskStatusLabel_Label CHECK (LEN(LTRIM(RTRIM(DisplayLabel))) > 0)
);
GO

INSERT INTO dbo.TaskStatusLabel (StatusCode, DisplayLabel, SortOrder) VALUES
  ('NEW',         N'New',         1),
  ('IN_PROGRESS', N'In Progress', 2),
  ('ON_HOLD',     N'On Hold',     3),
  ('COMPLETED',   N'Completed',   4),
  ('CANCELLED',   N'Cancelled',   5);
GO

-- The status code set is fixed (addendum O): rows cannot be added, removed, or re-coded, by anyone.
CREATE TRIGGER dbo.TR_TaskStatusLabel_FixedCodes ON dbo.TaskStatusLabel
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        RETURN;
    IF NOT EXISTS (SELECT 1 FROM deleted)
        THROW 51001, 'TaskStatusLabel codes are fixed: rows cannot be inserted.', 1;
    IF NOT EXISTS (SELECT 1 FROM inserted)
        THROW 51002, 'TaskStatusLabel codes are fixed: rows cannot be deleted.', 1;
    IF UPDATE(StatusCode)
        THROW 51003, 'TaskStatusLabel codes are immutable.', 1;
END;
GO

CREATE TABLE dbo.AssetLinkRole (
  AssetLinkRoleId  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AssetLinkRole PRIMARY KEY,
  Name             NVARCHAR(50)  NOT NULL,
  SortOrder        INT           NOT NULL,
  IsActive         BIT           NOT NULL CONSTRAINT DF_AssetLinkRole_IsActive DEFAULT 1,
  CreatedAt        DATETIME2     NOT NULL CONSTRAINT DF_AssetLinkRole_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT           NULL,
  ModifiedAt       DATETIME2     NULL,
  ModifiedByUserId INT           NULL,
  RowVersion       ROWVERSION    NOT NULL,
  CONSTRAINT FK_AssetLinkRole_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_AssetLinkRole_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT UQ_AssetLinkRole_Name UNIQUE (Name),
  CONSTRAINT CK_AssetLinkRole_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0)
);
GO

CREATE INDEX IX_AssetLinkRole_Sort ON dbo.AssetLinkRole (SortOrder);
GO
