-- 58-user-absence.sql
-- Purpose: Dashboard Calendar (epic #1074, issue #1075, decision AT): many Out of office entries per person. Replaces the single Out of office value
--   of dbo.UserAvailability (script 22) by dbo.UserAbsence and copies the existing value into it as the person's first entry.
-- Owner: Identity.
-- Notes:
--   * One row is one absence: whole calendar days in the person's own zone (floating dates). EndDate is the last day out of office (end inclusive);
--     NULL means "until I'm back" (open-ended, the header quick action). AbsenceType is VACATION, SICK, TRAINING, CONFERENCE or OTHER.
--   * There is no overlap constraint in SQL (SQL Server needs a trigger for it): the service refuses an overlap for one person in one transaction
--     (UPDLOCK on the person's rows) and answers 409 naming the other entry. A CHECK keeps EndDate on or after StartDate.
--   * The copy: every dbo.UserAvailability row with Status OUT_OF_OFFICE becomes one entry of type OTHER (the old value has no type): start = the from date,
--     else the date of the last update (never after the until date); end = the until date (NULL stays NULL); note; created and updated by = the old updater.
--     Idempotent: an entry that already exists for the same person with the same dates and note is not copied again, so the script can run twice.
--   * The old columns Status, OutOfOfficeFromDate, OutOfOfficeUntilDate and Note of dbo.UserAvailability stay in place and are no longer read or written
--     by the application; a later numbered script drops them (no destructive change in the same release).
--   * Grants: mf_app reads, inserts, updates and deletes. Type and note are personal data (Sick is health related): the report login is denied
--     (db/report-access.json, access = deny).
--   * RowVersion is the optimistic-concurrency token of one entry.

IF OBJECT_ID(N'dbo.UserAbsence', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.UserAbsence (
    AbsenceId       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_UserAbsence PRIMARY KEY,
    UserId          INT           NOT NULL,
    AbsenceType     VARCHAR(20)   NOT NULL,
    StartDate       DATE          NOT NULL,
    EndDate         DATE          NULL,
    Note            NVARCHAR(200) NULL,
    CreatedAtUtc    DATETIME2(3)  NOT NULL CONSTRAINT DF_UserAbsence_CreatedAt DEFAULT SYSUTCDATETIME(),
    CreatedByUserId INT           NULL,
    UpdatedAtUtc    DATETIME2(3)  NOT NULL CONSTRAINT DF_UserAbsence_UpdatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedByUserId INT           NULL,
    RowVersion      ROWVERSION    NOT NULL,
    CONSTRAINT FK_UserAbsence_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId),
    CONSTRAINT FK_UserAbsence_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
    CONSTRAINT FK_UserAbsence_UpdatedBy FOREIGN KEY (UpdatedByUserId) REFERENCES dbo.AppUser (UserId),
    CONSTRAINT CK_UserAbsence_Type CHECK (AbsenceType IN ('VACATION', 'SICK', 'TRAINING', 'CONFERENCE', 'OTHER')),
    CONSTRAINT CK_UserAbsence_Range CHECK (EndDate IS NULL OR EndDate >= StartDate)
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.UserAbsence') AND name = N'IX_UserAbsence_User')
  CREATE INDEX IX_UserAbsence_User ON dbo.UserAbsence (UserId, StartDate) INCLUDE (EndDate, AbsenceType);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.UserAbsence') AND name = N'IX_UserAbsence_Dates')
  CREATE INDEX IX_UserAbsence_Dates ON dbo.UserAbsence (StartDate, EndDate) INCLUDE (UserId, AbsenceType);
GO

INSERT dbo.UserAbsence (UserId, AbsenceType, StartDate, EndDate, Note, CreatedAtUtc, CreatedByUserId, UpdatedAtUtc, UpdatedByUserId)
SELECT a.UserId,
       'OTHER',
       COALESCE(a.OutOfOfficeFromDate,
                CASE WHEN a.OutOfOfficeUntilDate IS NOT NULL AND a.OutOfOfficeUntilDate < CAST(a.UpdatedAtUtc AS DATE)
                     THEN a.OutOfOfficeUntilDate ELSE CAST(a.UpdatedAtUtc AS DATE) END),
       a.OutOfOfficeUntilDate,
       a.Note,
       a.UpdatedAtUtc,
       a.UpdatedByUserId,
       a.UpdatedAtUtc,
       a.UpdatedByUserId
FROM dbo.UserAvailability a
WHERE a.Status = 'OUT_OF_OFFICE'
  AND NOT EXISTS (
    SELECT 1 FROM dbo.UserAbsence x
    WHERE x.UserId = a.UserId
      AND x.StartDate = COALESCE(a.OutOfOfficeFromDate,
                CASE WHEN a.OutOfOfficeUntilDate IS NOT NULL AND a.OutOfOfficeUntilDate < CAST(a.UpdatedAtUtc AS DATE)
                     THEN a.OutOfOfficeUntilDate ELSE CAST(a.UpdatedAtUtc AS DATE) END)
      AND ((x.EndDate IS NULL AND a.OutOfOfficeUntilDate IS NULL) OR x.EndDate = a.OutOfOfficeUntilDate)
      AND ((x.Note IS NULL AND a.Note IS NULL) OR x.Note = a.Note));
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.UserAbsence TO mf_app;
DENY ALTER ON dbo.UserAbsence TO mf_app;
GO

DENY SELECT, VIEW DEFINITION ON dbo.UserAbsence TO mf_report_reader;
GO
