# End-to-end suite (Playwright)

Ticket #63. Browser tests for baseline scenarios SCN-001..020 plus the lifecycle, access and oversight flows around them, run against a real stack: SQL Server, the real API with Dev authentication, and the production-built Angular app served by the API on one origin (the way production hosts it). The traceability matrix (`docs/qa/traceability.md`) lists these as the `E2E` layer.

Everything the user does is driven through the UI. The API is used only for **setup** (creating clients, workflows, users, tasks) and for the few **negative checks** the UI makes impossible, such as completing a locked step or linking an asset of another matter.

## Run it locally

Prerequisites: Docker, .NET 10 SDK, Node 22, and a Chromium (see below).

```bash
cd frontend
npm ci
npm run e2e                      # builds, starts SQL + API, runs every test, tears everything down
npm run e2e -- -g SCN-015        # any Playwright argument goes through (grep, --headed, --workers=1, a file name...)
```

`npm run e2e` is `frontend/e2e/run-local.sh`. It:

1. runs `deploy/publish.sh artifacts/e2e-publish linux-x64` (Angular production build copied into the API's `wwwroot`);
2. starts a SQL Server 2022 container named `mf-e2e-sql-<pid>` on a random loopback port and creates the empty `MatterFlow` database;
3. starts the published API on `http://127.0.0.1:5190` with `Hosting__ServeSpa=true`, `Auth__Provider=Dev`, `Seed__StarterConfiguration__Enabled=true`, `Bootstrap__SystemAdmins__0=ke\kekim` and waits for `/health/ready`;
4. runs `npx playwright test -c e2e/playwright.config.ts` with `E2E_BASE_URL` pointing at the API;
5. on exit stops only the API process and the container it started. The API log is `artifacts/e2e-api.log`.

| Variable | Effect |
|---|---|
| `E2E_API_PORT` | Port of the app and API (default 5190). Use another port when something else already listens there. |
| `E2E_SKIP_BUILD=1` | Reuse `artifacts/e2e-publish` (skips the npm build and the publish). Saves about a minute when only tests changed. |
| `E2E_SQL_CONTAINER`, `E2E_SQL_PASSWORD` | Set by the script for the tests: the name of its SQL Server container and the `sa` password. Used by `Seeder.legacyTextTask` (one `UPDATE` that turns a task's description back into old-format plain text); those tests skip themselves when the variables are missing (a stack not started by `run-local.sh`). |
| `E2E_KEEP_STACK=1` | Leave the container and API running; the script prints how to stop them. Useful with `npm run e2e:run` while writing tests. |
| `E2E_AXE_PATH` | Path to `axe.min.js`. The axe checks (`support/axe.ts`, most UI specs) skip themselves without it or an installed `axe-core`; in a container without `node_modules/axe-core` copy `axe.min.js` somewhere and point this at the copy. |
| `E2E_SCREENSHOTS` | A folder. Specs that photograph their screens (`*-screens`, and the My Work, Task Queue and Dashboard specs that name their shots) write them there; unset, they take no pictures. The shots of the epics live under `docs/ux/*/fixes/`. |
| `E2E_CHROMIUM_PATH` | Chromium executable. Defaults to `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` when present (the sandbox image), otherwise Playwright's own browser. |
| `E2E_NO_SANDBOX=1` | Adds `--no-sandbox` (set automatically for the preinstalled browser because it runs as root in a container). |
| `E2E_WORKERS` | Parallel workers (default 2 locally, 1 on CI). |
| `E2E_BASE_URL` | Origin of an already running stack (only for `npm run e2e:run`). |

Browser: with a normal machine run `npx playwright install chromium` once and leave `E2E_CHROMIUM_PATH` unset. `@playwright/test` is pinned to 1.56.1, which expects Chromium build 1194; installing the dependency never downloads a browser (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` is safe).

Working against a stack you already run (for example while writing a test):

```bash
E2E_KEEP_STACK=1 npm run e2e -- -g "SCN-001"      # first run starts and keeps the stack, then
E2E_BASE_URL=http://127.0.0.1:5190 npm run e2e:run -- numbering   # later runs reuse it
# (npm run e2e:run does not pick a browser for you: set E2E_CHROMIUM_PATH / E2E_NO_SANDBOX as above, or install Chromium)
npm run e2e:report                                # opens playwright-report/ after a run
npm run e2e:typecheck                             # tsc over frontend/e2e
```

The suite is 109 spec files and 921 tests (`npx playwright test -c e2e/playwright.config.ts --list`). A full run on a loaded machine takes well over half an hour with two workers, plus roughly two minutes for the build and the SQL container; run a spec or a `-g` pattern while you work and the whole suite before a release.

## Demo data is separate

The suite creates its own uniquely named records and does not need the demo data. `npm run seed:demo` (README, "Demo data") is a different tool for people who explore the running app; it uses the same Dev-auth API sequences as `e2e/support/seed.ts` (provision a user with `GET /me`, grant roles and pods, create tasks and drive them through valid status and step transitions) but never runs in the suite. Do not run both against one database if a spec counts all tasks: the Dashboard totals include the demo tasks.

## CI

`.github/workflows/e2e.yml` runs the same script: manual dispatch, nightly at 03:43 UTC, and on pull requests carrying the label **`e2e`** (it re-runs on new commits while the label is on). It installs Chromium with `npx playwright install --with-deps chromium`, runs `npm run e2e` with `CI=true` (one worker, one retry), and always uploads `playwright-report/`, `test-results/` (traces, screenshots and videos of failed tests) and the API log as artifacts for 14 days. Open a trace with `npx playwright show-trace <trace.zip>`.

## Layout

```
frontend/e2e/
  playwright.config.ts   baseURL, time zone, trace/screenshot/video on failure, retries 1 on CI
  global-setup.ts        fails fast when the stack is not ready, warms the API with one throwaway set of records
  tsconfig.json          its own TypeScript project (strict), separate from the Angular app
  run-local.sh           the stack + test runner described above
  support/
    api.ts               Api: JSON client acting as one Dev user (X-Dev-User, X-MatterFlow-Client: web, optional X-Time-Zone)
    seed.ts              Seeder: builders for clients, matters, projects, users, roles, pods, steps, workflows, task types, tasks, assets
    tasks.ts             TaskApi: step actions and status changes through the API (setup and negative checks)
    fixtures.ts          test, expect and the fixtures below
    time.ts              dates in a given IANA zone, the two extreme zones used by the overdue test
    board.ts             seedBoard: 150+ tasks across clients, matters, priorities, statuses and assignees for the Swimlane tests and screenshots
    axe.ts               axe-core runner (wcag2a, wcag2aa, wcag21aa, wcag22aa); reads axe from E2E_AXE_PATH or an installed axe-core, tests skip without it
  pages/                 page objects: create-task, task-detail (+ StepPanel), queues (Task Queue, My Work, Pod Work), organization
  fixtures/email/        sample .eml files (copies of tools/spike-outlook-dnd/samples, kept byte exact)
  tests/*.spec.ts        the tests
```

Fixtures (from `support/fixtures.ts`):

| Fixture | Meaning |
|---|---|
| `page` | A page signed in as the System Admin `ke\kekim` (`X-Dev-User` through `extraHTTPHeaders`). Override with `test.use({ devUser: 'ke\\someone' })`. |
| `asUser(username, { timezoneId? })` | A page in a fresh browser context signed in as another user, optionally in another browser time zone. Closed automatically. |
| `admin` (worker) | `Api` as System Admin. |
| `seed` (worker) | `Seeder` over `admin`. |

## Coverage

| Spec | Scenarios and flows |
|---|---|
| `numbering` (7) | SCN-001 padded numbers, duplicate in UI and API (also the unpadded spelling), digits-only rule; SCN-002 same matter number under two clients; SCN-003 duplicate matter in one client; combined-number lookup |
| `task-create` (9) | SCN-004 task with and without a project; SCN-005 project list limited to the matter and cross-matter rejection by the API; SCN-008 conditional required field (UI and server); SCN-009 workflow choice and `WORKFLOW_NOT_ELIGIBLE`; required-field summary |
| `assignment-and-views` (5 + 1 known defect) | SCN-006 technician takes a Pod task and reassigns it; SCN-007 My Work across Pods and Pod Work per Pod; Task Queue search |
| `workflow-steps` (10 + 1 known defect) | SCN-010 order enforced in UI and API; SCN-011 skip comment (blank, whitespace, server); SCN-012 non-skippable; SCN-013 reopen keeps later steps and the never-resolved-step guard; unordered workflow; bulk-complete dialog, decline, and the blocked case with required inputs |
| `workflow-version` (2) | SCN-014 a task keeps the version it was created on, new tasks get the new version, the old version is retired but readable |
| `due-dates` (4) | SCN-015 ASAP is never overdue (queue, header, API); a past date is overdue; the same date-only due date is overdue in `Pacific/Kiritimati` and not in `Etc/GMT+12` (browser `timezoneId` and `X-Time-Zone`); a due time shown in the viewer zone |
| `assets` (4) | SCN-016 link with relationship, change, unlink; the picker never offers another matter's asset; API `CROSS_MATTER_REFERENCE`; closed task is read only |
| `email-intake` (6) | SCN-017 pasted Outlook block, pasted block to real task, `.eml` upload with attachment ignored, Date header time, all five sample emails through the API, non-email file |
| `rich-description` (10) | Issue #80 / decision R: an Outlook table pasted into the Task description is cleaned, saved and still a table after a reload; a hostile paste is neutralised in the editor, on the server and on the page, and eight classic mXSS payloads sent straight to the API never run; an `.eml` and a pasted email keep their table (header lines of a paste dropped); a description saved as plain text stays text until its description is edited (needs the SQL container of `run-local.sh`); axe, own-box scrolling and keyboard scrolling of the table in the Details panel; insert, fill, extend and save a table with the keyboard alone; the 200-cell limit (`TABLE_TOO_LARGE`); a pasted table in a comment |
| `comments-activity` (5) | SCN-018 rich text comment, edit history, delete, script/handler sanitising, activity feed and its filters |
| `permissions` (7) | Access Pending then role grant, disabled account; SCN-019 no admin menu and the denied page, 13 management calls refused with `PERMISSION_DENIED` and no state change, view-only role, missing `Task.Assign`, read-only task view |
| `search` (5) | SCN-020 header search by unpadded combined number with related tasks and assets, all spellings find the matter first, matter picker resolves `343-12` style input, matters-only role gets no task or asset groups, empty result |
| `task-lifecycle` (8) | Start, On Hold needs a reason (UI and server) and blocks the workflow, Cancel needs a comment and Reopen, closed task edit requires reopen, fixed matter/type/workflow, sensitive matter banner on create, task, matter and queue |
| `swimlane` (20) | Dashboard > Swimlane (issue #72): tab list and per-tab addresses, four lanes with sticky headers, exact counts and own scrolling, card content, Out of office flag, sort, group by priority / assignee / client-matter tree (roles, levels, indentation, counts, collapse, Expand/Collapse all), arrow-key navigation in the tree and between cards, search and filters with count and address sync, Only mine, completed window and remembered choices, drawer peek (focus trap, Esc returns focus), inline status move, priority change with Undo, inline assign, error with Retry, responsive stacking, axe |
| `swimlane-board` | Dashboard > Swimlane WP9a (#122, #123, #124): one-line Compact card (44 px, at least 8 cards per lane at 1366x768, 10 at 1920x1080), remembered Compact, one-row toolbar from 1100 px and the "..." menu button (keyboard, Esc, focus return, settings chips), no client or matter on tree cards and wrapped tree labels, one "client / matter" line, no repeated assignee, lane count links equal the Task Queue totals (no filters, task type, pod scope, Done window, search caveat), axe at 1366, 1920 and 375, no `aria-prohibited-attr` (also not as needs review) |
| `dashboard-scope` (10 + screenshots) | Dashboard > page-wide Scope (issue #89): a pod member opens on My pods and a person in no pod on All pods (membership, not role names), the tiles equal the Task Queue for the same pods (the Overdue tile's link carries both `pod` filters), the options (own pods first, other pods only with `Pod.View`), a shared `?pod=` link on every tab and after a reload, a pod the person may not see (note, default scope, API 403), every tab reads `podScope` and has no Pod control (Summary, Breakdowns, Trends, Swimlane, Users, Coverage), choosing a pod (address, live region, memory, address wins over memory), the no-pod hint and its link, the old `upod` link, the Technician variant, axe at 1366, 1920 and 375 on all five tabs with the target size, row placement and no horizontal scroll |
| `dashboard-summary-deltas` (12 + screenshots) | Dashboard > Summary deltas (issue #102) and the Technician Summary (issue #108). Deltas: the four tiles (Overdue and Open vs yesterday, Created and Completed vs the previous 30 days) read glyph, signed number and words for a pod with a backdated history (needs the SQL container of `run-local.sh`; `Seeder.ageTask`), none on Unassigned, On hold, Due soon and ASAP, the screen-reader sentence is part of the tile's link name, only Overdue going up is coloured, tile minus delta equals the Trends point of yesterday for the same pod (API), a pod younger than the comparison shows no line (no NaN, no +0), This month says "same days last month", axe at 1366, 1920 and 375, the line fits the tile at 375 and 320. Technician: the heading "Unassigned work", no tab row, My pods by default, queue limited to the pod, the own-work line and its My Work link, Priority and Task type filters (address `sprio` and `stype`, list, count and "View all" equal the Task Queue, a reload keeps them), the two empty states with their way out, Assign to me still removes the row and drops the count, a person in no pod, the Director unchanged, axe at 1366, 1920 and 375, filters wrap at 375 and 320 |
| `dashboard-audit` (7) | Dashboard tiles drill through to the queue with the same filter (my overdue, my open, department ASAP and Unassigned), department section needs its permission; audit log browser smoke (filter by object, event type and text, details, read only, who may open it) |

`rich-description-screens` is not a test: it photographs the rich description at 1366x768 and 375x812 for `docs/ux/rich-description` when `E2E_SCREENSHOTS` names the output folder (with `E2E_AXE_PATH` it also runs axe on every shot).

Baseline 6.4 scenario 3 (Access Pending, role grant, dashboard) is covered by the first test of `permissions`.

### Specs added with the UX epics

The counts are tests at the time of writing (`--list`); the names in a row are the `describe`/test titles in short. Unless a row says otherwise a spec runs axe at 1366, 1920, 768 and 375 px (it is skipped without axe), and several age their data with `Seeder.ageTask` or `legacyText`, which needs the SQL container of `run-local.sh` (those tests skip themselves without it).

**My Work and the shared work lists (epic #138)**

| Spec | What it covers |
|---|---|
| `landing` (11) | Default landing: My Work for a person with an open task or a Pod, the Task Queue otherwise, a deep link is untouched (`hasWork` from `/me`, #142) |
| `my-work-page-state` (10) | No stale rows under a new tab, failed tab change, New markers survive drill-in, Reset to default, the restored-view notice names the view, only Active and Due soon are restored, the first non-empty tab (#143 to #145, #170, #183) |
| `my-work-links-copy` (5) | Matter references are links only with `Matter.View`, empty copy names only reachable screens, the near-empty line, tab-owned filter cells, one error message with Retry (#146 to #150, #157, #159, #177) |
| `my-work-vocabulary` (4) | Tab names, Due soon and overdue order, title, caption and live region, info buttons instead of help paragraphs, Show older = `closed=all` (#151, #154, #161, #171, #187, #188) |
| `my-work-columns-sorts` (4) | Sortable Title, Matter, Updated and Age, the Closed column, each tab remembers its columns and Reset columns restores one tab (#152, #156, #172) |
| `my-work-per-tab-columns` (7) | Matter and progress on Active, the Matter migration with its notice, Created by me columns and Open default, Closed columns with a muted priority, screenshots of the three default sets (#173 to #175, #184 to #186, #198) |
| `my-work-strip` (3) | The needs-attention strip: counts over the whole open set, click filters Active and toggles, Pod Work uses the strip (#153, #178) |
| `my-work-new` (3) | New: strip item, filter, Ref dot, visit boundary, first visit hides it (#144, #179) |
| `my-work-group-by-due` (3) | Group by Due on Active: headers with whole counts, continued on page 2, keyboard, remembered, a sort turns it off (#180) |
| `my-work-drill-in` (6) | `from=` keeps the list's nav item, crumb and Back link, Back focuses the row; "Open in Task Queue" totals equal the tab counts (#160, #163) |
| `my-work-consistency` (5) | API only, no browser: for three seeded people every tab under every filter (4 tabs x 4 filters = 16 combinations each) has a count equal to its grid total, the same four counts on every tab and a total equal to the Task Queue's; the needs-attention strip against the queue; a guard that the seeded numbers are not silently empty |
| `wp1-dialogs-popovers` (6) | Confirm dialogs wrap, one popover rule (Esc, outside click, focus back), the `?` list shows `/` once (#139 to #141, #169) |
| `wp7-inline-row-actions` (12) | A row leaves its tab after an inline Cancel or Complete and the counts follow, toasts clear of the pager, the current-step link, Complete reads "needs step inputs" (#148, #158, #166, #167) |
| `wp10-hold-colours` (4) | An On Hold row says why (pause marker, grey pill, reason), the stripe means overdue everywhere (#162, #165, #182) |
| `wp12b-keyboard` (11) | Skip to task list, J / K, S, P, `g` then `m`/`t`/`p`, the "Keyboard shortcuts" switch (#181) |
| `nav-phone` (8) | Below 640 px the rail collapses behind a Menu button (focus trap, Esc) (#164) |
| `wp9-density` (6) | Rows in view at 1366x768 and 1920x1080, no sideways scroll, skeleton rows with final widths, reduced motion (#176, #191) |
| `column-filters`, `-admin`, `-records`, `-work-lists` (8, 11, 12, 13) and the `*-screens` helpers (1 each) | The shared column filter row: chips, live region, keyboard order, per-list filters on the server (Assets, administration lists, record lists, Task Queue / My Work / Pod Work) |

**Task Queue and the shared grid (epic #195)**

| Spec | What it covers |
|---|---|
| `wp2-title-cell` (3) | The Title cell is the icon and the title only; a long title and an unbroken token keep the row height and column width (#196) |
| `wp8-matter-cell` (4) | Matter cell (reference over name, tooltip, link with `Matter.View`), Client one line, Matter in the defaults and the one-time notice (#197, #198) |
| `wp9-fixed-layout` (4) | Fixed layout: widths identical across twelve views and sorts, 44 px rows, skeleton lines up with the header, Pod Work Assignee column (#200) |
| `wp13-narrow-rule` (9) | The narrow-box rule and sticky Ref at 640 to 1023 px, the 1098 px box, drop order, the chevron inside the Priority and Status cells, stored widths applied per page and tab, corrupt or blocked storage (#201 to #203) |
| `wp14-due-cell` (2) | The eight Due states: two lines, one spoken sentence, tooltip with the zone, contrast, 136 px, Compact inline (#209) |
| `wp15-rows` (7) | Every row state is 44 px at 1366 and 1920, rows in view, On Hold row, skeleton height and CLS under 0.02, reduced motion (#210, #212) |
| `wp19-compact` (7) | Compact rows are 36 px in every state, 24 px targets, focus ring and forced colours, rows in view (#211) |
| `wp20-resize` (6) | Drag resize: width changes by the distance, the Title gives way, persisted, clamped, Esc, guide line above 100 rows, touch at 768, no handle in the Tab order (#204) |
| `wp21-fit-menu` (10) | Fit to content (double-click, 200 rows, clamped) and the column header menu (Shift+F10, right click, long press, Hide column, the help entry) (#205, #207) |
| `wp22-columns-widths` (8) | The Columns panel: Column widths section by keyboard, Shift steps, typed numbers clamp, Fit, Reset width, "Reset all widths", the five groups (#206, #230) |
| `wp5-toolbar` (6) | Two-row toolbar: row 1 is one line of at most 40 px in every state, the restored notice in row 2 and where it goes (#216, #217) |
| `wp11-view-counts` (9) | Quick view counts equal the grid total, are not narrowed by filters, keep their place while loading, Recently completed overlay, Overdue and Unassigned order (#218, #219) |
| `wp16-more-views` (18) | Due soon, ASAP and On hold, the Dashboard order, More (popover rule, keyboard through the toolbar's arrow keys), every Dashboard link of a Pod presses its view, the 30-day window, Created by me = My Work, views by person (#220 to #224) |
| `wp24-toolbar-keys` (9) | The Quick views are one Tab stop with arrows, Home and End; the Closed instead of Due suggestion (#231, #236) |
| `wp18-pager` (9) | Page n of m, First and Last, remembered page size, 375 px row, filter placeholders, "Other filters", the sort note (#228, #229, #237) |
| `task-queue-copy` (4) | Chip words, the restored notice, empty copy per view, title, caption and one live message (#225 to #227) |
| `task-queue-due-groups` (4) | Dividers when sorted by Due, ascending and descending, collapse by keyboard, Closed bucket (#232) |
| `tq-assignee-client-sort` (1) | Assignee and Client sort with `aria-sort` and the URL (#233) |
| `wp6-assign-to-me` (12) | "Assign to me" first in the Assignee menu, Pod Work without an Actions column, a read-only viewer sees neither (#199, #234) |
| `wp7-closed-row-menu` (5) | A Completed or Cancelled row offers only Reopen, the API refuses to cancel a Completed task (#235) |
| `wp13b-phone-cards` (19), `wp13c-queue-pod-cards` (16) | Cards below 640 px on My Work, Task Queue and Pod Work: card content, chips as editors, keyboard, group headers, skeleton, 200 percent text, the Filters sheet with Sort by; 639 px is cards and 640 px is the table (#192, #238) |
| `wp25-dash-due` (3) | The Dashboard Summary lists, the Swimlane card and the task header say what the Task Queue row says; no clipping from 375 to 2560 px (#213, #214) |
| `wp26-print` (1) | Print emulation and PDF page counts of the three work lists (#215) |
| `fixed-header` (19) | Pinned title, toolbar and header at 1366x768 while the rows scroll; rows in view; the pager on screen |
| `ux-round-4` (36), `review-round-5` (10) | The older UX review rounds: no page-level sideways scroll, the grids fit or scroll with the hint, tab strips, Users and Swimlane fixes |

**Dashboard**

| Spec | What it covers |
|---|---|
| `dashboard-alignment` (3) | The Unassigned panel is level with the first row of tiles on Summary (also under a pod scope) and the Workload / Coverage switch does not move |
| `dashboard-breakdowns` (15), `dashboard-trends-types` (16), `coverage-by-type` (10) | Breakdown cards add up to Open and link to equal queues; Trends by task type; Coverage by task type (C1, #134) |
| `dashboard-consistency` (9) | API only: every count equals the Task Queue behind its link (Summary, Breakdowns, Swimlane) |
| `dashboard-fixed-height` (59), `dashboard-skeletons` (26), `dashboard-summary-lists` (17) | No page scroll on any tab, skeletons fill the loaded box and shift nothing, the three lists fit their rows |
| `dashboard-period` (13), `dashboard-permissions` (11), `dashboard-shell` (16) | The period list and the scope note, permissions per tab, tabs fail independently |
| `swimlane-phone` (19) | The lane switcher below 900 px (#125) |

**Detail pages, administration and profile**

| Spec | What it covers |
|---|---|
| `detail-layout` (8), `matter-client-details-tab` (9), `task-detail-layout` (16), `task-detail-collapse` (10) | Details as the first tab of Client and Matter, the Activity drawer, the single-page Task detail layout, collapsible Comments and Assets |
| `task-type-icons` (6), `task-types-tabs` (9), `admin-menu` (4), `admin-form-designer-pages` (3), `users-pods` (11), `users-tab` (28), `users-capacity` (11) | Type-first Create Task, the Task Types tabs, the flat Administration menu, the form designer pages, Pods inside Users, the Users workload and capacity views |
| `assets-screen` (8), `page-header-icons` (2), `profile-availability` (12) | Assets filters and details, navigation icons in headers, My profile availability and the out of office header menu |

## Conventions

- **Independent tests.** Each test creates its own data with `seed` (unique client numbers, uniquely named step, workflow, task type, project, asset and user records). No test depends on another or on the starter configuration, so files and tests run in any order and in parallel. The database is shared by the whole run and never cleaned; names carry a short random token to avoid collisions across runs.
- **Shared lists.** The Task Queue and the dashboard contain everyone's tasks. Scope them: `/tasks?matter=<id>` or a `search()` on the unique title, a fresh user for My Work and the "Your work" dashboard tiles. Never assert a global count.
- **Locators.** Roles, labels and visible text first (`getByRole`, `getByLabel`); the `data-*` hooks the app already carries (`data-task-header`, `data-step-id`, `data-status-reason`...) where a role would be ambiguous; page objects hold them so a markup change is fixed in one place. No CSS class chains, no `nth` unless the order is the point.
- **Setup retries.** `Api.call` repeats a setup request once when the API answers `500 INTERNAL_ERROR` (a SQL deadlock victim, `E2E-F3`) and logs it. UI waits are never retried.
- **Waiting.** Web-first assertions only (`await expect(locator).toHaveText(...)`). No `waitForTimeout`, no retries to hide flakiness (`retries` is 1 on CI only, to survive infrastructure hiccups). To wait for an API side effect use `expect.poll`.
- **Numbers.** `seed.freeClientNumber()` picks an unused number; pass `true` for one below 10000 when the padded and unpadded spellings should differ.
- **Time.** The default browser zone is `America/New_York`, the firm zone. Tests about time zones use `asUser(name, { timezoneId })` and, for API checks, `Api.as(user, { timeZone })`. Dates are computed with `support/time.ts`, never hard coded, so the suite works on any day.
- **Step titles** must be unique among active steps, so `seed.step`/`seed.workflow` append a token; use `workflow.stepTitles` rather than the plain names.
- **Known application defects** are recorded in `docs/qa/e2e-findings.md` and mirrored by a `test.fixme` named `E2E-Fn` (skipped until fixed; remove the `fixme` with the fix).

## Adding a test

1. Pick (or add) a spec under `e2e/tests/`. Name the `describe` after the scenario ids it covers and prefix test titles with `SCN-nnn:` when they implement a baseline scenario, so `-g SCN-015` works.
2. Build data with `seed` (`const world = await seed.world({ stepCount: 3 })` gives a client, matter, task type and workflow; `seed.task(world)` a task; `seed.user(['Data Technician'], 'tech')` a signed-in-able user). Add a builder to `support/seed.ts` when a new kind of data is needed.
3. Drive the UI through a page object (`pages/`). Add methods or locators there rather than in the test when more than one test needs them. Create Task is type first: `CreateTaskPage.open()` shows the type chooser, so call `chooseTaskType(name)` (or open `?taskType=<id>`) before touching any form field.
4. Use the API only to set up or to assert what the UI cannot do (a 409 code, a stored value). Assert the UI first, the API second.
5. Run `npm run e2e -- -g "your test" --repeat-each=5` against a kept stack to check for flakiness, then `npm run format:check` (prettier covers `e2e/`) and `npm run e2e:typecheck`.

ESLint is not run on `e2e/` (its angular-eslint rules target the app); Prettier is.
