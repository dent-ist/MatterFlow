# Inline column filters across the app: design review and recommendation

Independent UI/UX review for the product owner. Branch `dev` at `5d4dff5`. No application code was changed.
Date of review: 2026-10-15.

> **Status (2026-10-20).** The recommendation was built: epic #75 (batches #76 foundation, #77 record lists, #78 work lists, #79 administration) and re-reviewed on 2026-10-20 (`column-filters/re-review-2026-10-20.md`, no Medium or High finding left). This document stays the design rationale and the pattern standard (section 4); where the built behaviour differs from what is written here, the differences are: **Matter Number** is the label of the matter column and its filter finds a reference or a name (#348); record lists (Clients, Matters, Projects, the client's Matters tab) open the row by default from 640 px with Filters and Clear filters in the page header, and Sensitive is a select in the row (epic #245); the Matter's Projects tab (B7, optional) has no filters; a filtered empty list shows one Clear filters and names what the default Status hides; Users keeps a scrolling nine-column grid at 1366 px with the filters in the sheet (decision in addendum X). The inventory and batch plan below describe the plan as made on 2026-10-15; section 3 of the re-review has the as-built table of the 36 surfaces.

**Request.** Replace the separate filter sections (search boxes, selects, status filters, filter panels) with inline column filters, extending the pattern already shipped on Assets (`docs/ux/assets-screen/README.md`, `shared/ui/column-filters.ts`, `.mf-filter-row` in `styles/_fixed-page.scss`).

**Method.** I read every grid, table and list in `features/**` and `shared/**` (36 surfaces, section 2), built `origin/dev` in a separate worktree, ran the real stack (SQL Server 2022 in Docker, the published API with Dev auth and the starter seed, plus 40 tasks, 20 clients, 24 matters, 14 projects, 40 assets, 8 workflows and 12 users from the e2e `seedBulk` helper) and captured the current filter UI of each screen at 1366x768 (plus three 375x812 shots). The 35 screenshots are in `column-filters-review/screenshots/` and are referenced as `[S01]` to `[S35]` below (index in Appendix C). Only the stack I started was stopped afterwards.

---

## 0. Summary of the recommendation

1. **Yes, adopt inline column filters app-wide, but not everywhere.** Of 36 surfaces: **18 convert** (17 plus Assets, which is the reference and only needs retrofitting onto shared parts), **2 are optional** (small in-memory tables), **5 are too small or are ordered configuration lists** (no filters), and **11 are not column-shaped** and keep a toolbar control (section 3).
2. **Build five shared parts once, driven by one declarative column definition** (`FilterDef[]`): `mf-column-filter-row`, `mf-filters-bar` (toggle + chips + clear + live region), `mf-filter-chips`, `mf-filter-sheet` (the same definitions rendered stacked below 768 px or when the grid overflows sideways) and the missing controls (multi-select popover, date range with presets, number range, tri-state). Plus a `ListFilters` URL/state helper that replaces the two parallel implementations we have today (`ListQueryPage` for record lists and `QueueFilters` for work lists).
3. **The Task Queue / My Work / Pod Work "Filters" panel goes away.** Its 10 controls (Status, Priority, Pod, Assignee, ASAP, Overdue, Due from/to, Created from/to) all map onto columns, and the API already supports seven more column filters (Type, Workflow, Creator, Requestor, Matter, Client, Project) that the UI never exposed. It is currently height-capped (`max-height: min(40dvh, 20rem)`) and at 1366x768 hides Due to and the Created dates below an inner scroll [S02, S03]. Quick views (All open, Unassigned, My pod, Created by me, Overdue, Recently completed) stay, but become **presets that visibly set column filters**. My Work and Pod Work **tabs stay tabs** (they are scopes, not filters).
4. **Text filters are "contains" only; no operator menu in v1.** Reference-like columns (matter `343-12`) keep their smart matching. The evidence threshold for adding operators later is in section 4.2.
5. **Never silently filtered.** Defaults (Status = Active) are visible in the cell and not counted; deep links open the row; chips summarise every active filter whenever the row is closed; the remembered last view of Task Queue / My Work gets a visible "Restored your last view" notice (today a bare `/tasks` is filtered without saying so beyond the chips).
6. **Hidden columns: their filters stay active and visible as chips**, and a "More filters" menu lets people add a filter for a hidden or non-column attribute (Created, Updated, Matter "Sensitive").
7. **Backend work is small and repetitive**: one "column text params" PR (the Assets precedent: `name`, `externalReference`, `matter`) for Clients, Matters, Projects, Workflows, Steps, Pods, Asset Types and Users, a few Task Queue additions (`matterText`, `clientText`, `projectText`, `updatedFrom/To`), Users server-side `availability` and `roleId[]`, and optional facet counts later.
8. **Order of delivery**: foundation, then simple server lists (Clients, Matters, Projects, Client's Matters, Matter's Assets), then the three work lists plus scoped task grids, then the admin lists and Audit, then enhancements (filter by this value, saved views, counts). Section 6.

---

## 1. What exists today (verified in the running app)

| Pattern | Where | Notes |
|---|---|---|
| **Inline column filters (the standard)** | Assets [S10] | Filters toggle at the right end of the bar above the grid, second sticky header row, text (300 ms, Enter, clear, Esc), select, URL-synced, remembered open state, empty state keeps headers + filter row. |
| Toolbar `mf-search-box` + `mf-status-filter` (Active default) in a `.pg-filters` strip | Clients [S07], Matters [S08], Projects [S09], Client's Matters [S11], Pods [S18], Task Types [S19], Workflows [S20], Steps [S21], Asset Types [S25], Users [S16] | State via `ListQueryPage` (`q`, `status`, `page`, `size`, `sort`); one search box searches several columns. |
| Filter panel + quick views + removable chips (`mf-work-filter-bar`) | Task Queue [S01-S03], My Work [S04], Pod Work [S05] | 20+ URL params shared with the API (`QueueFilters`), multi-value already supported (`status`, `priority`, `pod`, `assignee`, `creator`, `type`, `workflow`). |
| Filter form with Apply/Reset | Audit Logs [S28, S29] | Filters toggle exists, but values are not in the URL, results do not update live, no chips. |
| Own mini toolbars | Matter's Tasks [S12] ("Show: Open/All"), Matter's Assets [S14] (search + status), Swimlane [S30], Users [S16] (Status + Availability), Steps tag filter [S22] | Local component state in the matter/project tabs: not URL-synced, lost on reload. |
| Search/filters that are not column filters | Advanced search [S32], Search results [S31], Task Activity type chips, Task Comments search | See section 3. |

Findings from the run that shape the recommendation:

