-- 37-task-matter-sensitivity.sql
-- Purpose: performance of the sensitive-matter rule at 20,000 tasks (epic #788, issue #810). dbo.Task carries a copy of its matter's IsSensitive flag, so the rule
--   "task visible = matter not sensitive OR viewer manages the matter OR task assigned to the viewer" becomes a test on the task's own columns (a covering
--   index answers it) instead of a join to dbo.Matter, which re-read the task table once per figure and made every ordered page a full sort.
-- Owner: WorkManagement (Task); the flag follows Organization's Matter.IsSensitive through the two triggers below.
-- Notes:
--   * dbo.Task.IsMatterSensitive is DENORMALISED: the application never writes it. TR_Matter_SensitivityToTask copies a change of Matter.IsSensitive to the
--     tasks of that matter (marking or un-marking a matter takes effect for its tasks inside the same transaction), and TR_Task_MatterSensitivityInsert
--     sets it for new tasks (raw inserts included), so the column can not drift. Both write only rows whose value differs. Changing the flag changes the
--     RowVersion of those tasks, as any update does: an edit form that was open on such a task gets one 409 and reloads.
--   * The rule itself is unchanged (README 1 of docs/ux/sensitive-matters): dbo.fnMatterVisible / fnTaskVisible / fnAssetVisible stay the reference and the
--     parity tests still compare them with the C# predicate and with the EF translation that now reads this column.
--   * Indexes: the readers of the task set (queue, My Work, Pod Work, dashboard, board, counts) must be answered from one index, so every index they
--     use also carries MatterId, AssignedUserId and the new flag. They were rebuilt (immutable scripts: fix forward). No table is created, so
--     db/report-access.json is unchanged (the report login keeps SELECT on the whole table).

ALTER TABLE dbo.Task ADD IsMatterSensitive BIT NOT NULL CONSTRAINT DF_Task_IsMatterSensitive DEFAULT (0);
GO

UPDATE t SET IsMatterSensitive = 1
FROM dbo.Task t
JOIN dbo.Matter m ON m.MatterId = t.MatterId
WHERE m.IsSensitive = 1;
GO

CREATE TRIGGER dbo.TR_Matter_SensitivityToTask ON dbo.Matter
AFTER UPDATE
AS
BEGIN
  SET NOCOUNT ON;
  IF NOT UPDATE(IsSensitive)
    RETURN;

  UPDATE t SET IsMatterSensitive = i.IsSensitive
  FROM dbo.Task t
  JOIN inserted i ON i.MatterId = t.MatterId
  JOIN deleted d ON d.MatterId = i.MatterId
  WHERE i.IsSensitive <> d.IsSensitive
    AND t.IsMatterSensitive <> i.IsSensitive;
END;
GO

CREATE TRIGGER dbo.TR_Task_MatterSensitivityInsert ON dbo.Task
AFTER INSERT
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE t SET IsMatterSensitive = m.IsSensitive
  FROM dbo.Task t
  JOIN inserted i ON i.TaskId = t.TaskId
  JOIN dbo.Matter m ON m.MatterId = t.MatterId
  WHERE t.IsMatterSensitive <> m.IsSensitive;
END;
GO

DROP INDEX IX_Task_Queue ON dbo.Task;
GO
CREATE INDEX IX_Task_Queue ON dbo.Task (StatusCode, PriorityId, DueSortKey, CreatedAt)
  INCLUDE (MatterId, AssignedUserId, AssignedPodId, TaskTypeId, DueDate, DueAtUtc, IsMatterSensitive);
GO

DROP INDEX IX_Task_AssignedUser ON dbo.Task;
GO
CREATE INDEX IX_Task_AssignedUser ON dbo.Task (AssignedUserId, StatusCode)
  INCLUDE (PriorityId, DueSortKey, DueDate, DueAtUtc, CreatedAt, StatusChangedAt, MatterId, IsMatterSensitive);
GO

DROP INDEX IX_Task_Pod ON dbo.Task;
GO
CREATE INDEX IX_Task_Pod ON dbo.Task (AssignedPodId, StatusCode)
  INCLUDE (AssignedUserId, PriorityId, DueSortKey, DueDate, DueAtUtc, CreatedAt, MatterId, IsMatterSensitive);
GO

DROP INDEX IX_Task_StatusChanged ON dbo.Task;
GO
CREATE INDEX IX_Task_StatusChanged ON dbo.Task (StatusCode, StatusChangedAt DESC, TaskId DESC)
  INCLUDE (MatterId, AssignedUserId, IsMatterSensitive);
GO

DROP INDEX IX_Task_Creator ON dbo.Task;
GO
CREATE INDEX IX_Task_Creator ON dbo.Task (CreatedByUserId, CreatedAt)
  INCLUDE (StatusCode, MatterId, AssignedUserId, IsMatterSensitive);
GO

DROP INDEX IX_Task_CreatedAt ON dbo.Task;
GO
CREATE INDEX IX_Task_CreatedAt ON dbo.Task (CreatedAt DESC, TaskId DESC)
  INCLUDE (StatusCode, MatterId, AssignedUserId, IsMatterSensitive);
GO

DROP INDEX IX_Task_CompletedCoverage ON dbo.Task;
GO
CREATE INDEX IX_Task_CompletedCoverage ON dbo.Task (CompletedAt)
  INCLUDE (StatusCode, AssignedUserId, TaskTypeId, MatterId, IsMatterSensitive)
  WHERE CompletedAt IS NOT NULL;
GO

-- The tasks a person holds on sensitive matters: the few rows the rule has to look at beyond "not sensitive" (the assets of those tasks, the dashboard stamp).
CREATE INDEX IX_Task_AssignedSensitive ON dbo.Task (AssignedUserId)
  INCLUDE (MatterId)
  WHERE IsMatterSensitive = 1 AND AssignedUserId IS NOT NULL;
GO
