# PM v2: final verification (epic #851, issue #890, packages PV-36 to PV-39)

Date 2026-10-27. Base `origin/dev` at `e35f929`, plus the changes of the final package (this commit). Design and findings: `docs/ux/pm-v2-review/README.md`; plan: `delivery-plan.md`; decisions: `docs/requirements/decisions-addendum.md` section AN; operations: `docs/runbook.md` section 15; performance: `docs/ux/pm-review/performance.md` ("PM v2").

## 1. What was run

| Check | Command | Result |
|---|---|---|
| Backend build, warnings as errors | `dotnet build -warnaserror` (integration and schema test projects build the whole solution) | 0 warnings, 0 errors |
| Format | `dotnet format MatterFlow.sln --verify-no-changes` | clean |
| Unit tests | `dotnet test tests/MatterFlow.UnitTests` | 2,316 passed |
| Architecture tests (module boundaries) | `dotnet test tests/MatterFlow.ArchitectureTests` | 47 passed |
| Schema tests (scripts 01 to 47 replay, indexes) | `dotnet test tests/MatterFlow.SchemaTests` | 98 passed, including the two new tests of script 47 |
| Sensitive-matter suite, rule on and off (catalog, six-persona walk, mutation, PM v2 parity) | `dotnet test --filter Sensitive...` | all passed (the focused run of 16 tests, and the "switch off" tests of the feature suites) |
| Asset report engine, Data and volume APIs, REPORT_TIMEOUT | `dotnet test --filter AssetReport/AssetData/AssetVolume` | all passed |
| Performance (100,000 assets, 200,000 index rows) | `MyMattersPerformanceTests` PM v2 tests, quiet machine | 3 passed; numbers in the performance document |
| Frontend lint | `npm run lint` | clean |
| Frontend format | `npm run format:check` | clean |
| Frontend unit tests | `npm test` (frontend 4,192, form-engine 319) | all passed (`global-search` "debounces" failed once under a load average of 12 and passed alone: timing, not a defect) |
| Bundle gate | `npm run build:report` | initial **641.53 kB**, limit 700 kB (error budget in `angular.json` is now 700 kB, warning 680 kB; it was 700 kB warning and 1 MB error); every PM v2 screen is a lazy chunk (below) |
| Contracts | `node contracts/validate-contracts.mjs` | OK; no API change in this package, so the OpenAPI file and the generated client are unchanged |
| End to end, sensitive-matter specs with the rule ON on a fresh database | `frontend/e2e/run-local.sh sensitive-` (turns `Features__SensitiveMatterAccess` on by itself) | 14 passed (`sensitive-leak-scan` now also opens the Breakdown, Data and Trends tabs in both scopes and runs the report builder for each persona; `sensitive-ui`) |
| End to end, the specs named for this package | see section 3 | see section 3 |

Not run in one piece: the whole 302-file, 2,981-test Playwright suite. A first full run was stopped by a container restart after about 1,570 tests (alphabetically up to `swimlane`, 33 failures: see section 3 for how they were classified); the rest was then run in two groups (section 3).

## 2. Bundle gate (PV-38)

`npm run build:report` runs `ng build --stats-json --verbose`, prints Angular's report and lists every chunk that carries a PM v2 screen by the source file it starts at, failing when the initial total is over 700 kB or when one of them is part of the initial bundle:

| Chunk | Size |
|---|---|
| My Matters page | 66.97 kB |
| Breakdown tab | 18.05 kB |
| Data tab | 28.46 kB |
| Deadlines tab | 16.11 kB |
| Activity tab | 14.21 kB |
| Trends tab | 17.36 kB |
| Asset report builder | 52.43 kB |
| Pie chart | 0.28 kB (the charts share a lazy base chunk) |
| Bar chart | 3.58 kB |
| Column chart | 3.84 kB |

Initial total 641.53 kB (173.29 kB transferred); 548 chunks, 39 initial, 252 lazy files in the report. One style budget warning that is not new: `roles-page.scss` 6.03 kB over 5 kB.

## 3. End-to-end classification

Every failure was classified before it was fixed.

**First full run (clean `origin/dev`, 1,570 tests reached):** 33 failures. Re-run on a fresh stack (590 passed, 5 skipped, 14 failed) they reduced to 14, the rest being **flakes or contamination** of a shared stack under a load average of 12 (coverage-by-type, dashboard-consistency, dashboard-fixed-height, matter-columns, nav-phone, profile-pf8-final, pw1-bugs, pw3-strip, px5-matter, px7-add-work, rp5-reports-admin, t8-edit-create; they were also disturbed by test data I created on that stack while probing).

