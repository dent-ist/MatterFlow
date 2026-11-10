-- Open tasks by assignee (workload). Counts only: no task title, no matter name.
-- Pod filters on the pod the task is assigned to. Unassigned tasks are one row when Include unassigned is Yes.
SELECT
    COALESCE(u.DisplayName, N'(Unassigned)')                                   AS [Assignee],
    SUM(CASE WHEN t.StatusCode = 'NEW' THEN 1 ELSE 0 END)                      AS [New],
    SUM(CASE WHEN t.StatusCode = 'IN_PROGRESS' THEN 1 ELSE 0 END)              AS [In progress],
    SUM(CASE WHEN t.StatusCode = 'ON_HOLD' THEN 1 ELSE 0 END)                  AS [On hold],
    COUNT(*)                                                                   AS [Open tasks],
    SUM(CASE WHEN t.DueDate < :TODAY THEN 1 ELSE 0 END)                        AS [Overdue],
    MIN(t.DueDate)                                                             AS [Earliest due date]
FROM dbo.Task t
LEFT JOIN dbo.AppUser u ON u.UserId = t.AssignedUserId
WHERE t.StatusCode IN ('NEW', 'IN_PROGRESS', 'ON_HOLD')
  AND (:POD IS NULL OR t.AssignedPodId = :POD)
  AND (:INCLUDE_UNASSIGNED = 1 OR t.AssignedUserId IS NOT NULL)
GROUP BY u.UserId, u.DisplayName
ORDER BY [Open tasks] DESC, [Assignee]
