-- 59-holiday-calendars.sql
-- Purpose: Dashboard Calendar (epic #1074, issue #1075, decision AT): holiday calendars with rules, and the calendar of each person and pod.
-- Owner: Identity (holiday area).
-- Notes:
--   * Holidays are stored as RULES and expanded for any year by one pure function in code (no rows per year): FIXED (month and day), NTH_WEEKDAY
--     (the Nth weekday of a month, Nth 1 to 4 or -1 for the last, plus PlusDays), EASTER_OFFSET (days from Easter Sunday, Good Friday is -2),
--     ONCE (one day, OnceDate) and RANGE (from Month/Day to RangeEndMonth/RangeEndDay every year when Yearly = 1, otherwise from OnceDate to RangeEndDate once).
--     Weekday is the .NET and JavaScript number: 0 = Sunday ... 6 = Saturday. WeekendRule moves a holiday that falls on a weekend: NONE, US (Saturday to
--     Friday, Sunday to Monday) or UK (Saturday and Sunday to Monday, the next free weekday when taken).
--   * dbo.HolidayCalendar.AppliesToEveryone = 1 makes a firm closure calendar: its holidays apply to everybody, whatever their own calendar.
--     A person has one calendar (AppUser.HolidayCalendarId); NULL means the default of the person's pod (Pod.DefaultHolidayCalendarId, the pod with the
--     lowest id when the person is in several), then the firm calendar (AppSetting key Calendar.FirmHolidayCalendarId).
--   * AppSetting keys, read with defaults in code and written by the settings endpoints (no seed row, same as script 48): Calendar.Thresholds (one JSON value:
--     minimum coverage percent, default 75; pod minimum percent, default 60; optional per-pod minimum people) and Calendar.FirmHolidayCalendarId (the firm calendar).
--   * A calendar that a person, a pod or the firm setting uses is not deleted (the service answers 409; deactivate it instead); an unused calendar is deleted with its holidays.
--   * Holiday names and dates are not personal data: the report login may read both tables (db/report-access.json, access = allow).

IF OBJECT_ID(N'dbo.HolidayCalendar', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.HolidayCalendar (
    CalendarId        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_HolidayCalendar PRIMARY KEY,
    Name              NVARCHAR(100) NOT NULL,
    ColourKey         VARCHAR(20)   NOT NULL CONSTRAINT DF_HolidayCalendar_Colour DEFAULT 'slate',
    RegionNote        NVARCHAR(200) NULL,
    AppliesToEveryone BIT           NOT NULL CONSTRAINT DF_HolidayCalendar_Everyone DEFAULT 0,
    SortOrder         INT           NOT NULL CONSTRAINT DF_HolidayCalendar_Sort DEFAULT 0,
    IsActive          BIT           NOT NULL CONSTRAINT DF_HolidayCalendar_IsActive DEFAULT 1,
    CreatedAt         DATETIME2     NOT NULL CONSTRAINT DF_HolidayCalendar_CreatedAt DEFAULT SYSUTCDATETIME(),
    CreatedByUserId   INT           NULL,
    ModifiedAt        DATETIME2     NULL,
    ModifiedByUserId  INT           NULL,
    RowVersion        ROWVERSION    NOT NULL,
    CONSTRAINT UQ_HolidayCalendar_Name UNIQUE (Name),
    CONSTRAINT FK_HolidayCalendar_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
    CONSTRAINT FK_HolidayCalendar_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
    CONSTRAINT CK_HolidayCalendar_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0)
  );
END
GO

