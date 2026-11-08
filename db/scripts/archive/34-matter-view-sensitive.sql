-- 34-matter-view-sensitive.sql
-- Purpose: Sensitive matter access control (epic #788, issue #789, package SM-01). Adds the permission Matter.ViewSensitive ("see all sensitive matters")
--   and its default grants.
-- Owner: Identity (permission catalog contracts/permissions.json, role grants).
-- Notes:
--   * The permission has an effect (it is the SeeAll flag of the visibility rule, docs/ux/sensitive-matters/README.md sections 1 and 2); it does not imply
--     Matter.View and is not a marker.
--   * The permission catalog is normally synchronized by the app after the migrations; the row is inserted here as well because the grants below need it
--     (the sync later refreshes group and description, same text as the catalog).
--   * Roles are seeded once and editable, so existing databases need this grant, same pattern as 28-matter-managers.sql: the permission goes to the role
--     named "Director". The built-in, locked System Admin role holds every permission implicitly (role screens already list all permissions for it, and
--     the visibility rule treats IsSystemAdmin as SeeAll), so it gets no rows, exactly as in script 28 and as the tests of scripts 24 to 28 require.
--     Roles that were renamed or created by hand are NOT touched: grant the permission to them in the role administration.
--   * Idempotent: the INSERTs skip rows that already exist. No table is created, so db/report-access.json is unchanged.

INSERT dbo.Permission (Code, GroupName, Description, IsActive)
SELECT v.Code, 'Client/Matter', v.Description, 1
FROM (VALUES
  ('Matter.ViewSensitive', N'See all sensitive matters (every sensitive matter, with all its tasks and assets, regardless of manager or assignment). Grants access to every sensitive matter')
) AS v (Code, Description)
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permission p WHERE p.Code = v.Code);
GO

INSERT dbo.RolePermission (RoleId, PermissionId)
SELECT r.RoleId, p.PermissionId
FROM dbo.Role r
JOIN dbo.Permission p ON p.Code = 'Matter.ViewSensitive'
WHERE r.Name = N'Director' AND r.IsSystemAdmin = 0
  AND NOT EXISTS (SELECT 1 FROM dbo.RolePermission x WHERE x.RoleId = r.RoleId AND x.PermissionId = p.PermissionId);
GO
