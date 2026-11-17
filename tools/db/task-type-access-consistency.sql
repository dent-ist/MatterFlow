-- Task Type access by role: consistency check (epic #1397, issue #1399; design docs/ux/task-type-access/README.md section 3).
--
-- READ-ONLY: SELECT statements only. Run it as a person with read access to the LPT Hub database (not the report login):
--
--   sqlcmd -S SQLHOST -d LptHub -E -C -W -w 300 -s "|" -i tools\db\task-type-access-consistency.sql
--
-- dbo.TaskType.IsRestricted is maintained by the application in the same transaction as the access rows. It must be 1 exactly when the type has at least one
-- row with CanView = 1. Every row returned below is a defect. An empty result set means the data is consistent.
SET NOCOUNT ON;

-- 1  flagged restricted, but no role may view it (the type would be hidden from everybody except System Admin)
SELECT ty.TaskTypeId, ty.Name, 'IsRestricted = 1 and no CanView row' AS Problem
FROM dbo.TaskType ty
WHERE ty.IsRestricted = 1
  AND NOT EXISTS (SELECT 1 FROM dbo.TaskTypeRoleAccess a WHERE a.TaskTypeId = ty.TaskTypeId AND a.CanView = 1);

-- 2  has a View role, but is not flagged restricted (the rule would not be applied)
SELECT ty.TaskTypeId, ty.Name, 'IsRestricted = 0 and a CanView row exists' AS Problem
FROM dbo.TaskType ty
WHERE ty.IsRestricted = 0
  AND EXISTS (SELECT 1 FROM dbo.TaskTypeRoleAccess a WHERE a.TaskTypeId = ty.TaskTypeId AND a.CanView = 1);

-- 3  restricted types whose View roles are all deactivated (fail closed: only System Admin sees them; the Task Types screen warns about it)
SELECT ty.TaskTypeId, ty.Name, 'All CanView roles are inactive' AS Problem
FROM dbo.TaskType ty
WHERE ty.IsRestricted = 1
  AND EXISTS (SELECT 1 FROM dbo.TaskTypeRoleAccess a WHERE a.TaskTypeId = ty.TaskTypeId AND a.CanView = 1)
  AND NOT EXISTS (SELECT 1 FROM dbo.TaskTypeRoleAccess a JOIN dbo.Role r ON r.RoleId = a.RoleId AND r.IsActive = 1 WHERE a.TaskTypeId = ty.TaskTypeId AND a.CanView = 1);
