-- 68-matter-category.sql
-- Purpose: Matter Category (epic #1368, issue #1369). A new admin-managed pick list (dbo.MatterCategory, same shape as dbo.MatterType, dbo.CurrentState and dbo.TeamTitle)
--   and an optional single choice on the matter (dbo.Matter.MatterCategoryId). NULL = no category; existing matters stay blank.
-- Owner: Organization (matters) for the column; Configuration (admin lists) for the list.
-- Notes:
--   * No starter rows: the list is the firm's own vocabulary and is filled on the Admin Lists page.
--   * A category that matters use is deactivated, never deleted (the foreign key is the backstop; the application refuses the delete with IN_USE).
--   * Changes to the list rows are audited by the generic interceptor (object type MatterCategory); a matter's category change by the MATTER_CATEGORY_CHANGED event.
--   * The new table is classified in db/report-access.json (allow) and granted to lpt_app and lpt_report_reader below, like dbo.MatterType.

CREATE TABLE dbo.MatterCategory (
  MatterCategoryId INT IDENTITY(1,1) NOT NULL,
  Name             NVARCHAR(100) NOT NULL,
  SortOrder        INT NOT NULL,
  IsActive         BIT NOT NULL CONSTRAINT DF_MatterCategory_IsActive DEFAULT 1,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_MatterCategory_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_MatterCategory PRIMARY KEY (MatterCategoryId),
  CONSTRAINT UQ_MatterCategory_Name UNIQUE (Name),
  CONSTRAINT CK_MatterCategory_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT FK_MatterCategory_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_MatterCategory_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_MatterCategory_Sort ON dbo.MatterCategory (SortOrder);
GO

ALTER TABLE dbo.Matter ADD MatterCategoryId INT NULL;
GO

ALTER TABLE dbo.Matter ADD CONSTRAINT FK_Matter_MatterCategory FOREIGN KEY (MatterCategoryId) REFERENCES dbo.MatterCategory (MatterCategoryId);
GO

CREATE INDEX IX_Matter_MatterCategory ON dbo.Matter (MatterCategoryId);
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.MatterCategory TO lpt_app;
DENY ALTER ON dbo.MatterCategory TO lpt_app;
GRANT SELECT ON dbo.MatterCategory TO lpt_report_reader;
GO
