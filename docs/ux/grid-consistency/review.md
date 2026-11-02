# Grid and list consistency review

Date 2026-11-02. Request of the owner: "regardless of sharable component or not, I see different styles of filter button, filtering, sorting, column orders even though it's same task list. Consistency is the issue. I want user knows where to find things easily."

Nothing in the app was changed. Evidence: `inventory.md` (46 surfaces, matrices, scores), `screens/` (67 screenshots, 1366x768 and 375x812), the code of `origin/matter-detail`. Proposed pattern: `anatomy-mockup.html`. Costs and order of work: `conversion-plan.md`.

## 1. The answer in short

The app has **five different list toolbars** that were each tuned well on their own page:

1. the work-list toolbar (Task Queue, My Work, Pod Work): view chips, Columns, Other filters, Filters, inline filter row, Views, Export;
2. the record-list toolbar (Clients, Projects, Assets, Matters, admin lists): Filters at the top right next to the primary button, inline filter row;
3. the Matter tab toolbar (Tasks, Assets): View dropdown, Columns, Select on the left, Filters alone on the right;
4. the My Matters toolbar (tasks, assets, activity): a "Filter" button that opens a row of labelled dropdowns, a Show dropdown, an "Urgency" toggle, a visible search box on some tabs;
5. the Productions/Notes toolbar: a search box, a Direction/Tags dropdown, a sort dropdown, no Filters button.

Inside each of them the controls work. The problem is that a person who learns one cannot guess where the same control is on the next page. About 9 of 18 points on average (inventory section 6); only the Task Queue family and Matters are above 14.

## 2. Top inconsistencies, ranked by what a user has to re-learn

| Rank | Inconsistency | Where (screens) | Why it hurts |
|---|---|---|---|
| 1 | **The Task list is not the same list.** Eight places show tasks with different column order, names, and which columns exist (Status is last in the work lists, second in My Matters; Assignee missing in three; Matter shown as number, name, both or neither; Type as icon, chip or nothing; progress called Workflow progress, Progress or drawn inside Status). | 01, 02, 04, 05, 12, 23, 50 | exactly the owner's complaint; every task page needs a new reading of the grid |
| 2 | **Filters: four ways.** Button named "Filters" (work lists, records), "Filter" (My Matters), none (Productions, Activities, Notes, MM Assets); the button sits in three places; it opens an inline row of column boxes (records), a row of labelled dropdowns with "Status: All open" (My Matters), or a sheet (Matters at 1366 px, all lists on a phone). | 01, 13, 14, 05, 51, 08 | the first thing people look for, and it is never in the same place |
| 3 | **Search: sometimes visible, sometimes hidden inside the filter row, sometimes absent.** Task Queue/Clients/Assets: a text box inside the filter row only (appears after pressing Filters). Productions, Notes, My Matters Assets: a visible search box. Placeholders: "Title or ref", "Name", "Search tasks", "Search assets", "Search", "Search title and text". | 01, 13, 08, 09, 20, 51, 52 | people type in the global bar by accident; there is no "search this list" |
| 4 | **Columns: two different menus on four pages, none on the other thirty.** Work lists: grouped checkboxes + density + widths. Matters and Matter Tasks: checkbox list with left/right arrows. Clients, Projects, Assets, admin lists, My Matters: nothing, though they have 6 to 8 columns. | 60, 61, 05 | the theme guide (section 11) already says this adoption is the plan; it is unfinished |
| 5 | **Sort: five visible styles.** Header click (most), plus "Urgency" toggle (My Matters), "Reset sort" + "Sorted by ..." note (work lists), a Sort dropdown (Notes), a phone sort sheet; and 12 lists with no sort at all and no statement of the default order. | 01, 50, 56, 09 | the default order is explained on one page and unknown elsewhere |
| 6 | **Create button.** "+ New client" (sentence case) on global lists, "+ New Project" (Title Case per guide section 9) in Matter tabs; Task Queue, My Work, Matter Tasks have none (Create task is in the app bar); Users has none; Asset reports uses a secondary "New report"; in Roles/Pods the button is inside the tab body not the page header. | 13, 14, 16, 06, 08, 17, 27, 28 | people look at the top right and sometimes find nothing |
| 7 | **Title and count.** The count is in the heading on My Matters ("Tasks 56"), in tab labels for admin and Matter tabs, in the footer for work lists, in a chip row for Users and Task Types, and nowhere for Clients. | 01, 13, 29, 50 | |
| 8 | **Paging.** 50 rows on the Task Queue family, 25 elsewhere; "Load more" (Audit), "Show more" (Matter Activities), no pager (Dashboard lists, lookups); Notifications has no First/Last. | 01, 13, 10, 24, 40 | |
| 9 | **Phone.** Cards on most lists, a sideways scrolling table with a hint line in Matter Tasks. | 01 p, 05 p | |
| 10 | **Dates and small things.** Three formats for one Due date (Oct 21 / 10/21 / Oct 21 Overdue 12d); UTC full dates in Matter Activities; row actions are a bordered "..." button on Matters and admin lists but inline dropdowns on task rows; the assets last column is "Disposition" on two pages and "Status" on two. | 01, 50, 10, 16, 52 | |

