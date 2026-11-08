-- 20-task-assigned-at.sql
-- Purpose: dbo.Task.AssignedAt, when the current assignee (a user, not a Pod-only assignment) was assigned. My Work uses it for the
--   "New since your last visit" marker, so a Task created earlier but handed over today counts as new for the person it was handed to.
--   Maintained by the application whenever AssignedUserId changes; NULL while no user is assigned.
-- Owner: WorkManagement.
-- Notes:
--   * Backfill: the time of the latest TASK_ASSIGNED audit event that set the current assignee; Tasks created with their assignee have no
--     such event, so they fall back to the creation time.

ALTER TABLE dbo.Task ADD AssignedAt DATETIME2(3) NULL;
GO

UPDATE t SET AssignedAt = COALESCE(
  (SELECT MAX(a.OccurredAtUtc) FROM dbo.AuditEvent a
    WHERE a.TaskId = t.TaskId AND a.EventType = 'TASK_ASSIGNED'
      AND a.NewValue LIKE '%"userId":' + CAST(t.AssignedUserId AS VARCHAR(12)) + '}'),
  t.CreatedAt)
FROM dbo.Task t
WHERE t.AssignedUserId IS NOT NULL;
GO
