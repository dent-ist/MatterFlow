# UI update: QA report (epic #953)

## PROGRESS (updated 2026-10-31 20:05 UTC)

Weights as given by the coordinator, unchanged. Overall: **about 52%**.

| # | Stage | Weight | Status | Progress inside the stage | Pass / fail so far | Now running, expected remaining |
| - | ----- | ------ | ------ | ------------------------- | ------------------ | ------------------------------- |
| 1 | Setup, build, fresh stack | 5% | done | worktree, npm ci, build -warnaserror, 2 SQL stacks | all ok | - |
| 2 | Unit/arch/schema, lint, prettier, tsc, frontend unit, bundle, contracts, OpenAPI/nswag | 10% | running (85%) | all done except the final frontend unit re-run and the OpenAPI/nswag drift check (queued) | unit 2455/2455, arch 47/47, schema 102/102, frontend 4309/4311 (2 stale nav specs fixed, 14/14), lint, prettier, tsc, contracts ok; bundle 652.96 kB | queued behind the long runs, about 20 min once a slot is free |
| 3 | FULL backend integration | 20% | running (about 25%) | first run was killed by my own 2 h timeout at about 1,480 of 1,642 tests with 0 failures seen (no result file); full re-run started 19:47 with a 4 h limit | 0 failed so far in the first run | `/tmp/qa-it2.log`, `/tmp/qa-it2.trx`; about 2.5 h |
| 4 | FULL Playwright (chromium, 1 worker) | 30% | running | 1,924 / 2,930 tests (log `/tmp/qa-e2e-full.log`) | 10 failures so far, all classified below; branding project and the re-runs follow | about 1.5 h |
| 5 | Sensitive e2e + axe four sizes + fit-to-window | 7% | running (30%) | axe (wcag2a/aa/21aa/22aa) on all tabs and states: 0 violations at 375 and 1366 after fixes, 1920 and 768 re-run on the last build; fit-to-window covered by `mm-ui-update`; sensitive e2e (rule ON) not started | 0 violations | sensitive run needs a free slot, about 20 min |
| 6 | Exploratory bug hunt | 18% | running (75%) | tree, dropdowns, filters, sorts, paging, Metrics, Calendar and events (roles, conflict), Assets, Activity, states, XSS, phone and 200% zoom, nav for 5 personas, other pages | see findings | remaining: scale (100+ matters), a few role cases |
| 7 | Fixes and re-runs | 5% | running (50%) | 14 fix commits pushed; re-runs of the failed specs on the fixed build are in the queue | 35/35 of the first targeted re-run passed | needs the fixed build (queued) |
| 8 | Report, issues, epic refresh | 5% | not started (10%) | this file started | - | after the runs |

### Findings so far

- Real bugs fixed (commit subjects "WPx QA ..."): Assignee filter listed nobody (limit 200 vs 50 gave 400); Priority filter empty on a direct load; Metrics Overdue column counted On Hold (27 vs 22) so numbers opened a different total; asset side panel 404 for an admin on All matters; tree failure said "No clients or matters" with no Retry; focus lost after the calendar item dialog and asset panel closed; Escape did not close the asset panel; On Hold shown as overdue in the Due cell; phone card ran task number and title together; dropdown scroll list not focusable at phone size (axe) and empty listbox; Asset Types list chip stacked above the name (rows 55 px); Asset type form Icon/Colour layout; My Matters title icon differed from the menu icon.
- Stale specs fixed: `app.spec.ts` (2 nav tests), `page-header-icons`.
- Load flake: `mm-ui-update` calendar edit test (passed alone).
- To classify (failures 2, 5 to 10 below): `matter-client-details-tab` (page scrolls 137 px at 1366x600 for an admin; dev baseline build queued), `sh-final-contract`, `sh-nav-version`, `sh-rail-icons` x2, `ty-permissions-matrix`, `ty2-states`.
- Deferred as issues (to be filed): see section 4 at the end of the run.

Branch `ui-update` (from dev at 0a88090). QA run 2026-10-31 by the QA agent on a clone of `origin/ui-update` (commits "WPx QA ..."). This file is written as the run goes; the verdict is at the end.

## 1. Verdict

(written at the end of the run)

## 2. What ran

| Area | What | Result |
| --- | --- | --- |
| Backend build | `dotnet build -warnaserror --no-incremental` (whole solution) | 0 warnings, 0 errors |
| Backend format | `dotnet format --verify-no-changes` | clean |
| Backend unit | `MatterFlow.UnitTests` | 2455 passed, 0 failed |
| Architecture | `MatterFlow.ArchitectureTests` | 47 passed |
| Schema | `MatterFlow.SchemaTests` (replays all scripts, 1 to 50) | 102 passed |
| Frontend lint | eslint, theme colour check (37 legacy files within their ledger), theme contrast check (66 pairings) | clean |
| Frontend format | prettier on `src`, `projects`, `e2e` | clean |
| Frontend types | `tsc` for app, spec and e2e | clean |
| Frontend unit | whole `frontend` project | 4309 passed, 2 failed at first (stale `app.spec.ts` nav order, fixed), then all pass |
| Bundle | production build | initial total 652.96 kB (limit 700 kB). Two style budget warnings (`roles-page.scss` 6.03 kB, `app-shell.scss` 5.17 kB, limit 5 kB): both exist on dev (`roles-page.scss` is not touched by this branch; `app-shell.scss` grew by 79 bytes), not new |

(integration, contracts, Playwright, axe and performance rows are added below as they finish)

## 3. Failures and their classification

| # | Where | Classification | Fix |
| --- | --- | --- | --- |
| 1 | `app.spec.ts` "shows a technician only permitted nav items and no Administration" and "hides nav items the user has no View permission for" | stale spec (they still expected Task Queue and Pod Work before Clients; the new order is Clients, Matters group, Pod Work, Task Queue) | spec updated, 14 of 14 pass, commit 238667f |
| 2 | Playwright `ad4-asset-types-list` "rows are 44 px ..." (row 54.5 px) | real bug (the new type chip was stacked above the name) | a1759ae |

## 4. Bugs found in the exploratory pass

(listed with commits below)

## 5. Performance

(added when the performance test has run)

## 6. Not run / residual risks

(added at the end)
