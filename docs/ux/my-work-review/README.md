# My Work: independent UX review (all four tabs)

Scope: the **My Work** page (`/my-work`) and every tab on it (Active, Due soon, Completed, Created by me), as shipped on `origin/dev` at `1af5c34`. Reviewed as a senior UX designer and front-end reviewer. **No application code was changed.** Everything below was observed in the real stack (the published API with Dev auth, SQL Server, the production Angular build) driven with Playwright Chromium, plus a read of `frontend/src/app/features/my-work`, `shared/work-queue/*`, `shared/filters/*`, the API (`TaskQueueService.MyWorkAsync`) and the earlier UX documents.

Screenshots are in `screenshots/` (54 PNGs, `<name>-<width>x<height>.png`; 1366x768 unless the name says otherwise; 1920x1080, 768x1024 and 375x812 where it matters). The tab counts differ between a few screenshots because I changed data while testing (assigning tasks, cancelling one inline); the text says when that matters.

**Test data.** About 570 tasks over 15 named people (Data Technicians, Data Scientist, two Pod Leads, a Director, a Project Manager, an Intake Coordinator, a Read-Only Observer, a user with `Task.View` only, a user with no roles), 3 pods, 12 clients, 36 matters, 5 task types, all statuses and priorities, overdue / due today / tomorrow / future / ASAP, on hold with reasons, 100+ completed over the last 90 days and 14 older, comments on some tasks. The main persona is Tariq (Data Technician, Pods A and B): 70 to 79 active tasks, 9 overdue, 21 due soon, 14 ASAP, 86 closed in 90 days, 26 created by him. A second technician has 213 active tasks (list-size and speed checks); one has 3 (near-empty state); one has none (empty states).

Ranking key: **severity** blocker / major / minor / nit; **effort** S (hours to a day), M (a few days), L (a week or more).

---

## 1. Executive summary

My Work is in good shape on the things that are hard to retrofit: one grid pattern shared with Task Queue and Pod Work, URL-synced state, honest counts (I checked 16 filter combinations for three users: every tab count equals the grid total of that tab, and equals the Task Queue for the same person), non-colour cues for priority, status and due, a sticky header that works, 0 axe violations (WCAG 2.2 AA plus best-practice) on all four tabs at 1366, 375 and 1920, and API answers in 30 to 60 ms even with 213 active tasks. The weaknesses are not polish; they are about **what a technician sees in the first five seconds, a few tab-specific column gaps, vertical space, the phone, and a handful of real bugs**.

What a technician needs in the first five seconds is "what is overdue, what is due today, what is next". Today the answer is buried: the default order is priority first (decided, addendum G), so an overdue Normal task sits below every Critical task, and nothing on the page counts or names overdue, due today or ASAP. The grid then gives away 36 percent of the 768 px screen to chrome before the first row, and wraps titles to two lines, so a Data Technician at 1366x768 sees **6 rows**. On a phone the three most important columns (Priority, Due, Status) are off screen.

### Top 10 recommendations, ranked by impact over effort

| # | Recommendation | Why (evidence) | Effort | Findings |
|---|---|---|---|---|
| 1 | **Fix the default landing**: nobody ever lands on My Work. `/me` does not return `hasWork`, so `defaultLandingPath` always sends people to Task Queue. | UX spec 2.2 says My Work for anyone with Pod membership or assignments; on the real stack all 15 users landed on `/tasks`. | S | BUG-1, M2 |
| 2 | **Per-tab default columns**: Completed needs a *Closed* column (it is sorted by closed date but shows none, and shows Due and ASAP for finished work); Created by me needs *Assignee* (it is the whole point of the tab). | Screens `my-work-completed-1366x768`, `my-work-created-by-me-1366x768`. The column set is one list for all four tabs. | S | C1, C2, B1 |
| 3 | **A one-line "needs attention" strip** above the tabs: `Overdue 9 . Due today 3 . ASAP 14 . On hold 6`, each a click that applies the filter (same pattern as Pod Work's stat line and Task Queue's quick views). Keep the decided priority order. | First-five-seconds test; Pod Work already has the strip, My Work has nothing. | M | M1, A1 |
| 4 | **Get rows back**: stop wrapping titles at 1366 (fold *Workflow progress* under the title below 1180 px, not 1060 px, or drop the Matter ref column from the default and put the ref in the subline), cap the Due column, and make **Compact** real (one line, 40 px rows). | Measured: 69 px rows, 6 visible; Compact is 61 px and 7 rows. 1920 shows 14 rows with the same columns. | M | M3, A2 |
| 5 | **Phone layout**: below about 640 px render each task as a two-line card (title, client and matter; due, priority, status chips), no sideways scroll. At 768 portrait Status is clipped with no hint. | 375: only Ref and Title visible, three tool rows above the grid, about 5 rows. | L | M11, BUG-14 |
| 6 | **"New" that survives drilling in, and is findable**: opening one task and pressing Back wipes every "New" marker, and the new rows can be on page 2. Track seen per task, add a "New (3)" chip to the strip. | Repro in BUG-3; markers at rows 18 and 49 of 50 in `new-marker-buried-1366x768`. | M | A5, BUG-3 |
| 7 | **Tab-aware sorting and naming**: Due soon sorts by due date (overdue first), not priority; rename so the tab says what it holds ("Due soon and overdue"; "Closed" instead of "Completed", which also holds cancelled tasks). | Due soon shows "Overdue 13d" below "Tomorrow"; Dashboard's Due soon excludes overdue (12 vs 21 for the same person). | S | D1, D2, C3, M5 |
| 8 | **Never show the wrong tab's rows**: on a failed or slow tab change the previous tab's rows stay on screen under the new tab's title. Clear rows on tab change (skeleton rows), keep rows only for same-tab reloads. | BUG-2, `error-with-rows-1366x768`. | S | BUG-2 |
| 9 | **Role-aware empty and restricted states**: a user without Pod Work is told to "Check Pod Work"; Matter links 403 for users without `Matter.View`; Directors, Pod Leads and Observers open an empty Active tab while their useful tab (Created by me, 72 to 153 tasks) is third. | `role-mina-empty-dead-end-copy`, `role-mina-matter-link-403`, `role-priya-my-work`. | S | BUG-7, BUG-8, M4 |
| 10 | **Drill-in keeps its place**: the task page highlights Task Queue and its breadcrumb says "Tasks", so you cannot tell you came from My Work; add "Back to My Work" and put focus on the row you left. Scroll and filters already survive Back (verified). | `task-detail-from-my-work-1366x768`; focus lands on `<body>` after Back. | S | M7 |

