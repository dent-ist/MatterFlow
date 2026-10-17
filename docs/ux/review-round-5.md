# UX / QA review, round 5: profile availability, Swimlane and Users (issue #74, epic #68)

Reviewer: independent UX designer and QA engineer. Build: `dev` at `640d1df` (2026-10-17) for the findings, the fixes are in `b387b2e`.
Screenshots: `docs/ux/review-round-5/` (`sNN` is the file that starts with `NN-`; `before-NN-...` are the broken states, the others are on the fixed build). Regenerate them with `E2E_SCREENSHOTS=docs/ux/review-round-5 frontend/e2e/run-local.sh -g "review round 5 screenshots"`.

## 1. Method

- Real stack: SQL Server 2022 in Docker, the published API with Dev auth, the production Angular build on one origin, Chromium (Playwright + axe-core 4.10.2, tags `wcag2a`, `wcag2aa`, `wcag21aa` and `wcag22aa`).
- Data: a department of 18 people in two pods with different loads (idle, light, normal, heavy, critical), two of them out of office (one with an until date and a note, one open-ended), one person in Tokyo with their own hours (Mon-Fri 10:00-18:30), one in Auckland with a weekend-only schedule, one with no working days, one technician without a pod, plus a board of 160 tasks over several clients and matters (new, in progress, on hold, completed, cancelled).
- Personas: System Admin, Director, Pod Lead, Data Technician and the Read-Only Observer.
- Walk 1 (discovery): every persona at 1366x768, 1024x768, 768x1024 and 375x812 on My profile (default, Out of office form, validation errors), the header account menu, the "Set out of office..." dialog, Dashboard Summary, Swimlane and Users (direct URLs), and Administration > Users. 124 states, each with axe, a horizontal-overflow check, console errors and failed API calls (none: zero console errors, zero page errors, no 4xx/5xx from the app itself).
- Keyboard: tab order of My profile, the header menu (Enter, Arrows, Esc), dialog focus return, the Dashboard tab strip.
- Correctness: availability state compared across every surface through the API (Users admin list and its filter, My profile, Users tiles, Swimlane card dots) for people in other zones and with custom hours; evaluator edge cases (DST gaps and overlaps, half-hour and quarter-hour zones); the Swimlane "Done in the last" window; the 5-minute refresh after a change of availability; permissions through the UI and the API.
- Walk 2: the fixed build, with the screenshots in this folder, plus the regression specs (section 6).

## 2. Verdict

**Ship, after one fix.** The profile availability screen is consistent with the app's pattern standard (page header with its own icon, one column, sticky action bar, live validation plus a focused error summary, "Leave without saving?" guard), the header menu and the dialogs return focus correctly, and the state is the same on every surface for every person tested, in every time zone tested. One High functional bug was found and fixed: after the header's "Set out of office" dialog had been closed with Esc, Cancel or the X, choosing "Set out of office..." again did nothing until the page was reloaded (UXR5-15). Three Medium findings (a hidden selected tab, a hidden Availability column, a Save bar that floats above the dialog edge) and three trivial Lows were fixed too; the rest are Low and listed.

Counts: Blocker 0, High 1 (fixed), Medium 3 (all fixed), Low 9 (3 fixed, 6 open), Info 2. Axe (wcag2a/2aa/21aa/22aa): 0 violations on the 124 states after the fixes; before the fixes 2 distinct rule hits, both `target-size` (WCAG 2.2 only), listed as UXR5-04 and UXR5-05.

## 3. Findings

Severity: Medium = visible inconsistency or avoidable friction; Low = polish. All Medium findings are fixed.

### Layout and responsive

