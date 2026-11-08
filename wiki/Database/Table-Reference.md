# Table Reference

[[_TOC_]]

**What this page is for.** One entry for every table of the database: what it is for, which module owns it, its columns, foreign keys, indexes, check constraints, triggers and the scripts that created or changed it. Use it when you need the exact column or constraint name. The picture of how tables relate is on [ER Diagrams](ER-Diagrams.md).

**How this page was made.** The facts come from the demo SQL Server database `MatterFlow` (the schema baseline `db/scripts/00-baseline.sql` applied, plus the runner table `SchemaMigration`; the same facts were produced by the archived scripts 01 to 66), read with read-only queries on `sys.tables`, `sys.columns`, `sys.foreign_keys`, `sys.indexes`, `sys.check_constraints` and `sys.triggers`, and were cross-checked against `db/scripts/00-baseline.sql`. Purposes and module ownership are written by hand from the scripts and the code. The "Scripts" line of each table names the archived script (`db/scripts/archive/`, issue #1307) that created or changed it; since the squash everything is defined in the baseline and the line is history only. New scripts (67 and up) add their own number there.

Totals (counted by `tools/db/schema-fingerprint.sql` on a database built from the baseline): 76 tables (75 in the baseline plus `SchemaMigration`), 196 foreign keys, 250 indexes (including primary keys), 148 check constraints, 20 triggers on tables, 762 columns.

## Index of tables

| Table | Area | Module | Columns | FKs out |
|---|---|---|---|---|
| [AppSetting](#appsetting) | Audit, Notifications, Settings and platform | Configuration | 8 | 1 |
| [AppUser](#appuser) | Identity and access | Identity | 12 | 3 |
| [Asset](#asset) | Assets | Assets | 18 | 6 |
| [AssetLinkRole](#assetlinkrole) | Tasks and task configuration | Configuration | 9 | 2 |
| [AssetNumberCounter](#assetnumbercounter) | Assets | Assets | 4 | 1 |
| [AssetReport](#assetreport) | Assets | Assets | 9 | 3 |
| [AssetType](#assettype) | Assets | Assets | 17 | 2 |
| [AuditEvent](#auditevent) | Audit, Notifications, Settings and platform | Audit | 14 | 0 |
| [AuditEventGuard](#auditeventguard) | Audit, Notifications, Settings and platform | Audit (created by script 13) | 1 | 1 |
| [Client](#client) | Clients, Matters and Projects | Organization | 10 | 2 |
| [CurrentState](#currentstate) | Clients, Matters and Projects | Configuration | 9 | 2 |
| [CustomFieldIndex](#customfieldindex) | Forms and custom fields | Configuration | 10 | 1 |
| [FormDefinition](#formdefinition) | Forms and custom fields | Configuration | 11 | 4 |
| [FormField](#formfield) | Forms and custom fields | Configuration | 14 | 1 |
| [FormFieldOption](#formfieldoption) | Forms and custom fields | Configuration | 6 | 1 |
| [FormValueSet](#formvalueset) | Forms and custom fields | Configuration | 11 | 4 |
| [FormVersion](#formversion) | Forms and custom fields | Configuration | 13 | 5 |
| [Holiday](#holiday) | Availability and Calendar | Identity | 22 | 3 |
| [HolidayCalendar](#holidaycalendar) | Availability and Calendar | Identity | 12 | 2 |
| [Matter](#matter) | Clients, Matters and Projects | Organization | 21 | 7 |
| [MatterEvent](#matterevent) | Clients, Matters and Projects | Organization | 12 | 3 |
| [MatterTeamMember](#matterteammember) | Clients, Matters and Projects | Organization | 11 | 4 |
| [MatterType](#mattertype) | Clients, Matters and Projects | Configuration | 9 | 2 |
| [Note](#note) | Notes | Notes | 16 | 5 |
| [NoteLink](#notelink) | Notes | Notes | 3 | 1 |
| [NoteTag](#notetag) | Notes | Notes | 9 | 2 |
| [NoteTagLink](#notetaglink) | Notes | Notes | 2 | 2 |
| [NoteTemplate](#notetemplate) | Notes | Notes | 14 | 4 |
| [NoteTemplateTag](#notetemplatetag) | Notes | Notes | 2 | 2 |
| [Notification](#notification) | Audit, Notifications, Settings and platform | Notifications | 11 | 3 |
| [NotificationPreference](#notificationpreference) | Audit, Notifications, Settings and platform | Notifications | 4 | 1 |
| [OnHoldReason](#onholdreason) | Tasks and task configuration | Configuration | 9 | 2 |
| [Permission](#permission) | Identity and access | Identity | 5 | 0 |
| [Pod](#pod) | Identity and access | Identity | 10 | 3 |
| [PodMember](#podmember) | Identity and access | Identity | 3 | 2 |
| [Priority](#priority) | Tasks and task configuration | Configuration | 11 | 2 |
| [Production](#production) | Productions | Productions | 18 | 4 |
| [ProductionComment](#productioncomment) | Productions | Productions | 9 | 3 |
| [ProductionSpec](#productionspec) | Productions | Productions | 24 | 3 |
| [Project](#project) | Clients, Matters and Projects | Organization | 11 | 3 |
| [ReportCategory](#reportcategory) | Reports | Reports | 9 | 2 |
| [ReportDefinition](#reportdefinition) | Reports | Reports | 16 | 5 |
| [ReportFavourite](#reportfavourite) | Reports | Reports | 3 | 2 |
| [ReportParameter](#reportparameter) | Reports | Reports | 15 | 1 |
| [ReportRecent](#reportrecent) | Reports | Reports | 3 | 2 |
| [ReportRun](#reportrun) | Reports | Reports | 15 | 3 |
| [ReportVersion](#reportversion) | Reports | Reports | 9 | 2 |
| [Role](#role) | Identity and access | Identity | 11 | 2 |
| [RolePermission](#rolepermission) | Identity and access | Identity | 2 | 2 |
| [RoleReport](#rolereport) | Reports | Reports | 4 | 3 |
| [SavedReportView](#savedreportview) | Reports | Reports | 10 | 2 |
| [SchemaMigration](#schemamigration) | Audit, Notifications, Settings and platform | Data (schema runner, not a numbered script) | 9 | 0 |
| [SeedMarker](#seedmarker) | Audit, Notifications, Settings and platform | Identity (seeder bookkeeping) | 2 | 0 |
| [StepDefinition](#stepdefinition) | Workflows | WorkflowEngine | 11 | 2 |
| [StepDefinitionTag](#stepdefinitiontag) | Workflows | WorkflowEngine | 3 | 2 |
| [StepInstance](#stepinstance) | Workflows | WorkflowEngine | 22 | 7 |
| [StepTag](#steptag) | Workflows | WorkflowEngine | 4 | 0 |
| [Task](#task) | Tasks and task configuration | WorkManagement | 31 | 12 |
| [TaskAsset](#taskasset) | Tasks and task configuration | WorkManagement | 9 | 5 |
| [TaskComment](#taskcomment) | Tasks and task configuration | WorkManagement | 14 | 5 |
| [TaskCommentRevision](#taskcommentrevision) | Tasks and task configuration | WorkManagement | 6 | 2 |
| [TaskStatusLabel](#taskstatuslabel) | Tasks and task configuration | Configuration | 8 | 2 |
| [TaskType](#tasktype) | Tasks and task configuration | Configuration | 13 | 2 |
| [TaskTypeWorkflowEligibility](#tasktypeworkfloweligibility) | Workflows | Configuration | 4 | 2 |
| [TeamTitle](#teamtitle) | Clients, Matters and Projects | Configuration | 9 | 2 |
| [UserAbsence](#userabsence) | Availability and Calendar | Identity | 11 | 3 |
| [UserAvailability](#useravailability) | Availability and Calendar | Identity | 10 | 2 |
| [UserIdentity](#useridentity) | Identity and access | Identity | 14 | 3 |
| [UserMatterActivitySeen](#usermatteractivityseen) | Audit, Notifications, Settings and platform | WorkViews (raw SQL, no entity) | 4 | 1 |
| [UserRole](#userrole) | Identity and access | Identity | 4 | 3 |
| [UserView](#userview) | Identity and access | Identity | 9 | 1 |
| [UserWorkHour](#userworkhour) | Availability and Calendar | Identity | 4 | 1 |
| [WorkflowDefinition](#workflowdefinition) | Workflows | WorkflowEngine | 9 | 2 |
| [WorkflowInstance](#workflowinstance) | Workflows | WorkflowEngine | 9 | 3 |
| [WorkflowVersion](#workflowversion) | Workflows | WorkflowEngine | 12 | 4 |
| [WorkflowVersionStep](#workflowversionstep) | Workflows | WorkflowEngine | 11 | 3 |

## Area: Identity and access

### AppUser

A person known to the system, created at first sign-in (just-in-time). Holds display name, email, active flag and an optional holiday calendar. Sign-in details live in `UserIdentity`.

- **Module:** Identity. **Area:** Identity and access.
- **Scripts:** created by script 2; changed by script 59.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_AppUser` (UserId), int identity.
- **Columns (12; `?` = nullable):** `UserId int`, `DisplayName nvarchar(200)`, `Email nvarchar(320)?`, `IsActive bit`, `BootstrapAppliedAt datetime2(7)?`, `LastLoginAt datetime2(7)?`, `HolidayCalendarId int?`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (3):**
  - `FK_AppUser_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_AppUser_HolidayCalendar`: `HolidayCalendarId` to `HolidayCalendar(CalendarId)`
  - `FK_AppUser_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (1):** `IX_AppUser_Display` (DisplayName).

### UserIdentity

How a person signs in: provider (Windows, Dev, Entra), tenant, subject, username, last login.

- **Module:** Identity. **Area:** Identity and access.
- **Scripts:** created by script 2; changed by script 13.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_UserIdentity` (UserIdentityId), int identity.
- **Columns (14; `?` = nullable):** `UserIdentityId int`, `UserId int`, `Provider varchar(20)`, `TenantId varchar(64)`, `ProviderSubject nvarchar(200)`, `Username nvarchar(256)`, `IsActive bit`, `VerifiedAt datetime2(7)?`, `LastLoginAt datetime2(7)?`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (3):**
  - `FK_UserIdentity_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_UserIdentity_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
  - `FK_UserIdentity_User`: `UserId` to `AppUser(UserId)`
- **Indexes and unique constraints (3):** `IX_UserIdentity_User` (UserId); `IX_UserIdentity_Username` (Username); `UQ_UserIdentity_Provider` (Provider,TenantId,ProviderSubject) - unique.
- **Check constraints (1):** `CK_UserIdentity_Provider`.

### Role

A named set of permissions. The built-in System Admin role has the `IsSystemAdmin` flag and holds every permission implicitly.

- **Module:** Identity. **Area:** Identity and access.
- **Scripts:** created by script 2; `LandingPage` added by script 67.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_Role` (RoleId), int identity.
- **Columns (11; `?` = nullable):** `RoleId int`, `Name nvarchar(100)`, `Description nvarchar(500)?`, `IsSystemAdmin bit`, `IsActive bit`, `LandingPage varchar(40)?` (the stable page key from `contracts/landing-pages.json` a person with this role lands on; null = Automatic, the application's own landing rule; epic #1330). Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (2):**
  - `FK_Role_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_Role_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (2):** `UQ_Role_Name` (Name) - unique; `UQ_Role_SystemAdmin` (IsSystemAdmin) - unique; filter [IsSystemAdmin]=(1.
- **Check constraints (1):** `CK_Role_LandingPage` (null, or 1 to 40 lower-case letters, digits and hyphens; which keys are valid is checked by the application).

### Permission

The permission catalog, synced from `contracts/permissions.json` at startup.

- **Module:** Identity. **Area:** Identity and access.
- **Scripts:** created by script 2.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_Permission` (PermissionId), int identity.
- **Columns (5; `?` = nullable):** `PermissionId int`, `Code varchar(64)`, `GroupName varchar(40)`, `Description nvarchar(300)`, `IsActive bit`.
- **Foreign keys:** none.
- **Indexes and unique constraints (1):** `UQ_Permission_Code` (Code) - unique.

### RolePermission

Junction: permissions of a role.

- **Module:** Identity. **Area:** Identity and access.
- **Scripts:** created by script 2.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_RolePermission` (RoleId, PermissionId).
- **Columns (2; `?` = nullable):** `RoleId int`, `PermissionId int`.
- **Foreign keys (2):**
  - `FK_RolePermission_Permission`: `PermissionId` to `Permission(PermissionId)`
  - `FK_RolePermission_Role`: `RoleId` to `Role(RoleId)`
- **Indexes and unique constraints (1):** `IX_RolePermission_Permission` (PermissionId).

### UserRole

Junction: roles of a user, with who granted and when.

- **Module:** Identity. **Area:** Identity and access.
- **Scripts:** created by script 2.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_UserRole` (UserId, RoleId).
- **Columns (4; `?` = nullable):** `UserId int`, `RoleId int`, `GrantedAt datetime2(7)`, `GrantedByUserId int?`.
- **Foreign keys (3):**
  - `FK_UserRole_GrantedBy`: `GrantedByUserId` to `AppUser(UserId)`
  - `FK_UserRole_Role`: `RoleId` to `Role(RoleId)`
  - `FK_UserRole_User`: `UserId` to `AppUser(UserId)`
- **Indexes and unique constraints (1):** `IX_UserRole_Role` (RoleId).

### Pod

A working group of people (team). A Pod Lead is a role, not a column. Can have a default holiday calendar.

- **Module:** Identity. **Area:** Identity and access.
- **Scripts:** created by script 4; changed by script 59.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_Pod` (PodId), int identity.
- **Columns (10; `?` = nullable):** `PodId int`, `Name nvarchar(100)`, `Description nvarchar(500)?`, `IsActive bit`, `DefaultHolidayCalendarId int?`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (3):**
  - `FK_Pod_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_Pod_DefaultHolidayCalendar`: `DefaultHolidayCalendarId` to `HolidayCalendar(CalendarId)`
  - `FK_Pod_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (1):** `UQ_Pod_Name` (Name) - unique.

### PodMember

Junction: users in pods, with a primary pod flag (at most one primary per user).

- **Module:** Identity. **Area:** Identity and access.
- **Scripts:** created by script 4.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_PodMember` (PodId, UserId).
- **Columns (3; `?` = nullable):** `PodId int`, `UserId int`, `IsPrimary bit`.
- **Foreign keys (2):**
  - `FK_PodMember_Pod`: `PodId` to `Pod(PodId)`
  - `FK_PodMember_User`: `UserId` to `AppUser(UserId)`
- **Indexes and unique constraints (2):** `IX_PodMember_User` (UserId); `UQ_PodMember_Primary` (UserId) - unique; filter [IsPrimary]=(1.

### UserView

A person's remembered screen state per surface, and named saved views.

- **Module:** Identity. **Area:** Identity and access.
- **Scripts:** created by script 41.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_UserView` (UserViewId), bigint identity.
- **Columns (9; `?` = nullable):** `UserViewId bigint`, `UserId int`, `Surface varchar(40)`, `Name nvarchar(80)?`, `IsDefault bit`, `StateJson nvarchar(4000)`, `CreatedAt datetime2(3)`, `ModifiedAt datetime2(3)`, `RowVersion timestamp`.
- **Foreign keys (1):**
  - `FK_UserView_User`: `UserId` to `AppUser(UserId)`
- **Indexes and unique constraints (2):** `UQ_UserView_Name` (UserId,Surface,Name) - unique; `UX_UserView_Default` (UserId,Surface) - unique; filter [IsDefault]=(1.
- **Check constraints (4):** `CK_UserView_Name`, `CK_UserView_RememberedNotDefault`, `CK_UserView_State`, `CK_UserView_Surface`.
- **Landing page (script 67 era):** the surface `landing-page` holds a person's own landing page choice as `{"page":"<key>"}` (one remembered row, `Name` null). It is not in the surface list of the generic views API; `GET/PUT /api/v1/me/landing-page` own it.

## Area: Clients, Matters and Projects

### Client

A law-firm client with a zero-padded 5-digit client number.

- **Module:** Organization. **Area:** Clients, Matters and Projects.
- **Scripts:** created by script 5.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_Client` (ClientId), int identity.
- **Columns (10; `?` = nullable):** `ClientId int`, `ClientNumber char(5)`, `Name nvarchar(200)`, `IsActive bit`, `CustomFieldsJson nvarchar(max)?`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (2):**
  - `FK_Client_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_Client_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (3):** `IX_Client_Name` (Name); `UQ_Client_IdNumber` (ClientId,ClientNumber) - unique; `UQ_Client_Number` (ClientNumber) - unique.
- **Check constraints (2):** `CK_Client_CustomFieldsJson`, `CK_Client_Number`.

### Matter

A client case. Business reference is client number plus matter number (CM Number). Has Sensitive flag, Primary and Secondary project manager, an AI allowed switch and custom fields.

- **Module:** Organization. **Area:** Clients, Matters and Projects.
- **Scripts:** created by script 5; changed by scripts 28, 35, 37, 51, 64.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_Matter` (MatterId), int identity.
- **Columns (21; `?` = nullable):** `MatterId int`, `ClientId int`, `ClientNumber char(5)`, `MatterNumber char(5)`, `MatterRef char(11)`, `Name nvarchar(300)`, `IsActive bit`, `IsSensitive bit`, `CustomFieldsJson nvarchar(max)?`, `PrimaryManagerId int?`, `SecondaryManagerId int?`, `AiAllowed tinyint`, `MatterTypeId int?`, `CurrentStateId int?`, `DmsPath nvarchar(1000)?`, `DfsPath nvarchar(1000)?`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (7):**
  - `FK_Matter_CurrentState`: `CurrentStateId` to `CurrentState(CurrentStateId)`
  - `FK_Matter_MatterType`: `MatterTypeId` to `MatterType(MatterTypeId)`
  - `FK_Matter_Client`: `ClientId, ClientNumber` to `Client(ClientId, ClientNumber)`
  - `FK_Matter_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_Matter_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
  - `FK_Matter_PrimaryManager`: `PrimaryManagerId` to `AppUser(UserId)`
  - `FK_Matter_SecondaryManager`: `SecondaryManagerId` to `AppUser(UserId)`
- **Indexes and unique constraints (10):** `IX_Matter_CurrentState` (CurrentStateId); `IX_Matter_MatterType` (MatterTypeId); `IX_Matter_Client` (ClientId,IsActive); `IX_Matter_Name` (Name); `IX_Matter_Number` (MatterNumber); `IX_Matter_PrimaryManager` (PrimaryManagerId) - filter [PrimaryManagerId] IS NOT NULL; includes IsActive; `IX_Matter_SecondaryManager` (SecondaryManagerId) - filter [SecondaryManagerId] IS NOT NULL; includes IsActive; `IX_Matter_Sensitive` (MatterId) - filter [IsSensitive]=(1; includes PrimaryManagerId,SecondaryManagerId; `UQ_Matter_ClientMatterNumber` (ClientId,MatterNumber) - unique; `UQ_Matter_Ref` (MatterRef) - unique.
- **Check constraints (4):** `CK_Matter_AiAllowed`, `CK_Matter_CustomFieldsJson`, `CK_Matter_ManagersDiffer`, `CK_Matter_Number`.
- **Triggers:** `TR_Matter_SensitivityToTask`.

### MatterType

Admin-managed list: the Matter Type a matter can carry (optional; `Matter.MatterTypeId`). Names are unique; a used item is deactivated, an unused one may be deleted.

- **Module:** Configuration. **Area:** Clients, Matters and Projects.
- **Scripts:** created by script 64.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_MatterType` (MatterTypeId), int identity.
- **Columns (9; `?` = nullable):** `MatterTypeId int`, `Name nvarchar(100)`, `SortOrder int`, `IsActive bit`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (2):**
  - `FK_MatterType_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_MatterType_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (2):** `IX_MatterType_Sort` (SortOrder); `UQ_MatterType_Name` (Name) - unique.
- **Check constraints (1):** `CK_MatterType_Name`.

### CurrentState

Admin-managed list: the Current State of a matter (optional, current value only; `Matter.CurrentStateId`). Names are unique; a used item is deactivated, an unused one may be deleted.

- **Module:** Configuration. **Area:** Clients, Matters and Projects.
- **Scripts:** created by script 64.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_CurrentState` (CurrentStateId), int identity.
- **Columns (9; `?` = nullable):** `CurrentStateId int`, `Name nvarchar(100)`, `SortOrder int`, `IsActive bit`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (2):**
  - `FK_CurrentState_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_CurrentState_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (2):** `IX_CurrentState_Sort` (SortOrder); `UQ_CurrentState_Name` (Name) - unique.
- **Check constraints (1):** `CK_CurrentState_Name`.

### TeamTitle

Admin-managed list: the title of a team member (`MatterTeamMember.TeamTitleId`). Names are unique; a used item is deactivated, an unused one may be deleted.

- **Module:** Configuration. **Area:** Clients, Matters and Projects.
- **Scripts:** created by script 64.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_TeamTitle` (TeamTitleId), int identity.
- **Columns (9; `?` = nullable):** `TeamTitleId int`, `Name nvarchar(100)`, `SortOrder int`, `IsActive bit`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (2):**
  - `FK_TeamTitle_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_TeamTitle_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (2):** `IX_TeamTitle_Sort` (SortOrder); `UQ_TeamTitle_Name` (Name) - unique.
- **Check constraints (1):** `CK_TeamTitle_Name`.

### MatterTeamMember

A person on a matter's team: a typed-in contact (name, email, title), not a user account, so it never affects visibility or permissions. The email is unique within the matter without regard to case.

- **Module:** Organization. **Area:** Clients, Matters and Projects.
- **Scripts:** created by script 64.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_MatterTeamMember` (MatterTeamMemberId), int identity.
- **Columns (11; `?` = nullable):** `MatterTeamMemberId int`, `MatterId int`, `Name nvarchar(200)`, `Email nvarchar(254)` (case-insensitive collation), `TeamTitleId int`, `SortOrder int`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (4):**
  - `FK_MatterTeamMember_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_MatterTeamMember_Matter`: `MatterId` to `Matter(MatterId)`
  - `FK_MatterTeamMember_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
  - `FK_MatterTeamMember_Title`: `TeamTitleId` to `TeamTitle(TeamTitleId)`
- **Indexes and unique constraints (2):** `IX_MatterTeamMember_Title` (TeamTitleId); `UQ_MatterTeamMember_MatterEmail` (MatterId,Email) - unique.
- **Check constraints (2):** `CK_MatterTeamMember_Email`, `CK_MatterTeamMember_Name`.

### Project

A project inside a matter, with custom fields.

- **Module:** Organization. **Area:** Clients, Matters and Projects.
- **Scripts:** created by script 5.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_Project` (ProjectId), int identity.
- **Columns (11; `?` = nullable):** `ProjectId int`, `MatterId int`, `Name nvarchar(200)`, `Description nvarchar(2000)?`, `IsActive bit`, `CustomFieldsJson nvarchar(max)?`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (3):**
  - `FK_Project_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_Project_Matter`: `MatterId` to `Matter(MatterId)`
  - `FK_Project_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (4):** `IX_Project_Matter` (MatterId,IsActive); `IX_Project_Name` (Name); `UQ_Project_IdMatter` (ProjectId,MatterId) - unique; `UQ_Project_MatterName` (MatterId,Name) - unique.
- **Check constraints (1):** `CK_Project_CustomFieldsJson`.

### MatterEvent

A calendar item of a matter (types OTHER, CLIENT_MEETING, MEDIATION, FILING_DEADLINE, PRODUCTION_DEADLINE, DEPOSITION, TRIAL, COURT_HEARING).

- **Module:** Organization. **Area:** Clients, Matters and Projects.
- **Scripts:** created by script 49.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_MatterEvent` (MatterEventId), int identity.
- **Columns (12; `?` = nullable):** `MatterEventId int`, `MatterId int`, `EventTypeCode varchar(30)`, `Title nvarchar(200)`, `EventDate date`, `EventTime time?`, `Note nvarchar(2000)?`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (3):**
  - `FK_MatterEvent_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_MatterEvent_Matter`: `MatterId` to `Matter(MatterId)`
  - `FK_MatterEvent_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (2):** `IX_MatterEvent_Date` (EventDate,MatterId) - includes EventTypeCode,EventTime; `IX_MatterEvent_Matter` (MatterId,EventDate).
- **Check constraints (2):** `CK_MatterEvent_Title`, `CK_MatterEvent_Type`.

## Area: Tasks and task configuration

### Task

A unit of work on a matter (optionally a project) of one task type, with priority, status, assignee (user and or pod), requestor, due date, workflow instance and form version. Task number is `TSK-` plus `dbo.TaskNumberSeq`.

- **Module:** WorkManagement. **Area:** Tasks and task configuration.
- **Scripts:** created by script 12; changed by scripts 15, 18, 20, 25, 26, 33, 35, 37, 42, 47, 57.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_Task` (TaskId), bigint identity.
- **Columns (31; `?` = nullable):** `TaskId bigint`, `TaskNumber varchar(20)`, `MatterId int`, `ProjectId int?`, `TaskTypeId int`, `FormVersionId int?`, `WorkflowInstanceId bigint`, `Title nvarchar(300)`, `Description nvarchar(max)?`, `PriorityId int`, `StatusCode varchar(20)`, `AssignedPodId int?`, `AssignedUserId int?`, `RequestorName nvarchar(200)`, `RequestorEmail nvarchar(320)?`, `RequestedAt datetime2(3)?`, `DueDate date?`, `DueAtUtc datetime2(3)?`, `DueSortKey datetime2(3)?`, `StatusChangedAt datetime2(3)`, `CompletedAt datetime2(3)?`, `AssignedAt datetime2(3)?`, `DescriptionFormat varchar(4)`, `IsMatterSensitive bit`, `OnHoldReasonId int?`, `UnassignedAt datetime2(3)?`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (12):**
  - `FK_Task_AssignedPod`: `AssignedPodId` to `Pod(PodId)`
  - `FK_Task_AssignedUser`: `AssignedUserId` to `AppUser(UserId)`
  - `FK_Task_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_Task_FormVersion`: `FormVersionId` to `FormVersion(FormVersionId)`
  - `FK_Task_Matter`: `MatterId` to `Matter(MatterId)`
  - `FK_Task_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
  - `FK_Task_OnHoldReason`: `OnHoldReasonId` to `OnHoldReason(OnHoldReasonId)`
  - `FK_Task_Priority`: `PriorityId` to `Priority(PriorityId)`
  - `FK_Task_Project_SameMatter`: `ProjectId, MatterId` to `Project(ProjectId, MatterId)`
  - `FK_Task_Status`: `StatusCode` to `TaskStatusLabel(StatusCode)`
  - `FK_Task_TaskType`: `TaskTypeId` to `TaskType(TaskTypeId)`
  - `FK_Task_WorkflowInstance`: `WorkflowInstanceId` to `WorkflowInstance(WorkflowInstanceId)`
- **Indexes and unique constraints (22):** `IX_Task_AssignedMatter` (AssignedUserId,MatterId) - filter [AssignedUserId] IS NOT NULL; includes StatusCode; `IX_Task_AssignedSensitive` (AssignedUserId) - filter [IsMatterSensitive]=(1) AND [AssignedUserId] IS NOT NULL; includes MatterId; `IX_Task_AssignedUser` (AssignedUserId,StatusCode) - includes PriorityId,DueSortKey,DueDate,DueAtUtc,CreatedAt,StatusChangedAt,MatterId,IsMatterSensitive; `IX_Task_Completed` (CompletedAt) - filter [CompletedAt] IS NOT NULL; `IX_Task_CompletedCoverage` (CompletedAt) - filter [CompletedAt] IS NOT NULL; includes StatusCode,AssignedUserId,TaskTypeId,MatterId,IsMatterSensitive; `IX_Task_CreatedAt` (CreatedAt DESC,TaskId DESC) - includes StatusCode,MatterId,AssignedUserId,IsMatterSensitive; `IX_Task_Creator` (CreatedByUserId,CreatedAt) - includes StatusCode,MatterId,AssignedUserId,IsMatterSensitive; `IX_Task_Matter` (MatterId,StatusCode) - includes DueDate,DueAtUtc,DueSortKey,AssignedUserId,AssignedPodId,StatusChangedAt,CreatedAt,WorkflowInstanceId; `IX_Task_Matter_Type` (MatterId,TaskTypeId,StatusCode) - includes DueDate,DueAtUtc,DueSortKey,AssignedUserId,AssignedPodId,StatusChangedAt,CreatedAt,OnHoldReasonId,PriorityId; `IX_Task_OnHoldReason` (OnHoldReasonId,MatterId) - filter [OnHoldReasonId] IS NOT NULL; `IX_Task_Pod` (AssignedPodId,StatusCode) - includes AssignedUserId,PriorityId,DueSortKey,DueDate,DueAtUtc,CreatedAt,MatterId,IsMatterSensitive; `IX_Task_Priority` (PriorityId); `IX_Task_Project` (ProjectId) - filter [ProjectId] IS NOT NULL; `IX_Task_Queue` (StatusCode,PriorityId,DueSortKey,CreatedAt) - includes MatterId,AssignedUserId,AssignedPodId,TaskTypeId,DueDate,DueAtUtc,IsMatterSensitive; `IX_Task_Requestor` (RequestorName); `IX_Task_StatusChanged` (StatusCode,StatusChangedAt DESC,TaskId DESC) - includes MatterId,AssignedUserId,IsMatterSensitive; `IX_Task_Title` (Title); `IX_Task_Type` (TaskTypeId,StatusCode); `IX_Task_Unassigned` (AssignedPodId,CreatedAt) - filter [AssignedUserId] IS NULL AND ([StatusCode] IN ('NEW', 'IN_PROGRESS', 'ON_HOLD'; includes UnassignedAt,MatterId,IsMatterSensitive; `UQ_Task_IdMatter` (TaskId,MatterId) - unique; `UQ_Task_Number` (TaskNumber) - unique; `UQ_Task_WorkflowInstance` (WorkflowInstanceId) - unique.
- **Check constraints (8):** `CK_Task_CompletedAt`, `CK_Task_DescriptionFormat`, `CK_Task_DueAt`, `CK_Task_DueSortKey`, `CK_Task_RequestorEmail`, `CK_Task_RequestorName`, `CK_Task_StatusCode`, `CK_Task_Title`.
- **Triggers:** `TR_Task_Immutable`, `TR_Task_MatterSensitivityInsert`, `TR_Task_NoDelete`.

### TaskComment

A comment on a task (HTML), with a purpose (normal, on hold or cancel reason) and soft delete.

- **Module:** WorkManagement. **Area:** Tasks and task configuration.
- **Scripts:** created by script 12; changed by script 18.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_TaskComment` (TaskCommentId), bigint identity.
- **Columns (14; `?` = nullable):** `TaskCommentId bigint`, `TaskId bigint`, `AuthorUserId int`, `Purpose varchar(12)`, `BodyHtml nvarchar(max)`, `EditedAt datetime2(3)?`, `IsDeleted bit`, `DeletedAt datetime2(3)?`, `DeletedByUserId int?`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (5):**
  - `FK_TaskComment_Author`: `AuthorUserId` to `AppUser(UserId)`
  - `FK_TaskComment_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_TaskComment_DeletedBy`: `DeletedByUserId` to `AppUser(UserId)`
  - `FK_TaskComment_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
  - `FK_TaskComment_Task`: `TaskId` to `Task(TaskId)`
- **Indexes and unique constraints (3):** `IX_TaskComment_Author` (AuthorUserId); `IX_TaskComment_Task` (TaskId,CreatedAt) - filter [IsDeleted]=(0; `IX_TaskComment_TaskAll` (TaskId).
- **Check constraints (4):** `CK_TaskComment_Body`, `CK_TaskComment_Deleted`, `CK_TaskComment_Purpose`, `CK_TaskComment_ReasonNotDeletable`.
- **Triggers:** `TR_TaskComment_Guard`, `TR_TaskComment_NoDelete`.

### TaskCommentRevision

Append-only edit and delete history of task comments.

- **Module:** WorkManagement. **Area:** Tasks and task configuration.
- **Scripts:** created by script 14.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_TaskCommentRevision` (TaskCommentRevisionId), bigint identity.
- **Columns (6; `?` = nullable):** `TaskCommentRevisionId bigint`, `TaskCommentId bigint`, `BodyHtml nvarchar(max)`, `Reason varchar(10)`, `RevisedAt datetime2(3)`, `RevisedByUserId int?`.
- **Foreign keys (2):**
  - `FK_TaskCommentRevision_Comment`: `TaskCommentId` to `TaskComment(TaskCommentId)`
  - `FK_TaskCommentRevision_RevisedBy`: `RevisedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (1):** `IX_TaskCommentRevision_Comment` (TaskCommentId,RevisedAt).
- **Check constraints (1):** `CK_TaskCommentRevision_Reason`.
- **Triggers:** `TR_TaskCommentRevision_AppendOnly`.

### TaskAsset

Junction: assets linked to a task, with an optional link role. The matter of task and asset must match.

- **Module:** WorkManagement. **Area:** Tasks and task configuration.
- **Scripts:** created by script 14.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_TaskAsset` (TaskId, AssetId).
- **Columns (9; `?` = nullable):** `TaskId bigint`, `AssetId int`, `MatterId int`, `AssetLinkRoleId int?`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (5):**
  - `FK_TaskAsset_Asset`: `AssetId, MatterId` to `Asset(AssetId, MatterId)`
  - `FK_TaskAsset_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_TaskAsset_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
  - `FK_TaskAsset_Role`: `AssetLinkRoleId` to `AssetLinkRole(AssetLinkRoleId)`
  - `FK_TaskAsset_Task`: `TaskId, MatterId` to `Task(TaskId, MatterId)`
- **Indexes and unique constraints (2):** `IX_TaskAsset_Asset` (AssetId); `IX_TaskAsset_Role` (AssetLinkRoleId) - filter [AssetLinkRoleId] IS NOT NULL.

### TaskType

Admin-defined type of task, with icon, colour key, target days, default workflow and a request form.

- **Module:** Configuration. **Area:** Tasks and task configuration.
- **Scripts:** created by script 8; changed by scripts 19, 40.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_TaskType` (TaskTypeId), int identity.
- **Columns (13; `?` = nullable):** `TaskTypeId int`, `Name nvarchar(100)`, `Description nvarchar(1000)?`, `IsActive bit`, `DefaultWorkflowDefinitionId int?`, `IconKey varchar(50)`, `ColourKey varchar(20)?`, `TargetDays smallint?`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (2):**
  - `FK_TaskType_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_TaskType_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (1):** `UQ_TaskType_Name` (Name) - unique.
- **Check constraints (4):** `CK_TaskType_ColourKey`, `CK_TaskType_IconKey`, `CK_TaskType_Name`, `CK_TaskType_TargetDays`.

### Priority

Admin-managed task priorities with label, colour, order and a default.

- **Module:** Configuration. **Area:** Tasks and task configuration.
- **Scripts:** created by script 7.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_Priority` (PriorityId), int identity.
- **Columns (11; `?` = nullable):** `PriorityId int`, `Label nvarchar(50)`, `SortOrder int`, `Color varchar(20)`, `IsActive bit`, `IsDefault bit`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (2):**
  - `FK_Priority_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_Priority_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (3):** `IX_Priority_Sort` (SortOrder); `UQ_Priority_Default` (IsDefault) - unique; filter [IsDefault]=(1; `UQ_Priority_Label` (Label) - unique.
- **Check constraints (2):** `CK_Priority_DefaultActive`, `CK_Priority_Label`.

### TaskStatusLabel

Display labels of the five fixed task status codes (NEW, IN_PROGRESS, ON_HOLD, COMPLETED, CANCELLED). The codes cannot change.

- **Module:** Configuration. **Area:** Tasks and task configuration.
- **Scripts:** created by script 7.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_TaskStatusLabel` (StatusCode).
- **Columns (8; `?` = nullable):** `StatusCode varchar(20)`, `DisplayLabel nvarchar(50)`, `SortOrder int`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (2):**
  - `FK_TaskStatusLabel_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_TaskStatusLabel_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (1):** `UQ_TaskStatusLabel_Label` (DisplayLabel) - unique.
- **Check constraints (2):** `CK_TaskStatusLabel_Code`, `CK_TaskStatusLabel_Label`.
- **Triggers:** `TR_TaskStatusLabel_FixedCodes`.

### OnHoldReason

Admin-managed list of reasons for putting a task On Hold. Never deleted.

- **Module:** Configuration. **Area:** Tasks and task configuration.
- **Scripts:** created by script 42.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_OnHoldReason` (OnHoldReasonId), int identity.
- **Columns (9; `?` = nullable):** `OnHoldReasonId int`, `Name nvarchar(100)`, `SortOrder int`, `IsActive bit`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (2):**
  - `FK_OnHoldReason_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_OnHoldReason_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (2):** `IX_OnHoldReason_Sort` (SortOrder); `UQ_OnHoldReason_Name` (Name) - unique.
- **Check constraints (1):** `CK_OnHoldReason_Name`.

### AssetLinkRole

Admin-managed list of roles that describe how an asset is linked to a task (used on `TaskAsset`).

- **Module:** Configuration. **Area:** Tasks and task configuration.
- **Scripts:** created by script 7.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_AssetLinkRole` (AssetLinkRoleId), int identity.
- **Columns (9; `?` = nullable):** `AssetLinkRoleId int`, `Name nvarchar(50)`, `SortOrder int`, `IsActive bit`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (2):**
  - `FK_AssetLinkRole_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_AssetLinkRole_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (2):** `IX_AssetLinkRole_Sort` (SortOrder); `UQ_AssetLinkRole_Name` (Name) - unique.
- **Check constraints (1):** `CK_AssetLinkRole_Name`.

## Area: Workflows

### StepDefinition

A reusable step of the step library (title, instructions, documentation link, tags).

- **Module:** WorkflowEngine. **Area:** Workflows.
- **Scripts:** created by script 9.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_StepDefinition` (StepDefinitionId), int identity.
- **Columns (11; `?` = nullable):** `StepDefinitionId int`, `Title nvarchar(200)`, `Description nvarchar(1000)?`, `Instructions nvarchar(max)?`, `DocumentationUrl nvarchar(1000)?`, `IsActive bit`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (2):**
  - `FK_StepDefinition_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_StepDefinition_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (1):** `UQ_StepDefinition_Title` (Title) - unique; filter [IsActive]=(1.
- **Check constraints (1):** `CK_StepDefinition_Title`.

### StepDefinitionTag

Junction: tags on a library step, with an order.

- **Module:** WorkflowEngine. **Area:** Workflows.
- **Scripts:** created by script 23.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_StepDefinitionTag` (StepDefinitionId, StepTagId).
- **Columns (3; `?` = nullable):** `StepDefinitionId int`, `StepTagId int`, `SortOrder int`.
- **Foreign keys (2):**
  - `FK_StepDefinitionTag_Step`: `StepDefinitionId` to `StepDefinition(StepDefinitionId)`
  - `FK_StepDefinitionTag_Tag`: `StepTagId` to `StepTag(StepTagId)`
- **Indexes and unique constraints (1):** `IX_StepDefinitionTag_Tag` (StepTagId,StepDefinitionId).
- **Check constraints (1):** `CK_StepDefinitionTag_SortOrder`.

### StepTag

Free-form tag of library steps.

- **Module:** WorkflowEngine. **Area:** Workflows.
- **Scripts:** created by script 23.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_StepTag` (StepTagId), int identity.
- **Columns (4; `?` = nullable):** `StepTagId int`, `TagKey nvarchar(40)`, `Name nvarchar(40)`, `CreatedAt datetime2(7)`.
- **Foreign keys:** none.
- **Indexes and unique constraints (1):** `UQ_StepTag_Key` (TagKey) - unique.
- **Check constraints (2):** `CK_StepTag_Key`, `CK_StepTag_Name`.

### WorkflowDefinition

A named workflow. Versions hold the steps.

- **Module:** WorkflowEngine. **Area:** Workflows.
- **Scripts:** created by script 9.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_WorkflowDefinition` (WorkflowDefinitionId), int identity.
- **Columns (9; `?` = nullable):** `WorkflowDefinitionId int`, `Name nvarchar(200)`, `Description nvarchar(1000)?`, `IsActive bit`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (2):**
  - `FK_WorkflowDefinition_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_WorkflowDefinition_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (1):** `UQ_WorkflowDefinition_Name` (Name) - unique.
- **Check constraints (1):** `CK_WorkflowDefinition_Name`.

### WorkflowVersion

A version of a workflow: DRAFT, PUBLISHED or RETIRED. Published versions are immutable.

- **Module:** WorkflowEngine. **Area:** Workflows.
- **Scripts:** created by script 9.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_WorkflowVersion` (WorkflowVersionId), int identity.
- **Columns (12; `?` = nullable):** `WorkflowVersionId int`, `WorkflowDefinitionId int`, `VersionNo int`, `Status varchar(12)`, `IsOrdered bit`, `PublishedAt datetime2(7)?`, `PublishedByUserId int?`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (4):**
  - `FK_WorkflowVersion_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_WorkflowVersion_Definition`: `WorkflowDefinitionId` to `WorkflowDefinition(WorkflowDefinitionId)`
  - `FK_WorkflowVersion_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
  - `FK_WorkflowVersion_PublishedBy`: `PublishedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (3):** `UQ_WorkflowVersion_Draft` (WorkflowDefinitionId) - unique; filter [Status]='DRAFT'; `UQ_WorkflowVersion_No` (WorkflowDefinitionId,VersionNo) - unique; `UQ_WorkflowVersion_Published` (WorkflowDefinitionId) - unique; filter [Status]='PUBLISHED'.
- **Check constraints (2):** `CK_WorkflowVersion_PublishedAt`, `CK_WorkflowVersion_Status`.
- **Triggers:** `TR_WorkflowVersion_Immutable`.

### WorkflowVersionStep

One step of a workflow version, copied from the library at design time.

- **Module:** WorkflowEngine. **Area:** Workflows.
- **Scripts:** created by script 9.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_WorkflowVersionStep` (WorkflowVersionStepId), int identity.
- **Columns (11; `?` = nullable):** `WorkflowVersionStepId int`, `WorkflowVersionId int`, `SequenceNo int`, `SourceStepDefinitionId int`, `Title nvarchar(200)`, `Description nvarchar(1000)?`, `Instructions nvarchar(max)?`, `DocumentationUrl nvarchar(1000)?`, `StepFormVersionId int?`, `IsSkippable bit`, `SkipCommentRequired bit`.
- **Foreign keys (3):**
  - `FK_WVS_FormVersion`: `StepFormVersionId` to `FormVersion(FormVersionId)`
  - `FK_WVS_Source`: `SourceStepDefinitionId` to `StepDefinition(StepDefinitionId)`
  - `FK_WVS_Version`: `WorkflowVersionId` to `WorkflowVersion(WorkflowVersionId)`
- **Indexes and unique constraints (4):** `IX_WVS_FormVersion` (StepFormVersionId) - filter [StepFormVersionId] IS NOT NULL; `IX_WVS_Source` (SourceStepDefinitionId); `UQ_WVS_Sequence` (WorkflowVersionId,SequenceNo) - unique; `UQ_WVS_Source` (WorkflowVersionId,SourceStepDefinitionId) - unique.
- **Check constraints (3):** `CK_WVS_Sequence`, `CK_WVS_SkipComment`, `CK_WVS_Title`.
- **Triggers:** `TR_WorkflowVersionStep_Immutable`.

### WorkflowInstance

The running copy of a workflow version for one task, with its ordering flag and a revision.

- **Module:** WorkflowEngine. **Area:** Workflows.
- **Scripts:** created by script 11.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_WorkflowInstance` (WorkflowInstanceId), bigint identity.
- **Columns (9; `?` = nullable):** `WorkflowInstanceId bigint`, `WorkflowVersionId int`, `IsOrdered bit`, `Revision int`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (3):**
  - `FK_WorkflowInstance_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_WorkflowInstance_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
  - `FK_WorkflowInstance_Version`: `WorkflowVersionId` to `WorkflowVersion(WorkflowVersionId)`
- **Indexes and unique constraints (1):** `IX_WorkflowInstance_Version` (WorkflowVersionId).
- **Triggers:** `TR_WorkflowInstance_Immutable`.

### StepInstance

One step of a running workflow instance: a copy of the step text, its status (PENDING, IN_PROGRESS, COMPLETED, SKIPPED), who resolved it and when. Input form values live in `FormValueSet`.

- **Module:** WorkflowEngine. **Area:** Workflows.
- **Scripts:** created by script 11; changed by script 33.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_StepInstance` (StepInstanceId), int identity.
- **Columns (22; `?` = nullable):** `StepInstanceId int`, `WorkflowInstanceId bigint`, `WorkflowVersionStepId int`, `SequenceNo int`, `Title nvarchar(200)`, `Description nvarchar(1000)?`, `Instructions nvarchar(max)?`, `DocumentationUrl nvarchar(1000)?`, `IsSkippable bit`, `SkipCommentRequired bit`, `InputFormVersionId int?`, `InputFormDefinitionId int?`, `Status varchar(12)`, `SkipComment nvarchar(2000)?`, `FirstResolvedAt datetime2(7)?`, `ResolvedAt datetime2(7)?`, `ResolvedByUserId int?`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (7):**
  - `FK_StepInstance_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_StepInstance_FormDefinition`: `InputFormDefinitionId` to `FormDefinition(FormDefinitionId)`
  - `FK_StepInstance_FormVersion`: `InputFormVersionId` to `FormVersion(FormVersionId)`
  - `FK_StepInstance_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
  - `FK_StepInstance_ResolvedBy`: `ResolvedByUserId` to `AppUser(UserId)`
  - `FK_StepInstance_VersionStep`: `WorkflowVersionStepId` to `WorkflowVersionStep(WorkflowVersionStepId)`
  - `FK_StepInstance_Workflow`: `WorkflowInstanceId` to `WorkflowInstance(WorkflowInstanceId)`
- **Indexes and unique constraints (5):** `IX_StepInstance_FormVersion` (InputFormVersionId) - filter [InputFormVersionId] IS NOT NULL; `IX_StepInstance_Status` (Status) - filter [Status] IN ('PENDING', 'IN_PROGRESS'; `IX_StepInstance_Workflow` (WorkflowInstanceId,SequenceNo) - includes Status; `UQ_StepInstance_Sequence` (WorkflowInstanceId,SequenceNo) - unique; `UQ_StepInstance_VersionStep` (WorkflowInstanceId,WorkflowVersionStepId) - unique.
- **Check constraints (6):** `CK_StepInstance_InputForm`, `CK_StepInstance_Resolved`, `CK_StepInstance_Sequence`, `CK_StepInstance_SkipComment`, `CK_StepInstance_Status`, `CK_StepInstance_Title`.
- **Triggers:** `TR_StepInstance_Immutable`.

### TaskTypeWorkflowEligibility

Junction: which workflows may be used for a task type.

- **Module:** Configuration. **Area:** Workflows.
- **Scripts:** created by script 8.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_TaskTypeWorkflowEligibility` (TaskTypeId, WorkflowDefinitionId).
- **Columns (4; `?` = nullable):** `TaskTypeId int`, `WorkflowDefinitionId int`, `CreatedAt datetime2(7)`, `CreatedByUserId int?`.
- **Foreign keys (2):**
  - `FK_TaskTypeWorkflowEligibility_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_TaskTypeWorkflowEligibility_TaskType`: `TaskTypeId` to `TaskType(TaskTypeId)`
- **Indexes and unique constraints (1):** `IX_TaskTypeWorkflowEligibility_Workflow` (WorkflowDefinitionId).
- **Check constraints (1):** `CK_TaskTypeWorkflowEligibility_Workflow`.

## Area: Forms and custom fields

### FormDefinition

A form container owned by exactly one thing: a task type, a step definition, an asset type, or a client, matter or project (custom fields). Versions hold the fields.

- **Module:** Configuration. **Area:** Forms and custom fields.
- **Scripts:** created by script 6; changed by scripts 9, 10.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_FormDefinition` (FormDefinitionId), int identity.
- **Columns (11; `?` = nullable):** `FormDefinitionId int`, `Scope varchar(20)`, `TaskTypeId int?`, `StepDefinitionId int?`, `AssetTypeId int?`, `IsActive bit`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (4):**
  - `FK_FormDef_AssetType`: `AssetTypeId` to `AssetType(AssetTypeId)`
  - `FK_FormDef_Step`: `StepDefinitionId` to `StepDefinition(StepDefinitionId)`
  - `FK_FormDefinition_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_FormDefinition_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (4):** `UQ_FormDef_AssetType` (AssetTypeId) - unique; filter [AssetTypeId] IS NOT NULL; `UQ_FormDef_Singleton` (Scope) - unique; filter [Scope] IN ('CLIENT', 'MATTER', 'PROJECT'; `UQ_FormDef_Step` (StepDefinitionId) - unique; filter [StepDefinitionId] IS NOT NULL; `UQ_FormDef_TaskType` (TaskTypeId) - unique; filter [TaskTypeId] IS NOT NULL.
- **Check constraints (2):** `CK_FormDefinition_Owner`, `CK_FormDefinition_Scope`.

### FormVersion

A version of a form: DRAFT, PUBLISHED or RETIRED. Published versions are immutable. A version can be cloned from another.

- **Module:** Configuration. **Area:** Forms and custom fields.
- **Scripts:** created by script 6.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_FormVersion` (FormVersionId), int identity.
- **Columns (13; `?` = nullable):** `FormVersionId int`, `FormDefinitionId int`, `VersionNo int`, `Status varchar(12)`, `ClonedFromVersionId int?`, `PublishedAt datetime2(7)?`, `PublishedByUserId int?`, `Notes nvarchar(500)?`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (5):**
  - `FK_FormVersion_ClonedFrom`: `ClonedFromVersionId` to `FormVersion(FormVersionId)`
  - `FK_FormVersion_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_FormVersion_Definition`: `FormDefinitionId` to `FormDefinition(FormDefinitionId)`
  - `FK_FormVersion_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
  - `FK_FormVersion_PublishedBy`: `PublishedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (4):** `IX_FormVersion_ClonedFrom` (ClonedFromVersionId) - filter [ClonedFromVersionId] IS NOT NULL; `UQ_FormVersion_Draft` (FormDefinitionId) - unique; filter [Status]='DRAFT'; `UQ_FormVersion_No` (FormDefinitionId,VersionNo) - unique; `UQ_FormVersion_Published` (FormDefinitionId) - unique; filter [Status]='PUBLISHED'.
- **Check constraints (2):** `CK_FormVersion_PublishedAt`, `CK_FormVersion_Status`.
- **Triggers:** `TR_FormVersion_Immutable`.

### FormField

One field of a form version: key, label, control type, required flag, validation and conditional rules (JSON), filterable flag. Immutable once the version is published.

- **Module:** Configuration. **Area:** Forms and custom fields.
- **Scripts:** created by script 6.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_FormField` (FormFieldId), int identity.
- **Columns (14; `?` = nullable):** `FormFieldId int`, `FormVersionId int`, `FieldKey varchar(64)`, `Label nvarchar(200)`, `ControlType varchar(20)`, `HelpText nvarchar(1000)?`, `SortOrder int`, `SectionKey varchar(64)?`, `IsRequired bit`, `DefaultValueJson nvarchar(max)?`, `ValidationJson nvarchar(max)?`, `ShowWhenJson nvarchar(max)?`, `RequiredWhenJson nvarchar(max)?`, `IsFilterable bit`.
- **Foreign keys (1):**
  - `FK_FormField_Version`: `FormVersionId` to `FormVersion(FormVersionId)`
- **Indexes and unique constraints (2):** `UQ_FormField_Key` (FormVersionId,FieldKey) - unique; `UQ_FormField_Order` (FormVersionId,SortOrder) - unique.
- **Check constraints (6):** `CK_FormField_Control`, `CK_FormField_DefaultJson`, `CK_FormField_Key`, `CK_FormField_RequiredWhenJson`, `CK_FormField_ShowWhenJson`, `CK_FormField_ValidationJson`.
- **Triggers:** `TR_FormField_Immutable`.

### FormFieldOption

One option of a choice field. Immutable once the version is published.

- **Module:** Configuration. **Area:** Forms and custom fields.
- **Scripts:** created by script 6.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_FormFieldOption` (FormFieldOptionId), int identity.
- **Columns (6; `?` = nullable):** `FormFieldOptionId int`, `FormFieldId int`, `OptionKey varchar(64)`, `Label nvarchar(200)`, `SortOrder int`, `AvailableWhenJson nvarchar(max)?`.
- **Foreign keys (1):**
  - `FK_FormFieldOption_Field`: `FormFieldId` to `FormField(FormFieldId)`
- **Indexes and unique constraints (2):** `UQ_FormFieldOption_Key` (FormFieldId,OptionKey) - unique; `UQ_FormFieldOption_Order` (FormFieldId,SortOrder) - unique.
- **Check constraints (1):** `CK_FormFieldOption_AvailableWhen`.
- **Triggers:** `TR_FormFieldOption_Immutable`.

### FormValueSet

The stored values (JSON) of a form for one owner (task, step instance, asset, matter, client or project), tied to the form version used.

- **Module:** Configuration. **Area:** Forms and custom fields.
- **Scripts:** created by script 6.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_FormValueSet` (FormValueSetId), bigint identity.
- **Columns (11; `?` = nullable):** `FormValueSetId bigint`, `OwnerKind varchar(16)`, `OwnerId bigint`, `FormDefinitionId int`, `FormVersionId int`, `ValuesJson nvarchar(max)`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (4):**
  - `FK_FormValueSet_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_FormValueSet_Definition`: `FormDefinitionId` to `FormDefinition(FormDefinitionId)`
  - `FK_FormValueSet_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
  - `FK_FormValueSet_Version`: `FormVersionId` to `FormVersion(FormVersionId)`
- **Indexes and unique constraints (2):** `IX_FormValueSet_Version` (FormVersionId); `UQ_FormValueSet_Owner` (OwnerKind,OwnerId,FormDefinitionId) - unique.
- **Check constraints (2):** `CK_FormValueSet_Json`, `CK_FormValueSet_OwnerKind`.

### CustomFieldIndex

Typed copies of custom field values (text, number, date, date and time, bool) so lists, search and reports can filter and aggregate with seeks instead of reading JSON. Rebuilt by the application.

- **Module:** Configuration. **Area:** Forms and custom fields.
- **Scripts:** created by script 6; changed by script 47.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_CustomFieldIndex` (CustomFieldIndexId), bigint identity.
- **Columns (10; `?` = nullable):** `CustomFieldIndexId bigint`, `OwnerKind varchar(12)`, `OwnerId bigint`, `FormDefinitionId int`, `FieldKey varchar(64)`, `ValueText nvarchar(450)?`, `ValueNumber decimal(19,4)?`, `ValueDate date?`, `ValueDateTime datetime2(7)?`, `ValueBool bit?`.
- **Foreign keys (1):**
  - `FK_CFI_Definition`: `FormDefinitionId` to `FormDefinition(FormDefinitionId)`
- **Indexes and unique constraints (7):** `IX_CFI_Bool` (OwnerKind,FormDefinitionId,FieldKey,ValueBool) - filter [ValueBool] IS NOT NULL; includes OwnerId; `IX_CFI_Date` (OwnerKind,FormDefinitionId,FieldKey,ValueDate) - filter [ValueDate] IS NOT NULL; includes OwnerId; `IX_CFI_DateTime` (OwnerKind,FormDefinitionId,FieldKey,ValueDateTime) - filter [ValueDateTime] IS NOT NULL; includes OwnerId; `IX_CFI_Kind_Field_Owner` (OwnerKind,FieldKey,OwnerId) - includes ValueNumber,ValueText; `IX_CFI_Number` (OwnerKind,FormDefinitionId,FieldKey,ValueNumber) - filter [ValueNumber] IS NOT NULL; includes OwnerId; `IX_CFI_Owner` (OwnerKind,OwnerId); `IX_CFI_Text` (OwnerKind,FormDefinitionId,FieldKey,ValueText) - filter [ValueText] IS NOT NULL; includes OwnerId.
- **Check constraints (2):** `CK_CFI_OneValue`, `CK_CFI_OwnerKind`.

## Area: Assets

### AssetType

Admin-defined kind of asset, with a custom field form (through `FormDefinition`), an icon, a colour, an optional size field and unit and the optional automatic numbering of its assets (issue #1297: on or off, the pattern after the matter's CM Number, the scope).

- **Module:** Assets. **Area:** Assets.
- **Scripts:** created by script 10; changed by scripts 44, 50, 63.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_AssetType` (AssetTypeId), int identity.
- **Columns (17; `?` = nullable):** `AssetTypeId int`, `Name nvarchar(100)`, `Description nvarchar(500)?`, `SortOrder int`, `IsActive bit`, `SizeFieldKey varchar(64)?`, `SizeUnit varchar(10)?`, `IconKey varchar(50)?`, `ColourKey varchar(20)?`, `NumberingEnabled bit` (default 0), `NumberingPattern nvarchar(150)` (the tail after the CM Number, default `_{###}`), `NumberingScope int` (1 = per matter). Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (2):**
  - `FK_AssetType_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_AssetType_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (2):** `IX_AssetType_Sort` (SortOrder,Name); `UQ_AssetType_Name` (Name) - unique.
- **Check constraints (7):** `CK_AssetType_ColourKey`, `CK_AssetType_IconKey`, `CK_AssetType_Name`, `CK_AssetType_NumberingPattern` (length 1 to 50), `CK_AssetType_NumberingScope` (1), `CK_AssetType_SizeField_Unit`, `CK_AssetType_SizeUnit`.

### Asset

A data source or deliverable that belongs to one matter (for example a workspace, vault, media or data set). Has an asset type, a disposition (Active, Inactive, Pending disposition, Disposed) and custom field values in `FormValueSet`.

- **Module:** Assets. **Area:** Assets.
- **Scripts:** created by script 10; changed by scripts 43, 63.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_Asset` (AssetId), int identity.
- **Columns (18; `?` = nullable):** `AssetId int`, `AssetNumber nvarchar(100)?` (the generated Asset Number, a snapshot, never changed; null for assets of types without numbering and for every asset that existed before script 63), `AssetNumberSeq int?` (the counter value it was built from), `MatterId int`, `AssetTypeId int`, `DisplayName nvarchar(300)`, `ExternalReference nvarchar(1000)?`, `Description nvarchar(2000)?`, `IsActive bit`, `DispositionCode varchar(20)`, `DispositionChangedAt datetime2(7)?`, `DispositionChangedByUserId int?`, `DispositionNote nvarchar(500)?`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (5):**
  - `FK_Asset_AssetType`: `AssetTypeId` to `AssetType(AssetTypeId)`
  - `FK_Asset_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_Asset_DispositionChangedBy`: `DispositionChangedByUserId` to `AppUser(UserId)`
  - `FK_Asset_Matter`: `MatterId` to `Matter(MatterId)`
  - `FK_Asset_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (6):** `IX_Asset_Matter` (MatterId,AssetTypeId) - includes DisplayName,IsActive; `IX_Asset_Matter_Disposition` (MatterId,AssetTypeId,DispositionCode); `IX_Asset_Name` (DisplayName); `IX_Asset_Type` (AssetTypeId); `UQ_Asset_AssetNumber` (AssetTypeId,MatterId,AssetNumber) - unique; filter [AssetNumber] IS NOT NULL; `UQ_Asset_IdMatter` (AssetId,MatterId) - unique.
- **Check constraints (4):** `CK_Asset_AssetNumber` (number and sequence are both null or both set), `CK_Asset_DisplayName`, `CK_Asset_DispositionCode`, `CK_Asset_IsActive_Disposition`.
- **Triggers:** `TR_Asset_Guard` (no delete, no move to another matter, an assigned Asset Number can never change or be removed; re-created by script 63).

### AssetNumberCounter

The atomic counter of the automatic asset numbering (issue #1297): one row per asset type and scope key (the matter id while the scope is per matter). `NextNumber` is the counter value the next asset gets. It is read and advanced by one `UPDATE ... OUTPUT` under an update lock inside the transaction that inserts the asset, so concurrent creates never share a number; it only goes up (an administrator may raise it with the "set next number" control; the application never lowers it: the control refuses a value below the current next number), and deleting or deactivating an asset never touches it.

- **Module:** Assets. **Area:** Assets.
- **Scripts:** created by script 63.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_AssetNumberCounter` (AssetTypeId,ScopeKey).
- **Columns (4; `?` = nullable):** `AssetTypeId int`, `ScopeKey int`, `NextNumber int` (default 1), `ModifiedAt datetime2(7)`.
- **Foreign keys (1):**
  - `FK_AssetNumberCounter_AssetType`: `AssetTypeId` to `AssetType(AssetTypeId)`
- **Indexes and unique constraints (1):** the primary key only.
- **Check constraints (1):** `CK_AssetNumberCounter_Next` (NextNumber at least 1).

### AssetReport

A person's saved asset report definition (JSON) for the asset report builder. Unique name per owner.

- **Module:** Assets. **Area:** Assets.
- **Scripts:** created by script 45.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_AssetReport` (AssetReportId), int identity.
- **Columns (9; `?` = nullable):** `AssetReportId int`, `OwnerUserId int`, `Name nvarchar(100)`, `DefinitionJson nvarchar(4000)`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (3):**
  - `FK_AssetReport_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_AssetReport_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
  - `FK_AssetReport_Owner`: `OwnerUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (1):** `UQ_AssetReport_OwnerName` (OwnerUserId,Name) - unique.
- **Check constraints (2):** `CK_AssetReport_Definition`, `CK_AssetReport_Name`.

## Area: Productions

### ProductionSpec

The agreed format of productions of a matter (image format, text, natives, load file, redaction, privilege and other rules). Retired, never deleted.

- **Module:** Productions. **Area:** Productions.
- **Scripts:** created by script 52.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_ProductionSpec` (ProductionSpecId), int identity.
- **Columns (24; `?` = nullable):** `ProductionSpecId int`, `MatterId int`, `Name nvarchar(200)`, `StatusCode varchar(10)`, `SourceOfAgreement nvarchar(300)?`, `Description nvarchar(1000)?`, `ImageFormat nvarchar(100)?`, `ColourMode nvarchar(100)?`, `TextMode nvarchar(100)?`, `NativesRule nvarchar(300)?`, `LoadFile nvarchar(100)?`, `MetadataFieldsJson nvarchar(4000)?`, `RedactionRule nvarchar(300)?`, `PrivilegeRule nvarchar(300)?`, `DedupRule nvarchar(200)?`, `DateTimeRule nvarchar(200)?`, `NumberingRule nvarchar(200)?`, `DeliveryRule nvarchar(300)?`, `Notes nvarchar(2000)?`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (3):**
  - `FK_ProductionSpec_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_ProductionSpec_Matter`: `MatterId` to `Matter(MatterId)`
  - `FK_ProductionSpec_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (3):** `IX_ProductionSpec_Matter` (MatterId,StatusCode); `UQ_ProductionSpec_ActiveName` (MatterId,Name) - unique; filter [StatusCode]='Active'; `UQ_ProductionSpec_IdMatter` (ProductionSpecId,MatterId) - unique.
- **Check constraints (3):** `CK_ProductionSpec_Fields`, `CK_ProductionSpec_Name`, `CK_ProductionSpec_Status`.
- **Triggers:** `TR_ProductionSpec_Guard`.

### Production

A production of a matter: an incoming or outgoing delivery with volume, Bates range, counts and an optional spec.

- **Module:** Productions. **Area:** Productions.
- **Scripts:** created by script 53.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_Production` (ProductionId), int identity.
- **Columns (18; `?` = nullable):** `ProductionId int`, `MatterId int`, `Name nvarchar(200)`, `VolumeNo nvarchar(50)?`, `DirectionCode varchar(3)`, `PartyName nvarchar(200)?`, `ProductionSpecId int?`, `BatesBegin nvarchar(50)?`, `BatesEnd nvarchar(50)?`, `DocCount int?`, `PageCount int?`, `DeliveredOrDueOn date?`, `Notes nvarchar(4000)?`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (4):**
  - `FK_Production_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_Production_Matter`: `MatterId` to `Matter(MatterId)`
  - `FK_Production_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
  - `FK_Production_Spec`: `ProductionSpecId, MatterId` to `ProductionSpec(ProductionSpecId, MatterId)`
- **Indexes and unique constraints (3):** `IX_Production_Matter` (MatterId,DirectionCode) - includes ProductionSpecId,DeliveredOrDueOn; `IX_Production_Spec` (ProductionSpecId) - filter [ProductionSpecId] IS NOT NULL; `UQ_Production_IdMatter` (ProductionId,MatterId) - unique.
- **Check constraints (3):** `CK_Production_Counts`, `CK_Production_Direction`, `CK_Production_Name`.

### ProductionComment

A comment on a production.

- **Module:** Productions. **Area:** Productions.
- **Scripts:** created by script 53.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_ProductionComment` (ProductionCommentId), int identity.
- **Columns (9; `?` = nullable):** `ProductionCommentId int`, `ProductionId int`, `MatterId int`, `Body nvarchar(4000)`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (3):**
  - `FK_ProductionComment_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_ProductionComment_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
  - `FK_ProductionComment_Production`: `ProductionId, MatterId` to `Production(ProductionId, MatterId)` (delete: cascade)
- **Indexes and unique constraints (1):** `IX_ProductionComment_Production` (ProductionId,ProductionCommentId).
- **Check constraints (1):** `CK_ProductionComment_Body`.

## Area: Notes

### Note

A rich text note of a matter (HTML body plus plain text), with pinning and a lock held by one person.

- **Module:** Notes. **Area:** Notes.
- **Scripts:** created by script 54.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_Note` (NoteId), int identity.
- **Columns (16; `?` = nullable):** `NoteId int`, `MatterId int`, `Title nvarchar(300)`, `Snippet nvarchar(300)`, `BodyHtml nvarchar(max)`, `BodyText nvarchar(max)`, `IsPinned bit`, `LockedByUserId int?`, `LockedAt datetime2(7)?`, `ContentUpdatedAt datetime2(7)`, `ContentUpdatedByUserId int?`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (5):**
  - `FK_Note_ContentUpdatedBy`: `ContentUpdatedByUserId` to `AppUser(UserId)`
  - `FK_Note_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_Note_LockedBy`: `LockedByUserId` to `AppUser(UserId)`
  - `FK_Note_Matter`: `MatterId` to `Matter(MatterId)`
  - `FK_Note_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (2):** `IX_Note_Matter` (MatterId,IsPinned DESC,ContentUpdatedAt DESC) - includes LockedByUserId; `UQ_Note_IdMatter` (NoteId,MatterId) - unique.
- **Check constraints (1):** `CK_Note_Lock`.

### NoteLink

A link from a note to another record (user, note, matter, project or asset).

- **Module:** Notes. **Area:** Notes.
- **Scripts:** created by script 54.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_NoteLink` (NoteId, TargetType, TargetId).
- **Columns (3; `?` = nullable):** `NoteId int`, `TargetType varchar(10)`, `TargetId int`.
- **Foreign keys (1):**
  - `FK_NoteLink_Note`: `NoteId` to `Note(NoteId)` (delete: cascade)
- **Indexes and unique constraints (1):** `IX_NoteLink_Target` (TargetType,TargetId,NoteId).
- **Check constraints (1):** `CK_NoteLink_Type`.

### NoteTag

Firm-wide list of note tags.

- **Module:** Notes. **Area:** Notes.
- **Scripts:** created by script 54.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_NoteTag` (NoteTagId), int identity.
- **Columns (9; `?` = nullable):** `NoteTagId int`, `Name nvarchar(60)`, `ColourKey varchar(20)?`, `IsActive bit`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (2):**
  - `FK_NoteTag_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_NoteTag_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (1):** `UQ_NoteTag_Name` (Name) - unique.
- **Check constraints (1):** `CK_NoteTag_Name`.

### NoteTagLink

Junction: tags on a note.

- **Module:** Notes. **Area:** Notes.
- **Scripts:** created by script 54.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_NoteTagLink` (NoteId, NoteTagId).
- **Columns (2; `?` = nullable):** `NoteId int`, `NoteTagId int`.
- **Foreign keys (2):**
  - `FK_NoteTagLink_Note`: `NoteId` to `Note(NoteId)` (delete: cascade)
  - `FK_NoteTagLink_Tag`: `NoteTagId` to `NoteTag(NoteTagId)`
- **Indexes and unique constraints (1):** `IX_NoteTagLink_Tag` (NoteTagId,NoteId).

### NoteTemplate

A starting text for a note at one of three levels: System, Client or Matter.

- **Module:** Notes. **Area:** Notes.
- **Scripts:** created by script 55; changed by script 56.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_NoteTemplate` (NoteTemplateId), int identity.
- **Columns (14; `?` = nullable):** `NoteTemplateId int`, `ScopeCode varchar(6)`, `MatterId int?`, `Name nvarchar(100)`, `Description nvarchar(160)?`, `TitleTemplate nvarchar(300)?`, `BodyHtml nvarchar(max)`, `UsedCount int`, `ClientId int?`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (4):**
  - `FK_NoteTemplate_Client`: `ClientId` to `Client(ClientId)`
  - `FK_NoteTemplate_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_NoteTemplate_Matter`: `MatterId` to `Matter(MatterId)`
  - `FK_NoteTemplate_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (3):** `UQ_NoteTemplate_ClientName` (ClientId,Name) - unique; filter [ClientId] IS NOT NULL; `UQ_NoteTemplate_MatterName` (MatterId,Name) - unique; filter [MatterId] IS NOT NULL; `UQ_NoteTemplate_SystemName` (Name) - unique; filter [ScopeCode]='SYSTEM'.
- **Check constraints (3):** `CK_NoteTemplate_Level`, `CK_NoteTemplate_Name`, `CK_NoteTemplate_Used`.

### NoteTemplateTag

Junction: suggested tags of a note template.

- **Module:** Notes. **Area:** Notes.
- **Scripts:** created by script 55.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_NoteTemplateTag` (NoteTemplateId, NoteTagId).
- **Columns (2; `?` = nullable):** `NoteTemplateId int`, `NoteTagId int`.
- **Foreign keys (2):**
  - `FK_NoteTemplateTag_Tag`: `NoteTagId` to `NoteTag(NoteTagId)`
  - `FK_NoteTemplateTag_Template`: `NoteTemplateId` to `NoteTemplate(NoteTemplateId)` (delete: cascade)

## Area: Availability and Calendar

### UserAvailability

Per-person availability profile: time zone and whether custom work hours exist. The old single Out of office columns are no longer read.

- **Module:** Identity. **Area:** Availability and Calendar.
- **Scripts:** created by script 22.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_UserAvailability` (UserId).
- **Columns (10; `?` = nullable):** `UserId int`, `Status varchar(20)`, `OutOfOfficeFromDate date?`, `OutOfOfficeUntilDate date?`, `Note nvarchar(200)?`, `TimeZoneId varchar(64)?`, `HasCustomWorkHours bit`, `UpdatedAtUtc datetime2(7)`, `UpdatedByUserId int?`, `RowVersion timestamp`.
- **Foreign keys (2):**
  - `FK_UserAvailability_UpdatedBy`: `UpdatedByUserId` to `AppUser(UserId)`
  - `FK_UserAvailability_User`: `UserId` to `AppUser(UserId)`
- **Indexes and unique constraints (1):** `IX_UserAvailability_Status` (Status) - includes OutOfOfficeFromDate,OutOfOfficeUntilDate.
- **Check constraints (2):** `CK_UserAvailability_Range`, `CK_UserAvailability_Status`.

### UserWorkHour

Weekly work hours of a person (ISO weekday 1 to 7, start and end time).

- **Module:** Identity. **Area:** Availability and Calendar.
- **Scripts:** created by script 22.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_UserWorkHour` (UserId, DayOfWeek).
- **Columns (4; `?` = nullable):** `UserId int`, `DayOfWeek tinyint`, `StartTime time`, `EndTime time`.
- **Foreign keys (1):**
  - `FK_UserWorkHour_User`: `UserId` to `AppUser(UserId)`
- **Check constraints (2):** `CK_UserWorkHour_Day`, `CK_UserWorkHour_Range`.

### UserAbsence

An Out of office entry of a person (vacation, sick, training, conference, other), whole days, end optional.

- **Module:** Identity. **Area:** Availability and Calendar.
- **Scripts:** created by script 58.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_UserAbsence` (AbsenceId), int identity.
- **Columns (11; `?` = nullable):** `AbsenceId int`, `UserId int`, `AbsenceType varchar(20)`, `StartDate date`, `EndDate date?`, `Note nvarchar(200)?`, `CreatedAtUtc datetime2(3)`, `CreatedByUserId int?`, `UpdatedAtUtc datetime2(3)`, `UpdatedByUserId int?`, `RowVersion timestamp`.
- **Foreign keys (3):**
  - `FK_UserAbsence_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_UserAbsence_UpdatedBy`: `UpdatedByUserId` to `AppUser(UserId)`
  - `FK_UserAbsence_User`: `UserId` to `AppUser(UserId)`
- **Indexes and unique constraints (2):** `IX_UserAbsence_Dates` (StartDate,EndDate) - includes UserId,AbsenceType; `IX_UserAbsence_User` (UserId,StartDate) - includes EndDate,AbsenceType.
- **Check constraints (2):** `CK_UserAbsence_Range`, `CK_UserAbsence_Type`.

### HolidayCalendar

A named holiday calendar. It can apply to everyone, be the default of a pod, or be assigned to a person.

- **Module:** Identity. **Area:** Availability and Calendar.
- **Scripts:** created by script 59.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_HolidayCalendar` (CalendarId), int identity.
- **Columns (12; `?` = nullable):** `CalendarId int`, `Name nvarchar(100)`, `ColourKey varchar(20)`, `RegionNote nvarchar(200)?`, `AppliesToEveryone bit`, `SortOrder int`, `IsActive bit`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (2):**
  - `FK_HolidayCalendar_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_HolidayCalendar_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (1):** `UQ_HolidayCalendar_Name` (Name) - unique.
- **Check constraints (1):** `CK_HolidayCalendar_Name`.

### Holiday

One holiday rule of a calendar (fixed date, nth weekday, Easter offset, once, or a range) with a weekend observance rule. Expanded for any year in code.

- **Module:** Identity. **Area:** Availability and Calendar.
- **Scripts:** created by script 59.
- **Report login (`mf_report_reader`):** allow.
- **Primary key:** `PK_Holiday` (HolidayId), int identity.
- **Columns (22; `?` = nullable):** `HolidayId int`, `CalendarId int`, `Name nvarchar(100)`, `RuleKind varchar(20)`, `Month tinyint?`, `Day tinyint?`, `Nth smallint?`, `Weekday tinyint?`, `PlusDays tinyint`, `EasterOffset smallint?`, `OnceDate date?`, `RangeEndMonth tinyint?`, `RangeEndDay tinyint?`, `RangeEndDate date?`, `Yearly bit`, `WeekendRule varchar(10)`, `RegionNote nvarchar(200)?`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (3):**
  - `FK_Holiday_Calendar`: `CalendarId` to `HolidayCalendar(CalendarId)`
  - `FK_Holiday_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_Holiday_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (1):** `IX_Holiday_Calendar` (CalendarId,HolidayId).
- **Check constraints (11):** `CK_Holiday_Day`, `CK_Holiday_Fields`, `CK_Holiday_Month`, `CK_Holiday_Name`, `CK_Holiday_Nth`, `CK_Holiday_OnceRange`, `CK_Holiday_PlusDays`, `CK_Holiday_RangeEnd`, `CK_Holiday_RuleKind`, `CK_Holiday_Weekday`, `CK_Holiday_WeekendRule`.

## Area: Reports

### ReportCategory

A category to group reports.

- **Module:** Reports. **Area:** Reports.
- **Scripts:** created by script 30.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_ReportCategory` (ReportCategoryId), int identity.
- **Columns (9; `?` = nullable):** `ReportCategoryId int`, `Name nvarchar(100)`, `SortOrder int`, `IsActive bit`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (2):**
  - `FK_ReportCategory_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_ReportCategory_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (1):** `UQ_ReportCategory_Name` (Name) - unique.
- **Check constraints (1):** `CK_ReportCategory_Name`.

### ReportDefinition

A report: name, category, current version, timeout and row limit.

- **Module:** Reports. **Area:** Reports.
- **Scripts:** created by script 30.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_ReportDefinition` (ReportId), int identity.
- **Columns (16; `?` = nullable):** `ReportId int`, `ReportCategoryId int`, `Name nvarchar(150)`, `Description nvarchar(1000)?`, `HelpText nvarchar(max)?`, `SortOrder int`, `IsActive bit`, `CurrentVersionId int?`, `TimeoutSeconds int?`, `MaxRows int?`, `LastPreviewOkVersionId int?`. Plus the five standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`.
- **Foreign keys (5):**
  - `FK_ReportDefinition_Category`: `ReportCategoryId` to `ReportCategory(ReportCategoryId)`
  - `FK_ReportDefinition_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_ReportDefinition_CurrentVersion`: `CurrentVersionId` to `ReportVersion(ReportVersionId)`
  - `FK_ReportDefinition_LastPreviewOkVersion`: `LastPreviewOkVersionId` to `ReportVersion(ReportVersionId)`
  - `FK_ReportDefinition_ModifiedBy`: `ModifiedByUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (4):** `IX_ReportDefinition_Category` (ReportCategoryId,SortOrder); `IX_ReportDefinition_CurrentVersion` (CurrentVersionId) - filter [CurrentVersionId] IS NOT NULL; `IX_ReportDefinition_PreviewVersion` (LastPreviewOkVersionId) - filter [LastPreviewOkVersionId] IS NOT NULL; `UQ_ReportDefinition_Name` (Name) - unique.
- **Check constraints (4):** `CK_ReportDefinition_ActiveHasVersion`, `CK_ReportDefinition_MaxRows`, `CK_ReportDefinition_Name`, `CK_ReportDefinition_Timeout`.

### ReportVersion

One version of a report's SQL text and parameters. Append-only.

- **Module:** Reports. **Area:** Reports.
- **Scripts:** created by script 30.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_ReportVersion` (ReportVersionId), int identity.
- **Columns (9; `?` = nullable):** `ReportVersionId int`, `ReportId int`, `VersionNo int`, `SqlText nvarchar(max)`, `SqlHash binary`, `ParametersJson nvarchar(max)`, `ChangeNote nvarchar(300)?`, `CreatedAt datetime2(7)`, `CreatedByUserId int?`.
- **Foreign keys (2):**
  - `FK_ReportVersion_CreatedBy`: `CreatedByUserId` to `AppUser(UserId)`
  - `FK_ReportVersion_Report`: `ReportId` to `ReportDefinition(ReportId)`
- **Indexes and unique constraints (1):** `UQ_ReportVersion_ReportNo` (ReportId,VersionNo) - unique.
- **Check constraints (3):** `CK_ReportVersion_ParametersJson`, `CK_ReportVersion_Sql`, `CK_ReportVersion_VersionNo`.
- **Triggers:** `TR_ReportVersion_AppendOnly`.

### ReportParameter

A typed parameter of a report (text, number, date, date range, yes or no, single, multi, lookup).

- **Module:** Reports. **Area:** Reports.
- **Scripts:** created by script 30.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_ReportParameter` (ReportParameterId), int identity.
- **Columns (15; `?` = nullable):** `ReportParameterId int`, `ReportId int`, `Name varchar(64)`, `Ordinal int`, `Type varchar(20)`, `LookupKind varchar(20)?`, `LookupMulti bit`, `Label nvarchar(100)`, `HelpText nvarchar(300)?`, `DefaultJson nvarchar(500)?`, `IsRequired bit`, `OptionsKind varchar(10)?`, `OptionsJson nvarchar(max)?`, `OptionsSql nvarchar(max)?`, `SettingsJson nvarchar(max)?`.
- **Foreign keys (1):**
  - `FK_ReportParameter_Report`: `ReportId` to `ReportDefinition(ReportId)`
- **Indexes and unique constraints (1):** `UQ_ReportParameter_Name` (ReportId,Name) - unique.
- **Check constraints (5):** `CK_ReportParameter_Json`, `CK_ReportParameter_LookupKind`, `CK_ReportParameter_Name`, `CK_ReportParameter_OptionsKind`, `CK_ReportParameter_Type`.

### RoleReport

Junction: reports a role may run.

- **Module:** Reports. **Area:** Reports.
- **Scripts:** created by script 30.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_RoleReport` (RoleId, ReportId).
- **Columns (4; `?` = nullable):** `RoleId int`, `ReportId int`, `GrantedAt datetime2(7)`, `GrantedByUserId int?`.
- **Foreign keys (3):**
  - `FK_RoleReport_GrantedBy`: `GrantedByUserId` to `AppUser(UserId)`
  - `FK_RoleReport_Report`: `ReportId` to `ReportDefinition(ReportId)`
  - `FK_RoleReport_Role`: `RoleId` to `Role(RoleId)`
- **Indexes and unique constraints (1):** `IX_RoleReport_Report` (ReportId).

### SavedReportView

A person's saved view (columns, sort, filters, parameters) of a report.

- **Module:** Reports. **Area:** Reports.
- **Scripts:** created by script 30.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_SavedReportView` (SavedReportViewId), int identity.
- **Columns (10; `?` = nullable):** `SavedReportViewId int`, `ReportId int`, `UserId int`, `Name nvarchar(100)`, `IsDefault bit`, `ViewJson nvarchar(max)`, `ParamsJson nvarchar(max)?`, `CreatedAt datetime2(7)`, `ModifiedAt datetime2(7)?`, `RowVersion timestamp`.
- **Foreign keys (2):**
  - `FK_SavedReportView_Report`: `ReportId` to `ReportDefinition(ReportId)`
  - `FK_SavedReportView_User`: `UserId` to `AppUser(UserId)`
- **Indexes and unique constraints (3):** `IX_SavedReportView_User` (UserId,ReportId); `UQ_SavedReportView_Name` (ReportId,UserId,Name) - unique; `UX_SavedReportView_Default` (ReportId,UserId) - unique; filter [IsDefault]=(1.
- **Check constraints (2):** `CK_SavedReportView_Json`, `CK_SavedReportView_Name`.

### ReportFavourite

Junction: a person's pinned reports.

- **Module:** Reports. **Area:** Reports.
- **Scripts:** created by script 30.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_ReportFavourite` (UserId, ReportId).
- **Columns (3; `?` = nullable):** `UserId int`, `ReportId int`, `PinnedAt datetime2(7)`.
- **Foreign keys (2):**
  - `FK_ReportFavourite_Report`: `ReportId` to `ReportDefinition(ReportId)`
  - `FK_ReportFavourite_User`: `UserId` to `AppUser(UserId)`

### ReportRecent

A person's most recently run reports.

- **Module:** Reports. **Area:** Reports.
- **Scripts:** created by script 30.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_ReportRecent` (UserId, ReportId).
- **Columns (3; `?` = nullable):** `UserId int`, `ReportId int`, `LastRunAt datetime2(7)`.
- **Foreign keys (2):**
  - `FK_ReportRecent_Report`: `ReportId` to `ReportDefinition(ReportId)`
  - `FK_ReportRecent_User`: `UserId` to `AppUser(UserId)`

### ReportRun

The run log: who ran which report version, when, with which parameters, status, rows and duration. Completed once through a procedure, purged after two years.

- **Module:** Reports. **Area:** Reports.
- **Scripts:** created by script 30.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_ReportRun` (ReportRunId), bigint identity.
- **Columns (15; `?` = nullable):** `ReportRunId bigint`, `ReportId int`, `ReportVersionId int`, `UserId int`, `StartedAt datetime2(7)`, `FinishedAt datetime2(7)?`, `Status varchar(12)`, `Kind varchar(12)`, `ParametersJson nvarchar(4000)?`, `RowCount int?`, `Truncated bit`, `DurationMs int?`, `ErrorCode varchar(40)?`, `ExportedRowCount int?`, `CorrelationId uniqueidentifier`.
- **Foreign keys (3):**
  - `FK_ReportRun_Report`: `ReportId` to `ReportDefinition(ReportId)`
  - `FK_ReportRun_User`: `UserId` to `AppUser(UserId)`
  - `FK_ReportRun_Version`: `ReportVersionId` to `ReportVersion(ReportVersionId)`
- **Indexes and unique constraints (3):** `IX_ReportRun_Report` (ReportId,StartedAt DESC); `IX_ReportRun_Started` (StartedAt); `IX_ReportRun_User` (UserId,StartedAt DESC).
- **Check constraints (3):** `CK_ReportRun_Json`, `CK_ReportRun_Kind`, `CK_ReportRun_Status`.
- **Triggers:** `TR_ReportRun_Guard`.

## Area: Audit, Notifications, Settings and platform

### AuditEvent

The append-only audit trail: who did what to which object and when. `MatterId` and `TaskId` are scope columns without foreign keys (audit outlives its subjects).

- **Module:** Audit. **Area:** Audit, Notifications, Settings and platform.
- **Scripts:** created by script 3; changed by scripts 17, 36.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_AuditEvent` (AuditEventId), bigint identity.
- **Columns (14; `?` = nullable):** `AuditEventId bigint`, `OccurredAtUtc datetime2(3)`, `ActorUserId int?`, `EventType varchar(64)`, `ObjectType varchar(40)`, `ObjectId varchar(40)`, `MatterId int?`, `TaskId bigint?`, `FieldKey varchar(100)?`, `OldValue nvarchar(max)?`, `NewValue nvarchar(max)?`, `Summary nvarchar(500)?`, `CorrelationId uniqueidentifier`, `IsSensitiveScope bit`.
- **Foreign keys:** none.
- **Indexes and unique constraints (7):** `IX_Audit_Actor` (ActorUserId,AuditEventId) - filter [ActorUserId] IS NOT NULL; `IX_Audit_Correlation` (CorrelationId); `IX_Audit_EventType` (EventType,AuditEventId); `IX_Audit_Matter` (MatterId,AuditEventId) - filter [MatterId] IS NOT NULL; `IX_Audit_Object` (ObjectType,ObjectId,AuditEventId); `IX_Audit_Task` (TaskId,AuditEventId) - filter [TaskId] IS NOT NULL; `IX_Audit_Time` (OccurredAtUtc).
- **Check constraints (1):** `CK_AuditEvent_EventType`.
- **Triggers:** `TR_AuditEvent_AppendOnly`.

### AuditEventGuard

A permanently empty table that references `AuditEvent`, so SQL Server refuses `TRUNCATE TABLE` on the audit table, even for a sysadmin (script 13).

- **Module:** Audit (created by script 13). **Area:** Audit, Notifications, Settings and platform.
- **Scripts:** created by script 13.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_AuditEventGuard` (AuditEventId).
- **Columns (1; `?` = nullable):** `AuditEventId bigint`.
- **Foreign keys (1):**
  - `FK_AuditEventGuard_AuditEvent`: `AuditEventId` to `AuditEvent(AuditEventId)`

### Notification

An in-app notification for one recipient. A unique dedupe key stops duplicates; `Id` is the poll cursor.

- **Module:** Notifications. **Area:** Audit, Notifications, Settings and platform.
- **Scripts:** created by script 29.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_Notification` (Id), bigint identity.
- **Columns (11; `?` = nullable):** `Id bigint`, `RecipientUserId int`, `EventType varchar(40)`, `ObjectKind varchar(20)`, `ObjectId bigint`, `MatterId int?`, `ActorUserId int?`, `Message nvarchar(300)`, `DedupeKey nvarchar(80)`, `CreatedUtc datetime2(3)`, `ReadUtc datetime2(3)?`.
- **Foreign keys (3):**
  - `FK_Notification_Actor`: `ActorUserId` to `AppUser(UserId)`
  - `FK_Notification_Matter`: `MatterId` to `Matter(MatterId)`
  - `FK_Notification_Recipient`: `RecipientUserId` to `AppUser(UserId)`
- **Indexes and unique constraints (5):** `IX_Notification_Created` (CreatedUtc); `IX_Notification_Read` (ReadUtc) - filter [ReadUtc] IS NOT NULL; `IX_Notification_Recipient` (RecipientUserId,Id DESC); `IX_Notification_Unread` (RecipientUserId,Id DESC) - filter [ReadUtc] IS NULL; includes ObjectKind,ObjectId,MatterId; `UX_Notification_Dedupe` (RecipientUserId,EventType,ObjectId,DedupeKey) - unique.
- **Check constraints (5):** `CK_Notification_DedupeKey`, `CK_Notification_EventType`, `CK_Notification_Message`, `CK_Notification_ObjectKind`, `CK_Notification_ReadAfterCreate`.

### NotificationPreference

Sparse per-user switches for notification event types (a row exists only when changed from the default).

- **Module:** Notifications. **Area:** Audit, Notifications, Settings and platform.
- **Scripts:** created by script 29.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_NotificationPreference` (UserId, EventType).
- **Columns (4; `?` = nullable):** `UserId int`, `EventType varchar(40)`, `Enabled bit`, `UpdatedUtc datetime2(3)`.
- **Foreign keys (1):**
  - `FK_NotificationPreference_User`: `UserId` to `AppUser(UserId)`
- **Check constraints (1):** `CK_NotificationPreference_EventType`.

### AppSetting

Application settings as key and value (text, or a binary file with content type and SHA-256). No seed rows: defaults live in code (`SettingDefinitions.cs`).

- **Module:** Configuration. **Area:** Audit, Notifications, Settings and platform.
- **Scripts:** created by script 48.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_AppSetting` (SettingKey).
- **Columns (8; `?` = nullable):** `SettingKey varchar(100)`, `ValueText nvarchar(1000)?`, `ValueBinary varbinary(max)?`, `ContentType varchar(100)?`, `ContentSha256 binary?`, `UpdatedAtUtc datetime2(3)`, `UpdatedByUserId int`, `RowVersion timestamp`.
- **Foreign keys (1):**
  - `FK_AppSetting_UpdatedBy`: `UpdatedByUserId` to `AppUser(UserId)`
- **Check constraints (3):** `CK_AppSetting_Binary`, `CK_AppSetting_Key`, `CK_AppSetting_Size`.

### UserMatterActivitySeen

Per person: the highest audit event id marked as read in My Matters recent activity.

- **Module:** WorkViews (raw SQL, no entity). **Area:** Audit, Notifications, Settings and platform.
- **Scripts:** created by script 31; changed by script 39.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_UserMatterActivitySeen` (UserId).
- **Columns (4; `?` = nullable):** `UserId int`, `SeenAuditEventId bigint`, `SeenAtUtc datetime2(3)`, `IsInitial bit`.
- **Foreign keys (1):**
  - `FK_UserMatterActivitySeen_User`: `UserId` to `AppUser(UserId)`
- **Check constraints (1):** `CK_UserMatterActivitySeen_Event`.

### SchemaMigration

Created by the schema runner (not by a numbered script): one row per applied script with SHA-256 checksum, time and success flag.

- **Module:** Data (schema runner, not a numbered script). **Area:** Audit, Notifications, Settings and platform.
- **Scripts:** created by the schema runner, not by a script.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_SchemaMigration` (SchemaMigrationId), int identity.
- **Columns (9; `?` = nullable):** `SchemaMigrationId int`, `ScriptName nvarchar(260)`, `Prefix int`, `Checksum char(64)`, `AppliedAtUtc datetime2(3)`, `DurationMs int`, `Success bit`, `AppliedBy nvarchar(256)?`, `AppVersion nvarchar(64)?`.
- **Foreign keys:** none.
- **Indexes and unique constraints (2):** `UQ_SchemaMigration_Name` (ScriptName) - unique; `UQ_SchemaMigration_Prefix` (Prefix) - unique.

### SeedMarker

Bookkeeping so a one-time seed (for example the starter roles) runs exactly once.

- **Module:** Identity (seeder bookkeeping). **Area:** Audit, Notifications, Settings and platform.
- **Scripts:** created by script 13.
- **Report login (`mf_report_reader`):** deny.
- **Primary key:** `PK_SeedMarker` (Name).
- **Columns (2; `?` = nullable):** `Name varchar(100)`, `AppliedAt datetime2(7)`.
- **Foreign keys:** none.

## Related pages

- [ER Diagrams](ER-Diagrams.md)
- [Schema Script History](Schema-Script-History.md)
- [Database Overview](Overview.md)
- [Module Guide](../Backend/Module-Guide.md)

Last verified against commit a80aa5a.
