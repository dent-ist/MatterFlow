-- 40-asset-disposition.sql
-- Purpose: PM v2 (epic #851, issue #864). Every asset gets a Disposition: Active, Inactive, Pending disposition, Disposed (docs/ux/pm-v2-review
--   section 9.1, decisions addendum section AN). dbo.Asset.IsActive stays and is constrained to agree: IsActive = 1 if and only if
--   DispositionCode = 'ACTIVE', so every existing reader of IsActive (lists, task links, the Set inactive dialog) keeps working and a
--   Pending disposition or Disposed asset is "not active" (it cannot be newly linked), exactly like an inactive one.
-- Owner: Assets.
-- Notes:
--   * Existing rows migrate in the same script: IsActive = 0 becomes INACTIVE, everything else keeps the default ACTIVE (the demo has no
--     inactive assets; nothing else needs a backfill). Replayable from an empty database.
--   * TR_Asset_Guard (no delete, no move) is unchanged.
--   * dbo.Asset is already classified for the report login (allow); new columns follow the table.

ALTER TABLE dbo.Asset ADD
  DispositionCode            VARCHAR(20)   NOT NULL CONSTRAINT DF_Asset_DispositionCode DEFAULT 'ACTIVE',
  DispositionChangedAt       DATETIME2     NULL,
  DispositionChangedByUserId INT           NULL,
  DispositionNote            NVARCHAR(500) NULL;
GO

-- Guarded: TR_Asset_Guard treats an UPDATE that touches no row as a delete, so an empty database must not run the statement.
IF EXISTS (SELECT 1 FROM dbo.Asset WHERE IsActive = 0)
  UPDATE dbo.Asset SET DispositionCode = 'INACTIVE' WHERE IsActive = 0;
GO

ALTER TABLE dbo.Asset ADD
  CONSTRAINT CK_Asset_DispositionCode CHECK (DispositionCode IN ('ACTIVE', 'INACTIVE', 'PENDING_DISPOSITION', 'DISPOSED')),
  CONSTRAINT CK_Asset_IsActive_Disposition CHECK ((IsActive = 1 AND DispositionCode = 'ACTIVE') OR (IsActive = 0 AND DispositionCode <> 'ACTIVE')),
  CONSTRAINT FK_Asset_DispositionChangedBy FOREIGN KEY (DispositionChangedByUserId) REFERENCES dbo.AppUser (UserId);
GO

CREATE INDEX IX_Asset_Matter_Disposition ON dbo.Asset (MatterId, AssetTypeId, DispositionCode);
GO
