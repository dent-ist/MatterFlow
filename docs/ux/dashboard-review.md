# Dashboard v2: independent UX and QA review

Reviewer: independent UX/QA agent, branch `dev`, commits d26b3d8 (backend) and e90dcb0 (frontend), run on 2026-10-15 (server clock 2026-10-15 02:xx UTC, so it was still Oct 14 in New York and Los Angeles and already Oct 15 in Auckland, which made the time zone checks meaningful).
Screenshots: `docs/ux/dashboard-review/screenshots/` (20 files, referenced below as `NN-name`).

## 1. Verdict

**Ship with fixes: the numbers are right, the experience has gaps.** Every count, bar, segment, legend and trend link I followed landed on the right filtered Task Queue with the same total (39 links per user per time zone per period, 0 mismatches, also with 3,848 tasks). Time zone handling, period presets, collapse persistence, auto-refresh, the failed-refresh notice, empty and error states, charts and axe all work. The weak spots are (a) the technician and read-only dashboards, which do not answer "what needs attention" for the person who has the most overdue work in their hands, (b) focus being lost after the keyboard actions the page invites (Assign to me, Refresh), (c) the Unassigned queue header count and rows disagreeing with the tile after an inline assign, (d) several name-versus-label and colour-semantic inconsistencies with the pattern standard.

Counts: 0 Blocker, 0 Critical, 4 Major, 9 Minor, 7 Cosmetic (20 findings).

Does the page answer "what needs attention"? For Pod Lead, Director and admin: yes. Row 1 (Overdue 33, Unassigned 63, On hold 26, ASAP open 71) is scannable in under two seconds, the three lists below it give the first actions, and everything is one click from the queue (01). For a technician: only partly (DASH-01).

## 2. Test setup

- Real stack: SQL Server 2022 container, API (Dev auth, starter configuration seed) on :5080, `ng serve --configuration api` on :4200, Chromium via Playwright, `@axe-core/playwright` (wcag2a, wcag2aa, wcag21aa).
- Data: 3,848 tasks across 10 pods, 15 task types (skewed so Top 5 + Other applies), 4 priorities, ages 0 to 60 days, 870 completed over 35 days, 215 on hold, about 90 unassigned in the first 350 and 60 percent more in the bulk set, overdue 1 to 20 days, due-soon, ASAP, 8 boundary tasks due Oct 13, 14, 15, 16. UI testing used the first 348 tasks (so lists and charts are readable), performance used all 3,848.
- Personas: Director (Dana) and Pod Lead (Marcus) with `Dashboard.ViewDepartment`; Data Technician (Jamal) without it; Data Technician with no assigned tasks (Nina); "Task Viewer" (Task.View, Matter.View, Client.View, Pod.View only); a department read-only role (Task.View plus `Dashboard.ViewDepartment`, no Task.Assign).
- Time zones: America/New_York, America/Los_Angeles, Pacific/Auckland (browser time zone and `X-Time-Zone` header both checked).

## 3. Findings

Severity: Major = a user can be misled or blocked or a requirement is missed; Minor = friction or inconsistency; Cosmetic = polish. Effort: S under half a day, M 1 to 2 days, L more.

### Major

**DASH-01 Technician and read-only dashboards show four counts and nothing to act on** (05, 06)
A technician (no `Dashboard.ViewDepartment`) sees only "Your work": 56 open, 10 overdue, 11 due soon. There is no list of their overdue or due-soon tasks, even though the department view has exactly those lists. The result is a page that says "10 overdue" and asks for a click, a blank 70 percent of the viewport, and a "Created and completed" period control plus "Created by me" tile that matter to nobody in that role. For a user with zero tasks (06) the period control and Refresh do nothing useful. The persona in the spec (Tariq: "see my work, most urgent first") is better served by My Work than by this page.
Recommendation: for users without the department view, reuse the same list component for "My overdue" and "My due soon" (assignee = me), hide the period control unless a visible tile uses it, and consider showing the Unassigned queue of the user's own pods to people with Task.Assign (that is how a technician picks up work, spec JTBD 3). Question for product in section 6.
Effort: M.

