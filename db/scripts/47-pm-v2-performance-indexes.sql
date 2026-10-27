-- 47-pm-v2-performance-indexes.sql
-- Purpose: PM v2 (epic #851, issue #887, PV-36). Two indexes the measured plans needed. (1) One covering index so that the Data tab, its volume chart and the asset reports read ONE field of the typed
--   index by a seek, whatever the value type: IX_CFI_Kind_Field_Owner (OwnerKind, FieldKey, OwnerId) INCLUDE (ValueNumber, ValueText).
-- Owner: Configuration (dbo.CustomFieldIndex); read by WorkViews (AssetAggregates, AssetVolumeService, AssetReportRunService).
-- Notes:
--   * Measured by MyMattersPerformanceTests at 100,000 assets and 200,000 index rows (docs/ux/pm-review/performance.md, "PM v2"): the aggregates ask for
--     "OwnerKind = ASSET and FieldKey = <the size field or the grouped field>" and join on OwnerId, without naming the form definition. The existing
--     IX_CFI_Number and IX_CFI_Text start with (OwnerKind, FormDefinitionId, FieldKey), so they could only be used on their OwnerKind prefix (every
--     asset value of every field), and a group by a SELECT field reads ValueText on a left join (every asset keeps its group, "(none)" included), which the
--     filtered IX_CFI_Text (ValueText IS NOT NULL) cannot serve: the plan read the whole clustered index (1,928 pages for a person with 2,500 assets).
--   * Not filtered: it serves the number and the text of one field, and a left join keeps working. Both value columns are included, so the join never
--     goes back to the clustered index. The existing indexes stay (the filters on the Assets list and the Task Queue use them).
--   * (2) IX_Task_Matter_Type (MatterId, TaskTypeId, StatusCode) INCLUDE (...): the Breakdown groups the tasks of the managed matters by matter and type, and the My Matters
--     sections and their strip counts now filter by task type. IX_Task_Matter (MatterId, StatusCode) does not carry TaskTypeId, so for a person with five matters
--     (2.5 percent of the tasks) the count with a type filter was planned as a scan of IX_Task_AssignedUser (every task of every assignee) instead of a seek per
--     managed matter. With the type in the key and the columns the counts read included (due date, assignee, status time, creation time for At risk, on-hold reason,
--     priority) the same reads are seeks on the managed matters. Not filtered: the Breakdown's average against the target also reads completed tasks.
--     Cost: about 60 bytes per task; every status, assignee, due-date or hold change of a task also writes this index, like IX_Task_Matter (script 33).
--   * Cost of (1): about 40 bytes per index row (the text values are short select options); an asset save rewrites its own rows anyway. Created online-safe for
--     a table of this size (a second or two at 200,000 rows); run the upgrade in the usual maintenance window.

CREATE INDEX IX_CFI_Kind_Field_Owner ON dbo.CustomFieldIndex (OwnerKind, FieldKey, OwnerId)
  INCLUDE (ValueNumber, ValueText);
GO

CREATE INDEX IX_Task_Matter_Type ON dbo.Task (MatterId, TaskTypeId, StatusCode)
  INCLUDE (DueDate, DueAtUtc, DueSortKey, AssignedUserId, AssignedPodId, StatusChangedAt, CreatedAt, OnHoldReasonId, PriorityId);
GO
