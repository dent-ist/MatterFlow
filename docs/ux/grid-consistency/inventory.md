# Grid and list inventory (2026-11-02)

Branch `grid-consistency-review`, code of `origin/matter-detail` at 36b3147. Demo data (`seed:demo --aged --seed 7`), signed in as the Dev admin (and as Test User 03 for My Matters). Screenshots: `screens/NN-name-d.jpg` is 1366x768, `-p.jpg` is 375x812. Everything marked **(code)** was read in the templates but not photographed.

How to read the scores: 0 = no standard at all or surprising, 1 = works but differs from the neighbours, 2 = mostly like the neighbours, 3 = the pattern the rest should copy. Dimensions: **A** anatomy and primary action, **F** search and filters, **S** sort, **C** columns (chooser, order, resize, remember), **R** rows, paging and states, **P** phone. Maximum 18.

## 1. Surfaces reviewed: 46

| # | Surface | Route | Shot | Kind |
|---|---|---|---|---|
| 1 | Task Queue | `/tasks` | 01, 60, 64 | work list |
| 2 | My Work (Active, Due soon and overdue, Closed, Created by me) | `/my-work` | 02, 03 | work list |
| 3 | Pod Work (Unassigned, By member, All open) | `/pods/work` | 04, 65 | work list |
| 4 | Matter > Tasks tab | `/matters/:id?tab=tasks` | 05 | work list (scoped) |
| 5 | Project tasks side panel (linked tasks) | Matter > Projects > row | 12 | detail list |
| 6 | Matter > Projects tab | `?tab=projects` | 06 | record list |
| 7 | Matter > Assets tab | `?tab=assets` | 07 | record list |
| 8 | Matter > Productions tab | `?tab=productions` | 08 | record list |
| 9 | Matter > Specs (view of the Productions tab) | same, Specs toggle | (code) | record list |
| 10 | Matter > Notes list (grouped/Latest/Board) | `?tab=notes` | 09 | record list |
| 11 | Matter > Activities | `?tab=activities` | 10 | log |
| 12 | Clients | `/clients` | 13 | record list |
| 13 | Client record > Matters list | `/clients/:id` | 42 | record list |
| 14 | Matters | `/matters` | 14, 61, 63 | record list |
| 15 | Projects | `/projects` | 15 | record list |
| 16 | Project record > linked tasks | `/projects/:id` | 44 | detail list |
| 17 | Assets | `/assets` | 16 | record list |
| 18 | Asset record > linked tasks | `/assets/:id` | 43 | detail list |
| 19 | Asset reports (saved reports, result table) | `/assets/reports` | 17 | report |
| 20 | My Matters > Overview task list | `/my-matters` | 50, 51, 56 | work list |
| 21 | My Matters > Assets | `?tab=assets` | 52 | record list |
| 22 | My Matters > Activity | `?tab=activity` | 53 | log |
| 23 | My Matters > Clients and matters tree, Calendar side lists | `?tab=calendar` | 54 | tree, calendar |
| 24 | Dashboard > Summary task lists (Unassigned, Overdue, Due soon) | `/dashboard` | 23 | mini lists |
| 25 | Dashboard > Users (workload table and cards) | `/dashboard?tab=users` | 45 | analysis table |
| 26 | Dashboard > Breakdowns / Trends data tables | `/dashboard?tab=breakdowns` | (code) | chart table |
| 27 | Notifications | `/notifications` | 24 | feed |
| 28 | Search results (All, per type tabs) | `/search?q=` | 25 | results |
| 29 | Admin > Users | `/admin/users` | 26 | admin list |
| 30 | Admin > Roles | `/admin/roles` | 27 | admin list |
| 31 | Admin > Pods | `/admin/pods` | 28 | admin list |
| 32 | Admin > Pod members (panel) | Pods > row | (code) | detail list |
| 33 | Admin > Task Types | `/admin/task-types` | 29 | admin list |
| 34 | Admin > Workflows | `/admin/workflows` | 30 | admin list |
| 35 | Admin > Workflow Steps | `/admin/steps` | 31 | admin list |
| 36 | Admin > Asset Types | `/admin/asset-types` | 32 | admin list |
| 37 | Admin > Asset link roles | `?tab=link-roles` | 33 | admin lookup |
| 38 | Admin > Custom Fields | `/admin/custom-fields` | 34 | admin lookup |
| 39 | Admin > Labels: Priorities | `/admin/priorities` | 35 | admin lookup |
| 40 | Admin > Labels: Status labels | `/admin/status-labels` | 36 | admin lookup |
| 41 | Admin > Labels: On-hold reasons | `/admin/on-hold-reasons` | 37 | admin lookup |
| 42 | Admin > Labels: Notes tags | `/admin/note-tags` | 38 | admin lookup |
| 43 | Admin > Reports (list) | `/admin/reports` | 39 | admin list |
| 44 | Admin > Reports: Categories, Run log, Assignments tabs | same | (code) | admin list |
| 45 | Admin > Audit Logs | `/admin/audit` | 40 | log |
| 46 | Admin > Settings | `/admin/settings` | 41 | form, no list (checked, excluded from scores) |

