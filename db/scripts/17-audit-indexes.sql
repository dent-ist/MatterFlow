-- 17-audit-indexes.sql
-- Purpose: supporting index for the admin audit browser (GET /api/v1/audit/search and /audit/facets).
-- Owner: Audit.
--
-- The browser lists newest first (AuditEventId DESC) and filters by object, actor, event type, correlation id and date range.
-- Object (IX_Audit_Object), actor (IX_Audit_Actor), correlation (IX_Audit_Correlation) and time (IX_Audit_Time) are already
-- covered by script 03; the event type filter and the distinct event-type list were not.

CREATE INDEX IX_Audit_EventType ON dbo.AuditEvent (EventType, AuditEventId);
GO