**DASH-02 Focus is lost after "Assign to me" and after Refresh** 
Keyboard test on the Unassigned queue: Tab to "Assign TSK-299 to me", Enter. The button disappears (row re-renders to the assignee name) and `document.activeElement` becomes `body`; the next Tab happens to continue at TSK-86 because of the browser sequential starting point, but a screen reader or a Shift+Tab user lands on "Skip to main content". Same on the Refresh button: it is disabled while refreshing, so a keyboard user who presses Refresh loses focus to `body`. This is the same defect class as UAT2-03 and affects the two main actions of the page. The toast announces the assignment (live region), which is good, but its Undo is far away in tab order from the row.
Recommendation: on assign move focus to the row's assignee menu button (or the row link); use `aria-disabled` plus a busy label on Refresh instead of `disabled`; make the Undo reachable (focus it, or give the row a visible "Undo" while the toast is up).
Effort: S.

**DASH-03 After an inline assign the Unassigned queue contradicts the tile** (07)
After "Assign to me" (and a 700 ms delay) the "Unassigned" tile drops from 63 to 62, but the queue header still reads 63, the footer still reads "Showing 8 of 63", and the assigned row stays in the list showing the new assignee, in a list titled "Unassigned queue". Only the Refresh button (or the 5-minute refresh) removes the row and fixes the count. Undo restores everything correctly (tile back to 63, row "Unassigned").
Recommendation: decrement the panel total at once, and either fade the row out after the Undo window or keep it visibly marked ("Assigned to you. Undo") and remove it after the toast closes. If rows are to stay, change the list heading count to the tile's number.
Effort: S to M.

**DASH-04 Accessible names do not contain the visible text (WCAG 2.5.3 Label in Name)**
Every tile link reads "Overdue: 33. View these tasks in the Task Queue." for speech but shows "View overdue tasks". "Assign to me" is announced "Assign TSK-299 to me" (the visible text "Assign to me" is not a substring), and the assignee menu is "Change assignee of TSK-11, currently unassigned" while the visible text is "Unassigned". Voice-control users who say "click View overdue tasks" or "click Assign to me" fail. axe does not flag it (it is an experimental rule), so the clean axe result hides it.
Recommendation: start the accessible name with the visible text ("View overdue tasks, 33", "Assign to me, TSK-299", "Unassigned, change assignee of TSK-299").
Effort: S.

### Minor

**DASH-05 Colour meaning contradicts the pattern standard** (01, 14)
ux-spec section 4/5: ASAP is a blue outlined pill, never red or warning; "On hold" and "Due soon" use the warning amber (`--mf-warning #8A4B00`). On the Dashboard the ASAP tile is amber with a bolt (warning look) and the On hold tile is blue (info), the reverse of the standard, and On hold is amber in the status bar chart and in every badge. Together with "Unassigned" also amber, two of the four attention tiles share the ASAP colour and the legend of the page does not explain colour.
Recommendation: On hold tile = warning amber like its badge and bar; ASAP tile = the ASAP blue outline treatment; Unassigned a neutral or distinct attention tone. Effort: S.

**DASH-06 "Needs attention" gives ASAP the same weight as Overdue** (01)
71 ASAP-open tasks (no due date) are shown in the same loud row as 33 overdue. The spec says ASAP is never overdue and is deliberately not red; at 26 percent of open tasks it will always shout. Product call (section 6), but at least visually separate "at risk" (Overdue, Unassigned, On hold) from "informational" (ASAP). Effort: S.

**DASH-07 The Unassigned queue is ordered oldest first, not by priority** (01)
Sorted by `created asc` so the eight shown are all 36 to 43 days old; a Critical task created yesterday is not visible while a Low task from 43 days ago is first (row 1 is Low, row 2 Critical). The Task Queue default order is Priority, then ASAP, then due. The panel's "View all" link carries `sort=created&dir=asc` so the queue view disagrees with the default order of the queue everywhere else.
Recommendation: sort Priority then age, or show a "Critical and High first" toggle; state the order in the panel header ("Oldest first"). Effort: S.

**DASH-08 No hover or focus values on the trend chart; no "today" or weekend cue** (15)
The line chart is `aria-hidden`, has no tooltip on hover or point focus, a y axis of 0/25/50, and x labels of three dates. The only way to read a day's value is "View as table" (which works well and links each day to a day-filtered queue, 16). Sighted mouse users cannot get a value from the chart itself. Also the last point is "today" (partial day) drawn like the others, which looks like a jump (my seeded data exaggerates it, but real data will show the same dip or spike every evening).
Recommendation: tooltip and keyboard-focusable points (or a vertical hover rule with a readout), mark today as partial. Effort: M.

