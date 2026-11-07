-- Open and overdue tasks by matter, for Project Managers. LISTS MATTER NAMES. Open means New, In Progress or On Hold; overdue means the due date is before today (firm time zone).
-- Scope My matters = the matters where you are the primary or the secondary manager. Scope All matters needs the permission Matter.AssignManagers
-- (:CURRENT_USER_CAN_ASSIGN_MANAGERS); without it All shows your matters, never more.
-- A sensitive matter is listed only when you manage it, in either scope. Counts and names of matters only: no task titles or descriptions.
SELECT
    c.ClientNumber + N' ' + c.Name                                         AS [Client],
    m.MatterRef                                                            AS [Matter number],
    m.Name                                                                 AS [Matter],
    COALESCE(pm.DisplayName, N'(No manager)')                              AS [Primary manager],
    COUNT(*)                                                               AS [Open tasks],
    SUM(CASE WHEN t.DueDate < :TODAY THEN 1 ELSE 0 END)                    AS [Overdue tasks],
    MAX(CASE WHEN t.DueDate < :TODAY THEN DATEDIFF(day, t.DueDate, :TODAY) END) AS [Oldest overdue (days)]
FROM dbo.Task t
JOIN dbo.Matter m ON m.MatterId = t.MatterId
JOIN dbo.Client c ON c.ClientId = m.ClientId
LEFT JOIN dbo.AppUser pm ON pm.UserId = m.PrimaryManagerId
WHERE t.StatusCode IN ('NEW', 'IN_PROGRESS', 'ON_HOLD')
  AND (m.PrimaryManagerId = :CURRENT_USER_ID OR m.SecondaryManagerId = :CURRENT_USER_ID
       OR (:SCOPE = 'all' AND :CURRENT_USER_CAN_ASSIGN_MANAGERS = 1))
  AND (m.IsSensitive = 0 OR m.PrimaryManagerId = :CURRENT_USER_ID OR m.SecondaryManagerId = :CURRENT_USER_ID)
GROUP BY c.ClientNumber, c.Name, m.MatterRef, m.Name, pm.DisplayName
ORDER BY [Overdue tasks] DESC, [Client], [Matter number]
