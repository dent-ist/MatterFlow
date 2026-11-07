# Reports: user pages screen specification

Status: proposal for owner sign-off, 2026-11-07, base `origin/reports` (fd1428f). Author: UI designer. Replaces sections 10, 11 and 12 (screens and grid) of `README.md` and the phone work of `delivery-plan.md` for issues #718 to #723. The rest of `README.md` (data model, API, parameters, limits, audit, security) stays valid. Standard: `docs/ux/design-guidelines.md` (D-numbers below), tokens `docs/ux/tokens.css`. Desktop only, 1366x768 and 1920x1080 (D-82). **No new or changed keyboard shortcuts (#420).**

Contents: 0 Decisions and deviations, 1 Pages and navigation (shared by all), 2 #718 Listing, 3 #719 Run page and parameter form, 4 #720 Result grid, 5 #721 CSV export, 6 #722 Saved views, 7 #723 Favourites and recent, 8 Backend the screens need, 9 Components reused and new, 10 Wording table, 11 Acceptance per issue, 12 Owner decisions.

---

## 0. Decisions and deviations from the old spec

| # | Decision | Old spec | Why |
|---|---|---|---|
| 1 | The listing is the shared **record grid** (`mf-record-grid`) with `groupBy` category. No cards. | Cards / grouped list with a Run button (10.1). | D-42 and D-44a: every list of records is the record grid; a category band is what `groupBy` already does; same keyboard, column, width and state behaviour as Clients and Matters; no second list pattern to maintain. |
| 2 | The result grid is the **same** `mf-record-grid` with `RecordGridState` fed a computed column list. **No new `mf-report-grid` component.** | New grid with its own header, reorder and resize (11). | `RecordGridState(grid, defs: Signal, exclude)` already takes dynamic columns, stored widths, reorder, the Columns chooser and sticky bands. Only a small `report-column-defs.ts` mapper (server column type to column def, filter type, formatter) is new. |
| 3 | Column filters use the shared `tr[mfColumnFilterRow]` row with existing filter types (text, numberRange, dateRange, triState). | Own filter popovers per type (11.3). | D-44d. Range types need two small server ops (section 8). |
| 4 | Paging is the shared `mf-pager` (25, 50, 100, 250 per page, "1-50 of 143"). | Server paging 25/50/100/250. | Same numbers; the component is shared (D-61). |
| 5 | Run page has **one** primary button **Run Report**; while running it becomes **Cancel** (not a second button next to it). | "Run single button, Cancel" (10.2). | D-30: one primary, last. Cancel replaces Run only while the call is live. |
| 6 | Result date columns show `MM/DD/YYYY` always (numeric, with year). Date-time columns `MM/DD/YYYY hh:mm AM/PM`. | ISO in the old text, D-60 elsewhere. | A result mixes years; D-60 drops the year in the current year, which makes a column ambiguous. **Owner decision O2.** |
| 7 | Phone and tablet layouts are dropped. | Section 14 phone rules. | D-82. |
| 8 | Nav: new item **Reports** under the main nav; the admin item is renamed **Report Setup** (admin side is unchanged otherwise). | One word "Reports" in both places. | Two items with the same label and different pages is the problem the code comment in `nav-items.ts` already flags. **Owner decision O1.** |
| 9 | "Save a view" stores columns (order, hidden, widths), sort, filters and page size. Not data. | Same (Q1). | Unchanged. |
| 10 | Leaving the run page while a report runs cancels it silently (`DELETE /reports/runs/current`). | Not stated. | The server allows one live result per user; a forgotten run must not block the next one. **Owner decision O5.** |

---

## 1. Pages and navigation (all issues)

### 1.1 Routes (all lazy, none imported by the eager shell; bundle budget stays under 700 kB)

