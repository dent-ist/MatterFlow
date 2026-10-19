# Final verification pass of the Clients, Matters and Projects epic (#245, WP15, #287) and the Task Detail epic (#288, T10b, #331), 2026-10-20

Start `80eda93` (T10 docs, all feature agents idle); the tree verified is that commit plus this pass's commit (two small product fixes, the test fixes below, one performance bound in a test). Dev auth only, Chromium only, axe-core 4.10.2. One pass for both epics. Own stack on port 5297 (SQL container started by `run-local.sh`); nothing of another agent's run was touched. The four exited `mf-e2e-sql-*` containers of earlier agents were removed after `docker ps` and `ps` showed no running API or test process.

Machine: 4 cores, 16 GB. At the start the load average was 1.8 (15-minute average still 9.3 from earlier agents) and fell below 1 within minutes; all feature agents stayed idle. Backend unit, architecture, schema, the OpenAPI check, lint, `ng build` and the frontend unit tests ran at load 1 to 3.5. The timing-sensitive backend tests ran first, alone, at load 1 to 3. The full integration run (31 min) overlapped with spec writing and one single-worker Playwright stack (load 4 to 6). Playwright runs used two workers (load 5 to 8; peaks of 13 during repeat runs with four workers).

## Suites

| Suite | Result |
|---|---|
| `dotnet build -warnaserror`, `dotnet format --verify-no-changes` | clean, 0 warnings (format re-checked after the last test edit) |
| OpenAPI drift: the build regenerates `contracts/openapi/v1.json`, `npm run api:generate` the TS client | `git status` clean after both |
| Backend unit / architecture / schema | 1613 / 35 / 66 passed |
| Backend integration (full, 30 min 51 s) | 1055 passed, 0 failed |
| Timing-sensitive backend tests on the idle machine: `Hostile_nested_html_upload_is_answered_quickly` (2 s), `DashboardTrendLargePerformanceTests`, `BoardPerformanceTests`, `CoveragePerformanceTests`, `DashboardPerformanceTests`, `TaskQueuePerformanceTests`, `PerformanceRound1Tests`, `CountsPerformanceTests`, `CountsLargePerformanceTests` | 46 of 46 passed (and again inside the full run); one bound changed, the large counts bound 500 ms to 250 ms (below) |
| eslint (src, projects), prettier (src, projects, e2e), tsc (app, spec, e2e) | clean after the last edits |
| Frontend unit (app / form-engine) | 2803 / 307 passed (one full run at load 4 to 6 had one failure in `client-detail-page`; the file passed 6 of 6 alone: LOAD FLAKE, below) |
| `ng build` | initial total **644.85 kB** (173.06 kB transfer) of 700 kB, no warnings; `task-table.scss` 6807 bytes (unchanged; no rule added for either epic) |
| Playwright, first run (fresh DB, tree before the two product fixes) | 1435 tests: 1407 passed, 25 skipped, 3 failed (57 min); all classified and fixed |
| Playwright A (fresh DB, product fixes in) | 1408 passed, 25 skipped, 3 failed (54 min); three different tests, all test bugs, fixed |
| Playwright B (same stack, used DB, about 4,000 tasks) | 1407 passed, 25 skipped, 4 failed (1.0 h); all test bugs, fixed |
| Playwright C (fresh DB, every fix of A and B in) | 1410 passed, 25 skipped, 1 failed (1.0 h); a test bug (`wp24-toolbar-keys`), fixed, 25 of 25 afterwards |
| Screenshot-gated specs (`E2E_SCREENSHOTS`: the 25 skipped tests and their files) | 24 files, 96 tests: 95 passed, 1 skipped, 0 failed (9 min) |

The suite is now 135 spec files and 1436 tests (1389 at the start: `clients-final` 31, `task-detail-final` 15, one regression test in `wp13b`). Not achieved: a single run with zero failures. Every run found one to four timing-sensitive tests; each was reproduced alone (3 to 70 percent failure on the idle machine), fixed and repeated 12 to 30 times green. The last full run's only failure is fixed and its fix verified 25 of 25; no full run was repeated after it.

## Idle-machine medians for the counts performance bound

`CountsLargePerformanceTests` (200 clients, 2,000 matters, 4,000 projects, 50,000 tasks) had a 500 ms bound set under load without idle numbers. Three idle runs (load 1 to 3, medians of 7 requests, 2 to 3 SQL statements each): lists 30 to 56 ms (slowest: Projects sorted by a count), summaries 4 to 29 ms; under load (average 14 to 24) 117 ms. Bound now **250 ms** (4.5 times the idle maximum, twice the loaded one; a per-row query or missing index at 50,000 tasks still fails it). `CountsPerformanceTests` (5,000 tasks, 100 ms) measured 10 to 19 ms idle, 26 to 49 ms next to the large test; left as is. No other budget changed.

