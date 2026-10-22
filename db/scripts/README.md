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
