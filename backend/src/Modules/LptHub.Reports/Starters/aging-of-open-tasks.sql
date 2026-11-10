-- Aging of open tasks: days since the task was created, by pod. Counts only: no task title, no matter name.
-- An empty Pods selection means every pod (and tasks with no pod).
SELECT
    COALESCE(p.Name, N'(No pod)')                                                            AS [Pod],
    SUM(CASE WHEN a.AgeDays <= 7 THEN 1 ELSE 0 END)                                          AS [0 to 7 days],
    SUM(CASE WHEN a.AgeDays BETWEEN 8 AND 30 THEN 1 ELSE 0 END)                              AS [8 to 30 days],
    SUM(CASE WHEN a.AgeDays BETWEEN 31 AND 90 THEN 1 ELSE 0 END)                             AS [31 to 90 days],
    SUM(CASE WHEN a.AgeDays > 90 THEN 1 ELSE 0 END)                                          AS [Over 90 days],
    COUNT(*)                                                                                 AS [Open tasks]
FROM dbo.Task t
LEFT JOIN dbo.Pod p ON p.PodId = t.AssignedPodId
CROSS APPLY (SELECT DATEDIFF(day, CAST(t.CreatedAt AS date), :TODAY) AS AgeDays) a
WHERE t.StatusCode IN ('NEW', 'IN_PROGRESS', 'ON_HOLD')
  AND (NOT EXISTS (SELECT 1 FROM :PODS) OR t.AssignedPodId IN :PODS)
GROUP BY p.PodId, p.Name
ORDER BY [Pod]
