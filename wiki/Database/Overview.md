# Database Overview

[[_TOC_]]

**What this page is for.** The facts every developer needs about the database: the engine, naming and column conventions as they really are, how the schema gets built and protected, the database roles, and where seed data comes from.

**Warning about `docs/erd.md`.** `docs/erd.md` is the *logical* ERD written on 2026-10-14 at the start of the project. It does not describe the tables added since (notifications, reports, notes, productions, holidays and others) and some details differ from the real database (for example it says timestamps are `datetime2(3)`; most are `datetime2(7)`). Use this wiki's [ER Diagrams](ER-Diagrams.md) and [Table Reference](Table-Reference.md), which were taken from the real database, for facts.

## At a glance

| Item | Value |
|---|---|
| Engine | SQL Server 2022 (the Docker image `mcr.microsoft.com/mssql/server:2022-latest`); the demo database runs at compatibility level 160. Reports need level 130 or higher (`OPENJSON`) |
| Database name | `MatterFlow`, schema `dbo` for everything |
| Collation (demo) | `SQL_Latin1_General_CP1_CI_AS` (case-insensitive) |
| Tables | 76 (75 created by the baseline, plus `SchemaMigration` created by the runner) |
| Foreign keys, indexes, check constraints | 183, 234 (with primary keys), 139 |
| Triggers on tables | 20; one database-level DDL trigger (`TR_Protect_AuditEvent`) |
| Functions, procedures, sequence | 3 inline table-valued functions, 2 procedures, 1 sequence (`TaskNumberSeq`) |
| Database roles | `mf_app`, `mf_migrator`, `mf_report_reader` |
| Scripts | `db/scripts/00-baseline.sql` (the whole schema); the old chain 01 to 66 is in `db/scripts/archive/`; the first new script is 67 |

## Naming and column conventions (as found in the database)

- Table names are singular PascalCase (`Client`, `TaskComment`). Primary key is `<Table>Id`; junction tables use a composite key of the two ids (`PodMember` is `PodId, UserId`).
- Primary keys are `int identity`, except ten tables with `bigint identity` for volume: `AuditEvent`, `CustomFieldIndex`, `FormValueSet`, `Notification` (key named `Id`), `ReportRun`, `Task`, `TaskComment`, `TaskCommentRevision`, `UserView`, `WorkflowInstance`.
- Constraint and index names are explicit and use prefixes: `PK_`, `FK_`, `UQ_`, `CK_`, `IX_`, `DF_`, `TR_`. Later scripts rely on these names, so keep them.
- Times are UTC. `CreatedAt` and `ModifiedAt` are `datetime2(7)` with a default of `SYSUTCDATETIME()`; some columns that record a moment use `datetime2(3)` (for example `Task.StatusChangedAt`, `SchemaMigration.AppliedAtUtc`). Dates without time are `date`. Booleans are `bit` (`IsActive`, `IsSensitive`). Text is `nvarchar` (`varchar` for codes and keys). JSON is `nvarchar(max)` with a `CHECK (ISJSON(col) = 1)`.
- Business numbers are `char(5)`, zero padded: `Client.ClientNumber`, `Matter.MatterNumber`; `Matter.MatterRef` is `char(11)` (`00343-00012`); `Task.TaskNumber` is `TSK-` plus `dbo.TaskNumberSeq`.
- **Standard columns.** 42 mutable tables carry `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId` and `RowVersion` (`rowversion`). The application stamps the audit columns (`AuditColumnsInterceptor`); `RowVersion` is the optimistic concurrency token (`ModelConventions` maps it as `IsRowVersion`). Junction, log and append-only tables do not have them.
- **Cascades are rare.** Foreign keys are `NO ACTION` except four `ON DELETE CASCADE` keys for pure child rows (`NoteLink` and `NoteTagLink` to `Note`, `NoteTemplateTag` to `NoteTemplate`, `ProductionComment` to `Production`) and one `ON UPDATE CASCADE` on the composite `Matter(ClientId, ClientNumber)` key. Records are deactivated (`IsActive`) rather than deleted. Only `TaskComment` has a soft delete (`IsDeleted`), and `Task` cannot be deleted at all (trigger `TR_Task_NoDelete`).
- **Immutability by trigger.** Published form versions and their fields and options, published workflow versions and their steps, workflow and step instances (partly), and tasks (`TR_Task_Immutable`) are guarded by triggers. Append-only tables: `AuditEvent`, `ReportVersion`, `TaskCommentRevision`. See [Views and Procedures](Views-and-Procedures.md).
- **JSON plus typed index.** Custom field values live as JSON (`FormValueSet.ValuesJson`, `Client/Matter/Project.CustomFieldsJson`) and are copied into typed columns in `CustomFieldIndex` for filtering and reports.