## Real bugs found and fixed

1. **Two quick presses lost a width step in the Columns panel** (`column-widths-panel.ts`). Widen/Narrow and the arrow keys stepped from the width of the last render; a second Enter before the next render recomputed from the old number (three presses gave 152 px, not 160). `wp22-columns-widths` keyboard test: 4 failures in 15 idle runs. The step now reads the current width. Regression: unit test "three quick presses before the next render still step three times" (fails without the fix); e2e 20 of 20.
2. **A long assignee account name pushed the task number out of the phone card and the page sideways** (`task-card-list.scss`, My Work "Created by me" at 320 px; the `wp13b` 320 px flake of the previous pass, whose random user name was sometimes long). The assignee menu is a flex item whose automatic minimum width is the whole nowrap name, so its ellipsis never applied: `.tc .tc-who > mf-row-edit { min-width: 0 }`. Regression: new e2e "a long assignee account name is cut with an ellipsis: it never covers the task number or widens the card at 320 and 375 px" (deterministic failure without the fix); `wp13b` and `wp13c` green 3 times.

## Test bugs fixed

- `assets` SCN-016 picker (failed in every run): expected an empty `listbox`; since the T1 accessibility fix an empty list is a plain list with a note.
- `users-tab` drawer "changing a task": clicked a menu before the drawer's focus move to Close, which closes it (6 of 6 on the used DB); waits for the focused Close button, 12 of 12.
- `rich-description-screens`: the "Task created" toast covered the Details disclosure on a phone (closed first; the disclosure applies below 1100 px). `column-filters-records-screens`: expected table rows at 375 px, cards since WP12. Both pass with `E2E_SCREENSHOTS`.
- `my-work-links-copy` BUG-10: `allTextContents()` of the Status popover does not wait (9 of 12 failed); 15 of 15 after.
- `wp3-record-header`: the "short" project name (random, 25 characters) wrapped at 375 px so the loaded header was a line taller than the skeleton (1 in 100); names shortened. Two reads of the overflow menu before it was drawn now wait.
- `clients-keyboard` column filter popover: `.first()` was another button at the moment of the key press (the row draws its controls one after another; 7 of 20 failed, 30 of 30 now).
- `support/views.ts` `viewAvailable`: counted items and pressed Escape right after the click (an early Escape is lost; `task-queue-copy` #226, 1 in 100); waits and repeats.
- `wp24-toolbar-keys` "the ? help lists": focused a row before the help dialog had closed and given the focus back (17 of 25 on a big queue); waits for the dialog to be hidden, 25 of 25.
- axe on a moving page (`wp7-inline-row-actions` A10, `profile-availability`, `wp9-fixed-layout` Pod Work): contrast 3.4 to 4.3 read on a toast or badge half faded, or a grid dimmed while reloading. `support/axe.ts` waits (3 s at most) for finite animations and `aria-busy` tables to settle; Pod Work 30 of 30.
- `wp21-fit-menu`: a random 27-character account name exceeded the 240 px Assignee limit by design; shorter label.

## Load flakes and the unit suspects

- `client-detail-page` "shows Couldn't load ... recovers on Retry" (one failure at load 4 to 6, 6 of 6 alone): the focus callback of `record-state.ts` (`afterNextRender`) can run after an application tick that does not include the unattached TestBed fixture, so it finds the old error heading. In the app every page is part of the tick; no product change. `matters-list-page`, `record-header`, `dash-users-tab`, `global-search`: passed in three runs at load 5 and the full runs; no matchMedia leak (each spec file has its own environment and `record-header.spec.ts` restores `matchMedia` in `afterEach`). No isolation bug found; they stay timing sensitive above a load of about 12.
- `fixed-header` at 375 passed in all runs; the `wp13b` 320 px flake was real bug 2.
- `wp3` skeleton, `task-queue-copy` #226, `wp7` A10: one failure in about 60 to 100 runs each (test bugs above).

## #287 acceptance (Clients epic, #245)

- **Contract** (`clients-final`, 31 tests): Clients, Matters and Projects lists and Client (Overview, Matters), Matter (Overview, Tasks, Projects, Assets) and Project (Tasks, Details) at 1366x768, 1920x1080, 768x1024 and 375x812: axe 0, no page-level horizontal scroll, 44 px rows (cards below 640 px), header limits of 150/150/130-character records (tabs at y 154 client, 175 matter, 174 project at 768 to 1920; 196, 220, 188 at 375; limits 200 and 260), no Status clipped in a table without the scroll hint.
- **Counts equality**: 18 API combinations (client, matter, project; with and without overdue; `Pacific/Kiritimati`, `America/New_York`, `Etc/GMT+12`) plus a record without work and a person without `Task.View` (null, not 403): record, summary, list row and Task Queue totals behind the Open, Overdue, ASAP and On hold links agree; for client and matter the Dashboard tiles of the pod holding the work agree (including Due soon). Browser check for three people (System Admin, all View permissions, no `Task.View`): list columns, Client and Matter Overview strips, Tasks strips, project `Tasks (n)` and every followed link equal the Task Queue pager totals; without `Task.View` no columns, strip or link. Overdue equals the seeded count, or one more in the zone where a date-only date has already passed; within a zone all sources are equal.
- **State matrix**: loading, 500, 403, empty, filtered-empty (lists, `wp2-list-states`); loading, 404, 403, failure, lost connection (records, `detail-page-states`); reduced motion; 200 percent zoom at 1366 (683 px window, six screens, axe 0); a lost connection on a list with Retry.
- **Shared-file regression**: the whole suite (Task Queue, My Work, Pod Work, Task page specs).
- **Tab stops** before the first row at 1366x768 (skip link not used): Clients 33, Matters 36, Projects 33 (Task Queue epic: 36, 39, 38).
- **Screenshots**: `docs/ux/clients-review/fixes/final/` (47 files and a README).
- **Bundle**: 644.85 kB (start 641.07 kB, allowed start plus 5 kB); no style budget touched.

## #331 acceptance (Task Detail epic, #288)

- **Contract** (`task-detail-final`, 15 tests): the six shapes (long and sensitive, overdue, unassigned, On Hold, Completed, Cancelled) at 375, 768, 1024, 1366 and 1920: axe 0 (target-size included), also with the overflow menu open and, for the long task, the Activity drawer; no sideways scroll; one `h1`, title two lines at most, one-line crumb; one Edit control; one primary action (none on a task on hold, Resume is in the overflow); no nested scroller (the Details panel of a long task excepted).
- **Workflow heading y** (review in brackets): typical 269 at 1366 and 1920 (235), 324 at 768 (1519), 377 at 375 (609); long 294 at 1366 and 1920 (519), 349 at 768 (2335), 425 at 375 (1230). The typical task at 1366 is 34 px lower than in the review (facts strip and section nav were added above); the target of 300 is met.
- **Other review measures**: status note of a Cancelled task 38 px at 1366, 58 px at 375 (about 190 px of banners); Edit dialog 690 px with Save at y 708 to 712 in a 768 px window (2489 px, Save at 2544); with 48 comments the first Activity row is already the status change (before: 40 to 50 rows down).
- **Permission matrix**: `task-permissions-t10` (18 variants) green in every run; `task-detail-final` repeats System Admin, the assignee, `Task.View` only (no Asset.View, Matter.View, Client.View) and no `Task.View`: no failed request, toast or page error, no asset request without `Asset.View`, axe 0 with the overflow open, the 403 page offers "Go to Clients".
- **State matrix**: loading skeleton, 404, 403, 500 with Retry, lost connection in Activity, reduced motion; axe 0 at four sizes.
- **Screenshots**: `docs/ux/task-detail-review/fixes/final/` (103 files and a README with the before/after table). **Bundle and styles**: kept.

## Epic #288 stays open: #347 (Assets and Comments as tabs)

The owner approved turning the stacked Assets and Comments sections and the section nav into tabs (Workflow, Assets, Comments), tracked as #347 and built after this pass. This pass verified the layout as shipped. In `task-detail-final.spec.ts` these assertions assume it and need an update for #347: `openFresh` waits for `[data-section-link="workflow"]` (the section nav); `workflowTop` reads `[data-workflow-tab] [data-section-heading]`; the before/after test's Workflow y limits (269/324/377 and 294/349/425 are measured with the stacked order and the nav row above the Workflow); the Edit-control and nested-scroller checks run on the stacked page. The older Task-page specs that name the nav, scroll-to-section and the Assets/Comments order (`task-detail-t5`, `task-detail-t7` parts, `task-detail-layout`, `task-detail-collapse`) will also change. The Clients contract does not touch the Task page.

## Remaining

- Epic #288 open for #347. Epic #75 (column filters) stays open on purpose (not touched).
- Not measured: real assistive technology, dark theme (out of scope).
- No full Playwright run was repeated after the last fix (`wp24`); each fix was repeated alone 12 to 30 times.
- The Matter Tasks filter row draws its controls one after another after Filters is pressed; harmless, but it made a test flaky.
