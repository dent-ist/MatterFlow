-- 63-asset-numbering.sql
-- Purpose: Issue #1297. Automatic numbering of assets. An asset type can switch on "Number assets automatically": every new asset of that type then gets a read-only Asset Number. The number ALWAYS
--   starts with the matter's CM Number (client number, hyphen, matter number: 123456-123444); the administrator controls only the TAIL after it, a free-text pattern with exactly one counter token such as
--   {###} (the number of # is the minimum width) and optional literal text around it: tail _{###} gives 123456-123444_001, tail -M-{###} gives 123456-123444-M-001. The counter RESTARTS FOR EACH MATTER.
--   First case: Media, tail _{###}, giving 90003-80008_001, 90003-80008_002, ...; the number names the folder that holds the content on the share.
-- Owner: Assets.
-- Notes:
--   * dbo.AssetType gets NumberingEnabled (default 0 = off), NumberingPattern (the tail; default '_{###}'; the application validates it with the rules of AssetNumbering.Parse: exactly one counter, no other
--     token, no \ / : * ? " < > | or control characters, no space at either end, no dot at the end; the CHECK only keeps the length, 1 to 50) and NumberingScope (1 = per matter, the only value for now; the
--     column stays so that other scopes can be added by a later script). Changing the pattern affects only assets created afterwards.
--   * dbo.Asset gets AssetNumber (the generated text, a SNAPSHOT: a later change of the pattern or of the matter's CM Number does not rewrite it) and AssetNumberSeq (the counter value it was built from, so the
--     highest assigned number of a matter is exact without parsing text). Both are NULL for every existing asset: nothing is numbered or backfilled. The unique filtered index UQ_Asset_AssetNumber is
--     the last line of defence against a duplicate within (asset type, matter).
--   * TR_Asset_Guard (no delete, no move) is re-created with one more rule: an assigned number can never be changed or removed (error 51014), whatever writes to the table.
--   * dbo.AssetNumberCounter is the atomic counter: one row per (asset type, scope key); the scope key is the matter id while the scope is per matter. NextNumber is the number the NEXT asset gets; the
--     application takes it with one UPDATE ... OUTPUT under UPDLOCK in the transaction of the asset insert, so concurrent creates serialise on the row and never share a number. The counter only goes up
--     (an administrator may raise it to continue after existing folders; the application never lowers it below the highest assigned number); deleting or deactivating an asset never touches it, so a
--     number is never reused. No foreign key on the scope key (the scope is not always a matter).
--   * dbo.AssetNumberCounter is internal: denied for the report login (db/report-access.json). mf_app may read, insert and update it, never delete or alter.
--   * Idempotent: every statement checks first, so the script can be replayed on an empty or an existing database.

IF COL_LENGTH('dbo.AssetType', 'NumberingEnabled') IS NULL
  ALTER TABLE dbo.AssetType ADD
    NumberingEnabled BIT           NOT NULL CONSTRAINT DF_AssetType_NumberingEnabled DEFAULT 0,
    NumberingPattern NVARCHAR(150) NOT NULL CONSTRAINT DF_AssetType_NumberingPattern DEFAULT N'_{###}',
    NumberingScope   INT           NOT NULL CONSTRAINT DF_AssetType_NumberingScope DEFAULT 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AssetType_NumberingPattern' AND parent_object_id = OBJECT_ID('dbo.AssetType'))
  ALTER TABLE dbo.AssetType ADD CONSTRAINT CK_AssetType_NumberingPattern CHECK (LEN(NumberingPattern) BETWEEN 1 AND 50);
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AssetType_NumberingScope' AND parent_object_id = OBJECT_ID('dbo.AssetType'))
  ALTER TABLE dbo.AssetType ADD CONSTRAINT CK_AssetType_NumberingScope CHECK (NumberingScope IN (1));
GO

IF COL_LENGTH('dbo.Asset', 'AssetNumber') IS NULL
  ALTER TABLE dbo.Asset ADD
    AssetNumber    NVARCHAR(100) NULL,
    AssetNumberSeq INT           NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Asset_AssetNumber' AND parent_object_id = OBJECT_ID('dbo.Asset'))
  ALTER TABLE dbo.Asset ADD CONSTRAINT CK_Asset_AssetNumber CHECK (
    (AssetNumber IS NULL AND AssetNumberSeq IS NULL)
    OR (AssetNumber IS NOT NULL AND LEN(AssetNumber) > 0 AND AssetNumberSeq IS NOT NULL AND AssetNumberSeq >= 1));
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Asset_AssetNumber' AND object_id = OBJECT_ID('dbo.Asset'))
  CREATE UNIQUE INDEX UQ_Asset_AssetNumber ON dbo.Asset (AssetTypeId, MatterId, AssetNumber) WHERE AssetNumber IS NOT NULL;
GO

IF OBJECT_ID('dbo.AssetNumberCounter', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.AssetNumberCounter (
    AssetTypeId INT       NOT NULL,
    ScopeKey    INT       NOT NULL,
    NextNumber  INT       NOT NULL CONSTRAINT DF_AssetNumberCounter_Next DEFAULT 1,
    ModifiedAt  DATETIME2 NOT NULL CONSTRAINT DF_AssetNumberCounter_ModifiedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_AssetNumberCounter PRIMARY KEY (AssetTypeId, ScopeKey),
    CONSTRAINT FK_AssetNumberCounter_AssetType FOREIGN KEY (AssetTypeId) REFERENCES dbo.AssetType (AssetTypeId),
    CONSTRAINT CK_AssetNumberCounter_Next CHECK (NextNumber >= 1)
  );
END
GO

-- An Asset never moves to another Matter, is never hard-deleted (deactivate instead) and keeps its number once it has one.
CREATE OR ALTER TRIGGER dbo.TR_Asset_Guard ON dbo.Asset
AFTER UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;

  IF NOT EXISTS (SELECT 1 FROM inserted)
    THROW 51010, 'An asset cannot be deleted; set it inactive instead.', 1;

  IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.AssetId = i.AssetId WHERE i.MatterId <> d.MatterId)
    THROW 51011, 'An asset belongs to one matter and cannot move to another.', 1;

  IF EXISTS (
    SELECT 1 FROM inserted i JOIN deleted d ON d.AssetId = i.AssetId
    WHERE d.AssetNumber IS NOT NULL
      AND (i.AssetNumber IS NULL OR i.AssetNumberSeq IS NULL
           OR i.AssetNumber COLLATE Latin1_General_BIN2 <> d.AssetNumber COLLATE Latin1_General_BIN2
           OR i.AssetNumberSeq <> d.AssetNumberSeq))
    THROW 51014, 'An asset number is assigned once and cannot be changed or removed.', 1;
END;
GO

GRANT SELECT, INSERT, UPDATE ON dbo.AssetNumberCounter TO mf_app;
DENY DELETE, ALTER ON dbo.AssetNumberCounter TO mf_app;
GO

DENY SELECT, VIEW DEFINITION ON dbo.AssetNumberCounter TO mf_report_reader;
GO
