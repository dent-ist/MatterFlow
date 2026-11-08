-- 41-user-views.sql
-- Purpose: PM v2 (epic #851, issue #856). dbo.UserView stores, per person, the state of a screen section (filters, sort, Focus, scope) so it
--   follows the person between workstations. A row with Name NULL is the REMEMBERED state of a surface (one per person and surface, written
--   automatically); a row with a Name is a NAMED saved view (created by the person, optionally the default of the surface).
-- Owner: Identity (personal preferences of the signed-in person).
-- Notes:
--   * Surface is a short stable id of the screen section (for example 'my-matters.attention'); the application validates it against an allow-list.
--   * StateJson is opaque to the database (ISJSON guard, at most 4 KB, enforced by the application and by a CHECK on the length).
--   * Uniqueness: UQ_UserView_Name (SQL Server counts NULL names as equal) gives one remembered row per (UserId, Surface) and unique names per surface.
--   * At most one default named view per (UserId, Surface) (filtered unique index). The 30 named views per person limit is an application rule.
--   * Personal data of the person, not business data: denied for the report login mf_report_reader (db/report-access.json). Rows are derived
--     preferences and are not audited.
--   * Grants: mf_app reads, inserts, updates and deletes (a person deletes their own named views).

CREATE TABLE dbo.UserView (
  UserViewId       BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_UserView PRIMARY KEY,
  UserId           INT           NOT NULL,
  Surface          VARCHAR(40)   NOT NULL,
  Name             NVARCHAR(80)  NULL,
  IsDefault        BIT           NOT NULL CONSTRAINT DF_UserView_IsDefault DEFAULT 0,
  StateJson        NVARCHAR(4000) NOT NULL,
  CreatedAt        DATETIME2(3)  NOT NULL CONSTRAINT DF_UserView_CreatedAt DEFAULT SYSUTCDATETIME(),
  ModifiedAt       DATETIME2(3)  NOT NULL CONSTRAINT DF_UserView_ModifiedAt DEFAULT SYSUTCDATETIME(),
  RowVersion       ROWVERSION    NOT NULL,
  CONSTRAINT FK_UserView_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT UQ_UserView_Name UNIQUE (UserId, Surface, Name),
  CONSTRAINT CK_UserView_Surface CHECK (LEN(Surface) > 0 AND Surface NOT LIKE '%[^a-z0-9._-]%'),
  CONSTRAINT CK_UserView_Name CHECK (Name IS NULL OR LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT CK_UserView_State CHECK (ISJSON(StateJson) = 1),
  CONSTRAINT CK_UserView_RememberedNotDefault CHECK (Name IS NOT NULL OR IsDefault = 0)
);
GO

-- UQ_UserView_Name treats NULL names as equal, so it already allows one remembered row (Name NULL) per (UserId, Surface).
CREATE UNIQUE INDEX UX_UserView_Default ON dbo.UserView (UserId, Surface) WHERE IsDefault = 1;
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.UserView TO mf_app;
DENY ALTER ON dbo.UserView TO mf_app;
GO

DENY SELECT, VIEW DEFINITION ON dbo.UserView TO mf_report_reader;
GO
