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
| `E2E_SENSITIVE_ACCESS=1` | Starts the API with the go-live switch of the sensitive-matter rule on (`Features__SensitiveMatterAccess=true`, epic #788). It is turned on by itself when a Playwright argument names a `sensitive-*.spec.ts` file (`npm run e2e -- sensitive-`); off otherwise, as in `appsettings.json`, and the sensitive specs then skip themselves. |
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

The suite is 256 spec files and 2679 tests (at `6bab2fc`) (`npx playwright test -c e2e/playwright.config.ts --list`; a test that loops over the four screen sizes or the roles counts once per iteration). A full run on a loaded machine takes well over half an hour with two workers, plus roughly two minutes for the build and the SQL container; run a spec or a `-g` pattern while you work and the whole suite before a release.

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
    personas.ts          Personas: users with a given permission set, signInAs, failApi / failMe / delayApi / goOffline, SHELL_ROUTES
    screens.ts           the four sizes, screenshots, no sideways scroll, axe at every size
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
| `personas` (worker) | `Personas` over `seed`: people with a known set of permissions (below). |

### Personas and failure helpers (`support/personas.ts`, `support/screens.ts`)

Any spec that needs "a person who has exactly these permissions" uses `personas`, not a private `seed.role` plus `seed.user` pair. Dev authentication names the user by `X-Dev-User`, so signing in is `asUser(persona.username)`.

```ts
test('...', async ({ personas, asUser }) => {
  const viewer = await personas.create({ permissions: ['Client.View'] });   // a custom role with exactly these codes
  const director = await personas.named('director');                       // a catalogue entry (below)
  const tech = await personas.named('technician', { label: 'mine' });      // catalogue entry with an override
  const page = await asUser(viewer.username);
});
```

| Piece | Use |
|---|---|
| `personas.create(spec)` | `spec`: `roles` (built-in role names), `permissions` (one new custom role with exactly these codes), neither (Access Pending), `displayName` or `displayNameLength`, `disabled`, `label` (part of the account name `ke\e2e-<label>-<id>`, unique per call, nothing to clean up). Returns `{ username, userId, roleNames, permissions, displayName }`. |
| `personas.named(key, overrides?)` | `PERSONAS`: `director`, `readOnlyObserver`, `complianceAuditor`, `technician`, `podLead`, `intakeCoordinator`, `configurationAdmin`, `clientViewOnly`, `taskViewOnly`, `userManageOnly`, `podViewWithoutTaskView`, `pending`, `disabled`, `longName` (66 characters). Add a person to `PERSONAS` (one line and a comment) rather than writing a helper in a spec. |
| `PERMISSION_VARIANTS` | A ready matrix of eight kinds of person for "who may see this" tests. Loop over it, or over your own `PersonaSpec[]`. |
| `signInAs(browser, username, { width, height, timezoneId })` | The same as the `asUser` fixture for code outside a test (the caller closes the context). |
| `failApi(page, url, status, { times, method })`, `failMe(page, status)` | Answer matching requests with a problem response (401, 403, 404, 500, 502, 503) and a trace id; `times: 1` lets Retry succeed; they return a function that removes the rule. `failMe` makes the shell fail to start (the error page). |
| `delayApi(page, url, ms)`, `goOffline(page, offline?)` | Hold matching requests for `ms` (the "still loading" cases); cut or restore the connection. |
| `SHELL_ROUTES` | The routes of the App shell review with their H1, header shape (A list, B workspace, C record, D administration) and the permission that opens each. Specs loop over it; `sh-personas` proves the table. |
| `SIZES`, `shot`, `noHorizontalScroll`, `atEverySize(page, name)` (`support/screens.ts`) | The four sizes (375x812, 768x1024, 1366x768, 1920x1080), screenshots into `E2E_SCREENSHOTS`, "no page-level horizontal scroll", and axe plus both at every size. |

Other epics' permission matrices should reuse it (and add their own people to `PERSONAS`) instead of forking it.

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
| `sh-personas` (3) | The personas helper (#596): a persona has exactly its permissions, pending / disabled / 66-character-name personas look as named, `SHELL_ROUTES` (every route opens for the System Admin with its H1, a person without the permission gets the 403), `failMe`, `failApi` with `times`, `goOffline` |
| `sh-403-in-place` (7) | #598: a guard denial renders the 403 at the address asked for ("You asked for `/path`." and Copy link), Back returns, Reload after a role grant opens the page, a denial after an in-app navigation, Copy link from the keyboard (full address on the clipboard, "Link copied"), `/403` as a direct address, eight permission variants, a pending user still goes to Access Pending, axe and no sideways scroll at four sizes with a 120-character address |
| `sh-focus-heading` (5) | #610: the 403 and the 404 take focus on their H1 on arrival (guard denial, reload, in-app link, direct address), Back leaves the list alone, seven kinds of person plus a custom role and a pending user, the disabled page says "disabled" once, axe at four sizes |
| `sh-still-loading` (4) | #615: real time, response held 10 s: silent at 6 s, "Still loading..." at about 8 s in a polite region, Retry from the keyboard re-issues the request, the Client record skeleton says it too, three permission variants, axe at four sizes with the line open |
| `sh-dialog-rule` (2) | #619: Activity drawer, confirm dialog and phone filter sheet titles are 16 px / 600, the drawer and the dialog close buttons look the same, the sheet's matches, footer order, axe with each overlay open at four sizes |
| `sh-nav-brand` (4) | #620, #621, #626: Work and Records groups at four widths (labels or dividers), "Asset types" next to "Assets", only non-empty groups for five personas, keyboard, the header mark and the favicon files |
| `sh-landing` (6) | #628: where `/`, the logo and the 404 link lead for Director, Observer, Auditor, Intake, Task.View-only, Client.View-only, a technician with a pod and a custom role; Check again lands by the same rule; axe on the Dashboard a director lands on. #691: a Project Manager (no matters, no pod) lands on My Matters with My Work still in the menu, a manager without Task.View keeps the old landing and meets 403 with no request, a Director who is also a manager lands on My Matters, Director and technician unchanged; the System Admin keeps the Dashboard landing (logo and 404 link included) and still opens My Matters from the menu, while a System Admin who also holds the Project Manager role lands on My Matters (#691, owner decision)                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `sh-crumbs` (1) | Breadcrumb rows: links, plain text and the current page share one vertical centre (within 1 px) on `/admin/workflows/new`, `/admin/steps/new` and a project record at four sizes, axe (target size) clean, no sideways scroll |
| `sh-page-header` (5) | #600 page-header contract: H1 22 px / 700 (18 px below 640) and a 12 px top offset on My Work, Task Queue, Clients, Matters and Projects at four sizes and the title does not move between them, nor when clicking through the rail; record pages 22 / 18 px; a 76-character pod name does not wrap the title or widen the page and the selector is at most 22 rem; axe on the five list pages |
| `sh-page-header` additions (+5, #602, #603, #604) | Dashboard, Search results, Advanced search and My profile have the same H1 numbers and the 12 px top edge as the list pages at four sizes; Create task's header starts where a record page's does; Dashboard: the tab strip under the title, Scope (at most 22 rem, a 76-character pod name) and Refresh at the right of the title row, no sideways scroll, arrow keys still move the tabs; axe on the Dashboard header; seven permission variants |
| `sh-state-pages` (7) | #607: 404, 403 and error page as one card (22 px / 700, 18 px below 640, address in monospace, "Go to ..." then the secondary action, brand line, the card keeps 12 px from the page edges at 375), the 404 search placeholder fits and the search works from the keyboard, the rail stays on 403 and 404, axe at four sizes on all three, Tab order, the 404 link for four kinds of person |
| `sh-error-page` (4) | #608: the Reference with Copy (kept after the 8-second toast would be gone, copied from the keyboard), Retry returns to the page that was open, a failed Retry says so and offers "Go to home", axe at four sizes in both states |
| `sh5-toast-callers` (2) | #617: assigning a New task to yourself gives "Assigned to you." plus "Task moved to In Progress." (no third line, the explanation is the Undo tooltip), Undo from the keyboard, axe and no sideways scroll at four sizes with the toast open |
| `sh-offline-banner` (5) | #611: the banner appears within 2 s with the review wording and a Retry button, sits under the sticky header and pushes the page, "Back online." and it goes away, a list that failed while offline shows one inline state and no toast and reads itself exactly once when the connection returns, Retry from the keyboard, axe at four sizes and no sideways scroll, four kinds of person |
| `sh-signin-banner` (5) | #612: a 401 on the lists is one banner with Reload page and no toast, Reload page from the keyboard, the sign-in banner wins over offline, a 401 on the account call says it on the error page, axe at four sizes, four kinds of person |
| `sh-list-load-error` (9) | #613: a 500 on Task Queue, My Work, Pod Work, Clients, Matters and Projects shows one inline "Couldn't load ..." with the Reference, Copy (from the keyboard) and Retry and no toast, Retry reads the list again; a 403 list is one inline message; a failed save still toasts; axe at four sizes with the inline error |
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
| `column-filters-rereview` (4) | Re-review regressions (epic #75): no Angular error in the Task Queue console, one Clear filters on every filtered empty list, Users rows and row actions at 1366 px, the "N archived hidden  Show all" sentence of an empty filtered list (table and phone cards) |

**Task Queue and the shared grid (epic #195)**

| Spec | What it covers |
|---|---|
| `wp2-title-cell` (3) | The Title cell is the icon and the title only; a long title and an unbroken token keep the row height and column width (#196) |
| `wp8-matter-cell` (4) | Matter Number cell (reference only, tooltip, link with `Matter.View`) and Matter Name cell (one line, ellipsis, tooltip, link), Client one line, Matter in the defaults and the one-time notice (#197, #198, #348) |
| `matter-columns` (9) | Matter Number and Matter Name (#348): defaults on the Task Queue, four My Work tabs and Pod Work, axe and no page scroll at 375/768/1366/1920, no `Matter.View`, the narrow-box rule (Matter Name drops first), server sort by Matter Name asc/desc over two pages and the unchanged Matter Number sort, migration (old default gets Matter Name, a customised set does not), Columns panel hide/show/Reset, widths panel, Fit, header menu by keyboard, drag handle, Matter Number filter, Compact and print |
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
| `wp13b-phone-cards` (20), `wp13c-queue-pod-cards` (16) | Cards below 640 px on My Work, Task Queue and Pod Work: card content, chips as editors, keyboard, group headers, skeleton, 200 percent text, the Filters sheet with Sort by; 639 px is cards and 640 px is the table (#192, #238) |
| `wp25-dash-due` (3) | The Dashboard Summary lists, the Swimlane card and the task header say what the Task Queue row says; no clipping from 375 to 2560 px (#213, #214) |
| `wp26-print` (1) | Print emulation and PDF page counts of the three work lists (#215) |
| `fixed-header` (19) | Pinned title, toolbar and header at 1366x768 while the rows scroll; rows in view; the pager on screen |
| `ux-round-4` (36), `review-round-5` (10) | The older UX review rounds: no page-level sideways scroll, the grids fit or scroll with the hint, tab strips, Users and Swimlane fixes |

**Clients, Matters and Projects (epic #245)**

Counts are `--list` entries at the time of writing (WP14); a spec that loops over the four sizes (1366x768, 1920x1080, 768x1024, 375x812) or over roles counts each pass. Pictures: set `E2E_SCREENSHOTS` to `docs/ux/clients-review/fixes/<package>`. All of these skip their axe checks without axe (`E2E_AXE_PATH`); the permission, key and count checks run without it. Counts are compared with the Task Queue totals behind the links, so these specs seed their own client, matters, projects and tasks and never assert a global number.

| Spec | What it covers |
|---|---|
| `detail-page-states` (25) | WP1 (#246 to #250): 404 / 403 / failure text and Retry on the three record pages, the skeleton (crumb, tabs and rows) and a loaded page that does not move (CLS under 0.02), the lost-connection failure, the document title naming record and tab, the "New matter" label and the inactive client rule, natural order (`Wave 7, 15, 23`; `Étude 2` before `etude 10`) in the Matter Projects tab |
| `wp2-list-states` (18) | WP2 (#251, #252): loading, 500, 403, empty and filtered-empty for Clients, Matters, Projects and the client's Matters tab, CLS under 0.02, the matter reference on one line, axe and no sideways scroll at four sizes |
| `wp3-record-header` (31) | WP3 (#253 to #256): one-line crumb cut at 40 characters, title at H2, 105/150/130-character names, the action rule per page and role (permission matrix), the "..." menu keys, the phone header with "Back to ...", the Sensitive note on one line, skeleton height equals header height |
| `wp4-project-tabs` (13) | WP4 (#257): Project tabs Tasks (n) and Details, no side panel, the count, keys, deep link, document title, archived project, permission variants, a 130-character name, axe and no sideways scroll on both tabs |
| `wp6-client-overview` (14) | WP6 (#260 to #262): the strip 9/3/1/1/1 and its links equal the Task Queue pager totals, a person without `Matter.View` or without `Task.View`, 63 matters, empty and inactive client, `Matters (n)`, Enter follows a link |
| `wp7-matter-overview` (19) | WP7 (#263 to #265): Matter Overview rows, strip links land on the filtered Tasks tab, toggle behaviour and Back, deep links, project grid, inline edit refreshes the strip, 150-character name above the fold, the Project column, and the consistency check strip = Task Queue total = grid total for every item |
| `wp8-list-chrome` (31) | WP8 (#269 to #272): 44 px rows and two-line clamp, filter row open by default and remembered, Filters / Clear filters in the header, one chip rule, Status default and the "3 inactive hidden" pager hint with Show all, Sensitive select, no "Other filters" |
| `wp9-list-columns` (16) | WP9 (#266 to #268): the name is the one link, Open tasks and Overdue equal the Task Queue totals, sort by count (first click most first, reload keeps it), duplicate project names told apart by the Matter cell, archived and 130-character names, no-`Task.View` and no-`Matter.View` variants, Status never clipped |
| `wp10-matter-tabs` (14) | WP10 (#273, #274): 40-project matter with 7 archived (Archived group by keyboard, natural order), counts equal Task Queue totals, all-archived and empty, archive then Back, assets en dash and `Assets (n)`, three permission variants |
| `wp11-tabs-pager` (15) | WP11 (#279, #280): the tab strip scroll cue and selected-tab scroll, the pager at 640 to 900 px is one or two rows and never a lone button |
| `wp12-phone-cards` (23) | WP12 (#275 to #278): cards at 320/375/414/600/639 and the table at 640/768 for the four lists, cards equal the table, Sort by and the Filters sheet (Esc, focus trap), states, permission variants |
| `clients-keyboard` (54) | WP13 (#281 to #284): Back returns focus to the row (list, client Matters tab, matter Projects tab, "Back to" link, crumb, heading fallback, archived group), a record page focuses its tab, 25 rows = 25 name stops and 0 copy stops with the right arrow to Copy, "Skip to table" / "Skip to task list", Tab stops before the first row recorded in `fixes/wp13/tab-stops.json`, Home / End / arrows on the tabs, Esc and focus return, the overflow menu, confirm dialog, Activity drawer, Filters sheet and column popover with axe, the Task Queue return still works |
| `clients-permissions` (13) | WP13 (#285): seven roles (System Admin, `Client.View` only, Matter without Client, no `Task.View`, no `Project.View`, no `Matter.View`, no `Asset.View`) walk the three lists and three records and every link of the page content opens without a 401, 403, 404, error alert or toast; controls are checked against the permission (matrix in `docs/ux/clients-review/fixes/wp13/permissions.md`); axe and no sideways scroll |

Also changed by the epic: `matter-client-details-tab` (9) and `detail-layout` (8) now name the Overview tab and the Project tabs; `fixed-header` (19) expects "Skip to table" as the first Tab stop on Clients and cards at 375 px; `wp3-record-header` waits for the menu before reading it. The final verification of the epic is `clients-final` (below).

**Clients final verification.** `clients-final` (31, #287, WP15): the epic's cross-page checks. The contract over Clients, Matters and Projects lists and Client, Matter and Project Details with every tab at 1366x768, 1920x1080, 768x1024 and 375x812 (one test per size: axe 0, no page-level sideways scroll, 44 px rows or cards, tabs of the 150/150/130-character records above y 200 at 1366 and 260 on a phone, Status never clipped in a table without the scroll hint); the counts-equality check in 18 API combinations (client, matter and project, with and without overdue work, in `Pacific/Kiritimati`, `America/New_York` and `Etc/GMT+12`: the record, its summary, the list row and the Task Queue totals behind the strip links agree; for client and matter the Dashboard tiles of the pod that holds the work agree too, Due soon included) plus a record without work and a person without `Task.View` (null, not 403); the same numbers in the browser for three people (System Admin, all View permissions, no `Task.View`): list columns, Overview and Tasks strips, links and the project tab count; 200 percent zoom at 1366 (a 683 px window), reduced motion, a lost connection on a list, and the Tab stops before the first row (recorded). Screenshots: `docs/ux/clients-review/fixes/final`.

**Task Queue final verification.** `final-verification` (6): the Task Queue epic's cross-page checks (#240): no client or matter line under a Title, resizable columns, two-line Due, one row height per density over three pages, the Dashboard drill-through counts, axe at four sizes. (Added to this list in WP14; it ran since the Task Queue epic.)

**Task Detail (epic #288)**

Counts are `--list` entries at the time of writing (T10); a spec that loops over the four sizes (375x812, 768x1024, 1366x768, 1920x1080; some add 1024) or over roles counts each pass. Pictures: set `E2E_SCREENSHOTS` to `docs/ux/task-detail-review/fixes/<package>` (`t1` to `t10`, `final`, `tabs`). The axe checks skip silently without axe, so run with `E2E_AXE_PATH` pointing at a copy of `axe.min.js` (the key, permission and layout checks run without it). Every test seeds its own client, matter, tasks and users.

| Spec | What it covers |
|---|---|
| `task-detail-t1` (16) | T1 (#289 to #295): no Asset API request and no toast without `Asset.View` (BUG-1), the 404 / 403 / failure states and tab titles, the 403 link to a page the person can open, the page skeleton, Activity dates as "Oct 15, 2026", one message for a failed Activity load, the document title cut at 60 characters; permission variants, axe and no sideways scroll at four sizes, CLS under 0.02 |
| `task-header-t2` (18) | T2 (#296 to #300): the record header (crumb cut at 40, one-line title, 200-character title), six-tile facts strip, context line, action set (Edit, Activity, primary, overflow), Sensitive note, phone header, Workflow position budgets, closed, On Hold, cancelled, overdue, ASAP, unassigned, sensitive; four roles; keyboard; axe at four sizes |
| `task-due-inline` (10) | #664: the Due tile as a menu button with a popover: axe 0 and no sideways scroll at four sizes with the popover open and the past-date warning, keyboard-only open, type, Save and focus return with the announcement and the audit, Esc, outside click and Cancel, ASAP and overdue styling and Clear, a server field error and a conflict inside the popover (focus on Save, Reload), permission variants (Task.Edit, Task.View only, Data Technician, On Hold, Cancelled), New York, Auckland and Los Angeles agree with the Edit dialog and the saved instant |
| `comments-toolbar` (2) | #665: the Comments tab's search box (leading search icon) and sort select on one 36 px row from 480 px, wrapped below it, with the Show all line, at four sizes with axe 0 and no sideways scroll; a person without Task.Comment; Esc clears the search |
| `task-status-note-t3` (5) | T3 (#301, #302): the one status note for Completed, Cancelled and On Hold (long reason, Show more), "Was due", Overdue, ASAP and Sensitive combinations, permission variants at four sizes with axe |
| `t4-menus-dialogs` (30) | T4 (#303 to #306): status menu labels and order for five statuses, Complete never disabled and "n steps need information", "Go to first step", dialog wording, "Assign to me" first and the Pod load hint, the My Work vocabulary, keyboard-only flows, four roles, axe and no sideways scroll at four sizes with a menu or dialog open |
| `task-detail-t5` (16) | T5 (#307 to #309) with the tabs of #347: the narrow order (header, strip, note, tabs, Workflow pane, Details), the Details disclosure and its summary and memory, the tab strip that replaced the section nav (counts `Workflow (1/3)`, `Assets (0)`, `Comments (48)`, keyboard, `?tab=` links, no sticky nav, reduced motion), the tabs in the owner's order with each pane the full width of the column, the wide panel without a nested scrollbar, 112 comments, closed tasks (now really Completed), three permission variants, axe at five widths, CLS; prints the Workflow heading y values |
| `task-detail-t6` (10) | T6 (#310 to #314): the Workflow head and filter from 6 steps (3, 5, 6, 7, 8 steps), a long completed step title, Request details open at 6 fields or fewer and remembered, the 12-line description clamp, a 180-character unbroken value, four roles, axe at five widths |
| `t7-comments-activity` (23) | T7 (#315 to #318): composer position with 3, 5, 6, 48 and 112 comments, "Showing latest 3 of 48", Activity excerpts as links to the comment, folds of 3 or more comments, the drawer title clamp, closed task, four roles; axe and no sideways scroll at four sizes with the drawer open |
| `t8-edit-create` (22) | T8 (#319 to #323): the Edit dialog (sticky footer at every scroll position, sections, 200-character title, paste, validation and focus, server error mapping, Esc and focus return), Create task (record header, 720 px column, chooser cards), six permission variants, axe with the dialog open at four sizes |
| `create-task-sections` (9) | #349: Task, Input and collapsed Priority/due/assignment sections in order at four sizes (axe 0 and no sideways scroll collapsed and expanded), Due date and Time aligned within 1 px (stacked at equal width on a phone), summary line and Enter/Space toggle, keyboard-only creation, the section opens on an error, a type without form fields, Create without Assign. The page object has `openWhen()` for the collapsed section |
| `edit-task-sections` (9) | #350: the Edit dialog's Task, Input and collapsed Priority/due/assignment sections in order at four sizes (axe 0, no page-level or dialog sideways scroll collapsed, expanded and Input closed), Due date and Time aligned within 1 px, the 6-field Input rule, summary line and Enter/Space toggle, keyboard-only edit, the section opens on a page error, a server error and a requestor error, permission variants (Task.Edit without Assign or Set priority, Task.View only, closed task). `t8-edit-create` adapted to the new sections |
| `task-detail-t9` (14) | T9 (#324 to #328): `from=` for Matter, Project, Dashboard, Search, Advanced Search, Task Queue and My Work (crumb, Back, exact view, focus on the link, browser Back, nav highlight, one link per width, unknown and unusable origins), one Edit control and the Tab stops, shortcuts C, A, S with the switch on and off, focus on the Status button after five actions, four roles, axe at four sizes |
| `task-permissions-t10` (22) | T10 (#329): the permission matrix. 18 permission variants (System Admin, assignee and other Data Technician, `Task.View` only, every View permission without write, `Task.View` + `Task.Comment`, no `Asset.View`, no `Task.Edit`, no `Task.Assign`, no status permissions, no `Task.Comment`, no `Pod.View`, no `Matter.View`, no `Client.View`, no `Project.View`, no `Dashboard.View`, `Dashboard.View` without a tab permission, `Task.View` + `Matter.View` + `Client.View`) open the Task page plain and from every origin and tab link, the sections, the three facts menus, the overflow, Activity, the Edit dialog and the asset link form, then every link of the page; they fail on any 401/403/404, error alert or toast, no-access notice (the Assets sentence excepted), dead link, uncaught error or disabled control without a reason, and check that each control is present exactly when the server's `allowedActions` and the permission say so; the Tab stops to the first Workflow step are recorded (annotation `tab-stops-before-first-step`), not gated. Four restricted variants also run axe and no-sideways-scroll at four sizes with the overflow and the Activity drawer open |
| `task-detail-final` (15) | T10b (#331): the six task shapes of the review (long and sensitive, overdue, unassigned, On Hold, Completed, Cancelled) at 375, 768, 1024, 1366 and 1920: axe 0 (also with the overflow menu open, the Activity drawer for the long one), no sideways scroll, the title in two lines and a one-line crumb, one Edit control, one primary action (none on a task on hold), no nested scroller; the review's before and after measures (Workflow heading y at four widths, the status note, the Edit dialog's Save, the first Activity rows) printed as an annotation; the permission matrix in short (System Admin, assignee, `Task.View` only, no `Task.View`); the state matrix (loading, 404, 403, 500, a lost connection in Activity, reduced motion). Screenshots: `docs/ux/task-detail-review/fixes/final` |
| `task-detail-layout` (16), `task-detail-collapse` (9) | The single-page layout (columns, splitter, Details panel, text control for long threads) and, since #347, the Comments and Assets panes of the tabs (counts on the tabs, `?tab=` links, "N new", the one-line composer and a draft kept across tabs, Link asset, live counts, axe on every pane); updated for the tabs, no stacked sections, no section nav |
| `task-detail-tabs` (17) | #347: the tabs Workflow, Assets, Comments in that order with the panel named by the selected tab, axe 0 and no sideways scroll on each pane at 375, 768, 1024, 1366 and 1920, the Workflow heading y (annotation `workflow-heading-y`), a 320 px strip with its edge cue, keyboard only (one Tab stop, arrows, Home, End, Tab into the pane, C from any tab, A, S, a draft kept, Link asset), deep links (`?tab=assets`, `comments`, `workflow`, none, unknown, `activity`, `details`, `?step=`), the Activity excerpt link, Back to the list with the address replaced, live counts, permission variants (no `Asset.View`, `Task.View` only, no `Task.Comment`, System Admin and assignee), 112 comments, Completed and Cancelled tasks. Screenshots: `docs/ux/task-detail-review/fixes/tabs` |
| `task-lifecycle` (8), `detail-page-states` (25), `permissions` (7) | Lifecycle rules, the record page states (the Task kind included) and the role matrix of the whole app; regression for the shared files the epic touched |

Also changed by #347 (the page object `pages/task-detail.page.ts` now selects a tab where it opened a collapsed section: `selectTab`, `ensureCommentsOpen`, `ensureAssetsOpen`, `showSection`; the Comments and Assets counts are read from the tab): `task-detail-t5`, `task-detail-layout`, `task-detail-collapse`, `task-detail-final` (the tab replaces the nav wait), `task-permissions-t10` (tabs instead of the nav links; the Assets tab stays without `Asset.View`), `t7-comments-activity`, `task-detail-t9` (C shows the Comments tab), `task-detail-v3-screens`, `comments-activity`, `assets`. Two older closed-task tests never closed the task (`complete(true)` is refused on a task with required steps); they now resolve the steps first.

Also changed by the epic: older specs that selected the old banners, the Workflow "Complete task" button, the Details pencil, "Jump to" or the status-menu second labels (`workflow-steps`, `wp7-inline-row-actions`, `rich-description`, the matter, project, dashboard and swimlane specs for `?from=`, `wp12b-keyboard`). The final verification of the epic (`final-verification` additions, #331) is listed here when it lands.

**Dashboard**

| Spec | What it covers |
|---|---|
| `dashboard-alignment` (3) | The Unassigned panel is level with the first row of tiles on Summary (also under a pod scope) and the Workload / Coverage switch does not move |
| `dashboard-breakdowns` (15), `dashboard-trends-types` (16), `coverage-by-type` (10) | Breakdown cards add up to Open and link to equal queues; Trends by task type; Coverage by task type (C1, #134) |
| `dashboard-consistency` (9) | API only: every count equals the Task Queue behind its link (Summary, Breakdowns, Swimlane) |
| `dashboard-fixed-height` (59), `dashboard-skeletons` (26), `dashboard-summary-lists` (17) | No page scroll on any tab, skeletons fill the loaded box and shift nothing, the three lists fit their rows |
| `dashboard-period` (13), `dashboard-permissions` (11), `dashboard-shell` (16) | The period list and the scope note, permissions per tab, tabs fail independently |
| `swimlane-phone` (19) | The lane switcher below 900 px (#125) |

**Pod Work (epic #546)**

| Spec | What it covers |
|---|---|
| `pw1-fixtures` (2), `pw1-bugs` (21) | The fixtures of every review case (`support/pod-work-fixtures.ts`: busy, empty and 76-character pods, lead, read-only, Pod.View without Task.View, Director, Observer, multi-pod, no pod); BUG-1 to BUG-4 and W9 (one-line title, capped select, 403 page with no request, Assign to me in view from 640 px, no sideways scroll, the tab counts follow assignments) |
| `pw2-scope` (20) | Context line and document title (W2), the list of pods with counts and focus to the title (W3), "There are no pods yet." with and without Pod.Manage (W3); axe at four sizes |
| `pw3-strip` (15) | The strip (Overdue, Due today, ASAP, On hold: counts equal the API, toggles, Back, never follow grid filters), the three tabs and the `view=attention` redirect, the phone chip row (W5, W6, W11, BUG-7) |
| `pw4-members` (10), `pw4-workload` (15) | BUG-5 skip link, BUG-6 empty pod; the workload table (Unassigned row, people with work, folded idle members, availability, neutral bar, View tasks, 60 rem), sortable headings, phone cards (W1, W12) |
| `pw5-narrow` (6) | First card within 200 px of the title at 375, all three tabs in view (W10) |
| `pw6-assign` (6), `pw6-toast` (6) | The cross-pod rule and the members-only picker (W13); the Undo toast after Assign to me at four sizes (W8) |
| `pw7-keyboard` (7), `pw7-permissions` (4) | Keyboard-only walk with Tab-stop evidence (`fixes/pw7-access/tab-stops.json`) and axe on every state with menus open; the permission matrix (no 403, no toast, nothing disabled; hidden controls follow the permissions) |

Run them with `E2E_SCREENSHOTS_PW=<docs/ux/pod-work-review/fixes/pwN-...>` to refresh the screenshots of one package; axe is required (`E2E_AXE_PATH`): the specs fail, never skip, without it. `support/pod-work-checks.ts` has the four sizes, `axeClean`, `pageSideScroll` and `shot` that the specs after #547 share.

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

## Users administration (epic #422)

| Spec | Covers |
|---|---|
| `users-us1-bugs` | badges not cut, focus and Esc of the drawer, the deactivation dialog, open tasks and View their tasks, axe at four sizes |
| `users-us2-status` | the status segments and header chrome |
| `users-us3-grid` | the grid contract (44 px rows, columns, availability rule, sort, rows per page, row menu) |
| `users-us4-drawer` | the drawer: address, focus, Access, Pods, Availability, Profile, deactivation, grant and Undo, read-only variants, conflicts, axe |
| `users-us5-phone` | phone cards |
| `users-us6-pods`, `users-us6-editors` | the Pods list; role editor (select all, Changed, description) and the pod record page |
| `users-us7-keyboard`, `users-us7-flows` | skip link and Tab stops; the six keyboard-only flows and axe with overlays |
| `users-us7-matrix` | the permission matrix of the Users area (`fixes/us7-keyboard/permission-matrix.md`) |


## Project Manager role and My Matters (epic #667, WP-PM4)

Each spec builds the matters and tasks it needs in a world of its own (`support/my-matters-fixtures.ts`: one Project Manager, a second one, one client, matters with exactly the managers and tasks a test names), so the numbers on the page are written down in the test and not read back from the page.

| Spec | Covers |
|---|---|
| `pm4-my-matters` (17) | The page and its panels (#692, #693, #695, #696, #697): every strip cell opens a list whose total equals the cell; Role, Client and Dates in the address, over every panel, restored by Back, Clear filters; a manager with no matters sees a positive empty state; one failing panel leaves the others working and Retry reloads it; Needs my attention groups, rows that open the task and Back, View all totals, no item for a matter nobody manages; Upcoming deadlines by day, the 2 / 4 week toggle, overdue not in it, a stuck hold with its age; Matter health rows, flag words and reasons, sort with `aria-sort`, "How is this decided?", matter link; a matter without a manager is never flagged, listed or counted; "+ New task" creates the task on the right matter and returns to My Matters at 1366 and 375, Cancel returns too, a foreign `returnTo` is ignored; Workload by pod and person with an out-of-office chip and matching totals; Recent activity: first visit nothing unread, an event by somebody else unread until Mark all as read (survives a reload), opening an event marks it, comments only as "commented on"; axe and no sideways scroll at four sizes |
| `pm4-bulk-tasks` (6) | Bulk re-assign and re-prioritise in the matter's Tasks grid (#699): Select mode, three tasks re-assigned with the count and the no-undo note in the dialog, "3 tasks changed." and focus back on the grid; a task cancelled meanwhile is listed with the reason, the others change and the failed one stays selected; Set priority; Select and each action hidden without Task.Assign / Task.SetPriority (and for the Read-Only Observer); at most 100 selected across pages; on a phone the tasks are cards, axe with the dialog open at four sizes and with the result |
| `pm4-layout` (4) | Phone and tablet layout (#700): at 375 px one "Filters (n)" button with a sheet (axe with it open), the strip as one chip row, the first screen shows the whole strip and the first panel's heading, panels in reading order (attention, health, deadlines, workload, activity), health cards with a 44 px "+ New task", Workload and Recent activity show five lines with "Show all"; at 768 px the lower panels are two columns and the table folds Due this week, % complete and the client into the row; no sideways scroll, no target under 44 px on a phone and axe 0 at four sizes |
| `pm4-all-scope` (4) | Scope "All matters" (#701): the switch re-runs every panel with `scope=all` (four matters of one client, the unmanaged one listed like the others, no warning anywhere), the Project manager filter narrows every panel to one person and enables the Role, the strip equals the lists it opens in the All scope, the health table pages past 50 matters, "Set project managers" opens the Matters list in selection mode; a manager without Matter.AssignManagers has no switch, no manager filter and no link, the address cannot force `scope=all` (no 403 request is made) and the API answers 403 |
| `pm5-access` (7) | Keyboard, axe and the permission matrix (#703): Tab stops of My Matters in reading order (scope, Client, Role, Dates, the seven counts, panel links, sort buttons, row button) with Enter and Space on the controls and focus back on the row after Back; no new or changed shortcut (typing in a filter is typing, other letters do nothing, `g` then `m` still goes to My Work); axe at four sizes with the client and manager suggestions, the explanation and the phone Filters sheet open; a Project Manager's page and every link on it (no 403, no toast); a manager without Task.View, the Director, the Read-Only Observer and a technician have no My Matters item and meet the 403 page at the address with no request and no toast; a manager without Matter.AssignManagers has no switch, filter or Select; a matter without a manager is not a warning on the Matters list, the matter header, My Matters (All scope) or the Task Queue (evidence in `docs/ux/pm-review/fixes/pm5-access/`) |

## Task Types administration (epic #352, WP-TY1 to WP-TY11)

Counts are tests (`--list`) at `6bab2fc`. All run axe at 1366x768, 1920x1080, 768x1024 and 375x812 where a screen is involved (axe 0 including `target-size`, no page-level horizontal scroll), and the permission variants System Admin, `TaskType.Manage` only, `Workflow.Manage` only and `Task.View` only (403 page) wherever links, menus or data change. Specs use the seeded data of the review (74 task types, 32 workflows, 67 steps, users `tt-wfonly`, `tt-ttonly`, `tt-viewer`) or build their own records. Screenshots of the epic are in `docs/ux/task-types-review/fixes/*/`.

| Spec | Covers |
|---|---|
| `ty-record-states` (21), `ty-titles-crumbs` (5), `ty-form-pattern` (7), `ty-dialogs` (4) | Shared record states (not found, no access, failure) on the 12 admin routes, document titles and breadcrumbs, the 720 px form card and its validation rule, the dialog wording table (`DIALOG_COPY`) |
| `ty1-list-return` (12) | Back, breadcrumb and Cancel return to the exact list address with focus on the row, also two pages deep (version page, designer) |
| `ty2-shell` (21), `ty2-states` (10), `ty2-strips` (8) | Page shell of the three tabs: short descriptions, tab counts, Filters button, health strips, hidden-count line, loading, error and empty states |
| `ty3-lists` (12), `ty3-cards` (18), `ty3-task-types` (6), `ty3-workflows-steps` (4) | 44 px rows, row overflow, column drop by width, phone cards, Open tasks link, Draft and Not published badges, Inputs column |
| `ty4-task-type` (29) | Task Type record page: header, strip, status note, tabs, eligible workflows table and Add workflow, create, deactivate confirm with impact |
| `ty5-workflow` (22) | Workflow record page: header badges, strip, Versions and Task types tabs, one primary action, deactivate impact |
| `ty6-version-bar` (12), `ty6-version-editor` (18), `ty6-version-tabs` (14), `ty6-version-leave` (5), `ty6-publish-dialog` (10), `ty6-publish-diff` (7) | Version editor: sticky bar, 44 px step rows, step overflow and Undo, library pane or drawer, Alt+Arrow, execution mode, tabs and version switcher, leave guard, publish and retire dialogs with the folded diff and the impact line, read-only note |
| `ty7-step` (28) | Step record page: header, strip, tabs Details, Inputs and Used by, deactivate impact, tags |
| `ty8-designer-panes` (13), `ty8-designer-tabs` (12), `ty8-designer-readonly` (15), `ty8-designer-phone` (11), `ty8-designer-owners` (18) | Shared form designer: fixed-height panes and scroll regions, Properties, Preview and Validation tabs, Publish with errors, read-only versions, phone sheets, and the regression walk of Asset Types and Custom Fields |
| `ty9-keyboard` (22), `ty9-audit` (49) | Skip to table, two Tab stops per row, focus and announcement after publish, retire, deactivate and discard, axe with every overlay open |
| `ty-permissions-matrix` (20) | The 12-role matrix of the area: tabs fall back, create, edit and form addresses give the 403 page, no dead link, toast or refused request |
| `task-types-tabs` (9), `workflow-steps` (11), `workflow-version` (2), `admin-form-designer-pages` (3), `ad1-designer-states` (5) | Older specs kept as regression: the three tabs and their links, SCN-010 to SCN-013 step rules, SCN-014 versions, designer pages, designer states |
| `task-types-tabs-screens` (1), `workflow-tabs-tags-screens` (1) | Screenshot-gated (`E2E_SCREENSHOTS`) |

Notes. The designer has no drag, no Alt+Arrow and no Undo on Remove (#411 not planned, #420); the Alt+Arrow of the version page is exercised in `ty6-version-editor`. `ty8-designer-owners` publishes and retires only on Asset Types; the three Custom Fields forms are singletons shared by every test, so their dialogs are opened and cancelled.

## Notifications (epic #753)

| Spec | Covers |
|---|---|
| `notifications-bell` (11) | Assign as one user and see the badge, panel item and live region as the other after one poll, reading clears the badge; the actor is never notified; panel states (empty, phone sheet); axe 0 at four sizes with the panel open and no sideways scroll; a person without `Task.View` has no bell, no request and the 403 page; an overdue task reaches the bell within one scheduler tick, once; the page: filter, paging and Mark all as read restored from the address, axe at four sizes and the empty page; My profile: the eight switches saved at once and honoured for the next notification, axe at four sizes |

Backend: `NotificationScheduler*`, retention and poll tests are Testcontainers integration tests (two overlapping runs, a held lock, a failing job, a restart after ten days, 50,000 rows of retention). The scheduler and the IIS keep-alive are in the runbook, section 6.1.

## Sensitive matters (epic #788, SM-14 and SM-17)

Two specs, run with the rule switched on (`E2E_SENSITIVE_ACCESS=1`, or `npm run e2e -- sensitive-`; CI runs them as a second pass with the published build, `.github/workflows/e2e.yml`). They build a "universe" through the admin API (`support/sensitive-universe.ts`: one client, a normal control matter N1 and three sensitive ones, S1 with Primary and Secondary manager, S2 without a manager, S3 with one task assigned to P3 and a second task nobody holds; each with a project, tasks, comments and assets that carry a sentinel `ZZSENS-<tag>-S1 ...`) and six people: P1 Primary manager, P2 Secondary manager, P3 task assignee, P4 holds `Matter.ViewSensitive`, P5 unrelated, P6 with `Client.View` only. The fixture `support/sensitive-fixtures.ts` skips every test when the rule is off.

| Spec | Covers |
|---|---|
| `sensitive-leak-scan` (9) | For each of the six people, one test walks Clients (list, page, matters tab), Notifications and the bell panel, the five Dashboard tabs, My Work, Task Queue, Pod Work, My Matters (mine and all), Matters, Projects, Assets, Audit Logs, Users, Search (results and the typed suggestions) and then opens, by address, the matter, project, task and asset of every item. After every screen the page text, tooltips and links, the title, `localStorage`, `sessionStorage`, IndexedDB, CacheStorage and every API answer received are searched for the sentinels of records the person may not see (none may be found), a hidden address must show the "not found" state with the title "Matter not found" (and the like), an address the person may open must not, every call on a screen the person may open must succeed, and the person must FIND what they may see (the control matter and their own share), so the walk cannot pass by seeing nothing. P3 additionally: the matter header on the task page, My Work, the Task Queue and the linked asset is plain text with no link to a matter and no matter-level tab. A hidden id answers byte for byte like an id that does not exist (P3, P5). |
| `sensitive-ui` (5) | Marking a matter sensitive as an unrelated editor: the dialog "You will no longer see this matter" (no toast, axe at four sizes), "Keep it as it is" saves nothing, "Mark sensitive" saves, opens the Matters list and the matter is gone for that person but not for the holder of the permission; creating a sensitive matter without a manager shows the server's refusal beside the checkbox (axe at four sizes) while the holder of `Matter.ViewSensitive` may; the Roles screen warns about `Matter.ViewSensitive` (axe at four sizes); the assignee's task page and My Work, the sensitive matter's Overview and the Matters list are clean for axe at 1366x768, 1920x1080, 768x1024 and 375x812 with no sideways scroll; access ends on the next request: a manager removed (the task page is "not found", the bell loses the matter) and a task reassigned. |

Backend counterparts: `backend/tests/MatterFlow.IntegrationTests/Security/` (catalog, six-persona walk, mutation tests). Unit specs: `matter-form-page`, `task-header`, `matter-cell`, `roles-page`, `session-reset`, `interceptors` and `record-header`.

## Administration pages (epic #518, WP-AD1 to WP-AD9)

Four widths (1366x768, 1920x1080, 768x1024, 375x812), axe 0 including `target-size`, no page-level horizontal scroll, permission variants. Specs: `ad1-designer-states`, `ad1-refused-delete` (states and the inline refused delete); `ad2-kit-grid`, `ad2-kit-lists`, `ad2-kit-lookup`, `ad2-kit-shell`, `ad2-kit-titles` (the list kit); `ad3-labels-shell`, `ad3-priorities-list`, `ad3-priorities-edit`, `ad3-priorities-delete`, `ad3-status-labels` (Labels); `ad4-asset-types-list`, `ad4-asset-type-record` (Asset Types); `ad5-link-roles`; `ad6-custom-fields`; `ad7-audit`; `ad8-focus-rules`, `ad8-tab-stops`, `ad8-axe-reflow` (focus return, Tab stops, reflow); `admin-menu`, `column-filters-admin`. The permission matrix of the area is `ty-permissions-matrix` (Task Types routes, Asset Types, Link Roles, Custom Fields and, in its AD-D block, Labels and Audit with eight roles).
