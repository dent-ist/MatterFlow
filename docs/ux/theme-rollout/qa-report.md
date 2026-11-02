# Theme rollout: QA report (epic #982, issue #998)

## PROGRESS (final, 2026-11-02 04:40 UTC)

Overall: **100%** (all stages done). Verdict: **READY TO MERGE**.

| # | Stage | Weight | Status | Result |
| - | ----- | ------ | ------ | ------ |
| 1 | Setup, build, fresh stack | 5% | done | worktree with own node_modules, backend build -warnaserror and Release 0 warnings, fresh SQL containers and ports |
| 2 | Backend unit/arch/schema, lint, prettier, tsc, unit suite, bundle, contracts/OpenAPI | 10% | done | all pass: unit 2,455, architecture 47, schema 102; lint (ledger 0, contrast 74), prettier, tsc app/spec/e2e; frontend 363 files 4,319 tests + form-engine 319; bundle 655.47 kB; contracts OK; no OpenAPI or nswag drift |
| 3 | Full backend integration | 15% | done | 12 pieces, 1,640 cases covering all 1,235 test names: all pass (one timing test failed under load, passes alone) |
| 4 | Full Playwright | 35% | done | 2,939 tests: 2,825 passed, 42 failed, 48 skipped, 24 not run; all failures classified, fixed or known (#980) and re-run; branding 17 / 17 |
| 5 | Sensitive e2e, axe four sizes, visual review | 10% | done | sensitive 14 / 14 (rule ON); axe 0 violations on about 650 route and size combinations for five roles, 80 open dialogs and menus, 200 % and 400 % zoom |
| 6 | Exploratory hunt | 18% | done | 1 real bug beyond the suite (clipped focus ring), 3 issues filed |
| 7 | Fixes and re-runs | 4% | done | 5 fix commits (3 real fixes, the rest stale specs) |
| 8 | Report, issues, epic | 3% | done | this report; #983 to #996, #998 and #999 closed; #997 and #1000 stay open |

Findings: 3 real regressions fixed (Dashboard phone jump, admin tables sideways, clipped dialog focus ring), 4 items open (#1022, #1023, #1024, #1000), about 30 stale specs updated.

## 1. Verdict

**READY TO MERGE**, with the open points of section 6 (none blocks). Branch `theme-all-pages` from 97f5262, QA commits on top (section 4).

Reasons: every automated check passes after the QA fixes (the only red Playwright test is the known 1366x600 scroll of #980, unchanged by the rollout); the sensitive-matter rule holds (14 / 14 with the rule on, fresh database); axe finds nothing at four sizes, at 200 % and 400 % zoom, or in 80 open dialogs, menus and dropdowns (one best-practice heading-order note in the form designer, older than the rollout); the colour ledger is zero and lint is green; the initial bundle is 655.47 kB (limit 700); OpenAPI, the generated client, contracts, module boundaries and SQL scripts (highest 50) are untouched and in step. The QA found two real regressions of the rollout (a phone layout jump on the Dashboard, and two admin tables that scrolled sideways with a 77 px Name column); both are fixed here. Three smaller consistency gaps are filed (#1022, #1023, #1024) and #1000 stays open.

## 2. What ran

| Area | What | Result |
| --- | --- | --- |
| Backend build | `dotnet build -warnaserror --no-incremental`, and a Release build | 0 warnings, 0 errors |
| Backend format | `dotnet format --verify-no-changes` | clean |
| Backend unit / architecture / schema | `MatterFlow.UnitTests`, `ArchitectureTests`, `SchemaTests` (replays scripts 1 to 50) | 2,455 / 2,455; 47 / 47; 102 / 102 |
| Backend integration | all 1,235 distinct test names in 12 pieces by namespace (performance classes first, alone), 1,640 test cases | 1,639 passed; 1 timing failure (`MyMattersPerformanceTests`, 100,000 assets, assets name filter 1,191 ms while I was publishing) passes alone, 12 / 12 |
| Frontend static | eslint incl. colour ledger (0 files) and contrast (74 pairings), prettier, tsc for app, spec and e2e, again after the fixes | clean |
| Frontend unit | `ng test frontend`: 363 files, 4,319 tests; `form-engine` 10 files, 319 tests; re-run in full after the fixes (section 3) | all pass |
| Bundle gate | `ng build` | initial total 655.47 kB. Style budget warnings `app-shell.scss` 5.20 kB and `roles-page.scss` 6.08 kB: the same two as before (5.17 and 6.03 kB), not new |
| Contracts / OpenAPI / client | `validate-contracts.mjs`; Release build then `git diff` of `contracts/openapi/v1.json`; `npm run api:generate` then `git diff` | OK, no drift |
| Playwright, whole suite | chromium, 1 worker, fresh SQL container and published API (port 5731), 2,939 tests in 298 files, 3.7 h | 2,825 passed, 42 failed, 48 skipped, 24 not run (17 branding tests, 7 after a failure in a serial file); every failure classified (section 3), the branding project (17 / 17) and the rest of the serial file (12 / 12) run afterwards |
| Sensitive-matter e2e | `sensitive-leak-scan`, `sensitive-ui` with the rule on, own fresh SQL and API (port 5741) | 14 / 14 |
| Axe | WCAG 2 A and AA, 2.1 AA, 2.2 AA and best-practice: 54 routes as System Administrator, 24 routes each as Project Manager, Technician, Director and a restricted user, at 1366x768, 1920x1080, 768x1024, 375x812 (about 650 route and size combinations, demo data); 80 open states (menus, dropdowns, bell, user menu, Edit task dialog, row menus) at the four sizes; 683x384 (200 % zoom) and 320x568 (400 %) on 24 routes | 0 violations; no sideways page scroll; no console errors or failed network calls. One exception: `heading-order` (moderate, best-practice) on the Task Type form designer, same on `dev` (#1024) |
| Exploratory | demo stack (`seed:demo --aged --seed 7`, sensitive rule on): Task Queue, My Work, Pod Work (as a Pod Lead), column filters of Matters, Assets, Clients, Projects (choose, URL, reload), Dashboard tabs and charts, task page menus and dialogs, Create task, Search, Profile time zone with type-ahead, state pages, Roles, form designer, print preview, admin list widths at 11 window sizes | section 5 |

## 3. Failures of the full Playwright run and their classification

| # | Test (spec) | Classification | Fix |
| --- | --- | --- | --- |
| 1 | `dashboard-skeletons` at 375, six tabs (panel moved 8 px when the data arrived) | **real bug**: the Scope dropdown is 44 px below 768 px but its row was 36 px until the pods were read, so the whole Dashboard jumped | ef90da4 |
| 2 | `ty3-cards` types at 1280 (table scrolls sideways), `ty3-task-types` and `ty3-workflows-steps` column order | **real bug** (and stale expectations): the capitals of the new heading row made every column wider; Task Types and Workflows scrolled sideways between 1100 and 1366 px and the Name column was 77 px. Measured scroll overflow 115 px at 1100 and 53 px at 1280 | ffe94d3 (limits moved: Task Types Open tasks 1440, Workflows 1280, Request form 1180, Target 1000; Workflows Last published 1366, Task types 1180) and f115103 (unit spec) |
| 3 | `ad4-asset-types-list` | stale (strip is `mf-filter-chips`, not `mf-work-strip`) | f6cab53 |
| 4 | `as3-list`, `column-filters` (filter sheet), `wp13c`, `users-us3` (Sort by) , `ty3-cards` (Filter by Versions) | stale (dropdown buttons, no `option` elements, label now "name: value") | f6cab53, ffe94d3 |
| 5 | `my-work-drill-in` M7 (Pod Work focus on Back) | stale: the native select always wrote `podId` to the address; the dropdown does not when the pod is already shown. Product side filed in #1024 | f6cab53 |
| 6 | `pw1-bugs` x5, `pw7-keyboard` | stale: dropdown is 36 px (44 below 768), the tooltip is on the host, arrow keys open the list instead of changing the pod | ffe94d3 |
| 7 | `ty3-lists`, `ty3-workflows-steps`, `wp9-list-columns` x2, `wp26-print`, `task-types-tabs`, `ty3-task-types` | stale: headings are capitals (read with `textContent`), `.chip` also matches the new filter chips | ffe94d3 |
| 8 | `swimlane` (card bar hidden), `users-tab` (left border), `wp10-hold-colours` x2 (pill colours, dot icon), `profile-pf3` (card radius 12 px) | stale: no coloured left edge by design, chips read `--mf-status-*` tokens, xl radius | ffe94d3 |
| 9 | `users-us8` (13 tab stops, budget 12), `wp9-density` (chrome 234 px, limit 230), `wp8-list-chrome` (Matters at 768 px: sheet by design), `wp14-due-cell` ("EDT": the clocks went back on 2026-11-01; line 2 is 155 px on a phone card) | stale thresholds and a date-dependent expectation | ffe94d3 |
| 10 | `matter-client-details-tab` (1366x600 document scroll, 137 px) | **known**, #980, unchanged by the rollout | not fixed |
| 11 | `pw4-workload` 375 (axe target-size "partially obscured"), `wp9-fixed-layout` ("menu value Rush ... 132 > 80") | load / data flake: pass alone and in the re-runs | - |

Re-runs: all 42 named tests were run again on a fresh stack with the fixed build (two rounds, 58 and 56 test cases): all pass except #980; `wp14-due-cell` was fixed after the second round and is in the final batch below.

## 4. Commits of the QA (branch `theme-all-pages`)

- ef90da4 Dashboard header row does not grow when the Scope appears on a phone (real fix).
- f6cab53 four stale specs (strip chips, filter sheet dropdowns, Pod Work return focus).
- ffe94d3 first fix of the admin list column limits and about 20 stale specs; f115103 unit spec of the limits.
- 57c1953 focus ring of full-width fields in confirm dialogs (Put on hold, Cancel) is no longer clipped (real fix, found in the hunt).
- 4441c79 final Task Types and Workflows limits: Open tasks stays at 1366 px, Default workflow text clipped at 10 rem, Workflows shows Task types from 1200 px; measured no sideways scroll at 640 to 1920 px (real fix).
- Progress commits of this report (docs only).

The last re-runs, on the final build: Task Types, Workflows, Steps, narrow-window, Dashboard skeleton and task type cross-link specs 75 / 77 (the two others are `wp14-due-cell`, below); the dialog specs (`sh-dialog-rule`, `t4-menus-dialogs`, `wp1-dialogs-popovers`, `ty-dialogs`) 97 / 98 on the build before the last column fix (the one failure was the Open tasks column, fixed in 4441c79 and passing in the last run); unit tests of `admin` and `shared/ui`: 122 files, 1,311 tests, and the whole frontend suite earlier on the same sources: 363 files, 4,319 tests.

`wp14-due-cell` (two tests) fails when it is run late in the evening New York time (about 22:30 to midnight): the seeded "overdue 3d" and "overdue 4d" rows read one day less (elapsed hours against a due moment late in the day). It passed in the full run and in an earlier re-run the same evening, and it does not touch the rollout: a time-of-day sensitive spec (the DST change of 2026-11-01 had already broken its "EDT" check, fixed). Not fixed here; re-run it in the morning.


## 5. Exploratory findings (demo data; administrator, Project Manager, Technician, Director, restricted user)

Fixed in this QA:
1. Dashboard jumped 8 px on a phone when the Scope dropdown appeared (ef90da4).
2. Task Types and Workflows tables scrolled sideways between 1100 and 1366 px and squeezed the Name to 77 px; Open tasks and Last published appeared too early for the wider capital headings (ffe94d3, 4441c79).
3. The orange focus ring around the reason field of the Put on hold and Cancel task dialogs was cut off at the left and right edges (57c1953).

Filed, not fixed (label phase-24, linked under #982):
- #1022 native selects remain in forms, dialogs (hold, cancel, edit) and the Swimlane and Users toolbars of the Dashboard.
- #1023 Task Queue, My Work, Matters and Assets lists scroll sideways between about 1024 and 1200 px with realistic data (Status column cut off at 1100 px; the same thing fixed for Task Types and Workflows here). Not compared with `dev`.
- #1024 small leftovers: form designer heading order (older than the rollout), print noise (row menu buttons, sort glyphs, a screen hint), Pod Work focus on Back when the address has no pod, regular-weight Create task and New task type titles, a cut placeholder in the Task Queue Matter number filter.
- #1000 (403, 404 and error pages use their own centred card) stays open: `mf-record-state` is a record component (kind, permissions, crumbs), the system pages follow the approved S10 mock and about ten specs describe them; it needs a design decision, not a CSS tweak. #980 (1366x600 scroll) is unchanged.

Checked and fine:
- Every column filter dropdown of Matters, Assets, Clients and Projects: opens, chooses, writes the address, survives a reload. Work grids: priority filter writes the address and survives a reload, clear filters, rows per page, next page and Back, export menu (CSV, copy). Pod Work as a Pod Lead: Your pods and Other pods in the dropdown, three tabs, Assign to me buttons.
- Dashboard: Summary, Breakdowns, Trends (Created blue solid, Completed teal dashed, Open violet, Overdue red: distinguishable by colour and by line style and marker), Swimlane (cards, Sensitive marker), Users; Scope and Period dropdowns.
- Sensitive marker and the sensitive rule: 14 / 14 in the sensitive run. Task page menus and dialogs (status menu, Put on hold, Cancel task, Edit task details) render in the theme and are axe clean.
- Profile time zone dropdown: type-ahead moves, Escape returns focus to the button. Search tabs and counts.
- State pages 403, 404 and error at four sizes: axe clean, the heading takes focus.
- Form designer (published version, preview tab) renders with the tokens and no colour fallbacks.
- Uppercase table headings are readable (small bold muted capitals, contrast checked); no coloured left borders (the Users tile spec now asserts it); no console errors or failed requests in any sweep (the 403 and 404 pages answer on purpose).
- Print preview of Task Queue and Matters: a clean grid with a heading row and a print line.
- 200 % zoom (683x384) and 400 % (320x568): no sideways scroll, axe clean on 24 and 21 routes.
- Keyboard: the shared dropdown opens with Down, moves with the arrows, Home, End and type-ahead, chooses with Enter, closes with Escape and returns focus (a spec change, not a bug: the native select changed its value on one arrow press). No shortcut was added or changed (#420).

## 6. Not run, residual risks

- Windows authentication, IIS, browsers other than Chromium, real touch devices, a screen reader. Phone widths were tested by viewport only.
- Visual review was by screenshot of the main pages at 1366 and 375 px, not every state of every page at every size; the sweep proves axe, scroll and console, not taste.
- `wp14-due-cell` is time-of-day sensitive (section 4). The integration performance classes are timing sensitive; one failed under load and passed alone.
- The shared heavy-slot gate was held for over an hour by another agent's finished `dotnet` job (the file lock leaked to its MSBuild nodes) and my queued jobs waited up to 50 minutes; nothing in the product depends on it.
- #1022, #1023, #1024 and #1000 are open; none blocks the merge. #1023 may be older than the rollout (no baseline build was compared).
- `dev` and `main` were not touched. The PR to `dev` is the project manager's step.

## 7. Effort

About 17 agent-hours elapsed, of which about 6 were queue waits for heavy slots.
