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

## Status

No scripts exist yet; the first (`01-init.sql`) arrives with the schema work.
