-- Tasks per matter. LISTS MATTER NAMES. Sensitive matters are left out unless Include sensitive matters is Yes (empty means No).
-- The period applies to the date the task was created (UTC date).
SELECT
    c.ClientNumber + N' ' + c.Name                                         AS [Client],
    m.MatterRef                                                            AS [Matter number],
    m.Name                                                                 AS [Matter],
    SUM(CASE WHEN t.StatusCode IN ('NEW', 'IN_PROGRESS', 'ON_HOLD') THEN 1 ELSE 0 END) AS [Open tasks],
    SUM(CASE WHEN t.StatusCode = 'COMPLETED' THEN 1 ELSE 0 END)            AS [Completed tasks],
    SUM(CASE WHEN t.StatusCode = 'CANCELLED' THEN 1 ELSE 0 END)            AS [Cancelled tasks],
    COUNT(*)                                                               AS [All tasks]
FROM dbo.Task t
JOIN dbo.Matter m ON m.MatterId = t.MatterId
JOIN dbo.Client c ON c.ClientId = m.ClientId
WHERE t.CreatedAt >= :PERIOD_FROM
  AND t.CreatedAt < DATEADD(day, 1, :PERIOD_TO)
  AND (:CLIENT IS NULL OR m.ClientId = :CLIENT)
  AND (:INCLUDE_SENSITIVE = 1 OR m.IsSensitive = 0)
GROUP BY c.ClientNumber, c.Name, m.MatterRef, m.Name
ORDER BY [Client], [Matter number]
