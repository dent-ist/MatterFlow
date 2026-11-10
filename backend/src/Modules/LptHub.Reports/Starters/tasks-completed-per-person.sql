-- Tasks completed per person and task type. Counts only: no task title, no matter name.
-- The period applies to the completion date (UTC date). The person is the one the task is assigned to now.
-- An empty Task types selection means every type.
SELECT
    COALESCE(u.DisplayName, N'(Unassigned)')                                              AS [Person],
    tt.Name                                                                               AS [Task type],
    COUNT(*)                                                                              AS [Completed tasks],
    CAST(AVG(CAST(DATEDIFF(hour, t.CreatedAt, t.CompletedAt) AS decimal(18, 2))) / 24.0 AS decimal(18, 1)) AS [Average days to complete]
FROM dbo.Task t
JOIN dbo.TaskType tt ON tt.TaskTypeId = t.TaskTypeId
LEFT JOIN dbo.AppUser u ON u.UserId = t.AssignedUserId
WHERE t.StatusCode = 'COMPLETED'
  AND t.CompletedAt >= :PERIOD_FROM
  AND t.CompletedAt < DATEADD(day, 1, :PERIOD_TO)
  AND (NOT EXISTS (SELECT 1 FROM :TASK_TYPES) OR t.TaskTypeId IN :TASK_TYPES)
GROUP BY u.UserId, u.DisplayName, tt.TaskTypeId, tt.Name
ORDER BY [Person], [Task type]
