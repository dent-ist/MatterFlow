# Dashboard > Users tab (issue #73, epic #68)

The fifth Dashboard tab shows the team's **workload** as one small tile per person (the firm has 100+ technicians), and (for people with `Dashboard.ViewCoverage`) a **Coverage** view: how many tasks each person completed per task type, for training and cross-coverage planning. Specification: `docs/ux/ux-spec.md`. Backend: `GET /api/v1/dashboard/workload` and `GET /api/v1/dashboard/coverage` (`docs/architecture.md` 8.5). Decision for the completion counts: `docs/requirements/decisions-addendum.md` section Q.

Screenshots were taken by `frontend/e2e/tests/users-screens.spec.ts` against the real stack (SQL Server in Docker, the published API with Dev auth serving the production Angular build, Chromium): **120 people** with the mix of a real firm (about a fifth idle, most with a light or normal load, twelve heavy, twelve out of office, six off hours, two pods), unassigned tasks, and a small coverage history. The accounts of the throwaway database have machine names, so the screenshot run swaps the display names in the workload response for ordinary sample names (nothing else is changed). Reproduce with:

```bash
E2E_SCREENSHOTS=docs/ux/dashboard-users frontend/e2e/run-local.sh -g "users screenshots"
```

## Before and after (issue: "100+ technicians, a big card is not practical to monitor")

| | Before (cards) | After (tile) | After (dense tile) |
|---|---|---|---|
| One person | 358 x 248 px = 88,800 px2 | **130 x 60 px = 7,800 px2** | 134 x 26 px = 3,500 px2 |
| Area compared with the card | 1 | **0.088 (about 1/11)** | 0.039 (about 1/25) |
| People per line at 1366 px | 3 | 8 | 8 |
| 120 people, height of the grid | about 10,300 px (more than 13 screens) | 1,010 px | 446 px (fits one 1366x768 screen under the toolbar) |
| Drawn at first | 60, "Show more" | 200, Show more or Show all (icons) | same |

Measured in Chromium at 1366 x 768 (the card from the old `01-cards-1366.png` screenshot, the tiles by `getBoundingClientRect` in the screenshot run, which prints them). The request was about a quarter of the old area; the tile is much smaller than that because the people, not the facts, are what a coordinator scans, and everything else moved into colour, shape, the tooltip and the drawer. At narrower widths the grid keeps the same tile and drops columns (two per line at 375 px).

## What the screens show

| File | What it shows |
|---|---|
| `00-tile-anatomy-2x.png` | A close-up (200%) of tiles: the pill with level glyph and count, the overdue clock, the heavy mark, the split bar and the Assign icon on hover. |
| `01-cards-1366.png`, `-1024`, `-375` | The Workload view with 120 people: toolbar (icons), quick filter chips, tiles. 1366: eight to a line. 375: two to a line. |
| `02-pod-filter-*` | Filtered to one pod (`upod` in the address). |
| `03-dense-1366.png` | Dense tiles: one row each, all 120 people on one screen. |
| `04-table-1366.png` | The table view (state as an icon with a name, an icon button for Assign). |
| `05-legend-1366.png` | The legend panel: pill colours with their level glyph, idle and out of office, the marks, load thresholds, what the view is not. |
| `06-drawer-1366.png` | A person's open tasks (inline Status, Priority and Assignee menus with Undo), icons for "Open in Task Queue" and "Assign work". |
| `06b-assign-heavy-hint-1366.png` | The assign picker with the visible hint for a heavily loaded person. |
| `07-coverage-*`, `08`, `09`, `10` | The Coverage view (heat map, absolute scale, Training gaps, the tasks behind one cell). |
| `11-error-1366.png` | The error state with reference and Retry (an icon). |
| `12-filter-chips-1366.png` | The Idle and Heavy chips on together (any of the chosen levels). |
| `13-out-of-office-1366.png` | The Out of office chip: hatched grey tiles. |

## The tile

```
+--+-----------------------------+
|# | Name Surname           [+]  |   row 1: the name, truncated; [+] = Assign icon on hover or focus
|# | (|||| 7)          (clock 2)(!)|   row 2: pill = priority glyph + open count; marks: overdue, heavy, off hours
|# | [=====|====|===    ]        |   row 3: the load bar, split by priority (full = a Normal load or more)
+--+-----------------------------+
 ^ left edge in the priority colour
```

No sentences on a tile. The state is colour, shape and an icon; the words are in the accessible name and the tooltip (`title`) of the name button: *"Kofi Patel. Off hours. 10 open tasks, highest priority Critical, 2 overdue, 1 due soon, heavy load"*, *"Ana Diaz. Out of office until Nov 3. Annual leave. 2 open tasks, highest priority High, light load"*, *"Ben Khan. No open tasks"*.

