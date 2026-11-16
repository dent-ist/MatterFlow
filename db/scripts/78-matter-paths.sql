-- 78-matter-paths.sql
-- Purpose: Matters round 4 (epic #1389, issue #1391). A matter carries several DMS paths and several DFS paths instead of one of each: the new table
--   dbo.MatterPath holds one row per path (matter, kind DMS or DFS, the path text, its position). Today's single dbo.Matter.DmsPath and dbo.Matter.DfsPath
--   are copied in as position 1 of their kind, and the two old columns are dropped.
-- Owner: Organization (matters).
-- Notes:
--   * Nothing is deployed and the existing values are demo or test data (owner, 2026-10-24), so the old columns are dropped in this one script instead of the
--     two-release expand-then-contract (same as script 76). The first real deployment starts from this history.
--   * Key: the row id (MatterPathId) is the primary key; a matter has at most one row at a position of a kind (UQ_MatterPath_MatterKindPosition), so the list
--     keeps its order. The same text twice in one list is refused by the application (it compares ignoring letter case), not by a key: a 1000-character
--     path is too long for an index key.
--   * Kind is DMS or DFS (CK_MatterPath_Kind); Position is 1 to 10 (CK_MatterPath_Position): at most 10 paths per kind. The text is never empty
--     (CK_MatterPath_Path) and at most 1000 characters, as the old columns were. No label per path.
--   * A matter's rows are removed with the matter by the application (matters are deactivated, never deleted); the foreign key has no cascade.
--   * Changes to the paths are audited by MATTER_PATHS_CHANGED events (one per kind and save, old and new list as text), not as generic field changes.
--   * The new table is classified in db/report-access.json (allow, as the old columns were readable) and granted to lpt_app and lpt_report_reader below.

CREATE TABLE dbo.MatterPath (
  MatterPathId INT IDENTITY(1, 1) NOT NULL,
  MatterId     INT NOT NULL,
  Kind         CHAR(3) NOT NULL,
  Position     TINYINT NOT NULL,
  Path         NVARCHAR(1000) NOT NULL,
  CONSTRAINT PK_MatterPath PRIMARY KEY (MatterPathId),
  CONSTRAINT UQ_MatterPath_MatterKindPosition UNIQUE (MatterId, Kind, Position),
  CONSTRAINT CK_MatterPath_Kind CHECK (Kind IN ('DMS', 'DFS')),
  CONSTRAINT CK_MatterPath_Position CHECK (Position BETWEEN 1 AND 10),
  CONSTRAINT CK_MatterPath_Path CHECK (LEN(Path) > 0),
  CONSTRAINT FK_MatterPath_Matter FOREIGN KEY (MatterId) REFERENCES dbo.Matter (MatterId)
);
GO

INSERT dbo.MatterPath (MatterId, Kind, Position, Path)
SELECT MatterId, 'DMS', 1, LTRIM(RTRIM(DmsPath)) FROM dbo.Matter WHERE LEN(LTRIM(RTRIM(DmsPath))) > 0;
GO

INSERT dbo.MatterPath (MatterId, Kind, Position, Path)
SELECT MatterId, 'DFS', 1, LTRIM(RTRIM(DfsPath)) FROM dbo.Matter WHERE LEN(LTRIM(RTRIM(DfsPath))) > 0;
GO

ALTER TABLE dbo.Matter DROP COLUMN DmsPath;
ALTER TABLE dbo.Matter DROP COLUMN DfsPath;
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.MatterPath TO lpt_app;
DENY ALTER ON dbo.MatterPath TO lpt_app;
GRANT SELECT ON dbo.MatterPath TO lpt_report_reader;
GO
