# UI update: QA report (epic #953)

## PROGRESS (updated 2026-10-31 22:15 UTC)

Weights unchanged. Overall: **about 80%**.

| # | Stage | Weight | Status | Progress inside the stage | Pass / fail so far | Now running, expected remaining |
| - | ----- | ------ | ------ | ------------------------- | ------------------ | ------------------------------- |
| 1 | Setup, build, fresh stack | 5% | done | | all ok | - |
| 2 | Unit/arch/schema, lint, prettier, tsc, frontend unit, bundle, contracts, OpenAPI/nswag | 10% | running (90%) | only the Release build and OpenAPI/nswag drift check are left (queued) | unit 2455, arch 47, schema 102, frontend 4312, all pass; bundle 652.96 kB | queued, 15 min |
| 3 | FULL backend integration | 20% | running (about 70%) | run 2 was killed by the kernel (out of memory, test host 5 GB) after 1,046 tests passed, 0 failed (863 distinct names); the remaining 372 test names (the Dashboard, My Work, Task Queue, performance and Sensitive classes) are queued as run 3 with 2 stacks stopped to free memory. Logs `/tmp/qa-it2.*`, `/tmp/qa-it3.*` | 0 failed in 2 partial runs | about 1 to 1.5 h once the slot is free |
| 4 | FULL Playwright | 30% | done except the last re-run | 2,860 tests ran in two parts (`/tmp/qa-e2e-full.log`, `/tmp/qa-e2e-part2.log`): 16 failed first time; 12 of them passed on re-run (load or shared-output-folder flakes), 4 real or stale and fixed; re-run of `sh-rail-icons`, `sh-nav-version`, `sh-final-contract`, `ty-permissions-matrix` and `matter-client-details-tab` on the last build is queued | see section 3 | build queued |
| 5 | Sensitive e2e + axe four sizes + fit-to-window | 7% | done | sensitive e2e (rule ON, fresh SQL and API): 14 / 14 passed; axe 0 violations at 375, 1366, 1920, 768 on every tab and state; fit-to-window in `mm-ui-update` passed | 0 failures | - |
| 6 | Exploratory bug hunt | 18% | done | includes scale (128 matters for a PM, 225+ for the admin, 1,200 tasks: first rows 1.5 s, tabs 1 to 1.6 s) | see findings | - |
| 7 | Fixes and re-runs | 5% | running (80%) | 19 fix and test commits pushed | 35 / 35 and 55 / 57 targeted re-runs | last build and re-run queued |
| 8 | Report, issues, epic refresh | 5% | running (40%) | issues #976 to #979 filed and linked under #953 | - | after the runs |

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