Everything else (popover polish, wording, keyboard row navigation, group by due bucket, hold reasons, clipped confirm text) is in section 2 and batched in section 5.

---

## 2. Findings by screen

### 2.1 The page as a whole (M)

Screens: `my-work-active-1366x768`, `my-work-active-scrolled-1366x768`, `my-work-active-1920x1080`, `my-work-active-768x1024`, `my-work-active-375x812`, `cmp-pod-work-1366x768`, `cmp-task-queue-1366x768`, `cmp-dashboard-technician-1366x768`.

**M1 (major, M): no answer to "what is urgent" in the first five seconds.**
What: the page opens on Active, 79 rows, sorted priority then ASAP then due then oldest. The 9 overdue rows are spread through the list by priority. Nothing on the page says "9 overdue, 3 due today, 14 ASAP". The Dashboard does not help a technician either: Tariq's Dashboard is only the Unassigned queue (`cmp-dashboard-technician-1366x768`), by design (addendum, Dashboard.ViewUnassigned).
Recommendation: a single compact line between the title and the tabs, built from data the API already has (`overdue=true`, `asap=true`, `dueTo=today`, `status=ON_HOLD` are all existing filters; add one count query):

```
My Work                                      Overdue 9   Due today 3   ASAP 14   On hold 6   New 3
[ Active (79) ] [ Due soon (21) ] [ Completed (87) ] [ Created by me (26) ]
```

Each item is a link that sets the filter (and shows as a chip, so it can be removed). Zero items are muted, not hidden, so the line does not jump. Pod Work already has the same pattern ("Unassigned 48, Assigned 126, Overdue 24, On Hold 18"); this is the personal version. It does **not** change the decided sort. Overdue and Due today are the same words the Due column already uses.

**M2 (major, S): the default landing never is My Work.** See BUG-1. For a technician the day should start here; today it starts on a 383-row Task Queue.

**M3 (major, M): vertical space.** Before the first row there are 275 px of 768 (header 56, page title, tabs, toolbar, column headers 40, filter row 40); the footer takes another 56. Grid viewport 437 px; rows are 69 px (two-line title plus the Client . Matter line); 6 rows fit. Compact density only saves 8 px per row (61 px, 7 rows, 8 with the filter row closed): the title still wraps because the Title column is only about 190 px (Matter 110, Workflow progress 160, Priority 110, Due 260, Status 130). At 1920 the same columns give 14 rows on one line each, which shows the layout, not the data, is the limit.
Recommendations:
- Fold *Workflow progress* below the title when the box is under about 1180 px, not 1060. At 1366 the content box is about 1098 px, just above the current threshold, so the most common laptop width gets the squeezed layout (`PROGRESS_FOLDS_BELOW` in `task-table.ts`).
- Cap the Due column (it is 260 px because the date-range filter input sets the column width; the longest value is "Oct 16, 2026 . Overdue 13d" at about 190 px).
- Move the tab help text (Due soon, Completed: 25 px, 75 px on a phone) into an info button beside the sorted-by note; they are read once.
- Make Compact mean it: single-line title with the Client . Matter line dropped (it is in the tooltip) and 40 px rows, which gives 11 rows at 1366x768.

**M4 (major, S): roles that are never assigned work get an empty first tab.** Pod Lead, Director, Project Manager, Intake Coordinator, Observer, System Admin: Active, Due soon and Completed are 0 for them, Created by me is where they live (85, 72, 153, 142 in the seed). `role-priya-my-work-1366x768` shows "Nothing assigned to you right now. Check Pod Work for unassigned tasks." with the useful tab last.
Recommendation: when the remembered or default tab is empty and another tab is not, open the first non-empty tab in the order Active, Due soon, Created by me, Completed, once per visit, with the existing notice pattern ("Nothing is assigned to you, so this opens Created by me"). For roles with no assignable work (no Pod membership) put Created by me first.

