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
- The Sensitive matter rule does not cover reports yet (issue #808, addendum AI item 6).

## The table access catalogue rule

**Every script that adds a table must classify it in `db/report-access.json` (`allow` or `deny`, with a reason) and add the matching GRANT or DENY line for `mf_report_reader` in the same script.** Otherwise `ReportAccessCatalogueTests` fails. Script 32 exists only because script 31 forgot this. See [How to Change the Schema](../Database/How-to-Change-the-Schema.md).

## Where things are

| Need | Location |
|---|---|
| Domain, services, controllers | `backend/src/Modules/MatterFlow.Reports` (`Api/ReportsController.cs`, `ReportAdminControllers.cs`, `ReportDefinitionsController.cs`, `ReportSupportControllers.cs`) |
| Tables | `ReportCategory`, `ReportDefinition`, `ReportVersion`, `ReportParameter`, `RoleReport`, `SavedReportView`, `ReportFavourite`, `ReportRecent`, `ReportRun` (all in [ER Diagrams](../Database/ER-Diagrams.md)) |
| Admin screens | `frontend/src/app/features/admin/reports` (Reports admin page, report editor); route `/admin/reports` and `/admin/reports/:id` |
| Run screens | No people-facing page that runs reports exists in the frontend at this commit: `Report.Run` appears only in the backend, and `nav-items.ts` says the people-facing list "arrives with the user screens". The run endpoints (`POST /api/v1/reports/{id}/runs`, `GET /api/v1/reports/runs/{runId}/rows`) exist |
| Local demo login | `npm run db:report-login` (`tools/db/provision-report-login.sql`) |
| Config | `ConnectionStrings:ReportsReadOnly` (must name a different login than the application) |

## Related pages

- [Operations: Configuration Reference](../Operations/Configuration-Reference.md)
- [Permission Catalogue](../Reference/Permission-Catalogue.md)
- [Add a Report](../How-To/Add-a-Report.md)

Last verified against commit f45fc1d.
