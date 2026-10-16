# Dashboard review 2: delivery plan

Owner approval: all findings of section 2 of `README.md` (2.1 to 2.8), 2026-10-16. Product decisions are delegated to the PM and recorded as "Decision (PM)" in each issue and in its "PM requirements review" comment. Date of this plan: 2026-10-16, base `origin/dev` at `ecc72de`.

Structure on GitHub: six epics (label `epic` + `phase-7`), one issue per finding (label `phase-7`), each linked as a sub-issue of its epic. Finding S2 is #82 (built by another developer agent; not duplicated). Bugs map to findings: B1=P2, B2=T2, B3=S5, B4=U3, B5=S6, B6=S4, B7=P9 (no separate bug issues). C4 is delivered by P3. Breakdowns findings are named "Breakdowns B1..B5" in the titles.

Not approved and NOT in scope: Wall mode (X8; only the width-cap lift of P5), saved views (X7), thresholds (X9), print stylesheet (X10), quick actions and bulk select (X11), colour token system (X1), copy-link icon (X3 remainder), exports and reports (dropped in the addendum), "Open by Pod" chart (stays removed).

## 1. Epics

| Epic | Title | Issues |
|---|---|---|
| #83 | Dashboard: page-wide improvements and role variants | #89-#100 |
| #84 | Dashboard > Summary tab improvements | #82, #101-#108 |
| #85 | Dashboard > Breakdowns tab improvements | #109-#113 |
| #86 | Dashboard > Trends tab improvements | #114-#121 |
| #87 | Dashboard > Swimlane tab improvements | #122-#126 |
| #88 | Dashboard > Users tab improvements (Workload and Coverage) | #127-#136 |

## 2. Issue list

Effort from the review (S under half a day, M one to two days, L more). "Needs" lists hard prerequisites by issue number.

| # | ID | Title (short) | Effort | Needs |
|---|---|---|---|---|
| #89 | P1 | Page-wide Scope control (All / My pods / one pod), `podScope` on 5 endpoints | L | #90, #97 |
| #90 | P2 | Isolate tab requests, errors stay in the tab (bug B1) | S | - |
| #91 | P3 | One period model in the URL (also C4) | M | #97 |
| #92 | P4 | Compact header, sticky tab row | S-M | - |
| #93 | P5 | Lift the width cap at 1600 px for Swimlane, Users, Coverage | S | with #92 |
| #94 | P6 | "Updated N min ago" only when stale | S | - |
| #95 | P7 | Shared state component (error, stale, retry, empty) | S-M | #90 |
| #96 | P8 | Skeleton silhouettes per tab | S | #95, tab layouts |
| #97 | P9 | Defaults out of the URL (bug B7), `dashUrlState` helper | S | - |
| #98 | R1 | Note when a link falls back to Summary | S | #97 |
| #99 | R2 | Hide the Dashboard menu item without a tab permission | S | - |
| #100 | R3 | Hide the tab row with one permitted tab | S | #92, #98 |
| #82 | S2 | Overdue list order + Critical count (other agent) | S | - |
| #101 | S1 | First-screen lists, one-line rows, 24 px targets | S-M | #82 |
| #102 | S3 | Tile deltas (Overdue, Open, Completed, Created) | M | #91, #104; soft #89, #120 |
| #103 | S4 | Due soon caption (bug B6) | S | - |
| #104 | S5 | Captions wrap at 375 (bug B3) | S | - |
| #105 | S6 | Assign toast position (bug B5) | S | #101 |
| #106 | S7 | Type, client, due chip in list rows | S | #82, #101 |
| #107 | S8 | Section names | S | #101 |
| #108 | S9 | Technician Summary (title, filters, own-work line) | M | #89, #100, #101, #106 |
| #109 | Breakdowns B1 | Overdue share in every bar | M | soft #89 |
| #110 | Breakdowns B2 | Age buckets 15-30, 31-60, 60+ | S | with #109 |
| #111 | Breakdowns B3 | Even card grid | S | #109, #110 |
| #112 | Breakdowns B4 | Low vs Normal bar stroke | S | #109 |
| #113 | Breakdowns B5 | One title per card | S | - |
| #114 | T1 | Chart fills card, sticky | M | #115, #92 |
| #115 | T2 | Y axis steps (bug B2), All hidden when comparing | S | - |
| #116 | T3 | Stocks in a second panel | M | #114, #115 |
| #117 | T4 | End labels, markers at ends | S | #114, #116 |
| #118 | T5 | Monday ticks | S | #114, #120 |
| #119 | T6 | Measure selector replaces the mode machine | M | #116, #120 |
| #120 | T7 | Open at end of day, weekly points beyond 31 days | M | #91, #116 |
| #121 | T8 | 375 px layout, headings | S-M | #114, #116, #119 |
| #122 | W1 | One-line compact card, one-line toolbar | M | #92, #89 |
| #123 | W2 | Lane counts link to the queue | S | #89 |
| #124 | W3 | No repeated client/matter in groups | S | with #122 |
| #125 | W4 | Lane switcher below 900 px | M | #122, #123 |
| #126 | W5 | Big-screen verification | S | #122, #93 |
| #127 | U1 | Capacity strip + Assign work menu | S | #130, #89 |
| #128 | U2 | Text Workload/Coverage switch, labelled icons | S | #89 |
| #129 | U3 | Table: sticky name, sortable, no overflow (bug B4) | M | soft #92 |
| #130 | U4 | "Can take work" population rule | S-M | #89 |
| #131 | U5 | Drawer rows without repeated assignee | S | - |
| #132 | U6 | Assign picker defaults, "Assign the next 3" | M | #106, #131 |
| #133 | U7 | Idle tile tint | S | soft #127 |
| #134 | C1 | Coverage "By task type" with named people | M-L | #89, #91, #136 |
| #135 | C2 | Quieter matrix cells | S | #134 |
| #136 | C3 | "No one" vs "one person" warning | S | with #134 |

