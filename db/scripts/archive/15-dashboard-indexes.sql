-- 15-dashboard-indexes.sql
-- Purpose: support the Dashboard aggregates (created in the period / recently created, completed in the period / recently completed).
-- Owner: WorkViews. Index-only change; no data or constraint changes.

CREATE INDEX IX_Task_CreatedAt ON dbo.Task (CreatedAt DESC, TaskId DESC);
GO

CREATE INDEX IX_Task_StatusChanged ON dbo.Task (StatusCode, StatusChangedAt DESC, TaskId DESC);
GO
