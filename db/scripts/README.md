# Database scripts

The schema is `00-baseline.sql` plus the numbered scripts that follow it (ADR 003, addendum J; baseline since issue #1307).
EF Core maps entities for data access only; there are no EF migrations. The startup runner in
`MatterFlow.Data/SchemaMigrations` applies the scripts in order. Full design: `docs/architecture.md` section 4.

## The baseline (`00-baseline.sql`)

- One script with a complete `CREATE TABLE` for every table (columns, defaults, primary, unique, check and foreign keys), all indexes,
  the sequence, functions, procedures, triggers (including the guard triggers such as `TR_Asset_Guard` and the database DDL trigger that protects
  the audit tables), the structural seed rows (System Admin role, permission catalog rows, the five task status labels), the database roles
  `mf_app`, `mf_migrator`, `mf_report_reader` and every GRANT / DENY. Read it top to bottom to see the whole schema.
- It replaces the 63 scripts `01-init.sql` to `66-director-be-manager.sql` (numbers 16, 61 and 62 never existed). Those are kept unchanged in
  [`archive/`](archive/) for history; the runner does not see them (the embedded glob is `db/scripts/*.sql`, not recursive).
- **Number and name:** `00-baseline.sql`, prefix **0**, so it always sorts and runs first, and the rule "a pending script must not have a lower
  prefix than the highest applied one" keeps working. **The first script after the baseline is `67-...`**; the numbers 1 to 66 stay with the archive
  and are never reused (`ScriptsFolderTests` enforces it).
- **Equivalence with the old chain is a test:** `SchemaTests/BaselineEquivalenceTests` builds one database from `archive/` and one from the baseline
  and compares them with `tools/db/schema-fingerprint.sql` (tables, columns, constraints, indexes, triggers, routines, roles, permissions, seed rows,
  identity counters). To compare two databases by hand: `tools/db/compare-schema.sh <databaseA> <databaseB>`.
- **What was not carried over:** data fixes and backfills for rows that existed in an already-running database (they cannot matter in a fresh one)
  and the grants of permissions to the starter roles in existing databases (a fresh database gets the starter roles from `StarterRoles.cs`). The list
  is in the header of `00-baseline.sql`.
- **Immutability:** the baseline is a normal applied script from the first real deployment on (checksum guard). Until then it may be corrected in
  place, but only together with a rebuild of every demo and test database (`npm run db:reset`), because the checksum of an already-applied baseline
  would no longer match. After the first deployment, never edit it: add a numbered script.
- **Old databases are not migrated.** A database whose `dbo.SchemaMigration` lists the old scripts (`01-init.sql` ...) but not `00-baseline.sql` is
  refused at startup with the instruction to rebuild it (`npm run db:reset` for the local Docker database). There is no data migration.

## Conventions for new scripts

- File name: `NN-kebab-description.sql`, matching `^(?<n>\d{2,6})-[a-z0-9][a-z0-9-]*\.sql$`, **numbered 67 or higher**.
  The numeric prefix is compared as an integer (`09` < `10` < `100`). Use two digits until 99, then three.
- **Applied scripts are immutable.** Never edit a script that has been merged after the baseline; fix forward with a new script.
  A checksum guard enforces this.
- One logical change per script. Scripts run once (they need not be idempotent).
- Separate batches with a line containing only `GO`. Do not rely on variables across batches.
- UTF-8, LF line endings (normalized before hashing). Start each script with a comment: purpose and owner.
- Name every constraint and index explicitly (`PK_`, `FK_`, `UQ_`, `CK_`, `IX_`, `DF_`) so later scripts can reference them.
- Every script that adds a table must classify it in `db/report-access.json` and add the matching `GRANT SELECT` or `DENY SELECT, VIEW DEFINITION`
  line for `mf_report_reader` (and `ALTER`/write denies for `mf_app` where the table is append-only), otherwise `ReportAccessCatalogueTests` fails.
  Keep `docs` in step: `wiki/Database/Table-Reference.md`, `ER-Diagrams.md` and `Schema-Script-History.md` (`node wiki/tools/check-db-docs.mjs`).
- Prefix allocation: each PR that adds a script takes the next free number at merge time. If two PRs collide,
  renumber the **unmerged** one. CI flags duplicate prefixes and edits to existing scripts.
- Seed data owned by code (permission catalog, fixed status labels) is synchronized by the app after migrations.
  Scripts seed only structural lookups needed by foreign keys.
- Destructive changes (drop/rename column) use expand-then-contract across two releases.

## Runner behavior (summary)

- Scripts are embedded into `MatterFlow.Data` at build time and applied at startup in numeric-prefix order,
  each in one transaction, recorded in `dbo.SchemaMigration` (name, prefix, SHA-256 checksum, time, duration, success).
- Startup **fails** on: a script error (rolled back, not recorded), a duplicate prefix, a checksum change or removal of an
  applied script, a new script numbered lower than the highest applied one, or a database built by the old chain (see above).
  Gaps in numbering are fine.
- Append-only numbering: always add the next free number; never renumber or edit a merged script.
- Statements that cannot run in a transaction (e.g. `CREATE DATABASE`) need `-- mf:no-transaction` on the first line.
- `dbo.SchemaMigration` itself is created by the runner before any script, so no script creates it.
- Config (`Migrations:*`): `Enabled` (default true), `ScriptsFolder`, `LockTimeoutSeconds`, `CommandTimeoutSeconds`,
  `ConnectionStringName` (falls back to `ConnectionStrings:Default`).

## Scripts after the baseline

- `67-role-landing-page.sql`: `dbo.Role.LandingPage` (nullable stable page key; `contracts/landing-pages.json`) with a check on its shape, and the starter defaults Director = `dashboard`, Project Manager = `my-matters` for databases that already hold the starter roles (a fresh database gets them from `StarterRoles.cs`). A person's own choice lives in `dbo.UserView` (surface `landing-page`), so no new table (epic #1330, issue #1332).