## 3. Decisions (PM) in one place

- P1 scope: default `mine` when the viewer is in at least one pod, else `all`; membership only; "My pods" = union; scope = task Pod field (same as the Task Queue pod filter); no-pod tasks only under All pods with a visible hint; per-tab Pod controls removed.
- P3 period: 7 d, 30 d, 90 d, This month, Last month, Custom; default 30 d; "This week" dropped, "Last quarter" = 90 d; Coverage adds 6 and 12 months; custom max 366 days; Swimlane window separate ("Done in the last").
- S3 deltas: only Overdue and Open (vs yesterday) and Completed and Created (vs previous equal period); no delta for Unassigned, On hold, Due soon, ASAP (no history).
- S9: H1 "Unassigned work", scope = P1 control, Priority and Task type filters from the column-filter foundation, own-work line from `mine` counts.
- R2: hide the menu item when no tab permission (`ViewCoverage` alone does not count); route stays.
- U4: can take work = active and (in a pod or holding an open task); switch to include the rest.
- C3: "no one" is informational, "only one person" is the amber warning; addendum Q amended.
- B2 (Breakdowns): split 15+ into 15-30, 31-60, 60+ without waiting for real data.
- T7: Open at end of day = created by end of D and not closed by end of D; weekly buckets (Monday to Sunday) for all series beyond 31 days.
- P5: only the cap lift; Wall mode left out. Lane width capped at 480 px above 2200 px.
- T3/T6/T7: two panels (flows, backlog), segmented measure per panel, "Compare task types" never a dead end.
- U6: "Assign the next 3" is not "bulk reassign all" (dropped in addendum F): max 10 unassigned tasks, explicit confirmation, per-task audit.

Issues blocked on an owner decision: none.

## 4. Work packages (ranked)

Rules for developer agents: branch from `origin/dev`, rebase before each push, touch only the files of your package unless the issue says otherwise, regenerate OpenAPI and the client (nswag) when the API changes, run unit + integration + e2e + axe, attach 1366/1920/375 screenshots, keep the bundle at about 621 kB of 700 kB, update the UX docs named in the epic. SQL scripts: next free number is 28 (latest is `27-dashboard-unassigned.sql`; `15-dashboard-indexes.sql` already exists). No package currently needs a script; if profiling shows an index is needed for #89, #120 or #134, the first PR to merge takes 28 and the others renumber at merge time.