Not photographed because they need a state the demo data lacks: Productions/Specs/Notes with rows, Reports with rows, a populated Roles detail. Their anatomy is read from code.

## 2. Matrix A: anatomy, create, search, filters

| # | Title and count | Create button (label, style, place) | Search box | Filter UI | Active filters visible? |
|---|---|---|---|---|---|
| 1 Task Queue | H1 "Task Queue" with icon; **no count** in the title (count only in the footer "Showing 1-50 of 139") | none on the page (global "Create task" in the app bar); empty state has "Create task" | none; "Title or ref" text box in the filter row | view chips (All open, Unassigned, Overdue...) + "More" + **Columns**, **Other filters**, **Filters** buttons (right, in that order) + inline filter row under the header + Views menu + Export | yes: chips row 2 with "Clear filters" |
| 2 My Work | H1 "My Work"; tab counts "Active (5)" | none | none (same filter row) | summary chips (Overdue, Due today, ASAP, On hold), tabs, then same Columns / Other filters / Filters | yes, as 1 |
| 3 Pod Work | H1 + Pod select top right; context line | none | none | as 2 with tabs Unassigned / By member / All open | yes |
| 4 Matter Tasks | tab label "Tasks (16)"; no heading | none in the tab (Create is in the header "New" menu); empty state "Create task" | none | **View: Open (16)** dropdown, Columns, Select (left), **Filters** (right, its own line) | chips when a filter is on |
| 5 Project tasks panel | "Linked tasks (18)" | "Add task" (secondary, right of heading) | none | none | n/a |
| 6 Matter Projects | tab label "Projects (1)" | "+ New Project" (primary, Title Case) **not shown in my capture** for the admin; label exists in code | none | none | n/a |
| 7 Matter Assets | tab "Assets (5)" | "New Asset" (primary) | none | **Filters** only | chips |
| 8 Productions | tab "Productions (0)" | "+ New Production" / "+ New Spec" (primary, right) | **yes**, "Search", left of the primary | segmented Productions/Specs + **Direction: All** dropdown (inline, no Filters button) | no chips (dropdown shows its value) |
| 10 Notes | tab "Notes (0)", H "Notes 0" | "+ New Note" + split caret | **yes**, "Search title and text" | Tags dropdown, view toggles, Sort dropdown | partial |
| 11 Activities | H2 "Activities" | none | none | **Kind: All kinds** dropdown | no chips |
| 12 Clients | H1 "Clients", no count (footer only) | "+ New client" (primary, sentence case) | none; "Name" and "Client number" boxes in the filter row | **Filters** button opens/closes inline row (row open by default in capture) | chips when row closed |
| 14 Matters | H1 "Matters" | "+ New matter" (primary) | none; filter row (opened as a sheet in my capture) | Filters, Columns, Select (left of primary) | chips |
| 15 Projects | H1 "Projects" | "+ New project" | none | Filters + inline row | chips |
| 17 Assets | H1 "Assets" | "+ New asset" + "Build a report" (secondary) | none | Filters + inline row | chips |
| 19 Asset reports | H1 "Asset reports" | "New report" (secondary! no plus) | none | form | n/a |
| 20 My Matters tasks | H2 "Tasks" + count badge 56 | none ("+ New" menu of the page header is a split menu, primary) | **yes, but hidden** inside the filter row: "Search tasks" | **Filter** (singular, with count badge) toggles a row of 4 labelled dropdowns ("Status: All open"); **Show:** dropdown; **Urgency** sort toggle | yes: removable chips + "Clear filters" link |
| 21 MM Assets | H2 "Assets" + count | none | **yes, visible top right**, "Search assets" | Type and Status labelled dropdowns, "Dates" link; no Filter button | no |
| 22 MM Activity | H2 "Activity" | none | none | count chips (All 168, New assets 20...) + "Unread only" checkbox + "Mark all as read" | chip = selected |
| 24 Dashboard lists | H3 "Unassigned 48" + one-line rule | none | none | none (Scope select on page) | n/a |
| 27 Notifications | H1 + sentence | "Mark all as read" (secondary) | none | chips All / Unread (7) | chip |
| 28 Search | H1 "Search results" + "Showing results for" | none | the global bar | tabs All (285) / per type, per-type filters on tab | tabs |
| 29 Users | breadcrumb + H1 + description; tab counts "Users (61)" | **none visible** ("Grant access" is in each pending row; admin cannot add a user here) | none; "Name" box in filter row | status chips (Pending access 0, Active 61...) + **Other filters** + **Filters** + filter row | chips |
| 30 Roles | as 29 | "+ New role" (primary, in the tab body, not in the header) | none | none | n/a |
| 31 Pods | as 29 | "+ New pod" (primary, in the tab body) | "Name" box in filter row | Filters | |
| 33 Task Types | breadcrumb + H1 + description + tabs with counts | "+ New task type" (primary, header) | "Name" box in filter row | Filters + status chips (Active 15, Not usable 0...) | |
| 34, 35 Workflows, Steps | as 33 | "+ New workflow", "+ New step" | "Name"/"Title" in the filter row | Filters / Other filters, status chips | |
| 36 Asset Types | as 33 | "+ New asset type" | none (no filter row) | Filters + status chips | |
| 37-42 lookups | as 33, tab counts "Priorities (4)" | "+ New priority", "+ New reason", "+ New tag", "+ New link role" | none | none | n/a |
| 38 Custom Fields | breadcrumb + H1 | none (a fixed list of three objects) | none | none | n/a |
| 43 Reports | as 33 | "+ New report" | none | Filters (button present, list empty) | |
| 45 Audit Logs | as 33 | none | "Summary or field" in the filter row | quick-view chips (Today, Last 7 days...), Filters, "Group events" checkbox | |

