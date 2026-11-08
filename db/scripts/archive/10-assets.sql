-- 10-assets.sql
-- Purpose: Asset Types and Matter-owned Assets (docs/erd.md section 3, decisions addendum O): dbo.AssetType and dbo.Asset,
--   plus the foreign key from a type's form definition to its Asset Type.
-- Owner: Assets.
-- Notes:
--   * An Asset belongs to exactly one Matter (MatterId NOT NULL, no Client or shared owner) and cannot move: a trigger rejects any
--     change of MatterId and any hard delete (assets are deactivated, never deleted, so their change history stays readable).
--   * UQ_Asset_IdMatter (AssetId, MatterId) is the target of the composite foreign key that keeps a Task-Asset link inside one Matter.
--   * The values of the type-specific fields are stored by the forms engine in dbo.FormValueSet (OwnerKind ASSET) together with the
--     form version they were captured under, so the Asset table has no value column.
--   * ExternalReference is intentionally not indexed: it is long free text (URL, workspace id, media label) and search is bounded
--     to one Matter (200-300 assets) through IX_Asset_Matter.

CREATE TABLE dbo.AssetType (
  AssetTypeId      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AssetType PRIMARY KEY,
  Name             NVARCHAR(100) NOT NULL,
  Description      NVARCHAR(500) NULL,
  SortOrder        INT           NOT NULL CONSTRAINT DF_AssetType_SortOrder DEFAULT 0,
  IsActive         BIT           NOT NULL CONSTRAINT DF_AssetType_IsActive DEFAULT 1,
  CreatedAt        DATETIME2     NOT NULL CONSTRAINT DF_AssetType_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT           NULL,
  ModifiedAt       DATETIME2     NULL,
  ModifiedByUserId INT           NULL,
  RowVersion       ROWVERSION    NOT NULL,
  CONSTRAINT UQ_AssetType_Name UNIQUE (Name),
  CONSTRAINT CK_AssetType_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT FK_AssetType_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_AssetType_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_AssetType_Sort ON dbo.AssetType (SortOrder, Name);
GO

ALTER TABLE dbo.FormDefinition
  ADD CONSTRAINT FK_FormDef_AssetType FOREIGN KEY (AssetTypeId) REFERENCES dbo.AssetType (AssetTypeId);
GO

CREATE TABLE dbo.Asset (
  AssetId           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Asset PRIMARY KEY,
  MatterId          INT            NOT NULL,
  AssetTypeId       INT            NOT NULL,
  DisplayName       NVARCHAR(300)  NOT NULL,
  ExternalReference NVARCHAR(1000) NULL,
  Description       NVARCHAR(2000) NULL,
  IsActive          BIT            NOT NULL CONSTRAINT DF_Asset_IsActive DEFAULT 1,
  CreatedAt         DATETIME2      NOT NULL CONSTRAINT DF_Asset_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId   INT            NULL,
  ModifiedAt        DATETIME2      NULL,
  ModifiedByUserId  INT            NULL,
  RowVersion        ROWVERSION     NOT NULL,
  -- Target of the TaskAsset composite FK (AssetId, MatterId): a link's Task and Asset must share the Matter.
  CONSTRAINT UQ_Asset_IdMatter UNIQUE (AssetId, MatterId),
  CONSTRAINT CK_Asset_DisplayName CHECK (LEN(LTRIM(RTRIM(DisplayName))) > 0),
  CONSTRAINT FK_Asset_Matter FOREIGN KEY (MatterId) REFERENCES dbo.Matter (MatterId),
  CONSTRAINT FK_Asset_AssetType FOREIGN KEY (AssetTypeId) REFERENCES dbo.AssetType (AssetTypeId),
  CONSTRAINT FK_Asset_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Asset_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_Asset_Matter ON dbo.Asset (MatterId, AssetTypeId) INCLUDE (DisplayName, IsActive);
GO

CREATE INDEX IX_Asset_Name ON dbo.Asset (DisplayName);
GO

CREATE INDEX IX_Asset_Type ON dbo.Asset (AssetTypeId);
GO

-- An Asset never moves to another Matter and is never hard-deleted (deactivate instead).
CREATE TRIGGER dbo.TR_Asset_Guard ON dbo.Asset
AFTER UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;

  IF NOT EXISTS (SELECT 1 FROM inserted)
    THROW 51010, 'An asset cannot be deleted; set it inactive instead.', 1;

  IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.AssetId = i.AssetId WHERE i.MatterId <> d.MatterId)
    THROW 51011, 'An asset belongs to one matter and cannot move to another.', 1;
END;
GO
