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

Last updated by WP12 (Polish), 2026-10-17. Every approved finding is delivered on `dev` except the part of T8 (#121) listed under "Intentionally open". The per-package notes below the tables keep the detail (what changed, what was tested, where the screenshots are).

### 5.1 Issues

Closed unless stated. The SHA is the commit that delivered the issue (follow-up fixes in the package note).

| Issue | ID | Status | SHA | Package |
|---|---|---|---|---|
| #82 | S2 Overdue order, Critical count | closed | `949b47f` | other agent |
| #89 | P1 Scope | closed | `e35531d` | WP4 |
| #90 | P2 Tab isolation (B1) | closed | `e405d42` | WP1 |
| #91 | P3 Period model (C4) | closed | `38d6750` | WP3 |
| #92 | P4 Compact header | closed | `190521e` | WP2 |
| #93 | P5 Width cap lift | closed | `190521e`, verified in `622555c` | WP2, WP9b |
| #94 | P6 Updated N min ago | closed | `e405d42` | WP1 |
| #95 | P7 Shared state component | closed | `e405d42`, `9a33924` | WP1 |
| #96 | P8 Skeleton silhouettes | closed | `28554fb` | WP12 |
| #97 | P9 Defaults out of the URL (B7) | closed | `e405d42`, `9a33924` | WP1 |
| #98 | R1 Fallback note | closed | `e405d42` | WP1 |
| #99 | R2 Hide menu item | closed | `e405d42` | WP1 |
| #100 | R3 Single-tab tab row | closed | `190521e` | WP2 |
| #137 | Fixed-height tabs (added by the owner) | closed | `190521e` | WP2 |
| #101 | S1 First-screen lists | closed | `0999d84` | WP5 |
| #102 | S3 Tile deltas | closed | `f3c6093`, `c233c05` | WP6 |
| #103 | S4 Due soon caption (B6) | closed | `0999d84` | WP5 |
| #104 | S5 Captions at 375 (B3) | closed | `0999d84` | WP5 |
| #105 | S6 Assign toast (B5) | closed | `0999d84` | WP5 |
| #106 | S7 Type, client, due chip | closed | `0999d84` | WP5 |
| #107 | S8 Section names | closed | `0999d84` | WP5 |
| #108 | S9 Technician Summary | closed | `f3c6093`, `b9cbe09` | WP6 |
| #109 | Breakdowns B1 Overdue share | closed | `0b52de5` | WP7 |
| #110 | Breakdowns B2 Age buckets | closed | `0b52de5` | WP7 |
| #111 | Breakdowns B3 Card grid | closed | `0b52de5` | WP7 |
| #112 | Breakdowns B4 Low vs Normal | closed | `0b52de5` | WP7 |
| #113 | Breakdowns B5 One title per card | closed | `0b52de5` | WP7 |
| #114 | T1 Chart fills its card | closed (sticky dropped, see WP2) | `3d30d26`, `190521e` | WP8a, WP2 |
| #115 | T2 Y axis (B2) | closed | `3d30d26` | WP8a |
| #116 | T3 Stocks in a second panel | closed | `3d30d26` | WP8a |
| #117 | T4 End labels, markers | closed | `b8dc5c2`, `4cdbbbb` | WP8b |
| #118 | T5 Monday ticks | closed | `b8dc5c2`, `4cdbbbb` | WP8b |
| #119 | T6 Measure selector | closed | `3d30d26` | WP8a |
| #120 | T7 Open at end of day | closed | `cf5f30c`, `b8dc5c2`, `3046e82` | WP8b |
| #121 | T8 375 px layout, headings | **open** (see below) | `b8dc5c2`, `4cdbbbb` | WP8b |
| #122 | W1 One-line compact card | closed | `ba6b0d0` | WP9a |
| #123 | W2 Lane counts link | closed | `ba6b0d0` | WP9a |
| #124 | W3 No repeated client or matter | closed | `ba6b0d0` | WP9a |
| #125 | W4 Lane switcher | closed | `622555c`, `c83baa3` | WP9b |
| #126 | W5 Big-screen verification | closed (PM accepted 5 whole Comfortable cards at 1920x1080, target was 6; Compact shows 17) | `622555c` | WP9b |
| #127 | U1 Capacity strip | closed | `bbdfd04` | WP10a |
| #128 | U2 Text switch | closed | `bbdfd04` | WP10a |
| #129 | U3 Table (B4) | closed | `4679df8` | WP10b |
| #130 | U4 Can take work | closed | `bbdfd04` | WP10a |
| #131 | U5 Drawer rows | closed | `4679df8` | WP10b |
| #132 | U6 Assign picker | closed | `4679df8` | WP10b |
| #133 | U7 Idle tint | closed | `bbdfd04` | WP10a |
| #134 | C1 By task type | closed | `1af5c34` | WP11 |
| #135 | C2 Quieter matrix | closed | `1af5c34` | WP11 |
| #136 | C3 No one vs one person | closed | `1af5c34` | WP11 |

### 5.2 Epics

| Epic | State | Note |
|---|---|---|
| #83 Page-wide | closed with #96 | every child closed (#89-#100, #137) |
| #84 Summary | closed | every child closed (#101-#108; #82 closed earlier) |
| #85 Breakdowns | closed | every child closed |
| #86 Trends | **open** | #121 is open on purpose |
| #87 Swimlane | closed | every child closed |
| #88 Users | closed | every child closed |

### 5.3 Intentionally open

- **#121 (T8) and with it epic #86.** At 375 px the chart is 271 px wide, not the 343 px of the acceptance text: the app shell keeps a 56 px rail at that width, so the content column is 271 px. Everything else of T8 is done (16:9 chart, Compare task types disclosure, tap tooltip, one title per panel). Widening the chart needs a shell decision (collapse or overlay the rail on phones), which is outside the Dashboard and was not approved in review 2. Close #121 and #86 when the shell change lands or the owner accepts 271 px.
- Not approved and not built (section top): Wall mode, saved views, thresholds, print stylesheet, quick actions and bulk select, colour token system, copy-link icon, exports and reports.

### 5.4 Work packages

(One entry per work package, newest packages first within each wave; keep the other packages' entries when merging.)

- WP12 Polish (#96 P8, plus a docs sweep and one accessibility fix; `28554fb`): one `mf-dash-skeleton` component (`ui/dash-skeleton.ts`) with a silhouette per tab, used for the first read of each tab and for a new Scope. Summary: two tile groups of four and three list panels of five rows (a full list), with the Summary's own breakpoints (tiles 2 across from 1280 px beside the lists); Breakdowns: caption and four cards of four bar rows in the tab's container-query grid (4, 2 or 1 columns); Trends: two chart frames (320 : 200) with axis lines and the Task Types panel (folded on a phone, 16:9 chart); Swimlane: four lanes with three cards each (inside the real lane: three cards); Users: the tile grid of the workload tab; Coverage: matrix rows. Swimlane and Users also draw the heights of their toolbars while the page does not yet know the Scope. The Summary lists, which read their rows from the Task Queue after the figures, show five rows of 44 px (a full list, 266 px) instead of three, and the Swimlane lane header keeps the room of its "oldest" text while loading, so a list or a lane does not change height when its data arrives (this was the one shift the delayed-read tests found, 0.03 to 0.06). Sizes are in px measured on the loaded tabs: the root font size of the app is 14 px. All of it is `aria-hidden`, the host is `aria-busy="true"` and carries one visually hidden polite "Loading" status per tab (the three Summary lists and the four lanes no longer announce one each; the Swimlane's own live region says "Loading the swimlane board.", the Summary lists share one "Loading the task lists"), the pulse is an opacity animation switched off by `prefers-reduced-motion`, and a manual Refresh with figures on screen shows none (unchanged). Frontend only, no API, OpenAPI or SQL change, initial bundle 622.43 kB (unchanged), the component lives in lazy chunks. The accessibility fix: the capacity strip segments of the Users workload (`.seg`) are now at least 24 x 24 px at every width (they were 22 px high with an 18 px minimum width, which failed axe target-size when a level was a sliver of a big board); four segments and their gaps are 102 px, so they always fit. Docs: `docs/ux/ux-spec.md` S01 rewritten for the shipped Dashboard (fixed-height page, header row, Scope, Period, tabs, states, Refresh, Trends, updated acceptance list; no old tile wireframe, "Open by Pod", per-tab pod controls, old period lists, 3-row cut or "no visible Updated text" left), this Status section. Tests: unit `dash-skeleton.spec.ts` (variant per tab, one status, aria), updated swimlane, users and page specs; e2e `dashboard-skeletons.spec.ts` (reads held with a gate: the tab panel keeps its box between skeleton and loaded at 1366, 1920 and 375, layout shift of the load at most 0.02, one announcement, reduced motion, axe in the loading state, no skeleton on Refresh) and in `users-capacity.spec.ts` a board of 451 people with one Idle person (every segment at least 24 x 24 at 375 and 1366, axe). Screenshots: `fixes/wp12/` (`<tab>-skeleton-<width>.png` and `<tab>-loaded-<width>.png`).

- WP8b Trends backlog and labels (#120, #117, #118, #121): `GET /dashboard/trend` additive: `open` on every point, per type and in the legend (`open`, `openQuery`), `granularity` (`day` up to 31 days, else `week`: every series of both panels bucketed Monday to Sunday, flows summed, stocks at the end of the week, 52 to 54 points for 366 days), `metric=open`, cache key carries the granularity (OpenAPI and client regenerated). Open at end of day = created by the end of the day and not Completed or Cancelled by then, no status replay; today equals the Open tile; one grouped baseline count plus one read of the period's tasks, no new index (median about 150 to 300 ms at 50,000 tasks depending on machine load), so script 28 is not used. Frontend: backlog panel `Open and overdue` (default) | `Open` | `Overdue` (`bmetric`), direct end labels with nudging (4 or fewer lines per panel), markers at the ends beyond 14 points, Monday ticks with dates (`xTicks`), "Week of" tooltips and table, one title per panel and per tab, phone layout (16:9 chart, Compare task types (N) disclosure, tap tooltip). Known gap: at 375 px the app shell's 56 px rail leaves 271 px, so the chart is 271 px wide, not the 343 px of the acceptance text. Tests: unit (`DashboardRulesTests`, `trend-axis`, `trend-model`, `trend-chart`, `dash-trends-tab`, palette), integration (`DashboardTrendApiTests` Open at several clock instants and zones, weekly, `DashboardTrendLargePerformanceTests`), e2e `dashboard-trends-types.spec.ts` (axe at 1366, 1920, 375). Screenshots: `fixes/wp8b/`.
- WP10b Workload table, drawer, assign picker (#129, #131, #132): `POST /api/v1/tasks/assign-batch` (`Task.Assign`, 1 to 10 distinct tasks, each an ordinary assignment in its own transaction with its own audit entries and auto-start, per-task result with `CONCURRENCY_CONFLICT` etc., additive; OpenAPI and client regenerated; no SQL script). Table: sticky Person column, sortable headers with `aria-sort` in step with the toolbar Sort (a second click reverses), one "Open by priority" stacked count cell with the words in its accessible text, no horizontal scroll from 900 px up, sticky header under `--mf-dash-sticky-top`. Drawer: two-line rows with type icon and `mf-due-chip`, overdue first then priority then due date, "Reassign TSK-n" icon button (needs `Task.Assign`) instead of the assignee menu, focus to the next row, live region. Picker: the person's pods by default with an All pods switch (session), type icon, due chip, "Assign the next 3" with a confirmation that repeats the warning, checkboxes up to 10, per-task failures listed, Undo. Files: `users-table.ts`, `users-drawer.ts`, `users-assign.ts`, `inline-menu.ts` and `row-edit.ts` (icon trigger). Tests: unit (`users-table`, `users-drawer`, `dash-users-tab`), integration `TaskEditApiTests` (batch: permission, max 10, duplicates, partial failure, audit), e2e `users-tab.spec.ts` (widths, sort, drawer reassign, next 3, axe at 1366, 1920, 375). Screenshots: `fixes/wp10b/`.
- WP8a Trends frontend (#115, #114, #116, #119): delivered in `trend-chart`, `trend-model`, `trend-legend`, `dash-trends-tab` and the new `trend-measure`. Frontend only (the existing `all` and `byTaskType` day series already carry every measure; no API change). Two stacked panels (flows 320 px, backlog 200 px, same x scale and cursor), nice y axis (peak 21 gives 25), All task types hidden for scale while comparing, segmented measure controls plus a never-disabled "Compare task types" list, sticky chart. Extension points for WP8b (Open series, direct labels, Monday ticks, 375 layout) are listed in `docs/ux/dashboard-trends-types/README.md` (Design, last paragraph). Screenshots: `fixes/wp8a/`.
- WP5 Summary lists (#101, #103, #104, #105, #106, #107; #82 was done earlier): frontend only. The Summary lists read Task Queue rows, which already carry task type, client name and due date, so no DTO, OpenAPI or SQL change was needed. One-line 44 px rows (number, type icon, title, client, priority, due chip, actions) decided by a container query (list wider than 540 px), two lines below; 5 rows per list, 3 per list on a short window (1280 px wide, under 1020 px high) so all three headings and 3 rows are in the 1366x768 first screen; tiles left, one column of three lists right from 1280 px (no section headings, the list headings are "Unassigned", "Overdue", "Due soon"). Row buttons and links at least 24 px high. Due soon wording "Today and the next 2 days, excludes ASAP" from one constant, resolved end date in the tile tooltip and description. Tile captions wrap (no ellipsis), ASAP "No due date", On hold "Waiting on client, custodian or internal". Assign toast: `UndoService` placement `start` (bottom left of the main column from 1024 px, 24 rem wide; full width below, the last list gets bottom padding while it is open). Screenshots: `fixes/wp5/`. Tests: `dashboard-summary-lists.spec.ts` (bounding boxes at 1366x768 and 1920x1080, captions at 320/375/480, toast, axe), unit specs.
- WP7 Breakdowns (#109, #110, #111, #112, #113): `overdue` (int) on every `byTaskType`, `byPriority`, `byStatus` row and every `aging` bucket of `GET /api/v1/dashboard` (additive; same predicate as the Overdue tile, a second grouped read over the overdue subset, six scalar counts added to the aging statement; no SQL script), age buckets 0-2, 3-7, 8-14, 15-30, 31-60 and 61+ (`DashboardRules.AgingBands`, OpenAPI and client regenerated). The Breakdowns tab moved into the new `ui/dash-breakdowns-tab.ts` (dashboard-page only imports it); `bar-list`, `stacked-bar` and the new `breakdown-overdue.ts` draw the hatched overdue segment, the "N overdue" link (`<row query>&overdue=true`), the Overdue table column, the legend, the Low dashed stroke and the forced-colours rules. One title per card (H3) under a hidden H2 "Open tasks"; the grid follows the tab width by container query (4 across from 1300 px, 2 columns flowing top to bottom from 700 px, 1 below). Tests: unit (`charts`, `chart-contrast`, `dashboard-page`, `DashboardRulesTests`), integration `DashboardApiTests` (row and bucket overdue equals the queue, sums equal the Overdue tile, Dashboard.ViewBreakdowns alone), e2e `dashboard-breakdowns.spec.ts` (axe at 1366, 1920, 375, grid columns, tab order, layout shift, strokes). Screenshots: `fixes/wp7/`.
- WP1 Shell foundations (#97, #90, #95, #94, #98, #99): done in `e405d42`, frontend only (plus a one-sentence XML doc comment on `Permissions.Dashboard.View`, no catalog or SQL change). #97 `dash-url-state.ts` (defaults per tab, canonical address with replace, unknown parameters dropped; a plain `/dashboard` is no longer rewritten to `?tab=summary`, a valid `?tab=` is never rewritten). #90 the summary is read only while Summary, Breakdowns or Trends is shown (reused for 60 s across them), Swimlane and Users never call it, the timer acts on the visible tab, errors stay in the panel with the tab row. #95 `ui/dash-state.ts` (`data-dash-state="error|stale|empty"`, text Retry, reference, no toast through `QuietRequests.runInline`, focus rule via `focusAfterRetry`) replaces the eight `data-*` blocks (Coverage included). #94 `dash-stale.ts` and the age text beside Refresh. #98 `ui/dash-note.ts`. #99 `AuthStore.hasAnyDashboardTab` (menu item and landing). Screenshots: `fixes/wp1/`. Tests: `dash-url-state.spec.ts`, `dash-stale.spec.ts`, `dash-state.spec.ts`, page, tab, auth, guard and shell specs, e2e `dashboard-shell.spec.ts`. Hook for later work: `DASH_TAB_PARAMS` / `DASH_DEFAULTS` in `dash-url-state.ts` are where P1, P3 and the other new parameters register.
- WP2 Page chrome, roles and fixed-height tabs (#137, #92, #93, #100; #114 closed by the cap lift): frontend only. The Dashboard is a `mf-fixed-page`: from 768 x 561 px the document never scrolls and the header row stays; only regions inside the tabs scroll (Summary lists inside their panels from 1280 px, the whole Summary as one region below; Breakdowns cards; Trends: only the Task Types list, the two chart panels share the height, measured per panel; Swimlane lanes; Users cards, table and Coverage matrix). Below that the page scrolls normally (documented per tab in `fixes/wp2/README.md`). H1 (20 px) shares the row with the tab list, sticky from 600 px while the page scrolls; one permitted tab hides the tab list (H1 is the tab name, labelled region). Width cap lifted from 1600 px for Swimlane, Users and Trends. The 3-row cut of #101 on short windows and the sticky chart of #114 are removed. Tests: `dashboard-fixed-height.spec.ts` (no document scroll on every tab at 1366x768, 1920x1080, 1024x768, inner regions, keyboard, axe, widths), unit specs updated. Screenshots: `fixes/wp2/`.
- WP3 Period model (#91, includes C4): one period vocabulary on Summary, Trends and Coverage (7 days, 30 days default, 90 days, This month, Last month, Custom up to 366 days; Coverage appends Last 6 and 12 months), one label "Period" (`ui/period-control.ts`), `?period=7d|90d|this-month|last-month|6m|12m|custom&from=&to=` shared by the three tabs (default not written, the address wins, the last explicit choice is remembered in `mf.dashboard.v2.<user>`; old values week, month, quarter migrate to 7d, this-month, 90d, address stays clean). Summary says "Applies to Completed and Created. Open, Overdue, Due soon, Unassigned, On hold and ASAP are not affected."; Breakdowns, Swimlane and Workload have no control; Swimlane's own window is "Done in the last". Captions show the resolved range ("Sep 17 to Oct 16"). API: `period`, `from`, `to` on `GET /dashboard`, `/dashboard/trend`, `/dashboard/coverage`, resolved on the server in the viewer's zone by `DashboardPeriods.Resolve` (`PERIOD_INVALID`, `PERIOD_TOO_LONG`), response `period.key`; `periodDays` stays accepted for one release (now max 366); cache keys carry the resolved range; tile drill-through queries add `createdTo` / `completedTo` for past periods; OpenAPI and TS client regenerated; no SQL. A shared 6 or 12 month window reads as 30 days on Summary and Trends (no such item there) and is kept for Coverage. Screenshots: `fixes/wp3/`. Tests: `DashboardPeriodsTests` (month edges, zones, DST, limits), integration `DashboardPeriodApiTests` (fixed clock at three instants, three zones, all keys, totals equal on the three endpoints, 400s), unit specs (`dashboard-period`, `dashboard-prefs`, `dash-url-state`, page, users tab), e2e `dashboard-period.spec.ts` (shared link for another user, all tabs, custom errors, migration, axe at 1366, 1920, 375).
- WP4 Scope (#89): page-wide Scope select (All pods, My pods, one pod) at the right end of the tab row, left of Refresh, on every tab. `podScope` (`all` | `mine` | pod id) on `GET /dashboard`, `/dashboard/trend`, `/dashboard/swimlane`, `/dashboard/workload` and `/dashboard/coverage` (legacy `podId` still read as a pod id), resolved and validated on the server by `DashboardScopeResolver` (`mine` from membership; unknown pod 400 `UNKNOWN_POD`; a pod the caller may not see 403; the scope narrows and never widens the tab permissions), cache keys carry the scope, every drill-through query (tiles, breakdown rows, aging, trend legend, Swimlane lane links, the Users Unassigned chip) carries the `pod` filter so counts equal the Task Queue. New `GET /dashboard/scopes` (default scope by membership, own pods first, other pods only with `Pod.View`) feeds the select, the summary answers `scope {scope, podIds, unassignedNoPod}` for the quiet "N unassigned tasks have no pod. Show all pods" line, and the workload takes `includeNoPod` and answers `hiddenCount` for WP10a (additive: omitted means everyone, as before). `?pod=` in the address (default not written), remembered per user, address wins; a pod the person may not see falls back to the default with a note; `upod` and the old Swimlane pod filter are read once into `pod` and rewritten; the Pod controls of Swimlane, Users and Coverage are removed. No SQL script: `IX_Task_Pod (AssignedPodId, StatusCode)` already supports the predicate (a scoped perf test keeps the statement count). Tests: backend unit + integration (`DashboardScopeApiTests`, a scoped `DashboardPerformanceTests` case), frontend unit (`dash-scope`, url state, page, tabs) and e2e `dashboard-scope.spec.ts`. Screenshots: `fixes/wp4/`.
- WP10a Users workload tiles and toolbar (#130, #128, #127, #133): frontend only, because the server rule shipped with WP4 (`includeNoPod`, `hiddenCount`; no API, OpenAPI or SQL change). U4: the page always sends `includeNoPod` (false by default, `unopod=1` shows everyone), so chips, strip, tile totals, Out of office and the unassigned figure follow "active and (in a pod or holding an open task)"; a quiet line says "Showing N people who can take work. M others are hidden. Show them" ("Including people without a pod. Hide them" when on; not shown under a Pod scope); Clear filters keeps the switch. U2: text group "Workload | Coverage" (toggle buttons with `aria-pressed`, no second tablist, only with `Dashboard.ViewCoverage`, first control of the toolbar and of Coverage), icon buttons for tile size and layout with state names ("Tile size: dense"), distinct icons, 32 px, text tips on hover and focus, "Legend" word from 1100 px, one toolbar line at 1366. U1: capacity strip (bar stacked by load level, segments are filter buttons in step with the chips, named "Filter: 21 heavy"), "N unassigned tasks" link within the scope and the Assign work menu ("Show people who can take work now" = Available, Idle or Light, new sort "Fewest open tasks"; "Open the unassigned queue"); default sort unchanged. U7: Idle is the Idle token at 45% over the surface with a thin outline (no new token), chip tooltips and accessible names carry the thresholds, legend explains who is counted. New components `users-views.ts`, `users-capacity.ts`. Tests: unit (`users-model`, `dash-users-tab`, `dashboard-page`), e2e `users-capacity.spec.ts` (population rule with pod-less people, equal counts in chips, strip and API, scope, menu, keyboard order, axe at 1366, 1920, 375) and `users-tab.spec.ts` updated. Screenshots: `fixes/wp10a/`; docs: `docs/ux/dashboard-users/README.md`, ux-spec S01.
- WP9a Swimlane board (#122, #124, #123): frontend only, no API, OpenAPI or SQL change. Compact is a one-line card of 44 px (`swimlane-card.ts`: priority bar with the level glyph, type icon, number link, one-line title, assignee initials with the Out of office dot, due chip with short dates; client, matter, priority and assignee are in the hover text, the menus and progress in the drawer, `m` opens the drawer on this card; a container query drops the due chip icons in a lane under 300 px); a lane shows at least 8 cards at 1366x768 and 10 at 1920x1080, the remembered density applies on load (default stays Comfortable). Toolbar (`swimlane-toolbar.ts`): Search, Group, Sort, Filters, then a "..." menu button (ARIA menu button, Esc returns the focus) with Density, "Done in the last", Only mine, Expand/Collapse all; non-default settings show as text chips; one row of at most 56 px from 1100 px, two lines below. W3: one "Client / Matter name" line on cards (matter number in the hover text and as a link in the drawer), no client/matter line on tree cards, no assignee on assignee-group cards, tree labels wrap. W2: the lane count is a link (`a[data-lane-count]`, name "93 New tasks in the Task Queue") with lane status, Done window start, page scope and the supported filters; search text is left out with the tooltip "Search text is not included" and a dashed count (the queue could take `q`, the PM decision omits it); counts equal the queue totals in the e2e test. `aria-prohibited-attr`: the nodes were `aria-label` on plain spans (lane and group counts), fixed. Also: `inline-menu.ts` no longer swallows Escape on a closed trigger (Esc closes the drawer from any control). Tests: unit (`dash-swimlane-tab.spec.ts` compact card, card content by grouping, count links, "..." menu; `inline-menu.spec.ts`), e2e `swimlane-board.spec.ts` (heights, visible card counts at 1366x768 and 1920x1080, toolbar rows at 1100 to 1920, menu keyboard, tree labels, lane link counts equal the Task Queue totals with and without filters, axe at 1366, 1920, 375 incl. compact, tree and the open menu, no `aria-prohibited-attr` incl. needs review) and the updated `swimlane.spec.ts` (800-card test unchanged). Screenshots: `fixes/wp9a/`. Known gap: at 1366 a lane is about 265 px wide, so a compact title shows 8 to 12 characters; wider screens show more.
- WP11 Coverage (#134, #136, #135): `GET /dashboard/coverage` gets `groupBy` (`matrix` default | `type`, else 400 `UNKNOWN_GROUP_BY`; additive): `type` answers `byType` (per task type the people with count, alphabetical), empty `users`/`cells` and `scopePeople` (the scope's active people, null for all pods); same grouped read, so counts equal the matrix and the Completed total (OpenAPI and client regenerated). No SQL script (profiling: both orientations well under the 400 ms budget at 5,000 tasks / 300 people / 12 types; script 28 stays free). Frontend: orientation switch "By task type | Matrix" (`cov=matrix` only for the matrix, default `type` is not written), new `users/coverage-types.ts` (table, cards at 375, disclosure rows, "not handled" control, 60 types then "Show more"), neutral row orders (`rowOrder` remembered), search finds a type or a person; C3: two statements (neutral collapsed none, amber `role=status` one; "No one" / "One person" status; no "gap" or "bus factor"); C2: blank zeros named "Name, Type: 0 completed", gaps outlined only with the Training gaps toggle (now a highlight, default off), matrix capped at 30 people x 60 types with "Show more" (500 people x 30 types renders a bounded page). Addendum Q amended. Tests: backend integration (`CoverageByTypeApiTests` with a fixed clock: order, scope, boundaries, equal counts, permission; `CoveragePerformanceTests` both orientations), unit (`coverage-model`, `dash-users-tab`), e2e `coverage-by-type.spec.ts` (axe at 1366, 1920, 375, 500 x 30 stub) and `users-tab.spec.ts`, `dashboard-scope.spec.ts` updated. Screenshots: `fixes/wp11/`; docs: addendum Q, ux-spec, architecture, `docs/ux/dashboard-users/README.md`.
- WP6 Summary deltas and Technician view (#102 S3, #108 S9): `GET /api/v1/dashboard` additive and nullable: `overdueYesterday`, `openYesterday` (the Trends snapshot of yesterday for the same scope and zone: created by the end of the viewer's yesterday, not Completed or Cancelled by then, a due moment that had passed; no replay; three scalar counts in the headline statement, no SQL script), `completedPrevious`, `createdPrevious` and `previousPeriod { kind, from, to }` (equal span directly before the period, or the same days of last month for This month; `DashboardPeriods.Previous`), `mine { open, overdue }` only for `Dashboard.ViewUnassigned` without `Dashboard.ViewSummary`; a value is null (no line) when nothing existed at the baseline (OpenAPI and client regenerated). Tiles: glyph, signed number and words ("▲ +8 vs yesterday", "▼ -3 vs yesterday", "= no change vs yesterday", "+14 vs previous 30 days", "vs same days last month") on Overdue, Open, Completed and Created only, screen-reader sentence, tooltip with the baseline and the Trends caveat, attention colour only for Overdue going up (`dashboard-deltas.ts`, `stat-tile.ts`). Technician: H1 "Unassigned work" (single tab, queue only), own-work line with link to My Work, Priority and Task type filters from the column-filter foundation (`ListFilters`, `mf-filter-control`, `mf-filter-chips`, new `commaList` option; address `sprio` and `stype`, moved from the Users tab's parameters to Summary's), queue read from the Task Queue with `priority` and `type` so count, "Showing N of M" and "View all" equal the Task Queue, empty states through `mf-dash-state` ("No unassigned tasks match these filters." + Clear filters, "Nothing is unassigned in <scope>." + Show all pods), no-pod note; the strip is lazy (`dash-technician-bar.ts`, initial bundle unchanged at 622.43 kB). Small fixes: the tab list scrolls inside itself (`contain: inline-size`, `revealInList` instead of `scrollIntoView`; could not reproduce the 9 px at 320 px on this base in three combined runs and a 16-fold stress run, so it is hardened and covered by `dashboard-shell.spec.ts` at 320 and 375), `TaskQueueColumnFilterTests` Updated range uses its own database with a fixed host clock, `dashboard-fixed-height.spec.ts` seeds one task in nine task types for the Breakdowns "cards scroll" test, the shell five-minute timer test waits for its first read. Tests: `DashboardDeltasApiTests` (88 cases: four fixed instants, three zones, pod scopes, null baselines, technician with ViewUnassigned alone sees only own counts), `DashboardPeriodsTests.Previous`, unit (`dashboard-deltas`, `dash-technician`, `dash-state`, `dash-tabs`, page), e2e `dashboard-summary-deltas.spec.ts` (axe at 1366, 1920, 375) and the updated audit, permissions, shell and fixed-height specs. Screenshots: `fixes/wp6/`.
- WP9b Swimlane phone layout and verification (#125, #126; #93 verified here): frontend only. Below 900 px (`LANE_SWITCHER_QUERY`) a tablist "Swimlane lanes" (lane name over count, plain text; four equal tabs that fit the 271 px the shell leaves at 375) replaces the four lanes and shows ONE lane in a labelled tabpanel; In Progress by default, `lane=new|hold|done` in the address only when not the default (added to `DASH_DEFAULTS`), the last choice kept in `sessionStorage`; roving tabindex, arrows wrap, Home and End. Natural height and a sticky switcher while the page scrolls (under 768 x 561), the whole window height in the fixed-height page (768 to 899 px: one scroll region); the toolbar is Search, Filters and "..." (Group and Sort inside the Filters panel, counted on the button): two rows at 375, one at 768. Dashboard tab row at 375: the strip keeps `role="tablist"` and its keyboard, scrolls, and shows a fade and chevron at the edge that has more tabs (`data-more-start`/`-end`; a `ResizeObserver` on the strip). Big screens (measured, `fixes/wp9b/README.md`): 1920 x 1080 board 1652 x 912 px filling the width and height, 17 whole compact cards per lane (target 14), 5 whole comfortable cards (target 6: NOT met, gap reported on #87); above 2200 px a lane is at most 480 px wide, left aligned. #93: caps measured at 1366, 1600, 2560 for Summary, Breakdowns, Trends, Swimlane, Users and Coverage, layout shift on tab switches 0.0000 at 1920. Tests: unit (`dash-swimlane-tab`, `swimlane-model`, `dash-tabs`, `dash-url-state`), e2e `swimlane-phone.spec.ts` (375, 768, 1024, 812x375, axe at 375, 768, 1366, 1920, 2560, tab row at 375) and the swimlane and scope specs adapted (`lane=new` below 900 px). Screenshots: `fixes/wp9b/`.
