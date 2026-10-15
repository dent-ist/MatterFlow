# Dashboard round 3 (tabs): independent UX and QA review

Reviewer: independent UX/QA agent, branch `dev` at 4daa3d1 (tabs) on top of b2d3c02 (removals), run 2026-10-15 (server clock 04:4x UTC, so 00:4x in New York).
Screenshots: `docs/ux/dashboard-review-round-3/screenshots/` (20 files, referenced as `NN`).

## 1. Verdict

**Ship. No Blocker, Critical or Major defects in the tabs, the removals, the numbers or the accessibility; one product-level gap (ASAP work) deserves a decision before the next release.**

- The tab list is a correct WAI-ARIA tabs implementation (roles, roving tabindex, Left/Right wrap, Home/End, one labelled panel, focus stays on the tab). `?tab=` sync, deep links, invalid values, remembered tab and blocked storage all behave.
- Nothing from the removed sections is left: no Open by Pod, Your work or recent lists in the UI, the API payload (`byPod`, `mine`, `recentlyCreated`, `recentlyCompleted` are gone; payload is now 4.7 KB), the console or the network log.
- Every count, bar, segment, legend and per-day link agrees with its queue: 900 API checks (4 users, 3 time zones, 3 periods, 25 figures each) and 81 UI links followed to the Task Queue, 0 mismatches. Chips are correct and readable.
- axe wcag2a/2aa/21aa: 0 violations on all tabs, table views, dark theme, limited views and the failed-refresh state; 1 serious state (empty assignee menu, DASH3-05).
- Playwright e2e 93 passed; WorkViews integration 70 passed.
- The weak spots are product and polish: ASAP work is invisible in "what needs attention" (DASH3-01), tabs add no history entries and the last tab is reopened on every visit (DASH3-02, 03), the period control's scope is unclear (DASH3-06), and the 375 px layout clips the third tab (DASH3-08).

Counts: 0 Blocker, 0 Critical, 1 Major, 7 Minor, 7 Cosmetic (15 findings).

**Does Summary answer "what needs attention"?** Yes for overdue, unassigned and on hold: three large tiles, red/black/amber edges, one click to the queue, and the three lists below give the first actions (01). It does not for ASAP (DASH3-01). Scan order is good (Needs attention, then Overview, then lists). The Overview row is quiet and subordinate, as intended. Breakdowns and Trends are calm and accurate but are reference views.

## 2. Test setup

- Real stack: SQL Server 2022 container on a spare port (14343), published API (Dev auth, `Seed__StarterConfiguration__Enabled=true`, `Hosting__ServeSpa=true`, one origin on :5080, built by `deploy/publish.sh` from the current tree), Chromium via Playwright, `@axe-core/playwright`. I used the published build instead of `ng serve` so the tested artifact is the shipped one.
- Data: 413 tasks, 10 pods, 15 task types (skewed so Top 5 + Other applies), 4 priorities, ages 0 to 45 days, 94 completed over 35 days, 23 on hold, 79 unassigned open, 88 ASAP open, 43 overdue (1 to 21 days), 32 due soon, boundary tasks due Oct 13 to 17, one 170-character title. Pod members were added after the first run (see DASH3-05). Seeded timestamps in the future were corrected before measuring (otherwise Auckland and Los Angeles totals differ by design of the seed, not the product).
- Personas: Director (Dana), Project Manager (Priya), Pod Lead (Marcus), "Dept Read Only" (Task.View + Dashboard.ViewDepartment, no Task.Assign: Rita), Data Technician with Task.Assign (Jamal), technician role without Task.Assign (Tom), Task Viewer (Vera, read-only), technician with no tasks (Nina).
- Time zones: America/New_York, Pacific/Auckland, America/Los_Angeles.

## 3. Findings

Severity: Major = a user can be misled or a requirement is missed; Minor = friction or inconsistency; Cosmetic = polish. Effort: S under half a day, M 1 to 2 days, L more.

### Major

**DASH3-01 ASAP work is not part of "what needs attention"** (01)
88 of 313 open tasks (28 percent) are ASAP. They are in no Needs attention tile and in none of the three lists: Overdue and Due soon both exclude ASAP ("Excludes ASAP tasks", "Next 2 days, excludes ASAP"), and the Unassigned queue only holds the unassigned ones. The only trace is a quiet outlined tile in the Overview row ("ASAP open 88"). For a Director, the most urgent work has the least visibility on the page that is meant to surface urgency, and an assigned ASAP task that nobody touches never appears.
Recommendation: either promote ASAP open to the Needs attention row (four tiles; keep the blue ASAP tone) or add an "ASAP" list beside Overdue and Due soon; at minimum link the Overdue/Due soon captions to it. Product decision, see section 6.
Effort: S (tile), M (list).