- **F1.** Task Queue panel clipping at 1366x768 [S02, S03]: Due to / Created from / Created to are below the capped panel's fold; the panel plus chips push the grid down to about 55% of the screen height.
- **F2.** Assets filter row at 375x812 [S35]: the filter row scrolls sideways with the 820 px table, so the Type, Matter and Status filters are off-screen. The row is not a usable mobile pattern; a sheet is needed.
- **F3.** At 1024 px wide the Assets table also overflows (main column about 800 px < `min-width: 820px`), so the "responsive" switch must be driven by grid overflow, not only by viewport width. `mf-task-table` already computes `overflowing()`.
- **F4.** Task Queue and My Work remember the last view and apply it to a bare URL (`features/task-queue/pages/task-queue-page.ts` ctor, `shared/work-queue/last-view.ts`). This is a deliberate convenience but it is a silent filter on a plain link; chips are the only cue.
- **F5.** Inconsistent state handling: Users and Task Types / Asset Types / Matter's Assets / Scoped tasks / Audit keep filter state in component signals (not shareable, lost on reload); Asset Types defaults to **All** while every other master-data list defaults to **Active**.
- **F6.** Users' Availability filter is applied in the browser after reading up to 1000 users (`FILTER_LIMIT` in `users-page.ts`); the Status select (Pending/Active/Inactive/All) filters a field that has no column in the grid.
- **F7.** Three labels for the same action: "Clear all filters" (work lists), "Clear filters" (Assets, lists), "Reset" (Audit, Advanced search).
- **F8.** `mf-tag-filter` (Steps) is already the best multi-select we own: panel, find box above 8 options, counts per option, removable chips, Match all/any, Esc returns focus. It is the base for the new multi-select, but it renders in the toolbar, not inside a scrolling grid.

---

## 2. Inventory

Legend. **Effort**: S up to 2 days, M up to a week, L more than a week (frontend + backend + tests). **Risk**: L / M / H. Control types: **text** (contains), **select**, **multi** (multi-select popover), **date** (range popover with presets), **num** (number range), **bool** (tri-state select), **user** (user multi-select with Me / Unassigned). "Server today" names existing query parameters; "needs" names backend work.

### 2.1 Work lists (task grid)

