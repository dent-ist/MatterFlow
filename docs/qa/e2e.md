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

Typical full run: about 80 tests in under two minutes with two workers, plus roughly two minutes for the build and the SQL container the first time.

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
| `dashboard-audit` (7) | Dashboard tiles drill through to the queue with the same filter (my overdue, my open, department ASAP and Unassigned), department section needs its permission; audit log browser smoke (filter by object, event type and text, details, read only, who may open it) |

`rich-description-screens` is not a test: it photographs the rich description at 1366x768 and 375x812 for `docs/ux/rich-description` when `E2E_SCREENSHOTS` names the output folder (with `E2E_AXE_PATH` it also runs axe on every shot).

Baseline 6.4 scenario 3 (Access Pending, role grant, dashboard) is covered by the first test of `permissions`.

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
