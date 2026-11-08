-- 42-asset-report.sql
-- Purpose: PM v2 (epic #851, issue #872). Personal saved asset reports of the built-in report builder (docs/ux/pm-v2-review section 9.7,
--   decisions addendum section AN). It is NOT the postponed SQL Reports epic #671: a saved report is only a small versioned definition
--   (asset type, measure, number field, group-by, filters) that is re-run with the viewer's current visibility each time.
-- Owner: Assets.
-- Notes:
--   * OwnerUserId owns the report; the name is unique per owner. Nobody else can read it (the API answers 404 for another person's id).
--   * DefinitionJson carries a version ("v":1); the application caps it at 4096 bytes and 50 reports per person.
--   * Personal definitions are not report data: the role mf_report_reader is denied (db/report-access.json, access = deny).

CREATE TABLE dbo.AssetReport (
  AssetReportId    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AssetReport PRIMARY KEY,
  OwnerUserId      INT            NOT NULL,
  Name             NVARCHAR(100)  NOT NULL,
  DefinitionJson   NVARCHAR(4000) NOT NULL,
  CreatedAt        DATETIME2      NOT NULL CONSTRAINT DF_AssetReport_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT            NULL,
  ModifiedAt       DATETIME2      NULL,
  ModifiedByUserId INT            NULL,
  RowVersion       ROWVERSION     NOT NULL,
  CONSTRAINT UQ_AssetReport_OwnerName UNIQUE (OwnerUserId, Name),
  CONSTRAINT CK_AssetReport_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT CK_AssetReport_Definition CHECK (ISJSON(DefinitionJson) = 1),
  CONSTRAINT FK_AssetReport_Owner FOREIGN KEY (OwnerUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_AssetReport_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_AssetReport_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

DENY SELECT, VIEW DEFINITION ON dbo.AssetReport TO mf_report_reader;
GO