## How the schema is applied

1. The schema is `db/scripts/00-baseline.sql` (one script with every table, index, constraint and trigger; issue #1307) and schema changes after it are only **numbered SQL scripts** in `db/scripts/` (`NN-kebab-description.sql`, from 67). There are **no EF migrations**; EF Core maps entities for data access only.
2. The scripts are embedded into `MatterFlow.Data` at build time. The runner (`backend/src/MatterFlow.Data/SchemaMigrations`) applies pending scripts in numeric order at API startup, before the host listens, or on demand with `--migrate-only`.
3. It takes an application lock (`sp_getapplock`), checks names, duplicate prefixes and the SHA-256 checksum of every applied script, then runs each pending script in one transaction (batches separated by `GO`) and records it in `dbo.SchemaMigration` (script name, prefix, checksum, time, duration, success).
4. Startup **fails** when: a script errors (rolled back, not recorded), two scripts share a number, an applied script changed or disappeared, or a new script is numbered lower than the highest applied one. Gaps are fine.
5. **Applied scripts are immutable** (the baseline from the first real deployment on; until then it is edited only together with a rebuild of every demo and test database). A database whose journal lists the old scripts but not the baseline is refused at startup: `npm run db:reset`. To change anything, add a new script. The first line `-- mf:no-transaction` is allowed only for statements that cannot run in a transaction.
6. Options (`Migrations:*`): `Enabled` (default true; the production template sets false and uses `--migrate-only`), `ConnectionStringName` (`Migrations`), `LockTimeoutSeconds` (300), `CommandTimeoutSeconds` (600), `ScriptsFolder`.
7. Rules for authors are in `db/scripts/README.md`; the design is in `docs/architecture.md` section 4. Step by step: [How to Change the Schema](How-to-Change-the-Schema.md).

Connection strings: `ConnectionStrings:MatterFlow` (the application, role `mf_app`), `ConnectionStrings:Migrations` (the runner, falls back to `Default`), `ConnectionStrings:ReportsReadOnly` (reports). See [Configuration Reference](../Operations/Configuration-Reference.md).

## Database roles

| Role | Created by | Rights |
|---|---|---|
| `mf_app` | baseline | DML and EXECUTE only, no DDL; INSERT and SELECT only on `AuditEvent`; the API refuses to start in Production if its identity can change the audit table |
| `mf_migrator` | baseline | DDL and DML for the schema runner |
| `mf_report_reader` | baseline | SELECT on tables classified `allow` in `db/report-access.json` (37 tables), explicit DENY on the 34 `deny` tables, no write, EXECUTE or ALTER |

Logins and role membership are a DBA step per server (not in scripts).

## Seed data: scripts versus code

- Scripts seed only structural lookups that foreign keys need. The permission catalog, starter roles and the built-in System Admin membership are **synchronised by the application after migrations** (`IdentitySeeder`, `StarterRoles.cs`). Starter configuration (task types, workflows, forms, priorities) comes from `docs/sme/seed-configuration.json` (embedded in the API) when `Seed:StarterConfiguration:Enabled` is true (default on in Development).
- The baseline inserts the 25 permission rows, the System Admin role and the five status labels. The old scripts that granted permissions to existing starter roles (24, 25, 27, 28, 34, 38, 46, 60, 65, 66) are not in the baseline: a fresh database gets the starter roles with their permissions from `StarterRoles.cs`. Later scripts may insert a permission and grant it to existing roles.
- Demo and test data is loaded through the HTTP API by `tools/seed-demo` (see [Demo Data and Personas](../Operations/Demo-Data-and-Personas.md)), except `--aged`, which updates dates directly.

## Local database commands

| Command | Effect |
|---|---|
| `npm run db:up` | Start SQL Server (Docker), create the empty database and the report login |
| `npm run db:down` | Stop the container (data kept in the volume `matterflow-sql-data`) |
| `npm run db:reset` | Delete the volume and start again; the API rebuilds the schema at next start |
| `docker exec` into `matterflow-sql` | Use `/opt/mssql-tools18/bin/sqlcmd` for read-only inspection |

## Known differences between docs and database

- `docs/architecture.md` section 10 says `READ_COMMITTED_SNAPSHOT` is set in script 01. It is not: it is a recommended one-time DBA step (runbook section 3), and the demo database has it off. The API logs a warning at startup when it is off.
- `docs/erd.md` is the early logical model; see the warning at the top of this page.

## Related pages

- [ER Diagrams](ER-Diagrams.md)
- [Table Reference](Table-Reference.md)
- [Schema Script History](Schema-Script-History.md)
- [Architecture: Deployment and Hosting](../Architecture/Deployment-and-Hosting.md)

Last verified against the schema baseline (issue #1307).
