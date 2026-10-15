-- 25-dashboard-coverage.sql
-- Purpose: the Dashboard task type coverage matrix (epic #68, issue #73, addendum Q): the permission Dashboard.ViewCoverage (see how many tasks each
--   person completed per task type, for training and coverage planning) granted to the Director and Pod Lead roles, and a covering index for the
--   grouped read of completed tasks by assignee and task type in a period.
-- Owner: Identity (permission catalog contracts/permissions.json) and WorkViews (GET /api/v1/dashboard/coverage).
-- Notes:
--   * The permission catalog is normally synchronized by the app after the migrations; the row is inserted here as well because the grants below
--     need it (the sync later refreshes group and description, same text as the catalog).
--   * Only roles named Director and Pod Lead get the permission (other roles, including custom ones, do not). The built-in System Admin role holds
--     every permission implicitly.

INSERT dbo.Permission (Code, GroupName, Description, IsActive)
SELECT 'Dashboard.ViewCoverage', 'Dashboard', N'See how many tasks each person completed per task type (training and coverage planning)', 1
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permission p WHERE p.Code = 'Dashboard.ViewCoverage');
GO

INSERT dbo.RolePermission (RoleId, PermissionId)
SELECT r.RoleId, p.PermissionId
FROM dbo.Role r
CROSS JOIN dbo.Permission p
WHERE p.Code = 'Dashboard.ViewCoverage'
  AND r.Name IN (N'Director', N'Pod Lead')
  AND r.IsSystemAdmin = 0
  AND NOT EXISTS (SELECT 1 FROM dbo.RolePermission x WHERE x.RoleId = r.RoleId AND x.PermissionId = p.PermissionId);
GO

CREATE INDEX IX_Task_CompletedCoverage ON dbo.Task (CompletedAt) INCLUDE (StatusCode, AssignedUserId, TaskTypeId) WHERE CompletedAt IS NOT NULL;
GO
