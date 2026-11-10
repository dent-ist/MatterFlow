# Add a Report

[[_TOC_]]

**What this page is for.** How to publish a new report for users (an administrator task that needs no code), and what a developer must do when a report needs a table that the report login cannot read. Design: [Reports Module](../Architecture/Reports-Module.md), `docs/adr/029-reports-module.md`, `docs/ux/reports-review/README.md`, runbook section 11.

## Prerequisites

- The report login exists and passes the startup check (Administration > Report Setup > Settings shows the login name, "writes denied", "audit tables denied" and the number of readable tables). Locally `npm start` provisions it (`db:report-login`). Without it, reports are off.
- You hold `Report.Manage` (author), and someone with `Report.Assign` gives the report to roles; people run it with `Report.Run`. The System Admin holds all three.

## Steps in the app (no code)

1. Administration > Report Setup > New Report. Pick a category (create categories on the Categories tab).
2. Write one `SELECT` statement. Use `:NAME` tokens for parameters (uppercase letters, digits, underscore; not starting with a digit). The engine turns them into real SQL parameters (`@p_NAME`); never build SQL text from a value.
3. Define each parameter: type (text, number, date, date range, yes or no, single, multi, lookup), label, default, required, options (fixed list or a query), and a lookup kind (user, pod, client, task type, role, ...).
4. Use the schema browser to see the tables and columns the report login may read. Preview the report, check the row cap (`MaxRows`, up to 200,000) and timeout (`TimeoutSeconds`, up to 300).
5. Activate the report. Activation needs a successful preview of the **current version** (otherwise the API answers 409 `PREVIEW_REQUIRED`); saving a new version after that needs a new preview. Then assign the report to roles on the Assignments tab.
6. Every save creates a new append-only version (`ReportVersion`); the Run Log tab lists runs.

## Starter reports (code, not the app)

The ten starter reports ship with the application as data: `backend/src/Modules/LptHub.Reports/Starters/` holds `manifest.json` (name, description, category, help text, the parameter definitions in the same JSON shape as a saved version, the columns the SQL returns, `listsMatterNames`, `roles`) and one `<key>.sql` per report, all embedded in the assembly. `ReportStarterSeeder` creates each one once at startup (`Seed:StarterReports:Enabled`, on in Development, off elsewhere; `DryRun` only logs): category, definition, a first version with its parameter snapshot, marked previewed and active, and a `SeedMarker` named `reports.starter.<key>`. It never changes a starter afterwards, so an administrator may rename, edit, deactivate or reassign it like any report; a report with the same name that already exists is left alone. Nothing runs at startup: the SQL runs only when a person clicks Run.

| Starter | Category | Parameters | Lists matter names |
|---|---|---|---|
| Overdue tasks by pod | Task follow-up | Pods (lookup, multi, default my pods; empty = all) | no |
| Tasks per matter | Task follow-up | Created in period (date range), Client (lookup), Include sensitive matters (yes/no, default no) | **yes** |
| Open tasks by assignee | Task follow-up | Pod (lookup), Include unassigned (yes/no, default yes) | no |
| Tasks completed per person | Task follow-up | Completed in period (date range), Task types (lookup, multi) | no |
| Aging of open tasks | Task follow-up | Pods (lookup, multi, default my pods) | no |
| Tasks created per week | Intake | Created in period (date range) | no |
| Users with no pod or inactive assignees | Housekeeping | none | no |
| Assets linked to open tasks | Assets | Asset types (multi, choice list from a SELECT), Include sensitive matters (yes/no, default no) | **yes** |

**Only the Project Manager starters name a role.** The Project Manager starter role holds `Report.Run` (owner decision 8), so `roles` is `["Project Manager"]` for the two Project Manager starters (#784) and empty for all others; a unit test fails when a starter names a role that does not hold `Report.Run`, and when a second starter role gains it. In the demo, `npm run seed:demo` creates the role `Report Runner (demo)`; see [Demo Data and Personas](../Operations/Demo-Data-and-Personas.md).

To add a starter: write `<key>.sql` (one `SELECT`, parameters as `:NAME`, only tables classified `allow` in `db/report-access.json`, no task titles or personal data, `ORDER BY` allowed), add its entry to `manifest.json` (list the exact result column names), and run the tests. The unit test `StarterReportManifestTests` checks that every embedded file is in the manifest and the reverse, that the validator accepts each starter, that every placeholder has a definition, that only allowed tables are read and that a starter reading `dbo.Matter` says `listsMatterNames` and carries the `INCLUDE_SENSITIVE` guard. The integration test `ReportStarterTests` runs **every** starter through the real report login with its default values, so a schema change that breaks a starter fails the build. A starter already seeded into a database is not updated by a new SQL file: fix it there as an administrator (new version), or ship a new key.

**Sensitive matters.** Reports read all matters, including sensitive ones, because the report login cannot call the visibility functions (option A, issue #808). A starter that lists matter names must therefore leave sensitive matters out unless the person asks, and the report must be given only to trusted roles. Starters that return counts or user names do not carry the guard.

## When a report needs a table that is denied

The report login can read only tables classified `allow` in `db/report-access.json`. Audit, identity, notification, authorization, settings and all Reports tables are denied on purpose.

1. Do not weaken the login. Decide with the owner whether the table is safe to expose.
2. If yes: change the table's entry to `allow` in `db/report-access.json` and add a **new numbered script** with the `GRANT SELECT` (and remove the `DENY`) for `lpt_report_reader`. Never edit an applied script (the baseline included once it is deployed). `ReportAccessCatalogueTests` and the schema test check that file and scripts agree.
3. Remember the Sensitive matter rule does not cover reports yet (issue #808); a report can read sensitive matter rows. Treat this as an open risk when you expose matter-related tables.

## Developer changes to the Reports module

- Code: `backend/src/Modules/LptHub.Reports`; validator in `Domain/SqlValidator.cs` (defence in depth only), executor in `Infrastructure/ReportExecutor.cs`.
- Keep the rules: one `SELECT`, parameters bound with explicit types, report connection never goes through the EF context, only this module reads `ConnectionStrings:ReportsReadOnly`.
- Tests: `IntegrationTests/Reports`, `UnitTests/Reports`, `SchemaTests/ReportsSchemaTests`.
- The people-facing screens (list, run page, grid, saved views) are being built by the frontend lane; the endpoints for people who only run reports, the CSV export and the starter reports exist ([Reports Module](../Architecture/Reports-Module.md); plan in `docs/ux/reports-review/status-2026-11.md`).

## Related pages

- [Reports Module](../Architecture/Reports-Module.md)
- [How to Change the Schema](../Database/How-to-Change-the-Schema.md)
- [Configuration Reference](../Operations/Configuration-Reference.md)

Last verified against commit fd1428f.
