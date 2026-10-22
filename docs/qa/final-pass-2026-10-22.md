# Final verification pass, 2026-10-22

Pinned SHA: `1f728cf1a2fa76fc8e0d35bfb714ae3988d86e00` (origin/dev when the pass started). Fixes were pushed on top of it; the last
commit of the pass before this document is `2ddee46`. origin/dev did not move during the pass.

Setup: own git worktree at the pinned SHA with its own `npm ci`, its own SQL Server 2022 container and one API (Dev auth, port 5291) from
a fresh `deploy/publish.sh` (`SKIP_FRONTEND_INSTALL=1`, linux-x64). `E2E_AXE_PATH` pointed at an `axe.min.js` copy, so every axe audit ran.
The Docker daemon and the stack were lost once (container restart) and rebuilt before the second Playwright run.

## Results

| Suite | Command | Result |
|---|---|---|
| Backend format | `dotnet format --verify-no-changes` | clean (before and after the test edits) |
| Backend build | `dotnet build -warnaserror -nodeReuse:false -p:UseSharedCompilation=false` | 0 warnings, 0 errors |
| Unit tests | `dotnet test tests/MatterFlow.UnitTests` | 1614 passed |
| Architecture tests | `dotnet test tests/MatterFlow.ArchitectureTests` | 35 passed |
| Schema tests | `dotnet test tests/MatterFlow.SchemaTests` | 66 passed |
| Integration tests (full, once) | `dotnet test tests/MatterFlow.IntegrationTests` | 1158 passed, 2 failed, both stale tests, fixed (see below); the two re-run green |
| Frontend lint | `npm run lint` | 1 error on dev (unused import), fixed |
| Frontend format | `npm run format:check` | 1 file on dev, fixed |
| Frontend unit | `npm test` | on dev 7 failed of 3561 (6 stale spec, 1 order dependence); after the fixes 3561 passed + form-engine 319 passed |
| Production build | `npm run build` | initial total 607.92 kB (limit 700 kB), before and after the fixes. One style budget warning (not an error): `roles-page.scss` 5.80 kB over a 5.00 kB budget, it predates the pass |
| Contracts | `node contracts/validate-contracts.mjs` | OK (171 vectors) |
| OpenAPI / client drift | Release build then `npm run api:generate`, `git status` | no diff |
| Playwright, run 1 (fresh DB, pinned SHA, `--workers=1`) | 2569 tests | 2471 passed, 53 failed, 34 skipped, 11 did not run (3.2 h) |
| Playwright, re-run of the 29 failing files (used DB, with fixes) | | 401 passed, 22 failed, 7 skipped |
| Playwright, run 2 (full, fresh DB, with all fixes) | 2569 tests | 2542 passed, 13 failed, 34 skipped (2.8 h) |
| Playwright, re-run of the 9 non-issue failures of run 2 | | 145 passed, 0 failed |
| New specs | `pw8-final`, `users-us8-final` | 10 + 10 passed (also inside run 2) |

The 34 skipped tests are the screenshot-gated specs (they skip without `E2E_SCREENSHOTS`, `WP10A_SHOTS`, `WP10B_SHOTS`) and 11 serial tests
that did not run after a failure in run 1. The three screenshot specs that were stale (`task-types-tabs-screens`,
`column-filters-admin-screens`, `workflow-tabs-tags-screens`) were run with `E2E_SCREENSHOTS` set and pass now.

Run 2 open failures (13): four are the three open issues below (`dashboard-summary-lists` 375, `wp15-rows`, `wp2-list-states`, `wp9-density`);
nine passed when re-run alone: `dashboard-skeletons` (users tab at 1366, a 0.019 shift: load), `matter-columns`, `profile-availability`,
`rich-description`, `t8-edit-create`, `ty3-cards`, `ty6-version-editor`, `users-us7-flows` 5, `wp12-phone-cards` (all load flakes of a long
single-worker run; see the table). A used database made further tests fail in an intermediate run (a run was lost with the container): the
fixes for those are in the table.

## Classification of every failure of run 1

Class: B real product bug, S stale or wrong test, F load or order flake, E environment, D shared-database leftovers (a test depends on
what earlier specs left behind).