**M5 (minor, S): tab meaning and counts.**
- *Due soon* contains overdue tasks (help text says so, the name does not). The Dashboard's Due soon tile uses `asap=false&overdue=false&dueTo=...`, i.e. **excludes** overdue: for Tariq My Work says 21, the same filter on Task Queue says 12 plus 9 overdue.
- *Completed* contains Cancelled tasks (86 on the tab, 78 completed-only), and the Dashboard counts completed only (addendum, "What counts").
- Counts follow the filters and the Completed count follows a 90-day window; "Created by me" is all time. All decided and correct, but the only explanation of the window is a line inside the tab. A tab that says (86) next to a list of 101 closed tasks reads as a bug.
Recommendation: rename *Due soon* to **Due soon and overdue** (it is the only tab whose name hides half its content), *Completed* to **Closed**, and put the 90-day window in the tab's tooltip as well. Keep every count rule.

**M6 (minor, S): the restored view says that it restored, not what.** `restored-view-notice-1366x768`: clicking My Work in the nav opened Due soon with Priority = 2 selected; the notice is "Restored your last view." The only other cue is "Filters (1)". Name it: "Restored your last view: Due soon, Priority Critical or High." Also see BUG-4 (Reset to default does not reset the tab).
Also revisit one shipped detail: remembering the **tab**. Someone who last looked at Completed or Created by me and then clicks My Work expects their work. Restore filters, sort and page size for every tab, but only restore the tab itself when it is Active or Due soon.

**M7 (minor, S): drill-in loses the context, not the state.** Verified good: scroll position (1500 px in, 1500 px after Back), tab, filters and sort come back through the URL. Not good: (a) the task page highlights *Task Queue* in the nav and its first breadcrumb is "Tasks" (`/tasks`), so the way back inside the app is a different list; (b) after Back, focus is on `<body>`, not the row; keyboard users restart at the top of the page; (c) "New" markers vanish (BUG-3).
Recommendation: when arriving from a work list carry `?from=my-work` (or history state) so the nav keeps My Work lit, the crumb says "My Work" and links to the exact list URL, and on return focus the title link of the row left.

**M8 (nit, S): document title and table name do not change per tab.** The browser title is "My Work - MatterFlow" on all four tabs and the table caption is "My Work". Use "My Work: Due soon" for both; the polite live region says "Showing 1-50 of 87" with no tab name.

**M9 (minor, S): consistency of the colour language with Dashboard, Swimlane, Task Queue, Pod Work.** Priority badges (Critical red, High amber, Normal grey, Low outlined with bars) and the Due wording ("Overdue 5d", "Due today", "Tomorrow", ASAP with a bolt) are identical on every screen: good. Two collisions:
- *Left stripe.* In the work tables a red left bar means **overdue**; in the Swimlane the left bar is the **priority** colour and overdue is a red outline. A High task that is overdue has a red bar in My Work (`TSK-11`) and an amber bar on the Swimlane.
- *Amber.* "High" (priority) and "On Hold" (status) are both amber pills in the same row; "New" status and "ASAP" are both blue.
Recommendation: keep the stripe as "overdue" everywhere (add the outline to the Swimlane, or drop the priority stripe there) and give On Hold a distinct treatment (grey with a pause icon, it is already an icon pill). Non-colour cues are present everywhere, so this is clarity, not accessibility.

**M10 (minor, S): the page is a dead end for power users and for managers.** "Show me Tariq's work" or "my work in Task Queue" is a manual Assignee filter. Add "Open in Task Queue" (carries `assignee=me` plus the current filters) to the toolbar. Cheap, and it also explains how My Work relates to Task Queue.

**M11 (major, L): phone and narrow tablet.**
- 375 (`my-work-active-375x812`, `my-work-due-soon-375x812`): the grid box is 271 px wide inside a 794 px table. Only Ref and Title show; Priority, Due and Status need sideways scrolling, after which the Title is gone and a row is "TSK-24 [In Progress]" with no name (`grid-scrolled-sideways-375x812`, the Ref column is the sticky one). Above the grid: header search truncated to "Sear", page title, tabs (the fourth is cut off, scrollable), the Due soon help text (4 lines), "Sorted by", Columns, More filters, Filters on three rows. About 5 rows are visible.
- 768 portrait (`my-work-active-768x1024`): the table is 794 px in a 664 px box, Status is clipped ("S"), the filter row has moved into the sheet, and the "Scroll sideways" hint does not show (BUG-14).
Recommendation: below about 640 px render rows as cards (this is the only layout where a technician can triage on a phone): line 1 title (2 lines max), line 2 `Client . Matter`, line 3 chips `[Critical] [Overdue 1d] [In Progress]`; keep tabs, one "Filters" button (the sheet is already good: `filters-sheet-375x812`), and fold Columns and Sorted-by into it. Make **Title** the sticky column if a table must stay. Hide the 56 px nav rail behind a menu button at this width (it is 15 percent of the screen).

