# Combined verification pass, 2026-10-23

Pinned SHA: `6bab2fce2a5f29c98fd91ce5879e96eaf2603619` (origin/dev when the pass started; it covers everything built since the pass of 2026-10-22, pinned `1f728cf`: the Project Manager role and My Matters, Notifications, Reports administration up to RP5, the Task Types, Admin, Users, Assets and shell work that landed after that pass). Fixes were pushed on top of it (list below); dev moved only by design documents during the pass (`6d87903`, `5b35885`). This pass does not repeat what `final-pass-2026-10-22.md` proved; it re-runs the suites on the new code.

Setup: own git worktree at the pinned SHA with its own `npm ci` (never in the main checkout, no symlink), `deploy/publish.sh` with `SKIP_FRONTEND_INSTALL=1` (linux-x64), `dotnet build -nodeReuse:false -p:UseSharedCompilation=false` followed by `dotnet build-server shutdown`, one SQL Server 2022 container and one API (Dev auth, port 5391, scheduler every minute), the read-only report login provisioned, `E2E_AXE_PATH` pointing at a copy of `axe.min.js` so every axe audit ran, Chromium from `/opt/pw-browsers`. Every heavy command went through `heavy.sh`. A second fresh database (port 5392) was used once to prove the data-dependent failures (class D) and was removed.

## Results

