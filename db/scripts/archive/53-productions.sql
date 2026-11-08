-- 53-productions.sql
-- Purpose: Matter detail redesign (epic #1001, issue MD-10 #1011). Adds dbo.Production (a simple managed list of the productions of a matter: name, volume,
--   direction produced by us or received, party, spec, Bates begin and end, documents, pages, delivered or due date, notes) and dbo.ProductionComment, and the
--   permissions Production.View, Production.Edit and Production.Comment. Served by /api/v1/productions.
-- Owner: Productions (new module MatterFlow.Productions). Decision: docs/requirements/decisions-addendum.md section AQ item 8.
-- Notes:
--   * By owner decision there is NO status workflow, NO QC checklist, NO delivery fields and NO Bates overlap check: Bates begin and end are free text
--     (for example ABC000001). Who changed what is the audit trail (object type Production), read by GET /api/v1/productions/{id}/history.
--   * Direction is OUT (produced by us) or IN (received). The spec is optional (a received production has none) and must belong to the SAME matter: the composite
--     foreign key (ProductionSpecId, MatterId) enforces it; a retired spec is refused for new or changed productions by the application, not here.
--   * A comment carries its production's MatterId (same composite key) so the sensitive-matter rule can be applied without a join. Comments are deleted with their production.
--   * Real DELETE for productions and comments (a managed list, not a record that must survive); every create, change and delete is audited by the application.
--   * Nothing is backfilled (nobody uses the application yet). RowVersion is the optimistic-concurrency token.
--   * Grants: mf_app reads, inserts, updates and deletes. The report login is denied (db/report-access.json).
--   * Permission rows and role grants for existing roles are inserted here for the same reason as in 46-asset-dispose-permission.sql: Production.View, Production.Edit
--     and Production.Comment go to the roles named Director, Project Manager, Pod Lead, Data Technician and Data Scientist.

CREATE TABLE dbo.Production (
  ProductionId     INT            NOT NULL IDENTITY(1,1) CONSTRAINT PK_Production PRIMARY KEY,
  MatterId         INT            NOT NULL,
  Name             NVARCHAR(200)  NOT NULL,
  VolumeNo         NVARCHAR(50)   NULL,
  DirectionCode    VARCHAR(3)     NOT NULL,
  PartyName        NVARCHAR(200)  NULL,
  ProductionSpecId INT            NULL,
  BatesBegin       NVARCHAR(50)   NULL,
  BatesEnd         NVARCHAR(50)   NULL,
  DocCount         INT            NULL,
  PageCount        INT            NULL,
  DeliveredOrDueOn DATE           NULL,
  Notes            NVARCHAR(4000) NULL,
  CreatedAt        DATETIME2      NOT NULL CONSTRAINT DF_Production_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT            NULL,
  ModifiedAt       DATETIME2      NULL,
  ModifiedByUserId INT            NULL,
  RowVersion       ROWVERSION     NOT NULL,
  CONSTRAINT FK_Production_Matter FOREIGN KEY (MatterId) REFERENCES dbo.Matter (MatterId),
  CONSTRAINT FK_Production_Spec FOREIGN KEY (ProductionSpecId, MatterId) REFERENCES dbo.ProductionSpec (ProductionSpecId, MatterId),
  CONSTRAINT FK_Production_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Production_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT UQ_Production_IdMatter UNIQUE (ProductionId, MatterId),
  CONSTRAINT CK_Production_Direction CHECK (DirectionCode IN ('OUT', 'IN')),
  CONSTRAINT CK_Production_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT CK_Production_Counts CHECK ((DocCount IS NULL OR DocCount >= 0) AND (PageCount IS NULL OR PageCount >= 0))
);
GO

CREATE INDEX IX_Production_Matter ON dbo.Production (MatterId, DirectionCode) INCLUDE (ProductionSpecId, DeliveredOrDueOn);
CREATE INDEX IX_Production_Spec ON dbo.Production (ProductionSpecId) WHERE ProductionSpecId IS NOT NULL;
GO

CREATE TABLE dbo.ProductionComment (
  ProductionCommentId INT            NOT NULL IDENTITY(1,1) CONSTRAINT PK_ProductionComment PRIMARY KEY,
  ProductionId        INT            NOT NULL,
  MatterId            INT            NOT NULL,
  Body                NVARCHAR(4000) NOT NULL,
  CreatedAt           DATETIME2      NOT NULL CONSTRAINT DF_ProductionComment_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId     INT            NULL,
  ModifiedAt          DATETIME2      NULL,
  ModifiedByUserId    INT            NULL,
  RowVersion          ROWVERSION     NOT NULL,
  CONSTRAINT FK_ProductionComment_Production FOREIGN KEY (ProductionId, MatterId) REFERENCES dbo.Production (ProductionId, MatterId) ON DELETE CASCADE,
  CONSTRAINT FK_ProductionComment_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_ProductionComment_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT CK_ProductionComment_Body CHECK (LEN(LTRIM(RTRIM(Body))) > 0)
);
GO

CREATE INDEX IX_ProductionComment_Production ON dbo.ProductionComment (ProductionId, ProductionCommentId);
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Production TO mf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.ProductionComment TO mf_app;
DENY ALTER ON dbo.Production TO mf_app;
DENY ALTER ON dbo.ProductionComment TO mf_app;
GO

DENY SELECT, VIEW DEFINITION ON dbo.Production TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.ProductionComment TO mf_report_reader;
GO

INSERT dbo.Permission (Code, GroupName, Description, IsActive)
SELECT v.Code, 'Productions', v.Description, 1
FROM (VALUES
  ('Production.View', N'View productions'),
  ('Production.Edit', N'Create, edit and delete productions'),
  ('Production.Comment', N'Comment on productions')
) AS v (Code, Description)
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permission p WHERE p.Code = v.Code);
GO

INSERT dbo.RolePermission (RoleId, PermissionId)
SELECT r.RoleId, p.PermissionId
FROM dbo.Role r
JOIN dbo.Permission p ON p.Code IN ('Production.View', 'Production.Edit', 'Production.Comment')
WHERE r.Name IN (N'Director', N'Project Manager', N'Pod Lead', N'Data Technician', N'Data Scientist') AND r.IsSystemAdmin = 0
  AND NOT EXISTS (SELECT 1 FROM dbo.RolePermission x WHERE x.RoleId = r.RoleId AND x.PermissionId = p.PermissionId);
GO