### Minor

**DASH3-02 Tabs do not create history entries; Back leaves the Dashboard**
`navigate(..., replaceUrl: true)`: after Summary, Breakdowns, Trends, Back goes to the previous page (measured: history length stays 2; Back went to the page before the Dashboard). Following a tile to the queue and pressing Back does return to the right tab (`?tab=` is kept), which is good. Replace is a defensible choice for automatic activation (WAI does not require history), but the brief expected back/forward to work and people do press Back to undo a tab switch.
Recommendation: push history entries for user-initiated tab changes, replace only for the normalising redirect (missing or invalid `?tab=`). Effort: S.

**DASH3-03 The remembered tab overrides the default for every visit and for shared links without `?tab=`**
`localStorage` remembers the last tab and is used whenever the address has none: after one visit to Trends, the sidebar "Dashboard" link opens Trends (`/dashboard` to `/dashboard?tab=trends`), as does any link a colleague shares as `/dashboard`. The one tab that answers "what needs attention" is then hidden behind a click until the user remembers. Invalid values (`?tab=foo`, `TRENDS`, `trends%20`) correctly fall back, to the remembered tab (to Summary if none).
Recommendation: open Summary unless the address says otherwise (drop remembering, or remember only Breakdowns/Trends for the session). Effort: S. Question 3.

**DASH3-04 Focus is dropped to the page after a successful Retry in the failed-refresh banner**
Refresh fails: the banner appears, focus stays on Refresh (good). Press Retry in the banner and it succeeds: the banner (and the focused Retry) is removed and focus falls to `body` ("Skip to main content"), so a keyboard user restarts from the top. Same family as UAT2-03. The live region does announce "Dashboard refreshed" (good).
Recommendation: move focus to the Refresh button when the banner closes while it holds focus. Effort: S.

**DASH3-05 The inline assignee menu has a critical axe violation when it is empty** (17)
For a task whose pod has no members (or a search with no match) the popup is `role="menu"` containing only `<p role="status">No people found.</p>`: axe `aria-required-children`, critical. With members present the menu is clean (0 violations, arrow keys, Esc returns focus to the trigger). The empty state also gives the user no way forward except the small note "Showing members of Archive."
Recommendation: render the empty note outside the `role="menu"` element (or add a disabled `menuitem`), and offer "Assign to me" or "Search all people" hint when the pod has no members. Effort: S.

**DASH3-06 The period control's scope is unclear and its values are mixed**
(a) On Summary it sits in the Overview heading row, but it changes only Completed and Created (2 of 5 tiles); Open, Due soon and ASAP are not affected, and nothing says so. (b) The label "Created and completed in" is repeated on Trends where it is the right place. (c) The presets mix calendar and rolling windows ("This week", "This month" vs "Last 30 days", "Last quarter"), and the option reads "Last quarter" but the chart caption reads "Last quarter (90 days)". (d) The choice is in `localStorage`, not in the address: a link to Trends cannot carry its period, so two people see different numbers from the same link (tab does carry). Positive: it is absent from Breakdowns, and changing it does not reload the lists.
Recommendation: move the control next to the two tiles it affects or put "(Completed, Created)" in its label; align preset names with captions; consider `?period=`. Effort: S to M.

**DASH3-07 Users without the department view get an almost empty page with role-based copy**
Vera and Tom (no Dashboard.ViewDepartment, no Task.Assign) see the title and one sentence: "Department figures are available to Pod Leads and Directors. Your assigned tasks are in My Work." (10). The sentence names roles although access is by permission (Rita is a custom "Dept Read Only" role, Marcus a Pod Lead; a custom role with the permission is neither). With Task.Assign (Jamal, Nina) the page is only the organisation-wide Unassigned queue, which is a different job than the heading "Dashboard" suggests (09). The API also answers `GET /dashboard` with 200 and an all-zero payload for these users (UI correctly does not call it) instead of 403 or a flag, which is a trap for any other client.
Recommendation: say "Department figures need the Dashboard.ViewDepartment permission. Ask a Pod Lead or Director if you need them" (or hide the Dashboard nav item when there is nothing to show); return 403 from the API. Effort: S.

