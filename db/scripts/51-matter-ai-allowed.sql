-- 51-matter-ai-allowed.sql
-- Purpose: Matter detail redesign, epic #1001, issue MD-02 (#1003), owner decision AQ.3: one new Matter field, "AI allowed".
--   0 = No (default), 1 = On-prem AI only, 2 = Company-approved AI services. Editable by holders of Matter.Edit; a change is audited (generic field event).
-- Owner: Organization. No backfill (nobody uses the application yet, owner status 2026-10-24): existing rows take the default 0 = No.
-- Notes: not a new table; the grants of dbo.Matter are unchanged and the report login keeps its existing access to the table.

ALTER TABLE dbo.Matter ADD AiAllowed TINYINT NOT NULL CONSTRAINT DF_Matter_AiAllowed DEFAULT 0;
GO

ALTER TABLE dbo.Matter ADD CONSTRAINT CK_Matter_AiAllowed CHECK (AiAllowed IN (0, 1, 2));
GO
