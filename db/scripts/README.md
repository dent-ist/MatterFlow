# Database scripts

Schema is changed **only** by appending numbered SQL scripts to this folder (ADR 003, addendum J).
EF Core maps entities for data access only; there are no EF migrations. The startup runner in
`MatterFlow.Data/SchemaMigrations` applies scripts in order. Full design: `docs/architecture.md` section 4.

## Conventions

- File name: `NN-kebab-description.sql`, matching `^(?<n>\d{2,6})-[a-z0-9][a-z0-9-]*\.sql$`.
  The numeric prefix is compared as an integer (`09` < `10` < `100`). Use two digits until 99, then three.
- **Applied scripts are immutable.** Never edit a script that has been merged; fix forward with a new script.
  A checksum guard enforces this.
- One logical change per script. Scripts run once (they need not be idempotent).
- Separate batches with a line containing only `GO`. Do not rely on variables across batches.
- UTF-8, LF line endings (normalized before hashing). Start each script with a comment: purpose and owner.
- Name every constraint and index explicitly (`PK_`, `FK_`, `UQ_`, `CK_`, `IX_`, `DF_`) so later scripts can reference them.
- Prefix allocation: each PR that adds a script takes the next free number at merge time. If two PRs collide,
  renumber the **unmerged** one. CI flags duplicate prefixes and edits to existing scripts.
- Seed data owned by code (permission catalog, fixed status labels) is synchronized by the app after migrations.
  Scripts seed only structural lookups needed by foreign keys.
- Destructive changes (drop/rename column) use expand-then-contract across two releases.

## Runner behavior (summary)

- Scripts are embedded into `MatterFlow.Data` at build time and applied at startup in numeric-prefix order,
  each in one transaction, recorded in `dbo.SchemaMigration` (name, prefix, SHA-256 checksum, time, duration, success).
- Startup **fails** on: a script error (rolled back, not recorded), a duplicate prefix, a checksum change or removal of an
  applied script, or a new script numbered lower than the highest applied one. Gaps in numbering are fine.
- Append-only numbering: always add the next free number; never renumber or edit a merged script.
- Statements that cannot run in a transaction (e.g. `CREATE DATABASE`) need `-- mf:no-transaction` on the first line.
- Config (`Migrations:*`): `Enabled` (default true), `ScriptsFolder`, `LockTimeoutSeconds`, `CommandTimeoutSeconds`,
  `ConnectionStringName` (falls back to `ConnectionStrings:Default`).

## Status

`01-init.sql` (schema conventions, `dbo.TaskNumberSeq`) and `02-identity-authz.sql` (AppUser, UserIdentity, Role, Permission, RolePermission, UserRole, System Admin role row) exist. Real tables arrive in later scripts.

## Script list (later scripts)

- `29-notifications.sql`: `dbo.Notification` (in-app notifications, poll cursor `Id`, dedupe index) and `dbo.NotificationPreference` (sparse switches); `mf_app` may update only `ReadUtc` / `Enabled` (epic #753, issue #729).
- `30-reports.sql`: the Reports tables (`ReportCategory`, `ReportDefinition`, `ReportVersion` (append-only), `ReportParameter`, `RoleReport`, `SavedReportView`, `ReportFavourite`, `ReportRecent`, `ReportRun` (completed through `usp_ReportRunComplete`, kept two years)) and the read-only role `mf_report_reader` with its GRANT/DENY lines from `db/report-access.json` (epic #671, issue #677). Every later script that adds a table must classify it in `db/report-access.json` and add the matching GRANT or DENY line.
- `31-my-matters-activity-seen.sql`: `dbo.UserMatterActivitySeen` (per person: the highest audit event id marked as read in the My Matters "Recent activity" panel; epic #667, issue #683).
- `32-report-access-activity-seen.sql`: classifies `dbo.UserMatterActivitySeen` (script 31) as denied for the report role `mf_report_reader` (epic #671). **Rule for every script that adds a table: add its entry to `db/report-access.json` and its GRANT or DENY line for `mf_report_reader`, otherwise `ReportAccessCatalogueTests` fails.**
- `33-my-matters-indexes.sql`: re-creates `IX_Task_Matter` (more included columns) and `IX_StepInstance_Workflow` (includes `Status`) so the My Matters reads are seeks (epic #667, issue #686).
- `36-audit-sensitive-scope.sql`: `dbo.AuditEvent.IsSensitiveScope` (defaulted bit, set by the audit interceptor for events written while the matter was sensitive, so that history stays restricted after un-marking; epic #788, issue #801).
- `39-activity-seen-initial.sql`: `dbo.UserMatterActivitySeen.IsInitial` (1 = the starting point a first read of the Activity list creates, 0 = the person marked activity as read; "Since your last visit" ignores an initial marker; PM follow-up #815).
- `40-task-type-colour-target.sql`: `dbo.TaskType.ColourKey` (a name of the palette of ten, `contracts/task-type-colours.json`; NULL = neutral) and `TargetDays` (expected turnaround in calendar days, 1 to 365; NULL = none) for the task type badge and the At risk rule (PM v2, epic #851, issue #852).
- `41-user-views.sql`: `dbo.UserView` (a person's remembered screen state per surface, `Name` NULL, and named saved views; ISJSON state of at most 4 KB), denied for `mf_report_reader` (PM v2, issue #856).
- `42-on-hold-reason.sql`: `dbo.OnHoldReason` (admin-managed reasons for putting a task On Hold, never deleted, readable by `mf_report_reader`) and `dbo.Task.OnHoldReasonId` (PM v2, issue #876).
- `43-asset-disposition.sql`: `dbo.Asset.DispositionCode` (Active, Inactive, Pending disposition, Disposed; CHECK that `IsActive` agrees), `DispositionChangedAt`, `DispositionChangedByUserId`, `DispositionNote`, and the index `IX_Asset_Matter_Disposition` (PM v2, issue #864).
- `44-asset-type-size.sql`: `dbo.AssetType.SizeFieldKey` and `SizeUnit` (which NUMBER field of the type means size, and its unit B, KB, MB, GB, TB or Items; both or neither; PM v2, issue #867).
- `45-asset-report.sql`: `dbo.AssetReport` (a person's saved asset report definitions, unique name per owner, ISJSON definition), denied for `mf_report_reader` (PM v2, issue #872).
- `46-asset-dispose-permission.sql`: the permission `Asset.Dispose` and its grant to the Director and Project Manager roles (idempotent; no table; PM v2, issue #865).
- `47-pm-v2-performance-indexes.sql`: `IX_CFI_Kind_Field_Owner (OwnerKind, FieldKey, OwnerId) INCLUDE (ValueNumber, ValueText)` on `dbo.CustomFieldIndex` (the Data tab, the volume chart and the asset reports read one field of the typed index by a seek, for a number and a SELECT field alike) and `IX_Task_Matter_Type (MatterId, TaskTypeId, StatusCode)` with the columns the counts read (the Breakdown and the type filter of the My Matters sections are seeks on the managed matters; PM v2, issue #887).
- `48-app-settings.sql`: the permission `Settings.Manage` (group Administration; no role grant, the System Admin holds it implicitly) and `dbo.AppSetting` (setting key, text value, binary value with content type and SHA-256, 256 KB check, row version, who and when), granted to `mf_app`, denied for `mf_report_reader`; no seed row, the defaults live in code (application settings epic #850, issue #843).
