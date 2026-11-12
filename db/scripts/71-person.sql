-- 71-person.sql
-- Purpose: People (epic #1373, issue #1374). One shared list of people, used by the matter Team and (later) by vendor contacts.
--   A person is Internal or External. Every system user has a linked person (UserId, unique): name and email follow the user,
--   created by the application with the user (script 72 adds the persons of the users that already exist). Internal people without a
--   login and external people are added by hand (UserId NULL). People are deactivated, never deleted.
-- Owner: Identity (the person of a user is kept in step with the user in the same transaction).
-- Notes:
--   * PersonType is INTERNAL or EXTERNAL (stable codes). A company name only makes sense for an external person, and a person linked to a user is always internal; both are checked.
--   * LastName may be empty (a user whose display name is a single word); FirstName never is.
--   * The new table is classified in db/report-access.json (allow) and granted to lpt_report_reader below, like dbo.AppUser.
--   * Rows are audited by the generic interceptor (object type Person).

CREATE TABLE dbo.Person (
  PersonId         INT IDENTITY(1,1) NOT NULL,
  FirstName        NVARCHAR(200) NOT NULL,
  LastName         NVARCHAR(200) NOT NULL CONSTRAINT DF_Person_LastName DEFAULT N'',
  PersonType       VARCHAR(10) NOT NULL,
  Title            NVARCHAR(100) NULL,
  Email            NVARCHAR(320) NULL,
  Comments         NVARCHAR(2000) NULL,
  CompanyName      NVARCHAR(200) NULL,
  UserId           INT NULL,
  IsActive         BIT NOT NULL CONSTRAINT DF_Person_IsActive DEFAULT 1,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_Person_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_Person PRIMARY KEY (PersonId),
  CONSTRAINT CK_Person_FirstName CHECK (LEN(LTRIM(RTRIM(FirstName))) > 0),
  CONSTRAINT CK_Person_Type CHECK (PersonType IN ('INTERNAL', 'EXTERNAL')),
  CONSTRAINT CK_Person_Company CHECK (CompanyName IS NULL OR PersonType = 'EXTERNAL'),
  CONSTRAINT CK_Person_User CHECK (UserId IS NULL OR PersonType = 'INTERNAL'),
  CONSTRAINT FK_Person_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Person_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Person_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

-- At most one person per user.
CREATE UNIQUE INDEX UQ_Person_User ON dbo.Person (UserId) WHERE UserId IS NOT NULL;
GO

CREATE INDEX IX_Person_Name ON dbo.Person (LastName, FirstName);
GO

CREATE INDEX IX_Person_Email ON dbo.Person (Email) WHERE Email IS NOT NULL;
GO

GRANT SELECT, INSERT, UPDATE ON dbo.Person TO lpt_app;
DENY DELETE, ALTER ON dbo.Person TO lpt_app;
GRANT SELECT ON dbo.Person TO lpt_report_reader;
GO
