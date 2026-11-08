-- 64-matter-fields.sql
-- Purpose: Matter fields epic #1298, issue #1300. Adds three admin-managed pick lists (Matter Type, Current State, Team Title), four optional columns on
--   dbo.Matter (MatterTypeId, CurrentStateId, DmsPath, DfsPath) and the matter's Team (dbo.MatterTeamMember).
-- Owner: Configuration (the three lists) and Organization (the Matter columns and the Team table).
-- Notes:
--   * Numbers 61 to 63 are taken or reserved by other branches; this is the next free number above 63. Gaps are fine for the runner.
--   * A list item that matters or team rows use is deactivated (IsActive = 0), not deleted, so they and the audit log keep its name; the application
--     deletes only an item nobody uses (In Use 0; the foreign keys are the backstop). Names are unique per list. The default rows are NOT seeded here:
--     the application seeds them once at startup (ConfigurationSeeder), like dbo.OnHoldReason, so admin edits are never overwritten.
--   * MatterTypeId and CurrentStateId are optional (owner decision): existing matters stay blank. DmsPath / DfsPath are optional text; the format
--     (UNC path or http/https address, no drive letter) is checked by the application, the column only limits the length (1000 characters, UI spec section 3.3).
--   * Team members are typed-in contacts, not users: no link to dbo.AppUser, so the Team never affects My Matters, visibility or permissions.
--     The same e-mail cannot appear twice on one matter (case-insensitive: the column is CI). A person may be on other matters with another title.
--     The title is required; a title that is later deactivated stays on the rows that use it. Rows are really deleted when a member is removed
--     (the application writes MATTER_TEAM_MEMBER_REMOVED to the audit log).
--   * Nothing is backfilled (nobody uses the application yet).
--   * Grants: mf_app reads, inserts, updates and deletes. The report login may read the three lists (business data); the Team holds outside people's
--     contact details and is shown through the application's matter visibility rule only, so the report login is denied (db/report-access.json).

CREATE TABLE dbo.MatterType (
  MatterTypeId   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_MatterType PRIMARY KEY,
  Name             NVARCHAR(100) NOT NULL,
  SortOrder        INT           NOT NULL,
  IsActive         BIT           NOT NULL CONSTRAINT DF_MatterType_IsActive DEFAULT 1,
  CreatedAt        DATETIME2     NOT NULL CONSTRAINT DF_MatterType_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT           NULL,
  ModifiedAt       DATETIME2     NULL,
  ModifiedByUserId INT           NULL,
  RowVersion       ROWVERSION    NOT NULL,
  CONSTRAINT FK_MatterType_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_MatterType_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT UQ_MatterType_Name UNIQUE (Name),
  CONSTRAINT CK_MatterType_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0)
);
GO

CREATE INDEX IX_MatterType_Sort ON dbo.MatterType (SortOrder);
GO

CREATE TABLE dbo.CurrentState (
  CurrentStateId   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CurrentState PRIMARY KEY,
  Name             NVARCHAR(100) NOT NULL,
  SortOrder        INT           NOT NULL,
  IsActive         BIT           NOT NULL CONSTRAINT DF_CurrentState_IsActive DEFAULT 1,
  CreatedAt        DATETIME2     NOT NULL CONSTRAINT DF_CurrentState_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT           NULL,
  ModifiedAt       DATETIME2     NULL,
  ModifiedByUserId INT           NULL,
  RowVersion       ROWVERSION    NOT NULL,
  CONSTRAINT FK_CurrentState_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_CurrentState_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT UQ_CurrentState_Name UNIQUE (Name),
  CONSTRAINT CK_CurrentState_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0)
);
GO

CREATE INDEX IX_CurrentState_Sort ON dbo.CurrentState (SortOrder);
GO