**M12 (missing features, ordered by value).**
1. *Group by due bucket* (Overdue, Today, Tomorrow, This week, Later, ASAP) as a display toggle; the Swimlane already has Group by and the markup/behaviour to reuse. Solves M1 for people who want the list ordered by time without changing the decided default sort. M.
2. *Hold reason in the row.* 6 of Tariq's tasks are On Hold; why and for whom is the one thing he needs to see ("Waiting for the custodian"). The reason is stored (the hold dialog requires it) but is not in `TaskQueueRow`. Show it as the second line of the Status cell or a tooltip. M (API field).
3. *Open at the current step.* The Workflow progress cell is the only place that names the step ("Close-out and Docume..."). Make it a link to the task with the step expanded. S.
4. *Keyboard.* Row navigation (`j`/`k`, `Enter` opens, `s` status menu) and "go to My Work" (`g` then `m`). Today there are 29 Tab stops before the first task and 4 per row (title, matter, priority, status), so reaching row 20 is about 110 key presses. S/M.
5. *Since your last visit* as a panel ("3 assigned to you, 2 changed by someone else"). Addendum F and the UX spec say **no notification bell**, so this needs a product decision before design; the "New" marker is the shipped, narrow version (A5).
6. *Snooze / pin.* Not recommended now: it adds a second ordering rule on top of the decided queue rule. Grouping and the strip give the same benefit.
7. *Bulk actions*: decided against (UAT-S03-11), not re-proposed.

### 2.2 Active

Screens: `my-work-active-1366x768`, `my-work-active-scrolled-1366x768`, `sorted-by-info-1366x768`, `sorted-by-due-1366x768`, `inline-priority-menu-1366x768`, `inline-status-menu-1366x768`, `inline-hold-dialog-1366x768`, `inline-complete-dialog-1366x768`, `inline-cancel-dialog-1366x768`, `after-inline-cancel-row-stays-1366x768`, `new-marker-buried-1366x768`, `near-empty-3-tasks-1366x768`, `empty-active-1366x768`.

**A1 (major, M): urgency is not visible in the order.** See M1. Within Critical the order is ASAP, Overdue 1d, Due today, Tomorrow, then dates, which is right; but a Normal task that is 13 days overdue is below every High and Critical task. Keep the decided order; add the strip (M1) and Group by due bucket (M12.1). The red left bar and the "Overdue 1d" text are the right cues: good.

**A2 (major, S): default columns at 1366.** Ref, Title, Matter (ref), Workflow progress, Priority, Due, Status. The Matter ref (`46044-00001`) repeats what the subline says ("Hartwell & Bryce LLP . Antitrust Second Request") in a different, less readable form, and costs 110 px that makes every title wrap. People do search by matter number, so keep the filter, but show the ref where it can sit next to the name: subline `46044-00001 . Hartwell & Bryce LLP . Antitrust...` and take the column out of the default. Result: one-line titles at 1366 and about 9 rows.

**A3 (minor, S): the progress cell repeats low-value text.** "0 of 5 / Intake Review and Scop..." appears on most rows, truncated. Show "Step 1 of 5 . Intake review..." as one line, bar under it only on hover or at width above 1500. (The existing fold under the title below 1060 px already does this; use that form everywhere and drop the bar.)

**A4 (minor, M): On Hold rows look like any other row.** Amber pill only (collides with High, M9), no reason (M12.2).

**A5 (major, M): the "New" marker is easy to lose.**
- It is a 12 px pill on the title's second line (`new-marker-buried-1366x768`, row 18 of 50) and rows are in priority order, so new rows are wherever their priority puts them: in my test of 3 new tasks, one was on page 1 row 18, one on row 49, one on page 2.
- It is cleared by *any* re-entry: `recordVisit()` runs in the page constructor, so opening a task and pressing Back (or switching to Task Queue and back) counts as the next visit and removes every marker (BUG-3).
- Tooltip says "Assigned since your last visit"; the column logic uses `assignedAtUtc`, which is right.
Recommendation: (1) a "New 3" item in the strip that filters to them (add `assignedFrom` to the API, one parameter, same shape as `createdFrom`); (2) treat a visit as "the page was open for at least a few seconds in a new browser session or after 30 minutes away", or keep `seen` per task id and mark a row seen when it is opened or scrolled into view; (3) a small dot in the Ref cell as well, so it is visible when the title is long.

**A6 (minor, S): inline status menu: "Complete" is a dead end for most tasks.** In the starter workflows nearly every step has required inputs, so choosing Complete in the row opens "Steps need information first" (`inline-complete-dialog-1366x768`). The dialog is clear and links to each step, but the menu offers an action that fails. Recommendation: when the completion check says the task is not ready, label the item "Complete... (needs step inputs)" and make it open the task at the first blocked step; or drop it from the row menu and keep it on the task page. Needs `canBulkComplete` / `isReady` on the row, or a lazy call when the menu opens.

**A7 (minor, S): after an inline Cancel (and Complete when it succeeds) the row stays in Active as "Cancelled" and the tab counts do not move** (BUG-9). Cancel has no Undo, so keeping the row is harmless, but remove it after a few seconds or on the next navigation, and update counts at once.

**A8 (nit, S): Status filter on Active and Due soon offers "New"** but assigned tasks are never New (assigning starts the task, addendum: "Assigning a user moves a New Task to In Progress"; I verified 0 rows). Offer In Progress and On Hold only. (`filters-sheet-375x812`)

**A9 (nit, S): the near-empty line is far from the rows.** With 3 tasks (`near-empty-3-tasks-1366x768`) "That's everything on your plate" sits at the bottom of the page, 300 px below the last row, next to the pager. Put it under the last row.

**A10 (nit, S): toast over the pager.** "TSK-59 cancelled." covers "Showing 1-77 of 77 / Previous" (`after-inline-cancel-row-stays-1366x768`). Toasts in a fixed-header page should sit above the footer or at top right.

