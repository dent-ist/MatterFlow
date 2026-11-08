-- 19-task-type-icon.sql
-- Purpose: Task Type icons. Adds dbo.TaskType.IconKey, the stable kebab-case id of an icon in the curated Task Type icon library
--   (contracts/task-type-icons.json, Tabler Icons outline set). The icon is required: every Task Type has one, default 'file-text'.
-- Owner: Configuration.
-- Notes:
--   * The allowed values are an application rule (allow-list embedded from contracts/task-type-icons.json), not a database constraint, so
--     the library can grow without a script. The CHECK only guards against empty values and obviously malformed ids.
--   * Existing rows get the default; the SME starter Task Types (docs/sme/seed-configuration.json) are backfilled with sensible icons by name.
--   * Script 16 is intentionally unused (see README); this is the next free number after 18.

ALTER TABLE dbo.TaskType ADD IconKey VARCHAR(50) NOT NULL CONSTRAINT DF_TaskType_IconKey DEFAULT 'file-text';
GO

ALTER TABLE dbo.TaskType ADD CONSTRAINT CK_TaskType_IconKey CHECK (LEN(IconKey) > 0 AND IconKey NOT LIKE '%[^a-z0-9-]%');
GO

UPDATE dbo.TaskType SET IconKey = v.IconKey
FROM dbo.TaskType t
JOIN (VALUES
  (N'Collection Receipt', 'package-import'),
  (N'Data Processing', 'cpu-2'),
  (N'Relativity Workspace Setup', 'adjustments-cog'),
  (N'Data Load / Overlay', 'database-import'),
  (N'Search and Culling', 'filter-search'),
  (N'Review Setup and Batching', 'progress-check'),
  (N'Analytics / TAR Setup', 'robot'),
  (N'Production (Outgoing)', 'package-export'),
  (N'Incoming Production Intake', 'file-import'),
  (N'Harvey Vault Request', 'sparkles'),
  (N'Physical Media Custody Event', 'usb'),
  (N'Access Request', 'key'),
  (N'Export / Transfer', 'file-export'),
  (N'Archive and Disposition', 'archive'),
  (N'General / Ad Hoc Request', 'clipboard-list')
) AS v (Name, IconKey) ON v.Name = t.Name;
GO