**DASH-09 Age segments use a traffic-light scale that implies an SLA and are not an ordered scale** (14)
Green, blue, brown, red for 0-2, 3-7, 8-14, 15+ days. Blue in the middle breaks the green-to-red order, red and green side by side is a common colour-blindness pair (numbers inside the segments and the legend rescue it, so not a WCAG failure), and the note says "Informational, not a service-level target". A single-hue sequential ramp (light to dark) says "older" without saying "bad". Contrast is fine (6.0 to 7.4:1 against the card). Effort: S.

**DASH-10 "No pod" row cannot be clicked; "Other" rows only partly** (14, 17)
"No pod" (35 tasks, 13 percent) is the only breakdown row without a link (the queue has no "no pod" filter). It looks like the other rows apart from the missing link underline, and it is the row a Pod Lead most needs to act on (work nobody owns). "Other pods" and "Other task types" do link, and the counts match (9 and 50).
Recommendation: add `pod=none` to the queue, or style the unlinked row as plain text with a tooltip. Effort: S (frontend only) or M (with queue filter).

**DASH-11 Menu opens upward over the tiles; trigger has weak affordance** (08)
The assignee menu for TSK-299 (trigger at y=742) opened above the trigger at y=470 to 607, covering the Overview tiles and far from the pointer; the "Unassigned v" trigger looks like text. The menu lists only members of the task's pod (Elena, Jamal, Marcus) without Dana or Priya, with no hint why (known as UAT2-13). Effort: S.

**DASH-12 Failed refresh: banner only at the top plus a generic toast** (09)
When the background refresh fails the amber banner appears at the top of the page ("The dashboard could not be refreshed. Showing the figures from ...") and a red toast "Something went wrong. Try again." appears at the bottom right. A user scrolled to the lists sees only the toast. The banner is correct (`role="status"`, old figures stay, no layout reset), but duplicate messaging is noisy, and the "Updated" timestamp in the header is the only persistent cue. Recommendation: suppress the generic toast for the background refresh and add a Retry button to the banner. Effort: S.

**DASH-13 Keyboard cost: 33 tab stops through the Unassigned queue** 
There are 17 sidebar stops before the page controls, then each unassigned row has 4 stops (task link, matter link, assignee menu, Assign to me), so reaching the Overdue list needs 32 more. There is no "skip list" link and the section has no landmark shortcut beyond headings. Recommendation: make the matter reference a non-link inside lists (or `tabindex=-1`), and offer "Skip to Overdue" or collapse lists by default for keyboard users. Effort: S.

### Cosmetic

**DASH-14 Zero-count tiles are still links, and "Created by me" says only "View"** (05)
"Created by me 0" links to a queue that says "No tasks" and its link text is the bare word "View". Other tiles say "View ... tasks". Render zero-count tiles without a link (or with "No tasks to view"). Effort: S.

**DASH-15 Chip wording differs from the dashboard** 
The Completed tile (caption "Last 30 days") opens a queue with chip "Closed: from Sep 15, 2026", the single-day trend link gives "Created: Sep 15, 2026 to Sep 15, 2026" (redundant range), and status chips are Title Case ("Status: On Hold") while the page uses sentence case "On hold". Consider "Completed: from ..." and "Created: Sep 15, 2026". Effort: S.

**DASH-16 Layout gaps at 768 and 375** (03, 04)
At 768 the three list panels wrap 2 plus 1, leaving "Due soon" alone and half a row empty; at 1280 the priority card has about 100 px of empty space under four rows because it shares a row with the 10-row pod card. At 375 the eight tiles of the first screen are stacked in one column (about 1,100 px before the first list), and the header search shrinks to "Search clier". No horizontal overflow at any width (scrollWidth = viewport at 1280, 1024, 768, 375). Recommendation: two-column tiles at 375, list panels in a horizontally balanced layout (or let Unassigned span two columns at 768). Effort: S to M.