Also found (not consistency, but visible in the photographs): at 1366 px the Pods chip overlaps the Availability text in Admin > Users (screen 26); on Matters the Filters button opened a dimmed sheet in my capture while the same button opens an inline row on Clients (screens 63, 13); in the Matter Projects tab no "New Project" button was visible for the admin (screen 06).

## 3. What a user has to re-learn when moving between pages

- Moving Task Queue to Matter Tasks: Columns moves from the right to the left, Filters moves from the toolbar to its own line, a View dropdown replaces the view chips, the Type column appears, Ref and Title are no longer next to Matter.
- Moving Task Queue to My Matters: the list becomes one "Task" cell, Filters becomes Filter, filters become labelled dropdowns, sort becomes "Urgency", dates become 10/10.
- Moving Clients to Matters: the column chooser appears (after the filter button), a Select mode appears, the Filters opens differently.
- Moving Assets to the Matter Assets tab: Name and Type swap, Linked tasks disappear, a Filters button alone on a line.
- Moving any list to Productions: a search box, no Filters.
- Admin: Users has no New button; Roles and Pods put it in the tab body; lookups have no search or filter and are not sortable.

## 4. Root causes in the code

| Variant | Implemented by | Notes |
|---|---|---|
| Work toolbar (chips, Columns, Other filters, Filters, Reset sort) | `shared/filters/filters-bar.ts` (`mf-filters-bar`, `mf-more-filters`), `shared/work-queue/work-view-controls.ts`, `quick-views.ts`, `column-chooser.ts`, `work-list.ts`, `task-table.ts` (1,299 lines) | three pages share it; Matter Tasks (`scoped-tasks.ts`) re-implements a lighter variant |
| Record toolbar (Filters in the header) | `shared/filters/list-filters-button.ts` + `shared/ui/column-filters.ts` (`FiltersToggle`, `mfColumnFilterRow`) + `mf-page-header` / `mf-admin-list-shell` | the Filters button is slotted into the header, not into the grid frame |
| Matter tab toolbar | `scoped-tasks.ts`, `shared/ui/matter-assets.ts` | own layout; Columns uses the newer `mf-grid-columns` |
| My Matters toolbar | `features/my-matters/ui/task-list.ts`, `assets-tab.ts`, `activity-tab.ts` | own "fbtn" Filter button, own removable chips ("achip"), own `.sort` buttons; only the grid frame, dropdown and pager are shared |
| Productions / Notes | `productions-tab.ts`, `notes-tab.ts` with `mf-search-box` | |
| Two Columns menus | `shared/work-queue/column-chooser.ts` (keys of `ColumnDef`, stored `mf.work-columns.v2`) vs `shared/ui/grid-columns.ts` + `grid-prefs.ts` (stored `mf.grid.v1`) | two data models; only Matters and Matter/Project Tasks use the second |
| Two resize implementations | `shared/work-queue/column-resize.ts` vs `shared/ui/resizable-columns.ts` | |
| Three sort header styles | `shared/ui/data-table.ts` (`th[mfSort]`), `task-table.ts`, local `.sort` buttons in `grid-frame.ts` styles and My Matters | |
| Two components both named `mf-filter-chips` | `shared/ui/filter-chips.ts` (count toggle chips) and `shared/filters/filter-chips.ts` (removable active filter chips); My Matters adds a third (`.achip`) | easy to mix up, and users see three chip looks |
| Task columns | one list `WORK_COLUMNS` and per-page defaults in `column-prefs.ts` (`QUEUE_DEFAULT`, `MY_WORK_DEFAULT`), `scopedOnly` Type/Progress added for matter tabs, a separate hand-made grid in My Matters (`task-list.ts` heads), another in Dashboard (`task-list-panel.ts`), another in Search (`search-grid.ts`) | five definitions of "a task row" |
| Asset columns | `assets-list-page.ts` (const COLUMNS), `matter-assets.ts`, `my-matters/ui/assets-tab.ts`, `search-grid.ts` | four definitions |
| Create button labels | literal `label="New client"` in each page (see grep list) | no shared constant or component |
| Page size | `PAGE_SIZES` in `list-query.ts` (25 first) vs `queue-filters.ts` (default 50) | |
| Phone | `mf-record-card-list`, `mf-task-card-list`; Matter Tasks uses the table | |

