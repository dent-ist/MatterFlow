-- 31-my-matters-activity-seen.sql
-- Purpose: Project Manager epic #667 (WP-PM2, issue #683). One row per person that remembers how far they have read the "Recent activity"
--   panel of My Matters: SeenAuditEventId is the highest AuditEvent id they have marked as read, SeenAtUtc is when they did it.
-- Owner: WorkViews (read model of My Matters).
-- Notes:
--   * The Notifications store (script 29) was checked and is NOT reused: it keeps one read flag per notification, while the activity panel is
--     derived from the audit log and needs a single per-person watermark ("everything up to here is read").
--   * Unread = AuditEventId greater than SeenAuditEventId. An event id is used instead of a time so the answer does not depend on two clocks.
--   * A missing row means "first visit": the application creates the row with the newest audit id at that moment, so nothing is unread on the
--     first visit and only later events become unread.
--   * The watermark only moves forward (the application takes the larger value). The row is derived state and is not audited.
--   * No index beyond the primary key is needed (the table is read and written by UserId only). Whether the activity query itself needs a
--     covering index on AuditEvent is decided by measurement (issue #686) and would be a later script.
--   * Grants: mf_app reads, inserts and updates the two value columns; the DELETE of 13-security-hardening.sql is not needed.

CREATE TABLE dbo.UserMatterActivitySeen (
  UserId           INT          NOT NULL,
  SeenAuditEventId BIGINT       NOT NULL CONSTRAINT DF_UserMatterActivitySeen_Event DEFAULT 0,
  SeenAtUtc        DATETIME2(3) NOT NULL CONSTRAINT DF_UserMatterActivitySeen_At DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_UserMatterActivitySeen PRIMARY KEY (UserId),
  CONSTRAINT FK_UserMatterActivitySeen_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT CK_UserMatterActivitySeen_Event CHECK (SeenAuditEventId >= 0)
);
GO

GRANT SELECT, INSERT, UPDATE ON dbo.UserMatterActivitySeen TO mf_app;
DENY DELETE, ALTER ON dbo.UserMatterActivitySeen TO mf_app;
GO
