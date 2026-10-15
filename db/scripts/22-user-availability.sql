-- 22-user-availability.sql
-- Purpose: per-user availability (Available / Out of office) and weekly work hours, so the Dashboard Users tab, the Admin Users list and the
--   assignee pickers can show who can take work (epic #68, issue #69). Operational capacity only, never a performance measure.
-- Owner: Identity.
-- Notes:
--   * dbo.UserAvailability has at most one row per user; no row means "Available, default work hours, firm time zone".
--     Out of office with no dates lasts until the user sets Available again; with dates it runs from the start of OutOfOfficeFromDate
--     (or now when null) to the end of OutOfOfficeUntilDate in the user's zone. TimeZoneId is an IANA id; NULL falls back to Firm:TimeZoneId.
--   * HasCustomWorkHours = 0: the schedule is the default Mon-Fri 09:00-17:00 and dbo.UserWorkHour holds no rows for the user.
--     HasCustomWorkHours = 1: dbo.UserWorkHour holds one row per working day; a weekday without a row is a non-working day
--     (so a saved schedule with no rows means "no working days").
--   * DayOfWeek is ISO: 1 = Monday ... 7 = Sunday.
--   * RowVersion is the optimistic-concurrency token of the availability edit (workHours rows are replaced together with the parent row).

CREATE TABLE dbo.UserAvailability (
  UserId               INT           NOT NULL CONSTRAINT PK_UserAvailability PRIMARY KEY,
  Status               VARCHAR(20)   NOT NULL CONSTRAINT DF_UserAvailability_Status DEFAULT 'AVAILABLE',
  OutOfOfficeFromDate  DATE          NULL,
  OutOfOfficeUntilDate DATE          NULL,
  Note                 NVARCHAR(200) NULL,
  TimeZoneId           VARCHAR(64)   NULL,
  HasCustomWorkHours   BIT           NOT NULL CONSTRAINT DF_UserAvailability_HasCustomWorkHours DEFAULT 0,
  UpdatedAtUtc         DATETIME2     NOT NULL CONSTRAINT DF_UserAvailability_UpdatedAt DEFAULT SYSUTCDATETIME(),
  UpdatedByUserId      INT           NULL,
  RowVersion           ROWVERSION    NOT NULL,
  CONSTRAINT FK_UserAvailability_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_UserAvailability_UpdatedBy FOREIGN KEY (UpdatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT CK_UserAvailability_Status CHECK (Status IN ('AVAILABLE', 'OUT_OF_OFFICE')),
  CONSTRAINT CK_UserAvailability_Range CHECK (OutOfOfficeUntilDate IS NULL OR OutOfOfficeFromDate IS NULL OR OutOfOfficeUntilDate >= OutOfOfficeFromDate)
);
GO

CREATE INDEX IX_UserAvailability_Status ON dbo.UserAvailability (Status) INCLUDE (OutOfOfficeFromDate, OutOfOfficeUntilDate);
GO

CREATE TABLE dbo.UserWorkHour (
  UserId    INT     NOT NULL,
  DayOfWeek TINYINT NOT NULL,
  StartTime TIME(0) NOT NULL,
  EndTime   TIME(0) NOT NULL,
  CONSTRAINT PK_UserWorkHour PRIMARY KEY (UserId, DayOfWeek),
  CONSTRAINT FK_UserWorkHour_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT CK_UserWorkHour_Day CHECK (DayOfWeek BETWEEN 1 AND 7),
  CONSTRAINT CK_UserWorkHour_Range CHECK (EndTime > StartTime)
);
GO