**UXR5-01 Medium, fixed: at 768 px the selected Dashboard tab is out of sight.** At 768 the Dashboard heading, the tab strip, Scope and Refresh share one row, so the strip is about 340 px wide and scrolls. The tab chosen by the address was brought into view once, before the Scope select arrived and took room from the strip, so a Pod Lead on Users saw "Summary, Swimlane >" and a Director on Swimlane saw "Summary, Breakdowns >": the page content said where they were, the tab row did not (before-01; Director on Swimlane at 768 looked the same). Fix: the strip also scrolls the selected tab into view whenever its size changes (`dash-tabs.ts`, `revealInList` on the resize observer). After: s16, s14 (768). Test: `dash-tabs.spec.ts` (unit, resize callback) and e2e UXR5-01 (a Pod Lead on Users and Swimlane at 768, the selected tab is inside the tab list).

**UXR5-02 Medium, fixed: Administration > Users hides the Availability column below about 1100 px, without a cue.** The grid has nine columns; at 1024 Status and "Open" are past the edge, at 768 and 375 the Availability chip, the very thing this epic adds, is too (before-03, 768; the same list at 1366 is s10). There was no "Scroll sideways" line as the task tables have. With the long machine-made account names of the test data the list is also wider than its box at 1366 for a System Admin, whose "Edit availability" link is then cut (s11); real accounts are shorter, so expect the problem from about 1100 px. Fix: the Users list shows "Scroll sideways to see every column." while it is wider than its box (and not otherwise, so a wide screen is unchanged). After: s10 (768). Test: `users-page.spec.ts` (unit) and e2e UXR5-02. Recommendation for later (not done): on narrow screens hide "Windows account" (it repeats the name for most accounts) and show the First seen date on one line; see UXR5-10.

**UXR5-03 Medium, fixed: in the "Edit availability" dialog the Save bar floats above the dialog edge.** The sticky bar stuck to the bottom of the content box, which ends one dialog padding (20 px) above the dialog's edge, so the next row of the form ("Saturday, Not working") showed through under the buttons (before-05). Fix: in the dialog the bar sticks 1.25rem lower (`.av-actions--dialog`). After: s12. Test: e2e UXR5-03 (the bar's bottom is flush with the dialog's bottom; Esc returns focus to the opener).

**UXR5-04 Low, fixed: the links of the validation summary on My profile are 18 px high.** Axe `target-size` (serious, WCAG 2.2 AA 2.5.8; not a 2.1 AA failure) on every width, in every persona, in the validation state (s03, s04). Fix: each link is a 24 px target. Test: e2e UXR5-04 (axe clean, link at least 24 px high, link still focuses its field).

**UXR5-05 Low, fixed: a Swimlane card with a one-line title has an 18 px high title target.** Axe `target-size` at 1024 for a card whose title fits on one line (the other cards wrap to two lines and pass). Fix: the title button is at least 24 px high. After: s17. Test: e2e UXR5-05 (height and axe at 1024).

**UXR5-06 Low, fixed (trivial): "next work starts" could disagree with the moment the state flips by 30 or 60 minutes.** For a work start that falls inside a spring-forward gap (a 02:30 start on the day clocks go from 02:00 to 03:00, or 02:15 in Lord Howe) the state turns Available at the first valid clock time (03:00) while `nextWorkStartUtc` said 03:30, and a start inside the fall-back hour used the second occurrence. Only people who work on a Sunday morning in the small hours would ever see it; still a free fix. `UserAvailabilityEvaluator` now resolves a missing local time to the first valid instant after the gap and a repeated one to its first occurrence. Tests: five new fixed-clock cases in `UserAvailabilityEvaluatorTests` (New York gap and overlap, Lord Howe, Kathmandu, Havana midnight gap and overlap).

**UXR5-07 Low: native time fields cost four tab stops each.** The 14 time fields of the week are native `<input type="time">` (hour, minute, AM/PM and the picker button are separate stops), so a keyboard user passes about 56 stops between the first working day and Time zone / Save (s01). Typing a time works well (type "0900A" in one field), the helper buttons help, and the sticky Save is always reachable, so this is friction, not a barrier. Recommendation: two `select`s (hour:minute in 15-minute steps) or a single text field with a pattern, only if people complain.

