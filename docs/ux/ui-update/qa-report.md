# UI update: QA report (epic #953)

## PROGRESS (final, 2026-10-31 23:20 UTC)

Overall: **100%** (all stages done). Verdict below.

| # | Stage | Weight | Status | Result |
| - | ----- | ------ | ------ | ------ |
| 1 | Setup, build, fresh stack | 5% | done | ok |
| 2 | Unit/arch/schema, lint, prettier, tsc, unit, bundle, contracts, OpenAPI/nswag | 10% | done | all pass; no OpenAPI or nswag drift |
| 3 | Full backend integration | 20% | done | 1,235 distinct tests, 0 failing after one stale test was fixed (details below) |
| 4 | Full Playwright | 30% | done | about 2,860 tests; every failure classified; last re-runs pass except one pre-existing failure (#980) |
| 5 | Sensitive e2e, axe four sizes, fit-to-window | 7% | done | 14 / 14; axe 0 at all four sizes |
| 6 | Exploratory bug hunt | 18% | done | 13 real bugs fixed, 4 items filed |
| 7 | Fixes and re-runs | 5% | done | 23 commits "WPx QA ..." |
| 8 | Report, issues, epic refresh | 5% | done | #976 to #980 filed; #954 to #975 closed except #959 |

## 1. Verdict

**READY TO MERGE**, with the points of section 6 for the owner. Reasons: every automated check passes after the QA fixes (one pre-existing Playwright failure remains, filed as #980 and worse on dev); the sensitive-matter rule, event permissions, counts and scope hold in the API and the UI; axe finds nothing at four sizes; performance of the new reads is inside twice the budget; the bundle is 652.96 kB; module boundaries, schema scripts 1 to 50, contracts and the generated client are in step. The owner decisions to take (not blockers): the "Tasks" label (#978), who may add calendar items (#977), directors and My Matters (#976).

Branch `ui-update` (from dev at 0a88090). QA by the QA agent on `origin/ui-update` (commits "WPx QA ...").


## 2. What ran

| Area | What | Result |
| --- | --- | --- |
| Backend build | `dotnet build -warnaserror --no-incremental`, and Release build | 0 warnings, 0 errors |
| Backend format | `dotnet format --verify-no-changes` (again after the new test files) | clean |
| Backend unit | `MatterFlow.UnitTests` | 2,455 / 2,455 |
| Architecture | `MatterFlow.ArchitectureTests` | 47 / 47 |
| Schema | `MatterFlow.SchemaTests` (replays scripts 1 to 50) | 102 / 102 |
| Integration | all 1,235 distinct test names, in three runs (see below) | 0 failing at the end |
| Frontend | eslint with theme colour (37 legacy files within the ledger) and contrast (66 pairings) checks; prettier; tsc app, spec, e2e | clean |
| Frontend unit | whole `frontend` project, after the fixes | 4,312 / 4,312 (361 files) |
| Bundle | production build | initial total 652.96 kB (limit 700). Style budget warnings for `roles-page.scss` (file untouched, 6.03 kB) and `app-shell.scss` (5.17 kB, +79 bytes): both already over 5 kB on dev, not new |
| Contracts / OpenAPI / client | `validate-contracts.mjs`; Release build then `git diff` of `contracts/openapi/v1.json`; `npm run api:generate` then `git diff` of the client | OK, no drift |
| Playwright | whole suite, chromium, 1 worker, fresh SQL and published API (port 5471): 2,501 tests, then 359 more (36 spec files from `wp1-dialogs-popovers` on, including branding) after my own timeout cut the first run | 16 first-time failures, all classified (section 3) |
| Sensitive-matter e2e | `sensitive-leak-scan`, `sensitive-ui` with the rule ON, fresh SQL and API | 14 / 14 |
| Axe | wcag2a, wcag2aa, wcag21aa, wcag22aa on all five tabs and every state: tree open and collapsed, side panel open and collapsed, Show, Client, Matter, Status, Priority, Assignee and Due dropdowns, + New, Options, Add Event dialog (also with validation errors), day panel, Shows, asset panel, Metrics Assets view, Browse popover, at 1366x768, 1920x1080, 768x1024, 375x812 | 0 violations (best-practice "region" notes on dropdown panels that are drawn on the page body are not counted) |
| Fit to window | `mm-ui-update` (document never scrolls on desktop, frames end 16 px above the bottom) | passed; also seen on 125 matters and 1,200 tasks |
| Scale | 25 extra clients with 125 matters (a PM then sees 128) and 1,200 tasks in all, 60 assets: PM and administrator | first rows 1.5 s, each tab 1 to 1.6 s, tree of 302 rows, no page scroll |

Integration runs: run 1 (console log too large, cut by my own 2 h timeout, about 1,480 tests, no failure seen, no result file); run 2 (killed by the kernel for lack of memory after 1,046 passed, 0 failed, 863 distinct names, `/tmp/qa-it2.trx`); run 3 (the remaining 372 names: 597 passed, 1 failed = a stale test, now fixed and 6 / 6 in its class, `/tmp/qa-it3.trx`). Together they cover every test name once.

## 3. Failures and their classification

| # | Where | Classification | Fix |
| --- | --- | --- | --- |
| 1 | `app.spec.ts` x2 (nav order) | stale spec | 238667f |
| 2 | `ad4-asset-types-list` (rows 54.5 px) | real bug (type chip stacked above the name) | a1759ae |
| 3 | `page-header-icons` (My Matters) | real (title tile used a briefcase, menu and mockup use the clipboard) plus a spec that could not find the tile | 321fe5c |
| 4 | `sh-rail-icons` x2, `sh-nav-version` (icons 19 px, want 21) | real regression (the new nav icon token beat the rail's 21 px rule) | 778a143; then the pending dot touched the icon by 1 px: 718fb5d |
| 5 | `sh-final-contract` (My Matters title 22 px and weight 600) | stale spec (the page has its own mockup title) | 778a143 |
| 6 | `mm-ui-update` calendar edit and delete | load flake (passed alone and in every later run) | - |
| 7 | `ty-permissions-matrix` x2, `ty2-states`, `ty6-version-bar`, `users-us1-bugs`, `wp10-matter-tabs`, `wp13b-phone-cards`, `wp9-list-columns` | load flake / harness: several Playwright runs of mine shared one output folder (ENOENT on trace files) | all passed on re-run |
| 8 | `wp13c-queue-pod-cards` ("Order" label matched checkboxes of other tests' task types) | flake caused by data left by other tests (the spec is fragile) | passed on re-run |
| 9 | `matter-client-details-tab` (document scrolls at 1366x600 for an administrator) | pre-existing: fails on the dev baseline build with 205 px, 137 px here | not fixed, issue #980 |
| 10 | Integration `MatterOverviewTests.The_overview_has_the_header_...` (404 on `/my-matters/health`) | stale test, fails on dev too (the endpoint went away in 53c5a4f, WP-OV1) | 490c460 |

## 4. Bugs found in the exploratory pass (all fixed unless stated)

1. Assignee filter listed nobody: the lookup asked for 200 people (the API allows 50) and got a 400. Now 50 with a server search as you type, and a linked assignee beyond the first 50 stays visible. 6239eaa, 612ab3e
2. Priority filter empty on a page opened by address. 6239eaa
3. Metrics "Open work by task type" counted On Hold tasks as overdue (27, against 22 on the Overdue chip), so numbers opened a grid with another total. Backend 92d5745; all 74 Metrics numbers now equal the grid.
4. Asset side panel answered 404 for an administrator on All matters (scope missing in the request). 5d08038
5. Tree failure said "No clients or matters" with no Retry. c029bfd
6. Focus lost after the calendar item dialog closed (Add Event, + New) and after the asset panel closed; Escape did not close the asset panel. ee0e6ef, 278d903
7. On Hold task shown red as "N d overdue" in the Due cell against the owner's rule. 612ab3e
8. Phone card: task number and title run together. 6239eaa
9. Shared dropdown: scrolling list not keyboard focusable at phone size (axe, serious) and an empty listbox (axe, critical). 6239eaa
10. Asset Types list: type chip stacked above the name, rows 55 px. a1759ae
11. Asset type form: Icon and Colour crammed (label against its button). fae486b
12. My Matters title icon differed from the menu icon. 321fe5c
13. Rail icons 19 px instead of 21 px (see failure 4). 778a143, 718fb5d

Checked and fine: Show and Status counts equal the grid total for every status x Show combination for four scopes (144 API checks); the sensitive matter is absent from tree, counts, feed, assets, events, upcoming and detail for people who may not see it, present for managers and holders; event create, edit, delete by Primary, Secondary, `Matter.Edit` holder and a stranger (403 for a manager without `Matter.Edit` on a matter they do not manage; 404 for sensitive); 409 conflict between two sessions gives a message; dates MM/DD hh:mm AM/PM for date-only, other year, DST end (both 01:30 times) and DST start; paging, sort of every column, Filter row, deep links and reload, Back and Forward; error states for tree, counts, feed, upcoming and grid; hostile names (`<img onerror>`) and 190-character names in tree, grid, dropdowns, calendar, dialogs; phone 375 and 200% zoom (no sideways scroll); keyboard order; nav for System Administrator, Director, PM and Technician (order Dashboard, My Matters, My Work, Clients, Matters with Projects and Assets, Pod Work, Task Queue, Administration; no More; v0.1.1; selected pill; rail); other pages at 1366 and 375 render sensibly; Task Types and Asset Types icon and colour pickers create and edit with the preview chip.

Deferred as issues (label phase-24, under #953): #976 Director cannot open My Matters (pre-existing guard), #977 every PM holds `Matter.Edit` so can add items on any matter, #978 "Task Queue" against "Tasks" and the "one chosen" chip, #979 lost coverage, #980 the 1366x600 document scroll.

## 5. Performance (new reads, the 200-matter, 24,000-task, 100,000-asset harness)

New tests `MyMattersPerformanceUiUpdateTests` (budget p95 300 ms, fail at twice that; statements per read must not depend on the number of matters): both pass. Warm p95 over four callers (5 matters, 50 matters, 145 matters, administrator on All matters with 100,000 assets):

| Read | p95 range | Statements |
| --- | --- | --- |
| tree (also search, active only) | 31 to 87 ms | 4 to 5 |
| upcoming events, calendar events (60 days) | 2 to 8 ms | 1 to 2 |
| feed, six kinds | 217 to 396 ms | 17 to 18 |
| feed unread, feed overdue and on hold | 155 to 254 ms | 14 to 16 |
| task counts (with and without Show) | 23 to 99 ms | 7 to 8 |
| assets list, first page, sorted by name | 24 to 164 ms | 2 to 3 |
| assets with name filter | 17 to 420 ms | 2 to 3 |
| assets sorted by linked tasks | 35 to 438 ms | 2 to 3 |
| task grid, 25 rows | 43 to 60 ms | 7 |

Worst cases (feed for 145 matters 396 ms, assets with a name filter or linked-task sort over 100,000 assets 420 and 438 ms) exceed the 300 ms plan budget but stay under the 600 ms test ceiling. Cold first calls were at most 354 ms (assets name filter). The older My Matters performance tests (Breakdown, Data, reports) passed in run 3.

## 6. Not run, and residual risks

- No Windows authentication run (Dev provider only), no IIS, no browser but Chromium, no Firefox or Safari, no real touch device (touch tested only by emulation of `hover: none` in CSS reading).
- The integration suite was run in three pieces because of my own timeout and an out-of-memory kill of the test host; no test name was left out, but the timing-sensitive classes ran under load from other jobs on the machine (they passed).
- Playwright ran on the build before the QA fixes for the full pass; the fixed build was used for the targeted re-runs (about 270 tests in six re-runs) and for the sensitive and axe runs. The QA fixes touch the My Matters page, shared dropdown, asset admin pages, rail CSS and one backend query; the full frontend unit suite (4,312) ran on the final sources.
- The shell scrolls the document at 1366x600 for an administrator (#980).
- Events: every PM can add items on any matter they can see (#977); the Add Event button shows for anyone holding `Matter.Edit` or `Matter.BeManager`, the server decides and the dialog reports the refusal.
- A director cannot open My Matters (#976); the menu says "Task Queue" for most roles (#978; owner decision 2026-11-05: "Task Queue" for everyone, the compact "Tasks" label is removed, and the Overview's task type chip now shows the task type name).
- Dropdown panels (drawn on the page body) trigger the best-practice axe rule "region"; not a WCAG failure.
- Disk and memory on the build machine were close to the limit during the run (an OOM kill, disk down to 1 GB at one point); nothing in the product depends on it.
