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

No starter role holds any of these; the System Admin holds all implicitly. A report is run only by a person whose role it is assigned to, so the System Admin role needs an assignment as well (the demo seed adds it).

## Starter reports

Ten starter reports ship as data (`Starters/manifest.json` plus one embedded `.sql` file each) and are created once at startup by `ReportStarterSeeder` (`Seed:StarterReports`, Development on, elsewhere off, `DryRun` only logs). The seeder writes category, definition, first version and a `SeedMarker` per starter with the application connection, marks the version previewed and active without running it, and never touches a starter again, so administrators edit them like any report. It assigns **no role** to the eight general starters. The **Project Manager** starter role holds `Report.Run` (owner decision 8, 2026-11-07; `StarterRoles.cs`, script 61 for existing databases) and the manifest gives it exactly two more starters, *Open and overdue tasks by matter* and *Tasks completed this month* (category *Matter management*, `roles: ["Project Manager"]`, issue #784): both take a `Scope` (`mine`, the default, or `all`) and list only matters the person manages as Primary or Secondary manager; `all` adds the other matters only when the built-in value `:CURRENT_USER_CAN_ASSIGN_MANAGERS` is 1 (the person holds `Matter.AssignManagers`; without it `all` behaves like `mine`); a sensitive matter is listed only for its own manager in either scope, so the Project Manager never sees one they do not manage. Two general starters list matter names (*Tasks per matter*, *Assets linked to open tasks*) and so carry an `Include sensitive matters` guard that defaults to No; the other six return counts or user names; the two Project Manager starters list matter names behind the manager rule above. CI runs every starter through the real report login (`ReportStarterTests`). Details and how to add one: [Add a Report](../How-To/Add-a-Report.md); demo: [Demo Data and Personas](../Operations/Demo-Data-and-Personas.md).

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
- The Sensitive matter rule does not cover reports (addendum AI item 6, option A, interim until the owner decides on issue #808): a report can read sensitive matters, so assign reports only to trusted roles. The run audit event (`REPORT_RUN`) has no matter scope, so it carries **no parameter values**: only the parameter names and their count (`parameterNames`, `parameterCount`). The values as bound stay in `dbo.ReportRun` (the run log, `Report.Manage` only). A parameter value can be a matter, a client or a person, and every holder of `Audit.View` can read the audit event.

## What a person who only runs reports can read

`ReportsController` (`Api/ReportsController.cs`) is the only Reports controller for `Report.Run`; `ReportBrowseService` (`Application/ReportBrowseService.cs`) and `ReportCatalog` (`Infrastructure/ReportCatalog.cs`) hold the rule. One SQL predicate (`MayRun` in `ReportCatalog`) decides "may run" for the run, the choice lists, the list, the CSV export and the saved views: the report is active, **its category is active**, it has a current version and is assigned to one of the person's active roles. A report in a deactivated category is hidden exactly like an inactive one (not listed, 404 on open, run, choices, export and views; it returns when the category is reactivated; the administration still sees it). Anything else is not found, so a hidden report is never revealed.

- `GET /api/v1/reports` returns `{ categories: [{ categoryId, name, sortOrder, reports: [{ reportId, name, description, sortOrder, parameterCount, hasParameters, parameterLabels, lastRunAtUtc }] }], totalReports }`. Categories follow their sort order, reports follow theirs (then the name); a category with nothing to run is left out. `parameterCount` counts the parameters the SQL really uses (an unused definition would be a field that does nothing). `lastRunAtUtc` is the caller's own last successful run (`Run` kind, status Succeeded or Truncated), never someone else's. It works while reports are off (it reads definitions with the application connection, not the report login).
- `GET /api/v1/reports/{id}` returns the definition for the run page: `reportId, name, description, helpText, categoryId, categoryName, versionNo, timeoutSeconds, maxRows` and `parameters[]` (`name, type, label, helpText, required, default, multiple, lookupKind, valueType, choicesSource, options, min, max, integerOnly, maxLength, maxSelected`). Types are `number, date, text, single, multi, dateRange, yesNo, lookup`. The `default` is already resolved for the person and the firm day (`today`, `myPods`, `me`). A fixed choice list is in `options`; a query list has `choicesSource = query` and is fetched with `POST /reports/{id}/choices/{name}` (the choice SELECT is never sent). Only parameters the SQL uses are returned. Unknown, inactive and unassigned reports answer the same 404 body as a run. Lookup parameters give only the kind; their records come from the reports-owned lookup endpoint (section "Lookups of the parameters").
- The response types contain no member that could carry SQL, option SQL or a hash; the integration test `ReportListApiTests` also searches the body for a marker in the SQL and in a choice query.
- Under the interim sensitive-matter decision (option A) the endpoint is classified `Open` in `SensitiveAccessCatalog` like every Reports operation.

## Result access

The rows endpoint and the export both re-check `MayRun` for the result's report on every call: a result the person may no longer see (role removed, report or category deactivated since the run) is refused with the usual 404 (`NOT_FOUND`, "This report does not exist or is not available to you."); it works again when access returns. An unknown id or another person's result is still the plain 404 and an expired result the 410, both decided before this check.

## Sorting the result rows

`GET /api/v1/reports/runs/{runId}/rows?sort=` takes up to three keys separated by commas, each `<column>:asc|desc`. A column is written by name or by its **zero-based position** as `#<n>` (`#1:desc`). The author chooses the column names, and a name can contain a comma (`Total, USD`), which the name form cannot carry; the grid therefore sends `#<n>` for every sort. `#` followed by digits is always a position; an out-of-range position or an unknown name is a 400 `RESULT_QUERY_INVALID`. The export takes the same `sort`.

## CSV export

`GET /api/v1/reports/runs/{runId}/export.csv?sort=&filter=&columns=A&columns=B` (policy `Report.Run`; `ReportExportService`, `ReportCsvWriter`) streams the person's live result: **all** rows that pass the same `filter` and `sort` as the rows endpoint (the same cached `ResultQuery.Order`, so the file equals what paging through the grid shows and never more than the result holds, which the run already cut at the row cap), and the `columns` named (repeat the parameter, in file order; none means every column; an unknown column is a 400). There is no cookie link: the call carries the person's normal credentials, so the client downloads it as a blob.

- File: UTF-8 with a byte order mark, comma, CRLF after every line, RFC 4180 quoting, a header row. Dates `yyyy-MM-dd`; a date-time that is an instant ends in `Z` and a wall-clock date-time has no zone (see date-times below); numbers in the invariant culture with their own scale and no thousands separator; booleans `Yes` and `No` (as the grid); null is an empty cell.
- Formula guard: a **text** cell or a header that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading apostrophe. Numbers are never touched, so a real negative number stays a number.
- Headers: `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="<report-slug>-yyyyMMdd-HHmm[-truncated].csv"` (slug: `a-z`, `0-9` and hyphens only; the time is the firm time zone; `-truncated` when the run was cut at the row cap), `Cache-Control: no-store`, `Pragma: no-cache`, `X-Content-Type-Options: nosniff`, `X-Export-Rows`, `X-Export-Truncated`.
- Rules: 404 for an unknown id or another person's result (the same body), 410 `RESULT_EXPIRED` for the caller's own result that was replaced, evicted or expired, 404 when the caller may no longer run the report (role removed, report or category deactivated), 400 `RESULT_QUERY_INVALID` for a bad sort, filter or column (nothing is logged in these cases).
- Log: one `dbo.ReportRun` row of kind `Export` (`RowCount` and `ExportedRowCount` = rows written; status `Succeeded`, `Truncated`, `Cancelled` or `Failed`; the version that produced the result, not the current one) and one `REPORT_EXPORT` audit event (rows, version, columns, filter summary). The filter summary names columns and operators only, never the values typed. It is written when the file was sent, or when a broken-off download had already sent rows (the event then says how many).

## Saved views

`GET|POST /api/v1/reports/{id}/views`, `PUT|DELETE /api/v1/reports/{id}/views/{viewId}`, `POST|DELETE /api/v1/reports/{id}/views/{viewId}/default` (policy `Report.Run`; `ReportViewService`, `ReportViewStore` on the existing table `dbo.SavedReportView`, no new script). A view is layout only (spec 6.1): column order, hidden columns, widths (80 to 640), sort (at most 3), filters (at most 20, operators as the rows endpoint) and page size (25, 50, 100, 250); never parameter values, never data.

- Per person and report: every statement carries the person's id and the report id, so another person's view, a view reached through another report's address and a view of a report the person may not run all answer the same 404. No view is ever visible, editable or deletable by anybody else, including administrators.
- Limits: name 1 to 80 characters (trimmed, no control characters, unique per person and report ignoring case), 25 views per person and report, 16 KB of layout. Errors: 422 `REPORT_VIEW_INVALID` with `errors.name` or `errors.layout`, 409 `VIEW_NAME_EXISTS`, 409 `VIEW_LIMIT_REACHED`.
- One default per person and report (the filtered unique index): setting one clears the old one in the same transaction; `DELETE .../default` clears it. The list returns the default first, then by name.
- Unknown columns: a view is checked against the columns of the person's **live result of the same report** when there is one (a view is saved from the result page, so there normally is): columns it does not have are dropped from columns, sort and filters and returned in `ignoredColumns`. Without a live result nothing can be checked and the layout is stored as sent. A stored layout is returned to the page as it was saved; the page skips what the new result lacks (spec 6.2). The stored text is never used to build SQL.
- No audit event: a view is a personal preference (the spec's audit list, section 13, has none).

## Date-times

A result column has `type` and, for `dateTime`, `isInstant` (`ResultColumnResponse.isInstant`, in the run, rows and preview responses; false for every other type). The SQL type decides:

| SQL type | `isInstant` | Value on the wire | The client shows |
|---|---|---|---|
| `datetimeoffset` | true | UTC with a trailing `Z`: `2026-03-31T12:05:00Z` (any offset the SQL had is converted) | the person's time zone |
| `datetime2`, `datetime`, `smalldatetime` | false | as stored, no zone: `2026-03-31T14:05:00` | unchanged (a wall-clock value) |
| `date` | false | `2026-03-31` | unchanged |

Sorting and the date filter of an instant column work on the UTC value (the filter compares the UTC day). **Author's rule:** the engine cannot know that a plain `datetime2` column holds UTC (most application columns, such as `CreatedAt`, do), so such a value is shown as a wall-clock time; an author who wants the person's zone converts it in the SELECT: `CAST(t.CreatedAt AT TIME ZONE 'UTC' AS datetimeoffset)`. The CSV writes an instant with `Z` and a wall-clock value without a zone.

## Lookups of the parameters

Owner decision 13 (2026-11-07): anybody who may run a report may use the matter, client, user, pod, role and task type pickers **of that report** without `Client.View`, `Matter.View`, `User.View`, `Pod.View` or the like. `GET /api/v1/reports/{id}/lookups/{parameter}?q=&take=&ids=` (policy `Report.Run`; `ReportLookupService`, `ReportLookupStore`, client method `getReportLookup`) answers an array of `{ id, label }` and nothing else.

- **Not a directory.** The report must be one the person may run (`MayRun`, same 404 body as the run), the parameter must exist in the report and be of type `lookup`, and the kind (`matter`, `client`, `user`, `pod`, `role`, `taskType`) comes from the report definition, never from the caller. A parameter that does not exist and one that is not a lookup answer the same 404.
- **Search.** `q` is a contains match (at most 100 characters, `%`, `_` and `[` are plain text) over the label; only active records; `take` is 25 by default and at most 50; sorted by label. Labels: matter `<client number>-<matter number> <name>` (`00343-00001 Merger Review`), client `<number> <name>`, person the display name without a `DOMAIN\` prefix (never the email), pod, role and task type by name.
- **Resolve.** `ids=1&ids=2` (repeat the parameter, at most 200, the text is ignored) returns the labels of those ids, active or not (a default such as `me` or an id restored from the address), in label order. An unknown id is simply absent.
- **Sensitive matters are never in the matter lookup, for anybody**, whatever `Matter.ViewSensitive` says, whether searched or resolved by id (a sensitive id answers exactly like a missing id). Reports are for trusted roles and a run is not filtered (option A), but this directory must not tell a person who has no matter permission that a sensitive matter exists. A client row says nothing about its matters. A report author who needs a sensitive matter filters by typing its number in a `text` parameter. [Sensitive Matter Visibility](Sensitive-Matter-Visibility.md) lists the endpoint as `List` in `SensitiveAccessCatalog`, so the persona walk (all personas hold `Report.Run` there) sweeps it for sentinels and hidden ids.
- **Reads on the application connection** (plain ADO.NET, one fixed statement per kind, the text always a parameter, the ids one JSON array); the report login is not involved and a lookup works while Reports are off.

## The table access catalogue rule

**Every script that adds a table must classify it in `db/report-access.json` (`allow` or `deny`, with a reason) and add the matching GRANT or DENY line for `mf_report_reader` in the same script.** Otherwise `ReportAccessCatalogueTests` fails. Script 32 exists only because script 31 forgot this. See [How to Change the Schema](../Database/How-to-Change-the-Schema.md).

## Where things are

| Need | Location |
|---|---|
| Domain, services, controllers | `backend/src/Modules/MatterFlow.Reports` (`Api/ReportsController.cs`, `ReportAdminControllers.cs`, `ReportDefinitionsController.cs`, `ReportSupportControllers.cs`) |
| Tables | `ReportCategory`, `ReportDefinition`, `ReportVersion`, `ReportParameter`, `RoleReport`, `SavedReportView`, `ReportFavourite`, `ReportRecent`, `ReportRun` (all in [ER Diagrams](../Database/ER-Diagrams.md)) |
| Admin screens | `frontend/src/app/features/admin/reports` (Reports admin page, report editor); route `/admin/reports` and `/admin/reports/:id` |
| People-facing screens | `frontend/src/app/features/reports` (lazy, route `/reports`, guard `Report.Run`). `ReportsListPage` (`GET /reports` through `listMyReports`: the shared record grid grouped by category, search, Category filter, the states) and `ReportRunPage` (`GET /reports/{id}` through `getMyReport`: the Parameters card `ReportParameterForm` with one shared control per parameter type, validation, values in the address, Run Report that becomes Cancel, the summary bar, the limit banners of `report-messages.ts`; leaving the page cancels a live run). Lookup parameters (matter, client, user, pod, role, task type) read their records only through `ReportLookupSource` (`report-lookup-source.ts`): today it still calls the lookup endpoints the app already has, which need the picker's own permission, so a run-only person may get a 403 and the control shows its own "You don't have access to <things>." with Retry. The owner decided (decision 13) that the reports-owned lookup endpoint serves them (section "Lookups of the parameters", client method `getReportLookup`); the swap changes only that file. The result under a finished run is `ReportResultGrid` (`report-result-grid.ts`, issue #720): the shared `mf-record-grid` with columns built from the run (`report-column-defs.ts`: key, sort id `c<n>`, default width per type, text widened from the first 50 rows, the last text column takes the free room; cell formats: numbers with commas, decimals at the scale of the column, Yes/No, dates `MM/DD/YYYY`, date-times `MM/DD/YYYY hh:mm AM/PM` as the server sent the clock, nulls empty), the header filters of `report-result-query.ts` (text contains, number range, date range, Yes/No; the shared `ListFilters` in memory mode, so nothing goes into the address), the shared toolbar (chips, Clear Filters, Sorted by with Reset Sort, Columns) and `mf-pager` with 25, 50, 100 and 250 rows. Every page, sort and filter change is one `GET /reports/runs/{runId}/rows`; the sort is always sent as `#<position>:asc|desc` (`serverSort` in `report-result-query.ts`: the position is the number in the column id `c<n>`, one sort column only; #1288), never as a name, so a column called `a,b` or `#3` sorts like any other; the grid never holds the result and never drops it. The run page drops it only when it is left or another report opens; a 410 or 404 from the rows endpoint shows the expired banner and opens the form again. Order, hidden columns and widths are stored per report and person (`mf.grid.v1.report-result-<reportId>.<userId>`, `mf.col-widths.v1.report-result-<reportId>.<userId>`). **Export CSV** (#721, `report-export.ts`) is the last button of the toolbar: its tooltip says what goes out ("Exports all 2,380 rows.", "Exports the 143 filtered rows (of 2,380).", "Exports the first 50,000 rows."), it is `aria-disabled` with no rows, while a page loads or the file is made (a spinner and a polite status), and it sends one authorised `GET .../export.csv` through the app's `HttpClient` as a blob (the generated client cannot, it reads the body as JSON) with the grid's own `sort` (`#<n>:asc|desc`), `filter` text and the visible columns in their order (`columns=` once per column, each encoded by itself). The file name is the one of `Content-Disposition`, the toast says "Exported 143 rows to CSV." (rows from `X-Export-Rows`) or "Exported 50,000 rows (truncated)." with a notice for `X-Export-Truncated`, a 410 or 404 is the expired banner of the run page (like the rows endpoint), any other failure is the toast "Couldn't export the report." with a Retry button (a new `action` option of `NotificationService`). It never drops the result. **Saved Views** (#722, `report-views-menu.ts`, `report-views-store.ts`, `report-view-layout.ts`) is the first control after Search and Filters (the toolbar's view slot): the menu with the report's Default row, one row per view (check, Default chip, Rename and Delete on hover or focus), Save View, Save as New View..., Set as Default and Remove Default; Save as New View and Rename are `mf-form-dialog`s, Delete is `mf-confirm-dialog`. It is a feature piece, not the shared `mf-views-menu`, because that one is built on `dbo.UserView` (a fixed list of list surfaces, one inline form, no dialogs). `ReportViewsStore` (provided by the grid) wraps `ReportViewsClient`; the layout is built from the grid's own state and applied the same way in reverse (a column the result lacks is skipped with the banner "This view uses columns the report no longer returns. They were skipped.", a new column is appended visible). The default view is read before the first rows are asked for and applied then (never an auto run); the button says the applied name and "(modified)" once the grid differs. The menu item is "Reports" (`NAV_ITEMS`, `Report.Run`); the Administration item is "Report Setup" |
| Endpoints for the rest of the user side | `POST /api/v1/reports/{id}/runs`, `DELETE /api/v1/reports/runs/current`, `GET /api/v1/reports/runs/{runId}/rows`, `GET /api/v1/reports/runs/{runId}/export.csv`, `DELETE /api/v1/reports/runs/{runId}`, `POST /api/v1/reports/{id}/choices/{parameter}` and the saved-view endpoints under `/api/v1/reports/{id}/views` exist (sections below). `GET /api/v1/reports/{id}/lookups/{parameter}` exists (section "Lookups of the parameters"). Still missing: favourites and recent (tables have no code) (status and plan: `docs/ux/reports-review/status-2026-11.md`) |
| Local demo login | `npm run db:report-login` (`tools/db/provision-report-login.sql`) |
| Config | `ConnectionStrings:ReportsReadOnly` (must name a different login than the application) |

## Related pages

- [Operations: Configuration Reference](../Operations/Configuration-Reference.md)
- [Permission Catalogue](../Reference/Permission-Catalogue.md)
- [Add a Report](../How-To/Add-a-Report.md)

Last verified against commit b92747b.
