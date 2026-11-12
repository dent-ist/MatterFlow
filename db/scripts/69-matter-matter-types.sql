-- 69-matter-matter-types.sql
-- Purpose: Matter Types become a multi-select (epic #1368, issue #1370). A matter carries zero, one or several Matter Types: the join table
--   dbo.MatterMatterType (one row per matter and type). Each existing single value dbo.Matter.MatterTypeId is copied in as one selected type.
-- Owner: Organization (matters).
-- Notes:
--   * The old column dbo.Matter.MatterTypeId is KEPT (scripts are immutable and a column is dropped in a later release: expand, then contract) but is no longer read or
--     written by the application from this script on; the join table is the source of truth. Its foreign key FK_Matter_MatterType and index IX_Matter_MatterType are
--     dropped here, otherwise a Matter Type that matters no longer use could not be deleted because of the stale value in the old column.
--   * The order in which a matter's types are shown is the order of the Matter Types list (dbo.MatterType.SortOrder), so the join table has no position column.
--   * Deleting a Matter Type that a matter uses stays refused: the foreign key to dbo.MatterType is the backstop (the application answers 409 IN_USE first).
--   * A matter's rows are removed with the matter by the application (matters are deactivated, never deleted); the foreign key to dbo.Matter has no cascade.
--   * The new table is classified in db/report-access.json (allow) and granted to lpt_app and lpt_report_reader below.
--   * The statement that copies the data is safe to run on a database without matters (it copies nothing).

CREATE TABLE dbo.MatterMatterType (
  MatterId     INT NOT NULL,
  MatterTypeId INT NOT NULL,
  CONSTRAINT PK_MatterMatterType PRIMARY KEY (MatterId, MatterTypeId),
  CONSTRAINT FK_MatterMatterType_Matter FOREIGN KEY (MatterId) REFERENCES dbo.Matter (MatterId),
  CONSTRAINT FK_MatterMatterType_MatterType FOREIGN KEY (MatterTypeId) REFERENCES dbo.MatterType (MatterTypeId)
);
GO

CREATE INDEX IX_MatterMatterType_MatterType ON dbo.MatterMatterType (MatterTypeId, MatterId);
GO

INSERT dbo.MatterMatterType (MatterId, MatterTypeId)
SELECT MatterId, MatterTypeId FROM dbo.Matter WHERE MatterTypeId IS NOT NULL;
GO

ALTER TABLE dbo.Matter DROP CONSTRAINT FK_Matter_MatterType;
GO

DROP INDEX IX_Matter_MatterType ON dbo.Matter;
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.MatterMatterType TO lpt_app;
DENY ALTER ON dbo.MatterMatterType TO lpt_app;
GRANT SELECT ON dbo.MatterMatterType TO lpt_report_reader;
GO
