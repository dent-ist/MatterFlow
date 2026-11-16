-- 79-person-profile-fields.sql
-- Purpose: Users #1394 (epic #1389). More fields on the person record of an INTERNAL person (the user record on Administration > Users shows them):
--   Office (the person's branch office) and Employment Status (two new admin-managed lists, dbo.Office and dbo.EmploymentStatus, same shape as dbo.MatterCategory) and the Industry Join Date
--   (month and year only: a date stored as the first day of the month). Title, Email and Notes already exist on dbo.Person (Title, Email, Comments), so nothing is added for them.
-- Owner: Identity (people, users).
-- Notes:
--   * Employment Status is the HR status of the person (Active, On Leave, Departed). It is NOT the account state of the user (active, deactivated, pending access), which stays on dbo.AppUser.
--   * Seeded here: the three statuses only. The Office list starts EMPTY (owner decision): the firm adds its own branch offices on Administration > Lists > Offices, and a person's
--     office stays empty until someone sets it. An administrator renames, reorders, deactivates or deletes the statuses on Administration > Lists.
--   * A used item is deactivated, never deleted (the foreign keys are the backstop; the application refuses the delete with IN_USE).
--   * The three person columns are for INTERNAL people only (CK_Person_ProfileInternal) and are NULL for every existing person: no backfill.
--   * The new tables are classified in db/report-access.json (allow) and granted like dbo.MatterCategory.

CREATE TABLE dbo.Office (
  OfficeId         INT IDENTITY(1,1) NOT NULL,
  Name             NVARCHAR(100) NOT NULL,
  SortOrder        INT NOT NULL,
  IsActive         BIT NOT NULL CONSTRAINT DF_Office_IsActive DEFAULT 1,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_Office_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_Office PRIMARY KEY (OfficeId),
  CONSTRAINT UQ_Office_Name UNIQUE (Name),
  CONSTRAINT CK_Office_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT FK_Office_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Office_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_Office_Sort ON dbo.Office (SortOrder);
GO

CREATE TABLE dbo.EmploymentStatus (
  EmploymentStatusId INT IDENTITY(1,1) NOT NULL,
  Name               NVARCHAR(100) NOT NULL,
  SortOrder          INT NOT NULL,
  IsActive           BIT NOT NULL CONSTRAINT DF_EmploymentStatus_IsActive DEFAULT 1,
  CreatedAt          DATETIME2 NOT NULL CONSTRAINT DF_EmploymentStatus_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId    INT NULL,
  ModifiedAt         DATETIME2 NULL,
  ModifiedByUserId   INT NULL,
  RowVersion         ROWVERSION NOT NULL,
  CONSTRAINT PK_EmploymentStatus PRIMARY KEY (EmploymentStatusId),
  CONSTRAINT UQ_EmploymentStatus_Name UNIQUE (Name),
  CONSTRAINT CK_EmploymentStatus_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT FK_EmploymentStatus_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_EmploymentStatus_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_EmploymentStatus_Sort ON dbo.EmploymentStatus (SortOrder);
GO

INSERT dbo.EmploymentStatus (Name, SortOrder, IsActive)
VALUES (N'Active', 1, 1), (N'On Leave', 2, 1), (N'Departed', 3, 1);
GO

ALTER TABLE dbo.Person ADD OfficeId INT NULL, EmploymentStatusId INT NULL, IndustryJoinDate DATE NULL;
GO

ALTER TABLE dbo.Person ADD CONSTRAINT FK_Person_Office FOREIGN KEY (OfficeId) REFERENCES dbo.Office (OfficeId);
ALTER TABLE dbo.Person ADD CONSTRAINT FK_Person_EmploymentStatus FOREIGN KEY (EmploymentStatusId) REFERENCES dbo.EmploymentStatus (EmploymentStatusId);
-- Month and year only: always the first day of a month, from 1950 on.
ALTER TABLE dbo.Person ADD CONSTRAINT CK_Person_IndustryJoinDate CHECK (IndustryJoinDate IS NULL OR (DAY(IndustryJoinDate) = 1 AND IndustryJoinDate >= '1950-01-01'));
-- Internal people only.
ALTER TABLE dbo.Person ADD CONSTRAINT CK_Person_ProfileInternal CHECK (PersonType = 'INTERNAL' OR (OfficeId IS NULL AND EmploymentStatusId IS NULL AND IndustryJoinDate IS NULL));
GO

CREATE INDEX IX_Person_Office ON dbo.Person (OfficeId) WHERE OfficeId IS NOT NULL;
CREATE INDEX IX_Person_EmploymentStatus ON dbo.Person (EmploymentStatusId) WHERE EmploymentStatusId IS NOT NULL;
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Office TO lpt_app;
DENY ALTER ON dbo.Office TO lpt_app;
GRANT SELECT ON dbo.Office TO lpt_report_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.EmploymentStatus TO lpt_app;
DENY ALTER ON dbo.EmploymentStatus TO lpt_app;
GRANT SELECT ON dbo.EmploymentStatus TO lpt_report_reader;
GO
