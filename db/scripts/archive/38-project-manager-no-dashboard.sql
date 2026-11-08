-- 38-project-manager-no-dashboard.sql
-- Purpose: Project Manager experience (epic #758, issue #764, package WP-PX1). The department Dashboard is hidden from the starter role "Project Manager" through
--   permissions (owner decision: not through a UI special case); the manager works from My Matters. The starter role loses Dashboard.View, Dashboard.ViewSummary and
--   Dashboard.ViewSwimlane. An administrator can grant any Dashboard tab to the role again in the role editor; nothing hard-codes the role name in the application.
-- Owner: Identity (starter roles, role grants).
-- Notes:
--   * Roles are seeded once and editable, so existing databases need this change, same pattern as 28-matter-managers.sql. The grants are removed from a role named
--     "Project Manager" ONLY while the role still equals the previous starter definition exactly: the same permissions, no more and no fewer. A role an administrator
--     has customised (a permission added or taken away, a Dashboard tab added) is left alone, and so is a renamed role, a role created by hand and the built-in
--     System Admin role.
--   * The description of the starter role is replaced only while it still has the text the previous scripts and the seeder wrote.
--   * What the script did is printed (the migration runner logs the messages of a script): the role id and the number of grants removed, or why it left the role alone.
--   * Idempotent: a second run finds a role without the Dashboard grants, which no longer equals the old definition, and does nothing. No table is created, so
--     db/report-access.json is unchanged. The permission catalogue is unchanged (no new code).

DECLARE @oldStarter TABLE (Code VARCHAR(100) NOT NULL PRIMARY KEY);
INSERT @oldStarter (Code) VALUES
    ('Asset.Create'), ('Asset.Edit'), ('Asset.Link'), ('Asset.View'), ('Client.Create'), ('Client.Edit'),
    ('Client.EditNumber'), ('Client.View'), ('Matter.AssignManagers'), ('Matter.BeManager'), ('Matter.Create'), ('Matter.Edit'),
    ('Matter.EditNumber'), ('Matter.SetActive'), ('Matter.View'), ('Pod.View'), ('Project.Archive'), ('Project.Create'),
    ('Project.Edit'), ('Project.View'), ('Task.Assign'), ('Task.Cancel'), ('Task.ChangeStatus'), ('Task.Comment'),
    ('Task.Complete'), ('Task.Create'), ('Task.Edit'), ('Task.Reopen'), ('Task.SetPriority'), ('Task.View'),
    ('Workflow.Execute'), ('Workflow.StepReopen'),
    ('Dashboard.View'), ('Dashboard.ViewSummary'), ('Dashboard.ViewSwimlane');

DECLARE @roleId INT = (SELECT TOP 1 RoleId FROM dbo.Role WHERE Name = N'Project Manager' AND IsSystemAdmin = 0 ORDER BY RoleId);
IF @roleId IS NULL
BEGIN
  PRINT N'38-project-manager-no-dashboard: no role named "Project Manager"; nothing to do.';
END
ELSE IF EXISTS (SELECT 1 FROM dbo.RolePermission rp JOIN dbo.Permission p ON p.PermissionId = rp.PermissionId WHERE rp.RoleId = @roleId AND p.Code NOT IN (SELECT Code FROM @oldStarter))
     OR EXISTS (SELECT 1 FROM @oldStarter o WHERE NOT EXISTS (SELECT 1 FROM dbo.RolePermission rp JOIN dbo.Permission p ON p.PermissionId = rp.PermissionId WHERE rp.RoleId = @roleId AND p.Code = o.Code))
BEGIN
  PRINT N'38-project-manager-no-dashboard: the role "Project Manager" (RoleId ' + CAST(@roleId AS NVARCHAR(12)) + N') no longer equals the starter definition (customised or already changed); left alone.';
END
ELSE
BEGIN
  DELETE rp
  FROM dbo.RolePermission rp
  JOIN dbo.Permission p ON p.PermissionId = rp.PermissionId
  WHERE rp.RoleId = @roleId AND p.Code IN ('Dashboard.View', 'Dashboard.ViewSummary', 'Dashboard.ViewSwimlane');
  PRINT N'38-project-manager-no-dashboard: removed ' + CAST(@@ROWCOUNT AS NVARCHAR(12)) + N' Dashboard grants from the role "Project Manager" (RoleId ' + CAST(@roleId AS NVARCHAR(12)) + N').';

  UPDATE dbo.Role
  SET Description = N'Manages clients, matters and projects, can be named as a matter''s project manager; works from My Matters.'
  WHERE RoleId = @roleId
    AND Description = N'Manages clients, matters and projects, can be named as a matter''s project manager; sees the Dashboard summary and swimlane.';
END
GO
