-- 49-matter-events.sql
-- Purpose: UI update epic #953, issue UI-05 (#958): calendar items of a matter (court hearing, deposition, filing deadline, ...). Adds dbo.MatterEvent.
--   Served by GET/POST /api/v1/matters/{id}/events, PUT/DELETE /api/v1/matter-events/{id} and the My Matters calendar and "Upcoming events".
-- Owner: Organization (the matter's module). Design: docs/ux/ui-update/api-contract.md section 2.
-- Notes:
--   * The eight event types are a fixed code list in the application (MatterEventTypes: COURT_HEARING, TRIAL, DEPOSITION, PRODUCTION_DEADLINE,
--     FILING_DEADLINE, MEDIATION, CLIENT_MEETING, OTHER); the CHECK repeats it so no code path can store another type. Icon and colour keys are code, not data.
--   * EventDate is a floating calendar date (DATE) and EventTime an optional wall-clock time (TIME(0), NULL = all day); neither carries a time zone,
--     like a task's DueDate. Past events are normal data, not an error.
--   * Who may write (Primary and Secondary PM of the matter, holders of Matter.Edit) and who may read (anyone who sees the matter) are application rules;
--     the sensitive-matter rule is applied in every read. No new permission. Reminders are out of scope: no reminder columns.
--   * Real DELETE (events are not business records that must survive); every create, change and delete is written to the audit log by the application.
--   * Nothing is backfilled (nobody uses the application yet). RowVersion is the optimistic-concurrency token.
--   * Grants: mf_app reads, inserts, updates and deletes. The report login is denied (db/report-access.json): calendar items are not report data and
--     a report must not read an event of a sensitive matter around the application rule.

CREATE TABLE dbo.MatterEvent (
  MatterEventId   INT            NOT NULL IDENTITY(1,1) CONSTRAINT PK_MatterEvent PRIMARY KEY,
  MatterId        INT            NOT NULL,
  EventTypeCode   VARCHAR(30)    NOT NULL,
  Title           NVARCHAR(200)  NOT NULL,
  EventDate       DATE           NOT NULL,
  EventTime       TIME(0)        NULL,
  Note            NVARCHAR(2000) NULL,
  CreatedAt       DATETIME2      NOT NULL CONSTRAINT DF_MatterEvent_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId INT            NULL,
  ModifiedAt      DATETIME2      NULL,
  ModifiedByUserId INT           NULL,
  RowVersion      ROWVERSION     NOT NULL,
  CONSTRAINT FK_MatterEvent_Matter FOREIGN KEY (MatterId) REFERENCES dbo.Matter (MatterId),
  CONSTRAINT FK_MatterEvent_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_MatterEvent_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT CK_MatterEvent_Type CHECK (EventTypeCode IN ('COURT_HEARING', 'TRIAL', 'DEPOSITION', 'PRODUCTION_DEADLINE', 'FILING_DEADLINE', 'MEDIATION', 'CLIENT_MEETING', 'OTHER')),
  CONSTRAINT CK_MatterEvent_Title CHECK (LEN(LTRIM(RTRIM(Title))) > 0)
);
GO

-- The calendar and Upcoming events read by date range (and by matter set); a matter's own list reads by matter.
CREATE INDEX IX_MatterEvent_Date ON dbo.MatterEvent (EventDate, MatterId) INCLUDE (EventTypeCode, EventTime);
CREATE INDEX IX_MatterEvent_Matter ON dbo.MatterEvent (MatterId, EventDate);
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.MatterEvent TO mf_app;
DENY ALTER ON dbo.MatterEvent TO mf_app;
GO

DENY SELECT, VIEW DEFINITION ON dbo.MatterEvent TO mf_report_reader;
GO