**UXR5-08 Low: Swimlane at 1024 shows three and a half lanes.** The board scrolls sideways inside itself between 900 and about 1100 px by design (ux-spec S01b), but at 1024 nothing says so: the Completed lane is cut at the edge and its caption reads "Completed or ..." (s15 1024, s17). Recommendation: switch to the single-lane tablist below 1100 px, or give the lanes a 220 px minimum so four fit at 1024 (944 px of board).

**UXR5-09 Low: the Availability filter value is cut in the column filter row.** "Out of offic" in the 140 px select at 1366 (s11). Recommendation: give the Availability and Status filter selects 160 px (the chip text "Out of office until Oct 20" is longer still but is not shown there).

**UXR5-10 Low: "First seen" wraps onto four lines at 768 and 375 and the Email column is empty for accounts without an email (s10 768).** Recommendation: show the date as "Oct 17, 2026" without the time in the list (the time is in the details panel) and let empty Email collapse below 1100 px.

### Behaviour

**UXR5-15 High, fixed: the header's "Set out of office..." goes dead after its dialog was closed once.** Open the account menu, choose "Set out of office...", press Esc (or Cancel, or the X), then choose it again: nothing opens, until the page is reloaded. The header created the dialog and opened it with `ComponentRef.setInput('visible', true)`; the dialog closes itself by writing its own `visible` model, and `setInput` ignores a value equal to the last one it set, so the second `true` was a no-op. Found while checking focus return (the Esc path returned focus correctly, the next attempt failed); the first-time paths, which every earlier test used, were fine. Fix: the dialog has a public `open()` (it also empties the fields, which a second opening would otherwise have kept) and the menu calls it. Tests: `set-out-of-office-dialog.spec.ts` (reopens with empty fields) and e2e "the header Set out of office dialog returns focus to the account menu button on Esc, Cancel and Save" (opens it three times in a row).


**UXR5-11 Low: the header's own availability label is read once per session (found by reading the code, not reproduced).** `MyAvailability` loads the profile the first time and after a quick action. If an administrator edits the person's availability on their behalf, or the Until date passes while the browser tab stays open, the header keeps its old "Out of office until ..." until a reload. Everything else (Users tiles, Swimlane, lists) reads fresh from the server. Recommendation: refresh it on `visibilitychange` and when the My profile page opens (one GET).

