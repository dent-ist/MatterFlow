-- 35-matter-visibility.sql
-- Purpose: Sensitive matter access control (epic #788, issue #791, package SM-03). The SQL twin of the C# visibility rule
--   (MatterFlow.SharedKernel.Visibility.VisibilityPredicates, docs/ux/sensitive-matters/README.md sections 1 and 4) for the modules that read with plain
--   SQL (Notifications scheduler, Search, Dashboard / WorkViews, My Matters, Audit), plus the indexes the rule needs.
-- Owner: Organization (Matter), WorkManagement (Task, TaskAsset) and Assets (Asset); read by every module that filters by visibility.
-- Notes:
--   * Three inline table-valued functions (never scalar functions: a scalar function runs once per row and blocks parallelism). They take the viewer as
--     (@UserId, @SeeAll). @SeeAll is true for the System Admin and for holders of Matter.ViewSensitive; the caller resolves it (the application does,
--     the database does not know permissions). @UserId NULL means a system/background viewer: it never matches a manager or an assignee.
--       dbo.fnMatterVisible(@UserId, @SeeAll)  -> MatterId                    mode M: NOT IsSensitive OR SeeAll OR Primary/Secondary manager = user
--       dbo.fnTaskVisible(@UserId, @SeeAll)    -> TaskId, MatterId            mode T: the matter is visible OR the task is currently assigned to the user
--       dbo.fnAssetVisible(@UserId, @SeeAll)   -> AssetId, MatterId           mode A: the matter is visible OR the asset is linked to a task assigned to the user
--   * Performance (measured at 200 matters / 24,000 tasks, MatterFlow.IntegrationTests VisibilityFunctionsTests): dbo.fnMatterVisible costs +2% reads
--     as a semi-join on a task's MatterId. dbo.fnTaskVisible and fnAssetVisible are for a single id or a short id list (a notification recipient, one
--     task, one asset); joining them to a whole table of tasks re-reads the Task table. For set-wide counts and lists use the form the C# port
--     LEFT JOIN dbo.fnMatterVisible(@u, @s) v ON v.MatterId = t.MatterId ... WHERE (v.MatterId IS NOT NULL OR t.AssignedUserId = @u). Written as
--     EXISTS (...) OR t.AssignedUserId = @u the same rule probes the Matter table once per task (38,000 reads instead of 240 for 20,000 open tasks).
--   * While the go-live switch (Features:SensitiveMatterAccess) is off the application does not call them, so nothing changes for anyone.
--   * The report login mf_report_reader gets no access to the functions (explicit DENY below, written with bracketed names because
--     db/report-access.json classifies tables only). Reports are not decided in epic #788; they keep reading the tables as before.
--   * IX_Matter_Sensitive: the set of sensitive matters is small, so the filtered index keeps "hidden matters" style anti-joins cheap.
--     IX_Task_AssignedMatter serves the assignee rule (user -> tasks -> matter) without touching the clustered index.
--     AuditEvent already has IX_Audit_Matter; no audit index is added until a plan shows a scan.
--   * No table is created, so db/report-access.json is unchanged.

CREATE INDEX IX_Matter_Sensitive ON dbo.Matter (MatterId)
  INCLUDE (PrimaryManagerId, SecondaryManagerId)
  WHERE IsSensitive = 1;
GO

CREATE INDEX IX_Task_AssignedMatter ON dbo.Task (AssignedUserId, MatterId)
  INCLUDE (StatusCode)
  WHERE AssignedUserId IS NOT NULL;
GO

CREATE FUNCTION dbo.fnMatterVisible (@UserId INT, @SeeAll BIT)
RETURNS TABLE
AS
RETURN
(
  SELECT m.MatterId
  FROM dbo.Matter m
  WHERE m.IsSensitive = 0
     OR ISNULL(@SeeAll, 0) = 1
     OR (@UserId IS NOT NULL AND (m.PrimaryManagerId = @UserId OR m.SecondaryManagerId = @UserId))
);
GO

CREATE FUNCTION dbo.fnTaskVisible (@UserId INT, @SeeAll BIT)
RETURNS TABLE
AS
RETURN
(
  SELECT t.TaskId, t.MatterId
  FROM dbo.Task t
  WHERE ISNULL(@SeeAll, 0) = 1
     OR EXISTS (SELECT 1 FROM dbo.Matter m
                WHERE m.MatterId = t.MatterId
                  AND (m.IsSensitive = 0 OR (@UserId IS NOT NULL AND (m.PrimaryManagerId = @UserId OR m.SecondaryManagerId = @UserId))))
     OR (@UserId IS NOT NULL AND t.AssignedUserId = @UserId)
);
GO

CREATE FUNCTION dbo.fnAssetVisible (@UserId INT, @SeeAll BIT)
RETURNS TABLE
AS
RETURN
(
  SELECT a.AssetId, a.MatterId
  FROM dbo.Asset a
  WHERE ISNULL(@SeeAll, 0) = 1
     OR EXISTS (SELECT 1 FROM dbo.Matter m
                WHERE m.MatterId = a.MatterId
                  AND (m.IsSensitive = 0 OR (@UserId IS NOT NULL AND (m.PrimaryManagerId = @UserId OR m.SecondaryManagerId = @UserId))))
     OR (@UserId IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.TaskAsset ta JOIN dbo.Task t ON t.TaskId = ta.TaskId
                                         WHERE ta.AssetId = a.AssetId AND t.AssignedUserId = @UserId))
);
GO

IF DATABASE_PRINCIPAL_ID('mf_report_reader') IS NOT NULL
BEGIN
  DENY SELECT ON [dbo].[fnMatterVisible] TO [mf_report_reader];
  DENY SELECT ON [dbo].[fnTaskVisible] TO [mf_report_reader];
  DENY SELECT ON [dbo].[fnAssetVisible] TO [mf_report_reader];
END
GO
