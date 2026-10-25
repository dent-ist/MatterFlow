# Final verification of the app shell and system pages (#632)

Date: 2026-10-25, base `origin/dev` at `3654ef1` (the shell issues #606, #623, #624, #625 and #630 done in the same pass, commits `799561b`, `1d1c597`, `c6c1c8f`, `946ad44`, `3654ef1`). Own worktree, own SQL Server container and one API on port 5311 from a fresh backend publish and a fresh Angular build; Playwright with one worker, `E2E_AXE_PATH` set to an `axe.min.js` copy, so axe really ran (best-practice rules included). Backend code is unchanged by this epic and was not re-run .

Evidence in this folder: `measurements.json` (every number below, one row per route and width: H1 size, weight, top offset, page-level overflow, bell, axe findings), screenshots `final-<page>-<width>x<height>.png` at 1366x768 and 375x812 for 32 routes, the banners at four sizes (`final-offline-banner-*`, `final-signin-banner-*`) and the Project Manager menu (`final-pm-menu-*`). The spec is `frontend/e2e/tests/sh-final-contract.spec.ts`.

## 1. Header contract: the review's section 8 table, before and after

Measured as System Admin; "top" is the distance of the H1's top edge below the top of the main area; all weights are 700 after. Before = the review of 2026-10-20 (`../../README.md` section 8); after = `measurements.json` of this pass.

| Page | Before: size / weight, top | After at 1366 (and 768, 1920): size / weight, top | After at 375 |
|---|---|---|---|
| Dashboard | 20 / 600, 19 | **22 / 700, 12** | 18 / 700, 12 (before 20, 16) |
| My Work, Task Queue | 22 / 700, 12 | 22 / 700, 12 | 18 / 700, 12 (before 28, 16) |
| Pod Work | 22 / 700, **18** | 22 / 700, **12** | 18 / 700, 12 (before 28, 16) |
| Clients, Matters, Projects | 22 / 700, **14** | 22 / 700, **12** | 18 / 700, 12 (before 28, 16) |
| Assets (observation) | 22 / 700, 14 | 22 / 700, 12 | 18 / 700, 12 |
| Client, Matter, Project records (crumb above) | 22 / 700, 32 to 33 | 22 / 700, 32.9, 32.0, 32.9 | 18 / 700, 60 (before 18, 60) |
| Task page | 22 / 700, 47 | 22 / 700, 47.2 | 18 / 700, 60 |
| Create task | 22 / 700, 48 | 22 / 700, 35.7 | 18 / 700, 60 |
| Users (Roles, Pods), Labels (both tabs), Custom Fields, Audit Logs, Reports | 22 / 700, 12 and no breadcrumb (Reports did not exist) | 22 / 700, 40 (the "Administration >" crumb row is above the title, added by the Admin epic) | 18 / 700, 40 (before 28, 16 on Users and Labels) |
| Task Types, Workflows, Steps | 22 / 700, 34 to 42 | 22 / 700, 40 | 18 / 700, 40 |
| Asset Types | 22 / 700, 32 | 22 / 700, 40 | 18 / 700, 40 |
| **Search, Advanced search, My profile** | **28 / 700, 24** | **22 / 700, 12** | 18 / 700, 12 (before 28, 16) |
| Notifications, My Matters (new since the review) | n/a | 22 / 700, 12 | 18 / 700, 12 |
| 404 page, Client 404 (state pages) | 28 / 700 | 22 / 700 (81 and 40 below the crumb or card top) | 18 / 700 |

Result: the title is **22 px / 700 at 768, 1366 and 1920 and 18 px / 700 at 375 on all 32 routes**; the list and workspace pages all start 12 px from the top (the title no longer moves when you click through the rail: `sh-page-header`); the only other offsets are the shapes with a crumb row above the title (records 32 to 33, admin 40, Task page 47, Create task 36) and the state pages. The three columns of the review table that are not numbers (where the actions are, breadcrumb, description) are not re-measured here: the action order is asserted by `sh-page-header` and the crumb and description rules are in `docs/ux/ux-spec.md` 5.1 and AE item 5.

## 2. The other numbers of the review

| Measure | Before (review, 2026-10-20) | After (this pass) |
|---|---|---|
| axe WCAG 2.2 AA + best-practice, routes at 1366 and 375 | 0 on 23 of 29 routes; `skip-link` and `region` on six list pages (BUG-1); `aria-valid-attr-value` critical on the phone search (BUG-2) | **0 on 32 routes at 1366, 1920, 768 and 375** (128 route-and-width pairs, `target-size` included) and 0 with the offline banner and the sign-in banner open at the four sizes; `shell-axe-guard` (7) also green: menus, dialogs, drawer, 403, error page, Access Pending, phone menu and search |
| Page-level sideways scroll | none found | none on any of the 128 pairs and on both banners at four sizes |
| Landing for twelve kinds of person | Director, Observer, Auditor, Intake landed on My Work / Task Queue | Director, Observer, Auditor, Intake: **Dashboard**; Project Manager: **My Matters** (short menu: My Matters, Matters, Tasks, Assets, with Clients, Projects and My Work under More; no Dashboard item); technician with a pod: My Work; technician without a pod or work: Dashboard (AE item 12); Task.View-only: Task Queue; Client.View-only: Clients; configuration admin: the first admin page; pending: Access Pending; System Admin: Dashboard (My Work with work) |
| Notification bell | none (out of scope of the review) | present on every route for a person with `Task.View` (32 of 32) |
| Mark and favicon | default Angular icon | the MatterFlow mark in the header on every page, favicon files served (`sh-nav-brand`) |
| Toasts | two or three identical toasts stacked, bottom left Undo | one host, bottom right, folded with a count, roles polite/assertive (`sh5-toast-host`, `sh-toast-dedupe`, `sh5-toast-callers`) |
| Dialogs and drawers | drawer title 20 px, three close styles | 16 px / 600 titles, one close style (`sh-dialog-rule`) |
| System pages | 403 lost the address, error page without Reference | 403 in place with the address, one card for 403/404/error, Reference with Copy (`sh-403-in-place`, `sh-state-pages`, `sh-error-page`, `sh-focus-heading`) |
| Connection | no banner, dead click offline, toast pile on 401 | offline banner and "Back online.", sign-in banner, inline list errors, "Still loading" (`sh-offline-banner`, `sh1-offline-nav`, `sh-signin-banner`, `sh-list-load-error`, `sh-still-loading`) |
| Document titles | four patterns | one rule, `<Page or record>: <Tab or view> - MatterFlow` (`sh-doc-titles`, unit table of every route) |
| Rail | 14 px icons, native title only, badge over the icon, My Work = user glyph | 18 px, name tip on hover/focus/long press, dot, check-square (`sh-rail-icons`) |
| Initial bundle | 647 kB at the plan, 651.25 kB after SH1, 613.36 kB at the 2026-10-23 pass | **621.97 kB** of 700 kB (no budget raised; the shell stylesheet stays at its 5 kB budget, the rail rules are a global partial) |
| Tab stops before the content | 14 (administrator 20) | not re-counted here; the Users Tab-stop spec separates page from shell and is green |

## 3. Keyboard and focus (no shortcut added or changed, #420)

`sh-final-contract` "Keyboard and focus": the first Tab stop on a list page is "Skip to ..." then "Skip to main content" and Enter moves focus to `main`; the user menu opens with Enter and Esc returns focus to the user button; the Set out of office dialog closes with Esc and focus returns to the user button; the phone menu opens with Enter, Esc closes it and focus returns to the Menu button. Also green in the regression run: `sh1-skip-link` (6), `sh-focus-heading` (5), `sh1-offline-nav`, `nav-phone` (8), `sh-rail-icons` (Tab through every rail item, Esc dismisses the tip, focus stays), `sh-route-announce` (focus is not moved), `notifications-bell` (11), and Ctrl+K, `?`, the g chords and J/K are covered by the unchanged `keyboard-shortcuts` and shell unit specs.

## 4. What was run

- Frontend unit (`npm test`: app and form-engine): two full runs, each **3964 of 3965 passed**; the one failure both times is `asset-record-page.spec` "moves focus to the heading when the page opens", which passes alone (15 of 15) and depends on which specs ran before it in the same worker (a leaked focused heading from another spec). It is not caused by this pass: a full run of the base commit `f0db645` (3895 of 3896) fails a different focus spec (`client-detail-page.spec`, "shows Couldn't load with Retry ...") the same way, and it passes alone. This is the load- and order-dependent flakiness the earlier passes recorded; the new unit specs (route titles, route announcer, nav tip, glyph table, shell Create task) pass in both runs.
- Lint, Prettier (`src`, `projects`, `e2e`) and the e2e type check: clean. Contracts and OpenAPI: not touched (no API change).
- Playwright, one worker, own stack: `sh-final-contract` (4), the new `sh-doc-titles` (4), `sh-rail-icons` (5), `sh-route-announce` (4), `sh-create-task` (3), and a regression run of **497 tests in 71 spec files with 487 passed, 10 skipped by their own `skip` / screenshot-only tests, 0 failed**: all `sh*` and `sh1`/`sh5` shell specs, `shell-axe-guard`, `nav-phone`, `notifications-bell`, the `pm*` and `px*` specs of the Project Manager menu and landing, the My Work and Dashboard shell specs, the title specs of Task Types, Admin lists, Users and Task detail, `permissions` and `ty-permissions-matrix`. The new specs also ran green in separate runs before (twice in total).

## 5. Open items

- Reports pages are postponed by the owner; their routes are in the contract (`/admin/reports`) and pass, but Reports-dependent follow-ups stay open elsewhere.
- Windows-authentication "browser sign-in problem" page: recorded for the production rollout (needs a real IIS 401).
- Not verified: a real screen reader (NVDA, JAWS, VoiceOver), 200 and 400 percent zoom, high-contrast mode, a real touch device for the long-press tip, the Asset record page's header numbers (not in the contract list), the tab-stop count before the content.
