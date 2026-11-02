-- 52-production-specs.sql
-- Purpose: Matter detail redesign (epic #1001, issue MD-09 #1010). Adds dbo.ProductionSpec (the agreed format of a production: images, text, natives, load file,
--   metadata fields, redaction, privilege, de-duplication, dates, numbering) and the permissions ProductionSpec.View and ProductionSpec.Edit.
--   Served by /api/v1/production-specs (list by matter, get, create, update, duplicate, retire, unretire, history).
-- Owner: Productions (new module MatterFlow.Productions). Decision: docs/requirements/decisions-addendum.md section AQ item 8.
-- Notes:
--   * A spec belongs to one matter (MatterId, fixed at create). It is never deleted: StatusCode Retired keeps it on the productions that already use it,
--     but a retired spec cannot be chosen for a new or changed production. Names are unique per matter among ACTIVE specs only, so a retired name can be reused.
--   * The metadata field list is a JSON array of field names in MetadataFieldsJson (ISJSON checked); no child table.
--   * Every other rule is short free text on purpose: the specs are agreements between lawyers, not a closed vocabulary.
--   * Nothing is backfilled (nobody uses the application yet). RowVersion is the optimistic-concurrency token.
--   * Grants: mf_app reads, inserts and updates (no delete). The report login is denied (db/report-access.json): specs are matter work product
--     and a report must not read them around the sensitive-matter rule.
--   * The permission rows are inserted here as well as by the catalog sync (same text as contracts/permissions.json) because the grants below need them;
--     existing roles named Director, Project Manager and Pod Lead get ProductionSpec.Edit, and the roles that can edit tasks get ProductionSpec.View.
--     Same pattern as 46-asset-dispose-permission.sql. Roles renamed or created by hand are not touched.

CREATE TABLE dbo.ProductionSpec (
  ProductionSpecId   INT            NOT NULL IDENTITY(1,1) CONSTRAINT PK_ProductionSpec PRIMARY KEY,
  MatterId           INT            NOT NULL,
  Name               NVARCHAR(200)  NOT NULL,
  StatusCode         VARCHAR(10)    NOT NULL CONSTRAINT DF_ProductionSpec_Status DEFAULT 'Active',
  SourceOfAgreement  NVARCHAR(300)  NULL,
  Description        NVARCHAR(1000) NULL,
  ImageFormat        NVARCHAR(100)  NULL,
  ColourMode         NVARCHAR(100)  NULL,
  TextMode           NVARCHAR(100)  NULL,
  NativesRule        NVARCHAR(300)  NULL,
  LoadFile           NVARCHAR(100)  NULL,
  MetadataFieldsJson NVARCHAR(4000) NULL,
  RedactionRule      NVARCHAR(300)  NULL,
  PrivilegeRule      NVARCHAR(300)  NULL,
  DedupRule          NVARCHAR(200)  NULL,
  DateTimeRule       NVARCHAR(200)  NULL,
  NumberingRule      NVARCHAR(200)  NULL,
  DeliveryRule       NVARCHAR(300)  NULL,
  Notes              NVARCHAR(2000) NULL,
  CreatedAt          DATETIME2      NOT NULL CONSTRAINT DF_ProductionSpec_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId    INT            NULL,
  ModifiedAt         DATETIME2      NULL,
  ModifiedByUserId   INT            NULL,
  RowVersion         ROWVERSION     NOT NULL,
  CONSTRAINT FK_ProductionSpec_Matter FOREIGN KEY (MatterId) REFERENCES dbo.Matter (MatterId),
  CONSTRAINT FK_ProductionSpec_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_ProductionSpec_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT UQ_ProductionSpec_IdMatter UNIQUE (ProductionSpecId, MatterId),
  CONSTRAINT CK_ProductionSpec_Status CHECK (StatusCode IN ('Active', 'Retired')),
  CONSTRAINT CK_ProductionSpec_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT CK_ProductionSpec_Fields CHECK (MetadataFieldsJson IS NULL OR ISJSON(MetadataFieldsJson) = 1)
);
GO

-- A name is unique per matter among the active specs; the matter's list reads by matter.
CREATE UNIQUE INDEX UQ_ProductionSpec_ActiveName ON dbo.ProductionSpec (MatterId, Name) WHERE StatusCode = 'Active';
CREATE INDEX IX_ProductionSpec_Matter ON dbo.ProductionSpec (MatterId, StatusCode);
GO

CREATE TRIGGER dbo.TR_ProductionSpec_Guard ON dbo.ProductionSpec AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF UPDATE(MatterId) AND EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.ProductionSpecId = i.ProductionSpecId WHERE i.MatterId <> d.MatterId)
  BEGIN
    THROW 50000, 'A production spec belongs to one matter and cannot move to another.', 1;
  END
END;
GO

GRANT SELECT, INSERT, UPDATE ON dbo.ProductionSpec TO mf_app;
DENY DELETE, ALTER ON dbo.ProductionSpec TO mf_app;
GO

DENY SELECT, VIEW DEFINITION ON dbo.ProductionSpec TO mf_report_reader;
GO

INSERT dbo.Permission (Code, GroupName, Description, IsActive)
SELECT v.Code, 'Productions', v.Description, 1
FROM (VALUES
  ('ProductionSpec.View', N'View production specs'),
  ('ProductionSpec.Edit', N'Create, edit, duplicate and retire production specs')
) AS v (Code, Description)
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permission p WHERE p.Code = v.Code);
GO

INSERT dbo.RolePermission (RoleId, PermissionId)
SELECT r.RoleId, p.PermissionId
FROM dbo.Role r
JOIN dbo.Permission p ON p.Code = 'ProductionSpec.View'
WHERE r.Name IN (N'Director', N'Project Manager', N'Pod Lead', N'Data Technician', N'Data Scientist') AND r.IsSystemAdmin = 0
  AND NOT EXISTS (SELECT 1 FROM dbo.RolePermission x WHERE x.RoleId = r.RoleId AND x.PermissionId = p.PermissionId);

INSERT dbo.RolePermission (RoleId, PermissionId)
SELECT r.RoleId, p.PermissionId
FROM dbo.Role r
JOIN dbo.Permission p ON p.Code = 'ProductionSpec.Edit'
WHERE r.Name IN (N'Director', N'Project Manager', N'Pod Lead') AND r.IsSystemAdmin = 0
  AND NOT EXISTS (SELECT 1 FROM dbo.RolePermission x WHERE x.RoleId = r.RoleId AND x.PermissionId = p.PermissionId);
GO