**DASH3-08 At 375 px the third tab is clipped and keyboard focus does not scroll it into view** (12, 13)
The shell's sidebar rail takes about 50 px, the tab list is 271 px wide and "Trends" is cut off ("Trend") with no affordance that it scrolls. After End, the focused Trends tab sits at x 298 to 378 of a 375 px viewport and `scrollLeft` stays 0, so the selected tab is partly off screen. Tiles at 375 are 2 columns, leaving Created alone on the last row.
Recommendation: scroll the focused/selected tab into view (`scrollIntoView({inline:'nearest'})`), or let the three tabs share the width below 480 px; show a fade at the clipped edge. Effort: S.

### Cosmetic

**DASH3-09 Text links and small buttons are 16 to 17 px tall**
"Assign to me" (80x16), "View as table" (82x16), list title links (17), legend links on Trends. Fine for WCAG 2.1 (axe clean) but under the 24 px minimum of WCAG 2.2 SC 2.5.8 (Target Size) and hard to hit on a phone. Effort: S.

**DASH3-10 Layout leaves unused space on wide screens** (02, 03)
At 1280 the Trends chart is about 430 px wide inside a 1010 px card (the rest is empty), and the Breakdowns two-column grid leaves a gap under the short priority card next to the tall task-type card. Effort: S.

**DASH3-11 Headings repeat themselves**
Breakdowns: H2 "Open tasks by" followed by H3 "Open by priority", "Open by task type"; Trends: H2 "Created and completed", period label "Created and completed in", H3 "Tasks created and completed per day". Screen reader heading navigation reads three near-identical stops. Effort: S.

**DASH3-12 Status labels are Title Case against the sentence-case rule** (02)
"On Hold", "In Progress" in the status breakdown and in chips ("Status: On Hold") while the tile says "On hold" (the code already maps "No Pod", "Other Task Types" but the status labels come from the API/lookup as Title Case). Effort: S.

**DASH3-13 First-load failure says it twice**
The inline alert ("The dashboard could not be loaded. Retry") plus a toast "Something went wrong. Try again." (06). With the error the tabs disappear, so a deep link to Trends shows no context. Effort: S.

**DASH3-14 After Undo, focus lands on the toast's Close button and the news is announced twice**
Assign to me then Undo: the task returns to the queue, focus is on "Close" of the toast, not the restored row. The assignment is announced by the page live region ("TSK-97 assigned to Dana Whitfield and removed from the Unassigned queue. 78 unassigned tasks left.") and again by the toast ("TSK-97 assigned to Dana Whitfield. Task moved to In Progress. Undo puts the assignee back; the status stays.") (04). The toast text also reveals that Assign changes status and Undo does not revert it: a task can end up In Progress and unassigned. Effort: S (focus, one announcement), product question 5.

**DASH3-15 Back from the Task Queue puts focus on the page, not on the tile used**
Tile, then Back: the Summary tab is correct, but `document.activeElement` is `body` ("Skip to main content"). Same family as DASH3-04 and UAT2-03. Effort: S.

## 4. Verified good (no finding)

