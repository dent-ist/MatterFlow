# Reports: review and specification

Status: proposal for owner sign-off, 2026-10-22, base `origin/dev`. Plan and issues: `delivery-plan.md` (epic #671, children listed there). Decisions go to `docs/requirements/decisions-addendum.md` section **AI**.

Binding owner decisions (all taken from the owner brief): admins with `Report.Manage` write SQL SELECT reports with `:NAME` placeholders; parameters become real SQL parameters; a separate READ-ONLY SQL login runs every report; table-only results; CSV export in release one; sensitive-matter data is **not** filtered (option A, only trusted roles run reports); no charts, no email scheduling (design stays open), no per-report row-level security; **no new or changed keyboard shortcuts** (Phase 2, #420); initial bundle stays under 700 kB (about 607 kB now), so every Reports page is a lazy route and no eager shell code statically imports the generated api-client or the lookup-store.

Contents: 1 Goals and non-goals, 2 Data model, 3 Permissions, 4 API, 5 Parameters (types, detection, binding, multi-choice), 6 Execution engine, 7 Threat model, 8 Read-only login provisioning, 9 Admin screens, 10 User screens, 11 Grid behaviour, 12 CSV export, 13 Audit, 14 Accessibility, 15 Performance, 16 Test plan, 17 Starter reports, 18 Open questions.

---

## 1. Goals and non-goals

Goal: a firm administrator can add a new report in minutes (name, category, SQL, parameters), assign it to roles, and trusted users run it, look at the table, sort/filter/reorder it, save a personal view and download the current rows as CSV. Everything is logged. A mistake or malicious query cannot change data, read audit or credential tables, or take the database down.

Non-goals (release one): charts; email/scheduled delivery (the data model keeps `ReportRun` and a `ReportDefinition` that a scheduler could use later, nothing else is built); per-report row-level security and sensitive-matter filtering (option A; section 7.5 leaves the hook); Excel export (optional later); snapshots of results (see open question Q1: "save a view" is built as column order + sort + filters, **not** saved data); editing data from a report; cross-database queries.

## 2. Data model

New module `Reports` (`backend/src/Modules/Reports/{Domain,Application,Infrastructure,Api}` plus `MatterFlow.Modules.Reports.Contracts`), registered in `ModuleComposition.cs`; references only `SharedKernel` and other modules' `.Contracts` (lookups for matter/client/user/pod pickers go through existing contracts; role names through Organization/Identity contracts). SQL: one new numbered script at the **next free number at implementation time** (immutable once merged, no EF migrations). Table names below are `dbo.*`. All tables carry the usual `CreatedAt/CreatedByUserId/ModifiedAt/ModifiedByUserId/RowVersion` columns where editable.

```
ReportCategory   (ReportCategoryId PK, Name NVARCHAR(100) UNIQUE, SortOrder INT, IsActive BIT)

ReportDefinition (ReportId PK, ReportCategoryId FK, Name NVARCHAR(150) UNIQUE, Description NVARCHAR(1000),
                  HelpText NVARCHAR(MAX) NULL (markdown-lite, shown in an info panel),
                  SortOrder INT (within category), IsActive BIT, CurrentVersionId FK -> ReportVersion,
                  TimeoutSeconds INT NULL (null = global default 60), MaxRows INT NULL (null = default 50000),
                  LastPreviewOkVersionId INT NULL  -- the version that passed a preview; activation gate
                  + audit columns + RowVersion)           -- no delete: IsActive only

ReportVersion    (ReportVersionId PK, ReportId FK, VersionNo INT, SqlText NVARCHAR(MAX), SqlHash BINARY(32),
                  ParametersJson NVARCHAR(MAX)  -- snapshot of the parameter definitions of that version
                  ChangeNote NVARCHAR(300) NULL, CreatedAt, CreatedByUserId; UNIQUE(ReportId, VersionNo))   -- append-only

ReportParameter  (ReportParameterId PK, ReportId FK, Name VARCHAR(64) (UPPER, e.g. 'DATE'), Ordinal INT,
                  Type VARCHAR(20): number|date|text|single|multi|daterange|yesno|lookup,
                  LookupKind VARCHAR(20) NULL: matter|client|user|pod|role|taskType, LookupMulti BIT,
                  Label NVARCHAR(100), HelpText NVARCHAR(300) NULL, DefaultJson NVARCHAR(500) NULL,
                  IsRequired BIT, OptionsKind VARCHAR(10) NULL: fixed|query, OptionsJson NVARCHAR(MAX) NULL (fixed list),
                  OptionsSql NVARCHAR(MAX) NULL (second SELECT: columns Value, Label),
                  Min/Max/MaxLength settings in SettingsJson; UNIQUE(ReportId, Name))
                  -- the editable working copy; copied into ReportVersion.ParametersJson on every save

RoleReport       (RoleId FK, ReportId FK, GrantedAt, GrantedByUserId; PK(RoleId, ReportId))

SavedReportView  (SavedReportViewId PK, ReportId FK, UserId FK, Name NVARCHAR(100), IsDefault BIT,
                  ViewJson NVARCHAR(MAX) (column order, hidden columns, widths, sort, filters, page size),
                  ParamsJson NVARCHAR(MAX) NULL (optional: remember parameter values), CreatedAt, ModifiedAt;
                  UNIQUE(ReportId, UserId, Name))   -- personal only; no sharing in release one

ReportFavourite  (UserId, ReportId, PinnedAt; PK(UserId, ReportId))
ReportRecent     (UserId, ReportId, LastRunAt; PK(UserId, ReportId))   -- trimmed to 10 per user

ReportRun        (ReportRunId BIGINT PK, ReportId, ReportVersionId, UserId, StartedAt, FinishedAt NULL,
                  Status: Running|Succeeded|Failed|Cancelled|TimedOut|Truncated|Rejected, Kind: Run|Preview|Export|ChoiceQuery,
                  ParametersJson NVARCHAR(4000) (values as bound, multi lists capped, text truncated to 200 chars),
                  RowCount INT NULL, Truncated BIT, DurationMs INT NULL, ErrorCode VARCHAR(40) NULL, ExportedRowCount INT NULL,
                  CorrelationId UNIQUEIDENTIFIER)   -- index (UserId, StartedAt), (ReportId, StartedAt)
```

Rules: deactivating a report keeps everything (history, versions, runs, views); roles and views stay but the report disappears from listings and cannot run. Categories can be renamed/reordered/deactivated, not deleted. The run log is append-only like the audit trail (the app role gets INSERT/SELECT and UPDATE only on the three completion columns through a stored procedure, no DELETE); retention is an open question (Q6). Definition changes also write `dbo.AuditEvent` entries (section 13).

## 3. Permissions (names follow `contracts/permissions.json`: `Entity.Action`, group `Reports`)

New group "Reports" in the catalogue; Permissions.cs, `permissions.ts` and the catalogue test updated together (CI enforces).

| Code | Description | Typical holders |
|---|---|---|
| `Report.Manage` | Create and edit reports, categories, parameters; preview; activate/deactivate; restore versions; schema browser | 1 to 3 admins |
| `Report.Assign` | Assign reports to roles (per report) and read which roles/reports are assigned | admins |
| `Report.Run` | Run reports that are assigned to one of the user's roles; own views, favourites, CSV | trusted roles |

Effective rule: a user sees and runs a report if the report is **active** AND the user holds `Report.Run` AND one of the user's roles is in `RoleReport` for that report. `Report.Manage` does **not** imply running; managers can always **Preview** (their own definitions, for authoring). `Report.Assign` does not imply `Report.Manage` (assign without seeing SQL; the assignment screens show names, category and description only, never SQL). A user with `Report.Manage` and no `Report.Run` sees the admin pages but not the user listing.

Matrix (allowed = yes):

| Action | none | Run | Run + assigned | Assign | Manage | Manage + Assign |
|---|---|---|---|---|---|---|
| See "Reports" in navigation | no | no (empty state avoided: hidden) | yes | no | admin entry only | admin entry |
| List assigned active reports | no | empty list "No reports assigned to your roles" | yes | no | no | no |
| Run / export / views | no | no | yes | no | no | no |
| View SQL, edit, preview, schema browser | no | no | no | no | yes | yes |
| Assign roles to reports / reports to roles | no | no | no | yes | no | yes |
| Activate / deactivate | no | no | no | no | yes (activate needs a successful preview) | yes |
| View run log (all users) | no | no | no | no | yes (read-only tab) | yes |

Every endpoint checks the permission server-side; the UI hides, never disables (project convention). Direct URL without permission gives the 403 page without requests or toasts (as Pod Work, decision AD.8). Nobody gets Reports by default except a seeded convention: system administrator role gets `Report.Manage` and `Report.Assign`; no role gets `Report.Run` automatically (the owner picks the trusted roles).

## 4. API (REST, OpenAPI in `contracts/openapi`, nswag client regenerated; CI drift check)

Prefix `/api/reports`. Errors use the existing problem-details style with stable codes.

User side (`Report.Run` and assignment):
- `GET /api/reports` list of the caller's reports: id, name, category, description, favourite flag, last run (grouped client-side; sorted by category order then report order).
- `GET /api/reports/{id}` metadata + parameter definitions (no SQL) + resolved defaults (built-ins evaluated server-side).
- `POST /api/reports/{id}/choices/{param}` option list for a `query` options source; body carries current values of parameters it depends on (none in release one: lists are independent); max 1,000 rows.
- `POST /api/reports/{id}/runs` body `{ parameters: {...} }` -> `202`/`200` `{ runId, columns: [{name,type}], rowCount, truncated, durationMs }`; 409 `REPORT_ALREADY_RUNNING` (one per user); 429 `REPORT_BUSY` (global cap); 422 with per-parameter errors.
- `GET /api/reports/runs/{runId}/rows?page=&pageSize=&sort=col:asc,col2:desc&filter=<json>` server-side page of the cached result. 410 `RESULT_EXPIRED` after TTL.
- `GET /api/reports/runs/{runId}/export.csv?sort=&filter=` streams the CURRENT filtered/sorted rows.
- `DELETE /api/reports/runs/{runId}` cancel a running report / drop a cached result.
- `GET/POST/PUT/DELETE /api/reports/{id}/views`, `POST .../views/{viewId}/default`.
- `PUT/DELETE /api/reports/{id}/favourite`; `GET /api/reports/recent`.

Manage side (`Report.Manage`):
- `GET /api/report-admin/reports?status=&category=` list (includes inactive); `POST` create; `GET/PUT /{id}` read/save (If-Match RowVersion; every save writes a new `ReportVersion`); `POST /{id}/activate`, `POST /{id}/deactivate`.
- `POST /api/report-admin/analyze` body `{ sql }` -> validation result + detected placeholders (+ built-in matches) + first-error position; used live in the editor, no execution.
- `POST /api/report-admin/reports/{id}/preview` body `{ sql?, parameters?, sampleValues }` -> first 20 rows + column names + duration; records `LastPreviewOkVersionId` when it succeeds for the saved version.
- `GET /{id}/versions`, `GET /{id}/versions/{n}`, `POST /{id}/versions/{n}/restore` (creates a new version, deactivates the report until a new successful preview, see 6.7).
- `GET/POST/PUT /api/report-admin/categories`.
- `GET /api/report-admin/schema` tables/views and columns (name, type, nullable) the report login can read, `?search=`; `GET .../schema/{table}`.
- `GET /api/report-admin/reports/{id}/runs` run log (read-only).

Assign side (`Report.Assign`):
- `GET /api/report-admin/reports/{id}/roles`, `PUT` full replace of the role set (returns diff for audit).
- `GET /api/report-admin/roles/{roleId}/reports`, `PUT` full replace for a role (checklist, only ids the caller may list).
- `GET /api/report-admin/assignment-matrix` roles x reports (names only) for the matrix view.

## 5. Parameters

### 5.1 Types and controls

| Type | Meaning, SQL type bound | Control (UI) | Notes |
|---|---|---|---|
| number | `decimal(38,10)` or `bigint` when "integer only" | number input (form-engine number) | min/max optional |
| date | `date` | date input (form-engine `date-input`, firm date format) | default may be a relative keyword: today, start of month, start of year, today-30 |
| daterange | two params `:NAME_FROM`, `:NAME_TO` (`date`) | two date inputs + presets (this month, last month, last 30 days, this year); "to" >= "from" | admin writes `:NAME_FROM` / `:NAME_TO` in the SQL; the editor shows them as one range parameter |
| text | `nvarchar(400)` | text input | never used by `LIKE` concatenation by the engine; the admin writes `LIKE '%' + :Q + '%'` in SQL, safe because it is still a bound parameter; wildcard characters are not escaped (documented) |
| single | `nvarchar(200)` or `int` (admin sets value type) | select (PrimeNG select, filterable above 12 options) | fixed list or query list |
| multi | list, bound via JSON (5.4) | multi-select with chips / checkbox list | max 200 selected (setting) |
| yesno | `bit` | toggle/checkbox, tri-state only if not required | |
| lookup | `int` / list of `int` | the existing pickers: matter, client, user, pod (reusing shared pickers and their search endpoints; permission of the picker's own API applies, e.g. Client.View) | single or multi |
| built-in | not shown | none | values supplied by the server (5.3) |

All values are coerced on the server from JSON to the declared CLR type (invalid -> 422 with the parameter name, never to SQL). Required parameters without default must be filled before Run is enabled; an optional parameter that is empty binds `NULL`, so the admin writes `(:CLIENT IS NULL OR m.ClientId = :CLIENT)`.

### 5.2 Detection algorithm (on every save and live in `analyze`)

A small T-SQL-aware scanner (no regex on the whole text) walks the SQL once and emits tokens, skipping: `-- line` comments, `/* block */` comments (nested), `'string literals'` (with `''` escape), `N'...'`, `[bracketed identifiers]`, `"quoted identifiers"`. Outside those, a placeholder is `:` immediately followed by `[A-Za-z_][A-Za-z0-9_]{0,63}`, where the character before the colon is not a word character and not another colon (so `::` such as `geography::Point` and `12:30` outside strings are not placeholders). Names are upper-cased for comparison (`:date` = `:DATE`); the display name keeps first spelling. The scanner also: rejects `@` anywhere outside strings/comments (the engine owns variable names; admins cannot declare variables, which also blocks `@@` tricks), returns each placeholder's positions (to highlight in the editor), de-duplicates, and flags names that equal a built-in (5.3). Result: ordered list `[{name, first position, occurrences, isBuiltIn}]`.

On save: new placeholders create a parameter row with defaults (type text, label = Title Case of the name, optional); removed placeholders mark their rows "unused" (kept in the form until saved, then dropped from the working copy but retained in older `ReportVersion.ParametersJson`); a placeholder named `*_FROM` with matching `*_TO` is proposed as a date range. A report cannot be saved active (and cannot be activated) while a detected placeholder has no definition, the type is incompatible with the choice source, or the SQL fails validation (section 6.3).

### 5.3 Built-in system values (no input shown)

`:CURRENT_USER_ID` (int), `:CURRENT_USER_NAME` (nvarchar, display name), `:CURRENT_USER_EMAIL` (not provided in release one: personal data not needed), `:TODAY` (date in the firm time zone, `Firm:TimeZoneId`), `:NOW_UTC` (datetime2), `:CURRENT_POD_IDS` (multi: ids of the user's pods), `:CURRENT_PRIMARY_POD_ID` (int, null if none), `:FIRM_TIME_ZONE_OFFSET_MINUTES`. Built-in names are reserved; the admin cannot define a parameter with them. Evaluated once per run on the server; user-supplied values cannot override them (a request that includes a built-in name is rejected).

### 5.4 Binding: always real parameters

The SQL text sent to the server is the admin's text with each `:NAME` token replaced by `@p_NAME` (exact token replacement from the scanner positions, so nothing the user typed ever reaches the SQL text). Each parameter is a `SqlParameter` with an explicit `SqlDbType`, size and value (never `AddWithValue`, never string-built). Parameter values never appear in text; the audit stores them as values.

Multi-choice (and multi lookup, and `:CURRENT_POD_IDS`): bound as **one `nvarchar(max)` JSON array parameter** `@p_NAME` and the engine replaces the placeholder token with a fixed, engine-owned sub-select:

```
:PODS  ->  (SELECT CAST([value] AS int) FROM OPENJSON(@p_PODS))          -- value type int
:PODS  ->  (SELECT CAST([value] AS nvarchar(200)) FROM OPENJSON(@p_PODS)) -- value type text
```

Admin writes `WHERE t.AssignedPodId IN (:PODS)` or `IN :PODS`; if the token is already inside parentheses the engine drops its own outer parentheses (so `IN ((SELECT ...))` is never produced). The fragment is a constant of the engine, the only variable part is the cast type picked from the declared value type, and the array is parsed and validated server-side before binding (element count cap 1,000, each element must convert to the declared type, else 422). An empty selection binds `[]` -> `IN` yields no rows; for "empty means all" the admin writes `(NOT EXISTS (SELECT 1 FROM :PODS) OR x IN :PODS)` (documented in the editor help with this snippet; a "treat empty as" setting is rejected as magic). Why not a table-valued parameter: it needs a user-defined table type in the database plus REFERENCES/EXECUTE grants for the read-only login, one more object to deploy and to deny-list; `OPENJSON` needs nothing beyond compatibility level 130 (SQL Server 2022 is the baseline) and no schema object. Why not a split function: it would be admin-visible schema and slower. The TVP remains the fallback if a corporate DB runs a low compatibility level (check at startup: `compatibility_level >= 130`, else the Reports health shows a clear message).

Date range: `:NAME_FROM`, `:NAME_TO` are two `date` parameters (inclusive range in the editor help: use `>= :NAME_FROM AND < DATEADD(day,1,:NAME_TO)`).

Choice lists: **fixed** lists are stored as JSON `[{value,label}]` (typed by the admin, up to 200 entries); **query** lists run a second admin-written SELECT through the same engine and the same validator and login (columns must be `Value` and `Label`, at most 1,000 rows, 10 s timeout, may use built-ins but no user parameters in release one), cached per report for 5 minutes. A choice value submitted by the user is always checked against the current option list (fixed or query) before binding, except for number/lookups validated by type.

## 6. Execution engine

### 6.1 Flow (run)

```
UI -> POST runs -> authz (Report.Run + RoleReport + active)
   -> load current ReportVersion + ParameterDefs
   -> coerce/validate values, add built-ins, build SqlParameters (5.4)
   -> acquire per-user lock (one Running run per user; 409) and global semaphore (default 4; 429)
   -> insert ReportRun(Running)
   -> open connection with ConnectionStrings:ReportsReadOnly (never the app string) -> execute
   -> stream SqlDataReader into the typed result store (stop at MaxRows+1 => Truncated)
   -> update ReportRun (Succeeded/Truncated/Failed/TimedOut), release locks
   -> return columns + rowCount + truncated
```

### 6.2 Connection and command settings

Dedicated connection string `ConnectionStrings:ReportsReadOnly` (a SQL login with a password from environment/IIS config, or an Entra/Windows identity if the corporate site prefers; see 8). `Application Name=MatterFlow.Reports`, `Encrypt=True`, `ApplicationIntent=ReadOnly`, `Connect Timeout=10`, pooling on (the pool is separate from the app's). Per command: `CommandTimeout = TimeoutSeconds (default 60, report may lower or raise up to 300 with Report.Manage; global ceiling setting)`; on timeout the command is cancelled (`SqlCommand.Cancel`), the run is `TimedOut`. Session options set in a preamble batch the engine owns: `SET LOCK_TIMEOUT 5000; SET DEADLOCK_PRIORITY LOW; SET TRANSACTION ISOLATION LEVEL READ COMMITTED; SET ROWCOUNT 0; SET NOCOUNT ON; SET DATEFIRST 7` (the firm's choice, one setting). The user query is sent as its own batch (`CommandType.Text`) so the validator's "one statement" guarantee equals what SQL Server sees. Optional: Resource Governor workload group with `MAX_DOP 2`, `REQUEST_MAX_MEMORY_GRANT_PERCENT 10` for the report login, documented for the DBA (runbook), not required.

### 6.3 Validation (defence in depth, parse and permissions together)

Layer 1, text/AST on save, preview and run (the saved hash is re-validated at run time): parse with `Microsoft.SqlServer.TransactSql.ScriptDom` (TSql160Parser; NuGet version in `Directory.Packages.props`). Accept only: exactly **one batch**, exactly **one statement**, a `SelectStatement` (including `WITH` CTEs, `UNION`, subqueries). Reject: any other statement type; `SELECT ... INTO`; variable assignment in SELECT; `EXEC/EXECUTE`, stored-procedure calls, `sp_*`/`xp_*` references; `OPENROWSET`, `OPENQUERY`, `OPENDATASOURCE`, `OPENXML`, `BULK`; four-part (linked server) names and three-part names to other databases; `WAITFOR`; `FOR XML/JSON` is allowed (they only shape output) but the result store only supports tabular outputs, so rejected; `OPTION` hints other than `RECOMPILE`/`MAXDOP`; `SET`, `DECLARE`, `;` followed by more text; comments containing `GO` batch separators (the parser sees `GO` as an error); `@` characters; query text over 64 kB. A leading-keyword check ("starts with SELECT or WITH") also runs as a cheap first filter and gives the friendly message, but it is not relied upon. Functions: rejected list of server-state and file functions (`OPENROWSET` above, `fn_*` system functions, `SUSER_*` leaks are fine); other functions are allowed and the database permissions are the control. Sequences: `NEXT VALUE FOR` rejected (it writes).
Layer 2, permissions: the login (section 8) has SELECT only on an allow-listed set of objects, DENY on audit/credential tables, no EXECUTE, no impersonation, not db_owner.
Layer 3, runtime: timeouts, row cap, per-user/global concurrency, result memory budget.
Layer 4, verification: a startup probe and security tests (16.3) prove the login cannot read the denied tables or write anything, and the API refuses to enable Reports (health state "not configured") if the probe fails or the reports connection string equals the app connection string.

### 6.4 Result store and grid backing

Rows go into a per-run, typed, column-oriented in-memory store (arrays per column; text interned), keyed by `runId`, owned by the user, TTL 15 minutes since last access (sliding, max 60), at most **one live result per user** (a new run replaces the old one), global memory budget (default 512 MB; oldest evicted first; a run is rejected with 503 `REPORT_MEMORY` if it cannot fit). Sorting, filtering and paging are done by the server on this store (type-aware comparison, case-insensitive text, null handling: nulls last ascending). Typical size: 50,000 rows x 20 columns about 50 to 100 MB worst case; with a few dozen users and one result each this fits; the budget guards the rest. Alternative considered: send all rows to the browser; rejected because 50,000 rows is 10+ MB of JSON and a slow, heavy grid on the laptops. A cache loss (pool recycle, expiry) shows "This result has expired. Run the report again." with a Run again button keeping the parameters.

### 6.5 Limits and abuse controls

Default timeout 60 s; default max rows 50,000 (report may lower; ceiling 200,000 in settings); message "Showing the first 50,000 rows. The result was cut off. Narrow the parameters." as a persistent notice above the grid and in the CSV's first-line-free filename suffix `-truncated`; one running report per user (also for Preview); global concurrency cap 4; choice queries 10 s / 1,000 rows; preview 20 rows and a 15 s timeout; rate limit 30 runs per user per hour (setting) with 429; request body limit 256 kB.

### 6.6 Preview

Manage-side "Preview" runs the **unsaved editor text** through the same validator and login with sample parameter values (the admin's typed values, or defaults, or type samples: 0, today, "sample", first option) and returns the first 20 rows with column names and types, duration, and whether the full result would exceed the cap (reader continues counting up to the cap but retains only 20). Preview is a `ReportRun` of Kind `Preview`. A successful preview of exactly the saved SQL text hash and parameter set sets `LastPreviewOkVersionId`.

### 6.7 Activation gate and versions

Activate is allowed only if `LastPreviewOkVersionId = CurrentVersionId` (a successful preview of this exact version). Saving a new version of an active report keeps it active only if that save carried a successful preview of the new text (the editor runs the preview as part of "Save and keep active"); otherwise the report is deactivated with the message "Saved as version n. Preview it to activate." (never serve unreviewed SQL to users). Restoring an old version creates a new version (history never rewritten) and also needs a new preview. Versions list: number, author, date, change note, diff against previous (line diff).

### 6.8 Errors

Users see: "The report could not be completed (reference 4F2A...)." with the correlation id; timeouts and truncation have their own messages. Administrators in Preview see the SQL Server error text and position. SQL error text is never returned to run-only users (it can leak object names).

## 7. Threat model

| # | Threat | Control |
|---|---|---|
| 7.1 | SQL injection through parameter values | Values are bound as typed SqlParameters; the SQL text is never concatenated with values; multi-choice via JSON parameter and constant sub-select; choice values re-checked against the list; tests with `'; DROP TABLE`, unicode quote look-alikes, very long values, JSON with nested payload |
| 7.2 | Malicious or careless admin SQL (writes, DDL, EXEC, linked servers, file access, `xp_cmdshell`) | AST validator (one SELECT), login without write/EXECUTE/ALTER, no sysadmin; DENY on sensitive tables; probe at startup; run and version log; only `Report.Manage` holders (a few people) can author |
| 7.3 | Reading audit or credential/token tables | Role `mf_report_reader` with allow-list grants and explicit DENY on `AuditEvent`, `AuditEventGuard`, `UserIdentity`, `SeedMarker`, `Report*` tables and anything holding secrets; CI test fails when a new table is not classified in the access catalogue (8.2); schema browser shows only what the login can read |
| 7.4 | Resource abuse (cartesian joins, huge scans, many concurrent runs) | timeout, row cap, one run per user, global cap, memory budget, rate limit, optional Resource Governor, `LOCK_TIMEOUT`, READ COMMITTED (no long blocking: reports take no hints, `NOLOCK` is the admin's choice and documented as dirty-read) |
| 7.5 | Data exposure to the wrong people | Option A: reports are not filtered by sensitive-matter rules, so `Report.Run` plus assignment is the gate; recorded in decisions AI; role assignment is audited; the run log shows who saw what; the design keeps a hook: a future "filtered view" would be an engine-owned wrapper that the admin opts into per report (`rpt` views joined with the user's visible matters); nothing in this release blocks it |
| 7.6 | CSV / formula injection | Section 12.3 |
| 7.7 | Cross-user access to cached results | `runId` is an unguessable 128-bit id and bound to the user; the server checks owner on every page/export; 404 for others |
| 7.8 | Information leak through error messages | Section 6.8 |
| 7.9 | Stored XSS from cell values or report text | The grid renders text with Angular interpolation only (no innerHTML); help text is markdown-lite sanitised (links off or `rel=noopener`); CSV is not HTML |
| 7.10 | Connection string misuse (fallback to app login) | No fallback: Reports is disabled and says so if the reports connection is missing or equals the app one; the startup probe verifies the effective rights |
| 7.11 | Tampering with history | `ReportVersion` and `ReportRun` are append-only; changes audited |
| 7.12 | Denial through the schema browser | metadata only, paged, cached 60 s |
| 7.13 | Privilege creep over time (new tables readable by the login) | access catalogue test (8.2) and the "schema browser shows" runbook review step |

## 8. Read-only login provisioning

### 8.1 What is created

- In the schema script (next free number, runs under `mf_migrator`): `CREATE ROLE mf_report_reader` if missing, then per catalogue entry `GRANT SELECT ON OBJECT::dbo.<table> TO mf_report_reader` for allowed tables and `DENY SELECT, VIEW DEFINITION ON OBJECT::dbo.<table>` for denied tables; `DENY EXECUTE`, `DENY INSERT, UPDATE, DELETE, ALTER, CONTROL, REFERENCES` on `SCHEMA::dbo`; no membership of `db_datareader` (that would grant everything). Idempotent.
- A **catalogue** file (`db/report-access.json`, next to the scripts) lists every table as `allow` or `deny` with a reason; a unit test reads all `CREATE TABLE` names from `db/scripts/*.sql` and fails if a table is unclassified (so every future table is a conscious choice) and checks the script grants match the catalogue.
- Not in a script (server-level, site specific, same as the `mf_app` note in script 13): the login and database user.

### 8.2 Demo / development (automatic)

`npm run setup` (runs after the database exists and the API has applied the schema; the existing flow creates the database through `sqlserver-init` in `docker-compose.dev.yml`) executes an idempotent provisioning script `tools/db/provision-report-login.sql` through the SQL container: `CREATE LOGIN mf_reports WITH PASSWORD = '<dev password>', CHECK_POLICY = OFF; CREATE USER mf_reports FOR LOGIN mf_reports; ALTER ROLE mf_report_reader ADD MEMBER mf_reports;` and the dev `appsettings.Development.json` carries `ConnectionStrings:ReportsReadOnly` for that login (password public like the dev sa password, loopback-bound DB, comment says so). `npm start` re-runs the provisioning (cheap, idempotent) before the API starts, so a first run after a fresh clone works. Test host (Testcontainers) does the same in fixture setup. Because the role is created by the schema script and the login by the provisioning step, order is: schema, then provisioning; the Reports health check says "Report login is not set up yet: run `npm run setup`" until both exist.

### 8.3 Corporate network (owner / DBA instructions, to go to `docs/runbook.md`)

1. Create the login on the SQL Server (SQL authentication with a long random password stored in the IIS/secret store, or a dedicated Windows/Entra account if policy prefers; **not** the gMSA of the app pool, so the report identity can never write): `CREATE LOGIN [mf_reports] WITH PASSWORD = N'<generated>', CHECK_POLICY = ON;`
2. In the MatterFlow database: `CREATE USER [mf_reports] FOR LOGIN [mf_reports]; ALTER ROLE mf_report_reader ADD MEMBER [mf_reports];` (the role and its denies come from the schema script).
3. Do not add the login to `db_owner`, `db_datareader`, `sysadmin`, or any role that can write; no `IMPERSONATE`, no `EXECUTE`.
4. Put the connection string in the secret store / environment as `ConnectionStrings__ReportsReadOnly` (`Encrypt=True; TrustServerCertificate=False; Application Name=MatterFlow.Reports; ApplicationIntent=ReadOnly`); do not reuse the app string.
5. Optional: Resource Governor group for the login (`MAX_DOP 2`, memory grant 10 %), database compatibility level >= 130.
6. Verify in the admin page "Reports settings": the health panel shows login name, "writes: denied", "audit tables: denied", "can read N tables" (ran by the startup probe, which only issues `SELECT` and permission checks `HAS_PERMS_BY_NAME`).
7. Review quarterly with the schema browser; rotate the password like any service account.

## 9. Admin screens (ASCII)

Navigation: Administration > Reports (admin list kit; the shared `admin-list-shell` and `admin-list-state` reused for search, filters, status, empty and error states, as for Task Types and Labels). All lazy routes under `/admin/reports`.

### 9.1 Reports list (desktop)

```
Reports                                                [ + New report ]
[ Search...        ] [Category v] [Status: Active v]        14 reports
-----------------------------------------------------------------------
 Category        Order  Name                    Roles  Last run   Status
 Task follow-up    1    Overdue tasks by pod       3   2 h ago    Active
 Task follow-up    2    Tasks per matter           2   yesterday  Active
 Finance           1    Open tasks by client       1   -          Inactive
-----------------------------------------------------------------------
 Row menu: Edit . Preview . Roles . History . Activate/Deactivate
 Tabs above the list: Reports | Categories | Run log | Settings (health)
```
Empty: "No reports yet. Add the first one or start from a starter report." with two actions. Error and loading states per the list kit.

### 9.2 Report editor

```
< Reports / Overdue tasks by pod                  version 4   [Save] [Preview] [Activate]
 Tabs: Details | Query | Parameters | Roles | History
-----------------------------------------------------------------------
 Details: Name [__________] Category [Task follow-up v] Order [1]
          Description [______________________]   Help text [markdown-lite]
          Timeout [60] s  Max rows [50000]
-----------------------------------------------------------------------
 Query                                         | Schema browser        |
 1 SELECT p.Name AS Pod, COUNT(*) AS Overdue   | Search [task___]      |
 2 FROM dbo.Task t JOIN dbo.Pod p ON ...       |  v dbo.Task           |
 3 WHERE t.DueDate < :TODAY                    |    TaskId   bigint    |
 4   AND t.AssignedPodId IN (:PODS)            |    Title    nvarchar  |
                                               |  > dbo.Pod            |
 Detected: :TODAY (built-in)  :PODS (needs a definition)  [Insert column]
 Validation: OK  (single SELECT, 2 parameters)     [Check query]
-----------------------------------------------------------------------
 Parameters (detected from the query)
 Name   Type           Label        Default    Required  Options
 PODS   Multi choice v Pods         my pods    no        From query v [edit SELECT]
 DATE   Date range v  Period       this month yes
 CLIENT Lookup: Client v Client     -          no
 Fixed list editor:  [Value][Label][x]  [+ add]    Query list: SELECT ... [Test]
-----------------------------------------------------------------------
 Roles tab (Report.Assign): checklist of roles with "assigned" state and counts
 History: v4 you today . v3 Ann 12 Oct "added pod filter" [Compare] [Restore]
```
Preview panel (bottom, opens on Preview):
```
 Preview with sample values  PODS=[Alpha, Beta]  DATE=[1 Oct..22 Oct]   [Run preview]
 Pod      Overdue        (first 20 of 132 rows, 0.4 s)   [Mark as previewed]
 Alpha    12
```
The Activate button is hidden until a successful preview of this version exists, then enabled; a short line says why when hidden ("Preview the current version to activate").

### 9.3 Phone (375 px): list of report cards (name, category, status chip) with an overflow menu; the editor is read-first: Details and Parameters are usable, the Query tab opens a full-width monospace editor with horizontal scroll inside the editor only (page never scrolls horizontally), the schema browser and preview open as full-screen sheets. Authoring on a phone is supported but not optimised (documented).

### 9.4 Assignment, both directions

On a role (Users > Roles page, new tab "Reports", `Report.Assign`):
```
 Role: Pod Lead         Reports (3 of 14)           [Search...] 
 [x] Task follow-up / Overdue tasks by pod
 [x] Task follow-up / Tasks per matter
 [ ] Finance / Open tasks by client            (inactive reports greyed, labelled)
```
On a report (editor tab "Roles"): checklist of roles with member counts. Both save as full replace with a diff toast: "Pod Lead now has 3 reports (added Tasks per matter)". Optional matrix view (roles x reports) for review, read-only.

## 10. User screens

### 10.1 Reports listing `/reports`

```
Reports                              [ Search reports...      ]
 * Favourites                       Recent: Overdue tasks by pod . Tasks per matter
   [*] Overdue tasks by pod
 Task follow-up
   [ ] Overdue tasks by pod        Tasks past due, grouped by pod            [Run]
   [ ] Tasks per matter            Open and done tasks per matter            [Run]
 Finance
   ...
```
Groups follow category sort order, then report sort order. Search filters name/description. Empty (no assignment): "No reports are assigned to your roles. Ask an administrator." Phone: single column cards, category headers sticky.

### 10.2 Run page `/reports/:id`

```
< Reports / Overdue tasks by pod                       [ i Help ] [*]
 Pods [Alpha x][Beta x]  Period [This month v] [1 Oct][22 Oct]   Client [ Search... ]
 [ Run report ]   View: [Default v] [Save view]
-----------------------------------------------------------------------
 Notice: Showing the first 50,000 rows. The result was cut off.  (only when truncated)
 [Filter in headers]  132 rows . 0.4 s                    [Export CSV] [Columns]
 | Pod v | Overdue ^ | Client  | ...                      | page 1 of 3 | 50 v |
```
Parameter values are in the URL (`?pods=1,2&from=...`) so a run is a shareable address (opens with the form filled; a person still presses Run; values are validated like any submission). Defaults: last used values per report per user are remembered (in a saved view default or `localStorage` convenience only). Required parameters block Run with inline errors; Run is a single button; a running state shows a spinner and a Cancel button, and "Another report is already running. Wait or cancel it." for 409.
Phone: parameters form full width, stacked; results as a horizontally scrollable table inside its own container (not the page) with sticky first column; "Columns" and "Export" in a menu.

## 11. Grid behaviour

Reuse the shared grid components where they fit (header-embedded filters as per epic #75 and decision X, sticky header, the column chooser look) but the result grid is its own component `mf-report-grid` because the columns are dynamic and data is server-paged from the result store; it does not import the work-queue table. Lazy loaded with the report pages.

- Pagination: server-side, 25/50/100/250 per page, page size remembered per view; keyboard-reachable pager; total count shown ("132 rows", "131 of 5,200 after filters").
- Sorting: click header cycles asc/desc/none; shift-click adds a secondary sort; stable.
- Filtering from the grid: typed per column: text (contains / equals / starts with), number (=, >, <, between), date (on, before, after, between), yes/no, blank/not blank; chips above the grid summarise active filters; "Clear filters". Filter state is part of the view and of the export.
- Column reorder (drag handle and keyboard "Move left/right" in the column menu), resize (drag; keyboard via column menu), show/hide columns. Persisted only through a saved view or as a session state.
- Cell formatting by type: dates in the firm date format, numbers with the user's locale, nulls as an empty cell, long text truncated with the full value in a tooltip and a "copy" action; booleans Yes/No.
- Saved views (`SavedReportView`): "Save view" asks a name; a view stores column order/hidden/widths, sort, filters and page size; optional "remember my parameter values"; a default view per report per user; rename, delete, set default. If a report's SQL changes the columns, views are applied best-effort: unknown columns dropped, a note "Some saved settings no longer apply" is shown. **Snapshots of results are not built** (open question Q1).
- Selection and copy: click a cell + Ctrl+C copies its text (browser default; no custom shortcut added); no row editing.
- No new keyboard shortcuts. The grid uses the standard Tab/Arrow/Enter semantics of PrimeNG and existing keys only.

## 12. CSV export

12.1 Scope: "Export CSV" exports exactly the **current** filtered and sorted rows of the run (all pages, not only the visible page), in the current column order with hidden columns omitted, header row with the column names. Up to the row cap. The button label shows the count: "Export 131 rows (CSV)".

12.2 Format: UTF-8 **with BOM** (opens correctly in Excel on Windows), CRLF line endings, delimiter `,` (a user setting for `;` is an open question Q3), RFC 4180 quoting (fields with delimiter, quote, CR or LF are quoted, quotes doubled). Dates `yyyy-MM-dd`, datetimes ISO 8601 in the firm time zone with offset, numbers with invariant culture (`.` decimal, no thousand separators), booleans `true/false`, nulls empty. File name `<report-name-slug>-yyyyMMdd-HHmm.csv` (ASCII-safe, max 100 chars) plus `-truncated` if the run was cut off. Headers `Content-Disposition: attachment`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. Streamed straight from the result store to the response in chunks (no full-file buffer), cancellable by the client; a 50,000-row export is a few MB and starts within a second. Export respects the same authz as run and writes a `ReportRun` (Kind Export) with row count and the filter summary.

12.3 Formula injection: for **text-typed** cells whose first non-whitespace character is `=`, `+`, `-`, `@`, or whose first character is TAB or CR, the exporter prefixes a single quote `'` (the OWASP rule) and the cell stays quoted. Numeric, date and boolean cells are written from typed values and are never prefixed (so a real `-5` stays a number). Column headers are treated the same way. The same applies to any cell copied out of the grid by the "Copy" action. Documented in the export dialog help ("Values starting with = + - @ get a leading apostrophe so spreadsheets do not run them as formulas").

12.4 Large results and errors: export streams from the cached result; if the result expired, 410 with the Run again path; the browser download uses a normal link with the access token cookie (no blob in memory). Excel (.xlsx) is out of scope for release one.

## 13. Audit

- **Definition changes** go to `dbo.AuditEvent` (existing audit pipeline, viewable in Audit Logs): `Report.Created`, `Report.Updated` (fields changed; for SQL: old/new hash and version number, never the full SQL in the event, the full text is in `ReportVersion`), `Report.Activated/Deactivated`, `Report.VersionRestored`, `Report.ParametersChanged`, `Report.CategoryChanged`, `Report.RolesAssigned` (role, added/removed report ids; from both screens), `Report.ChoiceSqlChanged`.
- **Runs** go to `ReportRun` (who, which report and version, parameter values as bound (long values truncated), row count, truncated flag, duration, status) and a compact `Report.Run` / `Report.Export` event in `AuditEvent` so the Audit Logs page shows them (row count and report name, parameters in the details JSON).
- The run log tab on the admin page and the Audit Logs filter "Reports" read these. Failed validations (Rejected) are logged with the reason code.

## 14. Accessibility

WCAG 2.2 AA, axe 0 violations at 1366x768, 1920x1080, 768x1024, 375x812 with menus/dialogs open. Parameter form: every control labelled, required marked in text and `aria-required`, errors tied with `aria-describedby`, error summary on failed Run, focus to first error. Result grid: native table semantics (`role=table` rows/cells or `grid` only where editing exists; read-only table), `aria-sort` on headers, filter popovers labelled, column menu keyboard-operable (no drag-only actions: Move left/right buttons), pager as a nav landmark, result updates announced politely ("132 rows"), truncation notice `role=status`. SQL editor: plain textarea with line numbers (not a trapped code editor): Tab moves focus out, not a tab character (an "insert tab" is not offered); errors listed below with line/column. Colours: status never by colour alone; dark theme tokens as the rest of the app; targets 24 px minimum. Focus returns to the trigger after dialogs and menus. No shortcut added.

## 15. Performance

Bundle: Reports routes are lazy (`loadComponent`/`loadChildren`); no static import of the generated api-client or lookup-store from `app.routes`, shell, navigation or any eager file; the nav item is added through the existing permission-driven nav model (no new eager service); a CI bundle budget test already enforces 700 kB, and a lazy-chunk check makes sure no Reports code appears in `main`. The SQL editor is a plain textarea plus a tiny highlighter (no Monaco/CodeMirror: that would be 300 kB+; reconsidered only as a lazy chunk if the owner asks). Server: run streaming with a bounded read buffer; first page of results returns as soon as the reader finishes (target: 50,000 x 20 columns stored in under 2 s after the query ends; page/sort/filter on the store under 150 ms for sorting 50,000 rows, 50 ms for pages); CSV 50,000 rows under 3 s; listing and metadata calls under 100 ms (cached definitions, invalidated on save). Query side: the login's pooled connections are capped (max pool 8) so the reporting load cannot exhaust the server; the global concurrency cap is 4.

## 16. Test plan

16.1 Unit: scanner (comments, strings, `::`, `12:30`, brackets, unicode, case folding, nested comments), placeholder rewrite, built-in resolution, parameter coercion per type, daterange validation, option checking, JSON array build, CSV writer (quoting, BOM, CRLF, dates, numbers, formula prefix on text only, header prefix), sort/filter engine per type, version diff.
16.2 Integration (Docker SQL Server, real reports login): CRUD, versions/restore, activation gate, assignment both ways, authz matrix per permission combination, one-run-per-user 409, global cap 429, timeout (a `WAITFOR`-like slow query via a heavy cross join in a test table), row cap and truncation flag, cancellation, result expiry 410, owner-only access, export equals the filtered/sorted grid rows, choice queries, multi-choice with 0, 1, 1,000 and 1,001 elements, startup probe behaviours, audit events written.
16.3 **Security tests** (must pass in CI): (a) injection corpus on every parameter type (quote, `--`, `;`, `' OR 1=1`, `0x`, Unicode apostrophes, 4,000-char strings, JSON break-outs for multi) must return data as plain values and never change the executed statement (compare the plan text/hash or result set); (b) validator rejects a corpus of 60+ statements (INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/EXEC/`sp_`/`xp_cmdshell`/`INTO`/`;` chains/`GO`/OPENROWSET/OPENQUERY/linked server/`WAITFOR`/`NEXT VALUE FOR`/comment tricks `/*!*/`, `SEL/**/ECT`, Unicode confusables, `@x` variables); (c) **the login itself** (bypassing the validator, direct connection in the test) cannot SELECT `AuditEvent`, `UserIdentity`, `Report*` run/definition write, cannot INSERT/UPDATE/DELETE/ALTER/CREATE/EXECUTE anything, cannot `xp_cmdshell`, cannot read other databases, is not in `db_owner`/`sysadmin` (`IS_SRVROLEMEMBER`, `IS_MEMBER`); (d) access catalogue test: every table classified, grants equal catalogue; (e) architecture test: Reports module references only SharedKernel/Contracts, and only the Reports infrastructure resolves `ReportsReadOnly`; (f) the connection-string guard (equal strings or missing -> Reports disabled); (g) CSV formula test with `=cmd|' /C calc'!A0`, `+1+1`, `-2+3`, `@SUM(1)`, TAB/CR prefixes, and a real negative number; (h) cross-user access of `runId` and views returns 404; (i) error messages for run-only users contain no SQL text; (j) permission checks: every endpoint 401/403 without the proper permission; (k) XSS strings in cells and names render inert.
16.4 Frontend unit/component: parameter form per type, required/default/URL values, grid sort/filter/reorder/resize, view save/apply with changed columns, export button label and 410 path, admin editor states.
16.5 E2E (Playwright): admin creates a starter-like report, previews, activates, assigns to a role; the user of that role runs it, filters, sorts, saves a view, exports CSV (compare downloaded content to expected), sees truncation notice with a lowered max rows; permission variants (none, Run only, Run + assigned, Manage only, Assign only, all); keyboard-only walk; axe at four sizes with menus open; bundle check; phone screenshots.
16.6 Performance test (tools/perf): 50,000-row run, sort, filter, page and export timings against the targets of section 15; recorded, not gating beyond a generous threshold.

## 17. Starter reports

Seeded once (guarded by a `SeedMarker`), shipped **active** and assigned to no role until the owner picks the trusted roles; the demo seed assigns them to demo roles so the page is not empty.

| Category | Report | Parameters | Sketch |
|---|---|---|---|
| Task follow-up | Overdue tasks by pod | Pods (multi, default my pods) | tasks past `DueDate` and not done, count per pod and priority |
| Task follow-up | Tasks per matter | Period (daterange), Client (lookup, optional) | open/done counts per matter and client |
| Task follow-up | Open tasks by assignee | Pod (single), Include unassigned (yes/no) | workload table |
| Task follow-up | Tasks completed per person | Period (daterange), Task type (multi) | completed counts per user and type |
| Task follow-up | Aging of open tasks | Pods (multi) | buckets 0-7, 8-30, 31-90, 90+ days since creation |
| Intake | Tasks created per week | Period | count by week and task type |
| Housekeeping | Users with no pod / inactive assignees | none | data-quality list |
| Assets | Assets linked to open tasks | Asset type (multi) | asset, task, matter |

Starter SQL lives in `db/seed/reports/*.sql` (plain files read by the seeder, tested against the Docker DB in CI so they stay valid after schema changes; a failing starter fails the build). Admins may edit or deactivate them like any report (marked "Starter" only in the editor, a normal report afterwards).

## 18. Open questions for the owner

1. "Save a view": built as personal column/sort/filter layout. Did you also mean saving a **snapshot of the results** (frozen rows to look at later)? It is a non-goal now; it would need storage, retention and a sensitivity decision (data kept after access changes).
2. Sensitive matters (option A): confirm that the trusted roles may see all matters in reports, and who decides which roles are trusted.
3. CSV delimiter: comma + UTF-8 BOM by default; does the firm use Excel with a `;` list separator (then a per-user setting, +1 h)?
4. Corporate read-only login: SQL login with password (stored in IIS secrets) or a dedicated Windows/Entra account? Does the DB run at compatibility level 130 or higher (needed for `OPENJSON`)?
5. Result memory: single IIS server, in-memory result cache (lost on app-pool recycle) is assumed. Acceptable?
6. Retention of the run log (default: keep 2 years, no automatic delete in release one) and whether parameters may contain personal data (matter names are not stored, only ids).
7. Authors: is it acceptable that `Report.Manage` holders can read any non-denied table (they are as trusted as database owners for reading)?
8. Estimate: the plan totals more than your 100 h guess (see delivery plan); scope cuts offered there.
