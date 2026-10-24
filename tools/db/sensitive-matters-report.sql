-- Sensitive matters: the report to read BEFORE the access rule is switched on (epic #788, SM-18, docs/runbook.md section 12).
--
-- READ-ONLY: SELECT statements only, nothing is written, no temporary objects outside tempdb. Run it as a person with read access to the MatterFlow database
-- (the DBA, or the application login), never as the report login (that login is denied on the tables it needs):
--
--   sqlcmd -S SQLHOST -d MatterFlow -E -C -W -w 300 -s "|" -i tools\db\sensitive-matters-report.sql
--
-- Why: when Features:SensitiveMatterAccess is switched on, every matter that is already flagged Sensitive becomes invisible to everybody except
--   (a) its Primary and Secondary project manager, (b) holders of the permission Matter.ViewSensitive (by default the System Administrator and the Director roles)
--   and (c) the people who are assigned a task on it (they see only that task and the matter header). Nobody is told in advance and nothing is changed by the switch.
-- A sensitive matter with NO manager is visible to (b) and (c) only. The owner decides, before go-live, who becomes its project manager.
--
-- Result sets, in order:
--   1  one row per sensitive matter: managers, task counts, how many people are assigned, and an Attention column (NO MANAGER / manager inactive)
--   2  the totals in one row
--   3  who sees ALL sensitive matters (Matter.ViewSensitive through an active role, or a System Admin role)
--   4  who sees only the tasks assigned to them (assigned a task on a sensitive matter, no manager of it, no ViewSensitive)
--   5  how many active people hold Matter.View but are none of the above for any sensitive matter (they will no longer see these matters at all)
SET NOCOUNT ON;

DECLARE @openStatuses TABLE (StatusCode VARCHAR(20) PRIMARY KEY);
INSERT @openStatuses VALUES ('NEW'), ('IN_PROGRESS'), ('ON_HOLD');

-- 1. the sensitive matters
SELECT
  m.ClientNumber,
  m.MatterRef,
  m.Name AS MatterName,
  CASE WHEN m.IsActive = 1 THEN 'active' ELSE 'inactive' END AS MatterStatus,
  ISNULL(pm.DisplayName, '-') AS PrimaryManager,
  ISNULL(sm.DisplayName, '-') AS SecondaryManager,
  CASE
    WHEN m.PrimaryManagerId IS NULL AND m.SecondaryManagerId IS NULL THEN 'NO MANAGER'
    WHEN (m.PrimaryManagerId IS NULL OR pm.IsActive = 0) AND (m.SecondaryManagerId IS NULL OR sm.IsActive = 0) THEN 'MANAGER INACTIVE'
    ELSE ''
  END AS Attention,
  ISNULL(t.OpenTasks, 0) AS OpenTasks,
  ISNULL(t.AllTasks, 0) AS AllTasks,
  ISNULL(t.Assignees, 0) AS PeopleAssignedATask
FROM dbo.Matter m
LEFT JOIN dbo.AppUser pm ON pm.UserId = m.PrimaryManagerId
LEFT JOIN dbo.AppUser sm ON sm.UserId = m.SecondaryManagerId
OUTER APPLY (
  SELECT COUNT(*) AS AllTasks,
         SUM(CASE WHEN o.StatusCode IS NOT NULL THEN 1 ELSE 0 END) AS OpenTasks,
         COUNT(DISTINCT k.AssignedUserId) AS Assignees
  FROM dbo.Task k LEFT JOIN @openStatuses o ON o.StatusCode = k.StatusCode
  WHERE k.MatterId = m.MatterId
) t
WHERE m.IsSensitive = 1
ORDER BY CASE WHEN m.PrimaryManagerId IS NULL AND m.SecondaryManagerId IS NULL THEN 0 ELSE 1 END, m.ClientNumber, m.MatterNumber;

-- 2. totals
SELECT
  COUNT(*) AS SensitiveMatters,
  SUM(CASE WHEN m.PrimaryManagerId IS NULL AND m.SecondaryManagerId IS NULL THEN 1 ELSE 0 END) AS WithoutManager,
  SUM(CASE WHEN m.PrimaryManagerId IS NOT NULL OR m.SecondaryManagerId IS NOT NULL THEN 1 ELSE 0 END) AS WithManager,
  (SELECT COUNT(*) FROM dbo.Task k JOIN dbo.Matter x ON x.MatterId = k.MatterId JOIN @openStatuses o ON o.StatusCode = k.StatusCode WHERE x.IsSensitive = 1) AS OpenTasksOnSensitiveMatters
FROM dbo.Matter m
WHERE m.IsSensitive = 1;

-- 3. who sees ALL sensitive matters
SELECT u.DisplayName, ISNULL(i.Username, '') AS Account, STRING_AGG(r.Name, ', ') AS Roles
FROM dbo.AppUser u
JOIN dbo.UserRole ur ON ur.UserId = u.UserId
JOIN dbo.Role r ON r.RoleId = ur.RoleId AND r.IsActive = 1
LEFT JOIN dbo.UserIdentity i ON i.UserId = u.UserId AND i.IsActive = 1
WHERE u.IsActive = 1
  AND (r.IsSystemAdmin = 1
       OR EXISTS (SELECT 1 FROM dbo.RolePermission rp JOIN dbo.Permission p ON p.PermissionId = rp.PermissionId
                  WHERE rp.RoleId = r.RoleId AND p.Code = 'Matter.ViewSensitive' AND p.IsActive = 1))
GROUP BY u.UserId, u.DisplayName, i.Username
ORDER BY u.DisplayName;

-- 4. people who will see only their own assigned tasks on sensitive matters
WITH Viewers AS (
  SELECT DISTINCT ur.UserId
  FROM dbo.UserRole ur
  JOIN dbo.Role r ON r.RoleId = ur.RoleId AND r.IsActive = 1
  WHERE r.IsSystemAdmin = 1
     OR EXISTS (SELECT 1 FROM dbo.RolePermission rp JOIN dbo.Permission p ON p.PermissionId = rp.PermissionId
                WHERE rp.RoleId = r.RoleId AND p.Code = 'Matter.ViewSensitive' AND p.IsActive = 1)
)
SELECT u.DisplayName, COUNT(*) AS TasksOnSensitiveMatters, COUNT(DISTINCT k.MatterId) AS SensitiveMatters
FROM dbo.Task k
JOIN dbo.Matter m ON m.MatterId = k.MatterId AND m.IsSensitive = 1
JOIN dbo.AppUser u ON u.UserId = k.AssignedUserId AND u.IsActive = 1
WHERE k.AssignedUserId NOT IN (SELECT UserId FROM Viewers)
  AND NOT EXISTS (SELECT 1 FROM dbo.Matter m2 WHERE m2.IsSensitive = 1 AND k.MatterId = m2.MatterId AND (m2.PrimaryManagerId = u.UserId OR m2.SecondaryManagerId = u.UserId))
GROUP BY u.UserId, u.DisplayName
ORDER BY COUNT(*) DESC, u.DisplayName;

-- 5. active people with Matter.View who see none of the sensitive matters (not a manager of one, not assigned a task on one, no ViewSensitive)
WITH ViewMatter AS (
  SELECT DISTINCT ur.UserId
  FROM dbo.UserRole ur
  JOIN dbo.Role r ON r.RoleId = ur.RoleId AND r.IsActive = 1
  WHERE r.IsSystemAdmin = 1
     OR EXISTS (SELECT 1 FROM dbo.RolePermission rp JOIN dbo.Permission p ON p.PermissionId = rp.PermissionId WHERE rp.RoleId = r.RoleId AND p.Code = 'Matter.View')
), Sees AS (
  SELECT DISTINCT ur.UserId
  FROM dbo.UserRole ur
  JOIN dbo.Role r ON r.RoleId = ur.RoleId AND r.IsActive = 1
  WHERE r.IsSystemAdmin = 1
     OR EXISTS (SELECT 1 FROM dbo.RolePermission rp JOIN dbo.Permission p ON p.PermissionId = rp.PermissionId WHERE rp.RoleId = r.RoleId AND p.Code = 'Matter.ViewSensitive')
  UNION SELECT PrimaryManagerId FROM dbo.Matter WHERE IsSensitive = 1 AND PrimaryManagerId IS NOT NULL
  UNION SELECT SecondaryManagerId FROM dbo.Matter WHERE IsSensitive = 1 AND SecondaryManagerId IS NOT NULL
  UNION SELECT k.AssignedUserId FROM dbo.Task k JOIN dbo.Matter m ON m.MatterId = k.MatterId WHERE m.IsSensitive = 1 AND k.AssignedUserId IS NOT NULL
)
SELECT COUNT(*) AS ActivePeopleWhoLoseSightOfEverySensitiveMatter
FROM dbo.AppUser u
WHERE u.IsActive = 1 AND u.UserId IN (SELECT UserId FROM ViewMatter) AND u.UserId NOT IN (SELECT UserId FROM Sees);
