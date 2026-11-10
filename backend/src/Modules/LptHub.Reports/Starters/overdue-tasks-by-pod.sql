-- Overdue tasks by pod. Open means New, In Progress or On Hold; overdue means the due date is before today (firm time zone).
-- Counts only: no task title, no matter name. An empty Pods selection means every pod (and tasks with no pod).
SELECT
    COALESCE(p.Name, N'(No pod)')                    AS [Pod],
    pr.Label                                         AS [Priority],
    COUNT(*)                                         AS [Overdue tasks],
    MIN(t.DueDate)                                   AS [Oldest due date],
    MAX(DATEDIFF(day, t.DueDate, :TODAY))            AS [Most days overdue]
FROM dbo.Task t
JOIN dbo.Priority pr ON pr.PriorityId = t.PriorityId
LEFT JOIN dbo.Pod p ON p.PodId = t.AssignedPodId
WHERE t.StatusCode IN ('NEW', 'IN_PROGRESS', 'ON_HOLD')
  AND t.DueDate < :TODAY
  AND (NOT EXISTS (SELECT 1 FROM :PODS) OR t.AssignedPodId IN :PODS)
GROUP BY p.Name, pr.Label, pr.SortOrder
ORDER BY [Pod], pr.SortOrder