The theme guide (section 11) already lists the estimate to unify the work-list chooser with the grid kit (10 agent-hours) and to adopt the kit on about 15 lists. This review adds what that plan is missing: the **toolbar** as one component, the **default order and names** per entity, and **owner decisions** on labels.

## 5. Recommendations

### 5.1 The standard "list page anatomy"

Every list page has these zones, in this order, top to bottom and left to right. A zone that does not apply is left out, never moved. Full picture: `anatomy-mockup.html`.

```
Row 1  [icon] Title  (count)                                   [Primary action  "+ New Thing"]
Row 2  [Search ...]  [Filters (2)]  [View: Open v]  ......  [Sort: Priority v *phone and card views only*]  [Columns]  [... Export, Saved views, Density]
Row 3  active filter chips  [x Status: Open] [x Assignee: Me]  Clear filters        Sorted by Priority, most urgent first  Reset sort
Row 4  the grid (sticky header; sort by header button; row actions "..." at the row end)
Row 5  bulk bar (replaces row 2 while rows are selected)
Foot   Rows per page [50 v]   Showing 1-50 of 139   Page 1 of 3  First Previous Next Last
```

1. **Title and count**: H1 with the page icon and the total after filters as a small count chip, always (Task Queue 139, Clients 5). Tab pages show the count in the tab label as today, and no second count in the row.
2. **Primary action**: one filled button, far right of row 1, label "+ New" plus a Title Case noun ("New Client", "New Task"), theme button rule. Pages without a create right (Users, Audit, Search) show nothing there.
3. **Search**: always visible, first control of row 2, one placeholder pattern "Search tasks", "Search clients", "Search assets". It searches the primary text of the row (ref, title, name, number) and is **not** the global search. It replaces the Name/Title text box in the filter row.
4. **Filters**: one button "Filters" with the count of active filters, directly right of Search. Opens the inline filter row (desktop) or the sheet (phone); same name everywhere, never "Filter".
5. **View** (work lists and Matter Tasks only): quick views as chips (Task Queue) or one "View:" dropdown (narrow places). Same slot right after Filters.
6. **Active filter chips**: row 3, removable, with "Clear filters". Shown whenever a filter is active, whether the filter row is open or not.
7. **Sort**: by header click (`aria-sort`, Enter/Space on the header button, no new shortcut). Row 3 right end says "Sorted by X, direction" and offers "Reset sort", on every sortable list, so the default is always stated. A **Sort** dropdown appears only where there are no headers (phone cards, Notes cards).
8. **Columns**: one menu, always the same button ("Columns" with the table icon), right of row 2: show/hide, move left/right, reset, (grouped headings for tasks), and Density inside the same menu. Present on every list with more than 5 columns.
9. **More menu** ("..."): Export, Saved views, anything rare. One place.
10. **Bulk actions**: a bar that takes the place of row 2 while rows are selected ("3 selected - Assign - Change status - Clear"), after pressing Select or ticking a box.
11. **Pager** in the footer: rows per page (25, 50, 100, default **50**), "Showing a-b of n", Page n of m with First/Previous/Next/Last. No "Load more" lists, no infinite scroll (a legal tracker needs stable page numbers and counts).
12. **Row**: row hover token, link in the primary cell, secondary actions in a "..." menu at the row end, inline editing only in work lists.
13. **States**: one calm sentence with an icon, "Clear filters" when filters hide everything, skeleton rows while loading, error with Retry, the same wording pattern ("No tasks match these filters.").
14. **Phone**: every list is a card list under 640 px (Matter Tasks included); row 2 becomes Search plus Filters plus Sort; Columns is hidden.

### 5.2 Options where there is a real choice

**Choice 1: how filtering looks.**