| Screen | Current controls | Proposed inline filters (column: type) | Server today / needs | Eff. | Risk |
|---|---|---|---|---|---|
| **A1 Task Queue** `/tasks` [S01-S03] **Convert** | Search box (title or ref), Filters button with a 10-control panel (Status checkboxes, Priority checkboxes, Pod, Assignee, ASAP, Overdue, Due from/to, Created from/to), 6 quick views, removable chips, Columns, sort | Ref + Title (one cell spanning both, `colspan=2`): text; Matter: text; Client: text; Project: text; Task type: multi; Workflow: multi; Priority: multi; Pod: multi + "No pod"; Assignee: user (Me, Unassigned); Creator: user; Requestor: text; Due: date + presets (Overdue, Today, Next 7 days, ASAP, Has due date); Status: multi (default All open); Created: date; Updated: date. Workflow progress, Age: none (Age is Created) | Exists: `q`, `status[]`, `priority[]`, `pod[]`, `noPod`, `assignee[]`, `unassigned`, `creator[]`, `type[]`, `workflow[]`, `requestor`, `dueFrom/To`, `asap`, `overdue`, `createdFrom/To`, `completedFrom/To`, plus id-only `client`, `matter`, `project`. Needs: `matterText`, `clientText`, `projectText` (like Assets, via `IMatterDirectory`), `updatedFrom/To` | **L** | **H** (largest surface; dashboard deep links, remembered view, e2e selectors such as `#fb-q`, `[data-filter-count]`) |
| **A2 My Work** `/my-work` [S04] **Convert** | Same bar; tabs Active / Due soon / Completed / Created by me; Assignee filter hidden (implicitly me) | As A1 minus Assignee (shown disabled as "Me" on 3 tabs, available on Created by me); Creator disabled on Created by me; Status options limited per tab (Completed tab: Completed, Cancelled); Due disabled with tooltip on Due soon (tab owns the window) | All exist. Tab = `view` (scope, stays) | M (after A1) | M |
| **A3 Pod Work** `/pods/work` [S05, S06] **Convert** | Same bar; Pod picker in the header; tabs Unassigned / By member / Overdue and on hold / All pod tasks; Pod filter hidden | As A1 minus Pod (scope = the Pod picker); Assignee disabled on the Unassigned tab; By member keeps its summary table (section 3) | All exist (`omitPod`). | M (after A1) | M |
| **A4 Matter, Tasks tab** `/matters/:id` [S12] **Convert** | "Show: Open tasks / All tasks" select | Title/Ref: text; Project: select (project list of the matter + "No project"); Priority: multi; Assignee: user; Due: date + presets; Status: multi (default Open). The "Show" select disappears (Status filter replaces it) | Exists (same Task Queue endpoint with `matter`). Component state is local: needs URL params (namespaced by the page's `tab`) | M | L |
| **A5 Project, Tasks** `/projects/:id` [S15] **Convert** | Same "Show" select | As A4 without Project | As A4 | S (after A4) | L |

### 2.2 Record lists and tabs

| Screen | Current controls | Proposed inline filters | Server today / needs | Eff. | Risk |
|---|---|---|---|---|---|
| **B1 Clients** `/clients` [S07] **Convert** | Search ("343 or Acme"), Status (Active default) | Client number: text; Name: text; Matters (count): none; Status: select (Active default) | Exists: `q` (number padded or not, or name), `isActive`. Needs `clientNumber`, `name` so each box filters only its column | S | L |
| **B2 Matters** `/matters` [S08] **Convert** | Search ("343-12, 00343-00012 or name"), Status, Client chip when `?clientId=` | Matter reference: text (typed pair, padded, or number); Name: text; Client: text (number or name; `clientId` chip stays as a removable chip); Projects: none; Status: select. "More filters": Sensitive (bool, `isSensitive` exists but the UI never used it) | Exists: `q`, `clientId`, `isActive`, `isSensitive`. Needs `matterRef`, `name`, `client` (text) | M | L |
| **B3 Projects** `/projects` [S09] **Convert** | Search (name or matter ref), Status (Archived label), Matter chip when `?matterId=` | Name: text; Matter: text (ref or name); Status: select Active / Archived / All | Exists: `q`, `matterId`, `isActive`. Needs `name`, `matter` (text) | S | L |
| **B4 Assets** `/assets` [S10] **Reference, retrofit** | Done: Name, Matter, External reference text; Type select; Status select | Retrofit onto shared parts: Type becomes multi; add chips bar, "Clear filters" label, sheet below 768 | Exists: `name`, `externalReference`, `matter`, `assetTypeId`, `isActive`. Type multi needs `assetTypeId[]` (S) | S | L |
| **B5 Client page, Matters** `/clients/:id` [S11] **Convert** | Search, Status | Matter: text; Name: text; Status: select (same as B2, Client column absent) | As B2 (with `clientId`) | S (after B2) | L |
| **B6 Matter page, Assets tab** [S14] **Convert** | Own search ("Name, type or reference") + Status, not URL-synced | Name: text; Type: select; External reference: text; Status: select. Best done by reusing the Assets grid with a fixed `matterId` (extract `mf-asset-grid`) | Exists (`matterId`, `name`, `assetTypeId`, `externalReference`, `isActive`) | S | L |
| **B7 Matter page, Projects tab** [S13] **Optional** | None (all projects of the matter, in memory) | Only when more than 25 projects: Name: text; Status: select, filtered in memory | Client-side | S | L |
| **B8 Asset details, Linked Tasks tab** **Optional / not needed** | None | Rows are few (one asset's linked tasks); skip unless a real list exceeds a page | n/a | - | - |

### 2.3 Administration

| Screen | Current controls | Proposed inline filters | Server today / needs | Eff. | Risk |
|---|---|---|---|---|---|
| **C1 Users** `/admin/users` [S16] **Convert** | Search (name, e-mail or account), Status (Pending access (N) / Active / Inactive / All), Availability (client-side), "N waiting for access" cue | Name + Windows account + E-mail (one spanning text cell "Find a person", `colspan=3`); First seen: date; Roles: multi; Availability: select; **new Status column** (badge) carrying the Status filter; the pending cue stays as a preset | Exists: `status`, `search`. Needs `roleId[]`, `availability` (server-side, removes the 1000-row client read), `registeredFrom/To` | **L** | M (pending default logic, role changes in the detail panel must refresh counts) |
| **C2 Roles** `/admin/roles` [S17] **No filters** | None (about 10 rows) | Not needed. The permission find box inside the role editor stays (it filters a matrix, not this grid) | n/a | - | - |
| **C3 Pods** `/admin/pods` [S18] **Convert** | Search, Status | Name: text; Status: select. Members (count): none | Exists `q`, `active`. Needs `name` alias (S) | S | L |
| **C4 Task Types & Forms** [S19] **Convert** | Search (name + description), Status; list is loaded whole and filtered in the browser | Name: text; Request form: select (Published / Draft / Retired / No form); Eligible workflows: multi (workflow names); Default workflow: select; Status: select. "More filters": Can't create tasks (bool, from `usabilityIssues`) | All local (no backend) | S-M | L |
| **C5 Workflows** `/admin/workflows` [S20] **Convert** | Search (name/description), Status | Name: text; Latest published: select (Published / Not published); Draft: select (Has draft / None); Status: select | Exists `q`, `isActive`. Needs `hasPublished`, `hasDraft`, `name` | M | L |
| **C6 Workflow Steps** `/admin/steps` [S21, S22] **Convert** | Search (title, description or tag), Status, Tags popover with Match all/any | Title: text; Description: text; Tags: multi (the existing tag filter, with counts and Match all/any in the popover footer); Used in workflows: select (Used / Not used); Status: select | Exists `q`, `tags[]`, `tagMatch`, `isActive`, tag counts (`listStepTags`). Needs `title`, `description`, `used` | M | M (moves the best existing control into a scrolling grid: popover clipping) |
| **C7 Labels: Priorities** [S23] **No filters** | None; ordered list with drag and arrow reorder | Filtering an ordered list conflicts with reorder; about 5 rows | n/a | - | - |
| **C8 Labels: Status labels** [S24] **No filters** | None; 5 fixed rows | Not needed | n/a | - | - |
| **C9 Asset Types** [S25] **Convert** | Search + Status (default All, not in URL, capped at 100 rows, no pager) | Name: text; Status: select (default Active, align with others); Fields / Assets counts: none. Also move state into the URL and add a pager | Exists `q`, `isActive`, `page`, `pageSize`. Needs `name` | S | L |
| **C10 Asset link roles** [S26] **No filters** | None (few rows) | Not needed | n/a | - | - |
| **C11 Custom Fields** [S27] **No filters** | None (fixed list of objects with a form each) | Not needed | n/a | - | - |
| **C12 Audit Logs** `/admin/audit` [S28, S29] **Convert** | Filters toggle + a 6-field form (Object type, Object id, Actor typeahead, Event type, From, To, Search summary or field), Apply / Reset, "Group events of one operation" | When: date + presets (Today, Last 24 hours, Last 7 days, Last 30 days); Who: user (Actor, typeahead; numeric id without `User.View`); What happened: select (Event type) + text (summary or field) stacked; Object: select (Object type) + text (Object id, enabled after a type). `correlationId` stays a banner/chip ("Showing the events of one operation"). Group toggle stays in the toolbar | Exists: `objectType`, `objectId`, `actor`, `eventType`, `from`, `to`, `q`, `correlationId`, `cursor`. Needs nothing; add URL sync. Optional multi `eventType[]` later | M-L | M (grouped/expandable rows, cursor paging, heavy `q`) |

### 2.4 Other surfaces with search or filtering that are not column filters

| Screen | Verdict | Reason (details in section 3) |
|---|---|---|
| **D1 Search results** `/search` [S31] | Keep | One query across 4 object types, grouped in short sections (10 + Show more). Per-section column filters would be overkill. |
| **D2 Advanced search** `/search/advanced` [S32] | Keep as a form, converge later | A query builder across types; its filters duplicate the lists' filters. Long term it should become "Open in <list> with these filters" deep links. |
| **D3 Dashboard, Swimlane toolbar** [S30] | Keep, restyle | A board of cards, not a grid: Pod, Assignee, Type, Priority, Overdue are card attributes. Keep the toolbar panel; reuse chips and the `ListFilters` helper. |
| **D4 Dashboard Summary / Breakdowns tables, period selector** | Keep | Drill-down links to the Task Queue; the period applies to Created/Completed figures. |
| **D5 Pod Work, By member table** [S06] | Keep | A workload summary (Open / Overdue / On Hold) with "Show tasks" toggles that set the Assignee filter: an existing "filter by value" precedent. |
| **D6 Task page, Activity type chips** | Keep | A feed with a segmented filter, not a grid. |
| **D7 Task page, Comments search** | Keep | Text search over a thread. |
| **D8 Task page, Linked assets table** | Keep | Handful of rows per task. |
| **D9 Workflow editor, step picker (search + tag filter)** | Keep | A picker panel; it will share the new multi-select. |
| **D10 Role editor, permission find box** | Keep | Filters a matrix. |
| **D11 Pickers (entity, asset, user) and the global header search** | Keep | Typeaheads. |

### 2.5 Tally

| | Count |
|---|---|
| Surfaces reviewed | 36 (5 work lists, 8 record lists/tabs, 12 admin lists, 11 other) |
| Convert to inline column filters | **18** (17 new + Assets retrofit): A1-A5, B1-B3, B4, B5, B6, C1, C3, C4, C5, C6, C9, C12 |
| Optional, in memory, only when long | 2 (B7, B8) |
| Too small / ordered config (no filters) | 5 (C2, C7, C8, C10, C11) |
| Keep a toolbar or form control | 11 (D1-D11) |
| New backend work | 4 PRs (section 6) |
| Effort split of the 18 | L: 3 (A1, C1, C12 at M-L), M: 7, S: 8 |

---

## 3. Where inline column filters are NOT appropriate, and what stays in the toolbar

| Control | Stays where | Why it is not a column filter |
|---|---|---|
| **Quick views** (Task Queue: All open, Unassigned, My pod, Created by me, Overdue, Recently completed) | Segmented control above the grid, but **as presets** | They are named combinations of filters. Clicking one writes the column filters (visible in the row and in chips); a manual change un-presses it (today's `activeBuiltIn`). They give one-click access that a filter row cannot (6 columns at once). |
| **Tabs** (My Work, Pod Work, Dashboard, Users/Roles, Workflows/Steps, Matter tabs) | Tabs | A tab chooses a scope or another table, not a refinement of one. Server `view` stays. Filters persist across tabs except where the tab owns a column (shown as disabled with a reason). |
| **"Mine" / "Only mine" / "Created by me"** | Preset or toggle | A relationship to the viewer, not a value of a column. As a preset it sets Assignee = Me (Task lists). On the Swimlane it stays a toggle. |
| **Period selectors and time windows** (Dashboard period, Swimlane "Done in the last", My Work "Completed 90 days", "Show older") | Toolbar select / inline help text | They define the data set of a widget or tab; the Closed date filter exists separately as a column filter on Completed views. |
| **Sort, Group by, Density, Columns, Refresh, Expand/Collapse all, Pod picker** | Toolbar | Display controls. The Pod picker of Pod Work is a **scope** (the whole page is "this Pod's work"), so Pod is not a filter column there. |
| **Search across record types** (header search, Search results, Advanced search) | As is | Cross-entity. |
| **Swimlane Pod / Assignee / Type / Priority / Overdue** | Toolbar panel | Board cards have no columns. Keep, but share chips, "Clear filters" wording and the state helper. |
| **Pod Work By member table, Dashboard breakdown tables** | None | Summaries with drill-down links; filtering would hide totals. |
| **Priorities, Status labels, Roles, Link roles, Custom Fields** | None | Tiny or ordered configuration lists. |
| **Audit: Group events of one operation, correlation id** | Toolbar toggle / banner | A display mode and a drill-down, not a column value. |

**Rule of thumb for any new list:** offer inline filters when the grid can exceed one page (about 25 rows) **and** has two or more filterable columns. Below that, no filter row (and no Filters button). Lists that are ordered by hand never get one.

---

## 4. The pattern standard (extends Assets)

### 4.1 Anatomy

```
[ Presets / quick views ]  [ chips summary (when row closed) ............ ] Clear filters   Sorted by Due ↑   [⛉ Filters (3)] [Columns]     <- .mf-gridbar, one row
┌ Ref ⇅ ┬ Title ⇅ ┬ Matter ┬ Priority ⇅ ┬ Assignee ⛉ ┬ Due ⇅ ┬ Status ⇅ ┐                                                              <- header row (sort), sticky, 40 px
│[Filter  spanning] │[Filter]│[All ▾]     │[Me ▾]      │[Any ▾]│[Open ▾] │                                                              <- filter row, sticky under it, 40 px
├ rows ...                                                                                                                              <- body; empty state keeps both rows
└ pager (pinned)
```

- **Gridbar** (extends the existing `.as-bar` / `.wl-gridbar`): left, optional presets; middle, the chip summary; right, **Clear filters** (only while something other than the default is active), "Sorted by", **Filters** toggle, Columns (work lists), More filters (when applicable). The Filters button keeps today's contract: filter icon, name, `(n)` of active non-default filters, `aria-pressed` + `aria-expanded` + `aria-controls`, tooltip Show/Hide filters.
- **Header row**: unchanged (sort button with `aria-sort`). A funnel icon appears in a header **only while that column has an active filter**; it is a button that opens the row (or sheet) and focuses that control. No funnel on idle headers (keeps headers clean, avoids a second way to filter).
- **Filter row**: `<tr class="mf-filter-row" aria-label="Column filters">`, one `<td>` per visible column, 32 px controls in a 40 px row (compact density: 28 px controls in a 36 px row, never below the WCAG 2.2 24 px target). A cell may **span the columns it searches** (`colspan`), labelled "Filter by Title or Ref" (Task lists) or "Find a person" (Users). Columns without a filter get an empty `<td>`.
- **One definition drives everything.** Each page declares `FilterDef[]`:
  `{ key, label, type: 'text'|'select'|'multi'|'date'|'num'|'bool'|'user', param(s), options|loader, default?, span?, hiddenInSheet?, disabledBy? }`.
  The row, the sheet, the chips, the active count, the URL read/write and the API arguments are all generated from it. This is the same idea as `mf-filter-bar` / `mf-filter-drawer` / `mf-filter-chip` already listed in `docs/ux/ux-spec.md` (component table), which was built differently for the work lists and never generalised.

### 4.2 Controls by type

| Type | Control (in the 40 px cell) | Behaviour |
|---|---|---|
| **text** | Exactly today's `mf-column-text-filter` | Live after 300 ms, Enter applies at once, blur flushes, x clears, **Esc clears a filled box**, trimmed, max 200, placeholder "Filter". Matching is **contains**, case/accent by database collation. Reference columns normalise (`343-12`, `00343-00012`). |
| **select** | Native `<select>` (today's `mf-column-select-filter`) | First option is "All <things>" (the no-filter choice); a column with a default (Status) lists the default first, e.g. "Active", and a default is not counted. Applies on change. Used when the value set is small and single-choice (Status Active/Inactive/All, Request form, Used/Not used). |
| **multi** | A button that reads "All", the single value, or "3 selected" (a label plus count, never colour alone), opening a fixed-position popover | Popover = today's `mf-tag-filter` panel: checkbox group, find box above 8 options, **counts per option where the API provides them**, special values on top ("Me", "Unassigned", "No pod", "No project"), "Clear" and "Done". Applies on close or 400 ms after the last tick (not per tick). Chips (section 4.5) show each chosen value. Esc closes and returns focus to the button. Popover is **fixed-positioned from the trigger** (as `mf-inline-menu` already does) because `.mf-scroll-area` is an `overflow: auto` container that would clip an absolute panel. |
| **user** | Same as multi, options from the user lookup; server typeahead above 50 users | "Me" and "Unassigned" first; inactive people stay selectable and marked "(inactive)" (ux-spec: they remain in historical filters). Audit's Actor is a single-choice variant. |
| **date** | A button "Any date" / "Oct 1 to Oct 16" opening a popover: **From** and **To** `mf-date-input` (`commitOnly`, `mm/dd/yyyy`, invalid text kept and reported, as today), plus a **presets list** (Today, Last 7 days, Last 30 days, This month, Next 7 days, Overdue, No due date where relevant). A preset fills the two dates (ISO `yyyy-MM-dd` in the viewer's zone); the URL keeps absolute dates. | From after To shows an inline error and does not apply. Either side may be empty (open range). Clear inside the popover. Today `mf-date-input` has no presets: they are a new part of the popover, not of the input. |
| **num** | Two compact numeric inputs "Min" and "Max" in a popover (or inline when the column is at least 160 px) | Live after 300 ms, integers, `mf-number-input`. Used sparingly (nothing needs it in v1; first candidates are Pod members, Matters per client, Age). |
| **bool** | Tri-state `<select>`: Any / Yes / No with domain wording ("Overdue only", "Not overdue") | Applies on change. In the Due column the booleans `overdue` and `asap` are presets of the date control, not separate cells. |

**Operators.** Default **contains**; no per-column operator menu in v1. Reasons: (1) every list backend is a `LIKE %x%` (EF `Contains`), so extra operators are backend work for each endpoint; (2) the row is 32 px high and an operator control per cell doubles its width; (3) a11y cost: a combobox per cell multiplies tab stops; (4) number and date already have explicit range controls, and `select` values carry their own "none" options (No pod, Unassigned, No project, No due date), which cover "is empty". Revisit if three independent requests ask for "does not contain", "starts with" or "exactly" (the likely first case is exact ticket/reference lookup, which the smart reference matching already handles). If added, it is one small `…` button inside the cell opening a menu of 3 operators, defaulting to contains, kept in the URL as `<param>.op=`.

### 4.3 Header click: sort or filter?

Header click **sorts** (unchanged, `aria-sort`, "Sorted by" note). It never opens a filter. Filtering has three entry points: the filter row, the funnel indicator on an already-filtered column, and the sheet. A funnel on every header as an alternative was considered and **not recommended**: it adds a tab stop and an icon per header, competes with the sort icon in 100-120 px columns, and makes two UIs to test. The responsive problem it would solve (narrow screens) is solved better by the sheet (4.9).

### 4.4 Quick views, tabs and filters

- **Quick views become presets.** `BUILT_IN_VIEWS` / `builtInFilters` keep their definitions. Clicking a view **replaces** all column filters with the preset (today's behaviour), the controls show the values (Status shows "Open (3)" etc.), and the view stays pressed only while the filters equal it exactly (`activeBuiltIn`). Add a "Custom" state: when no view matches and filters are active, nothing is pressed and the chips say what is set. "Recently completed" stores an absolute date computed at click time (as now).
- **Tabs are scopes.** Switching tab keeps column filters except those the tab owns. Owned columns render disabled with a reason ("Set by the Due soon tab") and a non-removable scope note under the tabs (the existing `wp-help` text). Tab counts continue to follow the filters (already true).
- **Pod Work tabs** keep resetting Assignee on a tab change (today's rule), now visible because Assignee is a column control.

### 4.5 Chips and "Clear filters"

- **Chips** (one per active value, as in `buildChips`) live in the gridbar, **one line, "+N more" overflow** (the existing panel allows a 5.5 rem box; a single line costs less height). They show **when the filter row is closed**; when it is open, the cells show the values and only "Clear filters" remains, so we do not spend 30 px twice. Below 768 px chips always show above the grid. Each chip: "Priority: Critical" with a remove button `aria-label="Remove filter Priority: Critical"`.
- **Clear filters** resets to the screen's **defaults** (Status Active, Open for tasks), not to nothing, and is shown only while something differs from the default. One label everywhere ("Clear filters"), replacing "Clear all filters" and "Reset" (F7). The empty state offers the same button, and says what the default hides ("Status is limited to Active. Show all statuses").
- **Printing**: the filter row, toggle and chips are hidden in print; a one-line text "Filters: Status Open, Priority Critical" is printed above the grid so a filtered printout says it is filtered.

### 4.6 Persistence rules

1. **The URL is the single source of truth**: every filter, `sort`, `dir`, `page`, `size`. Parameter names are the API's where one exists (`status`, `priority`, `dueFrom`...), lower camel case, repeated for multi-values, `<name>From/<name>To` for ranges, the column key for text. This keeps dashboard deep links (`/tasks?overdue=true&status=NEW&status=IN_PROGRESS`) and Advanced-search links valid.
2. **Any filter change resets `page` to 1** and keeps the sort. History: committed changes push a history entry; debounced typing uses `replaceUrl` so Back is not flooded.
3. **A plain link never filters silently.** Defaults are visible in their cell and not counted. A deep link that carries filters opens the row (Assets already does). Remembered state is limited to **UI state** (filter row open, column set, density, Pod) and, for Task Queue and My Work only, the last view; restoring it shows a polite notice and a chip bar ("Restored your last view. Reset to default"), and `Clear filters` removes it. Record lists (Clients, Matters...) remember nothing but the open state.
4. **Row open/closed** is remembered per user per screen in `localStorage` (`mf.<screen>.filters.open`, try/catch, as now). Suggested first-visit default: open on Task Queue, My Work and Pod Work; closed elsewhere (open question Q1).
5. **Stale values** (an id that no longer exists, an inactive pod) produce a chip "Pod #42 (removed)" with a remove button, never an error and never a silently ignored parameter.
6. **No filter state in `localStorage` for lists** except as in point 3; saved views (section 5) are the mechanism for anyone who wants it.

### 4.7 Hidden columns (decision)

The column chooser (Task Queue, My Work, Pod Work) can hide columns. **Decision: a filter on a hidden column stays active**, because silently dropping it would change the result without telling the user, and applying it silently is the opposite problem. It is therefore always shown as a chip, with a "(hidden column)" suffix and a "Show column" action. The filter **row** shows only visible columns. A **More filters** button in the gridbar (next to Filters) opens a small menu listing the filterable-but-hidden columns (Created, Updated, Creator, Requestor, Workflow, Task type, Project, Client by default on Task Queue) and non-column attributes (Matter "Sensitive", Users "Can't create tasks"); choosing one opens that control in a popover and adds the chip. In the sheet (below 768 px) every filter is listed regardless of visibility. The column chooser itself does not change.

### 4.8 Sticky behaviour, density, popovers

- Both header rows stick together inside `.mf-scroll-area` (`--mf-head-h`, existing CSS). Sticky area is 80 px (about 10% of a 768 px screen); in compact density 72 px. `z-index` stays: first column 4, filter row 3, headers 2.
- Popovers are fixed-positioned and flip upward near the bottom edge; they close on scroll of the grid (as `mf-inline-menu` does) and on outside click; they never sit inside the scroll area DOM.
- The filter row and header are outside the `@for` of rows, so typing never loses focus on reload. While loading, rows dim (`aria-busy`), the controls stay enabled, and a newer request supersedes older ones (the `requestId` guard in `ServerListPage` / `QueuePageBase`).
- Tables use `table-layout: fixed` with `min-width` so that controls do not collapse; a column narrower than 96 px shows an icon-only multi/date button with a tooltip.

### 4.9 Responsive: sheet below 768 px

- Switch rule: viewport below 768 px **or** the grid overflows sideways (`overflowing()` already exists in `mf-task-table`; Assets overflows at 1024 px, F3). In that mode the filter row is not rendered; the **Filters** button opens a **bottom sheet** (`role="dialog"`, labelled "Filters", focus trapped, Esc and a Close button, returns focus to the button).
- The sheet renders the **same `FilterDef[]`** stacked: label above control, 44 px targets, multi/date inline as expanded groups instead of popovers (no nested overlays), presets as radio chips. Changes apply live; the sticky footer button reads "Show 42 results" (it closes the sheet) with "Clear filters" beside it. No Apply/Cancel pair.
- Chips stay on the page above the grid at this width so the filtered state is always visible.
- Table cards are out of scope; the grid keeps scrolling sideways.

### 4.10 Keyboard and screen readers

- Names: every control "Filter by <column>" (as built); a spanning cell "Filter by Title or Ref"; clear buttons "Clear <column> filter"; multi/date buttons announce state ("Filter by Status, 2 selected, button, expanded/collapsed").
- Roles: the filter row `aria-label="Column filters"`; popovers `role="dialog"` with `aria-label="Filter by <column>"`; the option group is a checkbox group (not an ARIA listbox) for reliable screen reader support, as `mf-tag-filter` does.
- Focus order follows DOM: gridbar, header buttons, filter row left to right, rows. `/` (today only on Task Queue) opens the row if closed and focuses the first text filter on every screen that has one. Esc clears a filled box, closes a popover, or closes the sheet (nearest wins, like the Assets Esc rule). Enter applies a text/date value immediately.
- **Live region** (one per grid, polite): after a load triggered by a filter, "Filtered by Status and Priority. Showing 1-25 of 38" or "No tasks match these filters"; on clear, "Filters cleared. Showing 1-50 of 312". Never announce per keystroke or while loading.
- Contrast and non-colour cues: active filter = border + count + icon, not colour alone; the funnel indicator has an accessible name "Filtered".
- Add axe (wcag2a/aa, 2.1/2.2 AA) runs for each converted screen in the three states used for Assets (hidden, shown, active) at 1366x768 and 375x812, as `assets-screen` did.

### 4.11 Performance, empty and error states

- **Debounce**: text 300 ms (Audit `q` 500 ms), select/bool immediate, multi on close or 400 ms idle, date on valid commit. In-flight requests are superseded (keep the `requestId` guard); never block typing.
- **Rate limit**: the API budget is 1200 requests per minute per user (`ApiRateLimiting`, `ApiPerMinute`). A filter row with 300 ms debounce is far inside it, but the multi-select must not fire per tick (hence commit on close).
- **Server-side everywhere that is paged**; in-memory only for lists loaded whole (Task Types, Matter's Projects), with a 150 ms debounce.
- **Empty**: headers and filter row stay; the body says "No <noun> match these filters." with **Clear filters** and the default hint. **No data at all** (no filters active) keeps the create action. **Error**: inline alert with Retry above the rows, previous rows kept, filter row stays usable; changing a filter retries.
- **Large result sets**: page size stays 25/50/100; no "select all matching".

---

## 5. Additional recommendations

1. **Filter by this value** (click a Pod, Assignee, Priority, Type, Client or Matter in a cell to add it as a filter). In the task grids Status, Priority and Assignee cells are inline editors, so a cell click cannot filter. Recommendation: (a) in non-editable cells (Matter, Client, Project, Task type, Pod, Creator) a small funnel icon button appears on row hover and keyboard focus within the cell ("Filter by Pod: Review team"); (b) in the existing `mf-inline-menu` of Assignee, Status and Priority add a last item "Filter list by this value". The Pod Work By member "Show tasks" button is the existing precedent. Priority P3 (Batch 5).
2. **No all-columns search box next to the filter row.** It duplicates the Title column filter and is ambiguous about what it searches. Exceptions are the spanning cells that already represent a multi-column lookup ("Find a person" on Users; "Title or Ref" on tasks). The global header search (Ctrl+K) covers cross-entity.
3. **Multi-select for Status where there are more than three states** (Tasks, Users): yes. Binary active/inactive lists keep a three-option select (Active / Inactive / All).
4. **Counts per option**: valuable where the API can facet cheaply (Steps tags exist today; tab counts exist on My Work and Pod Work). A facets endpoint that returns counts **excluding the column's own filter** (the standard faceting rule) for Task Queue Status, Priority, Pod and Type, and Audit Event type, is backend M. Priority P3. Until then show counts only where already available.
5. **Filtering computed columns**: Due and Overdue become date presets (Overdue, Today, Next 7 days, ASAP, Has due date). Workflow progress ("2/5") is not filtered in v1 (it needs a definition: stage? percentage?), Age is covered by the Created date range, "Used in workflows" is a Used / Not used select, counts of matters/projects/members are not filtered until requested.
6. **Saved filter views.** Since the URL is the source of truth, a saved view is a name plus a stored query string: cheap. Offer "Save current filters as view" in the Filters menu on Task Queue first, per user (localStorage first, then a small table). Relative dates ("Next 7 days") need token support in saved views (`dueFrom=@today`, `dueTo=@today+7`), which is one more reason the date presets should be parseable tokens in the helper even if the URL stays absolute. Shared team views (a Pod Lead publishes "Pod triage") is a later step and a product decision. Priority P3.
7. **Align the vocabulary**: "Clear filters" everywhere; "Filters (n)" on the toggle; "No <noun> match these filters"; Status default wording "Active" (Projects "Archived" stays as the inactive label).
8. **Standardise the default Status**: Active on every master-data list including Asset Types (today All, F5).
9. **Move the remaining local-state lists into the URL** (Matter's Tasks/Assets, Project's Tasks, Asset Types, Task Types, Users' availability, Audit): shareable links, Back works, and "Open in Task Queue" from a matter keeps the same filters.
10. **Make `Matter`/`Client`/`Project` columns in the Task Queue text filters** (users type `343-12` or "Acme") rather than record pickers; the existing id params stay for links and show as removable chips with the record name.
11. **Dashboard drill-downs** keep landing on the Task Queue with the same params; after conversion they land with the row open and the matching controls set, which also fixes the "why do I see only these?" question.

---

## 6. Batch plan

Sizing is for one frontend dev plus one backend dev; each item is a shippable PR with tests (Vitest, axe, e2e where the screen has one).

### Batch 0: decisions and spike (3 days)

| # | Suggested issue title | Notes |
|---|---|---|
| 0.1 | Column filters: confirm design decisions and answer product-owner questions (Q1-Q14 in docs/ux/column-filters-review.md) | Blocks nothing but 1.x scope |
| 0.2 | Spike: fixed-position popover inside `.mf-scroll-area` (multi, date) with flip, scroll close and focus return | De-risks Batch 1; base on `mf-inline-menu` |

### Batch 1: foundation (1.5 to 2 weeks), builds the shared parts once

| # | Suggested issue title | Delivers |
|---|---|---|
| 1.1 | Add `FilterDef` and `ListFilters` URL/state helper (parse, serialize, defaults, counts, chips, API args) with adapters for `ListQueryPage` and `QueueFilters` | One implementation of "URL is the source of truth"; unit-tested against today's dashboard deep links |
| 1.2 | Add `mf-column-filter-row` and `mf-filters-bar` (toggle, Clear filters, More filters, live region, remembered open state) | Generalises Assets; spanning cells; disabled-by-scope; hidden columns |
| 1.3 | Add `mf-filter-chips` (compact, overflow, removable, a11y labels, print line) | Replaces `fb-chips` and the Matter/Project chips |
| 1.4 | Add `mf-column-multiselect-filter` and `mf-column-user-filter` (popover, find box, counts, special values, chips) | Extracted from `mf-tag-filter`; Steps adopts it in 4.x |
| 1.5 | Add `mf-column-date-range-filter` (two `mf-date-input` + presets) and `mf-column-number-range-filter`, tri-state bool | New controls; presets library (week starts Monday as on the Dashboard) |
| 1.6 | Add `mf-filter-sheet` for below 768 px or overflowing grids (same `FilterDef[]`, live apply, "Show N results") | Fixes F2/F3 |
| 1.7 | Retrofit Assets onto the shared parts; Type becomes multi; chips; sheet; keep every Assets test green | Proves the foundation on the reference screen |

### Batch 2: simple server lists (about 1.5 weeks)

| # | Suggested issue title | Backend |
|---|---|---|
| 2.0 | API: column text params for list endpoints (`clientNumber`, `name`; `matterRef`, `name`, `client`; `name`, `matter`; Pods/Asset Types `name`; `assetTypeId[]`) following the Assets precedent (`Contains`, parameterised, directory lookup for cross-module text) | one PR + integration tests |
| 2.1 | Clients list: inline column filters | uses 2.0 |
| 2.2 | Matters list: inline column filters incl. Client text and Sensitive in More filters | uses 2.0 |
| 2.3 | Projects list: inline column filters | uses 2.0 |
| 2.4 | Client page, Matters: inline column filters (shares 2.2 grid) | |
| 2.5 | Matter page, Assets tab: reuse the Assets grid with a fixed matter and URL-synced filters | |

### Batch 3: work lists (2.5 to 3 weeks), the highest value and risk

| # | Suggested issue title | Notes |
|---|---|---|
| 3.0 | API: Task Queue / My Work / Pod Work `matterText`, `clientText`, `projectText`, `updatedFrom/To` | `TaskQueueQuery.FilterKeys` + contract + generated client |
| 3.1 | Task Queue: replace the Filters panel with inline column filters; quick views become presets; restored-view notice | Removes `mf-work-filter-bar` panel; keeps `fb-q` shortcut working (`/`); update e2e selectors |
| 3.2 | My Work: column filters with tab-owned constraints | after 3.1 |
| 3.3 | Pod Work: column filters; By member "Show tasks" sets the Assignee filter control | after 3.1 |
| 3.4 | Matter page Tasks and Project page Tasks: column filters (URL-synced, replace "Show" select) | after 3.1 |
| 3.5 | Task grids: filters for hidden columns (chips + More filters) | part of 3.1, split if large |

### Batch 4: administration (2 to 2.5 weeks)

| # | Suggested issue title | Backend |
|---|---|---|
| 4.1 | Pods and Asset Types: inline filters (Asset Types default Active, URL state, pager) | 2.0 |
| 4.2 | Task Types: inline filters (in memory) incl. Can't create tasks | none |
| 4.3 | Workflows: inline filters incl. Versions (built as one select over hasPublished and hasDraft) | `hasPublished`, `hasDraft`, `name` |
| 4.4 | Workflow Steps: inline filters; Tags column uses the multi-select with counts and Match all/any | `title`, `description`, `used` |
| 4.5 | Users: inline filters, new Status column, server-side Availability and Roles | `roleId[]`, `availability`, `registeredFrom/To` |
| 4.6 | Audit Logs: inline column filters, URL state, live apply, presets on When | none (optional multi event type) |

### Batch 5: enhancements (as capacity allows)

| # | Suggested issue title |
|---|---|
| 5.1 | "Filter by this value" from cells and from the inline menus (Pod, Assignee, Priority, Status, Type, Client, Matter) |
| 5.2 | Saved filter views on the Task Queue (per user), with relative date tokens |
| 5.3 | Facet counts per option (Task Queue Status/Priority/Pod/Type, Audit Event type) |
| 5.4 | Swimlane toolbar: adopt `mf-filter-chips` and the shared state helper |
| 5.5 | Advanced search: replace per-type filters with "Open in list with these filters" links |
| 5.6 | Funnel indicator in headers for filtered columns |

### Dependencies and order

`0.2` → `1.4/1.5` → `1.2/1.3/1.6` → `1.7` → `2.x` and `3.x` in parallel (backend 2.0 and 3.0 first) → `4.x` → `5.x`. Batch 1 must not start the Task Queue work until 1.1 is green against the dashboard link tests. 2.0 and 3.0 can ship ahead of the UI with no visible change.

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| Two URL-state implementations (`ListQueryPage`, `QueueFilters`) drift | 1.1 gives both an adapter; migrate lists one at a time, no big bang |
| Popover clipped by `.mf-scroll-area` or lost on scroll | Spike 0.2 first; fixed-position popover with scroll-close (precedent in `mf-inline-menu`) |
| Dashboard and Advanced-search deep links break | Param names unchanged; a link-contract unit test per generated link in `dashboard-links.ts`, `search-meta.ts`, `audit-links.ts` |
| e2e and unit tests rely on `#fb-q`, `[data-filter-count]`, `.fb-panel`, `data-status-filter` | Keep `data-filters-toggle`, `data-filter-count`, `data-filter="<key>"` and the `/` shortcut contract; update specs in the same PRs |
| Sticky 80 px header on small laptops | Remembered open state; compact density; sheet when the grid overflows |
| Audit queries are heavy; live apply may load the database | 500 ms text debounce, explicit Enter, selects live; measure before enabling live text |
| Users page default (Pending when someone waits) conflicts with a Status column filter default | Keep the same default logic, express it as the Status control's default and show the cue |
| Backend text params drift from the "column only" rule | One shared helper and one integration test pattern (as `Column_filters_match_one_column_each_literally_and_combine`) |
| Scope creep from operators, saved views, counts | They are separate Batch 5 items with explicit evidence thresholds |

---

## 7. Open questions for the product owner

1. **Default open state.** Should the filter row start open on Task Queue, My Work and Pod Work (recommended) and closed on every other screen, or closed everywhere until first used?
2. **Quick search.** OK to remove the "Search title or ref" box from the three work lists in favour of the Title/Ref column filter (with `/` still jumping to it)?
3. **Quick views.** Keep all six on the Task Queue? Should My Work and Pod Work get presets too (for example "Due this week")?
4. **Remembered last view.** Keep restoring the last Task Queue / My Work view on a plain link (with a visible notice), or always open on the default?
5. **Default status.** Confirm "Active" as the default on every master-data list, including Asset Types (today All).
6. **Hidden columns.** Confirm that a filter on a hidden column stays active and visible as a chip (recommended) rather than being dropped when the column is hidden.
7. **Matter / Client / Project in task lists.** Text contains (recommended) or pick a specific record from a list? Both can coexist if the id params stay for links.
8. **Users.** Is a Roles column filter (new backend) and a Status column worth it now? Is server-side Availability a must (today up to 1000 users are read in the browser)?
9. **Audit.** Live apply with debounce, or keep an explicit Apply? Is it acceptable that Audit filters appear in the URL (shareable links to filtered audit views; permissions are unchanged)?
10. **Saved views.** Wanted? Per user only, or shared by Pod Leads and Directors? Is "Created by me" / "My pod" style enough for now?
11. **Advanced search.** Retire its per-type filters later in favour of links into the lists?
12. **Operators.** Is there a real need for "does not contain", "starts with" or exact match? (Default answer: no.)
13. **Dates.** Weeks start on Monday (as the Dashboard) and all presets use the viewer's time zone: correct? Any "business days" need?
14. **Counts per option.** Worth a facets endpoint for task Status/Priority/Pod/Type, or are tab counts enough?
15. **Printing.** Should a filtered grid print with a "Filters: ..." line (recommended) or without?
16. **Priority order.** Is the Task Queue (Batch 3) the real first target, in which case Batch 2 can be reduced to the foundation retrofit on Assets plus Clients and Matters only?

---

## Appendix A. Server filter parameters today (from the generated client)

| Endpoint | Filter parameters |
|---|---|
| `getTaskQueue`, `getMyWork(view)`, `getPodWork(podId, view)` | `q`, `status[]`, `priority[]`, `pod[]`, `noPod`, `assignee[]`, `unassigned`, `creator[]`, `client`, `matter`, `project` (ids), `type[]`, `workflow[]`, `createdFrom/To`, `dueFrom/To`, `asap`, `overdue`, `requestor`, `completedFrom/To`, `sort`, `dir`, `page`, `pageSize` (max 100) |
| `listAssets` | `matterId`, `assetTypeId`, `isActive`, `q`, `name`, `externalReference`, `matter`, `page`, `pageSize`, `sort` |
| `listClients` | `q`, `isActive`, `page`, `pageSize`, `sort` |
| `listMatters` | `q`, `clientId`, `isActive`, `isSensitive`, `page`, `pageSize`, `sort` |
| `listProjects` | `q`, `matterId`, `isActive`, `page`, `pageSize`, `sort` |
| `listPods` | `q`, `active`, `page`, `pageSize`, `sort` |
| `listAssetTypes` | `q`, `isActive`, `page`, `pageSize`, `sort` |
| `listWorkflows` | `sort`, `q`, `isActive`, `page`, `pageSize` |
| `listStepDefinitions` | `sort`, `q`, `tags[]`, `tagMatch`, `isActive`, `page`, `pageSize`; `listStepTags` gives counts |
| `listUsers` | `status`, `search`, `page`, `pageSize` (availability filtered in the browser) |
| `searchAuditEvents` | `objectType`, `objectId`, `actor`, `eventType`, `from`, `to`, `q`, `correlationId`, `cursor`, `pageSize` |
| `advancedSearch` | `type`, `q`, `client`, `matter`, `project`, `assetType`, `active`, `sensitive`, `status[]`, `requestor`, `page`, `pageSize` |
| Task Types, Priorities, Status labels, Link roles | no server filters (`listTaskTypes()` returns all; filtering is local) |

## Appendix B. Files that carry the current behaviour

- Pattern to extend: `frontend/src/app/shared/ui/column-filters.ts`, `frontend/src/styles/_fixed-page.scss` (`.mf-filter-row`, `--mf-head-h`), `frontend/src/app/features/assets/pages/assets-list-page.ts`.
- Work-list filtering: `shared/work-queue/work-filter-bar.ts` (+ `.scss`), `queue-filters.ts` (`QueueFilters`, `buildChips`, `BUILT_IN_VIEWS`, `queueArgs`), `queue-page.ts`, `work-tabs.ts`, `work-view-controls.ts`, `column-prefs.ts` (`WORK_COLUMNS`), `last-view.ts`, `task-table.ts`, `scoped-tasks.ts`, `inline-menu.ts` (fixed-position popover precedent).
- Record and admin lists: `shared/ui/list-query.ts` (`ListQueryPage`, `ServerListPage`, `LocalListPage`), `data-table.ts` (`StatusFilter`, `SortHeader`, `ListState`), `search-box.ts` (`SEARCH_DEBOUNCE_MS`), `tag-filter.ts`, `matter-assets.ts`, and the pages under `features/{clients,matters,projects,assets}/pages`, `features/admin/{users,roles,pods,task-types,workflows,steps,asset-types,audit,priorities,status-labels,asset-link-roles,custom-fields}`.
- Not column-shaped: `features/dashboard/swimlane/swimlane-toolbar.ts`, `features/search/*`, `features/tasks/panels/task-activity.ts`, `task-comments.ts`.

## Appendix C. Screenshot index (1366x768 unless noted)

All files are in `docs/ux/column-filters-review/screenshots/`. They show the **current** UI on `dev` (seeded data), not a mock-up.

| ID | File | What it shows |
|---|---|---|
| S01 | `01-task-queue.png` | Task Queue: search, Filters, six quick views |
| S02 | `02-task-queue-filters-open.png` | Filters panel open; Created dates below the capped panel (F1) |
| S03 | `03-task-queue-chips.png` | Four filters set, chips row, empty state |
| S04 | `04-my-work.png` | My Work with tabs, search, Filters |
| S05 | `05-pod-work.png` | Pod Work: Pod picker, summary, tabs, search, Filters |
| S06 | `06-pod-work-by-member.png` | Pod Work, By member table |
| S07 | `07-clients.png` | Clients: search + Status |
| S08 | `08-matters.png` | Matters: search + Status |
| S09 | `09-projects.png` | Projects: search + Status |
| S10 | `10-assets-inline-filters-reference.png` | Assets with the inline filter row (the standard) |
| S11 | `11-client-matters.png` | Client page, Matters |
| S12 | `12-matter-tasks.png` | Matter page, Tasks, "Show" select |
| S13 | `13-matter-projects.png` | Matter page, Projects tab |
| S14 | `14-matter-assets.png` | Matter page, Assets tab with its own search and Status |
| S15 | `15-project-tasks.png` | Project page, Tasks |
| S16 | `16-admin-users.png` | Users: search, Status, Availability |
| S17 | `17-admin-roles.png` | Roles list |
| S18 | `18-admin-pods.png` | Pods list |
| S19 | `19-admin-task-types.png` | Task Types list |
| S20 | `20-admin-workflows.png` | Workflows list |
| S21 | `21-admin-steps.png` | Workflow Steps list with Tags filter |
| S22 | `22-admin-steps-tag-filter-open.png` | Tags popover (counts, Match all/any) |
| S23 | `23-admin-priorities.png` | Labels: Priorities |
| S24 | `24-admin-status-labels.png` | Labels: Status labels |
| S25 | `25-admin-asset-types.png` | Asset Types |
| S26 | `26-admin-link-roles.png` | Asset link roles |
| S27 | `27-admin-custom-fields.png` | Custom Fields |
| S28 | `28-admin-audit.png` | Audit Logs, filters folded |
| S29 | `29-admin-audit-filters-open.png` | Audit Logs, filter form open |
| S30 | `30-dashboard-swimlane-filters-open.png` | Swimlane toolbar and filter panel |
| S31 | `31-search-results.png` | Search results |
| S32 | `32-advanced-search.png` | Advanced search |
| S33 | `33-task-queue-filters-open-375.png` | Task Queue panel at 375x812 |
| S34 | `34-matters-375.png` | Matters at 375x812 |
| S35 | `35-assets-inline-filters-375.png` | Assets inline filters at 375x812 (F2) |
