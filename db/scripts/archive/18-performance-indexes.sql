-- 18-performance-indexes.sql
-- Purpose: indexes found by the performance pass with realistic volumes (docs/qa/performance-round-1.md, ticket 64): 25,000 Tasks, 60,000 comments,
-- 500,000 audit events, 300 users. Owner: WorkManagement / WorkViews.
--
-- 1. The Task queue, My Work and Pod Work counts and the Dashboard aggregates all filter open Tasks by status and then apply the overdue rule, which reads
--    DueDate and DueAtUtc. Those two columns were not in the Task indexes, so every count (about 8 per Pod Work page, 4 per My Work page, 8 on the
--    Dashboard) scanned the whole clustered index (1,100 pages) or looked up each row. IX_Task_Queue, IX_Task_AssignedUser and IX_Task_Pod are rebuilt
--    with the columns those reads need as INCLUDEs: same names and key columns, wider leaf rows (about 40 bytes more). Measured on 25,000 Tasks:
--    Pod Work overdue count 1,112 -> 10 logical reads, Dashboard headline counts 3,561 -> 637.
-- 2. The comment limit check (409 COMMENT_LIMIT, SEC2-10) counts all comments of a Task, deleted ones included, so the filtered
--    IX_TaskComment_Task (WHERE IsDeleted = 0) cannot answer it: every comment write scanned the whole comment table (2,649 reads -> 2).

DROP INDEX IX_Task_Queue ON dbo.Task;
GO

CREATE INDEX IX_Task_Queue ON dbo.Task (StatusCode, PriorityId, DueSortKey, CreatedAt)
    INCLUDE (MatterId, AssignedUserId, AssignedPodId, TaskTypeId, DueDate, DueAtUtc);
GO

DROP INDEX IX_Task_AssignedUser ON dbo.Task;
GO

CREATE INDEX IX_Task_AssignedUser ON dbo.Task (AssignedUserId, StatusCode)
    INCLUDE (PriorityId, DueSortKey, DueDate, DueAtUtc, CreatedAt, StatusChangedAt);
GO

DROP INDEX IX_Task_Pod ON dbo.Task;
GO

CREATE INDEX IX_Task_Pod ON dbo.Task (AssignedPodId, StatusCode)
    INCLUDE (AssignedUserId, PriorityId, DueSortKey, DueDate, DueAtUtc, CreatedAt);
GO

CREATE INDEX IX_TaskComment_TaskAll ON dbo.TaskComment (TaskId);
GO
