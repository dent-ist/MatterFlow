-- 36-audit-sensitive-scope.sql
-- Purpose: Sensitive matter access control (epic #788, issue #801, package SM-13, owner question Q4). Stamps every audit event that was written while its
--   matter was sensitive, so the history of a sensitive period stays restricted to the matter's managers and the holders of Matter.ViewSensitive even after the
--   matter is un-marked (docs/ux/sensitive-matters/README.md sections 3 and 8). The application sets the stamp when it writes the event (and for the
--   MATTER_SENSITIVITY_CHANGED event itself); it never changes it afterwards.
-- Owner: Audit (written by the Data layer's audit interceptor).
-- Notes:
--   * A defaulted NOT NULL bit: existing rows get 0 (written before the stamp existed), a metadata-only change on SQL Server 2022. The append-only trigger
--     and the INSERT/SELECT grant of mf_app are table-level and cover the new column; mf_report_reader stays denied on the whole table (db/report-access.json).
--   * No new table, so db/report-access.json is unchanged. No index: the stamped rows are few and are read together with the matter predicate.
--   * Scripts are immutable once merged: a later change to the rule is a new script.

ALTER TABLE dbo.AuditEvent
  ADD IsSensitiveScope BIT NOT NULL CONSTRAINT DF_AuditEvent_IsSensitiveScope DEFAULT 0;
GO