| Route | Page | Guard | Title (browser tab) |
|---|---|---|---|
| `/reports` | Listing (#718) | `Report.Run` | "Reports - MatterFlow" |
| `/reports/:reportId` | Run page and result (#719, #720, #721, #722) | `Report.Run` and the report is assigned to one of the person's roles (server decides, 404 style state otherwise) | "<Report name> - Reports - MatterFlow" |
| `/reports/:reportId?<p>=<v>&...` | Same page, parameters in the URL so a run can be bookmarked (old 10.2 kept) | same | same |
| `/reports/:reportId?view=<viewId>` | Opens with a saved view applied | same | same |

The URL carries the parameter values by their parameter **name** (`from=2026-01-01&to=2026-03-31`, multi values repeated: `status=Open&status=Closed`, lookups by id). Opening such a URL fills the form and does **not** run automatically; the person presses Run Report (a report can be expensive, and one run per user). Result state (page, sort, filters) is **not** in the URL; it lives in the view state (section 6).

### 1.2 Navigation

- Main nav, below **Task Queue** (after Pod Work): a new item **Reports** (icon `pageIcon('reports')`, path `/reports`, permission `Report.Run`). Selected state is the white pill (D-80). The item shows for everyone with `Report.Run`, also when nothing is assigned yet (the empty listing explains it); hiding it would make the feature look broken when a role is half set up.
- Administration (existing): label **Report Setup** (path `/admin/reports`, `Report.Manage`), same icon family. Page H1 of the admin page becomes "Report Setup". Deep links stay.
- PM compact menu (#775) lists **Reports** (the people-facing page), not Report Setup.
- A person with `Report.Manage` but not `Report.Run` sees only Report Setup. Admins who also run reports see both.
- The global search does not index reports in this release.

### 1.3 Page frame

Same frame as Clients and Matters: `mf-page-header` (H1 left, `mf-title-icon` with the reports icon, actions right), a toolbar row under it, the grid below filling the height with sticky bands (header row, filter row) and the pager as the last band. No page-level scroll at 1366x768; the grid body scrolls (D-44c).

### 1.4 State blocks (all pages; sentences are fixed, D-51)

| Where | Situation | Look | Wording |
|---|---|---|---|
| Listing | loading | skeleton rows in the grid | none (count chip shows "-") |
| Listing | nothing assigned | `mf-state-block`, reports icon | "No reports are assigned to you." Second muted line: "Ask an administrator to assign reports to your role." No button. |
| Listing | search finds nothing | | "No results for "<text>"." + `Clear Search` |
| Listing | filter finds nothing (favourites only, category) | | "No reports match these filters." + `Clear Filters` |
| Listing | error | warning icon | "Couldn't load reports." + `Retry` |
| Run page | loading definition | skeleton form | none |
| Run page | report not found or not assigned | `mf-state-page` | "You don't have access to this report." + `Back to Reports` (one wording for both; never reveal which) |
| Run page | report inactive (deactivated after the link was shared) | `mf-state-page` | "This report is no longer available." + `Back to Reports` |
| Run page | definition error | warning | "Couldn't load this report." + `Retry` |
| Result | before first run | `mf-state-block` below the form | "Run the report to see results." (muted, no icon button) |
| Result | zero rows | `mf-state-block` inside the grid area | "No rows returned." (filtered: "No rows match these filters." + `Clear Filters`) |
| Result | expired (410) | inline `.pg-banner` warning above the grid | "This result has expired. Run the report again." + `Run Report` in the banner (D-53a) |
| Result | run failed | inline banner, error tone | the server message (section 10) and for REPORT_FAILED "Reference: <ref>" with `Copy Reference` |

No toast for a failure that the page shows inline. Action failures that have no inline place (export, save view) use the toast service.

---

## 2. #718 Reports listing (`/reports`)

### 2.1 Header and toolbar

- H1 "Reports", count chip with the number of assigned reports (shared chip rule: "-" while loading or after error).
- No header action (nothing is created here). Admins see a muted link at the right end of the header: `Report Setup` (text link with arrow icon, only with `Report.Manage`), because admins land on this page first and need the way to the setup.
- Toolbar (`mf-list-toolbar`), left to right: search field (placeholder "Search reports...", 320 px, searches name, description and category, client side because the list is small, at most a few hundred), a **Favourites** toggle chip (star icon, off by default; on = blue filled as an active filter, D-44t), a **Category** multi-select dropdown (`mf-dropdown` multi, search on; blue only when it holds a value), `mf-filter-chips` for the active filters with `Clear Filters`. Right end: nothing.

### 2.2 Grid

Record grid id `reports-list`, stored prefs `mf.grid.v1.reports-list.<userId>`. `groupBy` = Category (band row: chevron, category name, count "(4)"; all groups expanded by default, collapse state kept in the stored prefs). Groups sort by category `SortOrder`, rows by report `SortOrder` then name; no user column sort in this release (the headers are not sortable, no sort arrows; the order is the administrator's).

| Column | 1366 | 1920 | Content |
|---|---|---|---|
| Favourite (star) | 44 | 44 | icon button, star outline / filled in the warning-solid token; tooltip "Add to Favourites" / "Remove from Favourites"; accessible name the same plus report name. Not resizable, not in the Columns chooser. |
| Report | fill, min 280 | fill | name as `mf-btn--name` link (opens the run page), second muted line: the description, one line, ellipsis, full text in tooltip |
| Category | hidden (the band says it) | hidden | Category is the group and is not repeated as a column |
| Parameters | 120 | 140 | "No parameters" or "3 parameters" (muted); tooltip lists the parameter labels |
| Last Run | 140 | 160 | "MM/DD hh:mm AM/PM" of the person's last run of this report, "Never" muted. Source: recent runs (section 7). |
| Run (action) | 96 | 96 | `Run Report` is not repeated here; see 2.3 |

The Columns chooser is not offered on this grid (four fixed columns; nothing to choose). Header and filter row: no `mfColumnFilterRow` (the toolbar filters are enough for a short list).

Row click and Enter open the run page (`rowClickable`). Row `rowClass` for a favourite: none (the star is enough).

### 2.3 Primary action: the row opens the report; there is **no** per-row Run button and no row menu

D-44 (one obvious action is its own icon button, not a menu; the whole row opens the record) and D-44a (the name is the link): the only action is "open this report", which the name link and the row click already do. A Run button on the list would run without showing parameters, or lie about doing so (most reports have parameters). Reports with no parameters still open the run page and show the Run Report button; that is one extra click and keeps the behaviour the same everywhere. This is the deviation from "Run button" in the old 10.1.

### 2.4 Favourites and recent on this page

See section 7: favourites are the star column and the Favourites chip (no separate group, no duplicate rows). Recent reports are a one-line row **above the grid** (section 7.2), shown only when the person has at least one run and no search or filter is active.

### 2.5 Behaviour

- Search matches on every keystroke after 150 ms; no server call.
- The Favourites chip and Category filter combine with search (AND).
- Grid keyboard: arrows move the row focus, Enter opens (existing grid behaviour, no new shortcut).
- Width rules: at 1366 the Report column is at least 280 px; the description line truncates; at 1920 the same columns, the Report column gets the spare width.

---

## 3. #719 Run page and parameter form (`/reports/:reportId`)

### 3.1 Header

- Crumb: `Reports` (link) > report name (text). Same crumb component as Matter and Client detail.
- H1 = report name; to its right the favourite star (same icon button as the list, 7.1). Under the H1 a muted line: category name.
- Description (sentence case, up to 3 lines, `Show More` toggles the rest) and, when the report has Help text, an `Info` icon button after the description opening the help in a `mf-slide-panel` (520 px, read only, title "About This Report"). Admin help text is markdown-lite; the panel renders it with the shared renderer used for the admin preview.
- Header actions (right): none while the form is shown. After a run, the result toolbar (4.1) carries Export and views; the header stays.

### 3.2 Parameter form

A card (`pg-card`) under the header, titled "Parameters" (section title style). Hidden entirely when the report has no parameters; then the Run Report button sits in the result toolbar row.

Layout (D-35): one column below 1100 px of content width, **two columns from 1100 px** (so at 1366 with the 220 px nav the content is about 1146 px and shows two columns; the nav is not collapsible below this). Labels above fields, 13/600; "(required)" after the label of a required parameter; no asterisks. Fields in parameter order. A `daterange` parameter spans **both** columns (two date fields side by side plus the presets). A `multi` or `lookup` multi with a long selection also spans two columns. Help text of a parameter (admin "Help") is a muted 12 px line under the field.

Footer of the card (not a sticky page bar; this is not a record form): right aligned `Reset` (text button, restores the defaults) and **Run Report** (primary, last, D-30). Left of them, muted: "One report runs at a time." only while the person has another result live (see 3.5).

All controls are shared fields. **No native `<select>` and no native checkbox or radio.** The only native-based control is the date input above (the app's one date control today; a shared date picker is a separate design question, not a blocker). All dropdowns are `mf-dropdown` with `field` (white, D-44r). Field height 36 px; width fills its column.

| Parameter type | Control | Details |
|---|---|---|
| number | `mf-text-field` numeric | right aligned text, accepts digits, sign, one decimal point; thousands commas shown after blur; min / max from the definition shown in the error message only; empty allowed unless required |
| date | the app's styled date input (**built as** `mf-date-input` from form-engine: MM/DD/YYYY typing plus a calendar button; accepted in review 1, replaces the native input this row first named) | browser calendar and typing; default keywords resolve to a real date when the form opens (today, startOfMonth, endOfMonth, startOfYear, endOfYear, startOfLastMonth, endOfLastMonth, today-N, today+N) |
| date range | two date inputs of the same kind ("From", "To") + the shared **date-presets** menu button "Presets" (This Month, Last Month, This Year, Last 30 Days ...) after the fields | one label for the pair (the parameter label); "To" is not allowed before "From" (message below); either side may be empty only if not required |
| text | `mf-text-field` | max length from the definition (default 400), no counter unless over 80% of it; the value is trimmed |
| single (fixed list) | `mf-dropdown` field, search on when more than 8 options | placeholder "Select..." ; a clear (x) when not required |
| multi (fixed list) | `mf-dropdown` multi, field, search on when more than 8 options | selected shown as "3 selected", chips are not used inside the field; the panel has `Select All` / `Clear` links; max 200 |
| single or multi with choices from SQL | same dropdowns, options loaded with `POST /reports/{id}/choices/{parameter}` on first open | loading row "Loading..."; truncated: last row "Showing the first 500. Type to narrow." (typing re-queries with the text); error row "Couldn't load options." + `Retry` |
| yes / no | `mf-segmented` with three states when not required: `Any`, `Yes`, `No`; two states `Yes`, `No` when required | default from the definition |
| lookup: matter | `mf-entity-picker` (matter) | same picker as Create Task: type to search by number or name, result rows with number and client, selected value shows number and name |
| lookup: client | `mf-entity-picker` (client) | same |
| lookup: user | `mf-search-select` users, active users first | shows name and pod |
| lookup: pod | `mf-dropdown` field (pods are few) | |
| lookup: role, task type | `mf-dropdown` field (few) | |
| lookup multi | the same picker in multi mode: selected values are removable chips below the field, max 200 | |

Lookup permission note: the pickers call the app's normal lookup APIs, so a person who has `Report.Run` but no `Client.View` could not search clients. Section 8 asks the backend to allow the report-parameter lookups for anyone who can run that report (a reports-owned lookup endpoint returning id and label only). Without it the control shows "You don't have access to clients." (state wording) and the report cannot run with a required client parameter. **Owner decision O6.**

### 3.3 Validation

- Client side, on Run Report and on blur of a touched field. First invalid field gets focus; no top banner for field errors (D-35). Errors are red 12 px lines under the field, field border red (`invalid` input).
- Messages (fixed): required "Enter <label>." for text/number/date, "Select <label>." for lists and lookups; number "<Label> must be a number."; number range "<Label> must be between <min> and <max>."; date "<Label> must be a date (MM/DD/YYYY)."; date range "From must be on or before To."; text too long "<Label> must be 400 characters or fewer."; multi over limit "Select 200 or fewer."
- Server 422 `REPORT_PARAMETERS_INVALID`: the per-parameter messages are placed under the matching fields (same red style); the page does not run and does not toast.

### 3.4 Run, cancel, states

1. Press **Run Report** (or Enter inside a text field when the form is valid: this is the form's native submit, not a shortcut). Button shows a spinner and the label becomes **Cancel**; fields are disabled except nothing else; the result area shows a skeleton and under the form a muted line "Running... <n> s" (counter in seconds, tabular figures).
2. **Cancel** calls `DELETE /reports/runs/current`, returns to the form with the previous values; no toast; the muted line is replaced by nothing. If the server answers REPORT_CANCELLED (499) that is the expected result, not an error.
3. Success: the form collapses to a one-line **summary bar** (4.1) so the grid gets the height: "Parameters: <label> <value>, ..." (truncates with ellipsis, full text tooltip) with a `Change Parameters` text button at the right. Pressing it re-expands the card (the result stays until the next run). At 1366x768 this collapse is required: form plus grid does not fit.
4. Zero rows: state block "No rows returned." and the summary bar; Export is disabled with tooltip "There are no rows to export."
5. Failure: inline error banner above the result area; the form stays open and editable.
6. Truncated (server cut at 50,000 rows): banner (info tone) above the grid: "Showing the first 50,000 rows. Narrow the parameters to see the rest." (number from `maxRows`).

### 3.5 Limits (messages are shown inline in the banner, never as toasts)

| Code | Banner wording |
|---|---|
| REPORT_ALREADY_RUNNING (409) | "Another report is already running for you. Wait for it to finish or cancel it." with a `Cancel Running Report` text button (calls `DELETE /reports/runs/current`) |
| REPORT_RATE_LIMITED (429) | "You've reached the hourly limit for report runs. Try again later." (no number: the limit is a setting; changed after review 1) |
| REPORT_BUSY (429) | "The server is busy with other reports. Try again in a minute." |
| REPORT_MEMORY (503) | "This report needs more memory than is available. Narrow the parameters and try again." |
| REPORT_TIMEOUT (408) | "The report took longer than 60 seconds and was stopped. Narrow the parameters and try again." |
| REPORT_FAILED (500) | "The report couldn't be run." + "Reference: <ref>" + `Copy Reference` |
| RESULT_EXPIRED (410) | "This result has expired. Run the report again." |

The 60 s and 50,000 numbers come from the response / settings (`maxRows` in the response; timeout from the definition endpoint), never hard coded in the component.

---

## 4. #720 Result grid

### 4.1 Frame under the summary bar

Order top to bottom: crumb/header, summary bar (3.4), result toolbar, `mf-record-grid` (header row, filter row, body), `mf-pager`.

Result toolbar (`mf-list-toolbar`), left to right: **Saved Views** menu (6.1), `mf-filter-chips` with `Clear Filters` (when filters active), a muted "Sorted by <Column> (ascending), <Column> (descending)" line (shows the sort only when it is not the server default), right end: **Columns** chooser button, **Export CSV** button (5.1). Counts: left of the pager "1-50 of 143" ("of 143 (filtered from 2,380)" when filtered, D-61).

### 4.2 Grid contract

- One `mf-record-grid`, id `report-result`, prefs key `mf.grid.v1.report-result-<reportId>.<userId>` (per report, so each report keeps its own widths and column order). `RecordGridState` receives `defs` computed from the run's `columns[]` (name, type) by `report-column-defs.ts`.
- Rows from `GET /reports/runs/{runId}/rows?page&pageSize&sort&filter`; every sort, filter and page change is a server call; the grid shows the loading skeleton on the body only and keeps the header.
- Page size 25, 50 (default), 100, 250 via `mf-pager`.
- Sticky header and filter bands, the first column is **not** frozen (no frozen columns in the standard; very wide results scroll horizontally, 4.6).
- Row height 40, no row click, no row menu, no selection (a report is read only).
- Headers: sort by click; click cycles ascending, descending, none; Shift+click adds a secondary sort (max 3; this is a mouse modifier, not a keyboard shortcut); sort arrow and order number badge for the secondary sorts. Sort and filter state survives page changes and a Columns change.
- Column resize by the header edge handle, minimum 80, maximum 640; reorder by drag of the header and keyboard resize Shift+Left / Shift+Right on a focused heading (both existing grid behaviour, D-44b, not new); double-click on the edge fits to content is **not** offered.
- **Columns** chooser (shared panel, D-36): checkbox list in the current order with drag handles, `Select All`, `Reset to Default`; at least one column stays checked (the last checkbox is disabled). Hidden columns are stored in the prefs, as are the widths (existing widths store).

### 4.3 Filter row

`tr[mfColumnFilterRow]` under the header, one cell per column, by server type:

| Server type | Filter type | Operators offered | Server op |
|---|---|---|---|
| text | text | contains (default), equals, starts with, blank, not blank | contains / equals / startsWith / blank / notBlank |
| integer, decimal | numberRange | From, To (either may be empty), blank, not blank | eq / gte / lte / between / blank / notBlank |
| date, dateTime | dateRange with presets | From, To (either may be empty), blank, not blank | on / onOrAfter / onOrBefore / between / blank / notBlank |
| boolean | triState | Any, Yes, No, blank | eq / blank |

Max 20 filters (server); the 21st shows a toast-less inline message in the popover: "Remove a filter to add another." Filter changes debounce 300 ms (text) or apply on close of the popover (ranges) and reset to page 1. Filter chips render as "<Column>: <summary>" (D-44d).

### 4.4 Cell formatting by type

| Type | Alignment | Format | Null |
|---|---|---|---|
| text | left | as is; one line, ellipsis, tooltip with the full text when cut; no HTML interpretation ever; whitespace shown collapsed | empty cell (nothing, no dash) |
| integer | right, tabular figures | `1,234`; negative with a minus sign | empty |
| decimal | right, tabular figures | `1,234.56`; scale from the data, at most 4 decimals, at least the value's own digits | empty |
| boolean | centre | "Yes" / "No" text (no icon, so it also exports and reads the same) | empty |
| date | left | `MM/DD/YYYY` (decision 6) | empty |
| dateTime | left | `MM/DD/YYYY hh:mm AM/PM` in the person's time zone, no zone in the cell, long form in the tooltip (D-60) | empty |

### 4.5 Widths for unknown columns

The report author chooses any column name, so widths come from the type and the header, with a stored width overriding them:

| Type | Default width at 1366 and 1920 | Min |
|---|---|---|
| boolean | 96 | 80 |
| integer | 112 | 80 |
| decimal | 128 | 80 |
| date | 128 | 100 |
| dateTime | 176 | 140 |
| text | 200; widened to 280 when the first 50 rows hold a value longer than 40 characters | 100 |

Header text never wraps and is never cut when the width allows it: width = max(default, header text width + 56 for sort and filter icons), capped at 320. When the sum is smaller than the grid width, the **last text column** takes the spare width; otherwise the grid scrolls horizontally.

### 4.6 Very wide results

- Horizontal scroll inside the grid body; the header and filter bands scroll with the body (they are one scroller), the pager and toolbar do not move.
- Up to 100 columns are supported; above 100 the server rejects the report at preview time (admin side), so the user grid does not paginate columns.
- The Columns chooser has a search field when there are more than 12 columns.
- Truncated rows: the banner in 3.4 point 6 stays above the grid; the pager total says "of 50,000" and the summary tooltip says "Truncated".

---

## 5. #721 CSV export

### 5.1 Button

**Export CSV** in the result toolbar, right end, after Columns (secondary button, download icon). Visible only with a live result. Disabled while a run or a page load is in flight, and when there are zero rows (tooltip "There are no rows to export.").

When filters are active the button label stays "Export CSV" and the **tooltip** and a confirm-free note state what goes out: "Exports the 143 filtered rows (of 2,380)." Without filters: "Exports all 2,380 rows." With the truncated result: "Exports the first 50,000 rows." (counted wording, like the other counted actions.) No dialog before the download.

### 5.2 File

- Content: the current filtered and sorted rows (all of them, not only the visible page), the visible columns in their current order and with their header text.
- Format: UTF-8 with BOM, delimiter comma, CRLF line ends, RFC 4180 quoting, header row first. Dates ISO (`2026-03-31`, date-times `2026-03-31T14:05:00` in the person's time zone), numbers without thousands separators and with a dot decimal, booleans `Yes` / `No`, nulls empty. Cells starting with `=`, `+`, `-`, `@`, tab or CR get a leading apostrophe (formula injection). Dates are ISO in the file on purpose: files are consumed by tools.
- File name: `<report-slug>-yyyyMMdd-HHmm.csv`; `-truncated` before the extension when the result was truncated.
- Expired result: the call returns 410; banner "This result has expired. Run the report again." (3.5).

### 5.3 Feedback

- Download starts through the browser; the button shows a spinner while the file is prepared (up to a few seconds for 50,000 rows).
- Success toast: "Exported 143 rows to CSV." (counts with `mfInt`). A truncated export: "Exported 50,000 rows (truncated)."
- Failure toast: "Couldn't export the report." with `Retry` in the toast (action failure, no inline place).
- Audit: one `ReportRun` of kind Export and an audit event `Report.Export` (report, filter summary, row count, columns). The UI shows nothing about this except the Audit Logs page row; a muted note under the Export tooltip is **not** added.

---

## 6. #722 Saved views

### 6.1 Where

In the result toolbar, first control: a **Saved Views** button with a chevron (`mf-dropdown`-style menu button, label shows the applied view name: "Saved Views" when none; with an unsaved change since it was applied the name is followed by " (modified)"). A saved view is per user, per report, and holds: visible columns and order, widths, sort, filters, page size. Not parameter values.

### 6.2 Menu content (`mf-inline-menu` popover, D-36, 280 px, max 320 px high, scrolls)

1. Row "Default" (reset to the report's own columns, no sort, no filters, page size 50). Always first. Check mark when no view is applied.
2. One row per view: name (ellipsis), a "Default" chip on the person's default view, a check mark on the applied one; row hover shows two icon buttons: Rename (pencil), Delete (trash). Setting the default is done from the menu footer for the applied view, not per row.
3. Divider, then footer actions as text buttons: `Save View` (disabled when no changes since applied and a view is applied: it updates the view; tooltip "No changes to save."), `Save as New View...`, and `Set as Default` / `Remove Default` (only when a view is applied).

Behaviour: choosing a view applies columns, widths, sort, filters and page size to the current result at once (page 1). If the saved view mentions a column the result does not have, it is skipped and a banner (info) shows once: "This view uses columns the report no longer returns. They were skipped." with `Dismiss`. A filter on a missing column is dropped the same way. A column that is new in the result and not in the view is appended visible at the end.

With a default view set, the run page applies it automatically to every new result of this report (and the toolbar shows its name).

### 6.3 Dialogs (all `mf-form-dialog` / `mf-confirm-dialog`, D-31, D-34)

| Dialog | Title | Content | Buttons |
|---|---|---|---|
| Save as New View | "Save View" | one field "View name (required)", max 80, prefilled "<Report name> view"; checkbox-style checkbox "Use as my default view" (the shared checkbox of the Columns chooser, unchecked) | `[Cancel] ... [Save View]` |
| Rename | "Rename View" | one field "View name (required)" prefilled | `[Cancel] ... [Rename]` |
| Delete (confirm) | "Delete View" | "Delete "<name>"? This can't be undone." | `[Cancel] ... [Delete]` (danger) |

Validation: empty "Enter a view name."; duplicate (case-insensitive, per report and user) "You already have a view with this name."; over 80 "View name must be 80 characters or fewer."

Toasts: "View saved." (also on update), "View renamed.", "View deleted.", "Default view set.", "Default view removed." Failures: "Couldn't save the view." with `Retry`.

Limit: 25 views per report and user; at the limit `Save as New View...` is disabled with tooltip "You can save up to 25 views for this report."

### 6.4 Storage

Server side, per user (they follow the person between machines, unlike the grid width prefs which are local). New table and endpoints in section 8. The local grid prefs (`mf.grid.v1.report-result-<id>.<user>`) still hold the working state between runs; a saved view overwrites them when applied.

---

## 7. #723 Favourites and recent reports

### 7.1 Favourites

- Star icon button: first column of the listing and next to the H1 of the run page. One click toggles; optimistic with rollback and the toast "Couldn't update favourites." on failure. Toast on success: none (the star is the feedback).
- Listing: the **Favourites** toggle chip in the toolbar filters the grid to favourites (groups with no favourite disappear). Favourites are **not** a second copy of the row above the groups: no duplicate rows (a row appears once, in its category). When the person has favourites and has never changed the filter, the chip is off; the grid does not reorder.
- Per user; deleted automatically if the report is unassigned or deactivated (hidden from the list, row kept so it returns if reassigned).
- Limit: none.

### 7.2 Recent reports

- A single line above the grid: label "Recent" (muted, 12/600), then up to **5** report names as `mf-btn--chip` links (name, ellipsis at 180 px, tooltip with category and "Last run MM/DD hh:mm AM/PM"), most recent first, one row, no wrap (extra chips hidden by width, at 1366 four fit).
- Source: the person's most recent distinct reports by run (success or not), from the server (section 8). A click opens the run page of that report (parameters of the last run are **not** restored in this release; only the report opens).
- Shown only when the person has run at least one report and no search / filter is active. Otherwise the line is not rendered (no empty placeholder).
- Run page: after a run, the report moves to the front of Recent (server side, no UI).

---

## 8. Backend the screens need (for the developer; none exists yet)

| Need | For | Shape |
|---|---|---|
| `GET /reports` (assigned, active) | #718 | `[{id, name, description, categoryId, categoryName, categorySortOrder, sortOrder, parameterCount, parameterLabels[], isFavourite, lastRunAt}]`; one call, no paging |
| `GET /reports/{id}` | #719 | definition without SQL: name, description, helpText, category, parameters (type, label, required, default, min, max, maxLength, options or choicesSource, lookup kind and multi), `timeoutSeconds`, `maxRows`, `isFavourite` |
| Range filter ops | #720 | numbers `gte`, `lte`; dates `onOrAfter`, `onOrBefore` added to `ResultQuery` (between stays) |
| `GET /reports/runs/{runId}/export` | #721 | streams CSV from the live result with the same `sort`/`filter`/`columns` (visible, ordered) query; 410 when expired; writes ReportRun Export and `Report.Export` |
| Views: `GET/POST /reports/{id}/views`, `PUT/DELETE /reports/{id}/views/{viewId}`, `PUT /reports/{id}/views/default` | #722 | new table `ReportUserView(ViewId, ReportId, UserId, Name, IsDefault, StateJson, audit cols)`, unique (ReportId, UserId, Name), one default per (ReportId, UserId); numbered script, immutable once merged |
| Favourites: `PUT/DELETE /reports/{id}/favourite` | #723 | new table `ReportFavourite(UserId, ReportId, CreatedAt)` |
| Recent: derived from `ReportRun` | #723 | `GET /reports/recent?top=5` -> `[{id, name, categoryName, lastRunAt}]` |
| Lookup endpoints for parameters | #719 | `GET /reports/{id}/lookups/{parameter}?q=&take=25` -> `[{id, label, sub}]` for matter, client, user; allowed for anyone who can run the report (owner decision O6) |

OpenAPI contract and generated client updated in the same changes (CI checks drift). The permission catalog needs no new entry (`Report.Run` covers all user actions).

---

## 9. Components

**Reused (no change):** `mf-page-header`, `mf-title-icon`, `mf-record-grid` + `RecordGridState`, grid prefs and widths store, `mf-pager`, `tr[mfColumnFilterRow]` with filter types `text`, `numberRange`, `dateRange`, `triState`, filter popover, date-presets, `mf-list-toolbar`, `mf-filter-chips`, `mf-dropdown` (single, multi, `field`, `invalid`), `mf-entity-picker`, `mf-search-select`, `mf-text-field`, `mf-segmented`, the shared checkbox, `mf-slide-panel`, `mf-state-block`, `mf-state-page`, `mf-form-dialog`, `mf-confirm-dialog`, `.pg-banner`, `pg-card`, `NotificationService` toasts (with Copy Reference), `mf-btn--name`, `mf-btn--chip`, `mfNum` and number helpers (`mfInt`).

**New (small, needed):**

1. `report-column-defs.ts` (feature folder `features/reports`, not shared): maps a run's `columns[]` to record-grid column defs, filter types, formatters and default widths (4.4, 4.5). Needed because the columns are only known after a run.
2. `ReportParameterForm` component (feature folder): renders the table in 3.2 from parameter definitions. It composes shared fields; promoted to `shared/` only if the admin preview panel also adopts it (the preview panel today has its own simpler form: follow-up, not part of these issues).
3. `report-views-menu` (feature folder): the menu in 6.2. If it is later wanted on another grid, it becomes shared then.

No new tokens, no new shared primitives.

---

## 10. Wording table (all in one place)

| Place | Text |
|---|---|
| Nav items | Reports; Report Setup (admin) |
| Listing H1 / search placeholder | Reports / Search reports... |
| Listing empty | No reports are assigned to you. / Ask an administrator to assign reports to your role. |
| Listing filtered empty | No reports match these filters. + Clear Filters |
| Listing search empty | No results for "<text>". + Clear Search |
| Listing error | Couldn't load reports. + Retry |
| Favourite tooltip | Add to Favourites / Remove from Favourites |
| Recent label | Recent |
| Last Run empty | Never |
| Run page no access | You don't have access to this report. + Back to Reports |
| Run page inactive | This report is no longer available. + Back to Reports |
| Parameters title | Parameters |
| Buttons | Run Report, Cancel, Reset, Change Parameters, Cancel Running Report, Export CSV, Columns, Saved Views, Save View, Save as New View..., Set as Default, Remove Default, Rename, Delete, Clear Filters, Clear Search, Retry, Copy Reference, Back to Reports, Dismiss |
| Before first run | Run the report to see results. |
| Running | Running... <n> s |
| Zero rows | No rows returned. / No rows match these filters. |
| Truncated | Showing the first 50,000 rows. Narrow the parameters to see the rest. |
| Expired | This result has expired. Run the report again. |
| Validation | Enter <label>. / Select <label>. / <Label> must be a number. / <Label> must be between <min> and <max>. / <Label> must be a date (MM/DD/YYYY). / From must be on or before To. / <Label> must be 400 characters or fewer. / Select 200 or fewer. |
| Limits | see 3.5 |
| Filter limit | Remove a filter to add another. |
| Sorted line | Sorted by <Column> (ascending), <Column> (descending) |
| Export tooltips | Exports all 2,380 rows. / Exports the 143 filtered rows (of 2,380). / Exports the first 50,000 rows. / There are no rows to export. |
| Export toasts | Exported 143 rows to CSV. / Exported 50,000 rows (truncated). / Couldn't export the report. |
| Views | View name (required); Use as my default view; Enter a view name.; You already have a view with this name.; View name must be 80 characters or fewer.; View saved.; View renamed.; View deleted.; Default view set.; Default view removed.; Couldn't save the view.; Delete "<name>"? This can't be undone.; You can save up to 25 views for this report.; No changes to save.; This view uses columns the report no longer returns. They were skipped. |
| Favourites | Couldn't update favourites. |

---

## 11. Acceptance per issue

**#718** Route `/reports` lazy and guarded; nav item Reports for `Report.Run`; grid with category bands, star, Report, Parameters, Last Run columns at the widths in 2.2; search, Favourites chip, Category filter; all five states; row and name open the run page; no Run button and no row menu; no shortcut added; 1366 and 1920 checked, no horizontal scroll.

**#719** Route `/reports/:reportId` with parameters in the URL (no auto run); a control per type as in 3.2 with no native controls; validation messages as in 3.3 incl. server 422 mapping; Run Report / Cancel behaviour, summary bar and Change Parameters; limit banners as in 3.5; help panel; favourite star; leaving cancels a running report.

**#720** Result grid on the shared record grid with dynamic columns; server paging, sort (3 keys), typed filters (20 max), reorder, resize, Columns chooser with stored widths; formatting and widths as in 4.4, 4.5; horizontal scroll for wide results; truncated and expired banners; "Sorted by" line; filtered count in pager.

**#721** Export CSV button, tooltip wording, file format and name, toast, audit event, 410 handling; export respects filters, sort and visible columns; tested with 50,000 rows and formula-injection cells.

**#722** Saved Views menu and dialogs as in section 6; rename, delete, default; unknown-column handling; 25-view limit; stored server side per user and report.

**#723** Star on listing and run page; Favourites chip; Recent line (5 chips) as in 7.2; server endpoints; unassigned report disappears from both.

---

## 12. Owner decisions needed

| # | Question | Recommendation |
|---|---|---|
| O1 | Rename the admin item and page to **Report Setup** so the two Reports entries differ? | Yes. |
| O2 | Result date columns show the year always (`MM/DD/YYYY`), an exception to D-60? | Yes; a result mixes years. |
| O3 | Nav item **Reports** visible to everyone with `Report.Run`, even when nothing is assigned? | Yes. |
| O4 | CSV: comma and UTF-8 BOM only, no per-user delimiter setting (Excel in some locales wants `;`)? | Yes for release one; add a setting only on request. |
| O5 | Leaving the run page while a report runs cancels it silently? | Yes. |
| O6 | Parameter lookups (matter, client, user) available to anyone who can run the report even without Client.View / Matter.View? | Yes, id and label only; otherwise such reports cannot be used by run-only roles. |
| O7 | No saved result snapshots (a view is layout, not data) - old question Q1. | Confirm. |

---

## 13. Review 1: list, menu and run page (#718, #719), 2026-11-07

Reviewed: RF commits 3873640 (#718) and 7854f2d (#719) on `origin/reports`, code read plus the 17 mocked-API JPEGs (`evidence/2026-11-07-reports-718`, `-719` on `design-evidence`) at 1366 and 1920. I did not run a stack (no report login on the demo stack; RF's mocks cover every state). Not checked in a browser by me: keyboard tab order and the live counter timing (read from code only).

**Verdict: pass with three small fixes.** The list, nav, run page, validation, Run/Cancel, summary bar, banners and the neutral result block match the spec. Findings that are not deviations:

- Nav: Reports appears for a person with only Report.Run, also with nothing assigned (evidence `rp7-list-empty-1366`, nav shows only Reports); Administration shows "Report Setup" with its own wrench icon; PM compact menu lists Reports. Pass. Revert of the rename stays one label in four files.
- List: shared grid, category bands with counts, Report / Parameters / Last Run, search, Category filter, four states with the fixed sentences, `Report Setup` link for admins, count chip. Pass at 1366 and 1920. Star column, Favourites chip and Recent line are #723 and are correctly absent.
- Run page: crumb, H1 with icon, category line, description with info button and "About This Report" panel, required marks, red messages under fields (`role="alert"`, `aria-invalid`, `aria-describedby`), live region for counter and results, Run Report becomes Cancel with "Running... N s", form collapses to "Parameters: ..." bar with Change Parameters, banners 409 (with Cancel Running Report), 429, 503, 408, 500, truncated info banner, neutral `data-result-slot` block. Pass. Not seen in evidence: 408, 429, 503 and 500 banners (covered by unit specs only).
- Fixes (issues under epic #671): #1282 no "No matches." above a lookup access error (deviation 14, real defect); #1283 429 banner names no number (deviation 8); #1284 form dropdowns fill their column (new, not in RF's list: Status, Task Types, Pods stop at 308 px while every other control fills the column).

### Rulings on RF's 14 deviations

| # | Ruling |
|---|---|
| 1 | Accept `mf-date-input`. It is the better control (typing, MM/DD/YYYY, calendar) and exists in form-engine; my "no shared date field" was wrong. |
| 2 | Accept "A +2" and no Select All / Clear: it is how every shared multi dropdown behaves; one pattern wins over my wording. |
| 3 | Accept a server-search multi dropdown instead of chips. Revisit only if testers cannot see a long selection (then a shared change for all multi dropdowns). |
| 4 | Accept. The spec named these components. |
| 5 | Accept the five shared presets. Last Month and This Year would be added to the shared date presets for every filter popover in one design decision; not now. Authors can type dates. |
| 6 | Accept: the choices endpoint takes no search text, so there is nothing to re-query. Wording "Showing the first N options." is right (my "Type to narrow" promised something that does not exist). |
| 7 | Accept `<Report name>: Reports - MatterFlow`; it is the app's title rule (page-title helper, `recordTitle`). My spec text had the order wrong. |
| 8 | Fix: #1283. The limit is a setting (`ReportsOptions.RunsPerUserPerHour`), so a constant can lie. Wording is now in section 3.5. |
| 9 | Accept plain paragraphs. The admin editor does not offer markdown, so nothing shows as raw symbols. |
| 10 | Accept one no-access page (my section 1.4 already asked for one wording). The inactive wording "This report is no longer available." stays out until the server can tell inactive from missing. |
| 11 | Accept "<Label> must be a whole number." and "must be at least / at most <n>."; added to the wording table by reference. |
| 12 | Accept. The state block replaces the grid body in first-use, no-match and search-empty cases; headers add nothing. |
| 13 | Accept: a required Yes/No starting unanswered with "Select <label>." is more honest than a silent default. |
| 14 | Fix: #1282. |

### Leaving the page drops the finished result

Right for the grid design, keep it. One live result per person exists on the server, so releasing it frees the memory and removes a result nobody can reach (the grid state is not restored, no snapshots, owner question O7). It must stay quiet and must only fire on leaving the page or opening another report, never on a grid action, the help panel, Change Parameters or a Run (a new run replaces the result on the server anyway). Not covered: closing the tab or a reload; the 15 minute expiry handles those. #720 must not call the drop on its own re-render or paging.

### Owner questions: status after review 1

| # | Status |
|---|---|
| O1 Report Setup | Built (commit cites owner decision 9); treat as decided yes. |
| O2 Year in result dates | Open, concerns #720 only. |
| O3 Nav item for everyone with Report.Run | Built as yes (list empty state shows it); confirm. |
| O4 CSV comma and BOM only | Open, concerns #721. |
| O5 Leaving cancels a running report | Built as yes; confirm. The finished result is also dropped (see above). |
| O6 Lookups for run-only roles | Open and now visible: a person without Client.View gets "You don't have access to clients." and a required client parameter cannot be filled. Needs the reports-owned lookup endpoint of section 8 before release. |
| O7 No result snapshots | Open, confirm. |