| Suite | Command | Result |
|---|---|---|
| Backend format | `dotnet format --verify-no-changes` | clean |
| Backend build | `dotnet build -warnaserror -nodeReuse:false -p:UseSharedCompilation=false` | **failed on dev**: 3 x CS8604 in `ReportAdminApiTests.cs` (test project, nullable); fixed (`660728a`), then 0 warnings, 0 errors |
| Unit tests | `dotnet test tests/MatterFlow.UnitTests` | 2248 passed |
| Architecture tests | `dotnet test tests/MatterFlow.ArchitectureTests` | 41 passed |
| Schema tests | `dotnet test tests/MatterFlow.SchemaTests` | 85 passed (includes the report-access rule) |
| Integration tests (full, once) | `dotnet test tests/MatterFlow.IntegrationTests` | 1399 passed, 0 failed (50 min 46 s) |
| SQL script numbering 28 to 33 | by listing and the schema tests | 28 matter-managers, 29 notifications, 30 reports, 31 my-matters-activity-seen, 32 report-access-activity-seen, 33 my-matters-indexes: consecutive, no gap or duplicate. Every table the scripts add (Notification, NotificationPreference, the Report tables, UserMatterActivitySeen) has its entry in `db/report-access.json` and the GRANT/DENY in its script; script 31 added its table before its catalogue entry, script 32 fixes that forward |
| Frontend lint | `npm run lint` | clean |
| Frontend format | `npm run format:check` | clean (after my spec edits were formatted) |
| Frontend unit | `npm test` | 3784 passed (299 files) + form-engine 319 passed |
| Production build | `npm run build` | initial total **613.36 kB** (limit 700 kB; 645 kB at the Task Types plan, 607.92 kB on 2026-10-22). One style budget warning, not an error: `roles-page.scss` 5.80 kB over a 5.00 kB budget (predates the pass) |
| Contracts | `node contracts/validate-contracts.mjs` | OK (reference evaluator reproduces every vector) |
| OpenAPI / client drift | Release build, `npm run api:generate`, `git status` | no diff |
| Shortcuts (#420) | `git log` of `shortcut-registry.ts` since 2026-10-19; added `keydown` handlers since then | no commit touches the registry; the only global handler added or moved is Alt+Z (Undo in the toast host, there since 2026-10-15). No new or changed shortcut |
| Playwright run 1 (fresh DB, pinned SHA, `--workers=1`) | 2679 tests in 256 files | 2609 passed, 30 failed, 34 skipped, 6 did not run (3.1 h) |
| Playwright re-runs of the 18 failing files on the used DB (runs 2, 3, 5, 6, 7, 8) | | 8 failures left after the first fixes, all explained below |
| Playwright run 9 (second pass over the Task Types, Admin, Project Manager, Notifications, landing, matter overview and pod cards specs: 726 tests) | | 724 passed, 2 failed (both fixed, see table) |
| Fresh database check of the data-dependent specs | `rp5-reports-admin`, `users-us7-flows`, `rich-description`, `profile-availability` | 50 passed, 1 skipped |
| Screenshot-gated specs | `workflow-tabs-tags-screens`, `task-types-tabs-screens`, `column-filters-admin-screens`, `dashboard-overdue-screens` with `E2E_SCREENSHOTS` | 4 passed |
| Notifications spec after the new test | `notifications-bell` | 11 passed |

The 34 skipped tests are the screenshot-gated specs (they skip without `E2E_SCREENSHOTS` and the other output folders) and the tests that skip themselves without a condition of the stack. The 6 that did not run are serial tests after a failure in the same file.

## Classification of every failure

Class: B real product bug, S stale or wrong test, F load or order flake, D shared-database leftovers (a test depends on what earlier runs left in the database), E environment.

| Failure | Class | Cause and action |
|---|---|---|
| backend build, 3 x CS8604 in `ReportAdminApiTests` | S | Possibly null text passed to `ShouldContain`; `!` added (`660728a`) |
| `users-us-copy-roles` 137 (4 sizes), `users-us6-editors` 238 (4), `users-us7-flows` 279 (4): axe `aria-valid-attr-value` | **B, fixed** | WP-RP5 put tabs in the role editor; the selected Permissions tab pointed at `aria-controls="role-ed-panel"`, an element that existed only for the Reports tab. The Permissions content now sits in `role="tabpanel" id="role-ed-panel"`; unit spec added (`8a92322`) |
| `wp13c-queue-pod-cards` 259 (Pod Work cards at 375) and `final-verification` 497 (matter tasks at 375): axe `color-contrast` 4.16 on the Overdue strip item | **B, fixed** | Not a transition (the 2026-10-22 report called it that): the pointer rests on the item and the hover fill was `var(--mf-surface-2, var(--mf-border))`; `--mf-surface-2` does not exist, so the fill was always the border grey `#c9ced8` and the red text on it is 4.16:1. It uses `--mf-surface-alt` now (also in `pod-picker-list.ts`); e2e test hovers the item at 375 and 1366 and runs axe (`8a92322`) |
| `wp7-matter-overview` 309 and 502 | S | The matter page has two strips with an Open item (the PM health strip); locators scoped to `[data-matter-overview]` (`29840b8`) |
| `sh-offline-banner` 48 | S | The menu has "Matters" and "My Matters"; `exact: true` |
| `task-types-tabs` 11 | S | The Administration menu has 7 items since Reports |
| `profile-availability` 52 | S | After "I'm back" an active person with nothing to report reads a plain "Available" (`data-availability-plain`), or the chip "Off hours", depending on the hour; either is right |
| `users-us8-final` 114 | S | The Tab-stop total included three shell controls added since the review (notification bell, My Matters, Reports): 30 became 33. The page's own stops (inside `main`) are counted apart: 10 (limit 12); the whole-page total is still recorded |
| `users-us7-flows` 221 | S | Fixed limit of 120 Tab presses to reach a role checkbox; the roles list has hundreds of stops on a used database. Uses the page-based budget; the walk helper takes one round trip per press instead of two |
| `users-us7-flows` 114, 173, 196 (runs 3 to 8) | D | 36 to 48 s a flow after 400 roles, over the 60 s limit at 643 roles (one Tab stop per role). `test.slow()` with the reason in the comment; pass in run 1 and on a fresh database |
| `rp5-reports-admin` 345 | S | The cursor is placed after the next render, the test read the focus at once; `expect.poll` |
| `rp5-reports-admin` 449 (timeout), 463 (429 `REPORT_RATE_LIMITED`) | D / E | The Reports list grows with every run and axe over it takes over a minute; the server limits report runs per hour (the e2e stack does not raise that limit), so repeated runs hit it. Both pass in run 1 and on a fresh database. Not changed |
| `rich-description` 357 | F | `scrollLeft` read right after ArrowRight; polled now. Passes on a fresh database |
| `ad3-priorities-list` 150 (drag), 231 (axe `target-size`, partially obscured by the open row menu, run 2 only) | F | The HTML5 drag needs `dragover` events before the drop and a row that is `draggable` (not while the page is busy); the test now waits for `draggable` and drags in steps; green 4 of 4 after. 231 passed in runs 1, 3 and 9: not reproduced |
| `ad1-designer-states` 130 (run 9) | S / D | The Matter custom-fields form is a singleton shared by all specs; the bar may offer Create new draft, Open draft or Publish depending on what earlier runs left. The test accepts any of them |
| `pm5-access` 172 (run 9) | D | Twelve axe runs over the all-matters page: 43 s on a fresh database, 66 s after three runs; `test.slow()` |
| `ad5-link-roles` 62 (row of the new role not on the page), `as757-assignee-suggestions` 88 (empty suggestions), `dashboard-skeletons` 159 (CLS 0.0204 against 0.02), `ty3-cards` 117 (keyboard card menu: focus lost, then the menu item re-rendered), `ty6-version-bar` 174 (Retire dialog), `users-us1-bugs` 215 and 257 (focus in the deactivate dialog), `users-us-copy-roles` 137 at 375 (axe `target-size` on a permission checkbox) | F | Each passed when re-run (alone or in its group) and again in run 9 where included; no consistent cause found. Not changed (nothing was loosened to hide them). `dashboard-skeletons` is a real borderline measurement, see issue #809 |
| `sh-403-in-place` variants, asset-record-page, client-detail-page, pods-page focus, `workflow-tabs-tags-screens`, My Work axe target-size at 375, `detail-page-states`, `dashboard-overdue` | n/a | Passed in run 1 (the screenshot specs with `E2E_SCREENSHOTS`); the focus flakes of the earlier pass did not reproduce in one full run and a second pass of the shared specs |
| `dashboard-overdue` / `WorkloadApiTests` real-clock risk | n/a | Read, not changed: the tests use the UTC date while the firm zone is New York (behind UTC), so "tomorrow" is New York today + 1 or + 2 and the rule "due within 2 days" holds either way; no failure at any hour. It would break only if the horizon shrank to one day |

## Fixes and commits

- `ef2e139` #418 docs (ux-spec S14 to S16, decisions section AF, UAT rows, e2e catalogue, review banner).
- `660728a` backend test nullable errors (the build failed on dev).
- `7207aa4` docs for Notifications (S25, UAT, AH close-out, e2e catalogue) and the Administration pages (S17 to S19, section Y, e2e, architecture, banner), #751 and #662.
- `8a92322` product: role editor tab panel, strip hover colour (with their tests).
- `29840b8` stale and racy e2e specs (list above).
- `ea65d64` Notifications e2e for comments and keyboard, shared-form and slow-axe specs, traceability line.
- this commit: this report, the plan status lines.

## Task Types before and after (#419)

From the review of 2026-10-19 and the per-package evidence in `delivery-plan.md` section 4, re-asserted by the specs that passed twice in this pass (`ty3-lists`, `ty3-cards`, `ty9-keyboard`, `ty9-audit`, `ty8-designer-*`, `ty6-*`):

| Measurement | Review | Now |
|---|---|---|
| Rows of the three lists | Actions off screen at 1366 (BUG-2) | 44 px rows asserted by `ty3-lists` and `ty3-cards`, one overflow menu always visible |
| Tab stops for 25 rows | 75, 75 and 55 | 50 each (two per row), recorded by `ty9-audit` |
| Designer at 375 px, first field | y = 810 | y = 430, palette not in the page (`ty8-designer-phone`) |
| Designer and version page | scrolled as one page | fixed-height panes, no page-level scroll with 45 long-labelled fields (`ty8-designer-panes`, `ty6-version-editor`) |
| Version page step row | the row carried every control | 44 px, 2 Tab stops (badge, overflow) |
| Initial bundle | about 645 kB | 613.36 kB |
| Page-level sideways scroll at 375, 768, 1366, 1920 | | none, asserted by the specs above |

## Application shell header contract (#632), measured on the running stack at 1366x768 and 375x812

Title size and weight at 1366: 22 px / 700 on every one of 25 pages (Dashboard, My Work, Task Queue, Pod Work, Clients, Matters, Projects, Assets, the Client, Matter, Project, Asset and Task records, Create task, Users, Labels, Custom Fields, Audit Logs, Task Types, Workflows, Steps, Asset Types, Search, My profile, My Matters). The review had 20 px (Dashboard) and 28 px (Search, My profile). At 375: 18 px on all 25; the review had 28 px on the list pages. The title sits 12 px under the application bar on the list and workspace pages (69 px from the window top), 40 px on the 8 Administration pages measured and 32 to 47 px on the records and Create task, each with the "Administration >" or record breadcrumb where the contract says so (the review: 12 to 24 px at random). Page-level sideways scroll: 0 px on all 25 pages at both sizes.

## Issues opened and closed

Opened: #809 (Dashboard Users tab silhouette shifts the body 20 px when the data arrives: layout shift 0.0204 against the 0.02 limit, intermittent).

Closed after this pass, each with an evidence comment: #418, #419, #632, #661, #662, #663, #706, #750, #751, #752; epics #352 and #667 (all children closed). Left open: epic #753 (#737, the @mention in a comment, is deferred by the owner); #601 (Profile), #517 (Assets), #484 (Search): their specs are green, but they ask for the review's own seeded data, a before/after table and a `fixes/final` screenshot set that were not produced; the comment on each says exactly that. Pod Work (#577) was closed on 2026-10-22.

## What was NOT run

The data of the reviews (the 74 task types, 1,205 assets and so on): the suites use their own records. New `fixes/final` screenshot sets (the per-package sets stay valid). Windows/IIS publish (`publish.ps1`), the IIS keep-alive of the scheduler on a real IIS, the `e2e` workflow on GitHub, the performance tools in `tools/`, the seed-demo tool, browsers other than Chromium, real screen readers, forced colours, the screenshot-gated specs other than the four named. A second full Playwright run (the Task Types, Admin, Project Manager and Notifications specs were run twice; the other areas once). The Reports epic (#671) verification (#728) and the Sensitive matter and Project Manager experience epics, which have no code yet.

## Effort

About 7.5 hours of wall clock for one agent, of which roughly 5.5 hours were waiting for the machine (integration tests 51 min, Playwright run 1 3.1 h, run 9 1.3 h, builds); about 2 hours of reading, fixing, writing and issue work.
