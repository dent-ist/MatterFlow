-- 32-report-access-activity-seen.sql
-- Purpose: Reports epic #671 (issue #677 follow-up). Script 31 added dbo.UserMatterActivitySeen after script 30 classified the tables for the
--   report login, and the access catalogue test (db/report-access.json) requires every table to be a conscious allow/deny decision.
--   The table is per-person read-marker bookkeeping of the My Matters panel, not report data, so the role mf_report_reader is denied.
-- Owner: Reports.

DENY SELECT, VIEW DEFINITION ON dbo.UserMatterActivitySeen TO mf_report_reader;
GO
