-- 00-baseline.sql
-- Purpose: the complete MatterFlow database schema in one script (issue #1307). It replaces the 63 incremental scripts 01 to 66 (16, 61 and 62 never
--   existed), which are kept for history in db/scripts/archive/ and are NOT run by the application any more.
-- Owner: Platform.
--
-- How it fits the runner (docs/architecture.md section 4, db/scripts/README.md):
--   * The baseline has prefix 0, so it is always applied first. Every later script has a prefix of 67 or more (the first new script is 67).
--   * A database created before the baseline (its dbo.SchemaMigration lists 01-init.sql and the other old scripts but not 00-baseline.sql) is
--     refused at startup with the instruction to rebuild it (npm run db:reset). There is no data migration: MatterFlow had not been deployed.
--   * The baseline is immutable from the first real deployment on, like every other applied script. Until then it may only change together with
--     a rebuild of every demo and test database; after that, schema changes are new numbered scripts (67 and up).
--   * dbo.SchemaMigration (the runner's own journal) is created by the runner before any script, so it is not created here.
--
-- Content: sequence, tables (columns in the order the old chain produced, so a database built from the baseline is identical to one built from the
--   old scripts), constraints, indexes, functions, procedures, triggers (including the database DDL trigger that protects the audit tables), the
--   structural seed rows, the database roles and every GRANT / DENY. The equivalence of the two routes is a test: SchemaTests/BaselineEquivalenceTests.
--
-- Carried over deliberately from the old chain:
--   * Seed rows: dbo.Role (System Admin), dbo.Permission (the 25 rows the scripts inserted), dbo.TaskStatusLabel (5 fixed labels).
--   * Roles mf_app, mf_migrator, mf_report_reader and all their permissions, the TaskNumberSeq sequence, TR_Asset_Guard (with the asset number rule).
-- Dropped deliberately (they only changed data that exists in a database that was already running):
--   * Backfills and data fixes: copying LastLoginAt to UserIdentity, default activity markers, matter sensitivity propagation to tasks, asset
--     disposition and calendar backfills, brand-icon retirement, task type colour defaults.
--   * Grants of permissions to the starter roles in existing databases (scripts 24, 25, 27, 28, 38, 46, 60, 65, 66). A fresh database gets the
--     starter roles with their permissions from StarterRoles.cs at the first start.

GO

-- -----------------------------------------------------------------------------------------------------------------------------
-- Sequence
-- -----------------------------------------------------------------------------------------------------------------------------

CREATE SEQUENCE dbo.TaskNumberSeq AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE;
GO

-- -----------------------------------------------------------------------------------------------------------------------------
-- Tables, with their constraints and indexes
-- -----------------------------------------------------------------------------------------------------------------------------

-- === Identity, authorization and availability ==============================================================================

-- AppUser: A person known to the system, created at first sign-in (just-in-time).
CREATE TABLE dbo.AppUser (
  UserId             INT IDENTITY(1,1) NOT NULL,
  DisplayName        NVARCHAR(200) NOT NULL,
  Email              NVARCHAR(320) NULL,
  IsActive           BIT NOT NULL CONSTRAINT DF_AppUser_IsActive DEFAULT 1,
  BootstrapAppliedAt DATETIME2 NULL,
  LastLoginAt        DATETIME2 NULL,
  CreatedAt          DATETIME2 NOT NULL CONSTRAINT DF_AppUser_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId    INT NULL,
  ModifiedAt         DATETIME2 NULL,
  ModifiedByUserId   INT NULL,
  RowVersion         ROWVERSION NOT NULL,
  HolidayCalendarId  INT NULL,
  CONSTRAINT PK_AppUser PRIMARY KEY (UserId),
  CONSTRAINT FK_AppUser_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_AppUser_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_AppUser_Display ON dbo.AppUser (DisplayName);
GO

-- UserIdentity: How a person signs in: provider (Windows, Dev, Entra), tenant, subject, username, last login.
CREATE TABLE dbo.UserIdentity (
  UserIdentityId   INT IDENTITY(1,1) NOT NULL,
  UserId           INT NOT NULL,
  Provider         VARCHAR(20) NOT NULL,
  TenantId         VARCHAR(64) NOT NULL CONSTRAINT DF_UserIdentity_TenantId DEFAULT '',
  ProviderSubject  NVARCHAR(200) NOT NULL,
  Username         NVARCHAR(256) NOT NULL,
  IsActive         BIT NOT NULL CONSTRAINT DF_UserIdentity_IsActive DEFAULT 1,
  VerifiedAt       DATETIME2 NULL,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_UserIdentity_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  LastLoginAt      DATETIME2 NULL,
  CONSTRAINT PK_UserIdentity PRIMARY KEY (UserIdentityId),
  CONSTRAINT UQ_UserIdentity_Provider UNIQUE (Provider, TenantId, ProviderSubject),
  CONSTRAINT CK_UserIdentity_Provider CHECK (Provider IN ('Windows', 'Dev', 'Entra')),
  CONSTRAINT FK_UserIdentity_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_UserIdentity_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_UserIdentity_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_UserIdentity_User ON dbo.UserIdentity (UserId);
CREATE INDEX IX_UserIdentity_Username ON dbo.UserIdentity (Username);
GO

-- Role: A named set of permissions.
CREATE TABLE dbo.Role (
  RoleId           INT IDENTITY(1,1) NOT NULL,
  Name             NVARCHAR(100) NOT NULL,
  Description      NVARCHAR(500) NULL,
  IsSystemAdmin    BIT NOT NULL CONSTRAINT DF_Role_IsSystemAdmin DEFAULT 0,
  IsActive         BIT NOT NULL CONSTRAINT DF_Role_IsActive DEFAULT 1,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_Role_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_Role PRIMARY KEY (RoleId),
  CONSTRAINT UQ_Role_Name UNIQUE (Name),
  CONSTRAINT FK_Role_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Role_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE UNIQUE INDEX UQ_Role_SystemAdmin ON dbo.Role (IsSystemAdmin) WHERE ([IsSystemAdmin]=(1));
GO

-- Permission: The permission catalog, synced from contracts/permissions.json at startup.
CREATE TABLE dbo.Permission (
  PermissionId INT IDENTITY(1,1) NOT NULL,
  Code         VARCHAR(64) NOT NULL,
  GroupName    VARCHAR(40) NOT NULL,
  Description  NVARCHAR(300) NOT NULL,
  IsActive     BIT NOT NULL CONSTRAINT DF_Permission_IsActive DEFAULT 1,
  CONSTRAINT PK_Permission PRIMARY KEY (PermissionId),
  CONSTRAINT UQ_Permission_Code UNIQUE (Code)
);
GO

-- RolePermission: Junction: permissions of a role.
CREATE TABLE dbo.RolePermission (
  RoleId       INT NOT NULL,
  PermissionId INT NOT NULL,
  CONSTRAINT PK_RolePermission PRIMARY KEY (RoleId, PermissionId),
  CONSTRAINT FK_RolePermission_Role FOREIGN KEY (RoleId) REFERENCES dbo.Role (RoleId),
  CONSTRAINT FK_RolePermission_Permission FOREIGN KEY (PermissionId) REFERENCES dbo.Permission (PermissionId)
);
GO

CREATE INDEX IX_RolePermission_Permission ON dbo.RolePermission (PermissionId);
GO

-- UserRole: Junction: roles of a user, with who granted and when.
CREATE TABLE dbo.UserRole (
  UserId          INT NOT NULL,
  RoleId          INT NOT NULL,
  GrantedAt       DATETIME2 NOT NULL CONSTRAINT DF_UserRole_GrantedAt DEFAULT SYSUTCDATETIME(),
  GrantedByUserId INT NULL,
  CONSTRAINT PK_UserRole PRIMARY KEY (UserId, RoleId),
  CONSTRAINT FK_UserRole_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_UserRole_Role FOREIGN KEY (RoleId) REFERENCES dbo.Role (RoleId),
  CONSTRAINT FK_UserRole_GrantedBy FOREIGN KEY (GrantedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_UserRole_Role ON dbo.UserRole (RoleId);
GO

-- SeedMarker: Bookkeeping so a one-time seed (for example the starter roles) runs exactly once.
CREATE TABLE dbo.SeedMarker (
  Name      VARCHAR(100) NOT NULL,
  AppliedAt DATETIME2 NOT NULL CONSTRAINT DF_SeedMarker_AppliedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_SeedMarker PRIMARY KEY (Name)
);
GO

-- UserAvailability: Per-person availability profile: time zone and whether custom work hours exist.
CREATE TABLE dbo.UserAvailability (
  UserId               INT NOT NULL,
  Status               VARCHAR(20) NOT NULL CONSTRAINT DF_UserAvailability_Status DEFAULT 'AVAILABLE',
  OutOfOfficeFromDate  DATE NULL,
  OutOfOfficeUntilDate DATE NULL,
  Note                 NVARCHAR(200) NULL,
  TimeZoneId           VARCHAR(64) NULL,
  HasCustomWorkHours   BIT NOT NULL CONSTRAINT DF_UserAvailability_HasCustomWorkHours DEFAULT 0,
  UpdatedAtUtc         DATETIME2 NOT NULL CONSTRAINT DF_UserAvailability_UpdatedAt DEFAULT SYSUTCDATETIME(),
  UpdatedByUserId      INT NULL,
  RowVersion           ROWVERSION NOT NULL,
  CONSTRAINT PK_UserAvailability PRIMARY KEY (UserId),
  CONSTRAINT CK_UserAvailability_Status CHECK (Status IN ('AVAILABLE', 'OUT_OF_OFFICE')),
  CONSTRAINT CK_UserAvailability_Range CHECK (OutOfOfficeUntilDate IS NULL OR OutOfOfficeFromDate IS NULL OR OutOfOfficeUntilDate >= OutOfOfficeFromDate),
  CONSTRAINT FK_UserAvailability_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_UserAvailability_UpdatedBy FOREIGN KEY (UpdatedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_UserAvailability_Status ON dbo.UserAvailability (Status) INCLUDE (OutOfOfficeFromDate, OutOfOfficeUntilDate);
GO

-- UserWorkHour: Weekly work hours of a person (ISO weekday 1 to 7, start and end time).
CREATE TABLE dbo.UserWorkHour (
  UserId    INT NOT NULL,
  DayOfWeek TINYINT NOT NULL,
  StartTime TIME(0) NOT NULL,
  EndTime   TIME(0) NOT NULL,
  CONSTRAINT PK_UserWorkHour PRIMARY KEY (UserId, DayOfWeek),
  CONSTRAINT CK_UserWorkHour_Day CHECK (DayOfWeek BETWEEN 1 AND 7),
  CONSTRAINT CK_UserWorkHour_Range CHECK (EndTime > StartTime),
  CONSTRAINT FK_UserWorkHour_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId)
);
GO

-- UserAbsence: An Out of office entry of a person (vacation, sick, training, conference, other), whole days, end optional.
CREATE TABLE dbo.UserAbsence (
  AbsenceId       INT IDENTITY(1,1) NOT NULL,
  UserId          INT NOT NULL,
  AbsenceType     VARCHAR(20) NOT NULL,
  StartDate       DATE NOT NULL,
  EndDate         DATE NULL,
  Note            NVARCHAR(200) NULL,
  CreatedAtUtc    DATETIME2(3) NOT NULL CONSTRAINT DF_UserAbsence_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId INT NULL,
  UpdatedAtUtc    DATETIME2(3) NOT NULL CONSTRAINT DF_UserAbsence_UpdatedAt DEFAULT SYSUTCDATETIME(),
  UpdatedByUserId INT NULL,
  RowVersion      ROWVERSION NOT NULL,
  CONSTRAINT PK_UserAbsence PRIMARY KEY (AbsenceId),
  CONSTRAINT CK_UserAbsence_Type CHECK (AbsenceType IN ('VACATION', 'SICK', 'TRAINING', 'CONFERENCE', 'OTHER')),
  CONSTRAINT CK_UserAbsence_Range CHECK (EndDate IS NULL OR EndDate >= StartDate),
  CONSTRAINT FK_UserAbsence_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_UserAbsence_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_UserAbsence_UpdatedBy FOREIGN KEY (UpdatedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_UserAbsence_User ON dbo.UserAbsence (UserId, StartDate) INCLUDE (EndDate, AbsenceType);
CREATE INDEX IX_UserAbsence_Dates ON dbo.UserAbsence (StartDate, EndDate) INCLUDE (UserId, AbsenceType);
GO

-- HolidayCalendar: A named holiday calendar.
CREATE TABLE dbo.HolidayCalendar (
  CalendarId        INT IDENTITY(1,1) NOT NULL,
  Name              NVARCHAR(100) NOT NULL,
  ColourKey         VARCHAR(20) NOT NULL CONSTRAINT DF_HolidayCalendar_Colour DEFAULT 'slate',
  RegionNote        NVARCHAR(200) NULL,
  AppliesToEveryone BIT NOT NULL CONSTRAINT DF_HolidayCalendar_Everyone DEFAULT 0,
  SortOrder         INT NOT NULL CONSTRAINT DF_HolidayCalendar_Sort DEFAULT 0,
  IsActive          BIT NOT NULL CONSTRAINT DF_HolidayCalendar_IsActive DEFAULT 1,
  CreatedAt         DATETIME2 NOT NULL CONSTRAINT DF_HolidayCalendar_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId   INT NULL,
  ModifiedAt        DATETIME2 NULL,
  ModifiedByUserId  INT NULL,
  RowVersion        ROWVERSION NOT NULL,
  CONSTRAINT PK_HolidayCalendar PRIMARY KEY (CalendarId),
  CONSTRAINT UQ_HolidayCalendar_Name UNIQUE (Name),
  CONSTRAINT CK_HolidayCalendar_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT FK_HolidayCalendar_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_HolidayCalendar_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

-- Holiday: One holiday rule of a calendar (fixed date, nth weekday, Easter offset, once, or a range) with a weekend observance
-- rule.
CREATE TABLE dbo.Holiday (
  HolidayId        INT IDENTITY(1,1) NOT NULL,
  CalendarId       INT NOT NULL,
  Name             NVARCHAR(100) NOT NULL,
  RuleKind         VARCHAR(20) NOT NULL,
  Month            TINYINT NULL,
  Day              TINYINT NULL,
  Nth              SMALLINT NULL,
  Weekday          TINYINT NULL,
  PlusDays         TINYINT NOT NULL CONSTRAINT DF_Holiday_PlusDays DEFAULT 0,
  EasterOffset     SMALLINT NULL,
  OnceDate         DATE NULL,
  RangeEndMonth    TINYINT NULL,
  RangeEndDay      TINYINT NULL,
  RangeEndDate     DATE NULL,
  Yearly           BIT NOT NULL CONSTRAINT DF_Holiday_Yearly DEFAULT 1,
  WeekendRule      VARCHAR(10) NOT NULL CONSTRAINT DF_Holiday_WeekendRule DEFAULT 'NONE',
  RegionNote       NVARCHAR(200) NULL,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_Holiday_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_Holiday PRIMARY KEY (HolidayId),
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
  CONSTRAINT CK_Holiday_Fields CHECK ((RuleKind = 'FIXED'         AND Month IS NOT NULL AND Day IS NOT NULL) OR (RuleKind = 'NTH_WEEKDAY'   AND Month IS NOT NULL AND Nth IS NOT NULL AND Weekday IS NOT NULL) OR (RuleKind = 'EASTER_OFFSET' AND EasterOffset IS NOT NULL) OR (RuleKind = 'ONCE'          AND OnceDate IS NOT NULL) OR (RuleKind = 'RANGE'         AND ((Yearly = 1 AND Month IS NOT NULL AND Day IS NOT NULL AND RangeEndMonth IS NOT NULL AND RangeEndDay IS NOT NULL) OR (Yearly = 0 AND OnceDate IS NOT NULL AND RangeEndDate IS NOT NULL)))),
  CONSTRAINT FK_Holiday_Calendar FOREIGN KEY (CalendarId) REFERENCES dbo.HolidayCalendar (CalendarId),
  CONSTRAINT FK_Holiday_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Holiday_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_Holiday_Calendar ON dbo.Holiday (CalendarId, HolidayId);
GO

-- === Pods ==================================================================================================================

-- Pod: A working group of people (team).
CREATE TABLE dbo.Pod (
  PodId                    INT IDENTITY(1,1) NOT NULL,
  Name                     NVARCHAR(100) NOT NULL,
  Description              NVARCHAR(500) NULL,
  IsActive                 BIT NOT NULL CONSTRAINT DF_Pod_IsActive DEFAULT 1,
  CreatedAt                DATETIME2 NOT NULL CONSTRAINT DF_Pod_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId          INT NULL,
  ModifiedAt               DATETIME2 NULL,
  ModifiedByUserId         INT NULL,
  RowVersion               ROWVERSION NOT NULL,
  DefaultHolidayCalendarId INT NULL,
  CONSTRAINT PK_Pod PRIMARY KEY (PodId),
  CONSTRAINT UQ_Pod_Name UNIQUE (Name),
  CONSTRAINT FK_Pod_DefaultHolidayCalendar FOREIGN KEY (DefaultHolidayCalendarId) REFERENCES dbo.HolidayCalendar (CalendarId),
  CONSTRAINT FK_Pod_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Pod_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

-- PodMember: Junction: users in pods, with a primary pod flag (at most one primary per user).
CREATE TABLE dbo.PodMember (
  PodId     INT NOT NULL,
  UserId    INT NOT NULL,
  IsPrimary BIT NOT NULL CONSTRAINT DF_PodMember_IsPrimary DEFAULT 0,
  CONSTRAINT PK_PodMember PRIMARY KEY (PodId, UserId),
  CONSTRAINT FK_PodMember_Pod FOREIGN KEY (PodId) REFERENCES dbo.Pod (PodId),
  CONSTRAINT FK_PodMember_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_PodMember_User ON dbo.PodMember (UserId);
CREATE UNIQUE INDEX UQ_PodMember_Primary ON dbo.PodMember (UserId) WHERE ([IsPrimary]=(1));
GO

-- === Audit trail (append-only; see the triggers, the guard table and the DDL trigger below) ================================

-- AuditEvent: The append-only audit trail: who did what to which object and when.
CREATE TABLE dbo.AuditEvent (
  AuditEventId     BIGINT IDENTITY(1,1) NOT NULL,
  OccurredAtUtc    DATETIME2(3) NOT NULL CONSTRAINT DF_AuditEvent_OccurredAtUtc DEFAULT SYSUTCDATETIME(),
  ActorUserId      INT NULL,
  EventType        VARCHAR(64) NOT NULL,
  ObjectType       VARCHAR(40) NOT NULL,
  ObjectId         VARCHAR(40) NOT NULL,
  MatterId         INT NULL,
  TaskId           BIGINT NULL,
  FieldKey         VARCHAR(100) NULL,
  OldValue         NVARCHAR(MAX) NULL,
  NewValue         NVARCHAR(MAX) NULL,
  Summary          NVARCHAR(500) NULL,
  CorrelationId    UNIQUEIDENTIFIER NOT NULL,
  IsSensitiveScope BIT NOT NULL CONSTRAINT DF_AuditEvent_IsSensitiveScope DEFAULT 0,
  CONSTRAINT PK_AuditEvent PRIMARY KEY (AuditEventId),
  CONSTRAINT CK_AuditEvent_EventType CHECK (LEN(EventType) > 0)
);
GO

CREATE INDEX IX_Audit_Object ON dbo.AuditEvent (ObjectType, ObjectId, AuditEventId);
CREATE INDEX IX_Audit_Time ON dbo.AuditEvent (OccurredAtUtc);
CREATE INDEX IX_Audit_Task ON dbo.AuditEvent (TaskId, AuditEventId) WHERE ([TaskId] IS NOT NULL);
CREATE INDEX IX_Audit_Matter ON dbo.AuditEvent (MatterId, AuditEventId) WHERE ([MatterId] IS NOT NULL);
CREATE INDEX IX_Audit_Actor ON dbo.AuditEvent (ActorUserId, AuditEventId) WHERE ([ActorUserId] IS NOT NULL);
CREATE INDEX IX_Audit_Correlation ON dbo.AuditEvent (CorrelationId);
CREATE INDEX IX_Audit_EventType ON dbo.AuditEvent (EventType, AuditEventId);
GO

-- AuditEventGuard: A permanently empty table that references AuditEvent, so SQL Server refuses TRUNCATE TABLE on the audit
-- table, even for a sysadmin.
CREATE TABLE dbo.AuditEventGuard (
  AuditEventId BIGINT NOT NULL,
  CONSTRAINT PK_AuditEventGuard PRIMARY KEY (AuditEventId),
  CONSTRAINT FK_AuditEventGuard_AuditEvent FOREIGN KEY (AuditEventId) REFERENCES dbo.AuditEvent (AuditEventId)
);
GO

-- === Clients, matters and projects =========================================================================================

-- MatterType: Admin-managed list: the Matter Type a matter can carry (optional; Matter.MatterTypeId).
CREATE TABLE dbo.MatterType (
  MatterTypeId     INT IDENTITY(1,1) NOT NULL,
  Name             NVARCHAR(100) NOT NULL,
  SortOrder        INT NOT NULL,
  IsActive         BIT NOT NULL CONSTRAINT DF_MatterType_IsActive DEFAULT 1,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_MatterType_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_MatterType PRIMARY KEY (MatterTypeId),
  CONSTRAINT UQ_MatterType_Name UNIQUE (Name),
  CONSTRAINT CK_MatterType_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT FK_MatterType_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_MatterType_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_MatterType_Sort ON dbo.MatterType (SortOrder);
GO

-- CurrentState: Admin-managed list: the Current State of a matter (optional, current value only; Matter.CurrentStateId).
CREATE TABLE dbo.CurrentState (
  CurrentStateId   INT IDENTITY(1,1) NOT NULL,
  Name             NVARCHAR(100) NOT NULL,
  SortOrder        INT NOT NULL,
  IsActive         BIT NOT NULL CONSTRAINT DF_CurrentState_IsActive DEFAULT 1,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_CurrentState_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_CurrentState PRIMARY KEY (CurrentStateId),
  CONSTRAINT UQ_CurrentState_Name UNIQUE (Name),
  CONSTRAINT CK_CurrentState_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT FK_CurrentState_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_CurrentState_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_CurrentState_Sort ON dbo.CurrentState (SortOrder);
GO

-- TeamTitle: Admin-managed list: the title of a team member (MatterTeamMember.TeamTitleId).
CREATE TABLE dbo.TeamTitle (
  TeamTitleId      INT IDENTITY(1,1) NOT NULL,
  Name             NVARCHAR(100) NOT NULL,
  SortOrder        INT NOT NULL,
  IsActive         BIT NOT NULL CONSTRAINT DF_TeamTitle_IsActive DEFAULT 1,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_TeamTitle_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_TeamTitle PRIMARY KEY (TeamTitleId),
  CONSTRAINT UQ_TeamTitle_Name UNIQUE (Name),
  CONSTRAINT CK_TeamTitle_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT FK_TeamTitle_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_TeamTitle_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_TeamTitle_Sort ON dbo.TeamTitle (SortOrder);
GO

-- Client: A law-firm client with a zero-padded 5-digit client number.
CREATE TABLE dbo.Client (
  ClientId         INT IDENTITY(1,1) NOT NULL,
  ClientNumber     CHAR(5) NOT NULL,
  Name             NVARCHAR(200) NOT NULL,
  IsActive         BIT NOT NULL CONSTRAINT DF_Client_IsActive DEFAULT 1,
  CustomFieldsJson NVARCHAR(MAX) NULL,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_Client_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_Client PRIMARY KEY (ClientId),
  CONSTRAINT UQ_Client_IdNumber UNIQUE (ClientId, ClientNumber),
  CONSTRAINT UQ_Client_Number UNIQUE (ClientNumber),
  CONSTRAINT CK_Client_Number CHECK (ClientNumber NOT LIKE '%[^0-9]%' AND LEN(ClientNumber) = 5 AND ClientNumber <> '00000'),
  CONSTRAINT CK_Client_CustomFieldsJson CHECK (CustomFieldsJson IS NULL OR ISJSON(CustomFieldsJson) = 1),
  CONSTRAINT FK_Client_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Client_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_Client_Name ON dbo.Client (Name);
GO

-- Matter: A client case.
CREATE TABLE dbo.Matter (
  MatterId           INT IDENTITY(1,1) NOT NULL,
  ClientId           INT NOT NULL,
  ClientNumber       CHAR(5) NOT NULL,
  MatterNumber       CHAR(5) NOT NULL,
  MatterRef          AS (CONVERT([char](11),([ClientNumber]+'-')+[MatterNumber])) PERSISTED NOT NULL,
  Name               NVARCHAR(300) NOT NULL,
  IsActive           BIT NOT NULL CONSTRAINT DF_Matter_IsActive DEFAULT 1,
  IsSensitive        BIT NOT NULL CONSTRAINT DF_Matter_IsSensitive DEFAULT 0,
  CustomFieldsJson   NVARCHAR(MAX) NULL,
  CreatedAt          DATETIME2 NOT NULL CONSTRAINT DF_Matter_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId    INT NULL,
  ModifiedAt         DATETIME2 NULL,
  ModifiedByUserId   INT NULL,
  RowVersion         ROWVERSION NOT NULL,
  PrimaryManagerId   INT NULL,
  SecondaryManagerId INT NULL,
  AiAllowed          TINYINT NOT NULL CONSTRAINT DF_Matter_AiAllowed DEFAULT 0,
  MatterTypeId       INT NULL,
  CurrentStateId     INT NULL,
  DmsPath            NVARCHAR(1000) NULL,
  DfsPath            NVARCHAR(1000) NULL,
  CONSTRAINT PK_Matter PRIMARY KEY (MatterId),
  CONSTRAINT UQ_Matter_Ref UNIQUE (MatterRef),
  CONSTRAINT UQ_Matter_ClientMatterNumber UNIQUE (ClientId, MatterNumber),
  CONSTRAINT CK_Matter_Number CHECK (MatterNumber NOT LIKE '%[^0-9]%' AND LEN(MatterNumber) = 5 AND MatterNumber <> '00000'),
  CONSTRAINT CK_Matter_CustomFieldsJson CHECK (CustomFieldsJson IS NULL OR ISJSON(CustomFieldsJson) = 1),
  CONSTRAINT CK_Matter_ManagersDiffer CHECK (PrimaryManagerId IS NULL OR SecondaryManagerId IS NULL OR PrimaryManagerId <> SecondaryManagerId),
  CONSTRAINT CK_Matter_AiAllowed CHECK (AiAllowed IN (0, 1, 2)),
  CONSTRAINT FK_Matter_Client FOREIGN KEY (ClientId, ClientNumber) REFERENCES dbo.Client (ClientId, ClientNumber) ON UPDATE CASCADE,
  CONSTRAINT FK_Matter_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Matter_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Matter_PrimaryManager FOREIGN KEY (PrimaryManagerId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Matter_SecondaryManager FOREIGN KEY (SecondaryManagerId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Matter_MatterType FOREIGN KEY (MatterTypeId) REFERENCES dbo.MatterType (MatterTypeId),
  CONSTRAINT FK_Matter_CurrentState FOREIGN KEY (CurrentStateId) REFERENCES dbo.CurrentState (CurrentStateId)
);
GO

CREATE INDEX IX_Matter_Client ON dbo.Matter (ClientId, IsActive);
CREATE INDEX IX_Matter_Name ON dbo.Matter (Name);
CREATE INDEX IX_Matter_Number ON dbo.Matter (MatterNumber);
CREATE INDEX IX_Matter_PrimaryManager ON dbo.Matter (PrimaryManagerId) INCLUDE (IsActive) WHERE ([PrimaryManagerId] IS NOT NULL);
CREATE INDEX IX_Matter_SecondaryManager ON dbo.Matter (SecondaryManagerId) INCLUDE (IsActive) WHERE ([SecondaryManagerId] IS NOT NULL);
CREATE INDEX IX_Matter_Sensitive ON dbo.Matter (MatterId) INCLUDE (PrimaryManagerId, SecondaryManagerId) WHERE ([IsSensitive]=(1));
CREATE INDEX IX_Matter_MatterType ON dbo.Matter (MatterTypeId);
CREATE INDEX IX_Matter_CurrentState ON dbo.Matter (CurrentStateId);
GO

-- Project: A project inside a matter, with custom fields.
CREATE TABLE dbo.Project (
  ProjectId        INT IDENTITY(1,1) NOT NULL,
  MatterId         INT NOT NULL,
  Name             NVARCHAR(200) NOT NULL,
  Description      NVARCHAR(2000) NULL,
  IsActive         BIT NOT NULL CONSTRAINT DF_Project_IsActive DEFAULT 1,
  CustomFieldsJson NVARCHAR(MAX) NULL,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_Project_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_Project PRIMARY KEY (ProjectId),
  CONSTRAINT UQ_Project_IdMatter UNIQUE (ProjectId, MatterId),
  CONSTRAINT UQ_Project_MatterName UNIQUE (MatterId, Name),
  CONSTRAINT CK_Project_CustomFieldsJson CHECK (CustomFieldsJson IS NULL OR ISJSON(CustomFieldsJson) = 1),
  CONSTRAINT FK_Project_Matter FOREIGN KEY (MatterId) REFERENCES dbo.Matter (MatterId),
  CONSTRAINT FK_Project_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Project_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_Project_Matter ON dbo.Project (MatterId, IsActive);
CREATE INDEX IX_Project_Name ON dbo.Project (Name);
GO

-- MatterTeamMember: A person on a matter's team: a typed-in contact (name, email, title), not a user account, so it never
-- affects visibility or permissions.
CREATE TABLE dbo.MatterTeamMember (
  MatterTeamMemberId INT IDENTITY(1,1) NOT NULL,
  MatterId           INT NOT NULL,
  Name               NVARCHAR(200) NOT NULL,
  Email              NVARCHAR(254) COLLATE Latin1_General_100_CI_AS NOT NULL,
  TeamTitleId        INT NOT NULL,
  SortOrder          INT NOT NULL,
  CreatedAt          DATETIME2 NOT NULL CONSTRAINT DF_MatterTeamMember_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId    INT NULL,
  ModifiedAt         DATETIME2 NULL,
  ModifiedByUserId   INT NULL,
  RowVersion         ROWVERSION NOT NULL,
  CONSTRAINT PK_MatterTeamMember PRIMARY KEY (MatterTeamMemberId),
  CONSTRAINT UQ_MatterTeamMember_MatterEmail UNIQUE (MatterId, Email),
  CONSTRAINT CK_MatterTeamMember_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT CK_MatterTeamMember_Email CHECK (LEN(LTRIM(RTRIM(Email))) > 0),
  CONSTRAINT FK_MatterTeamMember_Matter FOREIGN KEY (MatterId) REFERENCES dbo.Matter (MatterId),
  CONSTRAINT FK_MatterTeamMember_Title FOREIGN KEY (TeamTitleId) REFERENCES dbo.TeamTitle (TeamTitleId),
  CONSTRAINT FK_MatterTeamMember_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_MatterTeamMember_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_MatterTeamMember_Title ON dbo.MatterTeamMember (TeamTitleId);
GO

-- MatterEvent: A calendar item of a matter (types OTHER, CLIENT_MEETING, MEDIATION, FILING_DEADLINE, PRODUCTION_DEADLINE,
-- DEPOSITION, TRIAL, COURT_HEARING).
CREATE TABLE dbo.MatterEvent (
  MatterEventId    INT IDENTITY(1,1) NOT NULL,
  MatterId         INT NOT NULL,
  EventTypeCode    VARCHAR(30) NOT NULL,
  Title            NVARCHAR(200) NOT NULL,
  EventDate        DATE NOT NULL,
  EventTime        TIME(0) NULL,
  Note             NVARCHAR(2000) NULL,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_MatterEvent_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_MatterEvent PRIMARY KEY (MatterEventId),
  CONSTRAINT CK_MatterEvent_Type CHECK (EventTypeCode IN ('COURT_HEARING', 'TRIAL', 'DEPOSITION', 'PRODUCTION_DEADLINE', 'FILING_DEADLINE', 'MEDIATION', 'CLIENT_MEETING', 'OTHER')),
  CONSTRAINT CK_MatterEvent_Title CHECK (LEN(LTRIM(RTRIM(Title))) > 0),
  CONSTRAINT FK_MatterEvent_Matter FOREIGN KEY (MatterId) REFERENCES dbo.Matter (MatterId),
  CONSTRAINT FK_MatterEvent_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_MatterEvent_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_MatterEvent_Date ON dbo.MatterEvent (EventDate, MatterId) INCLUDE (EventTypeCode, EventTime);
CREATE INDEX IX_MatterEvent_Matter ON dbo.MatterEvent (MatterId, EventDate);
GO

-- UserMatterActivitySeen: Per person: the highest audit event id marked as read in My Matters recent activity.
CREATE TABLE dbo.UserMatterActivitySeen (
  UserId           INT NOT NULL,
  SeenAuditEventId BIGINT NOT NULL CONSTRAINT DF_UserMatterActivitySeen_Event DEFAULT 0,
  SeenAtUtc        DATETIME2(3) NOT NULL CONSTRAINT DF_UserMatterActivitySeen_At DEFAULT SYSUTCDATETIME(),
  IsInitial        BIT NOT NULL CONSTRAINT DF_UserMatterActivitySeen_Initial DEFAULT 0,
  CONSTRAINT PK_UserMatterActivitySeen PRIMARY KEY (UserId),
  CONSTRAINT CK_UserMatterActivitySeen_Event CHECK (SeenAuditEventId >= 0),
  CONSTRAINT FK_UserMatterActivitySeen_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId)
);
GO

-- === Forms and custom fields ===============================================================================================

-- FormDefinition: A form container owned by exactly one thing: a task type, a step definition, an asset type, or a client,
-- matter or project (custom fields).
CREATE TABLE dbo.FormDefinition (
  FormDefinitionId INT IDENTITY(1,1) NOT NULL,
  Scope            VARCHAR(20) NOT NULL,
  TaskTypeId       INT NULL,
  StepDefinitionId INT NULL,
  AssetTypeId      INT NULL,
  IsActive         BIT NOT NULL CONSTRAINT DF_FormDefinition_IsActive DEFAULT 1,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_FormDefinition_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_FormDefinition PRIMARY KEY (FormDefinitionId),
  CONSTRAINT CK_FormDefinition_Scope CHECK (Scope IN ('TASK_TYPE', 'STEP', 'ASSET_TYPE', 'CLIENT', 'MATTER', 'PROJECT')),
  CONSTRAINT CK_FormDefinition_Owner CHECK ((Scope = 'TASK_TYPE'  AND TaskTypeId IS NOT NULL AND StepDefinitionId IS NULL AND AssetTypeId IS NULL) OR (Scope = 'STEP'       AND StepDefinitionId IS NOT NULL AND TaskTypeId IS NULL AND AssetTypeId IS NULL) OR (Scope = 'ASSET_TYPE' AND AssetTypeId IS NOT NULL AND TaskTypeId IS NULL AND StepDefinitionId IS NULL) OR (Scope IN ('CLIENT', 'MATTER', 'PROJECT') AND TaskTypeId IS NULL AND StepDefinitionId IS NULL AND AssetTypeId IS NULL)),
  CONSTRAINT FK_FormDefinition_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_FormDefinition_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE UNIQUE INDEX UQ_FormDef_TaskType ON dbo.FormDefinition (TaskTypeId) WHERE ([TaskTypeId] IS NOT NULL);
CREATE UNIQUE INDEX UQ_FormDef_Step ON dbo.FormDefinition (StepDefinitionId) WHERE ([StepDefinitionId] IS NOT NULL);
CREATE UNIQUE INDEX UQ_FormDef_AssetType ON dbo.FormDefinition (AssetTypeId) WHERE ([AssetTypeId] IS NOT NULL);
CREATE UNIQUE INDEX UQ_FormDef_Singleton ON dbo.FormDefinition (Scope) WHERE ([Scope] IN ('CLIENT', 'MATTER', 'PROJECT'));
GO

-- FormVersion: A version of a form: DRAFT, PUBLISHED or RETIRED.
CREATE TABLE dbo.FormVersion (
  FormVersionId       INT IDENTITY(1,1) NOT NULL,
  FormDefinitionId    INT NOT NULL,
  VersionNo           INT NOT NULL,
  Status              VARCHAR(12) NOT NULL,
  ClonedFromVersionId INT NULL,
  PublishedAt         DATETIME2 NULL,
  PublishedByUserId   INT NULL,
  Notes               NVARCHAR(500) NULL,
  CreatedAt           DATETIME2 NOT NULL CONSTRAINT DF_FormVersion_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId     INT NULL,
  ModifiedAt          DATETIME2 NULL,
  ModifiedByUserId    INT NULL,
  RowVersion          ROWVERSION NOT NULL,
  CONSTRAINT PK_FormVersion PRIMARY KEY (FormVersionId),
  CONSTRAINT UQ_FormVersion_No UNIQUE (FormDefinitionId, VersionNo),
  CONSTRAINT CK_FormVersion_Status CHECK (Status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  CONSTRAINT CK_FormVersion_PublishedAt CHECK (Status = 'DRAFT' OR PublishedAt IS NOT NULL),
  CONSTRAINT FK_FormVersion_Definition FOREIGN KEY (FormDefinitionId) REFERENCES dbo.FormDefinition (FormDefinitionId),
  CONSTRAINT FK_FormVersion_ClonedFrom FOREIGN KEY (ClonedFromVersionId) REFERENCES dbo.FormVersion (FormVersionId),
  CONSTRAINT FK_FormVersion_PublishedBy FOREIGN KEY (PublishedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_FormVersion_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_FormVersion_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE UNIQUE INDEX UQ_FormVersion_Published ON dbo.FormVersion (FormDefinitionId) WHERE ([Status]='PUBLISHED');
CREATE UNIQUE INDEX UQ_FormVersion_Draft ON dbo.FormVersion (FormDefinitionId) WHERE ([Status]='DRAFT');
CREATE INDEX IX_FormVersion_ClonedFrom ON dbo.FormVersion (ClonedFromVersionId) WHERE ([ClonedFromVersionId] IS NOT NULL);
GO

-- FormField: One field of a form version: key, label, control type, required flag, validation and conditional rules (JSON),
-- filterable flag.
CREATE TABLE dbo.FormField (
  FormFieldId      INT IDENTITY(1,1) NOT NULL,
  FormVersionId    INT NOT NULL,
  FieldKey         VARCHAR(64) NOT NULL,
  Label            NVARCHAR(200) NOT NULL,
  ControlType      VARCHAR(20) NOT NULL,
  HelpText         NVARCHAR(1000) NULL,
  SortOrder        INT NOT NULL,
  SectionKey       VARCHAR(64) NULL,
  IsRequired       BIT NOT NULL CONSTRAINT DF_FormField_IsRequired DEFAULT 0,
  DefaultValueJson NVARCHAR(MAX) NULL,
  ValidationJson   NVARCHAR(MAX) NULL,
  ShowWhenJson     NVARCHAR(MAX) NULL,
  RequiredWhenJson NVARCHAR(MAX) NULL,
  IsFilterable     BIT NOT NULL CONSTRAINT DF_FormField_IsFilterable DEFAULT 0,
  CONSTRAINT PK_FormField PRIMARY KEY (FormFieldId),
  CONSTRAINT UQ_FormField_Order UNIQUE (FormVersionId, SortOrder),
  CONSTRAINT UQ_FormField_Key UNIQUE (FormVersionId, FieldKey),
  CONSTRAINT CK_FormField_Key CHECK (FieldKey COLLATE Latin1_General_100_BIN2 LIKE '[a-z]%' AND FieldKey COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^a-z0-9_]%'),
  CONSTRAINT CK_FormField_Control CHECK (ControlType IN ( 'TEXT', 'TEXTAREA', 'NUMBER', 'CHECKBOX', 'SELECT', 'RADIO', 'MULTISELECT', 'DATE', 'DATETIME', 'URL', 'ASSET_REF', 'USER_REF', 'SECTION_HEADING', 'HELP_TEXT')),
  CONSTRAINT CK_FormField_DefaultJson CHECK (DefaultValueJson IS NULL OR ISJSON('[' + DefaultValueJson + ']') = 1),
  CONSTRAINT CK_FormField_ValidationJson CHECK (ValidationJson IS NULL OR ISJSON(ValidationJson) = 1),
  CONSTRAINT CK_FormField_ShowWhenJson CHECK (ShowWhenJson IS NULL OR ISJSON(ShowWhenJson) = 1),
  CONSTRAINT CK_FormField_RequiredWhenJson CHECK (RequiredWhenJson IS NULL OR ISJSON(RequiredWhenJson) = 1),
  CONSTRAINT FK_FormField_Version FOREIGN KEY (FormVersionId) REFERENCES dbo.FormVersion (FormVersionId)
);
GO

-- FormFieldOption: One option of a choice field.
CREATE TABLE dbo.FormFieldOption (
  FormFieldOptionId INT IDENTITY(1,1) NOT NULL,
  FormFieldId       INT NOT NULL,
  OptionKey         VARCHAR(64) NOT NULL,
  Label             NVARCHAR(200) NOT NULL,
  SortOrder         INT NOT NULL,
  AvailableWhenJson NVARCHAR(MAX) NULL,
  CONSTRAINT PK_FormFieldOption PRIMARY KEY (FormFieldOptionId),
  CONSTRAINT UQ_FormFieldOption_Order UNIQUE (FormFieldId, SortOrder),
  CONSTRAINT UQ_FormFieldOption_Key UNIQUE (FormFieldId, OptionKey),
  CONSTRAINT CK_FormFieldOption_AvailableWhen CHECK (AvailableWhenJson IS NULL OR ISJSON(AvailableWhenJson) = 1),
  CONSTRAINT FK_FormFieldOption_Field FOREIGN KEY (FormFieldId) REFERENCES dbo.FormField (FormFieldId)
);
GO

-- FormValueSet: The stored values (JSON) of a form for one owner (task, step instance, asset, matter, client or project), tied
-- to the form version used.
CREATE TABLE dbo.FormValueSet (
  FormValueSetId   BIGINT IDENTITY(1,1) NOT NULL,
  OwnerKind        VARCHAR(16) NOT NULL,
  OwnerId          BIGINT NOT NULL,
  FormDefinitionId INT NOT NULL,
  FormVersionId    INT NOT NULL,
  ValuesJson       NVARCHAR(MAX) NOT NULL,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_FormValueSet_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_FormValueSet PRIMARY KEY (FormValueSetId),
  CONSTRAINT UQ_FormValueSet_Owner UNIQUE (OwnerKind, OwnerId, FormDefinitionId),
  CONSTRAINT CK_FormValueSet_OwnerKind CHECK (OwnerKind IN ('TASK', 'STEP_INSTANCE', 'CLIENT', 'MATTER', 'PROJECT', 'ASSET')),
  CONSTRAINT CK_FormValueSet_Json CHECK (ISJSON(ValuesJson) = 1),
  CONSTRAINT FK_FormValueSet_Definition FOREIGN KEY (FormDefinitionId) REFERENCES dbo.FormDefinition (FormDefinitionId),
  CONSTRAINT FK_FormValueSet_Version FOREIGN KEY (FormVersionId) REFERENCES dbo.FormVersion (FormVersionId),
  CONSTRAINT FK_FormValueSet_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_FormValueSet_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_FormValueSet_Version ON dbo.FormValueSet (FormVersionId);
GO

-- CustomFieldIndex: Typed copies of custom field values (text, number, date, date and time, bool) so lists, search and reports
-- can filter and aggregate with seeks instead of reading JSON.
CREATE TABLE dbo.CustomFieldIndex (
  CustomFieldIndexId BIGINT IDENTITY(1,1) NOT NULL,
  OwnerKind          VARCHAR(12) NOT NULL,
  OwnerId            BIGINT NOT NULL,
  FormDefinitionId   INT NOT NULL,
  FieldKey           VARCHAR(64) NOT NULL,
  ValueText          NVARCHAR(450) NULL,
  ValueNumber        DECIMAL(19,4) NULL,
  ValueDate          DATE NULL,
  ValueDateTime      DATETIME2 NULL,
  ValueBool          BIT NULL,
  CONSTRAINT PK_CustomFieldIndex PRIMARY KEY (CustomFieldIndexId),
  CONSTRAINT CK_CFI_OwnerKind CHECK (OwnerKind IN ('TASK', 'CLIENT', 'MATTER', 'PROJECT', 'ASSET')),
  CONSTRAINT CK_CFI_OneValue CHECK ((CASE WHEN ValueText IS NULL THEN 0 ELSE 1 END + CASE WHEN ValueNumber IS NULL THEN 0 ELSE 1 END + CASE WHEN ValueDate IS NULL THEN 0 ELSE 1 END + CASE WHEN ValueDateTime IS NULL THEN 0 ELSE 1 END + CASE WHEN ValueBool IS NULL THEN 0 ELSE 1 END) = 1),
  CONSTRAINT FK_CFI_Definition FOREIGN KEY (FormDefinitionId) REFERENCES dbo.FormDefinition (FormDefinitionId)
);
GO

CREATE INDEX IX_CFI_Text ON dbo.CustomFieldIndex (OwnerKind, FormDefinitionId, FieldKey, ValueText) INCLUDE (OwnerId) WHERE ([ValueText] IS NOT NULL);
CREATE INDEX IX_CFI_Number ON dbo.CustomFieldIndex (OwnerKind, FormDefinitionId, FieldKey, ValueNumber) INCLUDE (OwnerId) WHERE ([ValueNumber] IS NOT NULL);
CREATE INDEX IX_CFI_Date ON dbo.CustomFieldIndex (OwnerKind, FormDefinitionId, FieldKey, ValueDate) INCLUDE (OwnerId) WHERE ([ValueDate] IS NOT NULL);
CREATE INDEX IX_CFI_DateTime ON dbo.CustomFieldIndex (OwnerKind, FormDefinitionId, FieldKey, ValueDateTime) INCLUDE (OwnerId) WHERE ([ValueDateTime] IS NOT NULL);
CREATE INDEX IX_CFI_Bool ON dbo.CustomFieldIndex (OwnerKind, FormDefinitionId, FieldKey, ValueBool) INCLUDE (OwnerId) WHERE ([ValueBool] IS NOT NULL);
CREATE INDEX IX_CFI_Owner ON dbo.CustomFieldIndex (OwnerKind, OwnerId);
CREATE INDEX IX_CFI_Kind_Field_Owner ON dbo.CustomFieldIndex (OwnerKind, FieldKey, OwnerId) INCLUDE (ValueNumber, ValueText);
GO

-- === Configuration lookups and settings ====================================================================================

-- Priority: Admin-managed task priorities with label, colour, order and a default.
CREATE TABLE dbo.Priority (
  PriorityId       INT IDENTITY(1,1) NOT NULL,
  Label            NVARCHAR(50) NOT NULL,
  SortOrder        INT NOT NULL,
  Color            VARCHAR(20) NOT NULL CONSTRAINT DF_Priority_Color DEFAULT 'neutral',
  IsActive         BIT NOT NULL CONSTRAINT DF_Priority_IsActive DEFAULT 1,
  IsDefault        BIT NOT NULL CONSTRAINT DF_Priority_IsDefault DEFAULT 0,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_Priority_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_Priority PRIMARY KEY (PriorityId),
  CONSTRAINT UQ_Priority_Label UNIQUE (Label),
  CONSTRAINT CK_Priority_Label CHECK (LEN(LTRIM(RTRIM(Label))) > 0),
  CONSTRAINT CK_Priority_DefaultActive CHECK (IsDefault = 0 OR IsActive = 1),
  CONSTRAINT FK_Priority_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Priority_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE UNIQUE INDEX UQ_Priority_Default ON dbo.Priority (IsDefault) WHERE ([IsDefault]=(1));
CREATE INDEX IX_Priority_Sort ON dbo.Priority (SortOrder);
GO

-- TaskStatusLabel: Display labels of the five fixed task status codes (NEW, IN_PROGRESS, ON_HOLD, COMPLETED, CANCELLED).
CREATE TABLE dbo.TaskStatusLabel (
  StatusCode       VARCHAR(20) NOT NULL,
  DisplayLabel     NVARCHAR(50) NOT NULL,
  SortOrder        INT NOT NULL,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_TaskStatusLabel_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_TaskStatusLabel PRIMARY KEY (StatusCode),
  CONSTRAINT UQ_TaskStatusLabel_Label UNIQUE (DisplayLabel),
  CONSTRAINT CK_TaskStatusLabel_Code CHECK (StatusCode IN ('NEW', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT CK_TaskStatusLabel_Label CHECK (LEN(LTRIM(RTRIM(DisplayLabel))) > 0),
  CONSTRAINT FK_TaskStatusLabel_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_TaskStatusLabel_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

-- AssetLinkRole: Admin-managed list of roles that describe how an asset is linked to a task (used on TaskAsset).
CREATE TABLE dbo.AssetLinkRole (
  AssetLinkRoleId  INT IDENTITY(1,1) NOT NULL,
  Name             NVARCHAR(50) NOT NULL,
  SortOrder        INT NOT NULL,
  IsActive         BIT NOT NULL CONSTRAINT DF_AssetLinkRole_IsActive DEFAULT 1,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_AssetLinkRole_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_AssetLinkRole PRIMARY KEY (AssetLinkRoleId),
  CONSTRAINT UQ_AssetLinkRole_Name UNIQUE (Name),
  CONSTRAINT CK_AssetLinkRole_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT FK_AssetLinkRole_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_AssetLinkRole_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_AssetLinkRole_Sort ON dbo.AssetLinkRole (SortOrder);
GO

-- OnHoldReason: Admin-managed list of reasons for putting a task On Hold.
CREATE TABLE dbo.OnHoldReason (
  OnHoldReasonId   INT IDENTITY(1,1) NOT NULL,
  Name             NVARCHAR(100) NOT NULL,
  SortOrder        INT NOT NULL,
  IsActive         BIT NOT NULL CONSTRAINT DF_OnHoldReason_IsActive DEFAULT 1,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_OnHoldReason_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_OnHoldReason PRIMARY KEY (OnHoldReasonId),
  CONSTRAINT UQ_OnHoldReason_Name UNIQUE (Name),
  CONSTRAINT CK_OnHoldReason_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT FK_OnHoldReason_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_OnHoldReason_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_OnHoldReason_Sort ON dbo.OnHoldReason (SortOrder);
GO

-- AppSetting: Application settings as key and value (text, or a binary file with content type and SHA-256).
CREATE TABLE dbo.AppSetting (
  SettingKey      VARCHAR(100) NOT NULL,
  ValueText       NVARCHAR(1000) NULL,
  ValueBinary     VARBINARY(MAX) NULL,
  ContentType     VARCHAR(100) NULL,
  ContentSha256   BINARY(32) NULL,
  UpdatedAtUtc    DATETIME2(3) NOT NULL CONSTRAINT DF_AppSetting_UpdatedAt DEFAULT SYSUTCDATETIME(),
  UpdatedByUserId INT NOT NULL,
  RowVersion      ROWVERSION NOT NULL,
  CONSTRAINT PK_AppSetting PRIMARY KEY (SettingKey),
  CONSTRAINT CK_AppSetting_Key CHECK (LEN(LTRIM(RTRIM(SettingKey))) > 0),
  CONSTRAINT CK_AppSetting_Size CHECK (DATALENGTH(ValueBinary) <= 262144),
  CONSTRAINT CK_AppSetting_Binary CHECK ((ValueBinary IS NULL AND ContentType IS NULL AND ContentSha256 IS NULL) OR (ValueBinary IS NOT NULL AND ContentType IS NOT NULL AND ContentSha256 IS NOT NULL)),
  CONSTRAINT FK_AppSetting_UpdatedBy FOREIGN KEY (UpdatedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

-- === Task types and workflow configuration =================================================================================

-- TaskType: Admin-defined type of task, with icon, colour key, target days, default workflow and a request form.
CREATE TABLE dbo.TaskType (
  TaskTypeId                  INT IDENTITY(1,1) NOT NULL,
  Name                        NVARCHAR(100) NOT NULL,
  Description                 NVARCHAR(1000) NULL,
  IsActive                    BIT NOT NULL CONSTRAINT DF_TaskType_IsActive DEFAULT 1,
  DefaultWorkflowDefinitionId INT NULL,
  CreatedAt                   DATETIME2 NOT NULL CONSTRAINT DF_TaskType_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId             INT NULL,
  ModifiedAt                  DATETIME2 NULL,
  ModifiedByUserId            INT NULL,
  RowVersion                  ROWVERSION NOT NULL,
  IconKey                     VARCHAR(50) NOT NULL CONSTRAINT DF_TaskType_IconKey DEFAULT 'file-text',
  ColourKey                   VARCHAR(20) NULL,
  TargetDays                  SMALLINT NULL,
  CONSTRAINT PK_TaskType PRIMARY KEY (TaskTypeId),
  CONSTRAINT UQ_TaskType_Name UNIQUE (Name),
  CONSTRAINT CK_TaskType_IconKey CHECK (LEN(IconKey) > 0 AND IconKey NOT LIKE '%[^a-z0-9-]%'),
  CONSTRAINT CK_TaskType_ColourKey CHECK (ColourKey IS NULL OR (LEN(ColourKey) > 0 AND ColourKey NOT LIKE '%[^a-z]%')),
  CONSTRAINT CK_TaskType_TargetDays CHECK (TargetDays IS NULL OR TargetDays BETWEEN 1 AND 365),
  CONSTRAINT CK_TaskType_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT FK_TaskType_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_TaskType_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

-- StepDefinition: A reusable step of the step library (title, instructions, documentation link, tags).
CREATE TABLE dbo.StepDefinition (
  StepDefinitionId INT IDENTITY(1,1) NOT NULL,
  Title            NVARCHAR(200) NOT NULL,
  Description      NVARCHAR(1000) NULL,
  Instructions     NVARCHAR(MAX) NULL,
  DocumentationUrl NVARCHAR(1000) NULL,
  IsActive         BIT NOT NULL CONSTRAINT DF_StepDefinition_IsActive DEFAULT 1,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_StepDefinition_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_StepDefinition PRIMARY KEY (StepDefinitionId),
  CONSTRAINT CK_StepDefinition_Title CHECK (LEN(LTRIM(RTRIM(Title))) > 0),
  CONSTRAINT FK_StepDefinition_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_StepDefinition_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE UNIQUE INDEX UQ_StepDefinition_Title ON dbo.StepDefinition (Title) WHERE ([IsActive]=(1));
GO

-- StepTag: Free-form tag of library steps.
CREATE TABLE dbo.StepTag (
  StepTagId INT IDENTITY(1,1) NOT NULL,
  TagKey    NVARCHAR(40) COLLATE Latin1_General_100_CI_AS NOT NULL,
  Name      NVARCHAR(40) NOT NULL,
  CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_StepTag_CreatedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_StepTag PRIMARY KEY (StepTagId),
  CONSTRAINT UQ_StepTag_Key UNIQUE (TagKey),
  CONSTRAINT CK_StepTag_Key CHECK (LEN(LTRIM(RTRIM(TagKey))) > 0),
  CONSTRAINT CK_StepTag_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0)
);
GO

-- StepDefinitionTag: Junction: tags on a library step, with an order.
CREATE TABLE dbo.StepDefinitionTag (
  StepDefinitionId INT NOT NULL,
  StepTagId        INT NOT NULL,
  SortOrder        INT NOT NULL CONSTRAINT DF_StepDefinitionTag_SortOrder DEFAULT 0,
  CONSTRAINT PK_StepDefinitionTag PRIMARY KEY (StepDefinitionId, StepTagId),
  CONSTRAINT CK_StepDefinitionTag_SortOrder CHECK (SortOrder >= 0),
  CONSTRAINT FK_StepDefinitionTag_Step FOREIGN KEY (StepDefinitionId) REFERENCES dbo.StepDefinition (StepDefinitionId),
  CONSTRAINT FK_StepDefinitionTag_Tag FOREIGN KEY (StepTagId) REFERENCES dbo.StepTag (StepTagId)
);
GO

CREATE INDEX IX_StepDefinitionTag_Tag ON dbo.StepDefinitionTag (StepTagId, StepDefinitionId);
GO

-- TaskTypeWorkflowEligibility: Junction: which workflows may be used for a task type.
CREATE TABLE dbo.TaskTypeWorkflowEligibility (
  TaskTypeId           INT NOT NULL,
  WorkflowDefinitionId INT NOT NULL,
  CreatedAt            DATETIME2 NOT NULL CONSTRAINT DF_TaskTypeWorkflowEligibility_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId      INT NULL,
  CONSTRAINT PK_TaskTypeWorkflowEligibility PRIMARY KEY (TaskTypeId, WorkflowDefinitionId),
  CONSTRAINT CK_TaskTypeWorkflowEligibility_Workflow CHECK (WorkflowDefinitionId > 0),
  CONSTRAINT FK_TaskTypeWorkflowEligibility_TaskType FOREIGN KEY (TaskTypeId) REFERENCES dbo.TaskType (TaskTypeId),
  CONSTRAINT FK_TaskTypeWorkflowEligibility_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_TaskTypeWorkflowEligibility_Workflow ON dbo.TaskTypeWorkflowEligibility (WorkflowDefinitionId);
GO

-- WorkflowDefinition: A named workflow.
CREATE TABLE dbo.WorkflowDefinition (
  WorkflowDefinitionId INT IDENTITY(1,1) NOT NULL,
  Name                 NVARCHAR(200) NOT NULL,
  Description          NVARCHAR(1000) NULL,
  IsActive             BIT NOT NULL CONSTRAINT DF_WorkflowDefinition_IsActive DEFAULT 1,
  CreatedAt            DATETIME2 NOT NULL CONSTRAINT DF_WorkflowDefinition_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId      INT NULL,
  ModifiedAt           DATETIME2 NULL,
  ModifiedByUserId     INT NULL,
  RowVersion           ROWVERSION NOT NULL,
  CONSTRAINT PK_WorkflowDefinition PRIMARY KEY (WorkflowDefinitionId),
  CONSTRAINT UQ_WorkflowDefinition_Name UNIQUE (Name),
  CONSTRAINT CK_WorkflowDefinition_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT FK_WorkflowDefinition_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_WorkflowDefinition_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

-- WorkflowVersion: A version of a workflow: DRAFT, PUBLISHED or RETIRED.
CREATE TABLE dbo.WorkflowVersion (
  WorkflowVersionId    INT IDENTITY(1,1) NOT NULL,
  WorkflowDefinitionId INT NOT NULL,
  VersionNo            INT NOT NULL,
  Status               VARCHAR(12) NOT NULL,
  IsOrdered            BIT NOT NULL CONSTRAINT DF_WorkflowVersion_IsOrdered DEFAULT 1,
  PublishedAt          DATETIME2 NULL,
  PublishedByUserId    INT NULL,
  CreatedAt            DATETIME2 NOT NULL CONSTRAINT DF_WorkflowVersion_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId      INT NULL,
  ModifiedAt           DATETIME2 NULL,
  ModifiedByUserId     INT NULL,
  RowVersion           ROWVERSION NOT NULL,
  CONSTRAINT PK_WorkflowVersion PRIMARY KEY (WorkflowVersionId),
  CONSTRAINT UQ_WorkflowVersion_No UNIQUE (WorkflowDefinitionId, VersionNo),
  CONSTRAINT CK_WorkflowVersion_Status CHECK (Status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  CONSTRAINT CK_WorkflowVersion_PublishedAt CHECK (Status = 'DRAFT' OR PublishedAt IS NOT NULL),
  CONSTRAINT FK_WorkflowVersion_PublishedBy FOREIGN KEY (PublishedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_WorkflowVersion_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_WorkflowVersion_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_WorkflowVersion_Definition FOREIGN KEY (WorkflowDefinitionId) REFERENCES dbo.WorkflowDefinition (WorkflowDefinitionId)
);
GO

CREATE UNIQUE INDEX UQ_WorkflowVersion_Published ON dbo.WorkflowVersion (WorkflowDefinitionId) WHERE ([Status]='PUBLISHED');
CREATE UNIQUE INDEX UQ_WorkflowVersion_Draft ON dbo.WorkflowVersion (WorkflowDefinitionId) WHERE ([Status]='DRAFT');
GO

-- WorkflowVersionStep: One step of a workflow version, copied from the library at design time.
CREATE TABLE dbo.WorkflowVersionStep (
  WorkflowVersionStepId  INT IDENTITY(1,1) NOT NULL,
  WorkflowVersionId      INT NOT NULL,
  SequenceNo             INT NOT NULL,
  SourceStepDefinitionId INT NOT NULL,
  Title                  NVARCHAR(200) NOT NULL,
  Description            NVARCHAR(1000) NULL,
  Instructions           NVARCHAR(MAX) NULL,
  DocumentationUrl       NVARCHAR(1000) NULL,
  StepFormVersionId      INT NULL,
  IsSkippable            BIT NOT NULL CONSTRAINT DF_WVS_IsSkippable DEFAULT 0,
  SkipCommentRequired    BIT NOT NULL CONSTRAINT DF_WVS_SkipCommentRequired DEFAULT 0,
  CONSTRAINT PK_WorkflowVersionStep PRIMARY KEY (WorkflowVersionStepId),
  CONSTRAINT UQ_WVS_Source UNIQUE (WorkflowVersionId, SourceStepDefinitionId),
  CONSTRAINT UQ_WVS_Sequence UNIQUE (WorkflowVersionId, SequenceNo),
  CONSTRAINT CK_WVS_Sequence CHECK (SequenceNo >= 1),
  CONSTRAINT CK_WVS_Title CHECK (LEN(LTRIM(RTRIM(Title))) > 0),
  CONSTRAINT CK_WVS_SkipComment CHECK (SkipCommentRequired = 0 OR IsSkippable = 1),
  CONSTRAINT FK_WVS_Version FOREIGN KEY (WorkflowVersionId) REFERENCES dbo.WorkflowVersion (WorkflowVersionId),
  CONSTRAINT FK_WVS_Source FOREIGN KEY (SourceStepDefinitionId) REFERENCES dbo.StepDefinition (StepDefinitionId),
  CONSTRAINT FK_WVS_FormVersion FOREIGN KEY (StepFormVersionId) REFERENCES dbo.FormVersion (FormVersionId)
);
GO

CREATE INDEX IX_WVS_Source ON dbo.WorkflowVersionStep (SourceStepDefinitionId);
CREATE INDEX IX_WVS_FormVersion ON dbo.WorkflowVersionStep (StepFormVersionId) WHERE ([StepFormVersionId] IS NOT NULL);
GO

-- === Assets ================================================================================================================

-- AssetType: Admin-defined kind of asset, with a custom field form (through FormDefinition), an icon, a colour, an optional
-- size field and unit and the optional automatic numbering of its assets (issue #1297: on or off, the pattern after the
-- matter's CM Number, the scope).
CREATE TABLE dbo.AssetType (
  AssetTypeId      INT IDENTITY(1,1) NOT NULL,
  Name             NVARCHAR(100) NOT NULL,
  Description      NVARCHAR(500) NULL,
  SortOrder        INT NOT NULL CONSTRAINT DF_AssetType_SortOrder DEFAULT 0,
  IsActive         BIT NOT NULL CONSTRAINT DF_AssetType_IsActive DEFAULT 1,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_AssetType_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  SizeFieldKey     VARCHAR(64) NULL,
  SizeUnit         VARCHAR(10) NULL,
  IconKey          VARCHAR(50) NULL,
  ColourKey        VARCHAR(20) NULL,
  NumberingEnabled BIT NOT NULL CONSTRAINT DF_AssetType_NumberingEnabled DEFAULT 0,
  NumberingPattern NVARCHAR(150) NOT NULL CONSTRAINT DF_AssetType_NumberingPattern DEFAULT N'_{###}',
  NumberingScope   INT NOT NULL CONSTRAINT DF_AssetType_NumberingScope DEFAULT 1,
  CONSTRAINT PK_AssetType PRIMARY KEY (AssetTypeId),
  CONSTRAINT UQ_AssetType_Name UNIQUE (Name),
  CONSTRAINT CK_AssetType_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT CK_AssetType_SizeUnit CHECK (SizeUnit IS NULL OR SizeUnit IN ('B', 'KB', 'MB', 'GB', 'TB', 'Items')),
  CONSTRAINT CK_AssetType_SizeField_Unit CHECK ((SizeFieldKey IS NULL AND SizeUnit IS NULL) OR (SizeFieldKey IS NOT NULL AND SizeUnit IS NOT NULL AND LEN(LTRIM(RTRIM(SizeFieldKey))) > 0)),
  CONSTRAINT CK_AssetType_NumberingPattern CHECK (LEN(NumberingPattern) BETWEEN 1 AND 50),
  CONSTRAINT CK_AssetType_NumberingScope CHECK (NumberingScope IN (1)),
  CONSTRAINT CK_AssetType_IconKey CHECK (IconKey IS NULL OR (LEN(IconKey) > 0 AND IconKey NOT LIKE '%[^a-z0-9-]%')),
  CONSTRAINT CK_AssetType_ColourKey CHECK (ColourKey IS NULL OR (LEN(ColourKey) > 0 AND ColourKey NOT LIKE '%[^a-z]%')),
  CONSTRAINT FK_AssetType_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_AssetType_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_AssetType_Sort ON dbo.AssetType (SortOrder, Name);
GO

-- Asset: A data source or deliverable that belongs to one matter (for example a workspace, vault, media or data set).
CREATE TABLE dbo.Asset (
  AssetId                    INT IDENTITY(1,1) NOT NULL,
  MatterId                   INT NOT NULL,
  AssetTypeId                INT NOT NULL,
  DisplayName                NVARCHAR(300) NOT NULL,
  ExternalReference          NVARCHAR(1000) NULL,
  Description                NVARCHAR(2000) NULL,
  IsActive                   BIT NOT NULL CONSTRAINT DF_Asset_IsActive DEFAULT 1,
  CreatedAt                  DATETIME2 NOT NULL CONSTRAINT DF_Asset_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId            INT NULL,
  ModifiedAt                 DATETIME2 NULL,
  ModifiedByUserId           INT NULL,
  RowVersion                 ROWVERSION NOT NULL,
  DispositionCode            VARCHAR(20) NOT NULL CONSTRAINT DF_Asset_DispositionCode DEFAULT 'ACTIVE',
  DispositionChangedAt       DATETIME2 NULL,
  DispositionChangedByUserId INT NULL,
  DispositionNote            NVARCHAR(500) NULL,
  AssetNumber                NVARCHAR(100) NULL,
  AssetNumberSeq             INT NULL,
  CONSTRAINT PK_Asset PRIMARY KEY (AssetId),
  CONSTRAINT UQ_Asset_IdMatter UNIQUE (AssetId, MatterId),
  CONSTRAINT CK_Asset_DisplayName CHECK (LEN(LTRIM(RTRIM(DisplayName))) > 0),
  CONSTRAINT CK_Asset_DispositionCode CHECK (DispositionCode IN ('ACTIVE', 'INACTIVE', 'PENDING_DISPOSITION', 'DISPOSED')),
  CONSTRAINT CK_Asset_IsActive_Disposition CHECK ((IsActive = 1 AND DispositionCode = 'ACTIVE') OR (IsActive = 0 AND DispositionCode <> 'ACTIVE')),
  CONSTRAINT CK_Asset_AssetNumber CHECK ((AssetNumber IS NULL AND AssetNumberSeq IS NULL) OR (AssetNumber IS NOT NULL AND LEN(AssetNumber) > 0 AND AssetNumberSeq IS NOT NULL AND AssetNumberSeq >= 1)),
  CONSTRAINT FK_Asset_Matter FOREIGN KEY (MatterId) REFERENCES dbo.Matter (MatterId),
  CONSTRAINT FK_Asset_AssetType FOREIGN KEY (AssetTypeId) REFERENCES dbo.AssetType (AssetTypeId),
  CONSTRAINT FK_Asset_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Asset_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Asset_DispositionChangedBy FOREIGN KEY (DispositionChangedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_Asset_Matter ON dbo.Asset (MatterId, AssetTypeId) INCLUDE (DisplayName, IsActive);
CREATE INDEX IX_Asset_Name ON dbo.Asset (DisplayName);
CREATE INDEX IX_Asset_Type ON dbo.Asset (AssetTypeId);
CREATE INDEX IX_Asset_Matter_Disposition ON dbo.Asset (MatterId, AssetTypeId, DispositionCode);
CREATE UNIQUE INDEX UQ_Asset_AssetNumber ON dbo.Asset (AssetTypeId, MatterId, AssetNumber) WHERE ([AssetNumber] IS NOT NULL);
GO

-- AssetNumberCounter: The atomic counter of the automatic asset numbering (issue #1297): one row per asset type and scope key
-- (the matter id while the scope is per matter).
CREATE TABLE dbo.AssetNumberCounter (
  AssetTypeId INT NOT NULL,
  ScopeKey    INT NOT NULL,
  NextNumber  INT NOT NULL CONSTRAINT DF_AssetNumberCounter_Next DEFAULT 1,
  ModifiedAt  DATETIME2 NOT NULL CONSTRAINT DF_AssetNumberCounter_ModifiedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_AssetNumberCounter PRIMARY KEY (AssetTypeId, ScopeKey),
  CONSTRAINT CK_AssetNumberCounter_Next CHECK (NextNumber >= 1),
  CONSTRAINT FK_AssetNumberCounter_AssetType FOREIGN KEY (AssetTypeId) REFERENCES dbo.AssetType (AssetTypeId)
);
GO

-- AssetReport: A person's saved asset report definition (JSON) for the asset report builder.
CREATE TABLE dbo.AssetReport (
  AssetReportId    INT IDENTITY(1,1) NOT NULL,
  OwnerUserId      INT NOT NULL,
  Name             NVARCHAR(100) NOT NULL,
  DefinitionJson   NVARCHAR(4000) NOT NULL,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_AssetReport_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_AssetReport PRIMARY KEY (AssetReportId),
  CONSTRAINT UQ_AssetReport_OwnerName UNIQUE (OwnerUserId, Name),
  CONSTRAINT CK_AssetReport_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT CK_AssetReport_Definition CHECK (ISJSON(DefinitionJson) = 1),
  CONSTRAINT FK_AssetReport_Owner FOREIGN KEY (OwnerUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_AssetReport_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_AssetReport_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

-- === Workflow instances and tasks ==========================================================================================

-- WorkflowInstance: The running copy of a workflow version for one task, with its ordering flag and a revision.
CREATE TABLE dbo.WorkflowInstance (
  WorkflowInstanceId BIGINT IDENTITY(1,1) NOT NULL,
  WorkflowVersionId  INT NOT NULL,
  IsOrdered          BIT NOT NULL,
  Revision           INT NOT NULL CONSTRAINT DF_WorkflowInstance_Revision DEFAULT 0,
  CreatedAt          DATETIME2 NOT NULL CONSTRAINT DF_WorkflowInstance_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId    INT NULL,
  ModifiedAt         DATETIME2 NULL,
  ModifiedByUserId   INT NULL,
  RowVersion         ROWVERSION NOT NULL,
  CONSTRAINT PK_WorkflowInstance PRIMARY KEY (WorkflowInstanceId),
  CONSTRAINT FK_WorkflowInstance_Version FOREIGN KEY (WorkflowVersionId) REFERENCES dbo.WorkflowVersion (WorkflowVersionId),
  CONSTRAINT FK_WorkflowInstance_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_WorkflowInstance_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_WorkflowInstance_Version ON dbo.WorkflowInstance (WorkflowVersionId);
GO

-- StepInstance: One step of a running workflow instance: a copy of the step text, its status (PENDING, IN_PROGRESS, COMPLETED,
-- SKIPPED), who resolved it and when.
CREATE TABLE dbo.StepInstance (
  StepInstanceId        INT IDENTITY(1,1) NOT NULL,
  WorkflowInstanceId    BIGINT NOT NULL,
  WorkflowVersionStepId INT NOT NULL,
  SequenceNo            INT NOT NULL,
  Title                 NVARCHAR(200) NOT NULL,
  Description           NVARCHAR(1000) NULL,
  Instructions          NVARCHAR(MAX) NULL,
  DocumentationUrl      NVARCHAR(1000) NULL,
  IsSkippable           BIT NOT NULL,
  SkipCommentRequired   BIT NOT NULL,
  InputFormVersionId    INT NULL,
  InputFormDefinitionId INT NULL,
  Status                VARCHAR(12) NOT NULL CONSTRAINT DF_StepInstance_Status DEFAULT 'PENDING',
  SkipComment           NVARCHAR(2000) NULL,
  FirstResolvedAt       DATETIME2 NULL,
  ResolvedAt            DATETIME2 NULL,
  ResolvedByUserId      INT NULL,
  CreatedAt             DATETIME2 NOT NULL CONSTRAINT DF_StepInstance_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId       INT NULL,
  ModifiedAt            DATETIME2 NULL,
  ModifiedByUserId      INT NULL,
  RowVersion            ROWVERSION NOT NULL,
  CONSTRAINT PK_StepInstance PRIMARY KEY (StepInstanceId),
  CONSTRAINT UQ_StepInstance_Sequence UNIQUE (WorkflowInstanceId, SequenceNo),
  CONSTRAINT UQ_StepInstance_VersionStep UNIQUE (WorkflowInstanceId, WorkflowVersionStepId),
  CONSTRAINT CK_StepInstance_Status CHECK (Status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED')),
  CONSTRAINT CK_StepInstance_Sequence CHECK (SequenceNo >= 1),
  CONSTRAINT CK_StepInstance_Title CHECK (LEN(LTRIM(RTRIM(Title))) > 0),
  CONSTRAINT CK_StepInstance_SkipComment CHECK (SkipCommentRequired = 0 OR IsSkippable = 1),
  CONSTRAINT CK_StepInstance_InputForm CHECK ((InputFormVersionId IS NULL AND InputFormDefinitionId IS NULL) OR (InputFormVersionId IS NOT NULL AND InputFormDefinitionId IS NOT NULL)),
  CONSTRAINT CK_StepInstance_Resolved CHECK ((Status IN ('COMPLETED', 'SKIPPED') AND FirstResolvedAt IS NOT NULL AND ResolvedAt IS NOT NULL) OR (Status = 'IN_PROGRESS') OR (Status = 'PENDING' AND FirstResolvedAt IS NULL)),
  CONSTRAINT FK_StepInstance_Workflow FOREIGN KEY (WorkflowInstanceId) REFERENCES dbo.WorkflowInstance (WorkflowInstanceId),
  CONSTRAINT FK_StepInstance_VersionStep FOREIGN KEY (WorkflowVersionStepId) REFERENCES dbo.WorkflowVersionStep (WorkflowVersionStepId),
  CONSTRAINT FK_StepInstance_FormVersion FOREIGN KEY (InputFormVersionId) REFERENCES dbo.FormVersion (FormVersionId),
  CONSTRAINT FK_StepInstance_FormDefinition FOREIGN KEY (InputFormDefinitionId) REFERENCES dbo.FormDefinition (FormDefinitionId),
  CONSTRAINT FK_StepInstance_ResolvedBy FOREIGN KEY (ResolvedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_StepInstance_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_StepInstance_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_StepInstance_Workflow ON dbo.StepInstance (WorkflowInstanceId, SequenceNo) INCLUDE (Status);
CREATE INDEX IX_StepInstance_Status ON dbo.StepInstance (Status) WHERE ([Status] IN ('PENDING', 'IN_PROGRESS'));
CREATE INDEX IX_StepInstance_FormVersion ON dbo.StepInstance (InputFormVersionId) WHERE ([InputFormVersionId] IS NOT NULL);
GO

-- Task: A unit of work on a matter (optionally a project) of one task type, with priority, status, assignee (user and or pod),
-- requestor, due date, workflow instance and form version.
CREATE TABLE dbo.Task (
  TaskId             BIGINT IDENTITY(1,1) NOT NULL,
  TaskNumber         VARCHAR(20) NOT NULL CONSTRAINT DF_Task_Number DEFAULT 'TSK-'+CONVERT([varchar](18),NEXT VALUE FOR [dbo].[TaskNumberSeq]),
  MatterId           INT NOT NULL,
  ProjectId          INT NULL,
  TaskTypeId         INT NOT NULL,
  FormVersionId      INT NULL,
  WorkflowInstanceId BIGINT NOT NULL,
  Title              NVARCHAR(300) NOT NULL,
  Description        NVARCHAR(MAX) NULL,
  PriorityId         INT NOT NULL,
  StatusCode         VARCHAR(20) NOT NULL CONSTRAINT DF_Task_StatusCode DEFAULT 'NEW',
  AssignedPodId      INT NULL,
  AssignedUserId     INT NULL,
  RequestorName      NVARCHAR(200) NOT NULL,
  RequestorEmail     NVARCHAR(320) NULL,
  RequestedAt        DATETIME2(3) NULL,
  DueDate            DATE NULL,
  DueAtUtc           DATETIME2(3) NULL,
  DueSortKey         DATETIME2(3) NULL,
  StatusChangedAt    DATETIME2(3) NOT NULL CONSTRAINT DF_Task_StatusChangedAt DEFAULT SYSUTCDATETIME(),
  CompletedAt        DATETIME2(3) NULL,
  CreatedAt          DATETIME2 NOT NULL CONSTRAINT DF_Task_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId    INT NULL,
  ModifiedAt         DATETIME2 NULL,
  ModifiedByUserId   INT NULL,
  RowVersion         ROWVERSION NOT NULL,
  AssignedAt         DATETIME2(3) NULL,
  DescriptionFormat  VARCHAR(4) NOT NULL CONSTRAINT DF_Task_DescriptionFormat DEFAULT 'TEXT',
  IsMatterSensitive  BIT NOT NULL CONSTRAINT DF_Task_IsMatterSensitive DEFAULT 0,
  OnHoldReasonId     INT NULL,
  UnassignedAt       DATETIME2(3) NULL,
  CONSTRAINT PK_Task PRIMARY KEY (TaskId),
  CONSTRAINT UQ_Task_WorkflowInstance UNIQUE (WorkflowInstanceId),
  CONSTRAINT UQ_Task_IdMatter UNIQUE (TaskId, MatterId),
  CONSTRAINT UQ_Task_Number UNIQUE (TaskNumber),
  CONSTRAINT CK_Task_DescriptionFormat CHECK (DescriptionFormat IN ('TEXT', 'HTML')),
  CONSTRAINT CK_Task_StatusCode CHECK (StatusCode IN ('NEW', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT CK_Task_Title CHECK (LEN(LTRIM(RTRIM(Title))) > 0),
  CONSTRAINT CK_Task_RequestorName CHECK (LEN(LTRIM(RTRIM(RequestorName))) > 0),
  CONSTRAINT CK_Task_RequestorEmail CHECK (RequestorEmail IS NULL OR RequestorEmail LIKE '%_@_%'),
  CONSTRAINT CK_Task_DueAt CHECK (DueAtUtc IS NULL OR DueDate IS NOT NULL),
  CONSTRAINT CK_Task_DueSortKey CHECK ((DueDate IS NULL AND DueSortKey IS NULL) OR (DueDate IS NOT NULL AND DueSortKey IS NOT NULL)),
  CONSTRAINT CK_Task_CompletedAt CHECK ((StatusCode = 'COMPLETED' AND CompletedAt IS NOT NULL) OR (StatusCode <> 'COMPLETED' AND CompletedAt IS NULL)),
  CONSTRAINT FK_Task_OnHoldReason FOREIGN KEY (OnHoldReasonId) REFERENCES dbo.OnHoldReason (OnHoldReasonId),
  CONSTRAINT FK_Task_Matter FOREIGN KEY (MatterId) REFERENCES dbo.Matter (MatterId),
  CONSTRAINT FK_Task_Project_SameMatter FOREIGN KEY (ProjectId, MatterId) REFERENCES dbo.Project (ProjectId, MatterId),
  CONSTRAINT FK_Task_TaskType FOREIGN KEY (TaskTypeId) REFERENCES dbo.TaskType (TaskTypeId),
  CONSTRAINT FK_Task_FormVersion FOREIGN KEY (FormVersionId) REFERENCES dbo.FormVersion (FormVersionId),
  CONSTRAINT FK_Task_WorkflowInstance FOREIGN KEY (WorkflowInstanceId) REFERENCES dbo.WorkflowInstance (WorkflowInstanceId),
  CONSTRAINT FK_Task_Priority FOREIGN KEY (PriorityId) REFERENCES dbo.Priority (PriorityId),
  CONSTRAINT FK_Task_Status FOREIGN KEY (StatusCode) REFERENCES dbo.TaskStatusLabel (StatusCode),
  CONSTRAINT FK_Task_AssignedPod FOREIGN KEY (AssignedPodId) REFERENCES dbo.Pod (PodId),
  CONSTRAINT FK_Task_AssignedUser FOREIGN KEY (AssignedUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Task_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Task_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_Task_Queue ON dbo.Task (StatusCode, PriorityId, DueSortKey, CreatedAt) INCLUDE (MatterId, AssignedUserId, AssignedPodId, TaskTypeId, DueDate, DueAtUtc, IsMatterSensitive);
CREATE INDEX IX_Task_AssignedUser ON dbo.Task (AssignedUserId, StatusCode) INCLUDE (PriorityId, DueSortKey, DueDate, DueAtUtc, CreatedAt, StatusChangedAt, MatterId, IsMatterSensitive);
CREATE INDEX IX_Task_Pod ON dbo.Task (AssignedPodId, StatusCode) INCLUDE (AssignedUserId, PriorityId, DueSortKey, DueDate, DueAtUtc, CreatedAt, MatterId, IsMatterSensitive);
CREATE INDEX IX_Task_Matter ON dbo.Task (MatterId, StatusCode) INCLUDE (DueDate, DueAtUtc, DueSortKey, AssignedUserId, AssignedPodId, StatusChangedAt, CreatedAt, WorkflowInstanceId);
CREATE INDEX IX_Task_Project ON dbo.Task (ProjectId) WHERE ([ProjectId] IS NOT NULL);
CREATE INDEX IX_Task_Creator ON dbo.Task (CreatedByUserId, CreatedAt) INCLUDE (StatusCode, MatterId, AssignedUserId, IsMatterSensitive);
CREATE INDEX IX_Task_Type ON dbo.Task (TaskTypeId, StatusCode);
CREATE INDEX IX_Task_Priority ON dbo.Task (PriorityId);
CREATE INDEX IX_Task_Completed ON dbo.Task (CompletedAt) WHERE ([CompletedAt] IS NOT NULL);
CREATE INDEX IX_Task_Title ON dbo.Task (Title);
CREATE INDEX IX_Task_Requestor ON dbo.Task (RequestorName);
CREATE INDEX IX_Task_CreatedAt ON dbo.Task (CreatedAt DESC, TaskId DESC) INCLUDE (StatusCode, MatterId, AssignedUserId, IsMatterSensitive);
CREATE INDEX IX_Task_StatusChanged ON dbo.Task (StatusCode, StatusChangedAt DESC, TaskId DESC) INCLUDE (MatterId, AssignedUserId, IsMatterSensitive);
CREATE INDEX IX_Task_CompletedCoverage ON dbo.Task (CompletedAt) INCLUDE (StatusCode, AssignedUserId, TaskTypeId, MatterId, IsMatterSensitive) WHERE ([CompletedAt] IS NOT NULL);
CREATE INDEX IX_Task_AssignedMatter ON dbo.Task (AssignedUserId, MatterId) INCLUDE (StatusCode) WHERE ([AssignedUserId] IS NOT NULL);
CREATE INDEX IX_Task_AssignedSensitive ON dbo.Task (AssignedUserId) INCLUDE (MatterId) WHERE ([IsMatterSensitive]=(1) AND [AssignedUserId] IS NOT NULL);
CREATE INDEX IX_Task_OnHoldReason ON dbo.Task (OnHoldReasonId, MatterId) WHERE ([OnHoldReasonId] IS NOT NULL);
CREATE INDEX IX_Task_Matter_Type ON dbo.Task (MatterId, TaskTypeId, StatusCode) INCLUDE (DueDate, DueAtUtc, DueSortKey, AssignedUserId, AssignedPodId, StatusChangedAt, CreatedAt, OnHoldReasonId, PriorityId);
CREATE INDEX IX_Task_Unassigned ON dbo.Task (AssignedPodId, CreatedAt) INCLUDE (UnassignedAt, MatterId, IsMatterSensitive) WHERE ([AssignedUserId] IS NULL AND ([StatusCode] IN ('NEW', 'IN_PROGRESS', 'ON_HOLD')));
GO

-- TaskComment: A comment on a task (HTML), with a purpose (normal, on hold or cancel reason) and soft delete.
CREATE TABLE dbo.TaskComment (
  TaskCommentId    BIGINT IDENTITY(1,1) NOT NULL,
  TaskId           BIGINT NOT NULL,
  AuthorUserId     INT NOT NULL,
  Purpose          VARCHAR(12) NOT NULL CONSTRAINT DF_TaskComment_Purpose DEFAULT 'NORMAL',
  BodyHtml         NVARCHAR(MAX) NOT NULL,
  EditedAt         DATETIME2(3) NULL,
  IsDeleted        BIT NOT NULL CONSTRAINT DF_TaskComment_IsDeleted DEFAULT 0,
  DeletedAt        DATETIME2(3) NULL,
  DeletedByUserId  INT NULL,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_TaskComment_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_TaskComment PRIMARY KEY (TaskCommentId),
  CONSTRAINT CK_TaskComment_Purpose CHECK (Purpose IN ('NORMAL', 'CANCEL', 'ON_HOLD')),
  CONSTRAINT CK_TaskComment_Body CHECK (LEN(LTRIM(RTRIM(BodyHtml))) > 0),
  CONSTRAINT CK_TaskComment_ReasonNotDeletable CHECK (Purpose = 'NORMAL' OR IsDeleted = 0),
  CONSTRAINT CK_TaskComment_Deleted CHECK ((IsDeleted = 0 AND DeletedAt IS NULL) OR (IsDeleted = 1 AND DeletedAt IS NOT NULL)),
  CONSTRAINT FK_TaskComment_Task FOREIGN KEY (TaskId) REFERENCES dbo.Task (TaskId),
  CONSTRAINT FK_TaskComment_Author FOREIGN KEY (AuthorUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_TaskComment_DeletedBy FOREIGN KEY (DeletedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_TaskComment_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_TaskComment_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_TaskComment_Task ON dbo.TaskComment (TaskId, CreatedAt) WHERE ([IsDeleted]=(0));
CREATE INDEX IX_TaskComment_Author ON dbo.TaskComment (AuthorUserId);
CREATE INDEX IX_TaskComment_TaskAll ON dbo.TaskComment (TaskId);
GO

-- TaskCommentRevision: Append-only edit and delete history of task comments.
CREATE TABLE dbo.TaskCommentRevision (
  TaskCommentRevisionId BIGINT IDENTITY(1,1) NOT NULL,
  TaskCommentId         BIGINT NOT NULL,
  BodyHtml              NVARCHAR(MAX) NOT NULL,
  Reason                VARCHAR(10) NOT NULL,
  RevisedAt             DATETIME2(3) NOT NULL CONSTRAINT DF_TaskCommentRevision_RevisedAt DEFAULT SYSUTCDATETIME(),
  RevisedByUserId       INT NULL,
  CONSTRAINT PK_TaskCommentRevision PRIMARY KEY (TaskCommentRevisionId),
  CONSTRAINT CK_TaskCommentRevision_Reason CHECK (Reason IN ('EDIT', 'DELETE')),
  CONSTRAINT FK_TaskCommentRevision_Comment FOREIGN KEY (TaskCommentId) REFERENCES dbo.TaskComment (TaskCommentId),
  CONSTRAINT FK_TaskCommentRevision_RevisedBy FOREIGN KEY (RevisedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_TaskCommentRevision_Comment ON dbo.TaskCommentRevision (TaskCommentId, RevisedAt);
GO

-- TaskAsset: Junction: assets linked to a task, with an optional link role.
CREATE TABLE dbo.TaskAsset (
  TaskId           BIGINT NOT NULL,
  AssetId          INT NOT NULL,
  MatterId         INT NOT NULL,
  AssetLinkRoleId  INT NULL,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_TaskAsset_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_TaskAsset PRIMARY KEY (TaskId, AssetId),
  CONSTRAINT FK_TaskAsset_Task FOREIGN KEY (TaskId, MatterId) REFERENCES dbo.Task (TaskId, MatterId),
  CONSTRAINT FK_TaskAsset_Asset FOREIGN KEY (AssetId, MatterId) REFERENCES dbo.Asset (AssetId, MatterId),
  CONSTRAINT FK_TaskAsset_Role FOREIGN KEY (AssetLinkRoleId) REFERENCES dbo.AssetLinkRole (AssetLinkRoleId),
  CONSTRAINT FK_TaskAsset_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_TaskAsset_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_TaskAsset_Asset ON dbo.TaskAsset (AssetId);
CREATE INDEX IX_TaskAsset_Role ON dbo.TaskAsset (AssetLinkRoleId) WHERE ([AssetLinkRoleId] IS NOT NULL);
GO

-- === Notifications and saved views =========================================================================================

-- Notification: An in-app notification for one recipient.
CREATE TABLE dbo.Notification (
  Id              BIGINT IDENTITY(1,1) NOT NULL,
  RecipientUserId INT NOT NULL,
  EventType       VARCHAR(40) NOT NULL,
  ObjectKind      VARCHAR(20) NOT NULL,
  ObjectId        BIGINT NOT NULL,
  MatterId        INT NULL,
  ActorUserId     INT NULL,
  Message         NVARCHAR(300) NOT NULL,
  DedupeKey       NVARCHAR(80) NOT NULL,
  CreatedUtc      DATETIME2(3) NOT NULL CONSTRAINT DF_Notification_CreatedUtc DEFAULT SYSUTCDATETIME(),
  ReadUtc         DATETIME2(3) NULL,
  CONSTRAINT PK_Notification PRIMARY KEY (Id),
  CONSTRAINT CK_Notification_EventType CHECK (EventType IN ('TaskAssigned', 'TaskDue', 'TaskComment', 'TaskMention', 'MatterTaskOverdue', 'MatterTaskCreated', 'MatterTaskStalled', 'MatterManagerSet', 'PodTaskUnassigned')),
  CONSTRAINT CK_Notification_ObjectKind CHECK (ObjectKind IN ('Task', 'Matter')),
  CONSTRAINT CK_Notification_Message CHECK (LEN(LTRIM(RTRIM(Message))) > 0),
  CONSTRAINT CK_Notification_DedupeKey CHECK (LEN(DedupeKey) > 0),
  CONSTRAINT CK_Notification_ReadAfterCreate CHECK (ReadUtc IS NULL OR ReadUtc >= CreatedUtc),
  CONSTRAINT FK_Notification_Recipient FOREIGN KEY (RecipientUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Notification_Actor FOREIGN KEY (ActorUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Notification_Matter FOREIGN KEY (MatterId) REFERENCES dbo.Matter (MatterId)
);
GO

CREATE UNIQUE INDEX UX_Notification_Dedupe ON dbo.Notification (RecipientUserId, EventType, ObjectId, DedupeKey);
CREATE INDEX IX_Notification_Unread ON dbo.Notification (RecipientUserId, Id DESC) INCLUDE (ObjectKind, ObjectId, MatterId) WHERE ([ReadUtc] IS NULL);
CREATE INDEX IX_Notification_Recipient ON dbo.Notification (RecipientUserId, Id DESC);
CREATE INDEX IX_Notification_Read ON dbo.Notification (ReadUtc) WHERE ([ReadUtc] IS NOT NULL);
CREATE INDEX IX_Notification_Created ON dbo.Notification (CreatedUtc);
GO

-- NotificationPreference: Sparse per-user switches for notification event types (a row exists only when changed from the
-- default).
CREATE TABLE dbo.NotificationPreference (
  UserId     INT NOT NULL,
  EventType  VARCHAR(40) NOT NULL,
  Enabled    BIT NOT NULL,
  UpdatedUtc DATETIME2(3) NOT NULL CONSTRAINT DF_NotificationPreference_UpdatedUtc DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_NotificationPreference PRIMARY KEY (UserId, EventType),
  CONSTRAINT CK_NotificationPreference_EventType CHECK (EventType IN ('TaskAssigned', 'TaskDue', 'TaskComment', 'MatterTaskOverdue', 'MatterTaskCreated', 'MatterTaskStalled', 'MatterManagerSet', 'PodTaskUnassigned')),
  CONSTRAINT FK_NotificationPreference_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId)
);
GO

-- UserView: A person's remembered screen state per surface, and named saved views.
CREATE TABLE dbo.UserView (
  UserViewId BIGINT IDENTITY(1,1) NOT NULL,
  UserId     INT NOT NULL,
  Surface    VARCHAR(40) NOT NULL,
  Name       NVARCHAR(80) NULL,
  IsDefault  BIT NOT NULL CONSTRAINT DF_UserView_IsDefault DEFAULT 0,
  StateJson  NVARCHAR(4000) NOT NULL,
  CreatedAt  DATETIME2(3) NOT NULL CONSTRAINT DF_UserView_CreatedAt DEFAULT SYSUTCDATETIME(),
  ModifiedAt DATETIME2(3) NOT NULL CONSTRAINT DF_UserView_ModifiedAt DEFAULT SYSUTCDATETIME(),
  RowVersion ROWVERSION NOT NULL,
  CONSTRAINT PK_UserView PRIMARY KEY (UserViewId),
  CONSTRAINT UQ_UserView_Name UNIQUE (UserId, Surface, Name),
  CONSTRAINT CK_UserView_Surface CHECK (LEN(Surface) > 0 AND Surface NOT LIKE '%[^a-z0-9._-]%'),
  CONSTRAINT CK_UserView_Name CHECK (Name IS NULL OR LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT CK_UserView_State CHECK (ISJSON(StateJson) = 1),
  CONSTRAINT CK_UserView_RememberedNotDefault CHECK (Name IS NOT NULL OR IsDefault = 0),
  CONSTRAINT FK_UserView_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE UNIQUE INDEX UX_UserView_Default ON dbo.UserView (UserId, Surface) WHERE ([IsDefault]=(1));
GO

-- === Productions ===========================================================================================================

-- ProductionSpec: The agreed format of productions of a matter (image format, text, natives, load file, redaction, privilege
-- and other rules).
CREATE TABLE dbo.ProductionSpec (
  ProductionSpecId   INT IDENTITY(1,1) NOT NULL,
  MatterId           INT NOT NULL,
  Name               NVARCHAR(200) NOT NULL,
  StatusCode         VARCHAR(10) NOT NULL CONSTRAINT DF_ProductionSpec_Status DEFAULT 'Active',
  SourceOfAgreement  NVARCHAR(300) NULL,
  Description        NVARCHAR(1000) NULL,
  ImageFormat        NVARCHAR(100) NULL,
  ColourMode         NVARCHAR(100) NULL,
  TextMode           NVARCHAR(100) NULL,
  NativesRule        NVARCHAR(300) NULL,
  LoadFile           NVARCHAR(100) NULL,
  MetadataFieldsJson NVARCHAR(4000) NULL,
  RedactionRule      NVARCHAR(300) NULL,
  PrivilegeRule      NVARCHAR(300) NULL,
  DedupRule          NVARCHAR(200) NULL,
  DateTimeRule       NVARCHAR(200) NULL,
  NumberingRule      NVARCHAR(200) NULL,
  DeliveryRule       NVARCHAR(300) NULL,
  Notes              NVARCHAR(2000) NULL,
  CreatedAt          DATETIME2 NOT NULL CONSTRAINT DF_ProductionSpec_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId    INT NULL,
  ModifiedAt         DATETIME2 NULL,
  ModifiedByUserId   INT NULL,
  RowVersion         ROWVERSION NOT NULL,
  CONSTRAINT PK_ProductionSpec PRIMARY KEY (ProductionSpecId),
  CONSTRAINT UQ_ProductionSpec_IdMatter UNIQUE (ProductionSpecId, MatterId),
  CONSTRAINT CK_ProductionSpec_Status CHECK (StatusCode IN ('Active', 'Retired')),
  CONSTRAINT CK_ProductionSpec_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT CK_ProductionSpec_Fields CHECK (MetadataFieldsJson IS NULL OR ISJSON(MetadataFieldsJson) = 1),
  CONSTRAINT FK_ProductionSpec_Matter FOREIGN KEY (MatterId) REFERENCES dbo.Matter (MatterId),
  CONSTRAINT FK_ProductionSpec_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_ProductionSpec_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE UNIQUE INDEX UQ_ProductionSpec_ActiveName ON dbo.ProductionSpec (MatterId, Name) WHERE ([StatusCode]='Active');
CREATE INDEX IX_ProductionSpec_Matter ON dbo.ProductionSpec (MatterId, StatusCode);
GO

-- Production: A production of a matter: an incoming or outgoing delivery with volume, Bates range, counts and an optional spec.
CREATE TABLE dbo.Production (
  ProductionId     INT IDENTITY(1,1) NOT NULL,
  MatterId         INT NOT NULL,
  Name             NVARCHAR(200) NOT NULL,
  VolumeNo         NVARCHAR(50) NULL,
  DirectionCode    VARCHAR(3) NOT NULL,
  PartyName        NVARCHAR(200) NULL,
  ProductionSpecId INT NULL,
  BatesBegin       NVARCHAR(50) NULL,
  BatesEnd         NVARCHAR(50) NULL,
  DocCount         INT NULL,
  PageCount        INT NULL,
  DeliveredOrDueOn DATE NULL,
  Notes            NVARCHAR(4000) NULL,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_Production_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_Production PRIMARY KEY (ProductionId),
  CONSTRAINT UQ_Production_IdMatter UNIQUE (ProductionId, MatterId),
  CONSTRAINT CK_Production_Direction CHECK (DirectionCode IN ('OUT', 'IN')),
  CONSTRAINT CK_Production_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT CK_Production_Counts CHECK ((DocCount IS NULL OR DocCount >= 0) AND (PageCount IS NULL OR PageCount >= 0)),
  CONSTRAINT FK_Production_Matter FOREIGN KEY (MatterId) REFERENCES dbo.Matter (MatterId),
  CONSTRAINT FK_Production_Spec FOREIGN KEY (ProductionSpecId, MatterId) REFERENCES dbo.ProductionSpec (ProductionSpecId, MatterId),
  CONSTRAINT FK_Production_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Production_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_Production_Matter ON dbo.Production (MatterId, DirectionCode) INCLUDE (ProductionSpecId, DeliveredOrDueOn);
CREATE INDEX IX_Production_Spec ON dbo.Production (ProductionSpecId) WHERE ([ProductionSpecId] IS NOT NULL);
GO

-- ProductionComment: A comment on a production.
CREATE TABLE dbo.ProductionComment (
  ProductionCommentId INT IDENTITY(1,1) NOT NULL,
  ProductionId        INT NOT NULL,
  MatterId            INT NOT NULL,
  Body                NVARCHAR(4000) NOT NULL,
  CreatedAt           DATETIME2 NOT NULL CONSTRAINT DF_ProductionComment_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId     INT NULL,
  ModifiedAt          DATETIME2 NULL,
  ModifiedByUserId    INT NULL,
  RowVersion          ROWVERSION NOT NULL,
  CONSTRAINT PK_ProductionComment PRIMARY KEY (ProductionCommentId),
  CONSTRAINT CK_ProductionComment_Body CHECK (LEN(LTRIM(RTRIM(Body))) > 0),
  CONSTRAINT FK_ProductionComment_Production FOREIGN KEY (ProductionId, MatterId) REFERENCES dbo.Production (ProductionId, MatterId) ON DELETE CASCADE,
  CONSTRAINT FK_ProductionComment_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_ProductionComment_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_ProductionComment_Production ON dbo.ProductionComment (ProductionId, ProductionCommentId);
GO

-- === Notes =================================================================================================================

-- NoteTag: Firm-wide list of note tags.
CREATE TABLE dbo.NoteTag (
  NoteTagId        INT IDENTITY(1,1) NOT NULL,
  Name             NVARCHAR(60) NOT NULL,
  ColourKey        VARCHAR(20) NULL,
  IsActive         BIT NOT NULL CONSTRAINT DF_NoteTag_IsActive DEFAULT 1,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_NoteTag_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_NoteTag PRIMARY KEY (NoteTagId),
  CONSTRAINT CK_NoteTag_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT FK_NoteTag_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_NoteTag_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE UNIQUE INDEX UQ_NoteTag_Name ON dbo.NoteTag (Name);
GO

-- Note: A rich text note of a matter (HTML body plus plain text), with pinning and a lock held by one person.
CREATE TABLE dbo.Note (
  NoteId                 INT IDENTITY(1,1) NOT NULL,
  MatterId               INT NOT NULL,
  Title                  NVARCHAR(300) NOT NULL CONSTRAINT DF_Note_Title DEFAULT N'',
  Snippet                NVARCHAR(300) NOT NULL CONSTRAINT DF_Note_Snippet DEFAULT N'',
  BodyHtml               NVARCHAR(MAX) NOT NULL CONSTRAINT DF_Note_BodyHtml DEFAULT N'',
  BodyText               NVARCHAR(MAX) NOT NULL CONSTRAINT DF_Note_BodyText DEFAULT N'',
  IsPinned               BIT NOT NULL CONSTRAINT DF_Note_IsPinned DEFAULT 0,
  LockedByUserId         INT NULL,
  LockedAt               DATETIME2 NULL,
  ContentUpdatedAt       DATETIME2 NOT NULL CONSTRAINT DF_Note_ContentUpdatedAt DEFAULT SYSUTCDATETIME(),
  ContentUpdatedByUserId INT NULL,
  CreatedAt              DATETIME2 NOT NULL CONSTRAINT DF_Note_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId        INT NULL,
  ModifiedAt             DATETIME2 NULL,
  ModifiedByUserId       INT NULL,
  RowVersion             ROWVERSION NOT NULL,
  CONSTRAINT PK_Note PRIMARY KEY (NoteId),
  CONSTRAINT UQ_Note_IdMatter UNIQUE (NoteId, MatterId),
  CONSTRAINT CK_Note_Lock CHECK ((LockedByUserId IS NULL AND LockedAt IS NULL) OR (LockedByUserId IS NOT NULL AND LockedAt IS NOT NULL)),
  CONSTRAINT FK_Note_Matter FOREIGN KEY (MatterId) REFERENCES dbo.Matter (MatterId),
  CONSTRAINT FK_Note_LockedBy FOREIGN KEY (LockedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Note_ContentUpdatedBy FOREIGN KEY (ContentUpdatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Note_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Note_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_Note_Matter ON dbo.Note (MatterId, IsPinned DESC, ContentUpdatedAt DESC) INCLUDE (LockedByUserId);
GO

-- NoteTagLink: Junction: tags on a note.
CREATE TABLE dbo.NoteTagLink (
  NoteId    INT NOT NULL,
  NoteTagId INT NOT NULL,
  CONSTRAINT PK_NoteTagLink PRIMARY KEY (NoteId, NoteTagId),
  CONSTRAINT FK_NoteTagLink_Note FOREIGN KEY (NoteId) REFERENCES dbo.Note (NoteId) ON DELETE CASCADE,
  CONSTRAINT FK_NoteTagLink_Tag FOREIGN KEY (NoteTagId) REFERENCES dbo.NoteTag (NoteTagId)
);
GO

CREATE INDEX IX_NoteTagLink_Tag ON dbo.NoteTagLink (NoteTagId, NoteId);
GO

-- NoteLink: A link from a note to another record (user, note, matter, project or asset).
CREATE TABLE dbo.NoteLink (
  NoteId     INT NOT NULL,
  TargetType VARCHAR(10) NOT NULL,
  TargetId   INT NOT NULL,
  CONSTRAINT PK_NoteLink PRIMARY KEY (NoteId, TargetType, TargetId),
  CONSTRAINT CK_NoteLink_Type CHECK (TargetType IN ('ASSET', 'PROJECT', 'MATTER', 'NOTE', 'USER')),
  CONSTRAINT FK_NoteLink_Note FOREIGN KEY (NoteId) REFERENCES dbo.Note (NoteId) ON DELETE CASCADE
);
GO

CREATE INDEX IX_NoteLink_Target ON dbo.NoteLink (TargetType, TargetId, NoteId);
GO

-- NoteTemplate: A starting text for a note at one of three levels: System, Client or Matter.
CREATE TABLE dbo.NoteTemplate (
  NoteTemplateId   INT IDENTITY(1,1) NOT NULL,
  ScopeCode        VARCHAR(6) NOT NULL,
  MatterId         INT NULL,
  Name             NVARCHAR(100) NOT NULL,
  Description      NVARCHAR(160) NULL,
  TitleTemplate    NVARCHAR(300) NULL,
  BodyHtml         NVARCHAR(MAX) NOT NULL CONSTRAINT DF_NoteTemplate_BodyHtml DEFAULT N'',
  UsedCount        INT NOT NULL CONSTRAINT DF_NoteTemplate_UsedCount DEFAULT 0,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_NoteTemplate_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  ClientId         INT NULL,
  CONSTRAINT PK_NoteTemplate PRIMARY KEY (NoteTemplateId),
  CONSTRAINT CK_NoteTemplate_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT CK_NoteTemplate_Used CHECK (UsedCount >= 0),
  CONSTRAINT CK_NoteTemplate_Level CHECK ((ScopeCode = 'SYSTEM' AND ClientId IS NULL AND MatterId IS NULL) OR (ScopeCode = 'CLIENT' AND ClientId IS NOT NULL AND MatterId IS NULL) OR (ScopeCode = 'MATTER' AND MatterId IS NOT NULL AND ClientId IS NULL)),
  CONSTRAINT FK_NoteTemplate_Matter FOREIGN KEY (MatterId) REFERENCES dbo.Matter (MatterId),
  CONSTRAINT FK_NoteTemplate_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_NoteTemplate_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_NoteTemplate_Client FOREIGN KEY (ClientId) REFERENCES dbo.Client (ClientId)
);
GO

CREATE UNIQUE INDEX UQ_NoteTemplate_SystemName ON dbo.NoteTemplate (Name) WHERE ([ScopeCode]='SYSTEM');
CREATE UNIQUE INDEX UQ_NoteTemplate_MatterName ON dbo.NoteTemplate (MatterId, Name) WHERE ([MatterId] IS NOT NULL);
CREATE UNIQUE INDEX UQ_NoteTemplate_ClientName ON dbo.NoteTemplate (ClientId, Name) WHERE ([ClientId] IS NOT NULL);
GO

-- NoteTemplateTag: Junction: suggested tags of a note template.
CREATE TABLE dbo.NoteTemplateTag (
  NoteTemplateId INT NOT NULL,
  NoteTagId      INT NOT NULL,
  CONSTRAINT PK_NoteTemplateTag PRIMARY KEY (NoteTemplateId, NoteTagId),
  CONSTRAINT FK_NoteTemplateTag_Template FOREIGN KEY (NoteTemplateId) REFERENCES dbo.NoteTemplate (NoteTemplateId) ON DELETE CASCADE,
  CONSTRAINT FK_NoteTemplateTag_Tag FOREIGN KEY (NoteTagId) REFERENCES dbo.NoteTag (NoteTagId)
);
GO

-- === Reports ===============================================================================================================

-- ReportCategory: A category to group reports.
CREATE TABLE dbo.ReportCategory (
  ReportCategoryId INT IDENTITY(1,1) NOT NULL,
  Name             NVARCHAR(100) NOT NULL,
  SortOrder        INT NOT NULL CONSTRAINT DF_ReportCategory_SortOrder DEFAULT 0,
  IsActive         BIT NOT NULL CONSTRAINT DF_ReportCategory_IsActive DEFAULT 1,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_ReportCategory_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_ReportCategory PRIMARY KEY (ReportCategoryId),
  CONSTRAINT UQ_ReportCategory_Name UNIQUE (Name),
  CONSTRAINT CK_ReportCategory_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT FK_ReportCategory_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_ReportCategory_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

-- ReportDefinition: A report: name, category, current version, timeout and row limit.
CREATE TABLE dbo.ReportDefinition (
  ReportId               INT IDENTITY(1,1) NOT NULL,
  ReportCategoryId       INT NOT NULL,
  Name                   NVARCHAR(150) NOT NULL,
  Description            NVARCHAR(1000) NULL,
  HelpText               NVARCHAR(MAX) NULL,
  SortOrder              INT NOT NULL CONSTRAINT DF_ReportDefinition_SortOrder DEFAULT 0,
  IsActive               BIT NOT NULL CONSTRAINT DF_ReportDefinition_IsActive DEFAULT 0,
  CurrentVersionId       INT NULL,
  TimeoutSeconds         INT NULL,
  MaxRows                INT NULL,
  LastPreviewOkVersionId INT NULL,
  CreatedAt              DATETIME2 NOT NULL CONSTRAINT DF_ReportDefinition_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId        INT NULL,
  ModifiedAt             DATETIME2 NULL,
  ModifiedByUserId       INT NULL,
  RowVersion             ROWVERSION NOT NULL,
  CONSTRAINT PK_ReportDefinition PRIMARY KEY (ReportId),
  CONSTRAINT UQ_ReportDefinition_Name UNIQUE (Name),
  CONSTRAINT CK_ReportDefinition_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT CK_ReportDefinition_Timeout CHECK (TimeoutSeconds IS NULL OR TimeoutSeconds BETWEEN 1 AND 300),
  CONSTRAINT CK_ReportDefinition_MaxRows CHECK (MaxRows IS NULL OR MaxRows BETWEEN 1 AND 200000),
  CONSTRAINT CK_ReportDefinition_ActiveHasVersion CHECK (IsActive = 0 OR CurrentVersionId IS NOT NULL),
  CONSTRAINT FK_ReportDefinition_Category FOREIGN KEY (ReportCategoryId) REFERENCES dbo.ReportCategory (ReportCategoryId),
  CONSTRAINT FK_ReportDefinition_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_ReportDefinition_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_ReportDefinition_Category ON dbo.ReportDefinition (ReportCategoryId, SortOrder);
CREATE INDEX IX_ReportDefinition_CurrentVersion ON dbo.ReportDefinition (CurrentVersionId) WHERE ([CurrentVersionId] IS NOT NULL);
CREATE INDEX IX_ReportDefinition_PreviewVersion ON dbo.ReportDefinition (LastPreviewOkVersionId) WHERE ([LastPreviewOkVersionId] IS NOT NULL);
GO

-- ReportVersion: One version of a report's SQL text and parameters.
CREATE TABLE dbo.ReportVersion (
  ReportVersionId INT IDENTITY(1,1) NOT NULL,
  ReportId        INT NOT NULL,
  VersionNo       INT NOT NULL,
  SqlText         NVARCHAR(MAX) NOT NULL,
  SqlHash         BINARY(32) NOT NULL,
  ParametersJson  NVARCHAR(MAX) NOT NULL CONSTRAINT DF_ReportVersion_ParametersJson DEFAULT N'[]',
  ChangeNote      NVARCHAR(300) NULL,
  CreatedAt       DATETIME2 NOT NULL CONSTRAINT DF_ReportVersion_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId INT NULL,
  CONSTRAINT PK_ReportVersion PRIMARY KEY (ReportVersionId),
  CONSTRAINT UQ_ReportVersion_ReportNo UNIQUE (ReportId, VersionNo),
  CONSTRAINT CK_ReportVersion_VersionNo CHECK (VersionNo >= 1),
  CONSTRAINT CK_ReportVersion_Sql CHECK (LEN(SqlText) > 0),
  CONSTRAINT CK_ReportVersion_ParametersJson CHECK (ISJSON(ParametersJson) = 1),
  CONSTRAINT FK_ReportVersion_Report FOREIGN KEY (ReportId) REFERENCES dbo.ReportDefinition (ReportId),
  CONSTRAINT FK_ReportVersion_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

-- ReportParameter: A typed parameter of a report (text, number, date, date range, yes or no, single, multi, lookup).
CREATE TABLE dbo.ReportParameter (
  ReportParameterId INT IDENTITY(1,1) NOT NULL,
  ReportId          INT NOT NULL,
  Name              VARCHAR(64) NOT NULL,
  Ordinal           INT NOT NULL CONSTRAINT DF_ReportParameter_Ordinal DEFAULT 0,
  Type              VARCHAR(20) NOT NULL,
  LookupKind        VARCHAR(20) NULL,
  LookupMulti       BIT NOT NULL CONSTRAINT DF_ReportParameter_LookupMulti DEFAULT 0,
  Label             NVARCHAR(100) NOT NULL,
  HelpText          NVARCHAR(300) NULL,
  DefaultJson       NVARCHAR(500) NULL,
  IsRequired        BIT NOT NULL CONSTRAINT DF_ReportParameter_IsRequired DEFAULT 0,
  OptionsKind       VARCHAR(10) NULL,
  OptionsJson       NVARCHAR(MAX) NULL,
  OptionsSql        NVARCHAR(MAX) NULL,
  SettingsJson      NVARCHAR(MAX) NULL,
  CONSTRAINT PK_ReportParameter PRIMARY KEY (ReportParameterId),
  CONSTRAINT UQ_ReportParameter_Name UNIQUE (ReportId, Name),
  CONSTRAINT CK_ReportParameter_Name CHECK (Name COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^A-Z0-9_]%' AND Name COLLATE Latin1_General_100_BIN2 NOT LIKE '[0-9]%' AND LEN(Name) > 0),
  CONSTRAINT CK_ReportParameter_Type CHECK (Type IN ('number', 'date', 'text', 'single', 'multi', 'daterange', 'yesno', 'lookup')),
  CONSTRAINT CK_ReportParameter_LookupKind CHECK (LookupKind IS NULL OR LookupKind IN ('matter', 'client', 'user', 'pod', 'role', 'taskType')),
  CONSTRAINT CK_ReportParameter_OptionsKind CHECK (OptionsKind IS NULL OR OptionsKind IN ('fixed', 'query')),
  CONSTRAINT CK_ReportParameter_Json CHECK ((OptionsJson IS NULL OR ISJSON(OptionsJson) = 1) AND (SettingsJson IS NULL OR ISJSON(SettingsJson) = 1)),
  CONSTRAINT FK_ReportParameter_Report FOREIGN KEY (ReportId) REFERENCES dbo.ReportDefinition (ReportId)
);
GO

-- RoleReport: Junction: reports a role may run.
CREATE TABLE dbo.RoleReport (
  RoleId          INT NOT NULL,
  ReportId        INT NOT NULL,
  GrantedAt       DATETIME2 NOT NULL CONSTRAINT DF_RoleReport_GrantedAt DEFAULT SYSUTCDATETIME(),
  GrantedByUserId INT NULL,
  CONSTRAINT PK_RoleReport PRIMARY KEY (RoleId, ReportId),
  CONSTRAINT FK_RoleReport_Role FOREIGN KEY (RoleId) REFERENCES dbo.Role (RoleId),
  CONSTRAINT FK_RoleReport_Report FOREIGN KEY (ReportId) REFERENCES dbo.ReportDefinition (ReportId),
  CONSTRAINT FK_RoleReport_GrantedBy FOREIGN KEY (GrantedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_RoleReport_Report ON dbo.RoleReport (ReportId);
GO

-- SavedReportView: A person's saved view (columns, sort, filters, parameters) of a report.
CREATE TABLE dbo.SavedReportView (
  SavedReportViewId INT IDENTITY(1,1) NOT NULL,
  ReportId          INT NOT NULL,
  UserId            INT NOT NULL,
  Name              NVARCHAR(100) NOT NULL,
  IsDefault         BIT NOT NULL CONSTRAINT DF_SavedReportView_IsDefault DEFAULT 0,
  ViewJson          NVARCHAR(MAX) NOT NULL,
  ParamsJson        NVARCHAR(MAX) NULL,
  CreatedAt         DATETIME2 NOT NULL CONSTRAINT DF_SavedReportView_CreatedAt DEFAULT SYSUTCDATETIME(),
  ModifiedAt        DATETIME2 NULL,
  RowVersion        ROWVERSION NOT NULL,
  CONSTRAINT PK_SavedReportView PRIMARY KEY (SavedReportViewId),
  CONSTRAINT UQ_SavedReportView_Name UNIQUE (ReportId, UserId, Name),
  CONSTRAINT CK_SavedReportView_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT CK_SavedReportView_Json CHECK (ISJSON(ViewJson) = 1 AND (ParamsJson IS NULL OR ISJSON(ParamsJson) = 1)),
  CONSTRAINT FK_SavedReportView_Report FOREIGN KEY (ReportId) REFERENCES dbo.ReportDefinition (ReportId),
  CONSTRAINT FK_SavedReportView_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE UNIQUE INDEX UX_SavedReportView_Default ON dbo.SavedReportView (ReportId, UserId) WHERE ([IsDefault]=(1));
CREATE INDEX IX_SavedReportView_User ON dbo.SavedReportView (UserId, ReportId);
GO

-- ReportFavourite: Junction: a person's pinned reports.
CREATE TABLE dbo.ReportFavourite (
  UserId   INT NOT NULL,
  ReportId INT NOT NULL,
  PinnedAt DATETIME2 NOT NULL CONSTRAINT DF_ReportFavourite_PinnedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_ReportFavourite PRIMARY KEY (UserId, ReportId),
  CONSTRAINT FK_ReportFavourite_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_ReportFavourite_Report FOREIGN KEY (ReportId) REFERENCES dbo.ReportDefinition (ReportId)
);
GO

-- ReportRecent: A person's most recently run reports.
CREATE TABLE dbo.ReportRecent (
  UserId    INT NOT NULL,
  ReportId  INT NOT NULL,
  LastRunAt DATETIME2 NOT NULL,
  CONSTRAINT PK_ReportRecent PRIMARY KEY (UserId, ReportId),
  CONSTRAINT FK_ReportRecent_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_ReportRecent_Report FOREIGN KEY (ReportId) REFERENCES dbo.ReportDefinition (ReportId)
);
GO

-- ReportRun: The run log: who ran which report version, when, with which parameters, status, rows and duration.
CREATE TABLE dbo.ReportRun (
  ReportRunId      BIGINT IDENTITY(1,1) NOT NULL,
  ReportId         INT NOT NULL,
  ReportVersionId  INT NOT NULL,
  UserId           INT NOT NULL,
  StartedAt        DATETIME2 NOT NULL CONSTRAINT DF_ReportRun_StartedAt DEFAULT SYSUTCDATETIME(),
  FinishedAt       DATETIME2 NULL,
  Status           VARCHAR(12) NOT NULL,
  Kind             VARCHAR(12) NOT NULL,
  ParametersJson   NVARCHAR(4000) NULL,
  [RowCount]       INT NULL,
  Truncated        BIT NOT NULL CONSTRAINT DF_ReportRun_Truncated DEFAULT 0,
  DurationMs       INT NULL,
  ErrorCode        VARCHAR(40) NULL,
  ExportedRowCount INT NULL,
  CorrelationId    UNIQUEIDENTIFIER NOT NULL,
  CONSTRAINT PK_ReportRun PRIMARY KEY (ReportRunId),
  CONSTRAINT CK_ReportRun_Status CHECK (Status IN ('Running', 'Succeeded', 'Failed', 'Cancelled', 'TimedOut', 'Truncated', 'Rejected')),
  CONSTRAINT CK_ReportRun_Kind CHECK (Kind IN ('Run', 'Preview', 'Export', 'ChoiceQuery')),
  CONSTRAINT CK_ReportRun_Json CHECK (ParametersJson IS NULL OR ISJSON(ParametersJson) = 1),
  CONSTRAINT FK_ReportRun_Report FOREIGN KEY (ReportId) REFERENCES dbo.ReportDefinition (ReportId),
  CONSTRAINT FK_ReportRun_Version FOREIGN KEY (ReportVersionId) REFERENCES dbo.ReportVersion (ReportVersionId),
  CONSTRAINT FK_ReportRun_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_ReportRun_User ON dbo.ReportRun (UserId, StartedAt DESC);
CREATE INDEX IX_ReportRun_Report ON dbo.ReportRun (ReportId, StartedAt DESC);
CREATE INDEX IX_ReportRun_Started ON dbo.ReportRun (StartedAt);
GO

-- === Foreign keys of a circular reference ==============================================================================

ALTER TABLE dbo.AppUser ADD CONSTRAINT FK_AppUser_HolidayCalendar FOREIGN KEY (HolidayCalendarId) REFERENCES dbo.HolidayCalendar (CalendarId);
ALTER TABLE dbo.FormDefinition ADD CONSTRAINT FK_FormDef_AssetType FOREIGN KEY (AssetTypeId) REFERENCES dbo.AssetType (AssetTypeId);
ALTER TABLE dbo.FormDefinition ADD CONSTRAINT FK_FormDef_Step FOREIGN KEY (StepDefinitionId) REFERENCES dbo.StepDefinition (StepDefinitionId);
ALTER TABLE dbo.ReportDefinition ADD CONSTRAINT FK_ReportDefinition_CurrentVersion FOREIGN KEY (CurrentVersionId) REFERENCES dbo.ReportVersion (ReportVersionId);
ALTER TABLE dbo.ReportDefinition ADD CONSTRAINT FK_ReportDefinition_LastPreviewOkVersion FOREIGN KEY (LastPreviewOkVersionId) REFERENCES dbo.ReportVersion (ReportVersionId);
GO

-- -----------------------------------------------------------------------------------------------------------------------------
-- Structural seed data (loaded before the triggers, because TR_TaskStatusLabel_FixedCodes refuses inserts)
-- (permission catalog rows are kept in step with contracts/permissions.json by the application at startup; the rows below are the
-- ones the foreign keys and the first start rely on)
-- -----------------------------------------------------------------------------------------------------------------------------

SET IDENTITY_INSERT dbo.Role ON;
INSERT INTO dbo.Role (RoleId, Name, Description, IsSystemAdmin, IsActive) VALUES (1, N'System Admin', N'Built-in administrator role. Holds every permission and cannot be edited or deleted.', 1, 1);
SET IDENTITY_INSERT dbo.Role OFF;
GO

SET IDENTITY_INSERT dbo.Permission ON;
INSERT INTO dbo.Permission (PermissionId, Code, GroupName, Description, IsActive) VALUES
  (1, N'Dashboard.View', N'Dashboard', N'Open the Dashboard (the Dashboard menu item and page). Each tab below also needs its own permission', 1),
  (2, N'Dashboard.ViewSummary', N'Dashboard', N'Summary tab: headline counts, the unassigned queue, and the overdue and due soon lists', 1),
  (3, N'Dashboard.ViewBreakdowns', N'Dashboard', N'Breakdowns tab: open tasks by priority, task type and status, and their age', 1),
  (4, N'Dashboard.ViewTrends', N'Dashboard', N'Trends tab: tasks created and completed per day', 1),
  (5, N'Dashboard.ViewSwimlane', N'Dashboard', N'Swimlane tab: every open task on a board by status', 1),
  (6, N'Dashboard.ViewUsers', N'Dashboard', N'Users tab: team workload per person (open, overdue and due soon tasks)', 1),
  (7, N'Dashboard.ViewCoverage', N'Dashboard', N'See how many tasks each person completed per task type (training and coverage planning)', 1),
  (8, N'Dashboard.ViewUnassigned', N'Dashboard', N'See the unassigned task queue on the Dashboard Summary tab (assign work to yourself or others)', 1),
  (9, N'Matter.BeManager', N'Client/Matter', N'Can be named as a matter''s project manager (Primary or Secondary). A marker: it opens no screen by itself', 1),
  (10, N'Matter.AssignManagers', N'Client/Matter', N'Set or clear the Primary and Secondary project manager of matters, and search all matters on My Matters', 1),
  (11, N'Matter.ViewSensitive', N'Client/Matter', N'See all sensitive matters (every sensitive matter, with all its tasks and assets, regardless of manager or assignment). Grants access to every sensitive matter', 1),
  (12, N'Asset.Dispose', N'Assets', N'Move assets to Pending disposition or Disposed', 1),
  (13, N'Settings.Manage', N'Administration', N'Change application settings (name and icon)', 1),
  (14, N'ProductionSpec.View', N'Productions', N'View production specs', 1),
  (15, N'ProductionSpec.Edit', N'Productions', N'Create, edit, duplicate and retire production specs', 1),
  (16, N'Production.View', N'Productions', N'View productions', 1),
  (17, N'Production.Edit', N'Productions', N'Create, edit and delete productions', 1),
  (18, N'Production.Comment', N'Productions', N'Comment on productions', 1),
  (19, N'MatterNote.View', N'Notes', N'Matter Note Read', 1),
  (20, N'MatterNote.Edit', N'Notes', N'Matter Note Edit', 1),
  (21, N'MatterNote.Delete', N'Notes', N'Matter Note Delete', 1),
  (22, N'Dashboard.ViewCalendar', N'Dashboard', N'Open the Calendar tab: who is out and who can work each day, and holidays', 1),
  (23, N'Dashboard.ViewAbsenceReasons', N'Dashboard', N'See the type of an absence (vacation, sick, training) in the Calendar', 1),
  (24, N'User.ManageAvailability', N'Organization', N'Create, edit and delete Out of office entries of other people (a Pod Lead: members of their own pods)', 1),
  (25, N'Report.Run', N'Reports', N'Run the reports assigned to your roles, keep personal views and download the result as CSV', 1);
SET IDENTITY_INSERT dbo.Permission OFF;
GO

INSERT INTO dbo.TaskStatusLabel (StatusCode, DisplayLabel, SortOrder) VALUES
  (N'NEW', N'New', 1),
  (N'IN_PROGRESS', N'In Progress', 2),
  (N'ON_HOLD', N'On Hold', 3),
  (N'COMPLETED', N'Completed', 4),
  (N'CANCELLED', N'Cancelled', 5);
GO

-- -----------------------------------------------------------------------------------------------------------------------------
-- Functions (the visibility rules of epic #788; denied to the report login below)
-- -----------------------------------------------------------------------------------------------------------------------------

GO

CREATE FUNCTION dbo.fnAssetVisible (@UserId INT, @SeeAll BIT)
RETURNS TABLE
AS
RETURN
(
  SELECT a.AssetId, a.MatterId
  FROM dbo.Asset a
  WHERE ISNULL(@SeeAll, 0) = 1
     OR EXISTS (SELECT 1 FROM dbo.Matter m
                WHERE m.MatterId = a.MatterId
                  AND (m.IsSensitive = 0 OR (@UserId IS NOT NULL AND (m.PrimaryManagerId = @UserId OR m.SecondaryManagerId = @UserId))))
     OR (@UserId IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.TaskAsset ta JOIN dbo.Task t ON t.TaskId = ta.TaskId
                                         WHERE ta.AssetId = a.AssetId AND t.AssignedUserId = @UserId))
);
GO

CREATE FUNCTION dbo.fnMatterVisible (@UserId INT, @SeeAll BIT)
RETURNS TABLE
AS
RETURN
(
  SELECT m.MatterId
  FROM dbo.Matter m
  WHERE m.IsSensitive = 0
     OR ISNULL(@SeeAll, 0) = 1
     OR (@UserId IS NOT NULL AND (m.PrimaryManagerId = @UserId OR m.SecondaryManagerId = @UserId))
);
GO

CREATE FUNCTION dbo.fnTaskVisible (@UserId INT, @SeeAll BIT)
RETURNS TABLE
AS
RETURN
(
  SELECT t.TaskId, t.MatterId
  FROM dbo.Task t
  WHERE ISNULL(@SeeAll, 0) = 1
     OR EXISTS (SELECT 1 FROM dbo.Matter m
                WHERE m.MatterId = t.MatterId
                  AND (m.IsSensitive = 0 OR (@UserId IS NOT NULL AND (m.PrimaryManagerId = @UserId OR m.SecondaryManagerId = @UserId))))
     OR (@UserId IS NOT NULL AND t.AssignedUserId = @UserId)
);
GO

-- -----------------------------------------------------------------------------------------------------------------------------
-- Procedures
-- -----------------------------------------------------------------------------------------------------------------------------

GO

-- The one write path that completes a run (Running -> final status). Runs with the owner's rights, so the DENY UPDATE of mf_app does not apply.
CREATE PROCEDURE dbo.usp_ReportRunComplete
  @ReportRunId      BIGINT,
  @Status           VARCHAR(12),
  @RowCount         INT = NULL,
  @Truncated        BIT = 0,
  @DurationMs       INT = NULL,
  @ErrorCode        VARCHAR(40) = NULL,
  @ExportedRowCount INT = NULL
AS
BEGIN
  SET NOCOUNT ON;
  IF @Status NOT IN ('Succeeded', 'Failed', 'Cancelled', 'TimedOut', 'Truncated', 'Rejected')
    THROW 51013, 'Invalid final status for a report run.', 1;

  UPDATE dbo.ReportRun
  SET FinishedAt = SYSUTCDATETIME(), Status = @Status, [RowCount] = @RowCount, Truncated = @Truncated,
      DurationMs = @DurationMs, ErrorCode = @ErrorCode, ExportedRowCount = @ExportedRowCount
  WHERE ReportRunId = @ReportRunId AND Status = 'Running';

  SELECT @@ROWCOUNT AS Completed;
END;
GO

-- Retention: deletes runs older than two years (the trigger refuses anything younger). Scheduled by the app.
CREATE PROCEDURE dbo.usp_ReportRunPurge
  @MaxRows INT = 5000
AS
BEGIN
  SET NOCOUNT ON;
  DELETE TOP (@MaxRows) FROM dbo.ReportRun WHERE StartedAt < DATEADD(YEAR, -2, SYSUTCDATETIME());
  SELECT @@ROWCOUNT AS Purged;
END;
GO

-- -----------------------------------------------------------------------------------------------------------------------------
-- Triggers (guards: append-only and immutable rows, no deletes, sensitivity propagation)
-- -----------------------------------------------------------------------------------------------------------------------------

GO

-- An Asset never moves to another Matter, is never hard-deleted (deactivate instead) and keeps its number once it has one.
CREATE   TRIGGER dbo.TR_Asset_Guard ON dbo.Asset
AFTER UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;

  IF NOT EXISTS (SELECT 1 FROM inserted)
    THROW 51010, 'An asset cannot be deleted; set it inactive instead.', 1;

  IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.AssetId = i.AssetId WHERE i.MatterId <> d.MatterId)
    THROW 51011, 'An asset belongs to one matter and cannot move to another.', 1;

  IF EXISTS (
    SELECT 1 FROM inserted i JOIN deleted d ON d.AssetId = i.AssetId
    WHERE d.AssetNumber IS NOT NULL
      AND (i.AssetNumber IS NULL OR i.AssetNumberSeq IS NULL
           OR i.AssetNumber COLLATE Latin1_General_BIN2 <> d.AssetNumber COLLATE Latin1_General_BIN2
           OR i.AssetNumberSeq <> d.AssetNumberSeq))
    THROW 51014, 'An asset number is assigned once and cannot be changed or removed.', 1;
END;
GO

CREATE TRIGGER dbo.TR_AuditEvent_AppendOnly ON dbo.AuditEvent
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 51000, 'AuditEvent is append-only: UPDATE and DELETE are not allowed.', 1;
END;
GO

CREATE TRIGGER dbo.TR_FormField_Immutable ON dbo.FormField
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (
    SELECT 1
    FROM (SELECT FormVersionId FROM inserted UNION SELECT FormVersionId FROM deleted) x
    JOIN dbo.FormVersion v ON v.FormVersionId = x.FormVersionId
    WHERE v.Status <> 'DRAFT')
    THROW 51004, 'Fields of a published or retired form version are immutable.', 1;
END;
GO

CREATE TRIGGER dbo.TR_FormFieldOption_Immutable ON dbo.FormFieldOption
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (
    SELECT 1
    FROM (SELECT FormFieldId FROM inserted UNION SELECT FormFieldId FROM deleted) x
    JOIN dbo.FormField f ON f.FormFieldId = x.FormFieldId
    JOIN dbo.FormVersion v ON v.FormVersionId = f.FormVersionId
    WHERE v.Status <> 'DRAFT')
    THROW 51005, 'Options of a published or retired form version are immutable.', 1;
END;
GO

-- Immutability (architecture 7.2). A version may change freely while DRAFT. Once PUBLISHED it can only become RETIRED (the
-- other columns stay equal; audit stamps and the rowversion may move), and it is never deleted. Retired is final.
CREATE TRIGGER dbo.TR_FormVersion_Immutable ON dbo.FormVersion
AFTER UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (SELECT 1 FROM deleted d WHERE d.Status <> 'DRAFT')
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM inserted)
      THROW 51001, 'A published or retired form version is immutable and cannot be deleted.', 1;

    -- Every pre-update row that was not a draft must be a PUBLISHED row becoming RETIRED ...
    IF EXISTS (
      SELECT 1 FROM deleted d JOIN inserted i ON i.FormVersionId = d.FormVersionId
      WHERE d.Status <> 'DRAFT' AND NOT (d.Status = 'PUBLISHED' AND i.Status = 'RETIRED'))
      THROW 51002, 'A published or retired form version is immutable (only PUBLISHED to RETIRED is allowed).', 1;

    -- ... and nothing else about it may change.
    IF EXISTS (
      SELECT d.FormVersionId, d.FormDefinitionId, d.VersionNo, d.ClonedFromVersionId, d.PublishedAt, d.PublishedByUserId, d.Notes, d.CreatedAt, d.CreatedByUserId
      FROM deleted d WHERE d.Status <> 'DRAFT'
      EXCEPT
      SELECT i.FormVersionId, i.FormDefinitionId, i.VersionNo, i.ClonedFromVersionId, i.PublishedAt, i.PublishedByUserId, i.Notes, i.CreatedAt, i.CreatedByUserId
      FROM inserted i)
      THROW 51003, 'A published or retired form version is immutable (only its status may change to RETIRED).', 1;
  END
END;
GO

CREATE TRIGGER dbo.TR_Matter_SensitivityToTask ON dbo.Matter
AFTER UPDATE
AS
BEGIN
  SET NOCOUNT ON;
  IF NOT UPDATE(IsSensitive)
    RETURN;

  UPDATE t SET IsMatterSensitive = i.IsSensitive
  FROM dbo.Task t
  JOIN inserted i ON i.MatterId = t.MatterId
  JOIN deleted d ON d.MatterId = i.MatterId
  WHERE i.IsSensitive <> d.IsSensitive
    AND t.IsMatterSensitive <> i.IsSensitive;
END;
GO

CREATE TRIGGER dbo.TR_ProductionSpec_Guard ON dbo.ProductionSpec AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF UPDATE(MatterId) AND EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.ProductionSpecId = i.ProductionSpecId WHERE i.MatterId <> d.MatterId)
  BEGIN
    THROW 50000, 'A production spec belongs to one matter and cannot move to another.', 1;
  END
END;
GO

-- The run log is append-only: the identity of a run never changes (only the completion columns, once), and a row may be deleted
-- only after the two-year retention (dbo.usp_ReportRunPurge).
CREATE TRIGGER dbo.TR_ReportRun_Guard ON dbo.ReportRun
AFTER UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM inserted)
  BEGIN
    IF EXISTS (SELECT 1 FROM deleted WHERE StartedAt >= DATEADD(YEAR, -2, SYSUTCDATETIME()))
    BEGIN
      ROLLBACK;
      THROW 51011, 'Report runs are kept for two years and cannot be deleted before that.', 1;
    END;
    RETURN;
  END;

  IF UPDATE(ReportRunId) OR UPDATE(ReportId) OR UPDATE(ReportVersionId) OR UPDATE(UserId) OR UPDATE(StartedAt)
     OR UPDATE(Kind) OR UPDATE(ParametersJson) OR UPDATE(CorrelationId)
     OR EXISTS (SELECT 1 FROM deleted WHERE Status <> 'Running')
  BEGIN
    ROLLBACK;
    THROW 51012, 'A report run can only be completed once; its other columns never change.', 1;
  END;
END;
GO

-- Append-only: a published version is never changed or removed (not even by a privileged login, short of disabling the trigger).
CREATE TRIGGER dbo.TR_ReportVersion_AppendOnly ON dbo.ReportVersion
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51010, 'Report versions are append-only: they cannot be changed or deleted.', 1;
END;
GO

CREATE TRIGGER dbo.TR_StepInstance_Immutable ON dbo.StepInstance
AFTER UPDATE
AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (
    SELECT 1 FROM inserted i JOIN deleted d ON d.StepInstanceId = i.StepInstanceId
    WHERE i.WorkflowInstanceId <> d.WorkflowInstanceId OR i.WorkflowVersionStepId <> d.WorkflowVersionStepId OR i.SequenceNo <> d.SequenceNo
       OR i.Title <> d.Title OR ISNULL(i.Description, N'') <> ISNULL(d.Description, N'')
       OR ISNULL(i.Instructions, N'') <> ISNULL(d.Instructions, N'') OR ISNULL(i.DocumentationUrl, N'') <> ISNULL(d.DocumentationUrl, N'')
       OR i.IsSkippable <> d.IsSkippable OR i.SkipCommentRequired <> d.SkipCommentRequired
       OR ISNULL(i.InputFormVersionId, 0) <> ISNULL(d.InputFormVersionId, 0)
       OR (d.FirstResolvedAt IS NOT NULL AND (i.FirstResolvedAt IS NULL OR i.FirstResolvedAt <> d.FirstResolvedAt)))
    THROW 51022, 'The configuration snapshot of a step instance cannot be changed.', 1;
END;
GO

CREATE TRIGGER dbo.TR_Task_Immutable ON dbo.Task
AFTER UPDATE
AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (
    SELECT 1 FROM inserted i JOIN deleted d ON d.TaskId = i.TaskId
    WHERE i.MatterId <> d.MatterId
       OR i.TaskTypeId <> d.TaskTypeId
       OR i.WorkflowInstanceId <> d.WorkflowInstanceId
       OR i.TaskNumber <> d.TaskNumber
       OR ISNULL(i.FormVersionId, 0) <> ISNULL(d.FormVersionId, 0))
    THROW 51030, 'A task''s matter, task type, workflow and request form version cannot be changed after creation.', 1;
END;
GO

CREATE TRIGGER dbo.TR_Task_MatterSensitivityInsert ON dbo.Task
AFTER INSERT
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE t SET IsMatterSensitive = m.IsSensitive
  FROM dbo.Task t
  JOIN inserted i ON i.TaskId = t.TaskId
  JOIN dbo.Matter m ON m.MatterId = t.MatterId
  WHERE t.IsMatterSensitive <> m.IsSensitive;
END;
GO

-- Tasks are retained for good: Cancel instead of delete.
CREATE TRIGGER dbo.TR_Task_NoDelete ON dbo.Task
INSTEAD OF DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51031, 'Tasks cannot be deleted; cancel the task instead.', 1;
END;
GO

-- A comment never moves to another Task or changes its purpose, and no comment is ever physically deleted (soft delete only).
CREATE TRIGGER dbo.TR_TaskComment_Guard ON dbo.TaskComment
AFTER UPDATE
AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (
    SELECT 1 FROM inserted i JOIN deleted d ON d.TaskCommentId = i.TaskCommentId
    WHERE i.TaskId <> d.TaskId OR i.Purpose <> d.Purpose OR i.AuthorUserId <> d.AuthorUserId)
    THROW 51032, 'A task comment cannot change its task, author or purpose.', 1;
END;
GO

CREATE TRIGGER dbo.TR_TaskComment_NoDelete ON dbo.TaskComment
INSTEAD OF DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51033, 'Task comments cannot be deleted; they are soft-deleted and retained.', 1;
END;
GO

CREATE TRIGGER dbo.TR_TaskCommentRevision_AppendOnly ON dbo.TaskCommentRevision
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51040, 'Comment revisions are append-only: UPDATE and DELETE are not allowed.', 1;
END;
GO

-- The status code set is fixed (addendum O): rows cannot be added, removed, or re-coded, by anyone.
CREATE TRIGGER dbo.TR_TaskStatusLabel_FixedCodes ON dbo.TaskStatusLabel
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        RETURN;
    IF NOT EXISTS (SELECT 1 FROM deleted)
        THROW 51001, 'TaskStatusLabel codes are fixed: rows cannot be inserted.', 1;
    IF NOT EXISTS (SELECT 1 FROM inserted)
        THROW 51002, 'TaskStatusLabel codes are fixed: rows cannot be deleted.', 1;
    IF UPDATE(StatusCode)
        THROW 51003, 'TaskStatusLabel codes are immutable.', 1;
END;
GO

-- An instance stays pinned to the version (and ordering mode) it was created from; step snapshot fields never change after creation.
CREATE TRIGGER dbo.TR_WorkflowInstance_Immutable ON dbo.WorkflowInstance
AFTER UPDATE
AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (
    SELECT 1 FROM inserted i JOIN deleted d ON d.WorkflowInstanceId = i.WorkflowInstanceId
    WHERE i.WorkflowVersionId <> d.WorkflowVersionId OR i.IsOrdered <> d.IsOrdered)
    THROW 51021, 'A workflow instance is pinned to its workflow version and cannot be moved.', 1;
END;
GO

-- Immutability (same pattern as forms, TR_FormVersion_Immutable). A version may change freely while DRAFT. Once PUBLISHED it can only
-- become RETIRED (every other column stays equal; audit stamps and the rowversion may move), and it is never deleted. Retired is final.
CREATE TRIGGER dbo.TR_WorkflowVersion_Immutable ON dbo.WorkflowVersion
AFTER UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (SELECT 1 FROM deleted d WHERE d.Status <> 'DRAFT')
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM inserted)
      THROW 51011, 'A published or retired workflow version is immutable and cannot be deleted.', 1;

    IF EXISTS (
      SELECT 1 FROM deleted d JOIN inserted i ON i.WorkflowVersionId = d.WorkflowVersionId
      WHERE d.Status <> 'DRAFT' AND NOT (d.Status = 'PUBLISHED' AND i.Status = 'RETIRED'))
      THROW 51012, 'A published or retired workflow version is immutable (only PUBLISHED to RETIRED is allowed).', 1;

    IF EXISTS (
      SELECT d.WorkflowVersionId, d.WorkflowDefinitionId, d.VersionNo, d.IsOrdered, d.PublishedAt, d.PublishedByUserId, d.CreatedAt, d.CreatedByUserId
      FROM deleted d WHERE d.Status <> 'DRAFT'
      EXCEPT
      SELECT i.WorkflowVersionId, i.WorkflowDefinitionId, i.VersionNo, i.IsOrdered, i.PublishedAt, i.PublishedByUserId, i.CreatedAt, i.CreatedByUserId
      FROM inserted i)
      THROW 51013, 'A published or retired workflow version is immutable (only its status may change to RETIRED).', 1;
  END
END;
GO

CREATE TRIGGER dbo.TR_WorkflowVersionStep_Immutable ON dbo.WorkflowVersionStep
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (
    SELECT 1
    FROM (SELECT WorkflowVersionId FROM inserted UNION SELECT WorkflowVersionId FROM deleted) x
    JOIN dbo.WorkflowVersion v ON v.WorkflowVersionId = x.WorkflowVersionId
    WHERE v.Status <> 'DRAFT')
    THROW 51014, 'Steps of a published or retired workflow version are immutable.', 1;
END;
GO

-- -----------------------------------------------------------------------------------------------------------------------------
-- Database DDL trigger: protects the audit tables (created after everything above is in place)
-- -----------------------------------------------------------------------------------------------------------------------------

GO

CREATE TRIGGER TR_Protect_AuditEvent ON DATABASE
FOR DROP_TABLE, ALTER_TABLE, DROP_TRIGGER, ALTER_TRIGGER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @event xml = EVENTDATA();
    DECLARE @object sysname = @event.value('(/EVENT_INSTANCE/ObjectName)[1]', 'sysname');
    DECLARE @target sysname = @event.value('(/EVENT_INSTANCE/TargetObjectName)[1]', 'sysname');
    DECLARE @type sysname = @event.value('(/EVENT_INSTANCE/EventType)[1]', 'sysname');

    -- ALTER TABLE on the audit table stays possible for later schema scripts (new columns, FKs); the guard table may not be altered at
    -- all (that would allow dropping its foreign key, and with it the TRUNCATE guard).
    IF (@type = N'ALTER_TABLE' AND @object = N'AuditEventGuard')
       OR (@type <> N'ALTER_TABLE' AND (@object IN (N'AuditEvent', N'AuditEventGuard', N'TR_AuditEvent_AppendOnly', N'TR_Protect_AuditEvent')
                                        OR @target IN (N'AuditEvent', N'AuditEventGuard')))
    BEGIN
        ROLLBACK;
        THROW 51001, 'The audit trail is protected: its tables and the append-only trigger cannot be dropped or altered this way.', 1;
    END;
END;
GO

-- -----------------------------------------------------------------------------------------------------------------------------
-- Database roles and permissions
-- -----------------------------------------------------------------------------------------------------------------------------

-- mf_app: the application identity (data access and EXECUTE only, no DDL). mf_migrator: the schema runner (DDL plus data).
-- mf_report_reader: the read-only role every report runs under (db/report-access.json; membership comes from tools/db/provision-report-login.sql or the DBA).
-- DBA step after the first deployment (logins are server level and site specific):
--   CREATE USER [DOMAIN\app-pool-gmsa$] FOR LOGIN [DOMAIN\app-pool-gmsa$];  ALTER ROLE mf_app ADD MEMBER [DOMAIN\app-pool-gmsa$];
-- The application identity must NOT be db_owner or sysadmin; the API verifies this at startup (docs/runbook.md section 3).
IF DATABASE_PRINCIPAL_ID('mf_app') IS NULL
  CREATE ROLE mf_app;
IF DATABASE_PRINCIPAL_ID('mf_migrator') IS NULL
  CREATE ROLE mf_migrator;
IF DATABASE_PRINCIPAL_ID('mf_report_reader') IS NULL
  CREATE ROLE mf_report_reader;
GO

GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON SCHEMA::dbo TO mf_app;
ALTER ROLE db_ddladmin ADD MEMBER mf_migrator;
ALTER ROLE db_datareader ADD MEMBER mf_migrator;
ALTER ROLE db_datawriter ADD MEMBER mf_migrator;
GRANT EXECUTE ON SCHEMA::dbo TO mf_migrator;
GO

-- The report role: nothing that writes, executes or changes the schema, whatever else the login might inherit.
-- (No DENY CONTROL: CONTROL implies every right, so denying it would also deny the SELECT grants below.)
DENY INSERT, UPDATE, DELETE, EXECUTE, ALTER, REFERENCES, TAKE OWNERSHIP ON SCHEMA::dbo TO mf_report_reader;
DENY CREATE TABLE, CREATE VIEW, CREATE PROCEDURE, CREATE FUNCTION, CREATE SCHEMA, CREATE TYPE, CREATE RULE, CREATE DEFAULT TO mf_report_reader;
GO

-- Application identity: object-level rights. A DENY here beats the schema-level GRANT above (append-only, guard and counter tables).
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.AppSetting TO mf_app;
DENY ALTER ON dbo.AppSetting TO mf_app;
GRANT SELECT, INSERT, UPDATE ON dbo.AssetNumberCounter TO mf_app;
DENY DELETE, ALTER ON dbo.AssetNumberCounter TO mf_app;
GRANT SELECT, INSERT ON dbo.AuditEvent TO mf_app;
DENY UPDATE, DELETE, ALTER ON dbo.AuditEvent TO mf_app;
DENY SELECT, INSERT, UPDATE, DELETE, REFERENCES, ALTER ON dbo.AuditEventGuard TO mf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.CurrentState TO mf_app;
DENY ALTER ON dbo.CurrentState TO mf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Holiday TO mf_app;
DENY ALTER ON dbo.Holiday TO mf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.HolidayCalendar TO mf_app;
DENY ALTER ON dbo.HolidayCalendar TO mf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.MatterEvent TO mf_app;
DENY ALTER ON dbo.MatterEvent TO mf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.MatterTeamMember TO mf_app;
DENY ALTER ON dbo.MatterTeamMember TO mf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.MatterType TO mf_app;
DENY ALTER ON dbo.MatterType TO mf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Note TO mf_app;
DENY ALTER ON dbo.Note TO mf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.NoteLink TO mf_app;
DENY ALTER ON dbo.NoteLink TO mf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.NoteTag TO mf_app;
DENY ALTER ON dbo.NoteTag TO mf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.NoteTagLink TO mf_app;
DENY ALTER ON dbo.NoteTagLink TO mf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.NoteTemplate TO mf_app;
DENY ALTER ON dbo.NoteTemplate TO mf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.NoteTemplateTag TO mf_app;
DENY ALTER ON dbo.NoteTemplateTag TO mf_app;
GRANT SELECT, INSERT, DELETE ON dbo.Notification TO mf_app;
DENY ALTER ON dbo.Notification TO mf_app;
DENY UPDATE (ActorUserId, CreatedUtc, DedupeKey, EventType, MatterId, Message, ObjectId, ObjectKind, RecipientUserId) ON dbo.Notification TO mf_app;
GRANT SELECT, INSERT, DELETE ON dbo.NotificationPreference TO mf_app;
DENY ALTER ON dbo.NotificationPreference TO mf_app;
DENY UPDATE (EventType, UserId) ON dbo.NotificationPreference TO mf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Production TO mf_app;
DENY ALTER ON dbo.Production TO mf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.ProductionComment TO mf_app;
DENY ALTER ON dbo.ProductionComment TO mf_app;
GRANT SELECT, INSERT, UPDATE ON dbo.ProductionSpec TO mf_app;
DENY DELETE, ALTER ON dbo.ProductionSpec TO mf_app;
DENY UPDATE, DELETE, ALTER ON dbo.ReportRun TO mf_app;
DENY UPDATE, DELETE, ALTER ON dbo.ReportVersion TO mf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.TeamTitle TO mf_app;
DENY ALTER ON dbo.TeamTitle TO mf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.UserAbsence TO mf_app;
DENY ALTER ON dbo.UserAbsence TO mf_app;
GRANT SELECT, INSERT, UPDATE ON dbo.UserMatterActivitySeen TO mf_app;
DENY DELETE, ALTER ON dbo.UserMatterActivitySeen TO mf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.UserView TO mf_app;
DENY ALTER ON dbo.UserView TO mf_app;
GO

-- Schema runner: the audit table is append-only for it too.
GRANT SELECT, INSERT ON dbo.AuditEvent TO mf_migrator;
DENY UPDATE, DELETE ON dbo.AuditEvent TO mf_migrator;
GO

-- Allowed (db/report-access.json, access = allow): read-only business data.
GRANT SELECT ON dbo.AppUser TO mf_report_reader;
GRANT SELECT ON dbo.Asset TO mf_report_reader;
GRANT SELECT ON dbo.AssetLinkRole TO mf_report_reader;
GRANT SELECT ON dbo.AssetType TO mf_report_reader;
GRANT SELECT ON dbo.Client TO mf_report_reader;
GRANT SELECT ON dbo.CurrentState TO mf_report_reader;
GRANT SELECT ON dbo.CustomFieldIndex TO mf_report_reader;
GRANT SELECT ON dbo.FormDefinition TO mf_report_reader;
GRANT SELECT ON dbo.FormField TO mf_report_reader;
GRANT SELECT ON dbo.FormFieldOption TO mf_report_reader;
GRANT SELECT ON dbo.FormValueSet TO mf_report_reader;
GRANT SELECT ON dbo.FormVersion TO mf_report_reader;
GRANT SELECT ON dbo.Holiday TO mf_report_reader;
GRANT SELECT ON dbo.HolidayCalendar TO mf_report_reader;
GRANT SELECT ON dbo.Matter TO mf_report_reader;
GRANT SELECT ON dbo.MatterType TO mf_report_reader;
GRANT SELECT ON dbo.OnHoldReason TO mf_report_reader;
GRANT SELECT ON dbo.Pod TO mf_report_reader;
GRANT SELECT ON dbo.PodMember TO mf_report_reader;
GRANT SELECT ON dbo.Priority TO mf_report_reader;
GRANT SELECT ON dbo.Project TO mf_report_reader;
GRANT SELECT ON dbo.Role TO mf_report_reader;
GRANT SELECT ON dbo.StepDefinition TO mf_report_reader;
GRANT SELECT ON dbo.StepDefinitionTag TO mf_report_reader;
GRANT SELECT ON dbo.StepInstance TO mf_report_reader;
GRANT SELECT ON dbo.StepTag TO mf_report_reader;
GRANT SELECT ON dbo.Task TO mf_report_reader;
GRANT SELECT ON dbo.TaskAsset TO mf_report_reader;
GRANT SELECT ON dbo.TaskComment TO mf_report_reader;
GRANT SELECT ON dbo.TaskStatusLabel TO mf_report_reader;
GRANT SELECT ON dbo.TaskType TO mf_report_reader;
GRANT SELECT ON dbo.TaskTypeWorkflowEligibility TO mf_report_reader;
GRANT SELECT ON dbo.TeamTitle TO mf_report_reader;
GRANT SELECT ON dbo.UserAvailability TO mf_report_reader;
GRANT SELECT ON dbo.UserRole TO mf_report_reader;
GRANT SELECT ON dbo.UserWorkHour TO mf_report_reader;
GRANT SELECT ON dbo.WorkflowDefinition TO mf_report_reader;
GRANT SELECT ON dbo.WorkflowInstance TO mf_report_reader;
GRANT SELECT ON dbo.WorkflowVersion TO mf_report_reader;
GRANT SELECT ON dbo.WorkflowVersionStep TO mf_report_reader;
GO

-- Denied (db/report-access.json, access = deny): audit, credentials, internal bookkeeping, authorization data, the report tables and the other personal or
-- application-owned tables.
DENY SELECT, VIEW DEFINITION ON dbo.AppSetting TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.AssetNumberCounter TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.AssetReport TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.AuditEvent TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.AuditEventGuard TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.MatterEvent TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.MatterTeamMember TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.Note TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.NoteLink TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.NoteTag TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.NoteTagLink TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.NoteTemplate TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.NoteTemplateTag TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.Notification TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.NotificationPreference TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.Permission TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.Production TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.ProductionComment TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.ProductionSpec TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.ReportCategory TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.ReportDefinition TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.ReportFavourite TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.ReportParameter TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.ReportRecent TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.ReportRun TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.ReportVersion TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.RolePermission TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.RoleReport TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.SavedReportView TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.SchemaMigration TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.SeedMarker TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.TaskCommentRevision TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.UserAbsence TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.UserIdentity TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.UserMatterActivitySeen TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.UserView TO mf_report_reader;
GO

-- The visibility functions take the viewer as a parameter; the report login must not use them as a way around, or to learn the rule.
DENY SELECT ON [dbo].[fnAssetVisible] TO [mf_report_reader];
DENY SELECT ON [dbo].[fnMatterVisible] TO [mf_report_reader];
DENY SELECT ON [dbo].[fnTaskVisible] TO [mf_report_reader];
GO

