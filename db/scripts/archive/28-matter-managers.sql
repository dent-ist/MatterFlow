-- 28-matter-managers.sql
-- Purpose: Project Manager epic #667 (WP-PM1, issues #669 and #670). Gives every matter an optional Primary and an optional Secondary project
--   manager (two nullable user references), and adds the two permissions Matter.BeManager (marker: "can be named as a matter's project manager")
--   and Matter.AssignManagers (set or clear a matter's managers, search every matter), with their default grants to the starter roles.
-- Owner: Organization (Matter columns, matter API) and Identity (permission catalog contracts/permissions.json, starter roles).
-- Notes:
--   * Owner decisions: both managers are optional and have identical rights; a Secondary without a Primary is allowed; a matter without a manager is
--     normal, so existing rows stay NULL (no backfill) and nothing is flagged. Who may be named is checked by the API (active user holding
--     Matter.BeManager), not by the database: a manager who later loses the role stays on the matter.
--   * CK_Matter_ManagersDiffer rejects the same user twice. The foreign keys have no cascade, like the other user references.
--   * The two filtered indexes serve "managed by me", "primary is X" and "any manager" (index union of the two) on the Matters list and the Task Queue.
--   * The permission catalog is normally synchronized by the app after the migrations; the rows are inserted here as well because the grants below
--     need them (the sync later refreshes group and description, same text as the catalog).
--   * Roles are seeded once and editable, so existing databases need this grant: Matter.BeManager goes to the role named "Project Manager";
--     Matter.AssignManagers goes to the roles named "Director" and "Project Manager" (owner decision: project managers can search and change the
--     assignment; administrators can take the permission away). Roles that were renamed or created by hand are NOT touched: grant the permissions
--     to them in the role administration. The built-in System Admin role holds every permission implicitly and gets no rows.
--   * The description of the starter role "Project Manager" is replaced only while it still has the text the seeder wrote.

ALTER TABLE dbo.Matter ADD PrimaryManagerId INT NULL, SecondaryManagerId INT NULL;
GO

ALTER TABLE dbo.Matter ADD
  CONSTRAINT FK_Matter_PrimaryManager FOREIGN KEY (PrimaryManagerId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Matter_SecondaryManager FOREIGN KEY (SecondaryManagerId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT CK_Matter_ManagersDiffer CHECK (PrimaryManagerId IS NULL OR SecondaryManagerId IS NULL OR PrimaryManagerId <> SecondaryManagerId);
GO

CREATE INDEX IX_Matter_PrimaryManager ON dbo.Matter (PrimaryManagerId) INCLUDE (IsActive) WHERE PrimaryManagerId IS NOT NULL;
GO

CREATE INDEX IX_Matter_SecondaryManager ON dbo.Matter (SecondaryManagerId) INCLUDE (IsActive) WHERE SecondaryManagerId IS NOT NULL;
GO

INSERT dbo.Permission (Code, GroupName, Description, IsActive)
SELECT v.Code, 'Client/Matter', v.Description, 1
FROM (VALUES
  ('Matter.BeManager',      N'Can be named as a matter''s project manager (Primary or Secondary). A marker: it opens no screen by itself'),
  ('Matter.AssignManagers', N'Set or clear the Primary and Secondary project manager of matters, and search all matters on My Matters')
) AS v (Code, Description)
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permission p WHERE p.Code = v.Code);
GO

INSERT dbo.RolePermission (RoleId, PermissionId)
SELECT r.RoleId, p.PermissionId
FROM dbo.Role r
JOIN dbo.Permission p ON (p.Code = 'Matter.BeManager' AND r.Name = N'Project Manager')
                      OR (p.Code = 'Matter.AssignManagers' AND r.Name IN (N'Director', N'Project Manager'))
WHERE r.IsSystemAdmin = 0
  AND NOT EXISTS (SELECT 1 FROM dbo.RolePermission x WHERE x.RoleId = r.RoleId AND x.PermissionId = p.PermissionId);
GO

UPDATE dbo.Role
SET Description = N'Manages clients, matters and projects, can be named as a matter''s project manager; sees the Dashboard summary and swimlane.'
WHERE Name = N'Project Manager' AND IsSystemAdmin = 0
  AND Description = N'Manages clients, matters and projects; sees the Dashboard summary and swimlane.';
GO