## 3. Matrix B: sort, columns, resize, reorder, memory

| # | Sort | Default order stated? | Columns chooser | Resize | Reorder | Remembered |
|---|---|---|---|---|---|---|
| 1-3 | click header (arrows icon, `aria-sort` on `th`); "Reset sort" text button appears; "Sorted by Priority, most urgent first (default order)" note with (i) popover; phone: "Sort" sheet | yes | **Columns** button: grouped checkbox panel (Task / Where / Who / When / State), density Comfortable/Compact, group by (My Work), column widths section | yes (`mfResizable`-like own `column-resize.ts`) | drag header (`mfReorder`) | columns per user, page and tab (`mf.work-columns.v2.*`), density (`mf.work-table.v3.*`), widths |
| 4 Matter Tasks | header click; default order not stated on page | no | **Columns** (left side): checkbox list with **left/right arrow buttons** (`mf-grid-columns`) | yes (task-table) | drag + arrows | `mf.grid.v1.*` |
| 6, 7, 8, 11 | header click on some (Assets: Type, Name, Size, Disposition); Projects, Productions, Activities: not sortable | no | none | no | no | no |
| 12 Clients, 15 Projects, 17 Assets | header click (`th[mfSort]`, icon arrows, current column bold icon) | no (footer says nothing) | **none** | no | no | no |
| 14 Matters | header click | no | **Columns** (middle): checkbox list with arrows (`mf-grid-columns`) | yes (`mfResizable`) | yes | `mf.grid.v1.matters.*`, `mf.col-widths.v1.*` |
| 20 MM tasks | header click (local `.sort` buttons) **and** an "Urgency" toggle button | "Urgency" pressed = default | none | no | no | no |
| 21, 22 MM | header click (assets) / none (activity) | no | none | no | no | no |
| 24 | none; fixed rule in the heading line ("Highest priority first, then oldest.") | yes | none | no | no | no |
| 27, 28 | none (newest first / relevance) | no | none | no | no | no |
| 29-36 admin lists with a filter row | header click (`th[mfSort]`) | no | none | no | no | no |
| 37-42 lookups | not sortable, an "Order" column where it matters | by Order | none | no | no | no |
| 45 Audit | none (newest first, grouped by day) | stated in the description | none | no | no | no |

