# Dashboard > Users tab (issue #73, epic #68)

The fifth Dashboard tab shows the team's **workload** as one card per person, and (for people with `Dashboard.ViewCoverage`) a **Coverage** view: how many tasks each person completed per task type, for training and cross-coverage planning. Specification: `docs/ux/ux-spec.md`. Backend: `GET /api/v1/dashboard/workload` and `GET /api/v1/dashboard/coverage` (`docs/architecture.md` 8.5). Decision for the completion counts: `docs/requirements/decisions-addendum.md` section Q.

Screenshots were taken by `frontend/e2e/tests/users-screens.spec.ts` against the real stack (SQL Server in Docker, the published API with Dev auth serving the production Angular build, Chromium): twelve people with mixed loads (an idle one, light, normal and heavy ones, one out of office with tasks, one out of office and idle, one off hours), four unassigned tasks, and a small coverage history. Reproduce with:

```bash
E2E_SCREENSHOTS=docs/ux/dashboard-users frontend/e2e/run-local.sh -g "users screenshots"
```

## What the screens show

| File | What it shows |
|---|---|
| `01-cards-1366.png`, `-1024`, `-375` | The Workload view: summary strip, toolbar and the cards. 1366: cards fill the width (auto-fill grid). 1024: fewer columns. 375: one column. |
| `02-pod-filter-*` | Filtered to one pod (`upod` in the address). |
| `03-compact-1366.png` | Compact density. |
| `04-table-1366.png` | The compact table view. |
| `05-legend-1366.png` | Legend and help: card colours, load levels with their thresholds, and what the view is not. |
| `06-drawer-1366.png` | A person's open tasks (inline Status, Priority and Assignee menus with Undo), "Open in Task Queue" and "Assign work". |
| `06b-assign-heavy-hint-1366.png` | The assign picker with the visible hint for a heavily loaded person. |
| `07-coverage-*` | The Coverage view (heat map). |
| `08-coverage-absolute-1366.png` | The absolute colour scale. |
| `09-coverage-gaps-1366.png` | The Training gaps filter. |
| `10-coverage-drawer-1366.png` | The tasks behind one cell. |
| `11-error-1366.png` | The error state with reference and Retry. |

## Decisions

- **Colour follows the highest priority, in words.** A coloured band at the top of every card carries the card colour: the highest priority among the person's open tasks, using the same colour pair as the priority badge (token `critical|high|normal|low|neutral` or a `#RRGGBB` override, so renamed and recoloured priorities follow). The band always says it in text and an icon ("Highest priority: Critical"). Free capacity is green with "Available - no open tasks"; an out of office person gets a hatched grey card, "Not available", **Back on <date>** and the note. Off hours is a soft chip and does not change the card. Text colours reach 4.5:1 (the band uses the badge pairs; the body is on the plain surface).
- **Counts per priority** are badges in rank order (the legend order the API sends), zeros muted with a dashed outline. Open, overdue, due soon, on hold and the next due task (a link) follow, then a **segmented load bar** split by priority and a **Free / Light / Normal / Heavy** label. The thresholds (`Dashboard:Workload:LightMax` 3, `NormalMax` 8) are in the legend panel and in the label's tooltip.
- **Operational framing.** The Workload view has no completion counts, speed, ranking or performance measures, and says so on the page and in the legend. The Coverage view is the one exception, decided by the product owner (addendum Q) and gated by its own permission.
- **Team summary strip:** Available (nobody open), Busy, Out of office (a toggle that filters the cards to those people) and Unassigned tasks (links to the Task Queue with `unassigned=true` and the open statuses). The counts ignore the availability and name filters.
- **Toolbar:** Sort (Availability and load, Name, Highest priority, Open tasks), Pod, Availability, search by name, density, cards or table. Sort, density and the view are remembered per user (guarded `localStorage`); the filters are in the address (`upod`, `uavail`, `uq`) and cleared when another tab is chosen.
- **Keyboard model.** Deliberately simple: the cards are an ordinary list in reading order with the normal tab order. A card has two tab stops, the person's name (a button that opens the drawer; its click area is the whole card) and "Assign work". No arrow-key grid to learn. The accessible name of the button starts with the visible name and then gives the state in words ("Ann Lee. Ann Lee, 3 open tasks, highest priority Critical, 2 overdue. Open tasks").
- **Drawer.** A modal right-hand drawer like the Swimlane one: focus moves to Close, is trapped, Esc returns it to the card. It lists the person's open tasks from the Task Queue (priority then age, 50 at a time) with the inline menus and Undo; a task that leaves the person disappears and the board is read again a moment later.
- **Assign work.** From the card and the drawer: a modal picker of unassigned open tasks, highest priority first then oldest, with a search box. It uses the existing assign call and rules (assigning starts a New task) and offers Undo. A visible hint appears when the person is out of office or Heavy; assigning is still allowed.
- **Refresh.** The refresh icon sits in the Dashboard's tab row (as on the Swimlane tab, no "Updated" text) and reads the cards or the coverage matrix again. The Workload view also refreshes itself every 5 minutes while the tab is visible, skipped while a menu, the drawer or a dialog is open, and it never moves focus. A failed background read keeps the cards and shows a banner with Retry.

### Coverage view

- **Where:** a "Workload | Coverage" switch at the top of the tab (only with `Dashboard.ViewCoverage`), `?tab=users&view=coverage`, remembered. Reaching it needs the Users tab permission (`Dashboard.ViewUsers`) as well; the server needs `Dashboard.View` + `Dashboard.ViewCoverage`.
- **Heading:** "Task type coverage - use this to plan training and cross-coverage, not to rank people". No score, no "best / worst" wording; ordering by total is labelled "By total completed".
- **The table:** a real table. Rows are task types (icon and name), columns are people (initials and name; Inactive and Out of office are small markers), the last column is Total and "People who handled it" (fewer than two is highlighted), the last row is the column totals. The first column and the header row are sticky inside the matrix's own scrolling region.
- **Cells:** the number is written in every cell. Zero is hatched with a dashed edge; a zero for someone who completed other work is a **training gap** (amber ring and an icon). Five steps (0, 1-2, 3-5, 6-10, 11+) in one blue family; the numbers reach 4.5:1. The scale is **relative to the task type** by default (each row shows who handles it more or less) or absolute. Every cell has the name "Priya: 7 Relativity Production tasks completed in the last 90 days".
- **Counting:** completed tasks (not cancelled) whose completion time is inside the period in the viewer's time zone, for the person the task is assigned to (the task keeps no separate "completed by"). Period: 30 days (default), 90 days, 6 months, 12 months or a custom range. Pod and name filters; Training gaps filter; row and column order by name or total. A cell opens the tasks behind it with "Open in Task Queue".
- **Keyboard:** the matrix is one tab stop; arrow keys, Home and End move between cells, Enter or Space opens a cell.

## Checks

Vitest specs (colour and priority mapping including renamed priorities, counts, availability states, sorting and filtering, drawer, assign flow, coverage steps, scales, totals, gaps), Playwright against the real stack (card states and colours by priority, counts against the API, filters and the address, table, drawer focus, inline edit and Undo, assign flow with hints and Undo, legend, responsive, the Coverage matrix, its drawer and permission), axe on every view, and the bundle budget (the tab and its dialogs are one lazy chunk).
