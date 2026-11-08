-- 27-dashboard-unassigned.sql
-- Purpose: split the Dashboard Summary tab (epic #68, issue #81). The new permission Dashboard.ViewUnassigned shows the Summary tab with ONLY the
--   unassigned task queue (to pick or hand out work), without the department-wide counts and the Overdue / Due soon lists, which stay with
--   Dashboard.ViewSummary. Technician-type roles move from ViewSummary to ViewUnassigned.
-- Owner: Identity (permission catalog contracts/permissions.json) and WorkViews (GET /api/v1/dashboard redaction).
-- Notes:
--   * The permission catalog is normally synchronized by the app after the migrations; the row is inserted here as well because the grants below
--     need it (the sync later refreshes group and description, same text as the catalog).
--   * "Technician-type" = a role that holds Dashboard.ViewSummary AND Task.Assign but none of the department-level tabs (Breakdowns, Trends,
--     Swimlane, Users). Such a role gets ViewUnassigned and loses ViewSummary. Roles with any department-level tab (Director, Pod Lead, Project
--     Manager) and roles without Task.Assign (Read-Only Observer, Compliance Auditor) keep ViewSummary and get nothing new. The built-in System
--     Admin role holds every permission implicitly and gets no rows.
--   * Applied once; idempotent anyway (the revoke only touches roles that already hold ViewUnassigned).

INSERT dbo.Permission (Code, GroupName, Description, IsActive)
SELECT 'Dashboard.ViewUnassigned', 'Dashboard', N'See the unassigned task queue on the Dashboard Summary tab (assign work to yourself or others)', 1
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permission p WHERE p.Code = 'Dashboard.ViewUnassigned');
GO

-- 1. Grant ViewUnassigned to technician-type roles.
INSERT dbo.RolePermission (RoleId, PermissionId)
SELECT r.RoleId, un.PermissionId
FROM dbo.Role r
CROSS JOIN dbo.Permission un
WHERE un.Code = 'Dashboard.ViewUnassigned'
  AND r.IsSystemAdmin = 0
  AND EXISTS (SELECT 1 FROM dbo.RolePermission x JOIN dbo.Permission p ON p.PermissionId = x.PermissionId WHERE x.RoleId = r.RoleId AND p.Code = 'Dashboard.ViewSummary')
  AND EXISTS (SELECT 1 FROM dbo.RolePermission x JOIN dbo.Permission p ON p.PermissionId = x.PermissionId WHERE x.RoleId = r.RoleId AND p.Code = 'Task.Assign')
  AND NOT EXISTS (SELECT 1 FROM dbo.RolePermission x JOIN dbo.Permission p ON p.PermissionId = x.PermissionId
                  WHERE x.RoleId = r.RoleId AND p.Code IN ('Dashboard.ViewBreakdowns', 'Dashboard.ViewTrends', 'Dashboard.ViewSwimlane', 'Dashboard.ViewUsers'))
  AND NOT EXISTS (SELECT 1 FROM dbo.RolePermission x WHERE x.RoleId = r.RoleId AND x.PermissionId = un.PermissionId);
GO

-- 2. Revoke ViewSummary from the same roles (they hold ViewUnassigned now, still hold Task.Assign, and still have no department-level tab).
DELETE rp
FROM dbo.RolePermission rp
JOIN dbo.Permission sm ON sm.PermissionId = rp.PermissionId AND sm.Code = 'Dashboard.ViewSummary'
WHERE EXISTS (SELECT 1 FROM dbo.RolePermission x JOIN dbo.Permission p ON p.PermissionId = x.PermissionId WHERE x.RoleId = rp.RoleId AND p.Code = 'Dashboard.ViewUnassigned')
  AND EXISTS (SELECT 1 FROM dbo.RolePermission x JOIN dbo.Permission p ON p.PermissionId = x.PermissionId WHERE x.RoleId = rp.RoleId AND p.Code = 'Task.Assign')
  AND NOT EXISTS (SELECT 1 FROM dbo.RolePermission x JOIN dbo.Permission p ON p.PermissionId = x.PermissionId
                  WHERE x.RoleId = rp.RoleId AND p.Code IN ('Dashboard.ViewBreakdowns', 'Dashboard.ViewTrends', 'Dashboard.ViewSwimlane', 'Dashboard.ViewUsers'));
GO
