-- 40-task-type-colour-target.sql
-- Purpose: PM v2 (epic #851, issue #852). Adds two optional columns to dbo.TaskType:
--   ColourKey  the name of the type's colour in the named palette of ten (contracts/task-type-colours.json: slate, blue, teal, green, amber,
--              orange, red, rose, violet, indigo). NULL = the neutral default. Never a free hex value, so contrast is guaranteed.
--   TargetDays the expected turnaround in calendar days (1 to 365). NULL = no target. Used later for the At risk badge.
-- Owner: Configuration.
-- Notes:
--   * The allowed colour names are an application rule (allow-list embedded from contracts/task-type-colours.json), like IconKey in script 19:
--     the CHECK only guards against empty values and malformed ids, so the palette can change without a script.
--   * Existing rows keep working: NULL colour = default, NULL target = none. No backfill (demo data only).
--   * The table-level grants of earlier scripts cover the new columns; dbo.TaskType stays readable for mf_report_reader.

ALTER TABLE dbo.TaskType ADD ColourKey VARCHAR(20) NULL;
GO

ALTER TABLE dbo.TaskType ADD TargetDays SMALLINT NULL;
GO

ALTER TABLE dbo.TaskType ADD CONSTRAINT CK_TaskType_ColourKey CHECK (ColourKey IS NULL OR (LEN(ColourKey) > 0 AND ColourKey NOT LIKE '%[^a-z]%'));
GO

ALTER TABLE dbo.TaskType ADD CONSTRAINT CK_TaskType_TargetDays CHECK (TargetDays IS NULL OR TargetDays BETWEEN 1 AND 365);
GO
