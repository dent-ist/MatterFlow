-- 46-asset-dispose-permission.sql
-- Purpose: PM v2 (epic #851, issue #865). Adds the permission Asset.Dispose ("move an asset to Pending disposition or Disposed", docs/ux/pm-v2-review
--   section 9.1) and its default grants.
-- Owner: Identity (permission catalog contracts/permissions.json, role grants).
-- Notes:
--   * Moving an asset to Active or Inactive keeps Asset.Edit; only the two retention states need Asset.Dispose, so the people who decide a disposition are few.
--   * The permission catalog is normally synchronized by the app after the migrations; the row is inserted here as well because the grants below need it
--     (the sync later refreshes group and description, same text as the catalog). Same pattern as 34-matter-view-sensitive.sql.
--   * Roles are seeded once and editable, so existing databases need this grant: the permission goes to the roles named "Director" and "Project Manager"
--     (the starter roles that decide dispositions). The built-in System Admin role holds every permission implicitly and gets no rows. Roles that were
--     renamed or created by hand are NOT touched: grant the permission to them in the role administration.
--   * Idempotent: the INSERTs skip rows that already exist. No table is created, so db/report-access.json is unchanged.

INSERT dbo.Permission (Code, GroupName, Description, IsActive)
SELECT v.Code, 'Assets', v.Description, 1
FROM (VALUES
  ('Asset.Dispose', N'Move assets to Pending disposition or Disposed')
) AS v (Code, Description)
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permission p WHERE p.Code = v.Code);
GO

INSERT dbo.RolePermission (RoleId, PermissionId)
SELECT r.RoleId, p.PermissionId
FROM dbo.Role r
JOIN dbo.Permission p ON p.Code = 'Asset.Dispose'
WHERE r.Name IN (N'Director', N'Project Manager') AND r.IsSystemAdmin = 0
  AND NOT EXISTS (SELECT 1 FROM dbo.RolePermission x WHERE x.RoleId = r.RoleId AND x.PermissionId = p.PermissionId);
GO
