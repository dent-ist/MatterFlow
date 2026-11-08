-- 39-activity-seen-initial.sql
-- Purpose: PM experience follow-up #815. The first read of the Activity list creates the person's marker at the newest audit event (script 31:
--   nothing is unread on a first visit). "Since your last visit" read that marker as if the person had pressed Mark as read, so merely opening the
--   Activity tab (or the Recent activity panel) made it say "Nothing has changed". IsInitial tells the two apart: 1 = created by a first read
--   (a starting point for the "unread" dots only), 0 = the person marked activity as read (Mark as read, Mark all as read, opening an event).
-- Owner: WorkViews (read model of My Matters).
-- Notes:
--   * Existing rows get 0: they are explicit markers, which is what they were treated as until now.
--   * Table level GRANTs of script 31 cover the new column; the table stays denied for mf_report_reader (script 32). No new table.

ALTER TABLE dbo.UserMatterActivitySeen
  ADD IsInitial BIT NOT NULL CONSTRAINT DF_UserMatterActivitySeen_Initial DEFAULT 0;
GO