**A11 (verified good):** inline priority menu (`inline-priority-menu`) with a check mark on the current value and screen-reader names such as "Critical, change priority of TSK-24"; the hold dialog requires a reason; Esc closes menus and returns focus; sort info popover states the default rule in one sentence (`sorted-by-info`); header sort works and the "Sorted by Due" note and URL (`sort=due&dir=asc`) agree (`sorted-by-due`).

### 2.3 Due soon

Screens: `my-work-due-soon-1366x768`, `my-work-due-soon-375x812`, `empty-dueSoon-1366x768`, `filter-kept-across-tab-1366x768`.

**D1 (major, S): a tab about time is sorted by priority.** The default sort is the Active rule. The tab's whole point is "what is due now": TSK-3 Overdue 1d, TSK-8 Due today, TSK-13 Tomorrow, then TSK-11 Overdue 5d, TSK-18 Oct 19, TSK-5 Overdue 13d: overdue and due-today rows are interleaved with tomorrow by priority. Recommendation: default order for this tab is overdue (oldest due first), then due ascending, priority as the tie break. The server already has a due sort.

**D2 (minor, S): naming** (M5). Say "Due soon and overdue".

**D3 (minor, S): the Due filter is disabled and shows the word "until"** (BUG-10) with the reason only as a tooltip. Show "Next 2 days and overdue" in the field, or hide the Due filter on this tab and put the sentence in the info button.

**D4 (minor, S): help paragraph.** "Due Soon lists your open tasks with a due date in the next 2 days, plus overdue ones. ASAP tasks have no due date, so they are not included." is correct and decided, but it is 25 px on desktop, 75 px on a phone, and spelled "Due Soon" while the tab says "Due soon". Move to an info button.

**D5 (minor, S): ASAP is excluded by design** (to avoid flooding), which means the 14 most urgent tasks are on neither this tab's list nor in its count. With the strip (M1) ASAP gets its own entry; no change to the rule.

**D6 (nit): empty copy.** "Nothing is due soon." is fine; "Nothing due in the next 2 days, nothing overdue." says more.

**D7 (verified good):** counts equal the grid (21 and 21), including overdue and timed due dates ("Oct 18, 2026, 5:00 PM EDT . Tomorrow"); a filter set on another tab is kept when the tab changes and the counts re-flow (`filter-kept-across-tab`: Active 26, Due soon 5).

### 2.4 Completed

Screens: `my-work-completed-1366x768`, `completed-show-older-1366x768`, `my-work-completed-375x812`, `empty-completed-1366x768`.

**C1 (major, S): there is no closed-date column.** The tab says "Sorted by Closed date" and "newest first" but no column shows when anything was closed, and the field is not sortable by a header (the sort has no column, so "newest first" cannot be flipped). "Closed" exists only as a filter in More filters. Add **Closed** (date, sortable) to `WORK_COLUMNS` and to this tab's default columns.

**C2 (minor, S): columns that mean nothing for finished work.** Due (with an ASAP bolt on completed tasks), the full-colour priority badge, and "All steps resolved" on every row (`my-work-completed-1366x768`). Default for this tab: Ref, Title (with Client . Matter), Matter, Closed, Status; priority badge muted (grey text, no fill) so a closed Critical task does not draw the eye.

**C3 (minor, S): Cancelled sits under "Completed".** The Status badge says Cancelled so nothing is hidden, but the name is wrong (M5).

**C4 (nit, S): "Show older" writes `completedFrom=2000-01-01`** and the chip reads "Closed: from Jan 1, 2000". Use an explicit "all time" state, chip "Closed: all time". The 90-day window is not shown as a chip (decided: it belongs to the tab).

**C5 (minor, S): the count and the list disagree in the eye.** "(87)" next to a tab whose full history is 101 (the 90-day window; the 14 older appear after "Show older"). Tooltip "Closed in the last 90 days" on the tab (M5).

**C6 (verified):** the tab count and the grid total are equal, the 90-day boundary works, cancelled tasks are included on purpose and labelled.

### 2.5 Created by me

Screens: `my-work-created-by-me-1366x768`, `created-by-me-with-assignee-1366x768`, `empty-createdByMe-1366x768`, `role-priya-my-work-1366x768`.

**B1 (major, S): no Assignee column** (it is not in the My Work defaults; adding it through the chooser fixes the tab: `created-by-me-with-assignee-1366x768`). The tab answers "where did the work I handed off go", so Assignee, Status and Due are the columns, and Workflow progress is secondary. Default for this tab: Ref, Title, Assignee, Priority, Due, Status.

