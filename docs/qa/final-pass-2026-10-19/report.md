# Final verification pass of the Task Queue epic (#240, WP29), 2026-10-19

Start `a6b0978`; the tree verified is `origin/dev` `1f04293` plus this pass's commit (other agents' WP11 tab strip and pager, help menu and Clients docs landed during the pass and are part of the tree; they touch no backend file). The machine was quiet for the backend perf tests and for the first Playwright run (load 1 to 6 on 4 cores); sibling agents were running again during parts of the second run (load 12 to 25), and the container restarted once in the middle of the pass (docker and the SQL container were restarted; the runs below are from the restarted machine). Dev auth only, Chromium only, axe-core 4.10.2.

## Suites

| Suite | Result |
|---|---|
| `dotnet build -warnaserror`, `dotnet format --verify-no-changes` | clean (0 warnings); `contracts/openapi/v1.json` unchanged after the build (no drift); no backend or contract file changed between `a6b0978` and the verified tree |
| Backend unit / architecture / schema | 1606 / 35 / 66 passed |
| Backend integration (full, 48 min) | 1033 passed, 0 failed |
| Perf budgets on the idle machine (load under 2): `Hostile_nested_html_upload_is_answered_quickly` (2 s), `DashboardTrendLargePerformanceTests`, `BoardPerformanceTests` (swimlane), `CoveragePerformanceTests`, `DashboardPerformanceTests`, `TaskQueuePerformanceTests`, `PerformanceRound1Tests` | 44 of 44 passed, no budget changed |
| eslint (src, projects, e2e), prettier, tsc (app, spec, e2e) | clean, also after the last test edits |
| Frontend unit (app / form-engine) | 2463 / 307 passed (one earlier run at load 14 had 3 failures in two filter-row specs, `asset-types-page`, `task-types-admin-page`, `clients-list-page`: pass alone, LOAD FLAKE) |
| `ng build` | initial total **640.94 kB** (172.60 kB transfer) of 700 kB, no warnings; `task-table.scss` is 6807 bytes, down from 8858 at the start of the epic (no style budget warning) |
| Playwright 1: fresh DB, axe on, final tree | 942 tests: 915 passed, 25 skipped, 2 failed (52 min) |
| Playwright 2: same stack, used DB (about 3000 open tasks) | 915 passed, 25 skipped, 2 failed (1.0 h) |
| Playwright, the 2 + 2 failures re-run | all pass (see classification); wp21 menu, S6 at 375 and users-tab drawer 10 to 20 times each after the fixes |
| Screenshot-gated specs (`E2E_SCREENSHOTS`, the 25 skipped ones) | 124 tests: 120 passed, 2 skipped, 2 failed (one concurrency flake, one test bug, both fixed or passing alone); incl. `column-filters-admin-screens` (passes; the checkbox click timeout did not recur) |

The 25 skipped tests are the screenshot captures that skip without `E2E_SCREENSHOTS`; all were run once with it set.

## Real bugs found and fixed

