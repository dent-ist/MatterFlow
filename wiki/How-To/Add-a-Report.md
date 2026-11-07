# Add a Report

[[_TOC_]]

**What this page is for.** How to publish a new report for users (an administrator task that needs no code), and what a developer must do when a report needs a table that the report login cannot read. Design: [Reports Module](../Architecture/Reports-Module.md), `docs/adr/029-reports-module.md`, `docs/ux/reports-review/README.md`, runbook section 11.

## Prerequisites

- The report login exists and passes the startup check (Administration > Reports > Settings shows the login name, "writes denied", "audit tables denied" and the number of readable tables). Locally `npm start` provisions it (`db:report-login`). Without it, reports are off.
- You hold `Report.Manage` (author), and someone with `Report.Assign` gives the report to roles; people run it with `Report.Run`. The System Admin holds all three.

## Steps in the app (no code)

1. Administration > Reports > New Report. Pick a category (create categories on the Categories tab).
2. Write one `SELECT` statement. Use `:NAME` tokens for parameters (uppercase letters, digits, underscore; not starting with a digit). The engine turns them into real SQL parameters (`@p_NAME`); never build SQL text from a value.
3. Define each parameter: type (text, number, date, date range, yes or no, single, multi, lookup), label, default, required, options (fixed list or a query), and a lookup kind (user, pod, client, task type, role, ...).
4. Use the schema browser to see the tables and columns the report login may read. Preview the report, check the row cap (`MaxRows`, up to 200,000) and timeout (`TimeoutSeconds`, up to 300).
5. Activate the report. Activation needs a successful preview of the **current version** (otherwise the API answers 409 `PREVIEW_REQUIRED`); saving a new version after that needs a new preview. Then assign the report to roles on the Assignments tab.
6. Every save creates a new append-only version (`ReportVersion`); the Run Log tab lists runs.

## When a report needs a table that is denied

The report login can read only tables classified `allow` in `db/report-access.json`. Audit, identity, notification, authorization, settings and all Reports tables are denied on purpose.

1. Do not weaken the login. Decide with the owner whether the table is safe to expose.
2. If yes: change the table's entry to `allow` in `db/report-access.json` and add a **new numbered script** with the `GRANT SELECT` (and remove the `DENY`) for `mf_report_reader`. Never edit the original script. `ReportAccessCatalogueTests` and the schema test check that file and scripts agree.
3. Remember the Sensitive matter rule does not cover reports yet (issue #808); a report can read sensitive matter rows. Treat this as an open risk when you expose matter-related tables.

## Developer changes to the Reports module

- Code: `backend/src/Modules/MatterFlow.Reports`; validator in `Domain/SqlValidator.cs` (defence in depth only), executor in `Infrastructure/ReportExecutor.cs`.
- Keep the rules: one `SELECT`, parameters bound with explicit types, report connection never goes through the EF context, only this module reads `ConnectionStrings:ReportsReadOnly`.
- Tests: `IntegrationTests/Reports`, `UnitTests/Reports`, `SchemaTests/ReportsSchemaTests`.
- A people-facing "run a report" page, the list and metadata endpoints for people who only run reports, CSV export and the starter reports do not exist yet ([Reports Module](../Architecture/Reports-Module.md); plan in `docs/ux/reports-review/status-2026-11.md`). Until they are built, an administrator can only preview a report; the run endpoints can be called through the API.

## Related pages

- [Reports Module](../Architecture/Reports-Module.md)
- [How to Change the Schema](../Database/How-to-Change-the-Schema.md)
- [Configuration Reference](../Operations/Configuration-Reference.md)

Last verified against commit fd1428f.
