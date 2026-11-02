# Theme rollout: QA report (epic #982, issue #998)

## PROGRESS (updated 2026-11-02 04:10 UTC, stages 4 and 5 mostly done, stage 6 running)

Overall: **82%**

| # | Stage | Weight | Status | Result so far |
| - | ----- | ------ | ------ | ------------- |
| 1 | Setup, build, fresh stack | 5% | done | worktree, npm ci, backend build -warnaserror 0 warnings, Release build 0 warnings |
| 2 | Backend unit/arch/schema, lint, prettier, tsc, unit suite, bundle, contracts/OpenAPI | 10% | done | all pass: format clean; unit 2455/2455, architecture 47/47, schema 102/102; lint (colour ledger 0, contrast 74 pairings), prettier, tsc app/spec/e2e ok; frontend unit 363 files 4319/4319 (+ form-engine 319/319); bundle 655.47 kB; contracts OK; no OpenAPI/nswag drift |
| 3 | Full backend integration | 15% | done | 12 pieces, 1,640 test cases covering all 1,235 distinct names: all pass; the one timing failure (MyMattersPerformanceTests, 100,000 assets, assets name filter 1,191 ms while I was publishing in parallel) passes alone (12/12) |
| 4 | Full Playwright | 35% | done except 24 branding tests | 2,939 tests: 2,825 passed, 42 failed, 48 skipped, 24 not run (branding project, blocked by the failures; queued as its own run). All 42 classified and re-run: 40 pass after fixes (see section 3), 1 known #980, 1 date-dependent (DST ended today) fixed |
| 5 | Sensitive e2e, axe four sizes, visual review | 10% | done | sensitive e2e 14/14 (rule ON, fresh DB); axe (WCAG A/AA, 2.1/2.2 AA, best-practice) over 54 admin routes plus 24 routes for each of PM, technician, director and restricted user at four sizes (about 650 combinations) and 80 dialog/menu/dropdown states: 0 violations except heading-order on the Task Type form designer (pre-existing, filed); 200% and 400% zoom: no sideways scroll |
| 6 | Exploratory hunt | 18% | running | demo data stack (seed:demo --aged --seed 7, sensitive rule ON); see findings |
| 7 | Fixes and re-runs | 4% | running | 4 QA commits so far |
| 8 | Report, issues, epic | 3% | waiting | - |

Running now: full frontend unit suite on the fixed sources and the branding project (both waiting for a heavy slot held by other agents); exploratory notes. Expected time left: about 2 hours.

Findings so far: (1) real, fixed: Dashboard shifted 8 px on a phone when the Scope appeared (ef90da4); (2) real, fixed: Task Types and Workflows tables scrolled sideways between 1100 and 1366 px and squeezed the Name to 77 px (ffe94d3); (3) real, open: native selects remain in forms, dialogs, Swimlane and Users toolbars (the shared dropdown is not 'everywhere'); (4) real, open: focus ring clipped on full-width fields in the Hold dialog; (5) pre-existing, open: heading order in the form designer; 30 stale specs fixed.
