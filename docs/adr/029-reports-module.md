# ADR 029: Reports module

- Status: **Accepted** (owner brief 2026-10-22, epic #671; decisions section AI of `docs/requirements/decisions-addendum.md`)
- Spec: `docs/ux/reports-review/README.md`; plan: `docs/ux/reports-review/delivery-plan.md`

## Context

Administrators need to add SQL-driven reports with typed parameters, assign them to roles, and let trusted users run them in a table and export CSV. Reports run admin-written SQL, which is the most dangerous capability in the product: a mistake or a malicious query must not be able to change data, read the audit trail or credentials, or take the database down.

## Decision

1. **A new module `Reports`** (`MatterFlow.Reports` with `Domain/`, `Application/`, `Infrastructure/`, `Api/`, plus `MatterFlow.Reports.Contracts`), registered in `ModuleComposition.cs`. It may reference only `SharedKernel` and other modules' `.Contracts` (Identity for permissions, Audit for audit events; the lookups for the matter/client/user/pod pickers come later through their contracts). `MatterFlow.ArchitectureTests` enforces the dependency graph and that every action names a permission policy.
2. **Three permissions** (group "Reports"): `Report.Manage` (author, preview, activate, schema browser, run log), `Report.Assign` (roles to reports, both directions, names only), `Report.Run` (run assigned reports, views, CSV). `Report.Manage` does not imply running. System Admin holds all three implicitly; no starter role gets any.
3. **The database is the real security boundary.** Every report runs on a separate connection (`ConnectionStrings:ReportsReadOnly`) under a SQL login that is a member of the database role `mf_report_reader`: SELECT on an allow-list of tables, an explicit DENY on audit, identity, seed, migration, notification, authorization and Reports tables, and no write, EXECUTE or ALTER right. The role comes from script `30-reports.sql`; the allow/deny list is `db/report-access.json`, and a unit test fails for a table nobody classified, so a new table is never exposed by accident. The login itself is created by `npm run setup` in the demo and by the owner/DBA in production (`docs/runbook.md`). There is **no fallback to the app connection**: Reports is disabled (health state "not configured") if the reports connection is missing or equals the app connection, or if the startup probe finds the login can do more than it should.
4. **The SQL validator is defence in depth only.** A ScriptDom parse accepts exactly one `SELECT` statement and refuses everything else, but the product does not rely on it: the login's permissions, timeouts, row cap and concurrency limits hold even if a statement slips through.
5. **Parameters are real SQL parameters, always.** The scanner replaces each `:NAME` token with `@p_NAME`; values are bound with an explicit `SqlDbType`. Multi-choice is one JSON array parameter read by an engine-owned `OPENJSON` sub-select (no table type, no split function). Nothing a user typed ever reaches the SQL text.
6. **Data access in this module is plain ADO.NET** (`Microsoft.Data.SqlClient`) for the report connection and the run log, and the shared EF context for the admin entities. The report connection never goes through the EF context.
7. **Append-only history.** `ReportVersion` and `ReportRun` cannot be changed or deleted by the application identity; a run is completed once through a procedure and purged after two years.
8. **Results live in a per-user, in-memory, server-side store** (page, sort and filter on the server); a pool recycle expires them and the user runs the report again.

## Consequences

- One new connection string and one extra login to provision; the cost is documented in the runbook and automated for the demo.
- Reports cannot read the audit trail or credentials even if the validator is bypassed; the price is that a report needing a denied table must be solved differently (the owner can move a table to "allow" in the catalogue and a new script).
- Single IIS server assumed for the result cache; a second server would need a shared store (open question Q5).

## OpenAPI

Endpoints live under `/api/v1/report-admin/*` (manage and assign) and `/api/v1/reports/*` (run). The OpenAPI contract (`contracts/openapi/v1.json`) and the generated Angular client are regenerated together with every endpoint change; Reports pages are lazy routes so the generated client never enters the initial bundle.