| Spec | Class | What and the fix |
|---|---|---|
| `ad3-labels-shell` | stale spec | the Labels page has a third tab, On-hold reasons (#876); the tab list and the End key now expect it |
| `column-filters` (8 tests) | stale spec | the Assets filter row has opened by default since #499 and its Status column is the Disposition column since #883; the list is a card list on a phone; three more columns lengthen the Tab order. Spec updated (helper `setRow`, `Disposition` names, 16 Tab presses, the card locator) |
| `pv-pm-ui:242` (lane H) | stale spec | the PM's tab list now has Data (#870) |
| `final-verification:140` | stale spec | the task type badge (#854) sits in the Title cell with its own accessible name; the spec reads the title without it |
| `dashboard-audit:242` | stale spec | `[data-tip]` is also the rail's label attribute; scoped to `main` |
| `clients-final:172` | stale spec (1.3 px) | the Matters list is 1.3 px wider than its scroll box at 768 px, which is named and scrolls; the tolerance is now 2 px |
| `swimlane-board:458` | environment | needed `E2E_AXE_PATH`; now falls back to the installed `axe-core` like the other specs |
| `pw4-workload:321` | flake | axe `target-size` (a button partly covered after a scroll); passes on a quiet run, not reproduced |
| `wp12-phone-cards:797`, `pm4-bulk-tasks` (lane H) | passed | both pass on current `dev` (the earlier failures were load) |
| breakdown-pie (lane H) | passed | `dashboard-breakdowns` passes |

**Real bugs found by these runs and by the new checks (fixed):**
1. `POST /asset-reports/run` and the saved run answered **500** when the 10 second limit was reached (see the performance document); now a 409 `REPORT_TIMEOUT`; test added.
2. On a phone a **very long asset type, matter or task type name widened the Data tab** (the select and its label grew to the name, 1,033 px page) and **the Breakdown cards** (a 60-character word). `dt__field` is now one shrinkable grid column and `bd__card` wraps (`min-width: 0; overflow-wrap: anywhere`); regression test `pv-final-gate` "very long names".
3. Two plans of the PM v2 reads (select-field reports, type-filtered counts) were scans; script 47.
4. The Task Types list at 640 px (Target column), its skeleton (layout shift) and the new-task-type form with a 100-character name (table above).

**Specs run on the final code (fresh stacks):** `sh-*` (all), `sr1`, `sr2`, `sr5`, `sr6`, `sr7`, `pv-*` (all twelve, including `pv-asset-disposition`, `pv-export`, `pv-saved-views`, `pv-task-types-on-hold`, the batch B specs `pv-assets-pages`, `pv-data-tab`, `pv-matter-overview`, `pv-matters-list`, `pv-notifications-group`, `pv-search-hits`, `pv-asset-report-builder`), `pm4-*`, `wp12-phone-cards`, `dashboard-breakdowns`, `sensitive-*`, and the new `pv-final-gate`: R2 below. Remaining specs (task, ty, users, ux, workflow, wp, swimlane, t4, t7, px6, review, rich, permissions, profile): R3 below.

R2: 590 passed, 5 skipped, 14 failed before the fixes above; every one of the 14 passes after them (re-run groups: `column-filters` 49/49, the rest individually).

R3 (task, tq, ty, users, ux, workflow, wp, swimlane, t4, t7, px6, review, rich-description, permissions, profile specs): 1,528 passed, 21 skipped, 17 failed. Classification of the 17:

| Spec | Class | Fix |
|---|---|---|
| `ty-permissions-matrix:458` | stale spec | the Labels page's third tab (On-hold reasons); count 2 or 3 |
| `ty3-cards:273` (Task Types at 640 px scrolled sideways, 593 against 536 px) | **real bug** (PV-02 added the Target column to the list) | the Target column now drops below 768 px, after Request form; `ty3-task-types` column order updated |
| `ty2-states:72` (layout shift 0.027 at 768 px) | **real bug** (same column) | the skeleton bone of Target is as wide as its header (5 rem instead of 2 rem) |
| `ty4-task-type:810` (a 100-character name widened the new-task-type form to 834 px at 375 px) | **real bug** (the colour preview's no-wrap name made the grid column as wide as the name) | `.edit` and `.field` are `minmax(0, 1fr)` columns |
| `wp10-hold-colours` | stale spec | the tooltip of an On Hold row is the hold sentence and then the reason (#877) |
| `wp10-matter-tabs:315` | stale spec | the Size column (#883) sits before the External reference |
| `wp2-list-states:322` | stale spec | the Assets list is a card list on a phone |
| `wp22-columns-widths:232` | stale spec | 21 columns (Task type, #855) |
| `wp3-record-header:636` (two) | stale spec | the Details block is a disclosure on the Matter Overview since #882; the spec opens it |
| `wp9-list-columns:490` | stale spec (sub-pixel) | tolerance 2 px, as in `clients-final` |
| `users-us1-bugs` (two), `users-us6-pods`, `users-us7-flows` (two), `ty-permissions-matrix:272`, `ty9-audit:358` | flake | pass alone or on a re-run; they create rows with names or counts that other specs of the same run disturb (409 duplicate name, a list of 6 instead of 3 users) |
| `ty4-task-type:560` ("a disabled entry can be reached with the arrows") | **open, not investigated** | fails on every run on the current build, in isolation as well (the first option is active instead of the disabled one); it is the Workflows tab of the Task Type page, not a PM v2 screen; not compared with a clean `origin/dev` build |

R6 (re-run of the fixed specs and the flaky ones, 266 tests): all the fixed ones pass; `ty4-task-type:560` still fails; the four flakes pass when run alone.

**Not run:** the specs outside R2 and R3 that the first full run had already passed on the base (about 1,570 tests; not re-run on the final code), and the Data tab / report specs were run against a build made before the last backend change (Data tab statements 8 to 6); that change is covered by the integration tests (`AssetDataApiTests`, parity with the Assets list).

## 4. Accessibility, four widths, phone (PV-38)

Each new screen has axe (WCAG 2 A, AA, 2.1 AA, 2.2 AA and best practice) at 1920x1080, 1366x768, 768x1024 and 375x812 and a no-sideways-scroll check in its own spec: Breakdown (`pv-pm-ui`), Data (`pv-data-tab`), the report builder (`pv-asset-report-builder`), the section toolbar and Focus (`pv-task-types-on-hold`, `pv-pm-ui`), the hold dialog, the disposition dialog (`pv-asset-disposition`), Export and Views menus (`pv-saved-views`), the on-hold reasons tab, the task type page, Matters, Assets, Matter Overview, notifications and search. The final gate (`pv-final-gate.spec.ts`) adds: all six My Matters tabs at the four widths (title rule `My Matters: <Tab> - MatterFlow`, one level-one heading, axe, no sideways scroll); keyboard only (type filter, Focus, Views, Export open from the keyboard, Escape closes and returns focus to the button, a Breakdown cell is followed with Enter); reduced motion (nothing animates on Breakdown, Data or the chart, and the one hover transition of the pie is off, and on without the preference); very long names on a phone. Screenshots at four sizes of the PM's whole day and of every PM v2 screen: `docs/ux/pm-v2-review/after/<size>/` (`walkthrough-after.mjs`, 152 shots, no page overflow in any, facts in `walkthrough-after.json`); the per-spec shots are in `after/specs/`.

## 5. Findings F-01 to F-27 of the review

| Finding | Severity | Summary | Packages | State | Proof |
|---|---|---|---|---|---|
| F-01 | major | No task type anywhere in the lists: Needs my attention, Upcoming deadlines, Since your last visit, Recent acti... | PV-04, PV-06 | built | pv-pm-ui, MyMattersSections tests; pv-task-types-on-hold (toolbar) |
| F-02 | major | No sort or filter inside a section; groups are cut to 10 rows (deadlines 25 of 26, "Showing the first 25 of 26... | PV-04, PV-06 | built | pv-pm-ui, MyMattersSections tests; pv-task-types-on-hold (toolbar) |
| F-03 | major | No view of work per task type across matters (no matrix, no count by type).... | PV-09, PV-11 | built | pv-pm-ui; pv-pm-ui (Breakdown) |
| F-04 | major | No data view at all: no size, no asset status, no warnings.... | PV-18, PV-19 | built | AssetDataApiTests; pv-data-tab |
| F-05 | minor | First screen at 1366x768 is the strip plus "Since your last visit"; Needs my attention starts at y=720 and the... | PV-08 | built | pv-pm-ui (Overview) |
| F-06 | minor | The same task appears up to three times: TSK-119 is in Overdue and in Unassigned, due-today tasks are in Due s... | PV-08 | built | pv-pm-ui (Overview) |
| F-07 | minor | Matter health: all five matters are "Red"; the flag carries no information; the reason is behind "How is this... | PV-08 | built | pv-pm-ui (Overview) |
| F-08 | minor | Three "new task" controls on one page: header "Create task", "New task" menu, "+ New task" per health row.... | PV-08 | built | pv-pm-ui (Overview) |
| F-09 | minor | Trends: two large charts and a three-bullet warning take the whole tab; with demo data the history is flat exc... | PV-12 | built | pv-pm-ui (Trends) |
| F-10 | nit | The Dates filter (Next 4 weeks) applies only to Upcoming deadlines and says so in a sentence; the filter bar t... | PV-08 | built | pv-pm-ui (Overview) |
| F-27 | major | Phone (375x812): the first screen is the title, the scope switch, a New task button, Filters and seven count c... | PV-08, PV-38 | built | pv-pm-ui (Overview) |
| F-11 | minor | On hold 9 in the strip is a count with no reason and no age.... | PV-26 | built | pv-pm-ui (hold dialog) |
| F-12 | minor | Matters list: Name and Client are truncated ("Demo Emp...", "90001 Demo...") while the Status column and the r... | PV-30 | built | pv-matters-list |
| F-13 | minor | Matter Overview shows a header strip and a skeleton first; the Details block is at the bottom; no task-type mi... | PV-31 | built | pv-matter-overview |
| F-14 | minor | Matter Tasks tab has no by-type summary and no sort by type; the Assets tab lists assets without size or dispo... | PV-31, PV-32 | built | pv-assets-pages; pv-matter-overview |
| F-15 | nit | "Project manager: Test User 03(primary)" lacks a space before the bracket (06).... | PV-31 | built | pv-matter-overview |
| F-16 | major | Task Queue shows the type icon in grey with the name only as a mouse `title` attribute (not reachable by keybo... | PV-03, PV-26, PV-28, PV-29 | built | pv-export; pv-pm-ui (hold dialog); pv-task-types-on-hold |
| F-17 | major | Assets list: no size, no disposition; Linked tasks is 0 for every demo asset so the column does not help; the... | PV-15, PV-32 | built | pv-asset-disposition; pv-assets-pages |
| F-18 | major | Asset record: Active/Inactive only; "This asset has no type-specific values" for a seeded asset, so the size f... | PV-14, PV-15, PV-16 | built | AssetIndexTests, pv-data-tab; pv-asset-disposition |
| F-19 | minor | Clients and Projects lists are scoped correctly (scope switch, count line) but show no count of "my matters" p... | PV-35 | built | pv-matters-list (counts) |
| F-20 | minor | Search: task hits show Ref, Title, Matter, Status; no type, no due date; "Other matter" labels work (16).... | PV-34 | built | pv-search-hits |
| F-21 | minor | Bell: 99+ unread, five "Overdue by n days" items, one notice per task; a PM with 13 overdue tasks gets 13 noti... | PV-33 | built | pv-notifications-group |
| F-22 | nit | Menu is short and right (My Matters, Matters, Tasks, Assets, More); the header "Create task" and the page "New... | PV-08 | built | pv-pm-ui (Overview) |
| F-23 | minor | Create task from the matter header works (matter locked); the chooser is an alphabetical grid of 15 cards (Acc... | PV-07 | built | pv-pm-ui (Focus) |
| F-24 | major | **Task type icons already exist** (`TaskType.IconKey`, Tabler outline library `contracts/task-type-icons.json`... | PV-01, PV-04 | built | pv-pm-ui, MyMattersSections tests; pv-task-types-on-hold |
| F-25 | major | Asset Types have no size designation, no disposition vocabulary; the seeded number fields are not indexed (0 i... | PV-16 | built | AssetIndexTests, pv-data-tab |
| F-26 | minor | Task Type page has no target turnaround; Labels page has no on-hold reasons.... | PV-02, PV-25 | built | pv-task-types-on-hold; pv-task-types-on-hold (reasons) |

## 6. Issue tick-list

All child issues of #851 are closed by their own commits (checked below on 2026-10-27); #868 (demo seed and e2e fixtures, PV-17) was open and is done in this package: `tools/seed-demo` now gives task types a colour and a target, asset types a size field, a tenth of the demo assets a disposition, and held tasks an on-hold reason (idempotent, never overwrites an administrator's choice).

## 7. For the owner to try (ten minutes)

1. Sign in as a Project Manager: My Matters, the six tabs, type badges, the filter and sort in a section, Focus.
2. Breakdown: click a cell; compare the footer total with the strip. Data: click a number; the Assets list shows exactly those assets.
3. `/assets/reports`: Count by disposition, then Sum of size by a select field; Pie, Bar, Show as table, Save, Export.
4. Put a task On Hold (the dialog asks for a reason); Labels, On-hold reasons.
5. Task Queue: Export (CSV and Copy), Views (save one, make it the default).
6. Resize the window to a phone: nothing scrolls sideways, even with a very long matter name.

## 8. Deviations and open points

- Performance: two measured calls are over the p95 budget on this machine (the volume chart for 72,500 assets, 453 ms against 300; the average by a select field for the same person, 522 ms against 500); levers are listed in the performance document; no snapshot table was built.
- The full Playwright suite was not run in one piece (section 1).
- The demo seeder still reports about 15 of 200 tasks failing form validation (a required field its form filler does not fill); unchanged by this work.