| Rank | WP | Issues | Main files / areas | Days | Runs in parallel with | Waits for | Backend / SQL |
|---|---|---|---|---|---|---|---|
| 1 | WP1 Shell foundations | #97, #90, #95, #94, #98, #99 | `features/dashboard/pages/dashboard-page.ts`, `dashboard.routes.ts`, `dashboard-prefs.ts`, `ui/dash-tabs.ts`, new `ui/dash-state.ts` and `dashUrlState`, per-tab error/stale blocks, nav permission helper | 2-3 | WP5, WP7, WP9a (different files) | - | Frontend only |
| 2 | WP5 Summary lists | #82 (in progress), #101, #106, #107, #103, #104, #105 | `ui/task-list-panel.ts`, `ui/stat-tile.ts`, summary section of `dashboard-page.ts`, `DashboardService.cs` list queries + `DashboardDtos.cs` (additive row fields) | 2-3 | WP1, WP7, WP8a | #82 merged first | Additive DTO fields (type, client, due); no SQL |
| 3 | WP2 Page chrome and roles | #92, #93, #100 | `dashboard-page.ts` header/layout, global dashboard CSS, `dash-tabs.ts` | 1-2 | WP5, WP7, WP8a | WP1 | Frontend only |
| 4 | WP3 Period model | #91 | `dashboard-period.ts`, `dashboard-prefs.ts`, period control, `DashboardController.cs`, `DashboardService.cs`, `DashboardTrendService.cs`, coverage query | 1.5-2 | WP7, WP8a, WP9a, WP10b | WP1, WP2 | API contract (enum to from/to); no SQL |
| 5 | WP4 Scope | #89 | scope control + `dashUrlState`, five endpoints (`podScope`), `DashboardCache.cs`, users/swimlane/coverage pod filter removal | 3-4 | WP7, WP8a, WP9a, WP10b | WP1, WP3 (same API files: sequential) | `podScope` on 5 endpoints; index script 28 only if profiling asks |
| 6 | WP8a Trends frontend | #115, #114, #116, #119 | `ui/trend-chart.ts`, `trend-model.ts`, `trend-legend.ts`, `trend-prefs.ts`, `dash-trends-tab.ts` | 3 | WP5, WP7, WP9a, WP10b | WP2 for the sticky offset (soft) | Series split flows/stocks (additive) |
| 7 | WP7 Breakdowns | #109, #110, #113, #111, #112 | `ui/bar-list.ts`, `stacked-bar.ts`, breakdown section of `dashboard-page.ts`, breakdown queries in `DashboardService.cs` | 2 | WP1, WP5, WP8a, WP9a | - (scope support after WP4 comes free via `podScope`) | `overdue` per row, six age buckets; no SQL |
| 8 | WP9a Swimlane board | #122, #124, #123 | `swimlane/swimlane-card.ts`, `swimlane-lane.ts`, `swimlane-toolbar.ts`, `swimlane-prefs.ts`, `ui/dash-swimlane-tab.ts` | 2-3 | WP7, WP8a, WP10b | WP2 (header), WP4 for removing the Pod filter and the lane links | Frontend only |
| 9 | WP6 Summary deltas and Technician | #102, #108 | `DashboardService.cs`, `DashboardDtos.cs`, `stat-tile.ts`, technician variant of the Summary | 2-3 | WP8b, WP9a, WP10 | WP3, WP4, WP5, WP2 (#100) | Nullable delta fields, `mine` counts, queue filters; no SQL |
| 10 | WP8b Trends backlog | #120, #117, #118, #121 | `DashboardTrendService.cs`, `trend-chart.ts`, `trend-model.ts`, `dash-trends-tab.ts` | 2.5-3 | WP9, WP10 | WP8a, WP3 | New `open` series, weekly buckets; index script 28 only if profiling asks |
| 11 | WP10a Workload tiles and toolbar | #130, #128, #127, #133 | `users/users-toolbar.ts`, `users-summary.ts`, `users-card.ts`, `users-model.ts`, `dash-users-tab.ts`, workload endpoint (`includeNoPod`) | 2 | WP9, WP8b, WP10b | WP4 | `includeNoPod`, `hiddenCount`; no SQL |
| 12 | WP10b Workload table, drawer, picker | #129, #131, #132 | `users/users-table.ts`, `users-drawer.ts`, `users-assign.ts` | 2.5 | WP9, WP8b, WP10a (different files) | #106 (chips) for #132 | Batch assign endpoint (max 10) if none exists; no SQL |
| 13 | WP11 Coverage | #134, #136, #135 | `users/coverage-view.ts`, `coverage-model.ts`, `coverage-drawer.ts`, `coverage-prefs.ts`, coverage query | 3 | WP9b, WP8b | WP3, WP4, WP10a (#128 switch) | `groupBy=type` on coverage; index script 28 only if profiling asks |
| 14 | WP9b Swimlane mobile and verification | #125, #126 | `swimlane-lane.ts`, `swimlane-toolbar.ts`, `dash-swimlane-tab.ts` | 1.5 | WP11, WP8b | WP9a, WP2 | Frontend only |
| 15 | WP12 Polish | #96 | skeletons per tab (all layouts final), docs sweep (ux-spec S01/S01b, READMEs, addendum) | 1 | - | everything above | Frontend only |

### Parallelism at a glance

