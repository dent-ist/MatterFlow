-- Data quality: active people who hold a role but belong to no pod, and inactive people who still have open tasks assigned.
-- Names and counts only: no email, no task title, no matter name. Takes no parameters.
SELECT
    N'Active user with no pod'                                                  AS [Issue],
    u.DisplayName                                                               AS [User],
    (SELECT COUNT(*) FROM dbo.Task t
      WHERE t.AssignedUserId = u.UserId AND t.StatusCode IN ('NEW', 'IN_PROGRESS', 'ON_HOLD')) AS [Open tasks assigned]
FROM dbo.AppUser u
WHERE u.IsActive = 1
  AND EXISTS (SELECT 1 FROM dbo.UserRole ur WHERE ur.UserId = u.UserId)
  AND NOT EXISTS (SELECT 1 FROM dbo.PodMember pm WHERE pm.UserId = u.UserId)
UNION ALL
SELECT
    N'Inactive user with open tasks'                                            AS [Issue],
    u.DisplayName                                                               AS [User],
    COUNT(*)                                                                    AS [Open tasks assigned]
FROM dbo.AppUser u
JOIN dbo.Task t ON t.AssignedUserId = u.UserId AND t.StatusCode IN ('NEW', 'IN_PROGRESS', 'ON_HOLD')
WHERE u.IsActive = 0
GROUP BY u.UserId, u.DisplayName
ORDER BY [Issue], [User]
