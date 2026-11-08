-- 60-calendar-permissions.sql
-- Purpose: Dashboard Calendar (epic #1074, issue #1075, decision AT): the permissions Dashboard.ViewCalendar (open the Calendar tab: counts, who is out and who
--   is in, holidays), Dashboard.ViewAbsenceReasons (see the absence type in the Calendar) and User.ManageAvailability (create, edit and delete the
--   Out of office entries of other people; a Pod Lead only for members of the pods they belong to) and their default grants.
-- Owner: Identity (permission catalog contracts/permissions.json, role grants).
-- Notes:
--   * The permission catalog is normally synchronized by the app after the migrations; the rows are inserted here as well because the grants below
--     need them (the sync later refreshes group and description, same text as the catalog). Same pattern as 25-dashboard-coverage.sql and 46-asset-dispose-permission.sql.
--   * Grants go to the roles named Director and Pod Lead (not to System Admin, which holds every permission implicitly, and not to renamed or hand-made roles).
--   * Idempotent: the INSERTs skip rows that already exist. No table is created, so db/report-access.json is unchanged by this script.

INSERT dbo.Permission (Code, GroupName, Description, IsActive)
SELECT v.Code, v.GroupName, v.Description, 1
FROM (VALUES
  ('Dashboard.ViewCalendar',       'Dashboard',    N'Open the Calendar tab: who is out and who can work each day, and holidays'),
  ('Dashboard.ViewAbsenceReasons', 'Dashboard',    N'See the type of an absence (vacation, sick, training) in the Calendar'),
  ('User.ManageAvailability',      'Organization', N'Create, edit and delete Out of office entries of other people (a Pod Lead: members of their own pods)')
) AS v (Code, GroupName, Description)
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permission p WHERE p.Code = v.Code);
GO

INSERT dbo.RolePermission (RoleId, PermissionId)
SELECT r.RoleId, p.PermissionId
FROM dbo.Role r
CROSS JOIN dbo.Permission p
WHERE p.Code IN ('Dashboard.ViewCalendar', 'Dashboard.ViewAbsenceReasons', 'User.ManageAvailability')
  AND r.Name IN (N'Director', N'Pod Lead')
  AND r.IsSystemAdmin = 0
  AND NOT EXISTS (SELECT 1 FROM dbo.RolePermission x WHERE x.RoleId = r.RoleId AND x.PermissionId = p.PermissionId);
GO
