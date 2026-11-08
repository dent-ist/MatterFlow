-- 57-task-unassigned-at.sql
-- Purpose: Dashboard v4 (epic #1063, issue DB-01 #1064). dbo.Task.UnassignedAt, since when a Task has had no assigned user (UTC). The Dashboard gauge and the "Unassigned for"
--   column measure how long the oldest unassigned Task has waited from it.
-- Owner: WorkManagement (module MatterFlow.WorkManagement); read by WorkViews.
-- Notes:
--   * Maintained by the application: set to the current time when a Task is created without an assigned user and whenever the assigned user is cleared; set back to NULL when a user is assigned.
--   * No backfill (decision AS item 8): rows from before this script keep NULL and readers use COALESCE(UnassignedAt, CreatedAt).
--   * The filtered index serves the "oldest unassigned task" read and the Unassigned queue: open Tasks (New, In progress, On hold) with no assigned user. Table access for reports is unchanged (Task stays "allow").

ALTER TABLE dbo.Task ADD UnassignedAt DATETIME2(3) NULL;
GO

CREATE INDEX IX_Task_Unassigned ON dbo.Task (AssignedPodId, CreatedAt)
  INCLUDE (UnassignedAt, MatterId, IsMatterSensitive)
  WHERE AssignedUserId IS NULL AND StatusCode IN ('NEW', 'IN_PROGRESS', 'ON_HOLD');
GO