**DASH-17 Period control is far from what it controls** (12)
"Created and completed: Last 30 days" sits in the page header but affects only two tiles, the trend and "Created by me", while the other 10 tiles are unaffected; the trend caption has to say "The period control at the top applies to this chart." Move the control into the Overview row or the trend card, or label it "Created and completed in". "This week" is Monday to today and "This month" is the 1st to today (3 and 14 days on Oct 14), which is clear from the caption but not from the option labels. Effort: S.

**DASH-18 Date wording in Due soon** (01)
Dates read "Oct 14, 2026" without "Today" or "Tomorrow" for tasks due within 2 days. The pattern standard uses full dates, but for a "due soon" list a relative cue is more scannable. Effort: S.

**DASH-19 Bars scale to share, so the longest bar is 27 percent of the track** (14)
Because bar length is the share of all open tasks, Processing (the largest pod) fills 27 percent of the track and the whole pod chart looks empty and low contrast between rows. Priority "Normal" and "Low" bars are a pale fill with a dark outline (consistent with the badges, 7:1 text but weak as a bar). Scaling to the largest row with the share printed as text would use the space better. Effort: S.

**DASH-20 Truncated labels** (14)
"General / Ad Hoc Requ..." is truncated with only a `title` attribute (not available to touch or keyboard). Allow two lines or widen the label column. Effort: S.

## 4. Verified good (no finding)

- **Counts and links**: for Director and Pod Lead, 3 time zones and periods of 7, 30 and 90 days, all 39 numbers (8 headline, status, priority, pod, task type and age bands, 4 "mine" numbers) equal the Task Queue total for the query the page links to; trend totals equal the Created and Completed counts exactly. In the browser, 47 links (tiles, bars, legends, segments, "View all", trend legend) land on `/tasks?...` with the matching total and chips ("Overdue only", "Assignee: Unassigned", "ASAP only", "Due: until Oct 16, 2026" plus "Has a due date" plus "Not overdue", "Pod: Hosting", "Pod: Client Services" for the Other pods link, ten "Type:" chips for Other task types).
- **Overdue and time zones**: tasks due Oct 14 are not overdue in New York or Los Angeles at 10 pm (shown in Due soon) and are "Overdue 1d" in Auckland; overdue tile 33 in the Americas and 40 in Auckland, list and queue agree, the browser sends `X-Time-Zone`, "Updated" shows EDT, PDT and GMT+13 (18).
- **Period presets**: This week (3 days), This month (14), Last 30 days, Last quarter (90) send the right `periodDays`, captions and chart follow; the choice survives reload.
- **Collapse**: 5 sections collapse with `aria-expanded`, focus stays on the toggle, survives reload (`mf.dashboard.v2.<userId>` in localStorage), and the page works with localStorage throwing. Needs attention and the Overview row cannot collapse (by design).
- **Auto-refresh (fake clock, 5 minutes)**: no skeleton, scroll position (y=331) and focus (a task link) unchanged, no layout shift; a refresh is skipped while an assignee menu is open (the open menu kept its typed text "Je"); a failed refresh keeps the figures and shows the status banner (09); a manual Refresh after the server recovers clears it.
- **Inline assign**: "Assign to me" assigns, the toast says "TSK-11 assigned to Dana Whitfield. Task moved to In Progress. Undo puts the assignee back; the status stays.", Undo restores assignee and the tile (63 again); read-only users see plain "Unassigned" text with no controls (20).
- **Charts**: share percent shown; priority order Critical, High, Normal, Low with badge colours; status colours equal the status badges (New blue, In progress teal, On hold amber); Top 5 task types plus "Other task types"; Top 8 pods plus "Other pods"; all six charts have a working "View as table" with row links and a caption; colour is never the only carrier (numbers, icons on tiles, marker shapes and dashes on the trend lines, legend labels). Text contrast sweep of the main area found nothing under 4.5:1 (3:1 large); graphics 6.0 to 7.4:1.
- **Empty state** ("No tasks yet." plus "Create the first task" for users with Task.Create, 10), **load error** (message, error reference, Retry, 11), and no empty-state flash for users without the department view.
- **Pattern standard**: page header with H1 "Dashboard", buttons `mf-btn`, dates "Oct 14, 2026", priority and status badges the shared components, sentence-case headings.

## 5. Test results