## 4. Matrix C: rows, bulk, row actions, paging, states, phone, accessibility

| # | Row hover / select / bulk | Row actions | Paging (default size) | Count text | Empty / loading / error | Phone | Header semantics |
|---|---|---|---|---|---|---|---|
| 1-3 | hover tint token; no checkbox column in the table; bulk through a "Select" mode in the Matter tab only (the queue edits inline: priority, assignee, status dropdown in the row) | inline dropdowns in cells | pager, **50** (25/50/100) | "Showing 1-50 of 139", "Page 1 of 3", First/Previous/Next/Last | one calm line + "Clear filters"; skeleton rows; error with Retry | **cards** | `th scope=col`, `aria-sort`, resize handle focusable |
| 4 | as 1, plus "Select" button turns on a checkbox column | inline dropdowns | pager, 25 | same | same | **table scrolls sideways** with "Scroll sideways to see every column" (not cards) | same |
| 6 | link cells | none | none | none | one line | not photographed | `th scope=col`, no sort |
| 7 | none | none | pager, 25 | "Showing 1-4 of 4 active - 1 inactive hidden Show all" | one line | cards (code) | |
| 12, 15, 17 | row hover; Assets and Matters have a checkbox column + bulk bar ("Selected assets") | Matters: "..." menu button with border; Clients/Projects/Assets: links in cells | pager, 25 | "Showing 1-12 of 12" | one line + "New client" in empty state | **cards** (`mf-record-card-list`) | |
| 20 | row hover; none | none | pager, 25 | "Showing 1-25 of 56" | one line | cards | `aria-sort` |
| 21 | none | none | pager, 25 | same | | | |
| 22 | none | none | pager, 25 | "Showing 1-25 of 168" (no "Page" label difference) | | | |
| 24 | none | inline "Assign" dropdown | none ("Showing 5 of 48", "View all") | | | | **no header row** (list, not table) |
| 27 | row hover, unread dot | none | pager 25 with only Previous/Next (no First/Last) | "Showing 1-7 of 7" | | | |
| 28 | none | none | pager 25 | | | cards | |
| 29-36 | hover; no selection | **"..." bordered icon menu** at the row end | pager 25 (Task Types 25) | "Showing 1-15 of 15" | one line | cards for some, scrolling tables for others | |
| 37-42 | hover | "..." menu | none | none | "No tags yet. Use New tag." | cards | |
| 45 | day group headers, expand chevron | "..." menu | **"Load more"** button, "50 events loaded." (not a pager) | | | | |

Density and size: work lists 44 px comfortable / 32 px compact (Columns panel), record and admin lists 44 px rows, My Matters 44-50 px rows with two-line cells. Chips: status chip everywhere; priority is a coloured pill in work lists and a plain word ("Normal") for the low ones, a different pill in Dashboard and the admin Priorities. Task Types icon chips appear in Queue, Matter Tasks (with name), My Matters (name below).

Dates: Task Queue/My Work/Pod Work "Oct 21 / Nov 2, 3:00 PM"; My Matters "10/10 / 10/13 01:00 PM" (numeric, theme guide section 8); Matter Activities "Nov 2, 2026, 4:28 PM UTC"; Audit "4:29 PM" under day headers; Notifications "just now / 3 min ago"; Dashboard "Oct 21 Overdue 12d".