| Failure | Class | Cause and action |
|---|---|---|
| ~21 tests through `TaskDetailPage.expectStatus` (assignment-and-views 2, t4-menus-dialogs 7, t7, task-create, task-detail-t9 3, task-lifecycle 4, workflow-steps 3) | S | The header now shows the status once, in the Status tile (text "StatusIn Progress"); `\bIn Progress\b` cannot match. Helper asks `li[data-status]`. Fixed |
| `shared/work-queue/row-edit.spec.ts` 6 tests | S | AD-D #519 loads priorities only for people with Task.View or Priority.Manage; the spec's user had neither. Spec gives Task.View. Not a product regression (nobody sees a queue row without Task.View). Fixed |
| unit `task-header.spec` (Activity button missing) | F (order) | The runner shares one window between spec files (`isolate: false`); `filters-testing.ts` never restored `window.matchMedia` when it was undefined (jsdom), so later files saw a non-desktop screen. Fixed at the root; no other flake of the named five (task-comments, client-detail-page, record-header, matters-list-page, global-search) reproduced in 2 unit runs |
| lint error `impactLine`, prettier `step-edit-page.ts` | S | Unused import, unformatted file. Fixed |
| backend `Each_list_needs_the_permission_it_had_before` | S | TY-P (e433b35) deliberately lets TaskType.Manage read `GET /workflows`; test updated, step library still closed |
| backend `The_column_text_filters_stay_fast_at_5000_tasks...` | S | Fixed ceiling of 25 statements; Pod Work reaches 25 by itself. Test now compares with the same page without the filter |
| ad1-refused-delete (2) | D/F | New role far down a long list; smooth scroll closed the row menu. Test waits for the scroll to end |
| clients-final lost connection | S | Banner Retry and list Retry; list now reads itself on reconnect. Spec adapted (Retry while offline fails again, rows return alone) |
| dashboard-breakdowns pie legend | D | Pie keeps at most 8 slices; other specs add priorities. Spec applies the same grouping rule |
| dashboard-breakdowns hover row (375) | D | More legend rows scroll the page on hover; boxes are now measured relative to the card |
| dashboard-skeletons (6, at 375) | **B, fixed** | The Scope control appeared after the first read and pushed the page 36 px down on every tab. `.end` takes its own line from the start below 400 px (`b8a069b`) |
| due-dates SCN-015 | S | Hard-coded Tokyo 3:30 AM; New York leaves daylight saving on 1 Nov (inside the 10 days looked ahead). Expected time computed |
| final-verification, wp9-fixed-layout | D | Specs filed tasks on deactivated priorities left by the Labels specs ("Select an active priority"). Active only |
| fixed-header Audit Logs filters, ux-round-4 UXR4-15 | S | The Audit filter row is open from the start (AD-G); the Filters click closed it |
| my-work-per-tab-columns | F | Read of the headers right after a tab click; passed on re-run |
| sh-offline-banner (list while offline) | D | Looked for the client it created on page 1 of a long list. Any row link |
| ty6-version-editor menus | F | Row menu closed by a scroll of the list; passes alone, flaked in 3 of 3 full runs: candidate for the same scroll-settle wait as ad1 |
| users-capacity, users-tab (1366) | D | A long priority label made the priority select wide and wrapped the toolbar. Spec gives the page the four default priorities (`support/isolate.ts`) |
| users-us2-status | D | `getByLabel('Status')` matched a role called "Status labels only ..." in the Roles filter. `exact: true` |
| users-us4-drawer keyboard order, users-us7-flows (4) | D | Fixed 300/400 Tab limit; a used database has hundreds of roles, one checkbox each. Limit is now the number of controls on the page |
| wp13c pod cards axe `color-contrast` 4.16 on the Overdue strip item | F | Caught mid-transition; passed on re-run |
| dashboard-summary-lists toast at 375 | **B, open** | #754 |
| wp9-density (233 vs 230), wp15-rows (10 vs 11) | **B, open** | #755 |
| wp2-list-states CLS 0.035 at /matters 375 | **B, open** | #756 |
| 3 screenshot specs | S | Ambiguous "Last 7 days", cards instead of tables at 375, "Add step" name starts with an icon glyph, `isVisible` before the page drew. Fixed |
| sh-403-in-place, detail-page-states, ad1-designer-states, My Work axe target-size at 375, fixed-header (other) | n/a | Passed in run 1 and run 2 (ad1-designer-states failed once in an interrupted used-database run) |

## Fixes and commits

- `b96de46` unit suite green: row-edit spec, matchMedia leak in `filters-testing.ts`, lint, format.
- `002fff1` two backend tests.
- `b8a069b` product: Dashboard header line at 375 px (6 skeleton tests).
- `bfe9491` e2e spec fixes in the table above, `support/isolate.ts`.
- `2ddee46` new specs `pw8-final.spec.ts` (adopted from the draft) and `users-us8-final.spec.ts`.
- this commit: the report, screenshots and measurements in `docs/ux/*/fixes/final/`.

## Open issues

- #754 phone toast covers the last row of a page without a pager.
- #755 list chrome 3 px too tall (My Work 233 > 230; Task Queue 10 rows < 11 at 1366x768).
- #756 Matters list CLS 0.035 at 375 (header actions wrap after load).

These three specs stay red on dev until the issues are done; their numbers were not loosened.

## Verification issues

- #460 (Users) and #577 (Pod Work): contract specs at four sizes, state matrices, measurements and screenshots in
  `docs/ux/users-review/fixes/final` and `docs/ux/pod-work-review/fixes/final`, green in run 2. Closed.
- #661, #662, #663 (Admin), #632 (App shell), #419 (Task Types), #601 (Profile), Search #484: left open. Their areas' specs are green
  (the `ad*`, `sh*`, `ty*`, `profile*`, search specs, the Admin/Task Types permission matrix `ty-permissions-matrix`), but they ask for
  documents, before/after tables, screenshot sets and rewritten specs that this pass did not produce.

## Before and after (measurements the new specs record)

Users (review of 2026-10, 1366x768): grid width beyond its box 515 px to 0; rows 51 to 204 px to 44 to 45 px; Tab stops before the first
row 33 to 30; Roles of the panel below the fold to 149 px from the top; Esc closes the panel; no sideways-scroll hint on a phone.
Pod Work: title at 768 px wrapped to 36 px; pod select 560 to 308 px; title top offset 6 to 0 px; By member rows in view 4 to 8; nested scroll
boxes 1 to 0; page width over window at 375 236 to 0 px; first card under the title 330 to 194 px; strip toggles 0 to 4. Initial bundle
607.92 kB (limit 700).

## Not run

Windows/IIS publish (`publish.ps1`), the `e2e` workflow on GitHub, the performance tools in `tools/`, the seed-demo tool, browsers other than
Chromium, and the screenshot-gated specs other than the three listed above (the rest skip without their output folder).
