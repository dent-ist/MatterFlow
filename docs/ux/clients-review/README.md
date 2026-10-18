# Clients, Matters and Projects: independent UX review

Scope: **Clients** (list, Client Details with its Details and Matters tabs), **Matters** (list and the Matters tab of a client), **Matter Details** (Details, Tasks, Projects, Assets and the Activity drawer), **Projects** (list) and **Project Details** (it has no tabs: a Tasks grid plus a collapsible Details panel). Shipped on `origin/dev` at `a6b0978`. Reviewed as a user would see it: real navigation, the production Angular build, the published API with Dev auth, SQL Server, Playwright Chromium. **No application code was changed and no issues were created.**

Screenshots: `screenshots/` (about 110 PNGs, `<name>-<width>x<height>.png`; 1366x768 unless the name says otherwise; 1920x1080, 768x1024 and 375x812 where it matters). `mock-*` files are small HTML mock-ups of recommendations (sources in `mocks/`); everything else is the shipped UI.

**Test data.** 40 clients (37 active), 156 matters, 187 projects, about 450 tasks on 12 matters and 4 projects, 60 assets. Edge cases on purpose: a client with 63 matters; a client name of 105 characters ("Meridian Pharmaceuticals International Holdings, Incorporated and its Subsidiaries and Affiliates (Americas Division)"); a matter name of 150 characters; a project name of 130 characters; a matter with 40 projects (some archived); inactive clients and matters, archived projects; a sensitive matter; clients and matters with nothing under them. Dark theme: the app has none (no `prefers-color-scheme` or theme code), so there is nothing to review; it is listed under "not verified".

Ranking key: **severity** blocker / major / minor / nit; **effort** in AI-agent hours (h).

---

## 1. Summary

These six screens are structurally sound: URL-driven filters, sort and paging (shared `ServerListPage`), the shared fixed-height page and tab pattern, `mf-tabs` with arrow keys, 0 axe violations (WCAG 2.2 AA plus best-practice) on 12 detail pages and 3 lists at 1366, 1920, 768 and 375 (60 scans), no page-level horizontal scroll at any width, honest empty, filtered-empty and error rows in the lists, and a clear "Set inactive" rule on Matter Details (disabled with the reason beside it).

What lets them down is that they are the **plain-table, plain-form half of the product**. Dashboard, My Work and Task Queue got a decided visual and behavioural language (sections T and U): a summary strip, one grid contract, fixed 44 px rows, phone cards, skeleton and state rows, one colour language. Clients, Matters and Projects were not part of it, so they feel like a different app:

- **They say nothing about the work.** Client Details is a 5-line definition list (number, name and status each shown twice, once in the header and once in the list). The client list has no open-task count, the matter list neither, the project list neither (UX spec S05 and S06 list "Open tasks" columns; the API does not return them for lists). A user who opens a client cannot tell whether anything is overdue.
- **Headers eat the screen when names are long.** The breadcrumb repeats the full record name, then the title repeats it again: a long matter name is a 3-line breadcrumb plus a 3-line title, **352 px of 768 before the tabs**; at 375 even a short matter name needs 362 px before the tabs and a long one 705 px (`matter-long-details-375x812`).
- **Project Details is the odd one out.** Client and Matter moved Details to the first tab (#244); Project still has the old right-hand Details panel, collapsed by default at 1366 so Edit, Archive and the description are hidden; when opened, it squeezes the Tasks grid until **the Status column is cut off** (`project-details-panel-expanded-1366x768`). At 768 the panel sits above the grid and pushes the first task to y = 686 of 1024.
- **No phone or tablet design.** The lists are raw tables (Matters is 477 px wide in a 343 px box, Status is off screen, the matter reference breaks at its hyphen into two lines); the work lists have had cards since WP13.
- **Small copy, state and focus gaps** that the work lists already fixed: "Loading clients..." text instead of skeleton rows, a generic "We couldn't find that client." for every failure including a server error, a name that is not a link, focus lost on Back.

### Top 10 findings, ranked by impact over effort

| # | Recommendation | Evidence | Effort | Findings |
|---|---|---|---|---|
| 1 | **One-line detail header**: breadcrumb truncates its last crumb (the title already says it), title is `ref  name` on one line with a 2-line clamp and a tooltip, actions collapse into one overflow below 768. Reclaims about 200 px at 1366 and 300 px at 375 for long names. | `matter-long-details-1366x768` (tabs at y 352), `matter-long-details-375x812` (tabs at y 705) | S-M, 8 h | H1, H2 |
| 2 | **Give Client, Matter and Project an Overview** (counts: matters, open tasks, overdue, ASAP, on hold; each a link to Task Queue with the scope filter), and delete the duplicated name, number and status rows. | `client-details-1366x768`, `mock-client-details-1150x560` | M, 14 h (incl. API counts) | C1, C2, MD1 |
| 3 | **Project Details gets the tab pattern** (Tasks, Details) like Client and Matter; no collapsible side panel. Fixes the hidden Edit/Archive, the clipped Status column and the 768 layout in one change. | `project-details-1366x768`, `project-details-panel-expanded-1366x768`, `project-details-768x1024` | M, 8 h | P1, BUG-4, BUG-5 |
| 4 | **Open and overdue counts in the three lists** (Open tasks, and Overdue shown as the shared red text when above 0), name as a second link, Matter name next to the reference in the Projects list. | `clients-list-1366x768`, `projects-list-1366x768` (25 rows of "Clawback and Redaction QC" with only a matter number) | M, 12 h (API + UI) | L1, L2, L3 |
| 5 | **Phone cards for the three lists** (one card renderer already exists for the work lists) and a scrolling, cue-bearing tab strip. | `matters-list-375x812`, `client-details-375x812` (fourth tab cut: "Asset") | L, 12 h | L7, T2 |
| 6 | **Grids inside Matter and Project use the shared grid contract**: no clipped Status at 1366 and 768, summary strip (Open, Overdue, ASAP, On hold) above the Tasks grid, Project column only when it adds information. | `matter-tasks-1366x768`, `project-details-768x1024` | M, 8 h | MD4, P2, P3 |
| 7 | **Honest errors and states**: 404 vs 5xx wording, a Retry only when retry can help, 5 skeleton rows (spec 5.2) and a header skeleton on detail pages instead of a bare "Loading the client...". | `client-details-not-found-1366x768`, `clients-list-loading-1366x768` | S, 5 h | BUG-1, BUG-2, L-series |
| 8 | **List chrome consistent with Task Queue**: filter row open by default (or one rule for all lists), "Other filters" for a single filter replaced by a Sensitive column or chip, Status as the shared filter control not a bare `<select>`, pager that does not wrap at 768. | `clients-list-filters-open-1366x768`, `matters-list-other-filters-menu-1366x768`, `matters-list-768x1024` | S-M, 8 h | L4 to L6 |
| 9 | **Matter Projects tab becomes useful**: natural sort ("Wave 7" before "Wave 15"), Open tasks per project, hide the empty Description column, Active/Archived filter, show archived last. | `matter-projects-1366x768` | S-M, 6 h | MD3 |
| 10 | **Keyboard and focus**: Back returns focus to the row left (it lands on `<body>`), 26 to 36 Tab stops before the first row, Esc and focus return audit, document titles that name the tab. | `kb` run, Section 5 | S-M, 6 h | K1 to K3 |

---

## 2. Findings by screen

### 2.1 Clients list (`/clients`)

Screens: `clients-list-1366x768`, `-1920x1080`, `-768x1024`, `-375x812`, `clients-list-filters-open`, `clients-list-search-long-name`, `clients-list-inactive`, `clients-list-no-match`, `clients-list-sorted-name-desc`, `clients-list-loading`, `clients-list-error`, `clients-list-empty`, `clients-list-focus`.

**What works.** Fixed header with the grid scrolling inside; "Showing 1-25 of 37 / Page 1 of 2 / First Previous Next Last" and Rows per page; sortable headers with `aria-sort`; filters in the URL; long names wrap to 2 lines and stay readable (`clients-list-search-long-name`); "No clients match these filters" with Clear filters; "No clients yet." with the New client action only when permitted; 0 axe violations at four widths; table box never scrolls the page.

**L1 (major, M): the list says nothing about the work.** Columns are Client number, Name, Matters, Status. The user's first question is "which clients have open or overdue work". The API returns `matterCount` only. Recommendation: add **Open tasks** (number) and **Overdue** (red text only when above 0, using the shared overdue colour and the word "overdue" so it is not colour-only), both server-side and sortable, defaults Client number, Name, Matters, Open tasks, Overdue, Status. Matches UX spec S05 ("Open tasks" column). 6 h with the API.

**L2 (minor, S): the name is not a link.** Only the 5-digit number is (`clients-list-1366x768`); in the Matters list only the reference; in Projects the name is the link. People click the name. Make the name the primary link everywhere and keep the number as a second link; the whole row is not a button, so keep the keyboard order (name, then number is a duplicate: give the number `tabindex=-1` or make it plain text with the name linked). 1 h.

**L3 (minor, S): default sort and density.** Rows are 40.5 px (comfortable spec value is 44 in the work grids; Matters and Projects are 48.5 px). Three list grids, three row heights (40.5, 48.5, 44). Adopt the shared 44 px row and the same cell styles (U: "Rows and lines"). 2 h (shared with the other lists).

**L4 (minor, S): the filter row is closed by default** behind a "Filters" button (right-aligned, alone on its own row, 40 px tall) while Task Queue, My Work and Pod Work open it by default (decision, Batch 3). The toolbar row exists only for that one button and costs 52 px. Recommendation: open by default on desktop (like the work lists) and put the "Filters" button in the page header row on phones. 1 h.

**L5 (minor, S): Status filter is a bare `<select>` defaulting to Active** with no hint of what is hidden (`clients-list-filters-open`); 3 inactive clients are invisible and the count "37" does not say so. Use the shared status filter style and, when Active is the default, a muted line in the pager "37 active - 3 inactive hidden". 2 h.

**L6 (minor, S): chip rule.** With the filter row open, "Filters (1)" and a separate "Clear filters" link both show (`clients-list-search-long-name`); with the row closed there are no chips. Task Queue shows chips when the row is closed (U, one chip rule). Align. 2 h.

**L7 (major, L): phone.** At 375 the table is 386 px in a 343 px box, Status is cut off ("Ac"), and the 56 px rail is a Menu button already. Use the work-list card pattern: line 1 name (2-line clamp), line 2 `00107 - 63 matters - 14 open`, status badge top right. 12 h for all three lists together (finding L7 is shared with Matters and Projects).

**L8 (nit, S): tablet.** At 768 the pager wraps and "Last" sits alone on a second row (`matters-list-768x1024`); Rows per page, Showing and the four buttons need 560 px. Put Rows per page and Showing on one line and the buttons on the next at below 900, or drop First and Last under 900 (Page x of y stays). 1 h.

**L9 (verified good): long names, 1920.** At 1920 the Name column is 682 px and the table reads well; the grid does not stretch rows. No change.

### 2.2 Client Details (`/clients/:id`): Details tab and Matters tab

Screens: `client-details-1366x768` (and 1920, 768, 375), `client-matters-*`, `client-long-details-*`, `client-long-matters-*`, `client-details-loading`, `client-details-not-found`.

**What works.** Details is the first tab (#244), `?tab=matters` deep-links, filters and paging leave the URL when the tab changes, Edit and Set inactive are permission-gated and the confirm dialog says the consequence, Activity opens as a drawer (`matter-activity-drawer-1366x768`).

**C1 (major, M): Details tab is nearly empty and repeats the header.** 1366x768: breadcrumb says `00107 Hartwell & Bryce LLP`, the title says `00107 Hartwell & Bryce LLP` with an Active badge, and then the tab lists Client number `00107`, Name `Hartwell & Bryce LLP`, Status `Active` again, plus Created. Four of five rows are the title. 70 % of the tab is empty. Recommendation: rename the tab **Overview** (URL stays `?tab=` absent for compatibility), start with the strip (Matters 63, Open tasks, Overdue, ASAP, On hold, each a link: `/tasks?client=00107&view=overdue`), then "Matters with the most open tasks" (top 5, links), then a muted line `Created Oct 18, 2026 - Last changed ...` and the custom fields. See `mock-client-details-1150x560.png`. Reuse the My Work strip component (T, #153). 10 h including the counts endpoint (`GET /clients/{id}/summary`).

**C2 (minor, S): the tab labels carry no counts** while Matter Details has `Tasks (17)`, `Projects (1)`. Client: `Matters (63)`. Needs `matterCount` which the client response already has. 1 h.

**C3 (minor, S): Edit and Set inactive sit in the tab, not in the header,** while on Matter Details, Activity, New project and Create task are in the header. Header: `Edit`, `Activity`, overflow `...` with Set inactive/active; keep Edit/Set inactive out of the page body on all three details pages. Needs one rule: **primary creation action in the header, record maintenance in the overflow**. 3 h (shared with H1).

**C4 (minor, S): Matters tab uses the generic list.** It repeats the Matters list columns (Matter, Name, Projects, Status) without Client (correct) and without Open tasks, with the Create matter button left and Filters right (`client-matters-1366x768`). Same recommendations as 2.3 (L-series applies). Create matter when the client is inactive: check it is disabled with the reason; it was not exercised (inactive client 00149 not opened with permissions removed).

**C5 (major, M): long client name.** At 1366 the title is 5 lines (147 px) and the tab list starts at y 244; at 768 the h1 is 176 px (`client-long-details-768x1024`); at 375 312 px (the grid then starts below the fold: y 688). Fix in H1.

**C6 (minor, S): inactive state.** An inactive client shows an "Inactive" badge in the header (fine) but the Matters tab still offers Create matter enabled; the spec says new matters are blocked ("[UX-PROPOSAL: inactive Client blocks creating new Matters]"). Confirm what the API does; if blocked, disable the button with the reason text (rule 5.7). 1 h.

### 2.3 Matters list (`/matters`) and the Matters tab of a client

Screens: `matters-list-1366x768` (and 1920, 768, 375), `matters-list-other-filters-menu`, `matters-list-long-name`, `matters-list-inactive`, `matters-list-loading`, `matters-list-error`, `matters-list-empty`, `client-matters-*`.

**What works.** Reference in the mono face, copy-to-clipboard button with the name "Copy matter number", Sensitive badge with a lock icon and text, client link `00107 Hartwell & Bryce LLP`, inactive status is grey with an icon, empty row "No matters yet." with an action.

**M1 (major, M): no Open tasks column** (spec S06 has Open tasks and Assets; only Projects was built, and a project count is rarely what a lawyer is asking). Replace Projects with **Open tasks** and **Overdue**; keep Projects in Matter Details. Same API work as L1.

**M2 (minor, S): the "Other filters" button holds one item** (`matters-list-other-filters-menu`: "Add a filter: Sensitive"). A toolbar button, a menu, then a chip, for one yes/no. Make Sensitive a column filter in the filter row (a small icon column "Sensitive" is not needed; filter a Yes/No select) or a checkbox beside Status. Removes a button from the toolbar. 2 h.

**M3 (minor, S): the copy button doubles the Tab stops** (two per row: reference link, copy button). 25 rows = 50 stops. Acceptable for a power-user action but make the copy button appear on row hover/focus-within and keep it a Tab stop only inside the focused row, or move copy to the detail header only (it is there). 2 h.

**M4 (minor, S): the reference breaks at the hyphen** at 768 and 375 (`00107-` / `00001` on two lines, `matters-list-768x1024`). `white-space: nowrap` on the reference; the column is 129 px at 768. 0.5 h.

**M5 (nit): the 1366 columns** are Reference 175, Name 489, Client 236, Projects 90, Status 107: Name is the right spring. Long matter names wrap to 3 lines (`matters-list-long-name`: 150 chars = 3 lines, 70 px row): acceptable with a 2-line clamp and tooltip.

**M6 (major, L): phone** as L7.

### 2.4 Matter Details (`/matters/:id`): Details, Tasks, Projects, Assets, Activity

Screens: `matter-details-*`, `matter-tasks-*`, `matter-tasks-many-rows-1366x768`, `matter-projects-*`, `matter-assets-*`, `matter-long-details-*`, `matter-long-tasks-*`, `matter-activity-drawer-1366x768`, `matter-details-not-found`.

**What works.** Tabs with counts (`Tasks (17)`, `Projects (1)`), Create task in this matter as the single primary action, Sensitive banner as `role=note` text + icon, a reasoned disabled "Set inactive" ("This matter has 17 tasks that aren't Completed or Cancelled. Finish or cancel them first."), arrow keys move between tabs and activate (verified).

**H1 (major, S-M): the header costs too much and duplicates itself.** 1366, short name: breadcrumb (28 px), title row with icon, 28 px mono reference, copy button, name, badge and three buttons (56 px), Client line (30 px), then, for a sensitive matter, a 44 px banner: the tabs start at y 174 of 768 (y 246 with the Sensitive banner, `matter-details-1366x768` is a non-sensitive matter; the banner is in the Matter 00107-00001 page). The crumb's last item is the same text as the title. Recommendation (applies to Client, Matter, Project):
- Breadcrumb last crumb: truncated to one line with an ellipsis (max 40 characters visible), full text in the `title`. Or drop the last crumb (the title is the current page; WAI breadcrumb allows it).
- Title: `ref  name` on one line, `font-size: 22px` (the h1 token, spec 4.2 says H2 22 / H1 28; the mono 28 px reference is why the title wraps), name clamped to 2 lines with a tooltip; client moves into the same line as a muted suffix `Client 00107 Hartwell & Bryce LLP` that wraps below on narrow widths.
- Sensitive banner: keep text, make it a 32 px single line, or move to a "Sensitive" badge in the header with the sentence in its tooltip (the Details tab already says "Sensitive: Warning only").
Result at 1366 for the long matter: tabs at about y 190 instead of 352. See `mock-project-details-1150x560.png` for the header shape. 6 h.

**H2 (major, S): phone header.** At 375 the header is stacked: crumb, icon (its own line), 28 px reference, 28 px name, badge, Activity, New project, Create task: tabs at y 362 (matter) and 513 (client), grid starts at 525 to 690 of 812 (`matter-tasks-375x812`). Header at phones: one row `ref  name` clamp 2, badge, a primary action and an overflow; the icon sits inline. 4 h (with H1: 8 h total).

**H3 (minor, S): the "Details" tab title.** Matter Details is a list of 8 rows (Matter reference, Client, Matter number, Name, Status, Sensitive, Created); the reference appears three times (title, crumb, row), Matter number is the second half of the reference, Name is the title. Reduce to Client, Sensitive, Status, Created, Last changed, custom fields, plus the overview strip (C1). 3 h.

**MD1 (major, M): the Tasks count is the only number.** Add the strip (Open, Overdue, ASAP, On hold) over the Tasks grid; same component and data as the My Work strip; clicks apply grid filters. 6 h (shared with C1).

**MD2 (minor, S): Tasks grid columns.** Ref, Title, Project, Priority, Assignee, Due, Status at 1366: fine, 22 rows, 44 px, due cell is the shared cell (good, `matter-tasks-many-rows-1366x768`). The Project column wraps "Demo Custodian wave 1" into two lines in a 100 px column; clamp to 1 line with tooltip; hide when the matter has no projects. At 768 the grid scrolls sideways with a hint (decided, section U): ok, but Matter is not in this grid and the Status is still off screen at 768: put Status before Assignee on tablets? Decision U says tablets scroll sideways; so only add a sticky Ref (already) and leave. 1 h.

**MD3 (major, S-M): Projects tab is a bare list.** 40 rows: "Wave 15, 23, 31, 39, 7" (text sort, no natural sort), an always-empty Description column (`matter-projects-1366x768`), archived and active mixed with an "Archived" pill (grey, correct) but no filter and no per-project counts. Recommendation: Name (link), Open tasks, Overdue, Status; natural sort ("Wave 7" before "Wave 15"); Active first, Archived under a collapsed "Archived (7)" group; description as a tooltip or a muted second line only when non-empty; the New project button stays in the header. 6 h.

**MD4 (minor, S): Assets tab** is fine as a list (Name, Type, External reference, Status; 5 rows); External reference is empty for every row of the seed: collapse empty columns? No: keep it and show an en dash. The "New asset" button is in the tab, "New project" in the header: pick one rule (header for create actions of the matter, with an overflow if more than three). 2 h.

**MD5 (nit, S): the long-name case** at 1366: the Client line and 3-line title are fine individually but with the 3-line crumb they take 352 px; see H1.

### 2.5 Projects list (`/projects`)

Screens: `projects-list-1366x768` (and 1920, 768, 375), `projects-list-long-name`, `projects-list-archived`, `projects-list-loading`, `projects-list-error`, `projects-list-empty`.

**What works.** Name is the link; archived shows "Archived"; the filtered-empty row; long names wrap to 2 lines without breaking the grid (`projects-list-long-name`).

**L10 (major, S): a project name alone does not identify a project.** 25 rows of "Clawback and Redaction QC", each with a bare matter number (`projects-list-1366x768`). The list needs the matter's name and client next to the reference (two-line cell `00121-00005` over `Second Request Response`; Client name as a column at 1366 and above) and the project's open-task count. Same Matter cell as the Task Queue (decision U, "Matter is a two-line cell"). 5 h with the counts (L1).

**L11 (minor, S): no "New project" empty action,** correct (a project needs a matter), but "No projects yet." gives no direction. Copy: "No projects yet. Open a matter and choose New project." with a link to Matters. 0.5 h.

**L12 (minor): chrome as L3 to L6.**

### 2.6 Project Details (`/projects/:id`): Tasks grid and Details panel (there are no tabs)

Screens: `project-details-1366x768`, `project-details-panel-expanded-1366x768`, `project-details-1920x1080`, `project-details-768x1024`, `project-details-375x812`, `project-long-*`, `project-details-not-found`.

**What works.** Tasks grid with the shared due and status cells, Create task disabled for archived projects (the code shows the archived banner), Details panel contains Edit and Archive with a reasoned confirm dialog, 1920 shows everything at once (`project-details-1920x1080`) and reads well.

**P1 (major, M): Project did not get the #244 treatment.** Client and Matter: Details tab first, grid full width. Project: Tasks left, collapsible Details right (`DETAIL_XWIDE_QUERY` = 1400 px is the first width where it is open). At **1366** it starts collapsed: the Details panel is a 130 px white slab with only "Details <" (`project-details-1366x768`); Edit, Archive, Description and Status are hidden until the user finds the chevron; the choice is remembered globally in `localStorage` (`mf.detail-panel.open`). Recommendation: tabs **Tasks (n)** and **Details**, like the others; Edit and Archive in the header; Matter shown once under the title. See `mock-project-details-1150x560.png`. 8 h.

**P2 (major, S): the open panel clips the Status column** (`project-details-panel-expanded-1366x768`: "In Progr", "On Hold" cut, no scroll cue; the Title wraps to two lines on every row). This is the same defect as My Work BUG-14 (hint missing when the box is narrower than the table). Fixed by P1; until then the hint must show whenever the table is wider than its box. 1 h standalone.

**P3 (major, S): 768.** The panel moves above the grid as an open disclosure (240 px), Tasks starts at y 686 of 1024 (`project-details-768x1024`), and Status is off screen behind "Scroll sideways to see every column". P1 fixes it.

**P4 (minor, S): duplicated content.** Header shows `Matter: 90001-80001 Demo Smith v. Acme` and the Details panel shows Matter again; Name repeated; Description "No description" for most projects (noise). In the Details tab: Matter, Description (only when set), Status, Created. 1 h (in P1).

**P5 (minor, S): long name** 130 chars: title 4 lines (114 px) at 1366, 142 px at 768, 308 px at 375 (`project-long-375x812`; the grid starts at y 813, i.e. below the fold). H1.

**P6 (minor, S): the Tasks grid has no summary strip and no per-grid quick view.** Same as MD1.

---

## 3. Cross-cutting consistency

1. **Header pattern.** Three detail pages, three header compositions (Client: number+name+badge, Activity; Matter: adds copy, Client line, three buttons, optional banner; Project: name only, Matter line separate, Activity). One component `mf-record-header`: crumb (last crumb truncated), `ref  name` title, badge, muted context line, primary action, overflow. Spec 5.1 only says "Breadcrumb, Page title (H1), [Primary action] [Secondary v]".
2. **Where do actions live?** Client: Edit/Set inactive in the tab. Matter: Edit/Set inactive in the tab, Create task/New project in the header. Project: Edit/Archive in the side panel. One rule: create in header, maintenance in an overflow menu in the header.
3. **Tabs.** Client: Details, Matters (no counts). Matter: Details, Tasks (n), Projects (n), Assets. Project: no tabs. Counts everywhere (zero shown muted), Details/Overview first, fixed-height tab pattern kept.
4. **Lists.** Three lists with three row heights (40.5, 48.5, 48.5 px; the work grids are 44), a closed filter row, a bare status `<select>`, no counts of work, no phone layout. They should use the grid contract of section U (44 px rows, header cells, chip rule, "Other filters" only when two or more).
5. **Colour language.** Only badges (Active, Inactive, Archived, Sensitive) are used; they are correct and not colour-only. Once Overdue and Open counts exist, reuse the shared red-with-word overdue text and the My Work strip tile; nothing new.
6. **States.** Work lists: skeleton rows, "Couldn't load tasks." with a reference, state-specific empty text. These lists: one text row "Loading clients...", "Couldn't load clients." with Retry (no error reference), details pages show only a dashed "Loading the client..." box with no header at all, and one message for every failure (BUG-1).
7. **Drill-in context.** Drilling from a list to a detail page and Back keeps filters and sort (URL) but not the focus (lands on `<body>`) and (Back from a client's Matters tab to the client list was not exercised.) Same `from`/focus-return as My Work (#160).
8. **Copy.** "Create matter" (client tab) vs "New matter" (list) vs "+ New project" (matter header) vs "Create task in this matter": pick "New X" for all and "Create task" for tasks. Spec 8.1 says "New Client"; the shipped label is "New client" (sentence case, correct per spec 8), so only the client tab's "Create matter" is wrong.
9. **Theme.** None; tokens are semantic, so a future dark theme should not need page work.

---

## 4. Bug list (with repro)

Environment: `origin/dev` `a6b0978`, Playwright Chromium 1366x768, Dev auth, `America/New_York`.

| ID | Sev | Bug | Repro | Expected |
|---|---|---|---|---|
| BUG-1 | major | **Every load failure of a detail page reads "We couldn't find that client/matter/project." with a Retry,** including a 500 or a lost connection; a real 404 also gets a Retry that cannot work. The catch-all in `load()` does not look at the status. | `/clients/99999` (`client-details-not-found`); or make `GET /clients/1` return 500. | 404: the shared 404 page (spec 5.6). 5xx/network: "Couldn't load this client." with Retry and the error reference. |
| BUG-2 | minor | **Detail pages show a bare "Loading the ..." box with no header or tabs,** so the page jumps when the data arrives (the breadcrumb appears late). | Open a client from the list on a slow request (`client-details-loading`). | Header and tab skeleton, or keep the crumb from the router (the id is known). |
| BUG-3 | minor | **Focus is lost on Back:** after opening a client from the list and pressing Back, `document.activeElement` is `<body>`. | `/clients?name=a&size=100`, open a row, Back. | Focus on the link of the row left (like Task Queue). |
| BUG-4 | major | **Project Details hides Edit, Archive and Description at 1366 (the Details panel starts collapsed)** and the choice is stored globally. | `/projects/1` at 1366 (`project-details-1366x768`). | Visible without a hunt (P1). |
| BUG-5 | major | **Project Details with the panel open clips the Status column with no scroll hint.** | Same page, click Details (`project-details-panel-expanded-1366x768`). | No clipping, or the hint (P2). |
| BUG-6 | minor | **Matter reference breaks at the hyphen at 768 and 375** in the Matters list and the client's Matters tab. | `matters-list-768x1024`, `client-details-375x812` matters tab. | `white-space: nowrap` on the reference. |
| BUG-7 | minor | **Tab strip is cut at 375 with no cue:** the fourth Matter tab shows as "Asset" and the strip does not show it scrolls. | `/matters/60` at 375 (`matter-details-375x812`). | Scroll cue (fade/chevron) or wrap to two rows; same fix as the My Work tab strip. |
| BUG-8 | minor | **Pager wraps at 768: "Last" alone on a second row.** | `matters-list-768x1024`. | One row, or First/Last dropped under 900 px. |
| BUG-9 | minor | **Long names are never clamped:** the breadcrumb repeats the full name (3 lines) and the title takes up to 383 px. | `/matters/155` at 1366 (352 px before the tabs) and 375 (705 px). | H1 recommendation. |
| BUG-10 | minor | **Matters tab lists "Wave 15" before "Wave 7"** (text sort). | `/matters/6?tab=projects`. | Natural sort. |
| BUG-11 | nit | **Description column is empty on every row** of the Projects tab and is still a column. | Same. | Hide when empty. |
| BUG-12 | nit | **"Create matter" on a client's Matters tab and "New matter" on the list** name the same action differently. | `client-matters-1366x768`. | One label. |
| BUG-13 | nit | **Document title** for lists is "Clients", for details the record text; the tab is never named ("Hartwell & Bryce LLP: Matters"). | Browser tab on `?tab=matters`. | Name the tab (same as My Work M8). |
| BUG-14 | minor | **"Clear filters" appears twice at once** (toolbar link and the Filters button counter) when the filter row is open, while an Active default Status filter is applied but never counted or shown as a chip. | `clients-list-search-long-name`. | One chip rule (decision U). |

Verified and **no defect found**: the shown row totals equal the API totals for the three lists, tab counts on Matter Details equal the grid totals (17 open tasks, 1 project, 40 projects), filters/sort/page live in the URL and survive reload, the client's Matters tab filters leave the URL when the tab changes, all 60 axe scans return 0 violations, no page-level horizontal scroll at 375, 768, 1366 and 1920.

---

## 5. Keyboard, focus and accessibility basics

- **Tab stops before the first row:** Clients 26, Matters 28, Projects 26, client Matters tab 30, matter Tasks tab 36, project Tasks 35 (the System Admin rail is 14 of them; skip link exists). Same relaxed target as decision U, but for lists with no row keys it is worth a "Skip to table" link after the filter row. 2 h.
- **Tabs** use roving tabindex with Arrow keys that select and update the URL (verified on Matter Details). Home/End are listed in the spec, not exercised.
- **Focus ring:** the 2 px amber ring is visible on links and buttons (`clients-list-focus-1366x768`).
- **Names and roles:** sort buttons have `aria-sort`; the filter button has `aria-expanded` and `aria-controls`; the copy button is named "Copy matter number"; badges have text and icon.
- **K1 (minor, S):** focus not restored on Back (BUG-3). **K2 (nit, S):** document title does not name the tab (BUG-13). **K3 (minor, S):** matter list has two Tab stops per row (reference, copy). 4 h together (K1 to K3 and the skip link).
- Not checked with a screen reader (see Section 7).

---

## 6. Proposed work packages and order

Estimates are AI-agent hours including tests and screenshots. Suggested order is dependency first, then user value.

| WP | Package | Contents | Findings | Est. |
|---|---|---|---|---|
| WP-1 | **Bugs and state fixes** | 404 vs failure messages with reference (BUG-1); header/crumb skeleton (BUG-2); focus on Back (BUG-3); nowrap reference (BUG-6); pager at 768 (BUG-8); natural sort (BUG-10); empty column (BUG-11); labels (BUG-12); tab titles (BUG-13); skeleton rows in lists | BUG-1..3, 6, 8, 10..13 | 12 h |
| WP-2 | **Record header** | `mf-record-header`: crumb truncation, one-line title, action rule (create in header, maintenance in overflow), phone header, sensitive banner on one line | H1, H2, H3, C3, C5, P5, BUG-9 | 10 h |
| WP-3 | **Project Details tabs** | Tasks (n) and Details tabs, Edit/Archive in the header, remove the collapsible panel (keep `mf-detail-layout` for Task page), 768 and 375 | P1 to P4, BUG-4, BUG-5 | 8 h |
| WP-4 | **Counts API and overview strip** | open/overdue/ASAP/on-hold counts for client, matter and project; strip component shared with My Work; Overview content on Client and Matter, tab counts on Client | C1, C2, MD1, P6 | 16 h |
| WP-5 | **List columns and chrome** | Open tasks and Overdue columns (sortable), name links, Matter two-line cell and client in Projects, status filter, filter row open, "Other filters" removal, 44 px rows, chip rule, empty copy | L1 to L6, L10, L11, M1 to M3 | 14 h |
| WP-6 | **Matter tabs** | Projects tab (natural sort, counts, archived group, description rule), Assets and Tasks tab polish, Tasks Project column | MD2 to MD4 | 8 h |
| WP-7 | **Phone and tablet** | Card renderer for the three lists (reuse the work-list renderer), tab strip scroll cue, tablet pager | L7, L8, M6, BUG-7, BUG-8 | 12 h |
| WP-8 | **Keyboard and a11y pass** | skip to table, copy button rule, tab titles, Home/End check, e2e tests for all of the above, axe at 4 widths | K1 to K3 | 5 h |

**Total: 85 agent-hours.** Suggested order: WP-1 (independent, low risk), WP-2 (unblocks WP-3 and WP-7), WP-3, WP-4 (API) then WP-5 in parallel with WP-6, WP-7, WP-8. If the owner wants a cut: WP-1, WP-2, WP-3 (30 h) fix everything that is broken or hidden today; WP-4 and WP-5 (30 h) are the feature value; WP-7 is the phone.

Product decisions needed before issues: (a) Overview as the tab name instead of Details (URLs stay), (b) whether the Client Overview shows tasks across all matters (needs the counts endpoint), (c) whether an inactive client blocks Create matter (UX-PROPOSAL in the spec), (d) whether Project Details may drop the side panel layout (it is used by the Task page, which keeps it).

---

## 7. What I did NOT verify

- A real screen reader, Windows high contrast, 200 % and 400 % zoom, print, browsers other than Chromium, a real phone (375 was emulated), dark theme (none exists).
- Create and Edit forms for Client, Matter and Project (only opened the Client edit page for a screenshot; they are out of the requested scope), custom-field rendering on the detail pages (no custom fields were defined), the Matter "Set inactive" dialog and the New project and New asset dialogs.
- Role-based variants (a user with only `Client.View`, no `Matter.View`): My Work review found Matter links going to a 403; I did not repeat that check for the client's Matters tab and the Project crumb.
- Lists with more than 187 rows, slow networks other than the hung request used for the loading shots, concurrent edits.
- Task counts per client and matter are inferred from the API for 12 matters; the seeded tasks only sit on 12 matters and 4 projects, so most lists have zero open tasks, which also hides how a good Open tasks column would look; the "many rows" check for a project is 16 tasks and for a matter 22.
- Real firm data (names, number ranges) and real usage: priorities are the reviewer's judgement from the documented personas.