## 5. The same entity on different pages

### Tasks (8 places)

| Place | Columns in default order (at 1366 px) |
|---|---|
| Task Queue, Pod Work | Ref, Title (type icon in front), Matter Number, [Matter Name drops out], Priority, Assignee, Due, Status |
| My Work Active | Ref, Title, Matter Number, [Matter Name drops out], **Workflow progress**, Priority, Due, Status (no Assignee: it is you) |
| My Work Closed | Ref, Title, Matter Number, Matter Name, Status, Closed |
| Matter Tasks tab | Ref, **Type** (chip + name), Title, **Project**, Priority, Assignee, Due, Status, **Progress** |
| My Matters tasks | one **Task** cell (type icon, ref and title together, matter name under it), **Status**, Priority, [Assignee], Due |
| Dashboard lists | Ref, [type icon] Title, **Matter name**, Priority, Due (no header, no Status, no Assignee) |
| Project tasks panel | "TSK-111 Collection Receipt - 14 Completed" (ref + title as one link, status as a word), Unlink |
| Search results (Tasks) | code: Ref, Title, Type, Matter, Due, Status (relevance order, no sort) |
| Asset record > Linked tasks | code: Ref, Title, (two more headings), Assignee, Role |

Differences: Status is 7th/last on the work lists, 2nd in My Matters; Priority 4th or 5th; Assignee exists in 4 of 7; matter shown as a number, as a name, or both; type is an icon, a chip, or nothing; progress is a column on three pages with three names ("Workflow progress", "Progress", the step bar inside Status).

### Assets (4 places)

| Place | Columns |
|---|---|
| Assets list | (checkbox), **Name**, Type, Matter Number, Size, Linked tasks, External reference, Disposition |
| Matter Assets tab | **Type**, **Name**, Size, External reference, Disposition |
| My Matters Assets | Matter, Asset type (icon + name + type below), Created, Updated, Status |
| Search results (Assets) | code: Name, Type, Matter number, Size, Disposition (then Status) |

The word for the last column is **Disposition** on two pages and **Status** on the other two. Name and Type swap places between the global list and the Matter tab.

### Matters (4 places)

Matters list: CM Number, Name, Client, Primary PM, Secondary PM, Open tasks, Overdue, Status (+ optional On hold, At risk, Data size, Pending disposition). Client record > Matters: code: Number, Name, Status, counts. Search results: Number, Name (+ Sensitive chip + "Other matter"), Client, Status. My Matters tree: Client > Matter with counts. Label for the number is **CM Number**, **Number**, **Matter Number**, **Matter** depending on page.

### Clients (3 places)

Clients list: Client number, Name, Matters, Open tasks, Overdue, Status. Search: Number, Name, Status. Matter list column "Client": "90001 Demo Northwind..." (number + name, truncated). Dashboard: none.

## 6. Scores (0-3)

