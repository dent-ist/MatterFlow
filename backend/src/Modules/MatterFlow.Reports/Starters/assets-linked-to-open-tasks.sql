-- Assets linked to open tasks, with the asset's disposition. LISTS MATTER NAMES. Sensitive matters are left out unless Include sensitive matters is Yes
-- (empty means No). No task title is listed: the task is shown by its number and status. An empty Asset types selection means every type.
SELECT
    a.DisplayName                                                               AS [Asset],
    aty.Name                                                                     AS [Asset type],
    CASE a.DispositionCode
        WHEN 'ACTIVE' THEN N'Active'
        WHEN 'INACTIVE' THEN N'Inactive'
        WHEN 'PENDING_DISPOSITION' THEN N'Pending disposition'
        WHEN 'DISPOSED' THEN N'Disposed'
        ELSE a.DispositionCode
    END                                                                         AS [Disposition],
    t.TaskNumber                                                                AS [Task number],
    s.DisplayLabel                                                              AS [Task status],
    m.MatterRef                                                                 AS [Matter number],
    m.Name                                                                      AS [Matter]
FROM dbo.TaskAsset ta
JOIN dbo.Task t ON t.TaskId = ta.TaskId
JOIN dbo.TaskStatusLabel s ON s.StatusCode = t.StatusCode
JOIN dbo.Asset a ON a.AssetId = ta.AssetId
JOIN dbo.AssetType aty ON aty.AssetTypeId = a.AssetTypeId
JOIN dbo.Matter m ON m.MatterId = t.MatterId
WHERE t.StatusCode IN ('NEW', 'IN_PROGRESS', 'ON_HOLD')
  AND (NOT EXISTS (SELECT 1 FROM :ASSET_TYPES) OR a.AssetTypeId IN :ASSET_TYPES)
  AND (:INCLUDE_SENSITIVE = 1 OR m.IsSensitive = 0)
ORDER BY m.MatterRef, t.TaskNumber, a.DisplayName
