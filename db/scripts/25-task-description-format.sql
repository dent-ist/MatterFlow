-- 25-task-description-format.sql
-- Purpose: dbo.Task.DescriptionFormat, how dbo.Task.Description is stored: 'TEXT' (plain text, shown escaped with line breaks) or 'HTML'
--   (sanitized rich text with basic formatting and tables, decision R). Existing rows stay 'TEXT' until their description is edited;
--   new and edited descriptions are 'HTML'. The application sanitizes on every write, so an 'HTML' value is always the sanitized form.
-- Owner: WorkManagement.
-- Notes:
--   * Adding a NOT NULL column with a constant default is a metadata-only change in SQL Server; no row is rewritten and nothing is backfilled.
--   * No change to Description itself (nvarchar(max)).

ALTER TABLE dbo.Task ADD DescriptionFormat VARCHAR(4) NOT NULL CONSTRAINT DF_Task_DescriptionFormat DEFAULT 'TEXT';
GO

ALTER TABLE dbo.Task ADD CONSTRAINT CK_Task_DescriptionFormat CHECK (DescriptionFormat IN ('TEXT', 'HTML'));
GO
