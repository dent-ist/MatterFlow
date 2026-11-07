-- 62-director-be-manager.sql
-- Purpose: Identity #976 (owner decision, 2026-11-07; not a Reports change): the starter role "Director" holds Matter.BeManager so that a Director opens My Matters (the
--   route and the menu item need Matter.BeManager, Matter.View and Task.View). No new permission. Accepted side effect: a Director can then also be named as the Primary
--   or Secondary project manager of a matter (the manager pickers offer every active user who holds Matter.BeManager). Who sees sensitive matters does not change.
-- Owner: Identity (starter roles, role grants).
-- Notes:
--   * Roles are seeded once and editable, so existing databases need this grant (same pattern as 46-asset-dispose-permission.sql, 60-calendar-permissions.sql and
--     61-project-manager-report-run.sql). A fresh database has no role yet when this script runs; the starter role seeder (StarterRoles.cs) creates "Director" with
--     Matter.BeManager afterwards.
--   * The grant goes to a role named "Director" (not the built-in System Admin role, which holds every permission implicitly) ONLY while the role still has the description
--     the seeder wrote, the same sign of "still the starter role" that 38-project-manager-no-dashboard.sql and 61-project-manager-report-run.sql use. A role whose description
--     an administrator has changed, a renamed role and a role created by hand are left alone: grant Matter.BeManager in the role editor. What the script did is printed.
--   * Matter.BeManager exists since script 28-matter-managers.sql; nothing but this one grant is written. If the permission row is missing the script does nothing.
--   * Idempotent: the INSERT skips a row that already exists. No table is created, so db/report-access.json is unchanged.

DECLARE @roleId INT = (SELECT TOP 1 RoleId FROM dbo.Role WHERE Name = N'Director' AND IsSystemAdmin = 0 ORDER BY RoleId);
IF @roleId IS NULL
BEGIN
  PRINT N'62-director-be-manager: no role named "Director"; nothing to do.';
END
ELSE IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE RoleId = @roleId
                    AND Description = N'Department head: full operational access plus oversight.')
BEGIN
  PRINT N'62-director-be-manager: the role "Director" (RoleId ' + CAST(@roleId AS NVARCHAR(12)) + N') no longer has the starter description (customised); left alone. Grant Matter.BeManager in the role editor if wanted.';
END
ELSE
BEGIN
  INSERT dbo.RolePermission (RoleId, PermissionId)
  SELECT @roleId, p.PermissionId
  FROM dbo.Permission p
  WHERE p.Code = 'Matter.BeManager'
    AND NOT EXISTS (SELECT 1 FROM dbo.RolePermission x WHERE x.RoleId = @roleId AND x.PermissionId = p.PermissionId);
  PRINT N'62-director-be-manager: granted Matter.BeManager to the role "Director" (RoleId ' + CAST(@roleId AS NVARCHAR(12)) + N'), ' + CAST(@@ROWCOUNT AS NVARCHAR(12)) + N' row(s) added.';
END
GO