1. **Record grids could not be resized** (`#240` requirement 3 names them). The Matter Tasks tab and the Project task list used `widthsEditable=false`: no handles, no menu, no stored widths. They now resize by drag, fit and the column menu (Sort, width items, Reset width; no "Hide column", the column set is fixed), with their own storage scopes `matterTasks` and `projectTasks` (`ScopedTasks`, `TaskTable.canHideColumns`). Tests: unit (`column-menu.spec`), e2e `final-verification` (drag persists in its own scope and reaches no other screen).
2. **Due preset names (#155)**: the Due filter button and the chip showed dates after a preset was chosen. They now read "Due: Next 7 days" (any preset the filter offers, Monday weeks, viewer's zone) and the dates for a custom range or a preset the filter does not offer. `presetName`/`rangeText`/`valueText`/`buildChips`/`printText` take the viewer's calendar day; `ListFilters` and `ColumnDateRangeFilter` supply it. Tests: `filter-def.spec` (6 cases), `date-range-filter.spec`, e2e `my-work-links-copy` (button at 1920, chip in the 375 sheet).

## Test bugs fixed

- `wp11-view-counts` "a button keeps its place while the counts load": assumed fewer than 1000 open tasks (the strip reserves three digits by design; the shared DB of a full run holds about 3000). Now only buttons up to the first four-digit count are compared. Failed in the first run on the previous tree.
- `wp21-fit-menu` keyboard test: pressed Tab right after Shift+F10 before the menu had focus (menu opened behind the Tab; failed 1 in 3). Waits for the focused first item.
- `dashboard-summary-lists` S6 at 375: the Assign menu was closed by the scroll that the click caused (1 in 3). The shared helper `assignToMeFromRow` scrolls first (same cause as the earlier `wp1`/`wp7` fixes).
- `users-tab` drawer: clicked a priority trigger of the first render of the drawer list; the list's re-render removed the menu (3 of 3 failures on the used DB). Waits for the four rows.
- `wp16-more-views` `titlesWith`: could read the rows of the previous list when the filtered response arrived after the idle check; now waits until no row without the tag is left.

## Load flakes (passed alone, on the quiet machine or again later)

`wp13b-phone-cards` 320 px createdByMe sideways scroll (1 failure in run 1; 27 repeats pass), `users-capacity` unassigned total (a global count that another worker changed; 3 of 3 pass alone), `wp16-more-views` #220 (60 s timeout at load 25 in an earlier run; passes in 38 s), the three unit specs above, and in an earlier run at load 25 and a full disk (ENOSPC, the machine had 0.7 GB free): `users-pods`, `wp18-pager` (4), `wp5-toolbar` (2), `wp16` (3).

## #240 acceptance list

- **Contract tests** (a) to (g): kept in the suite and green twice: `wp15-rows`, `wp19-compact`, `wp9-fixed-layout` (widths equal across sort and page), `wp14-due-cell` (eight states, three zones), `wp20-resize`, `wp21-fit-menu`, `wp22-columns-widths` (drag, menu and panel persist and reset), `wp20` 200-row guide line, rows visible (`wp15`: Task Queue 11, My Work 9 at 1366x768; Compact 13 and 11). New `final-verification.spec.ts` adds: row heights one value per density over three pages (comfortable 44 px, compact 36 px, 58 rows, widths equal on the pages); owner requirements on five grids; the Dashboard drill-through; Tab stops; axe on six screens at four sizes.
- **Drill-through (the review's 26-link check)**: UI-driven, in one pod's scope: 27 links (8 tiles, priorities, statuses, task types, six age buckets and the "N overdue" links), every count equals the grid total behind its link. API-level `dashboard-consistency` is green as before. **16-combination My Work check**: `my-work-consistency` green (both runs).
- **Owner requirements**: no client or matter line under any Title and at most two lines per row (44 px, nothing taller than its row) on Task Queue, My Work, Pod Work, a Matter's Tasks tab and a Project (3 rows each, all 44 px); a resize handle on every column except the Title on all five (6, 6, 6, 6 and 5 handles); Due relative text on line 2 on all five.
- **Budgets**: initial bundle 640.94 kB (at most 700), no style budget warning, `task-table.scss` smaller than at the start.
- **axe at 1366, 1920, 768 and 375** with the Columns panel, the header menu and the Filters sheet open (`wp22`, `wp21`, `wp5`, `wp13`), and on the six final screens: 0 violations in every state, both runs.
- **Tab stops** before the first row, skip link not used (1 Tab plus Enter with it): Task Queue 36, My Work 39, Pod Work 38 (1366x768; the PM relaxed the "25" target in #236: the quick views are one Tab stop; the rest is the app header, the navigation rail and the filter row).
- **WP12a, WP12b, WP9, WP10** (grouped rows, keyboard model, density counts, hold note and colours): their specs are green in both runs.
- **Screenshots** at four sizes: `docs/ux/task-queue-review/fixes/final/` (24 files: Task Queue, My Work, Pod Work, Matter Tasks tab, Dashboard lists, Swimlane at 1366x768, 1920x1080, 768x1024, 375x812).

## Remaining

- Epic #75 (column filters) stays open on purpose (owner decision; PM UX re-review of column filters).
- Not measured: real assistive technology, dark theme (out of scope of the epic).
- The "no frame over 50 ms" resize bar (`wp20` records frame times, does not assert) was not verified on a CI-class idle machine; the 200-row guide line works.
- Several filter-row unit specs and some e2e specs are timing sensitive when the machine load is above about 12; they are green on a quiet machine.