| Option | What it is | For | Against |
|---|---|---|---|
| A. Keep the inline filter row, standardise it (recommended) | one "Filters (n)" button opens the existing column filter row under the header; chips when closed; search moves out to the toolbar | already built and reviewed (docs `column-filters-review.md`), works with column order, minimal change | the row only offers filters that have a column; row costs one line of height |
| B. One Filters button opening a popover/side sheet with all filters | like the phone sheet, on desktop too | one pattern for all widths and for My Matters' labelled dropdowns; hidden columns no longer hide filters | the inline row is faster for people who filter every day; a bigger rewrite (the column filter row would be retired) |
| C. Both: quick view chips for the common 4 to 6 views plus B for the rest | the Task Queue model, extended | | |

Recommendation: A for record lists and admin lists, C-style quick views for work lists (already there), and make My Matters use A's button and chips (its dropdown row becomes the inline row with the same dropdown component). Reason: smallest change that gives one button, one place, one name, and keeps what users already like. B can be a later phase if the owner wants the desktop and phone to be identical.

**Choice 2: sort.**

| Option | For | Against |
|---|---|---|
| A. Header click only, plus a status line "Sorted by ..." and Reset (recommended) | nothing new to learn, keyboard-accessible, works with column order | hidden on cards (phone) unless the Sort dropdown is shown there |
| B. Also a Sort dropdown on desktop | discoverable | duplicate control, takes room, changes sort rules twice |
| C. Sort dropdown only | uniform | loses direct manipulation; headers already exist |

Recommendation A, with the Sort dropdown only on phone cards and Notes. Remove the My Matters "Urgency" toggle (urgency is its default; "Reset sort" does the same).

**Choice 3: where the Columns control lives.** Right end of row 2 (recommended, as on the work lists). The alternative, in the page header next to the primary button (as on Matters now), crowds the one place a user looks for the primary action.

**Choice 4: count.** Total in the title (recommended) vs in the footer only (today for work lists) vs in tab labels only. Title count is the cheapest answer to "how many are there".

### 5.3 Default column order and names

Rule for every entity: **identity first** (number, name), **where it belongs** (matter, client, project), **people**, **time**, **state last**, optional columns after, with the same words everywhere. Status is always the last default column; Due always directly before it.

| Entity | Standard default order (Columns menu lists them in this order) | Names | Notes |
|---|---|---|---|
| **Tasks** (Task Queue, Pod Work, My Work, Matter Tasks, Project tasks, My Matters, Dashboard lists, Search, Asset linked tasks) | Ref, Title (type icon in front, as the Task Queue does), Matter Number, Matter Name, Project, Priority, Assignee, Due, Status; optional: Progress, Type (name), Workflow, Pod, Creator, Requestor, Created, Updated, Closed, Age, On-hold reason | Ref, Title, Matter Number, Matter Name, Project, Priority, Assignee, Due, Status, **Progress** (one name, replaces "Workflow progress"), Type | A page that is already scoped drops the obvious column by default (Matter Tasks: no Matter Number/Name; My Work: no Assignee; Closed tab: Closed replaces Due) but the menu still offers it and the order of what remains does not change. Dashboard summary lists show Ref, Title, Matter Name, Priority, Due (a subset in the same order; add Status when the list is long). My Matters keeps its two-line "Title over matter" cell but as Ref + Title with the matter under it, then Priority, Assignee, Due, Status. |
| **Assets** | Name, Type, Matter Number, Size, Linked tasks, External reference, **Disposition** | Name, Type, Matter Number, Size, Linked Tasks, External Reference, Disposition | Matter Assets tab: same without Matter Number (Type moves after Name; today it is first). My Matters Assets: Name, Type, Matter Number, Created, Updated, Disposition. Search: same as the list. |
| **Matters** | CM Number, Name, Client, Primary PM, Secondary PM, Open tasks, Overdue, Status; optional On hold, At risk, Data size, Pending disposition | **CM Number** or **Matter Number**: pick one for the whole app (decision 5) | Matter number on task lists and search uses the same word |
| **Clients** | Client Number, Name, Matters, Open tasks, Overdue, Status | | Client column on Matters: "Client" with number and name in the same format everywhere |
| **Projects** | Name, Matter Number, Client, Open tasks, Overdue, Status | | Matter Projects tab drops Matter Number and Client |
| **Admin lookups** | Order (if ordered), Name, details, Used in/Open tasks, Status, row menu | | |

### 5.4 What to keep per page type

