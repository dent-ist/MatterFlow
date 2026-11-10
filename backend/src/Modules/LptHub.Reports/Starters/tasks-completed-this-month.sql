-- Tasks completed this month, by matter and person, for Project Managers. LISTS MATTER NAMES. The period applies to the completion date (UTC date) and starts as this month.
-- The person is the one the task is assigned to now. Scope My matters = the matters where you are the primary or the secondary manager. Scope All matters needs
-- the permission Matter.AssignManagers (:CURRENT_USER_CAN_ASSIGN_MANAGERS); without it All shows your matters, never more.
-- A sensitive matter is listed only when you manage it, in either scope. Counts and names only: no task titles or descriptions.
SELECT
    m.MatterRef                                                            AS [Matter number],
    m.Name                                                                 AS [Matter],
    COALESCE(u.DisplayName, N'(Unassigned)')                               AS [Person],
    COUNT(*)                                                               AS [Completed tasks]
FROM dbo.Task t
JOIN dbo.Matter m ON m.MatterId = t.MatterId
LEFT JOIN dbo.AppUser u ON u.UserId = t.AssignedUserId
WHERE t.StatusCode = 'COMPLETED'
  AND t.CompletedAt >= :PERIOD_FROM
  AND t.CompletedAt < DATEADD(day, 1, :PERIOD_TO)
  AND (m.PrimaryManagerId = :CURRENT_USER_ID OR m.SecondaryManagerId = :CURRENT_USER_ID
       OR (:SCOPE = 'all' AND :CURRENT_USER_CAN_ASSIGN_MANAGERS = 1))
  AND (m.IsSensitive = 0 OR m.PrimaryManagerId = :CURRENT_USER_ID OR m.SecondaryManagerId = :CURRENT_USER_ID)
GROUP BY m.MatterRef, m.Name, u.UserId, u.DisplayName
ORDER BY [Matter number], [Person]
