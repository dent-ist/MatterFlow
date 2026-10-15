# 05 Permissions, data model, UX and admin

Related: `contracts/permissions.json`, `docs/architecture.md` 6.3, 8.1, `docs/erd.md` sections 4, 7, 8, `docs/ux/admin-menu/README.md`, `docs/ux/task-detail-v2/README.md`, `db/scripts/README.md`.

## 1. Permissions

New catalogue entries (group `Apps`, added to `contracts/permissions.json`, `Permissions.cs`, `permissions.ts`):

| Code | Description | Default holders |
|---|---|---|
| `App.Launch` | Open Apps (menu item, launcher page, step/task buttons). Per-app access additionally needs an `AppRoleGrant`. | Seeded on first install: Director, Project Manager, Pod Lead, Data Technician, Data Scientist (only when `Role` table has the starter roles; existing installs: granted by migration script `26` to roles that hold `Task.View`, **but no app is granted**, so nothing appears until an admin ticks apps). System Admin implicit. |
| `App.Manage` | Register, upload, approve, enable, disable, configure, bind roots/connectors, rotate keys, remove apps. | **System Admin only.** Not granted to any seeded role. |

Rules:

1. **Effective launch right** for user U and app A: `U.IsSystemAdmin` OR (`App.Launch` in U's permissions AND an `AppRoleGrant(RoleId, A)` for any role of U) AND `A.Status = ENABLED` (admins may also test a non-enabled app through "Test launch", audited).
2. `App.Manage` is not a normal grantable permission in the Roles editor: the checkbox is shown **disabled with a lock and a warning** unless the editor is a System Admin, and the SEC-01 rule applies (nobody can grant above their own level; `User.Manage` holders cannot grant it). **Risk if ever delegated:** a holder can upload a back end that runs on the server under an App Host account and a front end that runs in every user's browser; treat it like "server administrator". Delegation to another internal team = give them the permission **and** turn on `Apps:RequireSecondApprover`.
3. Listing endpoints return only apps the caller may launch (404 for others, to avoid leaking existence).
4. Step/task buttons are shown if the app is linked and permitted; if linked but not permitted the button is hidden and an info line says "Linked app not available to your role" (so the user knows to ask).

### Dynamic per-app grants versus the static catalogue

| Option | Description | Pros | Cons | Verdict |
|---|---|---|---|---|
| **A: `AppRoleGrant(RoleId, AppId)` + catalogue `App.Launch`** | Apps are data; one catalogue permission gates the feature | Catalogue stays static and testable (`PermissionCatalog` tests, generated constants); grant rows are first-class, audited and cascade with roles/apps; role editor reads apps from DB | Two-part check (permission + grant); permission checker needs one extra query (cached with the permission set) | **Chosen** |
| B: dynamic permission codes `App.Launch:<code>` inserted into `Permission` by the registry | Reuse `RolePermission` | No new check code; existing role editor mechanics | Pollutes `contracts/permissions.json` source of truth (rows without constants), startup sync "mark removed codes inactive" conflicts, tests that enforce constants break, codes created at runtime by uploads | Rejected |
| C: grants only, no `App.Launch` | Simplest | One check | No master switch per role; menu visibility needs a join each time; harder "no apps at all" | Rejected |
| D: grant by category | Fewer rows | Coarse; no per-app control (owner asked per-app) | Rejected |

Permission set cache: `ICurrentUser` gains `AppIds` (set of app ids the user may launch), built with the same per-user cache and invalidated by the same events plus `AppRoleGrant` changes (`docs/architecture.md` 6.1 item 3).

## 2. Data model additions (SQL drafts)

Script numbers are indicative (next free are 25+; allocate at merge time, `docs/architecture.md` 4.4). Conventions per `docs/erd.md` section 1: `dbo`, singular PascalCase, explicit constraint names, UTC `datetime2(3)`, JSON columns `nvarchar(max)` with `CHECK (ISJSON(...)=1)`, no cascade deletes (apps are soft-removed).

### Script `25-apps-core.sql`

```sql
CREATE TABLE dbo.App (
  AppId            INT IDENTITY(1,1) CONSTRAINT PK_App PRIMARY KEY,
  AppCode          VARCHAR(40)   NOT NULL,                 -- manifest id, immutable
  AppGuid          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_App_Guid DEFAULT NEWID(), -- folder name
  Slug             VARCHAR(40)   NOT NULL,                 -- URL segment, unique, changeable
  Name             NVARCHAR(60)  NOT NULL,
  Description      NVARCHAR(300) NOT NULL,
  Category         NVARCHAR(40)  NOT NULL,
  IconRef          NVARCHAR(120) NULL,
  Status           VARCHAR(12)   NOT NULL CONSTRAINT DF_App_Status DEFAULT 'DISABLED', -- DISABLED | ENABLED | REMOVED
  DisabledReason   NVARCHAR(300) NULL,                     -- shown to users
  ActiveVersionId  INT NULL,                               -- FK AppVersion, set on activation
  HasBackend       BIT NOT NULL CONSTRAINT DF_App_HasBackend DEFAULT 0,
  Health           VARCHAR(12)   NOT NULL CONSTRAINT DF_App_Health DEFAULT 'UNKNOWN', -- UNKNOWN|OK|DEGRADED|DOWN|STOPPED (cached from App Host)
  HealthCheckedAtUtc DATETIME2(3) NULL,
  LastLaunchedAtUtc  DATETIME2(3) NULL,                    -- throttled update (once per minute)
  CreatedAtUtc     DATETIME2(3) NOT NULL CONSTRAINT DF_App_Created DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NOT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT UQ_App_Code UNIQUE (AppCode),
  CONSTRAINT UQ_App_Guid UNIQUE (AppGuid),
  CONSTRAINT UQ_App_Slug UNIQUE (Slug),
  CONSTRAINT CK_App_Status CHECK (Status IN ('DISABLED','ENABLED','REMOVED')),
  CONSTRAINT CK_App_Slug CHECK (Slug NOT LIKE '[_]%' AND Slug NOT IN ('api','admin','health','static','assets','launch','login')),
  CONSTRAINT FK_App_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser(UserId)
);

CREATE TABLE dbo.AppVersion (
  AppVersionId     INT IDENTITY(1,1) CONSTRAINT PK_AppVersion PRIMARY KEY,
  AppId            INT NOT NULL,
  Version          VARCHAR(40) NOT NULL,                   -- semver text
  Status           VARCHAR(10) NOT NULL,                   -- STAGED|REJECTED|APPROVED|ACTIVE|RETIRED
  PackageSha256    CHAR(64) NOT NULL,
  PackageBytes     BIGINT NOT NULL,
  FileCount        INT NOT NULL,
  ManifestJson     NVARCHAR(MAX) NOT NULL CONSTRAINT CK_AppVersion_Manifest CHECK (ISJSON(ManifestJson)=1),
  ValidationReportJson NVARCHAR(MAX) NOT NULL CONSTRAINT CK_AppVersion_Report CHECK (ISJSON(ValidationReportJson)=1),
  RequestedPermissionsJson NVARCHAR(MAX) NOT NULL CONSTRAINT CK_AppVersion_Perms CHECK (ISJSON(RequestedPermissionsJson)=1),
  ApprovedPermissionsJson  NVARCHAR(MAX) NULL CONSTRAINT CK_AppVersion_Appr CHECK (ApprovedPermissionsJson IS NULL OR ISJSON(ApprovedPermissionsJson)=1),
  SignatureInfo    NVARCHAR(200) NULL,                     -- optional internal signature result
  UploadedAtUtc    DATETIME2(3) NOT NULL CONSTRAINT DF_AppVersion_Up DEFAULT SYSUTCDATETIME(),
  UploadedByUserId INT NOT NULL,
  ApprovedAtUtc    DATETIME2(3) NULL,
  ApprovedByUserId INT NULL,
  SecondApprovedByUserId INT NULL,                         -- only when Apps:RequireSecondApprover
  ActivatedAtUtc   DATETIME2(3) NULL,
  Notes            NVARCHAR(1000) NULL,
  CONSTRAINT UQ_AppVersion UNIQUE (AppId, Version),
  CONSTRAINT CK_AppVersion_Status CHECK (Status IN ('STAGED','REJECTED','APPROVED','ACTIVE','RETIRED')),
  CONSTRAINT CK_AppVersion_Sha CHECK (LEN(PackageSha256)=64),
  CONSTRAINT CK_AppVersion_Second CHECK (SecondApprovedByUserId IS NULL OR SecondApprovedByUserId <> ApprovedByUserId),
  CONSTRAINT FK_AppVersion_App FOREIGN KEY (AppId) REFERENCES dbo.App(AppId),
  CONSTRAINT FK_AppVersion_Up FOREIGN KEY (UploadedByUserId) REFERENCES dbo.AppUser(UserId),
  CONSTRAINT FK_AppVersion_Appr FOREIGN KEY (ApprovedByUserId) REFERENCES dbo.AppUser(UserId)
);
CREATE UNIQUE INDEX UX_AppVersion_Active ON dbo.AppVersion (AppId) WHERE Status = 'ACTIVE';
ALTER TABLE dbo.App ADD CONSTRAINT FK_App_ActiveVersion FOREIGN KEY (ActiveVersionId) REFERENCES dbo.AppVersion(AppVersionId);
GO
-- Package, manifest and hash of a non-STAGED version are immutable (same pattern as TR_WorkflowVersion_Immutable):
-- TR_AppVersion_Immutable blocks UPDATE of PackageSha256, ManifestJson, ValidationReportJson, RequestedPermissionsJson, AppId, Version.
```

### Script `26-apps-access-and-links.sql`

```sql
CREATE TABLE dbo.AppRoleGrant (
  RoleId        INT NOT NULL,
  AppId         INT NOT NULL,
  GrantedAtUtc  DATETIME2(3) NOT NULL CONSTRAINT DF_AppRoleGrant_At DEFAULT SYSUTCDATETIME(),
  GrantedByUserId INT NOT NULL,
  CONSTRAINT PK_AppRoleGrant PRIMARY KEY (RoleId, AppId),
  CONSTRAINT FK_AppRoleGrant_Role FOREIGN KEY (RoleId) REFERENCES dbo.Role(RoleId),
  CONSTRAINT FK_AppRoleGrant_App  FOREIGN KEY (AppId)  REFERENCES dbo.App(AppId),
  CONSTRAINT FK_AppRoleGrant_By   FOREIGN KEY (GrantedByUserId) REFERENCES dbo.AppUser(UserId)
);
CREATE INDEX IX_AppRoleGrant_App ON dbo.AppRoleGrant (AppId, RoleId);
-- The System Admin role never gets rows (implicit all apps). Role delete is not allowed when referenced (soft-deactivate roles).

CREATE TABLE dbo.AppStepLink (                       -- library links and snapshot links
  AppStepLinkId BIGINT IDENTITY(1,1) CONSTRAINT PK_AppStepLink PRIMARY KEY,
  StepDefinitionId     INT NULL,                     -- library step (editable)
  WorkflowVersionStepId INT NULL,                    -- published/draft workflow version step (snapshot)
  AppCode       VARCHAR(40) NOT NULL,                -- stable reference
  SortOrder     TINYINT NOT NULL CONSTRAINT DF_AppStepLink_Sort DEFAULT 0,
  ButtonLabel   NVARCHAR(40) NULL,                   -- default "Open <App name>"
  CONSTRAINT CK_AppStepLink_Owner CHECK ((StepDefinitionId IS NULL AND WorkflowVersionStepId IS NOT NULL)
                                      OR (StepDefinitionId IS NOT NULL AND WorkflowVersionStepId IS NULL)),
  CONSTRAINT FK_AppStepLink_Def  FOREIGN KEY (StepDefinitionId)      REFERENCES dbo.StepDefinition(StepDefinitionId),
  CONSTRAINT FK_AppStepLink_Step FOREIGN KEY (WorkflowVersionStepId) REFERENCES dbo.WorkflowVersionStep(WorkflowVersionStepId),
  CONSTRAINT FK_AppStepLink_App  FOREIGN KEY (AppCode) REFERENCES dbo.App(AppCode)   -- UQ_App_Code is the FK target
);
CREATE UNIQUE INDEX UX_AppStepLink_Def  ON dbo.AppStepLink (StepDefinitionId, AppCode) WHERE StepDefinitionId IS NOT NULL;
CREATE UNIQUE INDEX UX_AppStepLink_Step ON dbo.AppStepLink (WorkflowVersionStepId, AppCode) WHERE WorkflowVersionStepId IS NOT NULL;
CREATE INDEX IX_AppStepLink_App ON dbo.AppStepLink (AppCode);
-- Immutability: rows with WorkflowVersionStepId whose WorkflowVersion is PUBLISHED/RETIRED cannot be inserted, updated or deleted
-- (trigger TR_AppStepLink_Immutable, same rule as WorkflowVersionStep). At most 3 links per step (CK in app service).
-- App.Launch / App.Manage are NOT inserted here: they are synced from contracts/permissions.json at startup (architecture 4.6).
```

### Script `27-apps-sessions-config-audit.sql`

```sql
CREATE TABLE dbo.AppSigningKey (
  AppSigningKeyId INT IDENTITY(1,1) CONSTRAINT PK_AppSigningKey PRIMARY KEY,
  Kid             VARCHAR(40) NOT NULL CONSTRAINT UQ_AppSigningKey_Kid UNIQUE,
  Status          VARCHAR(10) NOT NULL,            -- PENDING|ACTIVE|RETIRING|RETIRED|REVOKED
  PublicJwk       NVARCHAR(1000) NOT NULL,
  PrivateKeyProtected VARBINARY(MAX) NOT NULL,     -- Data Protection, purpose MatterFlow.Apps.Signing.v1
  CreatedAtUtc    DATETIME2(3) NOT NULL CONSTRAINT DF_AppSigningKey_C DEFAULT SYSUTCDATETIME(),
  ActivateAtUtc   DATETIME2(3) NOT NULL,
  RetireAtUtc     DATETIME2(3) NULL,
  CONSTRAINT CK_AppSigningKey_Status CHECK (Status IN ('PENDING','ACTIVE','RETIRING','RETIRED','REVOKED'))
);
CREATE UNIQUE INDEX UX_AppSigningKey_Active ON dbo.AppSigningKey (Status) WHERE Status = 'ACTIVE';

CREATE TABLE dbo.AppSession (
  AppSessionId    BIGINT IDENTITY(1,1) CONSTRAINT PK_AppSession PRIMARY KEY,
  TokenHash       BINARY(32) NOT NULL,             -- SHA-256 of the opaque session token
  LaunchJti       UNIQUEIDENTIFIER NOT NULL,       -- one-time redemption of the launch token
  AppId           INT NOT NULL,
  AppVersionId    INT NOT NULL,
  UserId          INT NOT NULL,
  TaskId          BIGINT NULL,
  StepInstanceId  BIGINT NULL,
  Source          VARCHAR(10) NOT NULL,            -- LAUNCHER|TASK|STEP|TEST
  CreatedAtUtc    DATETIME2(3) NOT NULL,
  LastSeenAtUtc   DATETIME2(3) NOT NULL,
  ExpiresAtUtc    DATETIME2(3) NOT NULL,           -- absolute
  RevokedAtUtc    DATETIME2(3) NULL,
  CONSTRAINT UQ_AppSession_Token UNIQUE (TokenHash),
  CONSTRAINT UQ_AppSession_Jti UNIQUE (LaunchJti),
  CONSTRAINT FK_AppSession_App FOREIGN KEY (AppId) REFERENCES dbo.App(AppId),
  CONSTRAINT FK_AppSession_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser(UserId),
  CONSTRAINT CK_AppSession_Source CHECK (Source IN ('LAUNCHER','TASK','STEP','TEST'))
);
CREATE INDEX IX_AppSession_Live ON dbo.AppSession (AppId, ExpiresAtUtc) WHERE RevokedAtUtc IS NULL;
-- Rows older than 7 days are deleted by a maintenance job (they are not audit; AppLaunchAudit is).

CREATE TABLE dbo.AppConfig (                         -- non-secret values, per app (not per version)
  AppId     INT NOT NULL,
  ConfigKey VARCHAR(40) NOT NULL,
  ValueText NVARCHAR(2000) NULL,
  ModifiedAtUtc DATETIME2(3) NOT NULL, ModifiedByUserId INT NOT NULL,
  CONSTRAINT PK_AppConfig PRIMARY KEY (AppId, ConfigKey),
  CONSTRAINT FK_AppConfig_App FOREIGN KEY (AppId) REFERENCES dbo.App(AppId)
);
CREATE TABLE dbo.AppSecret (                         -- write-only through the API
  AppId     INT NOT NULL,
  SecretKey VARCHAR(40) NOT NULL,
  ValueProtected VARBINARY(MAX) NOT NULL,            -- Data Protection, purpose MatterFlow.Apps.Secret.v1
  ModifiedAtUtc DATETIME2(3) NOT NULL, ModifiedByUserId INT NOT NULL,
  CONSTRAINT PK_AppSecret PRIMARY KEY (AppId, SecretKey),
  CONSTRAINT FK_AppSecret_App FOREIGN KEY (AppId) REFERENCES dbo.App(AppId)
);

CREATE TABLE dbo.AppLaunchAudit (                    -- append-only
  AppLaunchAuditId BIGINT IDENTITY(1,1) CONSTRAINT PK_AppLaunchAudit PRIMARY KEY,
  OccurredAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_ALA_At DEFAULT SYSUTCDATETIME(),
  AppId INT NOT NULL, AppVersionId INT NULL, UserId INT NOT NULL,
  TaskId BIGINT NULL, StepInstanceId BIGINT NULL, MatterId INT NULL,
  Source VARCHAR(10) NOT NULL,
  Result VARCHAR(24) NOT NULL,                       -- OK|DENIED_ROLE|DENIED_DISABLED|DENIED_TASK|DENIED_STEP|ERROR
  CorrelationId UNIQUEIDENTIFIER NULL
);
CREATE INDEX IX_ALA_App ON dbo.AppLaunchAudit (AppId, OccurredAtUtc);
CREATE INDEX IX_ALA_Task ON dbo.AppLaunchAudit (TaskId) WHERE TaskId IS NOT NULL;

CREATE TABLE dbo.AppUsageDaily (
  AppId INT NOT NULL, UsageDate DATE NOT NULL, Launches INT NOT NULL, DistinctUsers INT NOT NULL,
  CONSTRAINT PK_AppUsageDaily PRIMARY KEY (AppId, UsageDate),
  CONSTRAINT FK_AppUsageDaily_App FOREIGN KEY (AppId) REFERENCES dbo.App(AppId)
);
-- plus: DENY UPDATE, DELETE, ALTER on AppLaunchAudit (and AppServiceAudit in 28) to mf_app; extend AuditStoreGuard.
```

### Script `28-apps-platform-services.sql` (Phase 3; sketch)

`FileRoot(FileRootId, Name UQ, UncPath, Description, IsActive, AclCheck VARCHAR(8) 'NONE|PROBE', ProbeFailMode 'CLOSED|GRANT')`, `AppFileRootGrant(AppId, LogicalName, FileRootId, Access 'READ|WRITE|READWRITE', SubPath NULL)`, `Connector(ConnectorId, Name UQ, Type, BaseUrl, ConfigJson, SecretProtected, IsActive, RateLimitPerMinute, TimeoutSeconds)`, `AppConnectorGrant(AppId, LogicalName, ConnectorId, OperationsJson)`, `AppJob(AppJobId, AppId, UserId, TaskId, Kind, Title, State, ProgressPercent, ItemsDone, ItemsTotal, BytesDone, BytesTotal, ResultJson, ErrorCode, CreatedAtUtc, UpdatedAtUtc, CompletedAtUtc)`, `AppServiceAudit(AppServiceAuditId, OccurredAtUtc, AppId, UserId, TaskId, StepInstanceId, Service, Operation, Target, Bytes, Outcome, DurationMs, CorrelationId)` (append-only like `AppLaunchAudit`). Full columns are in `07`.

### How published workflow versions reference apps

`StepDefinition` (library) carries links as `AppStepLink(StepDefinitionId, AppCode)`. When a step is added to a workflow draft, the links are **copied** into `AppStepLink(WorkflowVersionStepId, AppCode)` exactly like title/instructions are copied (`docs/erd.md` section 7; addendum A: editing the library never changes published versions). Publishing freezes them. The reference is the stable **AppCode**, never a version: the app's ACTIVE version is used at launch. Rules: publish validation requires every linked AppCode to exist and not be `REMOVED` (warning if `DISABLED`); a disabled or removed app at run time shows the button disabled with the message "This app is currently switched off by an administrator" (or "no longer available"); the task still completes normally (apps never gate a step in release 1). Audit: `WORKFLOW_PUBLISHED` lists linked AppCodes; step link edits on drafts use `FIELD_CHANGED` (`apps`).

### `docs/erd.md` additions (to apply when the epics are created)

New section "9a. Apps": entity diagram of `App`, `AppVersion`, `AppRoleGrant`, `AppStepLink`, `AppSession`, `AppConfig`, `AppSecret`, `AppSigningKey`, `AppLaunchAudit`, `AppUsageDaily` (+ Phase 3 tables); relationships `Role ||--o{ AppRoleGrant`, `App ||--o{ AppRoleGrant`, `App ||--o{ AppVersion`, `StepDefinition ||--o{ AppStepLink`, `WorkflowVersionStep ||--o{ AppStepLink`, `App ||--o{ AppStepLink (AppCode)`; invariants: **I-21** one ACTIVE version per app (`UX_AppVersion_Active`); **I-22** published workflow step links are immutable; **I-23** `AppLaunchAudit`/`AppServiceAudit` append-only; **I-24** no app table stores client data (extends I-16); **I-25** System Admin has no `AppRoleGrant` rows. Index summary: `IX_AppRoleGrant_App`, `IX_AppStepLink_App`, `IX_ALA_App`. Schema table: scripts 25-28.

## 3. Roles editor: "Apps" section

Placement: below the permission groups in the Roles tab (`/admin/roles`, `docs/ux/admin-menu`). Section "Apps" has the master permission and one row per registered, non-removed app.

```text
Role: Data Technician                                      [Save] [Cancel]
-----------------------------------------------------------------------------
 Apps
 [x] Can use Apps                      (App.Launch - shows the Apps menu item)
     Apps this role can open            [Search apps...]        (x of 7 ticked)
     [x] Select all permitted-by-status
     +----------------------------------------------------------------+
     | [x] Markdown to PDF        Conversion  Enabled      v1.0.0      |
     | [x] Harvey vault uploader  Transfer    Enabled      v1.2.0      |
     | [ ] Relativity loader      Transfer    Disabled     v0.9.1  (i) |
     | [ ] Metadata checker       Utility     Enabled      v2.0.0      |
     +----------------------------------------------------------------+
     (i) Disabled apps stay ticked and become usable when enabled.
 [!] Ticking an app turns "Can use Apps" on. Clearing "Can use Apps" keeps the ticks
     but hides Apps for this role (a note says so).
 Manage apps (App.Manage)  [lock]  System Admin only. Not grantable here.
```

Behaviour: server contract `PUT /api/v1/roles/{id}/apps` with `{ appIds: [...], rowVersion }`; the role editor's normal Save sends the permission set and the app list in one request; audit `APP_ROLE_GRANTED`/`REVOKED` (role, app). The System Admin role shows "All apps (implicit)". The per-app matrix on the other axis is on the app detail screen (section 4.5). Accessibility: checkbox group with `role="group"` and a label "Apps this role can open", counts announced in a live region, search filters without removing ticked items from the count.

## 4. Wireframes

### 4.1 Admin menu and Apps list (`/admin/apps`, `App.Manage`)

Administration menu gains **Apps** after Custom Fields (order: Users, Pods, Task Types & Forms, Workflows, Labels, Assets, Custom Fields, **Apps**, Audit Logs).

```text
Apps administration                                         [ + Publish app ]
Tabs: [Apps] [Connectors] [File roots] [Keys]                (last three from Phase 3/1)
Search [____________]  Status [All v]  Category [All v]
+------------------------------------------------------------------------------------------+
| App                     Status    Version  Health   Roles  Last launched      Launches 30d |
|------------------------------------------------------------------------------------------|
| Markdown to PDF         Enabled   1.0.0    --       3      today 09:12        142          |
|   md-convert  /apps/md-convert  front end only                                            |
| Harvey vault uploader   Enabled   1.2.0    OK       2      yesterday 16:40    37           |
|   harvey-uploader       back end running (mfapp_3fa2, 212 MB)  [Restart] [Logs]           |
| Relativity loader       Disabled  0.9.1    Stopped  0      never              0            |
|   [!] Version 0.9.2 waiting for review                                                    |
+------------------------------------------------------------------------------------------+
Row menu: Open details - Test launch - Enable/Disable - Versions - Configuration - Remove
```

Empty state: "No apps yet. Publish the first app by uploading a package (.zip). Developers can build one with the template - see the developer guide." Error state: "Could not load apps. Retry" with trace id. Health column shows "--" for front-end-only apps.

### 4.2 Publish wizard (`/admin/apps/new` or "Upload new version" on an app)

```text
Step 1 of 5  Upload     Step 2 Validation   Step 3 Permissions   Step 4 Configure   Step 5 Review & enable
+-----------------------------------------------------------------+
|  Drop the .zip package here or [Choose file]                    |
|  Max 200 MB. Created with `mf-app pack`.                        |
+-----------------------------------------------------------------+
Uploaded: harvey-uploader-1.2.0.mfapp.zip   48.2 MB
SHA-256: 9f2c...e41a   [Copy]  Compare with the hash the developer sent you.

Step 2 Validation report                                   Result: PASSED with 2 warnings
 [ok] Zip structure, no unsafe paths           [ok] Manifest valid (id harvey-uploader, v1.2.0)
 [ok] Size 48 MB / 612 files                   [!]  Dependency report: 1 package with a known advisory (view)
 [ok] No forbidden files                       [!]  Secret scan: string "password=" in frontend/assets/app.js (view)
 [ok] Antivirus: skipped (not enabled)         Signature: none (optional)

Step 3 Permission review  (what this app asks for; compared with version 1.1.0)
 Context      user, displayName, email, matter, task, step         [email, step: NEW]
 Back end     .NET 10, 768 MB, 30% CPU, on demand
 Files        "source" read   ->  bind to root [ \\fs01\Matters  v ]  sub-folder [ ______ ]
 Connectors   "harvey": vaults.list, files.upload  -> bind to [ Harvey production v ]
 Scopes       comments:write, step:complete                                   [NEW]
 Network      no extra origins
 [x] I have reviewed these permissions.        (every NEW item is listed in red)

Step 4 Configuration   DefaultVaultNamePrefix [MF-]  MaxParallelUploads [4]
                       SigningSecret [ write-only, not set ]  [Set value]
Step 5 Review & enable
 Enable for roles: [x] Director [x] Project Manager [ ] Data Technician ...
 Version notes [_____________]
 (If second approver is required: "Waiting for second approval by another System Admin")
                                         [Back]   [Approve and activate]
```

Rules: nothing is served until "Approve and activate". The wizard can stop after step 2 (status `STAGED`) and resume from the version list. Wording avoids "install" (nothing runs until approved). Errors are inline and list file paths (as text). Keyboard: stepper is a `nav` with `aria-current="step"`; focus moves to the heading of each step; the hash has a copy button with a live-region confirmation.

### 4.3 App detail (`/admin/apps/:code`): versions, rollback, access matrix, config, uninstall

```text
< Apps   Harvey vault uploader     [Enabled]  [Disable]  [Test launch]  [Open app]
Tabs: [Overview] [Versions] [Access] [Configuration] [Platform access] [Logs] [Usage]

Versions
 1.2.0  ACTIVE   uploaded 10/14 by K. Kim, approved 10/14   sha 9f2c..e41a   [Details]
 1.1.0  RETIRED  uploaded 09/30 ...                          sha 51ab..77c0   [Roll back to this version]
 1.0.0  RETIRED                                                               [Roll back] [Delete files]
 [Upload new version]

Access (role matrix for this app)
 Role                 Can open
 Director             [x]
 Project Manager      [x]
 Pod Lead             [ ]
 Data Technician      [ ]        (System Admin: always)
 Linked from workflow steps: 3 steps in 2 workflows [view]

Configuration     DefaultVaultNamePrefix [MF-] ...   SigningSecret: set 10/14 [Replace] [Clear]
Platform access   Roots: source -> \\fs01\Matters (read)   Connectors: harvey -> Harvey production
Danger zone       [Remove app]  (type the app code to confirm). Removal keeps audit and history;
                  files are moved to \apps\_removed for 30 days; step links show "no longer available".
```

Rollback dialog: "Roll back to 1.1.0? The back end will restart. Users see the old version on their next open. Data in the app's own data folder is not rolled back." Uninstall requires typing the AppCode and is blocked while sessions are live unless "Disable first" is ticked.

### 4.4 Apps launcher page (`/apps`, menu "Apps" visible if the user may launch at least one app)

```text
Apps                                             [Search apps...____]
Categories: (All) Conversion  Transfer  Review  Utility
Recently used
 [PDF] Markdown to PDF   [Open]      [UP] Harvey vault uploader  [Open]
All apps (4)
 +-------------------------------+  +-------------------------------+
 | [PDF] Markdown to PDF         |  | [UP] Harvey vault uploader     |
 | Converts .md files to PDF.    |  | Uploads folder files to Harvey |
 | Conversion      v1.0.0        |  | Transfer     v1.2.0            |
 | [ Open in new window ]        |  | [ Open in new window ]         |
 +-------------------------------+  +-------------------------------+
```

"Open" is an `<a target="_blank" rel="noopener">` to the launch URL. Recent list is per user (`UserPreference.PreferencesJson.recentApps`, last 5; no usage tracking beyond audit). Empty state: "No apps are available for your role yet. Ask an administrator." Disabled apps are not shown on the launcher (shown only on the admin screens). Cards are a responsive grid (min width 280 px), each card a single focusable link with an accessible name "Open Markdown to PDF in a new window".

### 4.5 Step editor link control (Workflows -> Workflow Steps tab, and the workflow draft)

```text
Step: Upload to Harvey
 Title [...]  Instructions [...]  Form [...]  Tags [...]
 Apps  (shown as buttons on this step in the Task page)
   [Harvey vault uploader  x]  [Markdown to PDF x]   [ + Link an app v ]
   Button label (optional) [Open Harvey vault uploader]
   i  Linked apps are saved with the step. Published workflow versions keep the apps they were published with.
```

The picker lists all `ENABLED` apps (admins also see disabled with a tag); any `Workflow.Manage` holder can link (the picker shows only app names; no secrets). Max 3 apps per step.

### 4.6 Task detail: step button and Apps panel

```text
Workflow
 3. Upload to Harvey                        [In progress v]
    Instructions ...
    Apps:  [ Open Harvey vault uploader (opens in a new window) ]
    Linked app switched off: [ Open Harvey vault uploader ] (disabled)  "Switched off by an administrator."

Task Apps (section under Details, or a button group in the header "Apps v")
 Apps for this task
  Markdown to PDF            [Open]
  Harvey vault uploader  (used in step 3)  [Open]
 Hidden when the user may launch no linked or task-enabled apps.
```

The task Apps panel lists (a) apps linked to any step of the task's pinned workflow version, grouped by step, and (b) apps whose manifest has `entryPoints.task = true`, filtered by the user's permitted set. Launching from there passes `task` (and `step` when launched from a step). Layout follows `docs/ux/task-detail-v2/README.md` (below 1100 px it is a collapsible section in the single column).

## 5. Wording and states

| Situation | Text |
|---|---|
| Button | "Open <App name>" with an "opens in a new window" icon and `aria-label="Open <App name> in a new window"` |
| App disabled | "This app is switched off by an administrator." (admin reason shown if set) |
| App removed | "This app is no longer available." |
| No permission | "You don't have access to this app. Ask an administrator." |
| Back end down | "<App name> is starting or unavailable. Try again in a minute." |
| Session ended | "Your session in this app ended. Open it again from MatterFlow." |
| Popup/new window blocked | Not applicable: links, not scripts |
| Loading | skeleton cards; errors keep the retry button and trace id |

Accessibility: WCAG 2.1 AA as in the rest of MatterFlow; link-with-new-window warning in name; focus order; contrast tokens from `docs/ux/tokens.css`; status chips never colour-only (text + icon).