| Page type | Pages | Keeps | Does not need |
|---|---|---|---|
| **Work lists** | Task Queue, My Work, Pod Work, Matter Tasks, My Matters tasks | the full anatomy: Search, Filters, View/quick views, Columns, Density, Saved views and Export (Task Queue only), inline edit, bulk Select, sorted-by line | |
| **Record lists** | Clients, Projects, Assets, Matters, Matter tabs (Assets, Projects), My Matters Assets, Search per-type, Asset reports result | Search, Filters, Columns, sort, pager, bulk (Matters, Assets), "..." menu | Views, Density (optional) |
| **Admin lists** | Users, Roles, Pods, Task Types, Workflows, Steps, Asset Types, Reports | title (count), primary action, Search, Filters (status chips), sort, pager, "..." menu | Columns, resize (fixed short column sets) |
| **Admin lookups** | Priorities, Status labels, On-hold reasons, Notes tags, Link roles, Custom fields | title, primary action in the header (not in the tab body), tab count, the "Order" column as the sort | Search, Filters, Columns, pager (stay under about 20 rows; if one grows, it becomes an admin list) |
| **Logs and feeds** | Audit Logs, Matter Activities, My Matters Activity, Notifications | Filters/kind chips, date format rule, pager (replace "Load more") | Columns |
| **Embedded and side-panel lists** | Project tasks panel, Pod members, Dashboard summary lists, Asset/Project linked tasks | plain list with the standard column order (as a mini table with a header), "View all" link, no toolbar | the full toolbar |
| **Cards and calendars** | Notes board, Dashboard Swimlane, tree, calendar | own layout; same Search/Filters/Sort slots in row 2 where they apply | |

### 5.5 Constraints respected

No new or changed keyboard shortcuts (#420): sort by Enter on a header button, Columns and Filters are buttons, nothing is registered in `shortcut-registry.ts`. The grid stays in the fixed-page frame (`mf-grid-frame`). Tokens only (the mockup uses `docs/ux/tokens.css`). Dropdowns use the `mf-dropdown` look with the check at the right. Buttons follow guide section 9 (one 32 px size, primary filled, rest secondary, text and icon variants). Create and edit stay pop-up dialogs (section 6); side panels remain read-only detail. Sensitive-matter rules: none of this touches which rows a person may see; counts in the title use the same already-filtered totals.

## 6. Decisions the owner must make

Each has my recommended answer.

1. **Filter pattern**: A (standardise the inline row, one button), B (popover on all widths) or C? **Recommend A** for now.
2. **Search box**: always visible in every list toolbar and moving the Name/Title text box out of the filter row? **Recommend yes.**
3. **Sort**: header click everywhere plus a "Sorted by" line and Reset; Sort dropdown only on phone and Notes; retire the My Matters "Urgency" button? **Recommend yes.**
4. **One Columns menu** (the arrows menu, with density and task groups inside), retiring the older chooser panel, and Columns on every list with more than 5 columns? **Recommend yes**, in two steps (decision 12).
5. **The matter number word**: "CM Number" (Matters list today) or "Matter Number" (task lists today)? **Recommend "CM Number" everywhere** if that is what the firm says; otherwise "Matter Number" everywhere. Either way one word.
6. **Task column order**: Ref, Title, Matter Number, Matter Name, Project, Priority, Assignee, Due, Status; progress is called "Progress". OK? **Recommend yes**; moves Status to the end in My Matters.
7. **Last asset column name**: "Disposition" or "Status"? **Recommend "Disposition"** (avoids a clash with the task status) and Name before Type.
8. **Create buttons**: Title Case "+ New Client", "+ New Matter", "+ New Project", "+ New Asset" on every page; add "+ New Task" to the title row of Task Queue, My Work and Matter Tasks (the app-bar "Create task" stays)? **Recommend yes to both.**
9. **Count in the title** of every list (Task Queue 139, Clients 5)? **Recommend yes.**
10. **One page size**: default 50 on every pager (25/50/100, remembered per person), no "Load more" lists? **Recommend yes.**
11. **One date style** in lists. Today My Matters uses `10/10 01:00 PM` (guide section 8), the rest "Oct 21, 3:00 PM", Activities a UTC long date. **Recommend the My Matters style everywhere in lists** (one pipe) and the readable long form only in tooltips; say if you prefer the opposite.
12. **How much to do now**: phase 1 only (about 20 agent-hours, section 3 of `conversion-plan.md`), or the whole plan (about 105 agent-hours)? **Recommend phase 1, then decide on phase 2 after you have seen it.**
13. **Admin lookups** keep no search/filter/sort (small lists) but move the New button to the header. **Recommend yes.**
14. **Matter Tasks tab on a phone** becomes cards like all other lists. **Recommend yes.**
