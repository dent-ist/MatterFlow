-- 41-asset-type-size.sql
-- Purpose: PM v2 (epic #851, issue #867). Which custom NUMBER field of an asset type means "size", and in which unit (docs/ux/pm-v2-review
--   section 9.2, decisions addendum section AN). The administrator sets the default per asset type; the project manager can override it in the
--   Data tab and in reports (that choice is not stored on the type).
-- Owner: Assets.
-- Notes:
--   * SizeFieldKey is the key of a NUMBER field in the type's published form; the application validates it when it is set (a published form
--     version is immutable, so the key stays valid). SizeUnit is one of B, KB, MB, GB, TB (the size family, summed after conversion) or Items
--     (never mixed with bytes).
--   * Both are set together or both are empty. Changing them never rewrites any stored value.
--   * No data backfill: the types start without a designated field (the admin chooses). dbo.AssetType is already classified for the report login.

ALTER TABLE dbo.AssetType ADD
  SizeFieldKey VARCHAR(64) NULL,
  SizeUnit     VARCHAR(10) NULL;
GO

ALTER TABLE dbo.AssetType ADD
  CONSTRAINT CK_AssetType_SizeUnit CHECK (SizeUnit IS NULL OR SizeUnit IN ('B', 'KB', 'MB', 'GB', 'TB', 'Items')),
  CONSTRAINT CK_AssetType_SizeField_Unit CHECK ((SizeFieldKey IS NULL AND SizeUnit IS NULL) OR (SizeFieldKey IS NOT NULL AND SizeUnit IS NOT NULL AND LEN(LTRIM(RTRIM(SizeFieldKey))) > 0));
GO