- **Tabs**: `role=tablist` "Dashboard views", `role=tab` with `aria-selected`, roving tabindex (selected tab 0, others -1), `aria-controls` only on the selected tab (only its panel exists), one `role=tabpanel` labelled by the tab; Left/Right wrap, Home/End, automatic activation, focus remains on the tab; Tab moves into the panel (first control). Click and keyboard behave the same.
- **URL**: missing `?tab=` is added (`replace`), deep links to each tab work, invalid values fall back, duplicate `tab=` is tolerated, other parameters are kept, reload keeps the tab. Storage blocked (`localStorage` throws): page works, tabs work.
- **Requests**: first load = 1 dashboard + 3 Task Queue reads (8 API calls in all with the shell's `/me`, lookups, `users/counts`). Switching tabs = 0 requests. Auto-refresh (5 min, fake clock) on Breakdowns = 1 request (summary only); on Summary = summary + 3 lists; active tab, scroll position (300 px) and focused list link unchanged; coming back to Summary after a refresh elsewhere reads the lists once. After an inline assign: assign POST, then 1 summary + 3 lists after the 700 ms debounce.
- **Inline assign + Undo**: tile 79 to 78 at once, row leaves, focus moves to the next row, server number confirms, Undo restores 79 and the row. Menu closes with Esc and focus returns to its trigger. Auto-refresh does not run while a menu is open.
- **Failed refresh**: banner "The dashboard could not be refreshed. Showing the figures from ..." with Retry, figures kept, focus kept on Refresh (05). First-load failure shows the error with Retry.
- **Removed content**: UI text, payload keys, console and requests contain none of it; the Task Queue presets "Recently completed" are a different, intended feature.
- **Numbers**: see verdict. Per-day trend links equal the table cells; aging buckets and the three breakdowns sum to Open (313) in every zone; trend sums equal Created/Completed.
- **Hierarchy and copy**: H1 Dashboard, H2 per block, H3 per card; sentence case except DASH3-12; captions explain exclusions ("Excludes ASAP tasks"); chips are readable ("Overdue only", "Assignee: Unassigned", "Due: until Oct 17, 2026 / Has a due date / Not overdue", "Created: Oct 13, 2026 to Oct 15, 2026"); "Other task types" shows 10 type chips (long but correct).
- **Permission states**: Director, Pod Lead, PM and the department read-only user see three tabs; the unassigned queue (with assign controls) only with Task.Assign (Rita sees Overdue and Due soon only); no summary request for users without the department view. Nina (no tasks) is not shown a misleading "no tasks" state.
- **Dark theme**: 0 axe violations, readable (18).
- **Pattern standard (`ux-review-round-1.md` s2)**: sentence case headings, tile and chip patterns, link-to-queue contract, error/empty/loading states, live regions and focus return follow it, apart from the items above.

## 5. Test results

### Accessibility (axe wcag2a, wcag2aa, wcag21aa)

| State | Violations |
|---|---|
| Director: Summary, Breakdowns, Trends, and the "View as table" state of Breakdowns and Trends | 0 |
| Dark theme: 3 tabs | 0 |
| Failed-refresh banner | 0 |
| Limited views: Jamal (queue), Vera (note only), Rita (3 tabs) | 0 |
| Assignee menu open, pod with no members | 1 critical `aria-required-children` (DASH3-05) |
| Assignee menu open, pod with members | 0 |

`color-contrast` is reported only as "incomplete" (needs review) on every page, as in earlier rounds; the chart colours have a contrast unit test.

### Console and network
Zero console errors or warnings and no 4xx/5xx in normal use (only the failures I injected). No page errors.

### Layout (1280, 1024, 768, 375)
No horizontal page overflow on any tab (`scrollWidth` equals viewport), tab list scrolls inside itself at 375 only (DASH3-08). 1024 and 768 reflow tiles and lists cleanly (15, 16).

### Suites
- `frontend/e2e/run-local.sh` (fresh stack, published build): **93 passed**, 0 failed, 0 flaky (1.5 min).
- WorkViews integration tests (`dotnet test --filter FullyQualifiedName~WorkViews`): **70 passed**, 0 failed.
- Not rerun here: unit, architecture and frontend unit suites (reported green in section 11 of `dashboard-review.md`).

### Not covered by automation
Spec 11 says no axe run exists in the e2e suite; still true. I added none (scratch scripts only, in the session scratchpad).

## 6. Open questions for the product owner

1. ASAP (DASH3-01): should ASAP open be a "needs attention" figure and have its own list?
2. Should Back step through tabs (DASH3-02)? Either answer is defensible; it should be a decision.
3. Should the Dashboard always open on Summary (DASH3-03)?
4. Is the period meant to affect only Completed, Created and Trends? If so, should it move next to them (DASH3-06)?
5. Should "Assign to me" move a task to In Progress, and should Undo revert the status (DASH3-14)?
6. The empty state ("No open tasks, and none were created or completed in this period." plus "Create the first task") is period based and replaces all tabs. With the "This week" period on a quiet system, a department with years of history sees "Create the first task" and loses Breakdowns and Trends (verified with a mocked all-zero response; the logic is `open + created + completed == 0`). Is that intended, or should it only apply when there has never been a task?
7. The unassigned queue for technicians is still organisation wide (known, deferred in section 11): confirm it should be limited to their pods.

## 7. Cleanup

The API, the SQL Server containers (`dash3-sql`, and the e2e script's own) and the e2e stack were stopped. `dockerd`, which I started, was stopped too. Scratch scripts and screenshots: `/tmp/claude-0/-home-user-MatterFlow/ac891d55-a228-5712-8916-fb387c7f73c4/scratchpad/d3/`.
