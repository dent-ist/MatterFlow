-- 33-my-matters-indexes.sql
-- Purpose: Project Manager epic #667 (WP-PM2, issue #686): two covering indexes so the My Matters reads are seeks, measured at 200 matters /
--   20,000 open tasks (docs/ux/pm-review/performance.md).
-- Owner: WorkManagement (Task) and WorkflowEngine (StepInstance); read by WorkViews.
-- Notes:
--   * Both indexes already exist; they are re-created WITH (DROP_EXISTING = ON), so there is no moment without an index and the names stay.
--     DROP_EXISTING without ONLINE takes a schema lock on the table while it rebuilds (a second or two at the sizes the plan names); run the
--     upgrade in the usual maintenance window.
--   * IX_Task_Matter (MatterId, StatusCode) did not carry the columns the My Matters counts read (due date, assignee, status time), so for a
--     person who manages 5 or 50 matters the optimizer scanned the whole clustered index (24,000 rows, every column). With the columns included the
--     same reads are seeks on the managed matters (a person who manages most matters gets one scan of this narrow index, which is the right plan).
--     CreatedAt is there for the order of the "unassigned" list, WorkflowInstanceId for the step counts of the health table.
--   * IX_StepInstance_Workflow (WorkflowInstanceId, SequenceNo) gains Status so the "% workflow complete" count never leaves the index.
--   * Cost: about 40 bytes per task and 12 bytes per step; every status, assignee or due-date change of a task also writes this index.

CREATE INDEX IX_Task_Matter ON dbo.Task (MatterId, StatusCode)
  INCLUDE (DueDate, DueAtUtc, DueSortKey, AssignedUserId, AssignedPodId, StatusChangedAt, CreatedAt, WorkflowInstanceId)
  WITH (DROP_EXISTING = ON);
GO

CREATE INDEX IX_StepInstance_Workflow ON dbo.StepInstance (WorkflowInstanceId, SequenceNo)
  INCLUDE (Status)
  WITH (DROP_EXISTING = ON);
GO