**B2 (minor, M): open and closed are mixed.** All statuses, priority order: a Critical Completed task from March is above an open Normal one. Offer a Status default of Open with the usual chip (the Task Queue's own "Open" default pattern), or a two-state "Open / Closed" switch beside the sorted-by note. The count then means something ("26" open handed-off tasks) instead of an all-time total that only grows.

**B3 (minor, M): for people who create work (Intake Coordinators, Project Managers, Pod Leads) this is the main tab,** and it is last (M4). It also lacks *Created* (date) and *Age*, which is how a requester knows whether to chase.

**B4 (nit, S): empty copy** "You have not created any tasks." is fine; add the action when the user can create: a "Create task" link.

### 2.6 Grid, filters, states (all tabs)

Screens: `filter-priority-open`, `filter-due-presets`, `filter-applied-row`, `filter-chips-rowclosed`, `empty-filtered`, `columns-panel-clipped`, `density-compact-*`, `loading-first`, `loading-tab-switch`, `error-first-load`, `error-with-rows`, `focus-ring-row`.

**G1 (minor, S): Columns panel behaves like a disclosure, not a menu.** It does not close on Esc or on a click outside (verified; the keyboard help dialog says "Esc closes a menu"), it can stay open over the filter row and the other popovers, and at 768 px high the list is cut after "Requestor" with the scrolling inside the panel and no cue: Due, Status, Age, Created and Updated are below the fold (`columns-panel-clipped-1366x768`). Close on Esc and outside click, return focus to the button, show a scroll shadow, and add "Reset columns".

**G2 (minor, S): Due filter presets look backwards.** Today, This week, Last 7 days, Last 30 days, This month: for a Due column the useful ones are Overdue, Today, Next 7 days, This week, Next week. (Batch 3 listed this as deferred.) With the strip (M1) Overdue and Today are one click; add Next 7 days and Next week to the presets for the Due column only.

**G3 (nit, S): sort affordances.** Sortable: Ref, Priority, Due, Status, Created. Not sortable: Title, Matter, Updated, Age (Age is the inverse of Created), and Closed does not exist (C1). Title and Matter sorting is what people expect from an A to Z header.

**G4 (minor, S): loading and column jumps.** First load shows "Loading tasks..." in a one-row table; the Title column is 350 px wide then, 190 px after the rows arrive; tab names have no counts until the response, then shift. CLS was 0.006 (low), but the eye sees the jump. Reserve the count width (`(--)`), and show five skeleton rows with the final column widths.

**G5 (verified good):** filter row open by default, chips when it is closed (`filter-chips-rowclosed`), "No tasks match these filters" with Clear filters, typing debounces to one request for eight characters, Esc clears a text filter, `/` focuses the Title or Ref filter on My Work too (the keyboard help lists it under "Task Queue" only, BUG-12), the sheet at 375 with "Show 77 results".

**G6 (minor, S): error wording differs between states.** First load: "Couldn't load tasks." + Reference + Copy + Retry. With rows on screen: "Something went wrong. Try again." + Reference + Retry. Use the first everywhere (it names the thing that failed), and keep the reference.

**G7 (verified, accessibility).** axe-core 4.10.2 (wcag2a, 2aa, 21aa, 22aa, best-practice): **0 violations** on every tab at 1366x768, 375x812 and 1920x1080, on the empty state, and with the Columns and More filters popovers open (axe reports 64 contrast checks as "incomplete" because of overlapping layers; I computed them by hand: sub line 7.6:1, Overdue 6.6:1, Due today 6.8:1, ASAP 8.0:1, Critical badge 6.6:1, In Progress pill 6.6:1, inactive tab 15:1; only the *disabled* Due field is 4.2:1, exempt). Focus ring is a 2 px amber-brown outline, visible on every control I tabbed (`focus-ring-row-1366x768`). Priority, status and due never rely on colour (bars or icon plus word). Tab pattern is a real ARIA tablist with arrow keys. The code has no `prefers-reduced-motion` rules and no transitions in the work-queue styles, so there is nothing to reduce. Weak spots are the ones in this review: focus lost on Back (M7), 29 Tab stops before the first row (M12.4), tab name not in the table caption and title (M8).

**G8 (verified, performance).** Cold load to first row 1.1 to 1.4 s (mostly bootstrapping; 8 API calls, my-work answers in 30 to 56 ms even with 213 active tasks); tab switch 230 to 470 ms; DOM 4,100 nodes at 77 rows and 5,200 at 100 rows (the maximum page size); paging with Previous/Next and 25/50/100 per page. No infinite scroll needed at this size; page numbers or "Page 2 of 4" would help (only "Showing 1-50 of 79" and Next today). Fine.

---

## 3. Cross-cutting recommendations

1. **Per-tab column sets** (C1, C2, B1): `DEFAULT_COLUMNS` keyed by page and tab; the chooser remembers per page and tab.
2. **One summary strip component** shared by My Work and Pod Work (Pod Work has its own markup today); items are filter links with counts.
3. **Phone card renderer** for `mf-task-table`, shared by Task Queue, Pod Work and My Work, since all three share the component.
4. **Disclosure and popover behaviour**: one rule for Columns, More filters, Filters, inline menus and date popovers (Esc closes and returns focus, outside click closes, only one open at a time).
5. **Context on drill-in**: `from` state so breadcrumb, nav highlight and Back focus are right for My Work, Task Queue, Pod Work and the Dashboard.
6. **Microcopy pass**: "Due soon" not "Due Soon"; "Due soon and overdue"; "Closed"; "Couldn't load tasks." everywhere; empty text that does not mention screens the person cannot open; keyboard help lists `/` for all work lists; info buttons instead of help paragraphs.
7. **Colour language** (M9): stripe means overdue everywhere, On Hold distinct from High, written into the design tokens doc.
8. **Role-aware defaults**: the first tab that has something in it; Pod Work link only with `Pod.View`; Matter links only with `Matter.View`.
9. **Tests to add with the fixes** (e2e): landing for a user with work; stale rows under a failed tab change; "New" markers after Back; Matter link for a restricted role; Columns Esc.
10. **Saved views** stay in the planned Batch 5 (column-filters review); the strip and group-by are what make them less necessary on My Work.

---

## 4. Bugs found (with repro)

Environment: `origin/dev` `1af5c34`, Playwright Chromium, Dev auth, `America/New_York`. "Tariq" is a Data Technician with active tasks.

| ID | Sev | Bug | Repro | Expected |
|---|---|---|---|---|
| BUG-1 | major | **Nobody lands on My Work.** `defaultLandingPath` reads `profile().hasWork`, but `GET /api/v1/me` does not return `hasWork` (only the in-browser stub does), so it is always undefined. | Sign in as any user with Task.View and tasks (or Pod membership), open `/`. You land on `/tasks`. `curl /api/v1/me` has no `hasWork`. Code: `core/auth/guards.ts:35`, `core/auth/me-api.ts:30`. | UX spec 2.2: My Work for anyone with Pod membership or assignments. |
| BUG-2 | major | **Previous tab's rows stay under the new tab on error** (and are dimmed, not replaced, while loading). | Open Due soon. Make `/api/v1/my-work` fail (offline or 500). Click Completed. The grid still lists the Due soon rows (open tasks, "Overdue 1d") under "Completed", "Sorted by Closed date", "Showing 1-20 of 20", with the banner "Something went wrong". `error-with-rows-1366x768`. | Rows kept only for a reload of the same tab; a tab change shows the loading or error row. |
| BUG-3 | major | **"New" markers are cleared by drilling in and coming back.** `recordVisit()` runs each time the page is created. | Have 3 tasks assigned to you after your last visit; open My Work (3 markers); open any task; browser Back: 0 markers. | A visit should not end when you open a task from the list. |
| BUG-4 | minor | **"Reset to default" only clears filters.** It does not reset tab, sort or page size, and the next plain visit restores the same tab again. | Last view Due soon with Priority = Critical, High; click My Work in the nav; click Reset to default: still on Due soon (`?view=dueSoon`). Open My Work again: restored again. | Reset returns to Active, default sort, no filters, and forgets the remembered view. |
| BUG-5 | major | **Confirm dialog text is clipped.** `.mf-confirm__body` has `white-space: nowrap` (675 px of text in a 415 px box): "The task stays On Hold until someone resumes it. Workflow steps" and "...Fill them in (or skip them if allowed), then co" are cut off. | Active tab, row status menu, Put on hold (or Complete on a task with blocked steps). `inline-hold-dialog-1366x768`, `inline-complete-dialog-1366x768`. | Text wraps. |
| BUG-6 | minor | **Columns panel ignores Esc and outside clicks, and is clipped at 768 high** (see G1). | Open Columns, press Esc: still open; click the page: still open. | Closes; Esc returns focus to the button. |
| BUG-7 | major | **Matter links go to a 403 page for users without `Matter.View`.** | As the `Task.View`-only user: My Work, click a Matter ref. `/403`, "You don't have permission to view this." (`role-mina-matter-link-403-1366x768`). The task page breadcrumb has the same link. | Plain text when the link is not allowed. |
| BUG-8 | minor | **Empty copy sends users to a screen they cannot open.** | Same user with nothing assigned: "Nothing assigned to you right now. Check Pod Work for unassigned tasks." with no link and no Pod Work in the nav (`role-mina-empty-dead-end-copy-1366x768`). | Copy depends on `Pod.View` (the near-empty line already does this). |
| BUG-9 | minor | **After an inline Cancel the row stays in Active as Cancelled and counts are stale.** | Active tab (77), cancel the last row through the status menu: still "Active (77)", "Completed (86)"; after reload 76 and 87. | Counts update at once; the row leaves the tab. |
| BUG-10 | nit | **Disabled Due filter on Due soon shows the stray word "until".** | Open Due soon, look at the Due filter cell (`my-work-due-soon-1366x768`); the reason is only in the tooltip. | Empty, or "Next 2 days and overdue". |
| BUG-11 | nit | **Status filter offers "New" on Active and Due soon**, which can never match (0 assigned New tasks). | Open the Status filter on Active. | Only In Progress and On Hold. |
| BUG-12 | nit | **Keyboard help lists `/` under "Task Queue" only**; it also works on My Work and Pod Work. | `?` on My Work. | List it for the work lists. |
| BUG-13 | minor (inconsistency, not data) | **Same name, different number.** Dashboard Due soon excludes overdue, My Work Due soon includes it; Dashboard Completed counts completed only, My Work Completed adds cancelled. | Tariq: My Work Due soon 21; Task Queue with the Dashboard's Due soon query for him 12, plus 9 overdue. Completed tab 86; completed-only 78. | Same words, same meaning (M5). |
| BUG-14 | major | **At 768 px the Status column is clipped and no "Scroll sideways" hint shows.** The table is 794 px in a 664 px box; the hint did not display (it did at 375). | Open My Work at 768x1024 (`my-work-active-768x1024`). | The fold rules keep Status in view (UXR4-02 says they do) or the hint shows. |

Counts checked and **no mismatch found**: 3 users x 16 filter combinations (title, priority, matter text, client text, status, due range, ASAP, overdue, created, updated, project, closed range, pod, no pod, creator, assignee) x 4 tabs: every tab count equals that tab's grid total, and Active, Due soon (with overdue added) and Created by me equal the Task Queue for the same person.

---

## 5. Proposed implementation batches

Issue-sized, in this order. Each can be an epic with the child issues listed.

**Batch 1: Bugs and quick wins (S, one pull request each or grouped).**
1. BUG-1 landing: return `hasWork` from `/me` (Pod membership or any assigned open task) and a test.
2. BUG-2 stale rows: clear rows on tab change, keep them for same-tab reloads; e2e.
3. BUG-5 confirm text wraps (one CSS rule) and BUG-6 Columns panel (Esc, outside click, scroll cue, Reset).
4. BUG-7, BUG-8 permission-aware Matter links and empty copy.
5. BUG-4 Reset to default resets tab, sort, page size and forgets the view; M6 notice names the restored view; restore the tab only for Active and Due soon.
6. BUG-10, BUG-11, BUG-12, G6, D4, M8 copy and small defects (one issue).
7. BUG-14 and BUG-9 (fold thresholds at 768, hint; counts and row after inline cancel).

**Batch 2: Per-tab columns and sorts (S to M).**
1. Add *Closed* column (sortable) and `DEFAULT_COLUMNS` per tab (C1, C2, B1, B3).
2. Due soon default order: overdue, due ascending, priority (D1).
3. Rename tabs (M5, C3, D2), tooltips (C5), "all time" for Show older (C4).
4. Created by me: Open/Closed default (B2).
5. Title and Matter sortable (G3); Due presets (G2).

**Batch 3: First five seconds (M).**
1. `mf-work-strip` component with Overdue, Due today, ASAP, On hold; new count endpoint or fields on the My Work response; reuse on Pod Work.
2. Role-aware first non-empty tab (M4).
3. Landing and "Open in Task Queue" (M10).

**Batch 4: Space and density (M).**
1. Fold thresholds, Due column cap, matter ref in the subline (M3, A2, A3).
2. Real Compact density.
3. Sticky filter/header height review at 1366x768 (target 9 or more rows).

**Batch 5: New and drill-in (M).**
1. `assignedFrom` filter and "New" strip item; seen tracking (A5, BUG-3).
2. Context-aware drill-in: `from`, nav highlight, crumb, focus on return (M7).
3. Hold reason on the row (M12.2), "open at current step" link (M12.3), row menu "Complete" readiness (A6).

**Batch 6: Phone (L).**
1. Card renderer for the shared work table below 640 px; nav rail collapse; tab strip and toolbar for a phone (M11).
2. Playwright screenshots and axe at 375 and 768 for the three work lists.

**Batch 7: Grouping and keyboard (M).**
1. Group by due bucket (M12.1) using the Swimlane group-by component.
2. Row keyboard navigation and `g m` (M12.4), shortcut help update.

**Batch 8: Consistency (S).**
1. Colour language (M9): stripe, On Hold, written in the tokens doc.
2. Single popover behaviour (cross-cutting 4).

Product decisions needed first: M12.5 (a "since your last visit" panel against addendum F "no notification bell"), the tab restore rule in M6, and whether "Completed" becomes "Closed".

---

## 6. Already decided or shipped (not re-recommended)

- Inline column filters, chips when the row is closed, More filters, the sheet on narrow widths, `/` to focus the filter (Batch 3, `docs/ux/column-filters`). Filter row open by default.
- Tab-owned filters shown disabled with a reason; changing tab drops the filters the new tab owns; every tab count worked out under the same filters; the Completed 90-day window belongs to that tab; Show older.
- Quick views as presets on Task Queue (not My Work; I do not ask for them here, the strip in M1 is the My Work equivalent).
- "Sorted by" with the default-order info button, Columns and Density, hidden-column chips.
- Fixed-header grid with the filter row sticky under the header; own-scroll grid; loading, error and empty as table rows.
- "Restored your last view" notice with Reset to default and Dismiss (I only ask that it names the view and that Reset really resets).
- Priority-first default order with ASAP first within a priority and the Due soon exclusion of ASAP (addendum G, UX spec S02).
- Inline Status, Priority (and Assignee where shown) menus with permission rules, Undo for priority; hold needs a reason; bulk-complete guard for required step inputs.
- "New" marker, Due wording (Overdue 4d, Due today, Tomorrow, ASAP with a bolt), sensitive matter marker, zero counts muted.
- No row selection or bulk actions (UAT-S03-11); no notification bell (addendum F, UX spec 2.1); saved views are Batch 5 of the column-filter epic.

---

## 7. What I did NOT verify

- A real screen reader (NVDA, JAWS, VoiceOver). I checked roles, names, live regions and focus order in the DOM and with axe only.
- Browsers other than Chromium; touch interaction on a real phone (375 was emulated); 200 and 400 percent zoom; Windows high-contrast mode; dark theme; print.
- Real Active Directory display names and very long titles or client names (the seed uses short ones); the Dev-auth screen shows the account name under the user name.
- Lists above 213 active tasks for one person, slow networks, and an API restart under the page.
- Concurrency: two people editing the same row (conflict dialog); the Undo flows; inline Assignee (not in the default My Work columns, so I did not exercise it here).
- Time-zone edge cases around midnight (the due-date rules are covered by the existing e2e suite; I used `America/New_York` only).
- Task detail, Task Queue, Pod Work and Dashboard beyond what is needed to compare with My Work.
- Whether the Matter-link 403 and the missing `hasWork` also affect other entry points (I checked My Work and the task breadcrumb only).
- Technician usage data: the "first five seconds" judgment and the ranking come from the documented personas (Tariq, UX spec section 1) and from my own use of the screens, not from observing real users.
