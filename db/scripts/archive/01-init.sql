-- 01-init.sql
-- Purpose: baseline for schema conventions. Real tables arrive in later scripts (see docs/architecture.md 4.5).
-- Owner: Platform.
--
-- Conventions established here:
--   * All objects live in the dbo schema.
--   * Timestamps are DATETIME2 in UTC; keys and constraints are named explicitly (PK_, FK_, UQ_, CK_, IX_, DF_).
--   * dbo.SchemaMigration is created by the runner itself, not by a script.

-- Monotonic, human-readable task numbers (consumed by the Work Management module).
CREATE SEQUENCE dbo.TaskNumberSeq AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE;
GO
