# QA stabilization pass during the My Work epic, 2026-10-18

Base `b349c53` for the first runs, rebased to `e8f7476` and `7e9da0f` for later runs. Fixes pushed as `ffa2308`, `0c0765f`, `4b8cc97`, `85bbce5`.

**Environment caveat:** the machine was NOT idle. Load average was 11 to 41 on 4 cores the whole time (sibling agents running e2e stacks, integration suites and builds). Every timing and 60 s timeout result is load-affected; no run on an idle machine was possible.

## Suites

| Suite | Result |
|---|---|
| tsc (app, spec, e2e), eslint, prettier | clean (also after the fixes) |
| `ng build` | OK, initial 634.75 kB, no warnings |
| Frontend unit | 2273 + 307 at `b349c53`; 2357 + 307 after the fixes and rebase |
| Backend build -warnaserror, OpenAPI drift, `dotnet format` | clean |
| Backend unit | 1603/1604: `Hostile_nested_html_eml_of_a_megabyte_is_still_fast` (3.76 s vs 3 s), passes alone: load flake |
| Backend architecture / schema | 35 / 66 passed |
| Backend integration (full, 1 h 15 min under load) | 954 passed, 61 failed of 1015 (see below) |
| Playwright 1: fresh DB, axe on | 704 passed, 24 skipped, 3 failed of 731 |
| Playwright 2: same stack, used DB | 699 passed, 24 skipped, 8 failed (77 min vs 51 min) |
| Screenshot-gated specs | 31/31 passed |
| Playwright 3: full suite on the rebased tree at `e8f7476` | 755 passed, 25 skipped, 9 failed of 789 |
| Playwright 4: Task Queue and My Work subset at `7e9da0f` | 246 passed, 1 skipped, 5 failed of 252 |

## Reported failures and results

1. `my-work-group-by-due` (3): not reproducible (passed in runs 1, 2, 3).
2. My Work Closed-tab specs (`my-work-columns-sorts` C1 and axe, `my-work-per-tab-columns` x4, `my-work-vocabulary` C4): not reproducible; no Closed-tab regression found.
3. `wp1-dialogs-popovers` (2 tests): TEST BUG, fixed. At 375 the sheet covers the sort-info button (the strip pushes the toolbar down); the Complete dialog click raced a sideways scroll that closes an inline menu by design (`scrollIntoViewIfNeeded` added).
4. `wp7` A10 at 375: TEST BUG (same race), fixed.
5. `dashboard-skeletons` Swimlane at 375: REAL BUG, fixed in `ffa2308`. The lane hint wrapped when real age text arrived, pushing the lane down 15 px on load (CLS 0.085, now 0.000). On a phone the hint now has its own line, and the skeleton's switcher bone is 37 px (measured at 320, 375, 768).
6. `set-out-of-office-dialog` unit spec: TEST BUG, fixed. The cause was a dynamic `import()` of the API client outlasting three timer ticks, not the clock; the spec now waits with `vi.waitFor` and pins the browser Date to the stubbed Clock.
7. Others:
   - `assets-screen` "Cancel returns to list": TEST BUG (data volume), fixed in `0c0765f`.
   - `wp7` M12.3 at 375: TEST BUG (stale after #196), fixed in `85bbce5`.
   - `wp5-toolbar` axe: TEST BUG (60 s timeout), 180 s in `85bbce5`.
   - LOAD FLAKES (passed alone): `dashboard-summary-lists` S6 at 375, `nav-phone` 768, `dashboard-audit` trend, `dashboard-breakdowns` pie, `swimlane-board` toolbar, `dashboard-trends-types` axe, `profile-availability`, `users-tab` (2), `ux-round-4` UXR4-02, `wp16-more-views` (2).
   - `wp5-toolbar` #216 and `wp11-view-counts` (#218 and axe at 1366): REAL BUG at `e8f7476` (quick view counts widened buttons and wrapped row 1), gone at `7e9da0f` after the WP12/WP16 work.

## New check

`frontend/e2e/tests/my-work-consistency.spec.ts` (`4b8cc97`): 3 people x 4 tabs x 4 filters (none, priority, task type, overdue), fresh database per run. Asserts tab count = grid total = row count, counts independent of the requested tab, the grid equals the Task Queue for the same person (total and task ids, incl. the Closed 90-day window and Created by me), and the needs-attention strip equals the Task Queue. Sensitive: moving the due-soon window by one day makes it fail.

## Backend

- 61 of 1015 integration failures under load: 58 in two fixtures (`DashboardPeriodApiTests*` LeapMonthEnd and MonthEdge) whose seeding hit SQL execution timeouts, plus `DashboardPerformanceTests` and `BoardPerformanceTests` once.
- Rerun at load 11: all 90 period, performance and board tests passed; 3 failed (2 `DashboardTrendLargePerformanceTests` and `Hostile_nested_html_upload_is_answered_quickly`). A second rerun at load 10 to 24: both trend tests passed.
- No performance budget was widened.

## Remaining

- `Hostile_nested_html_upload_is_answered_quickly` failed again at 6.4 s while the machine was busy; not classified as a bug, needs an idle machine.
- `DashboardTrendLargePerformanceTests` budgets passed on the second rerun but not on an idle machine.
- No full Playwright run on the latest `dev` after `5a5a986` and `85bbce5`; run 4 was a subset.
- `docs/qa/e2e.md` was not updated for the new spec.