**UXR5-12 Low: a person in another time zone shows only "Off hours" on the Users tile.** For a lead, "Taro Tokyo, Off hours" does not say when he is back. The API has `nextWorkStartUtc` for the profile but the compact availability on the tiles and lists omits it. Recommendation: add `nextWorkStartUtc` to the compact object and put "Back at Mon 10:00 AM JST" (or the viewer's time) in the tile's accessible description.

### Information

**UXR5-13 Info: a read-only user can set their own availability.** By design (`Task.View` is the policy of `GET/PUT /me/availability`; telling colleagues you are away is not an edit of work). They have no Users or Swimlane tab, no Users administration, and the API answers 403 for anyone else's profile (s08, s09).

**UXR5-14 Info, fixed: documents were behind the code.** `docs/ux/ux-spec.md` had no screen for My profile, the header menu or the availability column (new S23, UAT-S23, Appendix C rows for `User.Manage` and `Dashboard.ViewCoverage`); `docs/architecture.md` 6.7 did not mention the `availability` filter of `GET /users`, that the state is computed when read, or the DST gap and overlap rule; `docs/ux/profile-availability/README.md` said the API had no availability filter; `docs/runbook.md` had no note that the state needs the host's time zone data. `Dashboard.ViewDepartment` no longer appears outside historical review files (the permission was replaced by `Dashboard.View` plus six tab permissions in script 24; `docs/architecture.md` 5 describes it). `docs/erd.md` (`UserAvailability`, `UserWorkHour`, script 22) matches the code; no change.

## 4. Correctness checks

### 4.1 One state on every surface

For every person of the seeded department (35 accounts in the stack), `GET /users` (list and `availability=` filter), `GET /users/{id}/availability` (what My profile shows), the Users tiles (`/dashboard/workload`) and the Swimlane card dots (`/dashboard/swimlane`) returned the same state; the filter counts (7 out of office, 19 off hours, 9 available) equal the rows the Users screen showed. Regression spec: "every surface agrees on the state of people in other time zones and with custom hours" (Tokyo around the clock, Auckland weekend-only, no working days, out of office until 2099 in Kiritimati, the default week).

### 4.2 Time zones and DST edges (fixed-clock unit tests, `UserAvailabilityEvaluatorTests`)

| Case | Result |
|---|---|
| New York, out until Mar 7, clocks go forward Mar 8 | ends at 05:00Z, the day is 23 hours (existing) |
| New York, out until Nov 1, clocks go back | ends Nov 2 05:00Z, the day is 25 hours (existing) |
| Monday 09:00 across the change | 13:00Z before, 14:00Z after (existing) |
| Work start 02:30 on the gap day (New York) | Available from 07:00Z, next start 07:00Z (was 07:30Z, UXR5-06) |
| Work start 01:30 in the fall-back hour | first occurrence, 05:30Z (was the second, 06:30Z) |
| Lord Howe, 30-minute gap, start 02:15 | 15:30Z, both agree |
| Kathmandu (UTC+05:45) Monday 09:00 | 03:15Z |
| Havana, midnight inside the gap | the day starts at 01:00 CDT = 05:00Z |
| Havana, midnight repeated | out of office begins at the first midnight |
| Unknown zone | firm zone (existing) |

The browser preview on My profile uses `Intl` with `hourCycle: h23`, so midnight is 00:00 and not 24:00 (existing tests).

### 4.3 Swimlane "Done in the last" window

The window is the viewer's `completedDays` local calendar days including today, from the start of the local day, converted to UTC with the gap rule; `SwimlaneApiTests` check the start for several zones including the two extremes. Nothing to change. Tasks are in the window by their last status change.

### 4.4 Auto-refresh after a change

Swimlane, Users and the Summary refresh every 5 minutes while visible and when the browser tab becomes visible again after that long; a refresh never moves focus or changes the filters. Regression spec: "a change of availability shows on the Users tab and on the Swimlane card after the five-minute refresh" (fake clock): the tile turns from AVAILABLE to OUT_OF_OFFICE, the card's out-of-office dot appears and disappears, the address keeps its filter. See UXR5-11 for the header label.

## 5. Permissions and direct URLs

| Persona | My profile | Edit another person | Dashboard tabs | Direct URL `?tab=users` or `swimlane` | Users administration |
|---|---|---|---|---|---|
| System Admin (`User.Manage`) | own | yes: "Edit availability of <name>" (s12) | all | opens | full |
| Director | own | no button; API 403 (s13) | Summary, Breakdowns, Trends, Swimlane, Users | opens (s14, s15) | list, no Edit |
| Pod Lead | own | no (no Users admin, API 403) | Summary, Swimlane, Users | opens (s16, s17) | menu hidden |
| Data Technician | own | no | Summary (unassigned queue) only | falls back to Summary with a note (s18) | menu hidden |
| Read-Only Observer | own, editable | no, API 403 | Summary | falls back to Summary with "Users is not available for your role. Showing Summary." (s09); `GET /dashboard/swimlane` and `/workload` are 403 | page says "You don't have permission to view this." |

The Dashboard tabs are hidden by the six `Dashboard.View*` permissions (`Dashboard.ViewDepartment` no longer exists; the issue text predates script 24). The e2e spec "a read-only user: direct URLs ..." covers the table's last two rows; `dashboard-permissions.spec.ts` and `DashboardTabPermissionsTests` cover the rest.

## 6. Screens and re-check at 1024, 768 and as the read-only user

| Screen | 1366 | 1024 | 768 | 375 |
|---|---|---|---|---|
| My profile (technician) | s01 | s01 | s01 | s01 |
| Out of office form / validation | s02, s03 | - | - | s04 |
| Header menu / Set out of office dialog | s05, s06 | - | - | s05, s06 |
| My profile, Tokyo, own hours and zone | s07 | - | - | - |
| My profile, read-only | s08 | - | - | s08 |
| Users administration | s10, s11, s13 | s10 | s10 | (UXR4-01) |
| Edit availability dialog | s12 | - | - | - |
| Dashboard Users, Director | s14 | s14 | s14 | dashboard-review-2 |
| Dashboard Swimlane, Director | s15 | s15 | s15 | dashboard-review-2 |
| Dashboard Users / Swimlane, Pod Lead | - | s16, s17 | s16 | dashboard-review-2 |
| Read-only direct URL | s09 | - | s09 | - |

Layout: no page-level horizontal overflow on any of the 124 states (My profile, the menu, the dialog, the three Dashboard tabs, Users administration); the Users tiles reflow from 7 to 4 to 2 per row without clipping names beyond an ellipsis; the Swimlane switches to one lane below 900 px; the single-lane view at 768 (s15) keeps toolbar, lane tabs and cards in one column. Open: UXR5-08 (Swimlane at 1024), UXR5-10.

## 7. Axe

Wcag2a, wcag2aa, wcag21aa and wcag22aa on the 124 states of walk 1 (every persona and width: My profile default, Out of office form with three validation errors, header menu open, Set out of office dialog, Summary, Swimlane, Users, Users administration): 2 distinct hits before (UXR5-04, UXR5-05, both `target-size`), 0 after. The fixed build is also covered by the regression specs and by the existing `swimlane-board.spec.ts` axe tests.

## 8. Covered by earlier reviews

Each bullet of the body of issue #74, with its evidence.

| Bullet of #74 | Evidence |
|---|---|
| Independent UX expert and QA review in the real app with seeded data as Director, Pod Lead, technician, read-only user | Swimlane and Users as Director, Pod Lead and Technician at 1366, 1920 and 375 with axe and data checks: `docs/ux/dashboard-review-2/README.md` (and rounds 3 and 4: `docs/ux/dashboard-review-round-3.md`, `docs/ux/review-round-4.md`). **This review:** My profile availability and the header menu as all four personas, Swimlane and Users at 1024 and 768 and as the read-only user (sections 3 to 7). |
| Layout at 1366x768, 1024, 768, 375 | Dashboard at 1366 and 375: dashboard-review-2; the fixed-height checks in `dashboard-fixed-height.spec.ts`. **This review:** the four widths on every screen of section 6 (UXR5-01 to UXR5-03, UXR5-08, UXR5-10). |
| Consistency with the pattern standard | `docs/ux/ux-spec.md` S01, S01b, S23; dashboard-review-2; **this review** section 2 (My profile) and UXR5-02, UXR5-03. |
| Keyboard and focus | Swimlane lane roving focus, drawer return, tabs: `swimlane.spec.ts`, `swimlane-board.spec.ts`, `dash-tabs.spec.ts`; dialog focus return `36d0d66` (`docs/qa/full-pass-2026-10-16/report.md`). **This review:** tab order of My profile (UXR5-07), header menu, dialog and Esc focus return (e2e UXR5-03, the Cancel and Esc paths of s06). |
| Axe wcag2a/2aa/21aa on all new states | dashboard-review-2 (Swimlane, Users); `profile-availability.spec.ts` (My profile at 1366 and 375); `swimlane-board.spec.ts`. **This review:** every state of the profile, menu, dialogs and validation as four personas at four widths (section 7). |
| Console errors | dashboard-review-2 (none). **This review:** none in 124 states. |
| Performance (500+ cards, 300 users) | `BoardPerformanceTests` (5,000 tasks, Swimlane and Team workload), `CoveragePerformanceTests` (5,000 tasks, 300 people), the 800-card board in `swimlane.spec.ts`; budgets and measurements in `docs/qa/dashboard-final-pass-2026-10-17/report.md`. |
| Permissions: tabs hidden without the tab permission | The issue names `Dashboard.ViewDepartment`; it was replaced by `Dashboard.View` + `ViewSummary`, `ViewUnassigned`, `ViewBreakdowns`, `ViewTrends`, `ViewSwimlane`, `ViewUsers`, `ViewCoverage`. `DashboardTabPermissionsTests`, `DashboardPermissionsMigrationTests`, `dashboard-permissions.spec.ts`; **this review** section 5 (all five personas, direct URLs, API 403). |
| Availability edits only own / `User.Manage` | `UserAvailabilityApiTests`, `users-page.spec.ts` ("offers Edit availability only with User.Manage"), `profile-availability.spec.ts`; **this review** section 5 (UI and API for all personas, s12 and s13). |
| Time-zone correctness of the 7-day completed window | `SwimlaneApiTests.The_completed_window_starts_at_local_midnight_in_the_viewers_zone`, fixed-clock tests in `DashboardRulesTests`, `DashboardPeriodsTests`; **this review** 4.3. |
| Time-zone correctness of availability states | `UserAvailabilityEvaluatorTests` (DST, zones, midnight edges); **this review** 4.1 and 4.2 (five new cases, UXR5-06, and the cross-surface check). |
| Auto-refresh behaviour | `dashboard-shell.spec.ts` (five-minute timer, stale banner), `dash-stale.spec.ts`; **this review** 4.4 (a change of availability after the refresh). |
| Regressions in Summary, Breakdowns, Trends | `docs/ux/dashboard-review-2/README.md`, `docs/qa/dashboard-final-pass-2026-10-17/report.md`, `dashboard-consistency.spec.ts`, `dashboard-breakdowns.spec.ts`, `dashboard-trends-types.spec.ts`; the `dashboard-shell` and `dashboard-permissions` specs ran again here. |
| Full Playwright suite twice, backend integration tests for touched modules | `docs/qa/full-pass-2026-10-16/report.md` and `docs/qa/dashboard-final-pass-2026-10-17/report.md` (full backend and e2e, one repeated e2e run); the specs touched here were run on a fresh database for this review (section 9). |
| Output `docs/ux/review-round-5.md`, fix Medium+ findings | This document; fixes in `b387b2e`. |
| Update docs (architecture, ERD, UX spec, runbook note) | UXR5-14 (the commit that adds this file). |

## 9. What was run

Fresh database (SQL Server in Docker, the published API, Dev auth), Chromium, axe-core 4.10.2, on a machine shared with other test runs (load average 10 to 35).

| What | Result |
|---|---|
| Backend unit tests (all) | 1593 passed (1588 before this review; five new evaluator cases) |
| Backend integration tests for the touched modules (`UserAvailability*`, `SwimlaneApiTests`, workload and users) | 39 passed |
| `dotnet format --verify-no-changes` on the touched files; `dotnet build` | clean |
| eslint (src and e2e), prettier, `tsc` (app, spec, e2e), `ng build` (inside the publish) | clean |
| Frontend unit specs touched (`dash-tabs`, `users-page`, `set-out-of-office-dialog`, `availability-*`, `user-menu`, `app-shell`) | 78 passed |
| Playwright: `review-round-5` (8 regression tests), `profile-availability`, `users-tab`, `users-capacity`, `swimlane`, `swimlane-board`, `swimlane-phone`, `dashboard-shell`, `dashboard-permissions`, `assignment-and-views` | 139 passed, 4 skipped (screenshot captures), 0 failed |
| Walk 1 (before) and a second sweep on the fixed build: 124 and 144 states of persona x width x screen with axe, overflow, console and API errors | before: 2 distinct axe hits; after: 0 axe violations, 0 overflow, 0 console or API errors |

Notes. On the first run on the shared machine five `swimlane-board` tests timed out waiting for the board (load average above 30); alone and later they passed (the final run above), so they were load, not regressions. The full Playwright suite was not re-run: the full passes of 2026-10-16 and 2026-10-17 (`docs/qa/`) stand, and the code changed here is limited to the files named in the findings. The screenshot captures (`E2E_SCREENSHOTS=docs/ux/review-round-5 frontend/e2e/run-local.sh -g "review round 5 screenshots"`) were taken on the build before UXR5-15, which changes no pixel.