IF OBJECT_ID(N'dbo.Holiday', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Holiday (
    HolidayId        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Holiday PRIMARY KEY,
    CalendarId       INT           NOT NULL,
    Name             NVARCHAR(100) NOT NULL,
    RuleKind         VARCHAR(20)   NOT NULL,
    Month            TINYINT       NULL,
    Day              TINYINT       NULL,
    Nth              SMALLINT      NULL,
    Weekday          TINYINT       NULL,
    PlusDays         TINYINT       NOT NULL CONSTRAINT DF_Holiday_PlusDays DEFAULT 0,
    EasterOffset     SMALLINT      NULL,
    OnceDate         DATE          NULL,
    RangeEndMonth    TINYINT       NULL,
    RangeEndDay      TINYINT       NULL,
    RangeEndDate     DATE          NULL,
    Yearly           BIT           NOT NULL CONSTRAINT DF_Holiday_Yearly DEFAULT 1,
    WeekendRule      VARCHAR(10)   NOT NULL CONSTRAINT DF_Holiday_WeekendRule DEFAULT 'NONE',
    RegionNote       NVARCHAR(200) NULL,
    CreatedAt        DATETIME2     NOT NULL CONSTRAINT DF_Holiday_CreatedAt DEFAULT SYSUTCDATETIME(),
    CreatedByUserId  INT           NULL,
    ModifiedAt       DATETIME2     NULL,
    ModifiedByUserId INT           NULL,
    RowVersion       ROWVERSION    NOT NULL,
    CONSTRAINT FK_Holiday_Calendar FOREIGN KEY (CalendarId) REFERENCES dbo.HolidayCalendar (CalendarId),
    CONSTRAINT FK_Holiday_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
    CONSTRAINT FK_Holiday_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
    CONSTRAINT CK_Holiday_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
    CONSTRAINT CK_Holiday_RuleKind CHECK (RuleKind IN ('FIXED', 'NTH_WEEKDAY', 'EASTER_OFFSET', 'ONCE', 'RANGE')),
    CONSTRAINT CK_Holiday_WeekendRule CHECK (WeekendRule IN ('NONE', 'US', 'UK')),
    CONSTRAINT CK_Holiday_Month CHECK (Month IS NULL OR Month BETWEEN 1 AND 12),
    CONSTRAINT CK_Holiday_Day CHECK (Day IS NULL OR Day BETWEEN 1 AND 31),
    CONSTRAINT CK_Holiday_RangeEnd CHECK ((RangeEndMonth IS NULL OR RangeEndMonth BETWEEN 1 AND 12) AND (RangeEndDay IS NULL OR RangeEndDay BETWEEN 1 AND 31)),
    CONSTRAINT CK_Holiday_Nth CHECK (Nth IS NULL OR Nth IN (-1, 1, 2, 3, 4)),
    CONSTRAINT CK_Holiday_Weekday CHECK (Weekday IS NULL OR Weekday BETWEEN 0 AND 6),
    CONSTRAINT CK_Holiday_PlusDays CHECK (PlusDays BETWEEN 0 AND 6),
    CONSTRAINT CK_Holiday_OnceRange CHECK (RangeEndDate IS NULL OR OnceDate IS NULL OR RangeEndDate >= OnceDate),
    CONSTRAINT CK_Holiday_Fields CHECK (
         (RuleKind = 'FIXED'         AND Month IS NOT NULL AND Day IS NOT NULL)
      OR (RuleKind = 'NTH_WEEKDAY'   AND Month IS NOT NULL AND Nth IS NOT NULL AND Weekday IS NOT NULL)
      OR (RuleKind = 'EASTER_OFFSET' AND EasterOffset IS NOT NULL)
      OR (RuleKind = 'ONCE'          AND OnceDate IS NOT NULL)
      OR (RuleKind = 'RANGE'         AND ((Yearly = 1 AND Month IS NOT NULL AND Day IS NOT NULL AND RangeEndMonth IS NOT NULL AND RangeEndDay IS NOT NULL)
                                       OR (Yearly = 0 AND OnceDate IS NOT NULL AND RangeEndDate IS NOT NULL))))
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.Holiday') AND name = N'IX_Holiday_Calendar')
  CREATE INDEX IX_Holiday_Calendar ON dbo.Holiday (CalendarId, HolidayId);
GO

IF COL_LENGTH('dbo.AppUser', 'HolidayCalendarId') IS NULL
  ALTER TABLE dbo.AppUser ADD HolidayCalendarId INT NULL CONSTRAINT FK_AppUser_HolidayCalendar FOREIGN KEY REFERENCES dbo.HolidayCalendar (CalendarId);
GO

IF COL_LENGTH('dbo.Pod', 'DefaultHolidayCalendarId') IS NULL
  ALTER TABLE dbo.Pod ADD DefaultHolidayCalendarId INT NULL CONSTRAINT FK_Pod_DefaultHolidayCalendar FOREIGN KEY REFERENCES dbo.HolidayCalendar (CalendarId);
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.HolidayCalendar TO mf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Holiday TO mf_app;
DENY ALTER ON dbo.HolidayCalendar TO mf_app;
DENY ALTER ON dbo.Holiday TO mf_app;
GO

GRANT SELECT ON dbo.HolidayCalendar TO mf_report_reader;
GRANT SELECT ON dbo.Holiday TO mf_report_reader;
GO