- Wave 1 (start now, parallel): WP1, WP5, WP7, WP8a. Different files; only `dashboard-page.ts` and `DashboardService.cs` are shared hot spots (WP1 shell vs WP5/WP7 sections): rebase often, keep changes in the components named above.
- Wave 2: WP2 (after WP1), then WP3, then WP4 (sequential: same API and header files). In parallel: WP9a, WP10b.
- Wave 3: WP6, WP8b, WP10a (after WP4), WP9b.
- Wave 4: WP11, then WP12.

### Hot spots (merge-conflict watch)

`dashboard-page.ts` (WP1, WP2, WP3, WP4, WP5, WP6, WP7), `DashboardService.cs` and `DashboardDtos.cs` (WP3, WP4, WP5, WP6, WP7; additive changes, keep methods separate), `dash-users-tab.ts` (WP4, WP10a, WP11), `trend-chart.ts` (WP8a, WP8b; one agent for both is recommended). Regenerated OpenAPI/client files conflict on every API change: regenerate after rebasing, never hand-merge.

### Definition of done per package

Issues closed, tests green twice, axe clean, three screenshots per changed screen, bundle budget, UX docs updated, and the epic tasklist ticked.

## 5. Status

(One line per work package; keep the other packages' lines when merging.)

- WP8a Trends frontend (#115, #114, #116, #119): delivered in `trend-chart`, `trend-model`, `trend-legend`, `dash-trends-tab` and the new `trend-measure`. Frontend only (the existing `all` and `byTaskType` day series already carry every measure; no API change). Two stacked panels (flows 320 px, backlog 200 px, same x scale and cursor), nice y axis (peak 21 gives 25), All task types hidden for scale while comparing, segmented measure controls plus a never-disabled "Compare task types" list, sticky chart. Extension points for WP8b (Open series, direct labels, Monday ticks, 375 layout) are listed in `docs/ux/dashboard-trends-types/README.md` (Design, last paragraph). Screenshots: `fixes/wp8a/`.
- WP5 Summary lists (#101, #103, #104, #105, #106, #107; #82 was done earlier): frontend only. The Summary lists read Task Queue rows, which already carry task type, client name and due date, so no DTO, OpenAPI or SQL change was needed. One-line 44 px rows (number, type icon, title, client, priority, due chip, actions) decided by a container query (list wider than 540 px), two lines below; 5 rows per list, 3 per list on a short window (1280 px wide, under 1020 px high) so all three headings and 3 rows are in the 1366x768 first screen; tiles left, one column of three lists right from 1280 px (no section headings, the list headings are "Unassigned", "Overdue", "Due soon"). Row buttons and links at least 24 px high. Due soon wording "Today and the next 2 days, excludes ASAP" from one constant, resolved end date in the tile tooltip and description. Tile captions wrap (no ellipsis), ASAP "No due date", On hold "Waiting on client, custodian or internal". Assign toast: `UndoService` placement `start` (bottom left of the main column from 1024 px, 24 rem wide; full width below, the last list gets bottom padding while it is open). Screenshots: `fixes/wp5/`. Tests: `dashboard-summary-lists.spec.ts` (bounding boxes at 1366x768 and 1920x1080, captions at 320/375/480, toast, axe), unit specs.
- WP7 Breakdowns (#109, #110, #111, #112, #113): `overdue` (int) on every `byTaskType`, `byPriority`, `byStatus` row and every `aging` bucket of `GET /api/v1/dashboard` (additive; same predicate as the Overdue tile, a second grouped read over the overdue subset, six scalar counts added to the aging statement; no SQL script), age buckets 0-2, 3-7, 8-14, 15-30, 31-60 and 61+ (`DashboardRules.AgingBands`, OpenAPI and client regenerated). The Breakdowns tab moved into the new `ui/dash-breakdowns-tab.ts` (dashboard-page only imports it); `bar-list`, `stacked-bar` and the new `breakdown-overdue.ts` draw the hatched overdue segment, the "N overdue" link (`<row query>&overdue=true`), the Overdue table column, the legend, the Low dashed stroke and the forced-colours rules. One title per card (H3) under a hidden H2 "Open tasks"; the grid follows the tab width by container query (4 across from 1300 px, 2 columns flowing top to bottom from 700 px, 1 below). Tests: unit (`charts`, `chart-contrast`, `dashboard-page`, `DashboardRulesTests`), integration `DashboardApiTests` (row and bucket overdue equals the queue, sums equal the Overdue tile, Dashboard.ViewBreakdowns alone), e2e `dashboard-breakdowns.spec.ts` (axe at 1366, 1920, 375, grid columns, tab order, layout shift, strokes). Screenshots: `fixes/wp7/`.
