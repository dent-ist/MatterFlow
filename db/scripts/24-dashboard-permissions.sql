-- 24-dashboard-permissions.sql
-- Purpose: "the Dashboard is not for everyone". Replaces the single permission Dashboard.ViewDepartment by Dashboard.View (open the Dashboard) and one view
--   permission per Dashboard tab (Summary, Breakdowns, Trends, Swimlane, Users), and moves the existing grants so that nobody loses access.
-- Owner: Identity (permission catalog contracts/permissions.json) and WorkViews (Dashboard endpoints).
-- Notes:
--   * The permission catalog is normally synchronized by the app after the migrations. The new codes are inserted here as well because the grants below
--     need their rows; the sync later refreshes group and description (same text as the catalog).
--   * Before this script the Dashboard item was in the navigation for every user, so Dashboard.View goes to EVERY role (access is unchanged on the day
--     of the release); administrators then take it away from the roles that should not have it. The built-in System Admin role holds every permission
--     implicitly and gets no rows.
--   * Roles that held Dashboard.ViewDepartment get all five tab permissions (they saw everything the old right covered, including the Swimlane and
--     Users tabs introduced with it). Roles that hold Task.Assign get Dashboard.ViewSummary (they saw the unassigned queue, now part of Summary).
--   * Dashboard.ViewDepartment is removed together with its grants (the catalog no longer lists it). Applied once; idempotent anyway.

-- 1. The new permission rows.
INSERT dbo.Permission (Code, GroupName, Description, IsActive)
SELECT v.Code, 'Dashboard', v.Description, 1
FROM (VALUES
  ('Dashboard.View',           N'Open the Dashboard (the Dashboard menu item and page). Each tab below also needs its own permission'),
  ('Dashboard.ViewSummary',    N'Summary tab: headline counts, the unassigned queue, and the overdue and due soon lists'),
  ('Dashboard.ViewBreakdowns', N'Breakdowns tab: open tasks by priority, task type and status, and their age'),
  ('Dashboard.ViewTrends',     N'Trends tab: tasks created and completed per day'),
  ('Dashboard.ViewSwimlane',   N'Swimlane tab: every open task on a board by status'),
  ('Dashboard.ViewUsers',      N'Users tab: team workload per person (open, overdue and due soon tasks)')
) AS v (Code, Description)
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permission p WHERE p.Code = v.Code);
GO

-- 2. Dashboard.View to every role (the Dashboard was visible to everybody).
INSERT dbo.RolePermission (RoleId, PermissionId)
SELECT r.RoleId, p.PermissionId
FROM dbo.Role r
CROSS JOIN dbo.Permission p
WHERE p.Code = 'Dashboard.View'
  AND r.IsSystemAdmin = 0
  AND NOT EXISTS (SELECT 1 FROM dbo.RolePermission x WHERE x.RoleId = r.RoleId AND x.PermissionId = p.PermissionId);
GO

-- 3. The five tab permissions to every role that held Dashboard.ViewDepartment.
INSERT dbo.RolePermission (RoleId, PermissionId)
SELECT DISTINCT held.RoleId, tab.PermissionId
FROM dbo.RolePermission held
JOIN dbo.Permission old ON old.PermissionId = held.PermissionId AND old.Code = 'Dashboard.ViewDepartment'
CROSS JOIN dbo.Permission tab
WHERE tab.Code IN ('Dashboard.ViewSummary', 'Dashboard.ViewBreakdowns', 'Dashboard.ViewTrends', 'Dashboard.ViewSwimlane', 'Dashboard.ViewUsers')
  AND NOT EXISTS (SELECT 1 FROM dbo.RolePermission x WHERE x.RoleId = held.RoleId AND x.PermissionId = tab.PermissionId);
GO

-- 4. Dashboard.ViewSummary to every role that held Task.Assign (the unassigned queue is part of Summary).
INSERT dbo.RolePermission (RoleId, PermissionId)
SELECT DISTINCT held.RoleId, tab.PermissionId
FROM dbo.RolePermission held
JOIN dbo.Permission assign ON assign.PermissionId = held.PermissionId AND assign.Code = 'Task.Assign'
CROSS JOIN dbo.Permission tab
WHERE tab.Code = 'Dashboard.ViewSummary'
  AND NOT EXISTS (SELECT 1 FROM dbo.RolePermission x WHERE x.RoleId = held.RoleId AND x.PermissionId = tab.PermissionId);
GO

-- 5. Remove the old permission and its grants.
DELETE rp
FROM dbo.RolePermission rp
JOIN dbo.Permission p ON p.PermissionId = rp.PermissionId
WHERE p.Code = 'Dashboard.ViewDepartment';
GO

DELETE FROM dbo.Permission WHERE Code = 'Dashboard.ViewDepartment';
GO