| State | Look | Not colour alone |
|---|---|---|
| Highest open priority | Pill and left edge in the colours of the priority badge (token `critical`, `high`, `normal`, `low` or a `#RRGGBB` override, so renamed and recoloured priorities follow) | A glyph of four bars filled by rank (4 = most urgent, 1 = least), the same shape as the priority badge, and the count |
| Idle (no open tasks) | Green tile, green edge, a check icon, an empty dashed bar | Icon, dashed outline, no count |
| Out of office | Hatched grey tile, dashed outline, a calendar icon (and the open count when there is work) | Hatching, dashed outline, icon |
| Off hours | A moon mark | Icon |
| Overdue work | A red clock with the number | Icon and number |
| Heavy load | A red outline on the tile and a triangle mark; the bar is full | Outline, icon, bar |

Only the theme tokens and the priority badge colours are used (no new colours), and axe's colour contrast check passes on the tiles, the chips and the legend. The app has no dark theme yet; a theme would reach the tiles through the same tokens.

## Filters and legend

Quick filter chips under the toolbar (toggles with `aria-pressed`, a selected chip is also underlined). They are the first part of the legend, so the colours are learned where they are used:

- **Idle**, **Light**, **Normal**, **Heavy**: the load levels (thresholds `Dashboard:Workload:LightMax` 3 and `NormalMax` 8, in each chip's tooltip and in the legend). They combine (any of the chosen levels) and are applied on the page (`uload=idle,heavy`). Idle is everyone with nothing open, including someone out of office.
- **Out of office** and **Off hours**: the availability filter (`uavail=out`, `uavail=off`; off hours is applied on the page, the API is asked for all).
- **Unassigned**: an icon link to the Task Queue with the count (open tasks nobody has).
- Each chip shows how many people it holds in the current pod and name filter.

Toolbar: search by name, **Pod**, **Highest priority** (`uprio`, people whose highest open priority is the chosen one), **Availability** (All, Available, Off hours, Out of office), **Sort** (Availability and load, Name, Highest priority, Open tasks), then icon buttons: clear filters (with the number of filters), tile size (standard or dense), cards or table, legend and help. The Workload or Coverage switch sits in the same icon group. Everything has an `aria-label` and a `title`; icon targets are 32 px (tile Assign icon 24 px).

The legend (the info icon) opens a panel with the pill colours and their level glyphs, the idle and out of office looks, the marks, the load thresholds, a hint to hover or focus a tile for its whole status, and what the view is not.

## Decisions

- **Colour follows the highest priority, with a shape.** The same colour pair as the priority badge, plus the four-bar glyph by rank, so Critical, High, Normal and Low are told apart without colour. Idle is green, out of office is hatched grey; off hours is a small mark and does not change the tile.
- **Segmented load bar** split by priority (legend order) along the bottom of the tile. The track is as wide as the Normal ceiling, or as the open total when there are more tasks than that.
- **Operational framing.** The Workload view has no completion counts, speed, ranking or performance measures, and says so in the legend (the always-visible sentence was removed to give the room to the tiles). The Coverage view is the one exception, decided by the product owner (addendum Q) and gated by its own permission.
- **Filters:** pod, availability and name are sent to the API; load, highest priority and off hours are applied on the page (no new read). All are in the address and cleared when another tab is chosen. Sort, tile size and the view are remembered per user (guarded `localStorage`).
- **Keyboard model.** Deliberately simple, as before: the tiles are an ordinary list in reading order with the normal tab order. A tile has two tab stops, the person's name (a button that opens the drawer; its click area is the whole tile, with a visible focus ring) and the Assign icon. The Assign icon is revealed on hover and on keyboard focus of the tile (it is always reachable by Tab); on a touch screen it is hidden and the drawer has it. The name is not a heading, so a screen reader does not meet 120 headings. The accessible name of the button starts with the visible name and then gives the state in words.
- **Drawer.** A modal right-hand drawer like the Swimlane one: focus moves to Close, is trapped, Esc returns it to the tile. It lists the person's open tasks from the Task Queue (priority then age, 50 at a time) with the inline menus and Undo; "Open in Task Queue" and "Assign work" are icon buttons with names and tooltips.
- **Assign work.** From the tile (icon) and the drawer: a modal picker of unassigned open tasks, highest priority first then oldest, with a search box and an Assign icon per row. It uses the existing assign call and rules (assigning starts a New task) and offers Undo. A visible hint appears when the person is out of office or Heavy; assigning is still allowed.
- **Many people.** 200 tiles are drawn at first (Show more adds 200, Show all draws the rest; icon buttons with the count in the sentence next to them). A tile is about twenty small elements and no per-tile subscriptions, so 450 people were drawn in the unit test without trouble.
- **Refresh.** The refresh icon sits in the Dashboard's tab row (as on the Swimlane tab) and reads the tiles or the coverage matrix again. The Workload view also refreshes itself every 5 minutes while the tab is visible, skipped while a menu, the drawer or a dialog is open, and it never moves focus. A failed background read keeps the tiles and shows a banner with a Retry icon.
- **Phone.** At 375 px the tiles are two to a line, the chips are one line that scrolls sideways inside itself, and the toolbar wraps.

### Coverage view

- **Where:** a "Workload | Coverage" switch at the top of the tab (only with `Dashboard.ViewCoverage`), `?tab=users&view=coverage`, remembered. Reaching it needs the Users tab permission (`Dashboard.ViewUsers`) as well; the server needs `Dashboard.View` + `Dashboard.ViewCoverage`.
- **Heading:** "Task type coverage - use this to plan training and cross-coverage, not to rank people". No score, no "best / worst" wording; ordering by total is labelled "By total completed".
- **The table:** a real table. Rows are task types (icon and name), columns are people (initials and name; Inactive and Out of office are small markers), the last column is Total and "People who handled it" (fewer than two is highlighted), the last row is the column totals. The first column and the header row are sticky inside the matrix's own scrolling region.
- **Cells:** the number is written in every cell. Zero is hatched with a dashed edge; a zero for someone who completed other work is a **training gap** (amber ring and an icon). Five steps (0, 1-2, 3-5, 6-10, 11+) in one blue family; the numbers reach 4.5:1. The scale is **relative to the task type** by default (each row shows who handles it more or less) or absolute. Every cell has the name "Priya: 7 Relativity Production tasks completed in the last 90 days".
- **Counting:** completed tasks (not cancelled) whose completion time is inside the period in the viewer's time zone, for the person the task is assigned to (the task keeps no separate "completed by"). Period: 30 days (default), 90 days, 6 months, 12 months or a custom range. Pod and name filters; Training gaps filter; row and column order by name or total. A cell opens the tasks behind it with "Open in Task Queue".
- **Keyboard:** the matrix is one tab stop; arrow keys, Home and End move between cells, Enter or Space opens a cell.

## UX review (self-critique, and what changed)

Checked at 120 people against the screenshots:

- **Scan-ability.** The first version put the overdue and heavy marks beside the pill, which squeezed the load bar to 25 px on a heavy person; the bar now runs along the bottom of the tile and the marks sit opposite the pill. The default sort lists idle people first (they are who a coordinator assigns to), so the first screen is mostly green; the Heavy chip answers "who is overloaded" in one click. The page header, toolbar and chips take about 250 px, so 120 standard tiles are about 1.3 screens (one screen when dense).
- **Colour-blind safety.** Normal and Low are both neutral greys in the badge palette; the level glyph (2 bars against 1, now 3 px wide) and the count tell them apart, and every state has an icon (check, calendar, clock, triangle, moon) or a pattern (hatching, dashed outline). A selected chip is underlined as well as outlined (the green Idle chip changed colour too little to show it otherwise).
- **Tooltip discoverability.** The tooltip is the browser's `title` on the name button (also the accessible name), which appears after a short delay on hover only. To make up for that the legend says to hover or focus a tile, the Assign icon appearing on hover marks the tile as live, a click opens the drawer with everything, and a keyboard or screen reader user gets the full sentence as the button name. Known limit: a sighted keyboard user does not see the `title`; they see the drawer on Enter.
- **Fixed during the review:** the legend button had both `aria-pressed` and `aria-expanded` (now only `aria-expanded`); the Assign icon hidden by opacity is checked by axe in the suite; the chips of a name-filtered board counted the whole team for Out of office (now counted the same way as the others); the name was a heading on every tile (now plain text); the Sort select clipped its text.
- **Not done:** a sticky toolbar while scrolling 120 tiles (it would cost 100 px of the screen), and a virtualised list (200 tiles at a time were enough).

## Checks

Vitest specs (colour and priority mapping including renamed priorities, tile content and the absence of sentences, marks, the chips and their filters, the address, sorting, drawer, assign flow, 450 people drawn 200 at a time, coverage steps, scales, totals, gaps), Playwright against the real stack (tile states, colours and glyphs by priority, the accessible name and tooltip, the size of a tile, chips and filters with the address, table, drawer focus, inline edit and Undo, assign flow with hints and Undo, hover and keyboard reveal of the Assign icon, legend, responsive, the Coverage matrix, its drawer and permission), axe on every view (cards, legend, table, drawers, the matrix), and the bundle budget (the tab and its dialogs are one lazy chunk; the initial bundle did not grow).