### Accessibility (axe, wcag2a/2aa/21aa)
0 violations in all of: Director 1280, Director 375, assignee menu open, all six charts as tables, two sections collapsed, technician, user with no tasks, Task Viewer, Pod Lead, empty state, load error. Incomplete (needs review) results: colour contrast on sidebar labels (gradient background, not a Dashboard element), contrast on SVG text at 375 (checked by hand, see above), and `aria-controls="im-2-pop"` on the open menu trigger. Manual checks found DASH-02, DASH-04 and DASH-13, which axe cannot see. The app has no dark theme (the dark colour scheme renders the same light page).

### Console and network
No console errors or warnings and no failed requests in any normal run (all personas, all widths). The only errors were the ones I injected (500 or aborted dashboard calls).

### Performance (3,848 tasks, local SQL Server container, 12 calls each)
| Call | p50 | max | Notes |
|---|---|---|---|
| `/dashboard?fresh=true` Director, 30 days | 52 ms | 648 ms (first call, cold) | 11 KB |
| `/dashboard` cached (15 s server cache) | 5 ms | 6 ms | |
| `/dashboard?fresh=true` technician | 21 ms | 59 ms | 2.8 KB |
| 90 days / 365 days fresh | 34 / 32 ms | 47 / 35 ms | 14 / 27 KB |
| `/task-queue` unassigned (8), overdue (6) | 15 / 14 ms | 196 / 41 ms | |
| `/task-queue` overdue page of 50 | 17 ms | 64 ms | 55 KB |

No slow statement was visible at this size; I did not capture per-statement plans (query text lookup in the DMV did not return within the time box), so a statement-level profile at 50,000 tasks remains open. The repository's own `DashboardPerformanceTests` (5,000 tasks, command log) is part of the integration run below. Note the per-user dashboard rate limit is 60 per minute; one page load makes 1 dashboard call and 3 queue calls, so the page itself is far below it, but a user dragging the period select repeatedly (each change is a fresh call) uses it up quickly.

### WorkViews integration tests
`dotnet test backend/tests/MatterFlow.IntegrationTests --filter FullyQualifiedName~WorkViews`: **70 passed, 0 failed, 0 skipped** (1 m 41 s), including `DashboardApiTests`, `DashboardCacheTests` and `DashboardPerformanceTests`.

### Playwright end-to-end suite (`frontend/e2e/run-local.sh`)
Full run: **87 passed, 2 failed** (1.4 min). The 4 `dashboard-audit.spec.ts` tests all passed. The two failures are not Dashboard related and did not reproduce: `task-lifecycle.spec.ts` "On Hold needs a reason..." failed in test setup with `POST /api/v1/tasks -> 429 TOO_MANY_REQUESTS` (the per-user task-write budget of 120 per minute is exhausted when the suite runs in parallel as one user), and `workflow-version.spec.ts` SCN-014 failed with `POST /api/v1/workflows/{id}/versions -> 409 CONCURRENCY_CONFLICT`. Re-running both spec files alone: **10 passed, 0 failed**. Recommendation: treat as suite flakiness (raise `RateLimits__TaskWritesPerMinute` in `run-local.sh` and retry the version POST), not as a regression.

The existing e2e specs do not cover what this review found: focus after Assign to me, the panel count after an inline assign (DASH-03), or the technician list (DASH-01).

## 6. Open questions for the product owner

1. Should technicians get lists (my overdue, my due soon, and the Unassigned queue of their pods) on the Dashboard, or is My Work the intended place (DASH-01)? Today they have Task.Assign but cannot see the Unassigned queue.
2. Is "ASAP open" an attention item or an overview item (DASH-06)?
3. Should the Unassigned queue be ordered by age (as built) or priority first like the rest of the product (DASH-07)? Should an assigned row leave the list at once or after Undo (DASH-03)?
4. Does "No pod" need a queue filter (DASH-10)?
5. Should assigning from a list change the status to In Progress? The toast explains it, but a Pod Lead assigning 20 tasks to others silently starts 20 tasks.
6. Is a 5-minute auto-refresh acceptable with the 60 per minute dashboard rate limit if several tabs are open (each tab refreshes independently)?

## 7. Cleanup

API, `ng serve` and the SQL Server container started for this review were stopped; scratch scripts and screenshots remain in the session scratchpad.