CREATE TABLE dbo.TeamTitle (
  TeamTitleId   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_TeamTitle PRIMARY KEY,
  Name             NVARCHAR(100) NOT NULL,
  SortOrder        INT           NOT NULL,
  IsActive         BIT           NOT NULL CONSTRAINT DF_TeamTitle_IsActive DEFAULT 1,
  CreatedAt        DATETIME2     NOT NULL CONSTRAINT DF_TeamTitle_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT           NULL,
  ModifiedAt       DATETIME2     NULL,
  ModifiedByUserId INT           NULL,
  RowVersion       ROWVERSION    NOT NULL,
  CONSTRAINT FK_TeamTitle_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_TeamTitle_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT UQ_TeamTitle_Name UNIQUE (Name),
  CONSTRAINT CK_TeamTitle_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0)
);
GO

CREATE INDEX IX_TeamTitle_Sort ON dbo.TeamTitle (SortOrder);
GO

ALTER TABLE dbo.Matter ADD
  MatterTypeId  INT           NULL,
  CurrentStateId INT          NULL,
  DmsPath       NVARCHAR(1000) NULL,
  DfsPath       NVARCHAR(1000) NULL;
GO

ALTER TABLE dbo.Matter ADD CONSTRAINT FK_Matter_MatterType FOREIGN KEY (MatterTypeId) REFERENCES dbo.MatterType (MatterTypeId);
ALTER TABLE dbo.Matter ADD CONSTRAINT FK_Matter_CurrentState FOREIGN KEY (CurrentStateId) REFERENCES dbo.CurrentState (CurrentStateId);
GO

-- The Matters list filters by type and by state (a NULL is the "Not set" choice).
CREATE INDEX IX_Matter_MatterType ON dbo.Matter (MatterTypeId);
CREATE INDEX IX_Matter_CurrentState ON dbo.Matter (CurrentStateId);
GO

CREATE TABLE dbo.MatterTeamMember (
  MatterTeamMemberId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_MatterTeamMember PRIMARY KEY,
  MatterId           INT            NOT NULL,
  Name               NVARCHAR(200)  NOT NULL,
  Email              NVARCHAR(254) COLLATE Latin1_General_100_CI_AS NOT NULL,
  TeamTitleId        INT            NOT NULL,
  SortOrder          INT            NOT NULL,
  CreatedAt          DATETIME2      NOT NULL CONSTRAINT DF_MatterTeamMember_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId    INT            NULL,
  ModifiedAt         DATETIME2      NULL,
  ModifiedByUserId   INT            NULL,
  RowVersion         ROWVERSION     NOT NULL,
  CONSTRAINT FK_MatterTeamMember_Matter FOREIGN KEY (MatterId) REFERENCES dbo.Matter (MatterId),
  CONSTRAINT FK_MatterTeamMember_Title FOREIGN KEY (TeamTitleId) REFERENCES dbo.TeamTitle (TeamTitleId),
  CONSTRAINT FK_MatterTeamMember_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_MatterTeamMember_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT UQ_MatterTeamMember_MatterEmail UNIQUE (MatterId, Email),
  CONSTRAINT CK_MatterTeamMember_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT CK_MatterTeamMember_Email CHECK (LEN(LTRIM(RTRIM(Email))) > 0)
);
GO

CREATE INDEX IX_MatterTeamMember_Title ON dbo.MatterTeamMember (TeamTitleId);
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.MatterType TO mf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.CurrentState TO mf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.TeamTitle TO mf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.MatterTeamMember TO mf_app;
DENY ALTER ON dbo.MatterType TO mf_app;
DENY ALTER ON dbo.CurrentState TO mf_app;
DENY ALTER ON dbo.TeamTitle TO mf_app;
DENY ALTER ON dbo.MatterTeamMember TO mf_app;
GO

GRANT SELECT ON dbo.MatterType TO mf_report_reader;
GRANT SELECT ON dbo.CurrentState TO mf_report_reader;
GRANT SELECT ON dbo.TeamTitle TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.MatterTeamMember TO mf_report_reader;
GO
