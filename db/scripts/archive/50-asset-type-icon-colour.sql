-- 50-asset-type-icon-colour.sql
-- Purpose: UI update epic #953, issue #973 (UI-22): asset types get an icon and a colour, like task types (scripts 19 and 40).
--   IconKey   the stable kebab-case id of an icon in the closed Task Type icon library (contracts/task-type-icons.json).
--   ColourKey the name of the colour in the named palette of ten (contracts/task-type-colours.json).
-- Owner: Assets. Both are NULL for existing types: nothing is backfilled (nobody uses the application yet); a missing value means
--   "derive a stable default from the id" on the client. The application validates both against the shared lists; the CHECKs only
--   keep the shape (lower-case letters, digits and hyphens).
-- Notes: not a new table; grants of dbo.AssetType are unchanged, and the report login keeps its existing access to the table.

ALTER TABLE dbo.AssetType ADD IconKey VARCHAR(50) NULL;
ALTER TABLE dbo.AssetType ADD ColourKey VARCHAR(20) NULL;
GO

ALTER TABLE dbo.AssetType ADD CONSTRAINT CK_AssetType_IconKey CHECK (IconKey IS NULL OR (LEN(IconKey) > 0 AND IconKey NOT LIKE '%[^a-z0-9-]%'));
ALTER TABLE dbo.AssetType ADD CONSTRAINT CK_AssetType_ColourKey CHECK (ColourKey IS NULL OR (LEN(ColourKey) > 0 AND ColourKey NOT LIKE '%[^a-z]%'));
GO