| # | Surface | A | F | S | C | R | P | Total /18 | Note |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Task Queue | 2 | 2 | 3 | 2 | 3 | 3 | 15 | most complete page; unique Views/Export; no title count |
| 2 | My Work | 2 | 2 | 3 | 2 | 3 | 3 | 15 | |
| 3 | Pod Work | 2 | 2 | 3 | 2 | 3 | 3 | 15 | |
| 4 | Matter Tasks | 1 | 1 | 2 | 2 | 2 | 1 | 9 | Columns on the left, Filters alone on its line, sideways scroll on phone |
| 5 | Project tasks panel | 1 | 0 | 0 | 0 | 1 | 2 | 4 | a link list, not a grid |
| 6 | Matter Projects | 1 | 0 | 0 | 0 | 1 | 2 | 4 | |
| 7 | Matter Assets | 1 | 2 | 2 | 0 | 2 | 2 | 9 | |
| 8 | Productions | 1 | 1 | 0 | 0 | 2 | 2 | 6 | only list with a search and no Filters button |
| 10 | Notes | 1 | 1 | 2 | 1 | 2 | 2 | 9 | purpose-built (cards, board) |
| 11 | Activities | 1 | 1 | 0 | 0 | 1 | 2 | 5 | "Show more", UTC full date |
| 12 | Clients | 2 | 2 | 2 | 0 | 3 | 3 | 12 | |
| 14 | Matters | 2 | 2 | 2 | 3 | 3 | 3 | 15 | has the full shared grid kit |
| 15 | Projects | 2 | 2 | 2 | 0 | 3 | 3 | 12 | |
| 17 | Assets | 2 | 2 | 2 | 0 | 3 | 3 | 12 | |
| 19 | Asset reports | 1 | 0 | 0 | 0 | 1 | 1 | 3 | "New report" is secondary, no plus |
| 20 | My Matters tasks | 1 | 1 | 2 | 0 | 2 | 3 | 9 | own filter style, own sort toggle, own dates |
| 21 | MM Assets | 1 | 1 | 2 | 0 | 2 | 3 | 9 | |
| 22 | MM Activity | 1 | 1 | 0 | 0 | 2 | 3 | 7 | |
| 24 | Dashboard lists | 1 | 0 | 1 | 0 | 2 | 2 | 6 | summary lists by design |
| 27 | Notifications | 2 | 2 | 0 | 0 | 2 | 3 | 9 | pager without First/Last |
| 28 | Search results | 2 | 2 | 0 | 0 | 2 | 3 | 9 | |
| 29 | Users | 1 | 2 | 2 | 0 | 2 | 2 | 9 | no create button; visible overlap of Pods chip and Availability at 1366 px |
| 30 | Roles | 2 | 0 | 0 | 0 | 2 | 2 | 6 | |
| 31 | Pods | 2 | 1 | 2 | 0 | 2 | 2 | 9 | |
| 33-36 | Task Types, Workflows, Steps, Asset Types | 3 | 2 | 2 | 0 | 3 | 2 | 12 | the admin shell is the most uniform group |
| 37-42 | Lookups (Link roles, Priorities, Status labels, On-hold, Notes tags) | 3 | 0 | 0 | 0 | 2 | 2 | 7 | fine for 4 rows; "Order" is the sort |
| 38 | Custom Fields | 2 | 0 | 0 | 0 | 2 | 2 | 6 | |
| 43-44 | Reports | 3 | 2 | 1 | 0 | 2 | 2 | 10 | |
| 45 | Audit Logs | 2 | 2 | 1 | 0 | 1 | 2 | 8 | "Load more" instead of pager |

Average of the 28 scored rows: about 9 of 18. Only the Task Queue family and Matters are above 14, and they differ from each other.

## 7. What would surprise a user who learned one page and moves to another

1. The **Filters** button is in 3 different places (left of Columns on the work lists, left of Select and New on Matters, alone on its own line in the Matter tabs) and is called **Filter** in My Matters.
2. A **search box** is in the filter row on some lists, never on others, in the page header on Productions and Notes, and top right on My Matters Assets.
3. **Columns** exists on 4 pages; it is two different menus (grouped checkboxes with density, or a list with arrows).
4. **Sort**: header click everywhere there is a table, but there is also "Urgency", "Reset sort", a "Sorted by" note, a phone sort sheet and a "Sort: Newest" dropdown (Notes), and ten lists with no sort at all.
5. The **create** button is "+ New client" (sentence case) on global lists and "+ New Project" (Title Case) in the Matter tabs; Task Queue has none; Users has none; reports uses a secondary button.
6. The **same task** has a different column order and different names on every page.
7. **Paging**: 50 rows on the Task Queue family, 25 elsewhere, "Load more" in Audit and Activities, "Show more" in the Matter Activities tab; Notifications has no First/Last.
8. **Phone**: cards in most places, a sideways-scrolling table in the Matter Tasks tab.
9. **Dates**: three formats for the same Due date (Task Queue, My Matters, Dashboard).
10. **Row actions**: bordered "..." button on Matters and admin lists, inline dropdowns on task rows, links in cells on Clients, none on tabs.
