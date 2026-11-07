# Reports Module

[[_TOC_]]

**What this page is for.** How the Reports module lets administrators publish SQL-driven reports safely: the separate read-only database login, the rules for new tables, and where the code and screens are. Source: `docs/adr/029-reports-module.md` (the decision), `docs/ux/reports-review/README.md` (spec), `docs/runbook.md` section 11 (operations).

## What it does

Administrators author reports (a single `SELECT` with typed parameters), assign them to roles, and users with `Report.Run` run them in a table and export CSV. A report runs admin-written SQL, so the **database is the security boundary**, not the validator.

| Permission | Meaning |
|---|---|
| `Report.Manage` | Author, preview, activate, schema browser, run log (Administration > Reports) |
| `Report.Assign` | Assign roles to reports, names only |
| `Report.Run` | Run assigned reports, saved views, CSV export |

No starter role holds any of these; the System Admin holds all implicitly.

## How it is safe

::: mermaid
flowchart LR
  USER["User with Report.Run"] --> API["Reports controllers /api/v1/reports"]
  API --> VAL["SQL validator: one SELECT only (ScriptDom), defence in depth"]
  VAL --> PARAM["Parameters :NAME become @p_NAME, bound with SqlDbType"]
  PARAM --> CONN["Separate connection ConnectionStrings:ReportsReadOnly"]
  CONN --> ROLE["SQL role mf_report_reader: SELECT on allow-listed tables only, DENY on the rest"]
  ROLE --> DB[("SQL Server")]
  API --> STORE["Per-user in-memory result store: page, sort, filter on the server"]
:::

- Login and role: script `30-reports.sql` creates the role `mf_report_reader` with GRANT and DENY lines generated from `db/report-access.json`. The DBA creates the login and adds it to the role once (runbook section 11.2). Reports stay off until the startup check passes; there is no fallback to the application login.
- A parameter value never reaches the SQL text. Multi-choice parameters are one JSON array read by `OPENJSON`.
- Only the Reports module reads the report connection string (architecture test `SourceHygieneRulesTests`).
- `ReportVersion` and `ReportRun` are append-only for the application identity (triggers `TR_ReportVersion_AppendOnly`, `TR_ReportRun_Guard`); a run is completed through `usp_ReportRunComplete` and purged after two years (`usp_ReportRunPurge`).
- The Sensitive matter rule does not cover reports (addendum AI item 6, option A, interim until the owner decides on issue #808): a report can read sensitive matters, so assign reports only to trusted roles. The run audit event also carries the run parameters and has no matter scope (planned change, see `docs/ux/reports-review/status-2026-11.md`).

## What a person who only runs reports can read

`ReportsController` (`Api/ReportsController.cs`) is the only Reports controller for `Report.Run`; `ReportBrowseService` (`Application/ReportBrowseService.cs`) and `ReportCatalog` (`Infrastructure/ReportCatalog.cs`) hold the rule. One SQL predicate (`MayRun` in `ReportCatalog`) decides "may run" for the run, the choice lists and the list: the report is active, has a current version and is assigned to one of the person's active roles. Anything else is not found, so a hidden report is never revealed.

- `GET /api/v1/reports` returns `{ categories: [{ categoryId, name, sortOrder, reports: [{ reportId, name, description, sortOrder, parameterCount, hasParameters, parameterLabels, lastRunAtUtc }] }], totalReports }`. Categories follow their sort order, reports follow theirs (then the name); a category with nothing to run is left out. `parameterCount` counts the parameters the SQL really uses (an unused definition would be a field that does nothing). `lastRunAtUtc` is the caller's own last successful run (`Run` kind, status Succeeded or Truncated), never someone else's. It works while reports are off (it reads definitions with the application connection, not the report login).
- `GET /api/v1/reports/{id}` returns the definition for the run page: `reportId, name, description, helpText, categoryId, categoryName, versionNo, timeoutSeconds, maxRows` and `parameters[]` (`name, type, label, helpText, required, default, multiple, lookupKind, valueType, choicesSource, options, min, max, integerOnly, maxLength, maxSelected`). Types are `number, date, text, single, multi, dateRange, yesNo, lookup`. The `default` is already resolved for the person and the firm day (`today`, `myPods`, `me`). A fixed choice list is in `options`; a query list has `choicesSource = query` and is fetched with `POST /reports/{id}/choices/{name}` (the choice SELECT is never sent). Only parameters the SQL uses are returned. Unknown, inactive and unassigned reports answer the same 404 body as a run. Lookup parameters give only the kind; the lookup endpoint is not built yet.
- The response types contain no member that could carry SQL, option SQL or a hash; the integration test `ReportListApiTests` also searches the body for a marker in the SQL and in a choice query.
- Under the interim sensitive-matter decision (option A) the endpoint is classified `Open` in `SensitiveAccessCatalog` like every Reports operation.

## The table access catalogue rule

**Every script that adds a table must classify it in `db/report-access.json` (`allow` or `deny`, with a reason) and add the matching GRANT or DENY line for `mf_report_reader` in the same script.** Otherwise `ReportAccessCatalogueTests` fails. Script 32 exists only because script 31 forgot this. See [How to Change the Schema](../Database/How-to-Change-the-Schema.md).

## Where things are

| Need | Location |
|---|---|
| Domain, services, controllers | `backend/src/Modules/MatterFlow.Reports` (`Api/ReportsController.cs`, `ReportAdminControllers.cs`, `ReportDefinitionsController.cs`, `ReportSupportControllers.cs`) |
| Tables | `ReportCategory`, `ReportDefinition`, `ReportVersion`, `ReportParameter`, `RoleReport`, `SavedReportView`, `ReportFavourite`, `ReportRecent`, `ReportRun` (all in [ER Diagrams](../Database/ER-Diagrams.md)) |
| Admin screens | `frontend/src/app/features/admin/reports` (Reports admin page, report editor); route `/admin/reports` and `/admin/reports/:id` |
| Run screens and the rest of the user side | **The people-facing pages are not built at this commit** (status and plan: `docs/ux/reports-review/status-2026-11.md`). These endpoints for a person who holds `Report.Run` exist: `GET /api/v1/reports` (the list) and `GET /api/v1/reports/{id}` (the definition), both below, `POST /api/v1/reports/{id}/runs`, `DELETE /api/v1/reports/runs/current`, `GET /api/v1/reports/runs/{runId}/rows`, `DELETE /api/v1/reports/runs/{runId}`, `POST /api/v1/reports/{id}/choices/{parameter}`. Still missing: the people-facing pages (list `/reports`, run page, result grid), CSV export, saved views (table `SavedReportView` has no code), favourites and recent (tables have no code) and the starter reports. `Report.Run` is in the backend and in `permissions.ts` but no screen or menu item uses it. `nav-items.ts` has only the Administration item |
| Local demo login | `npm run db:report-login` (`tools/db/provision-report-login.sql`) |
| Config | `ConnectionStrings:ReportsReadOnly` (must name a different login than the application) |

## Related pages

- [Operations: Configuration Reference](../Operations/Configuration-Reference.md)
- [Permission Catalogue](../Reference/Permission-Catalogue.md)
- [Add a Report](../How-To/Add-a-Report.md)

Last verified against commit b92747b.
