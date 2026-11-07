-- Tasks created per week and task type. Counts only: no task title, no matter name.
-- A week starts on Monday (1900-01-01 was a Monday, so this does not depend on the server's DATEFIRST). The period is on the creation date (UTC date).
SELECT
    w.WeekStart                                      AS [Week starting],
    tt.Name                                          AS [Task type],
    COUNT(*)                                         AS [Tasks created]
FROM dbo.Task t
JOIN dbo.TaskType tt ON tt.TaskTypeId = t.TaskTypeId
CROSS APPLY (SELECT DATEADD(day, -(DATEDIFF(day, '19000101', CAST(t.CreatedAt AS date)) % 7), CAST(t.CreatedAt AS date)) AS WeekStart) w
WHERE t.CreatedAt >= :PERIOD_FROM
  AND t.CreatedAt < DATEADD(day, 1, :PERIOD_TO)
GROUP BY w.WeekStart, tt.TaskTypeId, tt.Name
ORDER BY [Week starting], [Task type]
