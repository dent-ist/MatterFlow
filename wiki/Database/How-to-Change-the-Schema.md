# How to Change the Schema

[[_TOC_]]

**What this page is for.** Step by step: how to add a table, a column or an index, and what else must change in the same pull request. The rules come from `db/scripts/README.md`, `docs/architecture.md` section 4 and `CLAUDE.md`.

## The rules

- Schema changes are **only** numbered SQL scripts in `db/scripts/`. No EF migrations, never edit the database by hand.
- A merged script is **immutable** (checksum guard). Fix forward with a new script.
- The next number is the next free number at merge time (64 scripts exist, the highest is 66, so the next is 67). Number 16 is a permanent gap. If two branches collide, renumber the unmerged one. In a UI-update round the numbers are allocated by one person (see [Branching and Workflow](../Getting-Started/Branching-and-Workflow.md)).
- File name: `NN-kebab-description.sql` (`^\d{2,6}-[a-z0-9][a-z0-9-]*\.sql$`); two digits to 99, then three.
- One logical change per script. Separate batches with a line that contains only `GO`. Start with a comment: purpose, owner, notes.
- Name every constraint and index explicitly with the prefixes `PK_`, `FK_`, `UQ_`, `CK_`, `IX_`, `DF_`, `TR_`.
- Destructive changes (drop or rename a column) use expand then contract across two releases.
- Seed in a script only structural lookups that foreign keys need. Permissions are in `contracts/permissions.json`; a script may also insert the permission and grant it to existing roles (pattern of scripts 28, 34, 46).

## Checklist for a new table

1. **Write the script.** Use scripts 53 to 55 as a model. Include the standard columns when the table is edited by users: `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion rowversion`, with foreign keys to `AppUser`.
2. **Report login.** Add the table to `db/report-access.json` (`allow` or `deny` with a reason) and the matching `GRANT SELECT` or `DENY` line for `mf_report_reader` in the same script. `ReportAccessCatalogueTests` fails otherwise (script 32 exists because script 31 forgot it). Tables with personal, audit, identity or notification data are `deny`.
3. **Entity and mapping.** Add the entity in the owning module's `Domain/`, its `IEntityTypeConfiguration` in `Infrastructure/` (explicit `ToTable`, column names and `HasConstraintName` where tests inspect them), and mark audited entities `[Audited]`. `SchemaTests` check that every mapped property exists with a compatible type. If the table belongs to a matter, set the audit scope (architecture test `AuditScopeRulesTests`) and apply the Sensitive matter rule ([Sensitive Matter Visibility](../Architecture/Sensitive-Matter-Visibility.md)).
4. **Cross-module keys.** The foreign key exists in SQL; the entities use scalar ids and no navigation across modules.
5. **Docs.** Update the wiki: add the table to [ER Diagrams](ER-Diagrams.md) and [Table Reference](Table-Reference.md), add a line to [Schema Script History](Schema-Script-History.md), update [Module Guide](../Backend/Module-Guide.md) if the module owns a new table, and add a [Documentation Map](../Reference/Documentation-Map.md) entry only if you add a doc. Run `node wiki/tools/check-db-docs.mjs`.
6. **Tests.** Run the Docker-based tests: `dotnet test tests/MatterFlow.SchemaTests` and the integration tests of the module.

## Checklist for a new column

1. Add it with `ALTER TABLE ... ADD`. Make it nullable or give it a default so existing rows stay valid (the app is not deployed, so a backfill is rarely needed, but the script must still replay cleanly on an empty and on an existing database).
2. Update the entity, configuration, DTOs and validation. Update the API contract (`dotnet build`, then `npm run api:generate`).
3. If the table has a guard trigger (see [Views and Procedures](Views-and-Procedures.md)), check that the trigger still allows the new column to change.
4. If the table is read by reports, check `db/report-access.json` still describes it correctly (a new sensitive column on an `allow` table may need a decision).
5. Update the wiki table entry and the script history.

## Checklist for an index

1. Name it `IX_<Table>_<Purpose>`. Prefer a filtered or covering index to a wide one; the project measures plans (see `docs/qa/performance-round-1.md`, `docs/qa/sensitive-matters-performance.md`, `tools/perf/`).
2. If you replace an index, a script may drop and re-create it (script 33 does so for two indexes).

## Local test

```
npm run db:reset        # fresh database; the API applies all scripts at next start
npm start               # or: dotnet run --project backend/src/MatterFlow.Api
```

To check only the schema without starting the web host: `dotnet run --project backend/src/MatterFlow.Api -- --migrate-only` with `ConnectionStrings__Migrations` set.

## Common mistakes

| Mistake | Result |
|---|---|
| Editing an applied script | Startup fails with a checksum error naming the script |
| A new script with a lower number than the highest applied | Startup fails (out-of-order merge); renumber it |
| Two scripts with the same number | Startup fails listing both |
| New table not in `db/report-access.json` | `ReportAccessCatalogueTests` fails |
| Forgot `GO` between a `CREATE TRIGGER` and the next statement | Script fails; a trigger must be the only statement in its batch |
| Naming a constraint by default | Later scripts cannot reference it |

## Related pages

- [Database Overview](Overview.md)
- [Schema Script History](Schema-Script-History.md)
- [Add a Feature End to End](../How-To/Add-a-Feature-End-to-End.md)

Last verified against commit a80aa5a.
