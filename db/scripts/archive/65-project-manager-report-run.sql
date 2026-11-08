-- 65-project-manager-report-run.sql
-- Purpose: Reports (epic #671, owner decision 8, 2026-11-07): the starter role "Project Manager" holds Report.Run ("run the reports assigned to your roles, keep
--   personal views and download the result as CSV"). The permission alone shows nothing: a person sees and runs only the reports an administrator (Report.Assign) has
--   assigned to one of their roles, and the seeder assigns the two Project Manager starter reports (#784) to this role only. Director, Pod Lead and the technician
--   roles stay without Report.Run (ADR 029, amended).
-- Owner: Identity (starter roles, role grants).
-- Notes:
--   * Roles are seeded once and editable, so existing databases need this grant (same pattern as 46-asset-dispose-permission.sql and 60-calendar-permissions.sql). A fresh
--     database has no role yet when this script runs; the starter role seeder (StarterRoles.cs) creates "Project Manager" with Report.Run afterwards.
--   * The grant goes to a role named "Project Manager" (not the built-in System Admin role, which holds every permission implicitly) ONLY while the role still has the
--     description the previous scripts and the seeder wrote, the same sign of "still the starter role" that 38-project-manager-no-dashboard.sql uses. A role whose description
--     an administrator has changed, a renamed role and a role created by hand are left alone: grant Report.Run in the role editor. What the script did is printed.
--   * The permission catalog is normally synchronized by the app after the migrations; the row is inserted here as well because the grant needs it (the sync later refreshes
--     group and description, same text as the catalog).
--   * Idempotent: the INSERTs skip rows that already exist. No table is created, so db/report-access.json is unchanged.

INSERT dbo.Permission (Code, GroupName, Description, IsActive)
SELECT v.Code, 'Reports', v.Description, 1
FROM (VALUES
  ('Report.Run', N'Run the reports assigned to your roles, keep personal views and download the result as CSV')
) AS v (Code, Description)
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permission p WHERE p.Code = v.Code);
GO

DECLARE @roleId INT = (SELECT TOP 1 RoleId FROM dbo.Role WHERE Name = N'Project Manager' AND IsSystemAdmin = 0 ORDER BY RoleId);
IF @roleId IS NULL
BEGIN
  PRINT N'65-project-manager-report-run: no role named "Project Manager"; nothing to do.';
END
ELSE IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE RoleId = @roleId
                    AND Description = N'Manages clients, matters and projects, can be named as a matter''s project manager; works from My Matters.')
BEGIN
  PRINT N'65-project-manager-report-run: the role "Project Manager" (RoleId ' + CAST(@roleId AS NVARCHAR(12)) + N') no longer has the starter description (customised); left alone. Grant Report.Run in the role editor if wanted.';
END
ELSE
BEGIN
  INSERT dbo.RolePermission (RoleId, PermissionId)
  SELECT @roleId, p.PermissionId
  FROM dbo.Permission p
  WHERE p.Code = 'Report.Run'
    AND NOT EXISTS (SELECT 1 FROM dbo.RolePermission x WHERE x.RoleId = @roleId AND x.PermissionId = p.PermissionId);
  PRINT N'65-project-manager-report-run: granted Report.Run to the role "Project Manager" (RoleId ' + CAST(@roleId AS NVARCHAR(12)) + N'), ' + CAST(@@ROWCOUNT AS NVARCHAR(12)) + N' row(s) added.';
END
GO
