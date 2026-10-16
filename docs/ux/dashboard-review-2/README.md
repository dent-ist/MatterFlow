# Dashboard UX review, round 2 (all five tabs, three roles, three widths)

Reviewer: independent senior UX / front-end review. Branch `dev` at `a9f284b` (published build, not `ng serve`), run on 2026-10-16 (server clock 06:2x UTC = 02:2x in New York).
Screenshots: `docs/ux/dashboard-review-2/screenshots/` (55 files, cited below as `NN`, for example `01` = `01-summary-director-1366.png`).
No application code was changed. This is the second Dashboard review of the whole page; it builds on `docs/ux/dashboard-review.md` (v2), `dashboard-review-round-3.md`, `dashboard-v4`, `dashboard-v5`, `dashboard-swimlane`, `dashboard-trends-types`, `dashboard-users` and addendum sections M, Q and S. Anything those already decided or shipped is listed in section 6 and not recommended again.

## 0. How this was done (and what the data looks like)

- Real stack: SQL Server 2022 in Docker, `deploy/publish.sh` build served by the API on port 5470 (Dev auth, starter configuration), Chromium 1194 via Playwright, axe-core 4.x (wcag2a, wcag2aa, wcag21aa, wcag22aa).
- Data (seeded through the API with the e2e `crowdPlan(120)` helper, then spread in time with one SQL script on the throwaway database): 137 active users (134 in the workload view), 6 pods, 9 task types in use, 6 clients and matters, 4 priorities, 725 open tasks (93 New, 557 In Progress, 75 On hold), 101 unassigned, 152 overdue, 115 ASAP (no due date), 142 due within 2 days, 108 completed tasks backdated over 3 to 48 days (73 completed in the last 30 days, 387 created), 12 people out of office, 20 off hours, 21 heavily loaded, 30 idle. Percentages in this document are properties of this seed, not of the firm.
- Personas: Director "Dana Whitfield" (role Director, all Dashboard permissions), Pod Lead "Marcus Reid" (role Pod Lead: Summary, Swimlane, Users, Coverage), Data Technician "Jamal Carter" (role Data Technician: `Dashboard.ViewUnassigned` only), plus three custom roles for the permission edge cases (Dashboard.View only, Trends only, Swimlane only).
- Widths: 1366x768, 1920x1080, 375x812 for every tab; 768x1024 for Summary, Swimlane, Users.
- Checks run: screenshots of every tab and state; axe on all five tabs; a hand-written contrast sampler (every text node inside the page, effective background); layout-shift observer; request log per tab; tab-stop walk; target-size measurement; history and URL behaviour; forced failures (500, aborted request) and slow responses; inline assign; reduced motion; cross-checks of every headline number against SQL and against the Task Queue.
- Scripts and the seed are in the session scratchpad and were not committed (docs only).

## 1. Executive summary

**Verdict.** The Dashboard is accurate, accessible and well engineered. Every number I checked matched the database and the Task Queue (section 4 lists zero data discrepancies), axe reports 0 violations on all five tabs, layout shift is 0 to 0.014, and almost every round-2 and round-3 finding is fixed. What is left is mostly about decisions the page helps (or does not help) people make: the page answers "what is the count" much better than "what do I do about it", it is scoped to the whole department for people who work in one pod, three tabs are built for a 1366 px laptop and waste a 1920 px monitor, and the same colour means different things on different tabs.

**First five seconds, by role.**
- Director: sees four counts in a good order (Overdue 152, Unassigned 101, On hold 75, ASAP 115) (`01`). Cannot see whether 152 is better or worse than yesterday, nor how many are Critical, and the list that would explain the 152 is below the fold (S1, S2, S3).
- Pod Lead: sees the same department-wide numbers as the Director. Nothing on Summary, Breakdowns or Trends can be narrowed to their pod (P1, `50`).
- Data Technician: a one-tab "Dashboard" that is a 101-row organisation-wide queue they can only page 8 at a time, with no type, pod or priority filter and no hint of their own work (S9, `54`).

### Top 10 recommendations, ranked by impact / effort

| # | Recommendation | Impact | Effort | Finding |
|---|---|---|---|---|
| 1 | Order the Overdue list priority first, then longest overdue, say so under the heading, and put the Critical count in the tile caption ("152 overdue, 11 Critical"). Today the six rows shown are all Normal/High due Oct 5; all 11 Critical overdue tasks are hidden. | High | S | S2 |
| 2 | Re-balance Summary so Overdue and Due soon are visible without scrolling at 1366x768 and 1920x1080 (compact one-line rows, 5 queue rows, lists side by side). Today the headline red number's list starts about 1,100 px down. | High | S to M | S1 |
| 3 | Isolate tab failures: Swimlane and Users must not wait for, or die with, the shared summary request, and an error must stay inside the tab (tab row kept). Verified: a 500 on `/api/v1/dashboard` blanks the Users and Swimlane tabs. | High (resilience) | S | P2, bug B1 |
| 4 | Add one page-level Scope control (All pods / My pods / one pod) in the tab row, in the URL (`?pod=`), applied to Summary, Breakdowns, Trends and the lists; default Pod Leads to their pods. | High | L (API + UI) | P1 |
| 5 | Add comparison to the tiles: Overdue vs yesterday and vs 7 days ago (the Trends endpoint already computes the daily Overdue snapshot), Completed and Created vs the previous period. | High | M | S3 |
| 6 | Fix the Trends chart: fill the available space (it is 515 px wide at 1366 and at 1920), a y axis that fits the data (peak 21 gets an axis to 50), never overlay a stock (Overdue 152) on flows (Created 15 a day), label lines directly, and add an "Open at end of day" backlog line. | High | M | T1 to T4, T7 |
| 7 | Coverage: add a "By task type" orientation (who has handled this type, which types have fewer than 2 people) and default it to the viewer's pod; 134 columns by 26 rows is not readable. | Medium-High | M | C1 |
| 8 | One set of semantic colour tokens for priority, status, load, trend and overdue; stop reusing amber (High, On hold, Out of office, due soon, warning) and green (Idle, In progress, Completed, On time). | Medium-High | M | X1 |
| 9 | Make the two board tabs usable on small and big screens: a compact one-line card, one lane at a time below 900 px (today four stacked scroll boxes, 2,353 px page), a taller board at 1920, and drop the 90 px page title on this page. | Medium | M | W1, W4, P4, P5 |
| 10 | One period model for the page (7 / 30 / 90 days, this month, last month, custom), in the URL, used by Summary, Trends and Coverage; today there are three vocabularies and none is in a shareable link. | Medium | S to M | P3 |

Quick wins that are not in the top ten but cost under half a day each: Due soon caption says "Next 2 days" but covers three calendar days (B6); captions clip at 375 (B3); the "Assign to me" toast covers the next rows' buttons (B5); links in lists are 16 to 17 px tall (X6); duplicated headings (T8).

## 2. Findings per tab

Severity: **blocker** (cannot do the job), **major** (a user is misled, blocked, or a decision is made worse), **minor** (friction or inconsistency), **nit** (polish). Effort: S under half a day, M one to two days, L more. IDs: P page, S Summary, B Breakdowns, T Trends, W Swimlane, U Users workload, C Coverage, R role variants, X cross-cutting.

### 2.1 Page as a whole

**P1 [major] No scope control: a Pod Lead reads the whole department** (`50`, `01`)
What: Summary, Breakdowns and Trends have no pod or "mine" filter. Users has Pod, Swimlane has Pod in Filters, Coverage has Pod, but the three tabs that answer "what needs attention" are department-wide. The Pod Lead role sees Summary 152 / 101 / 75 / 115, identical to the Director. The old "Open by Pod" chart was removed on purpose (b2d3c02); I did not find a written reason and I am not asking for it back. A scope selector is not a chart.
Why: a lead acts on their pod's overdue and unassigned work; the department total is context, not a task list. Today they open the Task Queue and filter by hand for every number.
Recommendation: one control at the right end of the tab row, left of Refresh:
```
[ Summary | Breakdowns | Trends | Swimlane | Users ]        Scope: [ My pods v ] [refresh]
                                                                  All pods / My pods / Review Alpha ...
```
`?pod=<id|mine|all>` in the URL (so a link carries it), remembered per user, default `mine` for anyone who is a pod member and holds Pod Lead permissions, `all` otherwise. It applies to the shared summary, the three lists, Breakdowns, Trends and the Users/Swimlane pod filters (so the filter is no longer a per-tab control). Needs a `podId` argument on `/dashboard` and `/dashboard/trend`. Not verified: how "My pods" behaves for someone in several pods (my Pod Lead was in none).
Effort: L.

**P2 [major] Tabs depend on each other's requests, and an error blanks the whole page** (`63`, bug B1)
What: every tab opens by calling the shared summary (`/api/v1/dashboard`) even when the tab does not use it: Swimlane and Users each make 9 API requests on load (including the shell's own calls), among them the summary. If the summary fails, Swimlane and Users show the full-page "The dashboard could not be loaded" alert and the tab row disappears (verified by returning 500 from `/api/v1/dashboard` and opening `?tab=users` and `?tab=swimlane`). The spec (S01 States) says "per-widget inline error with Retry so one failing widget does not blank the page".
Recommendation: read the summary only while Summary, Breakdowns or Trends is shown; render errors inside the tab panel with the tab row and Refresh intact (Users already does this well, `66`); the 5-minute timer should refresh only the tab on screen.
Effort: S.

**P3 [minor] Three period vocabularies, none shareable**
What: Summary and Trends: This week / This month / Last 30 days / Last quarter (caption "Last quarter (90 days)"); Coverage: Last 30 days / Last 90 days / Last 6 months / Last 12 months / custom; Swimlane: "Completed in last" 7 / 14 / 30 days. The Summary/Trends period is stored only in `localStorage` (`mf.dashboard.v2.<user>`): changing it leaves the URL untouched (verified), so a link to Trends shows the recipient their own period.
Recommendation: one list everywhere (7 days, 30 days, 90 days, This month, Last month, Custom), one label ("Period"), `?period=` in the URL, and a small scope note where the period does not apply ("Open, Due soon and ASAP are not affected"). Keep the Swimlane window separate but name it "Done in the last".
Effort: S to M.

**P4 [minor] About 290 px of chrome before any content at 1366x768** (`30`, `40`)
What: top bar 56 + H1 "Dashboard" row about 90 + tab row 55 + (Swimlane/Users) toolbar 85. The Swimlane lanes get about 450 px (two cards per lane, `30`); the Users grid starts at y=280.
Recommendation: on this page put the H1 in the same row as the tabs at 20 px (the sidebar already says "Dashboard"), make the tab row sticky, and collapse the board toolbars to one line (section 2.5).
Effort: S to M.

**P5 [minor] Left-aligned 1360 px cap wastes 1920 and breaks wall use** (`04`, `26`, `35`, `48`)
What: at 1920 the page stops at 1360 px, leaving about 300 px empty on the right (560 at 2560); the tiles never grow; the Trends chart does not grow either (T1); the Swimlane board is only as tall as the window minus chrome.
Recommendation: keep the reading cap for Summary and Breakdowns, lift it (to 100 percent) for Swimlane, Users and Coverage at 1600 px and up, and add a Wall mode (section 3, X8).
Effort: S.

**P6 [minor] Staleness is only a tooltip** (decision S)
What: addendum S removed the visible "Updated ... refreshes every 5 minutes". That is right for a laptop, but on a screen left open all day nothing says the numbers are from 11:40 if the tab was throttled or the laptop slept.
Recommendation: keep the icon-only Refresh; show text only when it matters: after two missed intervals (10 minutes) show "Updated 14 min ago" beside Refresh in the warning colour. This does not reintroduce the removed text.
Effort: S.

**P7 [minor] First-load error replaces the page and says it twice** (`63`)
What: the red alert "The dashboard could not be loaded" with a text Retry, a bottom-right toast "Something went wrong. Try again.", and no tab row (a deep link to Trends loses its context). Users tab error keeps the toolbar and has an icon-only Retry (`66`), the stale banner has a text Retry (`64`): three treatments. Carry-over of DASH3-13.
Recommendation: one shared `DashState` component (error, stale, retry, error reference), no toast when an inline error is shown, tab row always kept.
Effort: S.

**P8 [nit] Skeletons are eight identical blank rectangles on every tab** (`60`, `61`, `62`)
They do not resemble Summary (two tile groups plus a queue), Users (tiles) or Trends (chart). Layout shift is already low (0.014), so this is about perceived speed: draw the real silhouette (4 + 4 tiles and 3 queue rows; a grid of small tiles; a chart frame with axis lines).
Effort: S.

**P9 [nit] Swimlane URL fills with defaults** (`72` address `tab=swimlane&group=none&sort=priority&days=7`)
A plain link is rewritten with default values; harmless but it makes shared links long and brittle. Keep defaults out of the address.
Effort: S.

### 2.2 Summary tab (`01`, `02`, `04`, `05`, `07`, `50`, `54`)

**S1 [major] The list that explains the red number is a scroll away** (`01`, `02`, `04`)
What: Needs attention puts Overdue first, but the page below puts the Unassigned queue (8 rows, about 850 px) beside the tiles and pushes "Deadlines" (Overdue, Due soon) to y=1,110 at 1366x768; at 1920x1080 it is still below the fold. Three list rows are 90 px each (title, matter number plus priority plus age, assignee menu plus Assign link).
Recommendation: show all three lists in the first screen.
```
1366 px                                                        (rows 44 px, one line each)
Needs attention                  | Overdue 152 (11 Critical)   Unassigned 101        Due soon 142
[Overdue][Unassigned][On hold][ASAP]| TSK-576 Redaction..  Critical  Oct 11  BO v    TSK-473 ...
Overview [Open][Due soon][Done][New]| (6 rows)               (6 rows, Assign to me)  (6 rows)
```
Or keep the current two columns but make each queue row one line ("TSK-576  Processing - custodian set  [Critical]  35 d  [Unassigned v] [Assign to me]") so 8 rows are 350 px and Overdue and Due soon fit under the tiles. Add the task type icon (the swimlane card has one, the list row does not) so a technician can tell Collection from Redaction at a glance.
Effort: S to M.

**S2 [major] The Overdue list hides the worst items** (`02`)
What: `LIST_ORDER.overdue` is due date ascending, no note. The six rows shown are 1 High and 5 Normal, all due Oct 5 to 6; the database has 11 Critical overdue tasks (oldest due Oct 11) and 30 High, none visible. The Unassigned list directly beside it orders by priority and says so. Two lists on one screen, two silent rules.
Recommendation: Overdue ordered by priority, then days overdue, with the rule under the heading ("Critical first, then longest overdue"); tile caption "Excludes ASAP tasks" stays, add the severity: `152  (11 Critical, 30 High)` in the same tile. "View all overdue tasks" keeps the same order in the queue.
Effort: S.

**S3 [major] Counts without context** (`01`)
What: 152 overdue, 101 unassigned, 75 on hold: no direction. A director's first question is "better or worse than yesterday?". Completed 73 / Created 387 have no previous period, so a 30-day window cannot be judged.
Recommendation: a one-line delta under the number ("+8 since yesterday", "-3 vs 7 days ago") with an arrow glyph and text (not colour alone). Overdue and Open history already exist per day in the trend computation (the Trends tab draws the Overdue snapshot), so yesterday's value is cheap; Completed and Created compare to the previous equal period.
```
+------------------+
| Overdue        > |
| 152   +8 vs yday |
| 11 Critical      |
+------------------+
```
Colour only where "up" is bad (Overdue, Unassigned, On hold), neutral for Completed/Created.
Effort: M (API field and tile).

**S4 [minor] "Due soon: Next 2 days" is three calendar days** (bug B6)
The query is `dueTo=2026-10-18` on Oct 16 (today, tomorrow, the day after) and the list shows "Today" rows. Caption should read "Today and the next 2 days" or "Through Oct 18".
Effort: S.

**S5 [minor] Captions are clipped at 375 px** (`05`, bug B3)
Six of eight tile captions are cut by ellipsis ("Excludes ASAP t...", "Waiting on some...", "No due date, ha..."), including "Excludes ASAP tasks", which the spec requires to be readable. Allow two lines at 480 px and below, or drop the helper line under 480 px and show it as the link's title.
Effort: S.

**S6 [minor] The Assign toast covers the next rows' buttons** (`68`, bug B5)
The 360 px toast sits bottom-right over the "Assign to me" column of rows 5 to 7, exactly where a lead clicks next when triaging. Put the toast bottom-left of the main column or replace the row with "Assigned to you. Undo" until the toast closes.
Effort: S.

**S7 [minor] List rows lack what a technician needs to choose** (`54`)
A row shows number, title, matter number, priority, age. Missing: task type, client or matter name, due date (an unassigned task can have one: "Nov 4, 2026" appears on the swimlane card but not here). Add the type icon, the client name and the due chip; drop the repeated "Unassigned" select label (the trigger reads "Unassigned v" 8 times).
Effort: S.

**S8 [nit] Section names overlap: "Tasks to act on" then "Deadlines"** (`02`)
"Deadlines" holds Overdue and Due soon, but the Overdue list is not a deadline list for ASAP work and the ASAP tile (115, no due date) has no list. Previously decided (DASH3-01, tile only), so only a wording point: "Tasks to act on" and "Deadlines" are both lists of tasks to act on. Consider "Unassigned" and "Overdue and due soon".
Effort: S.

**S9 [minor] Technician: a one-tab organisation-wide queue** (`54`)
What: the page titled "Dashboard" has a tab row with one tab ("Summary") and Refresh, then the same 101-task queue for the whole firm, 8 at a time. No filter by pod, type or priority, no sense of the technician's own load. Known and deferred (round 3 Q7: limit to their pods).
Recommendation: hide the tab row when there is a single tab (keep Refresh next to the heading); title the page by what it is ("Unassigned work" when that is all there is); add three chips above the queue (My pods, Priority, Task type); one line "You have 6 open, 1 overdue. Open My Work". 
Effort: M.

### 2.3 Breakdowns tab (`10`, `10b`, `11`, `12`)

**B1 [major, value] Breakdowns describe composition, not problems** (`10b`)
Four cards of open-task counts (priority, task type, status, age). The question a director asks is where the overdue is. With this seed: 53 Critical, of which 11 overdue; that fact is nowhere on this tab.
Recommendation: split every bar into "not overdue" and "overdue" (two shades of the same colour, one extra field per breakdown row; the Task Queue already has the overdue filter and each row's link can carry it):
```
Critical  [######==]  53   11 overdue
High      [##########====]  148   30 overdue
```
Effort: M.

**B2 [minor] Age buckets stop at 15+ days** (`10b`)
In this seed 575 of 725 are 15+ days (79 percent), which makes the last bucket the whole chart. Add 15-30, 31-60, 60+ (and keep the caption "not a service-level target"). Caveat: my seed spread ages 0 to 60 days evenly; check the real distribution before committing to buckets.
Effort: S.

**B3 [minor] Ragged two-column grid** (`10`, `10b`)
Priority (4 rows) sits next to Task type (9 rows) leaving about 180 px of empty card; Age sits alone on the last row. At 1920 the grid stays two wide (`11`). Use four equal cards in a row from 1700 px, or masonry columns below.
Effort: S.

**B4 [nit] Normal and Low look the same** (`10`)
Both are an outlined grey bar and pill; only the signal-bar glyph differs. Fine for the pill (has a label), weak in the bar. Give Low a lighter outline or dotted fill.
Effort: S.

**B5 [nit] Repeated headings** (carry-over of DASH3-11)
H2 "Open tasks by" above H3 "Open by priority"; Trends has H2 "Created and completed", H3 "Tasks created and completed per day", a caption "Last 30 days" and a control labelled "Completed and created in" (reversed order). One title per card is enough.
Effort: S.

### 2.4 Trends tab (`20` to `27`)

**T1 [major] The chart does not use the card** (`20`, `26`, `22`)
What: the plot is about 515 px wide at 1366 and at 1920 (same SVG viewBox, scaled by width but capped by height), about 240 px tall. The card is as tall as the control panel (about 650 px), so a white void sits under the chart (`20`, `26`); ticking three task types makes the panel longer, the chart stays 240 px, and the chart scrolls out of view while you tick (`22`).
Recommendation: chart minimum height 320 px and fill the column; make the chart sticky (`position: sticky; top: 16px`) while the panel scrolls, or move the task-type list into a collapsible region under the chart. At 1920, put the legend panel on a 360 px column and give the chart the rest.
Effort: M.

**T2 [major] The y axis wastes the plot** (`20`, bug B2)
`niceMax` in `trend-chart.ts` only allows 1, 2, 5, 10 times a power of ten: the peak of 21 gets an axis of 50, so 58 percent of the plot is empty; with three types selected the type lines (0 to 6 a day) sit flattened at the bottom under the All line (`22`).
Recommendation: steps 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10 and four gridlines; when types are compared, hide "All task types" by default (it is a different magnitude) or offer "Scale to the selected types".
Effort: S.

**T3 [major] Stock and flow on one axis** (`25`)
Ticking Overdue (a level of 152, rising from about 20 to 152 in the last 8 days) next to Created and Completed (flows of 0 to 21 a day) rescales to 200 and flattens both flows. Different units on one axis is the classic dual-chart error.
Recommendation: draw Overdue (and a new "Open at end of day") in a second panel under the flow chart with its own axis and the same x scale; or a labelled secondary axis. Small multiples beat overlays whenever two measures have different units.
Effort: M.

**T4 [minor] No direct labels, markers on every day** (`20`, `21`)
Line identity lives in the panel 600 px away; 30 points per line each carry a marker (limit 31), so two lines read as two strings of beads. Label the last point of each line ("Created 15", "Completed 2") and draw markers only at the ends and on hover when there are more than 14 days. The tooltip and the keyboard read-out are good (`21`); keep them.
Effort: S.

**T5 [minor] Three x labels** (`20`)
"Sep 17, Oct 1, Oct 16" with shaded weekends. Add weekly ticks (Mondays) with the date, so the weekend shading has an anchor.
Effort: S.

**T6 [minor] The control panel is a mode machine** (`20`, `22`)
Disabled radio buttons (Show: Created, Completed, Overdue, On time, Completed late) look broken by default (greyed, one pre-selected), the Due dates checkboxes disable when a type is ticked, and a sentence explains the mode ("Created and completed are both shown until you select a task type"). Decision "two modes" is documented; the surface still asks the user to learn it.
Recommendation: a segmented control above the chart for the measure (`Created and completed | Overdue | On time or late`), and a "Compare task types" multi-select below it that is simply disabled with a one-line reason when the measure is the two-line one.
Effort: M.

**T7 [major, value] No backlog line** (`20`)
Created 387 against Completed 73 in 30 days: the queue is growing by about 10 a day. Nothing on the page says "Open at end of day" over time, which is the director's trend question. The Overdue snapshot already accepts the "current status, no replay" approximation (decision recorded in `dashboard-trends-types`), so Open at end of day (created on or before the day and not closed by the end of it) is the same class of number. For 90 days use weekly points.
Effort: M.

**T8 [minor] At 375 the chart is 240x110 px with 8 px labels, then 1,200 px of controls** (`27`)
Default to the table view at 480 px and below, or give the chart full width and a 16:9 height and fold the legend panel behind a "Compare" button.
Effort: S to M.

### 2.5 Swimlane tab (`30` to `37`)

**W1 [major] At laptop size a board shows two cards per lane** (`30`, `33`)
Chrome 290 px (P4), cards 195 px comfortable and about 150 px compact (compact saves only 25 percent, `33`), lanes 450 px tall: eleven cards of 750 on screen. A board is for scanning; this one is for reading. Recommendation: a real compact card, one line (priority bar, number, title, assignee initials, due chip: about 44 px) so a lane shows 8 to 10 cards; toolbar to one line: search, Group, Filters, "..." (density, window, Expand all). 
Effort: M.

**W2 [minor] Lane counts do not link** (`30`)
"New 93", "In Progress 557", "On Hold 75", "Completed 27": text, while the same numbers on Breakdowns link to the queue (measured: 0 links in lane headers). Link the count to the Task Queue with the lane's status (and the Done window).
Effort: S.

**W3 [minor] Grouped by client or matter, the card repeats the group** (`31`, `33`)
Each lane is 260 px; the group header truncates ("23711 Brightwater Ut...", "23711-00001 Intern...") and each card below repeats client, matter number and matter name, itself truncated ("Internal ...", "Project ...", "Wage and hour class a..."). When grouped by client/matter hide those two lines on the card (they are the group); when not grouped, show the client name and the matter name on one line.
Effort: S.

**W4 [minor] 375: four stacked scroll boxes** (`36`)
The page is 2,353 px; each lane is a 476 px scroll box (nested scrolling on touch) after a 330 px toolbar. Replace by a lane switcher: `[New 93] [In progress 557] [On hold 75] [Done 27]`, one lane at a time, full height.
Effort: M.

**W5 [nit] 1920: lanes get wider, not taller** (`35`)
Four 330 px lanes and about 3.5 cards visible at 1080 px. With W1 done this is acceptable; it is mentioned because the 1360 px cap (P5) also applies here.

### 2.6 Users tab, Workload view (`40` to `48`, `52`, `55`, `57`)

**U1 [minor] The view leads with the people who need nothing** (`40`, `48`)
Default sort "Availability and load" puts the 30 idle people (green) first and the 21 heavy people last, off screen. For the job of rebalancing (move work from heavy to free) both ends matter, and the chips already count them. Recommendation: a one-line capacity strip above the tiles and an "Assign work" entry that starts from the unassigned count: "101 unassigned tasks, 30 idle, 12 out of office".
```
Capacity:  30 idle | 30 light | 53 normal | 21 heavy | 12 out      101 unassigned  [Assign work v]
[#####..........====================|||||||||||||||||######]   (stacked by load level; click = filter)
```
The stacked strip replaces nothing; the chips stay as filters. Effort: S.

**U2 [minor] Icon-only toolbar** (`40`, `45`, `55`)
Workload/Coverage, density (two icons that both look like "expand"), cards/table and legend are four icon clusters with tooltips only, next to four selects and a search. On Coverage the first control on the page is two unlabeled square buttons above the heading (`45`). Use a text segmented control `Workload | Coverage` (this is the tab's navigation) and keep icons for density and layout only.
Effort: S.

**U3 [minor] Table view overflows and cannot sort** (`42`)
The table is 1,347 px wide in a 1,096 px wrapper (Load and Actions are cut off at 1366, horizontal scroll inside the page), there is no sticky name column, and column headers are plain text (sort only through the toolbar). Make the person column sticky, make headers sortable (`aria-sort`), and drop the four per-priority number columns into one stacked count cell.
Effort: M.

**U4 [minor] People who cannot take work count as idle** (`40`, `48`)
The Idle count (30) includes the Director, the Pod Lead, the Technician and the admin account (visible as "Dana Whitfield", "Marcus Reid", "Jamal Carter", "ke\kekim" and "User 1..10" tiles in `48`). For a team of 134 the idle figure drives assignment decisions. Add a filter "Can take work" (has Task.Assign or is in a pod) on by default, or exclude users with no pod.
Effort: S to M (needs a rule).

**U5 [minor] The drawer repeats the person on every row** (`44`)
Each open task row repeats "Rae Young v" (the assignee menu) three lines high, because the drawer is about one person. Move reassignment to a row icon ("Reassign") and give back 25 percent of the height; show due date and overdue chip on the same line as the status.
Effort: S.

**U6 [minor] Assign picker is context-free** (`47`)
"Assign work to Ben Grant" lists the organisation's unassigned tasks, priority then oldest, with no filter for the person's pods and no task type. Default the list to the person's pods (toggle "All pods"), show the type icon, and offer a bulk "Assign the next 3" (Critical first). It already warns for Heavy and out-of-office people (`06b` in the older set), which is good.
Effort: M.

**U7 [nit] Idle tile is a loud green block** (`40`, `48`)
Thirty solid green tiles dominate the first 4 rows; the people with work are white. Idle is a fact, not an achievement and not an alarm; tint it, or invert (quiet idle, strong heavy) once U1 gives the idle count its own place.
Effort: S.

### 2.7 Users tab, Coverage view (`45`, `46`, `49`, `56`)

**C1 [major] A 134 by 26 matrix is not a planning tool** (`45`, `46`)
What: 134 person columns, 26 task type rows, about 11 columns visible at 1366, horizontal scroll to see the rest; 846 "training gaps"; person names wrap in rotated-looking two-line headers with initials. The addendum's goal (Q) is a question about task types: "which types have too few people, and who could be trained". The matrix answers it only by scanning 3,500 cells.
Recommendation: a "By task type" orientation (default), the matrix as the second option:
```
Task type            Handled by (last 30 days)             People  Status
Early Case Assessment  Ana B., Ben K., Cai D., +5            8
Redaction              Gil M., Ida B.                         2
Quality Control        Kay H.                                  1     ! One person
Hosting Setup          none                                    0     ! No one
                       [View who has not handled it v]  (filtered to a pod)
```
No ranking: order by name or by "fewest people first" labelled neutrally, no scores. Default the Pod filter to the viewer's pod (P1). Names, not counts, are what a lead needs for the training conversation.
Effort: M to L.

**C2 [minor] Hatching and outlines compete** (`45`)
Every zero is a hatched dashed cell, every gap a thick amber outline with an icon: on a 134-column matrix the pattern, not the data, is what the eye sees. Zeros blank (or very light), gaps outlined only when the "Training gaps" toggle is on.
Effort: S.

**C3 [minor] The warning fires on types nobody ever did** (`45`)
"17 task types have fewer than 2 people who handled them" is amber on first sight; in this seed all 17 flagged types have zero completions in the period (only 9 of 26 types were completed at all, and each of those was handled by 2 or more people). The addendum says fewer than two is flagged, so it is by design, but a banner that is true for most of the catalogue is noise. Separate "no one handled it" (informational) from "exactly one person" (the bus-factor warning).
Effort: S.

**C4 [minor] Own period list** (`45`)
See P3.

### 2.8 Role variants (`50`, `54`, `70`, `71`, `72`)

**R1 [minor] A link to a tab you cannot see silently becomes Summary** (checked: Pod Lead opening `?tab=breakdowns` ends on `?tab=summary`)
Intended (round 3), but a Director sharing a Trends link with a Pod Lead gives them no reason. Add a one-line status under the tab row: "Breakdowns is not available for your role. Showing Summary."
Effort: S.

**R2 [minor] The Dashboard menu item is a dead end for a role with Dashboard.View only** (`70`)
The page says "No Dashboard tab is turned on for your role. Ask an administrator..." The nav item is visible because it follows Dashboard.View (spec). Hide the item when the person holds no tab permission, or keep the page but make the note the only content (it is).
Effort: S.

**R3 [nit] A role with one tab still shows a one-tab tab row** (`71`, `72`, `54`)
Hide the tablist (keep Refresh) when only one tab is permitted; keep the tab name as the H1 ("Trends").
Effort: S.

## 3. Cross-cutting recommendations (design system)

**X1 [major] Colour semantics are reused across tabs** (`01`, `10`, `20`, `31`, `34`, `40`)
Measured on screen, same hue, different meaning:

| Colour | Used for |
|---|---|
| Red | Critical priority, Overdue tile, overdue chips, Heavy load outline, Overdue trend line, error banners |
| Amber | High priority pill, On hold tile and badge, Out of office chip, "Today" due text, stale-data banner, training-gap outline |
| Green / teal | Idle tile (Users), In progress badge and bar (Breakdowns, Swimlane), Completed (Swimlane badge, Trends line), On time (Trends line) |
| Blue | New status, ASAP tile, Created line, Age ramp, default bar fill, links, Review Batch line, "Out of office" legend |

A swimlane card shows a High pill and an On hold badge side by side in the same amber (`34`); the same teal is "being worked" on Breakdowns and "done" on Trends; "Idle" (no work) is the brightest green on the page. Red is consistently "bad", which is fine; amber and green are the problem.
Recommendation: semantic tokens, one meaning each: `--mf-sev-*` (priority scale Critical red, High orange, Normal slate, Low light slate, nothing else uses it), `--mf-status-*` (New blue, In progress indigo or teal, On hold violet, Completed green, Cancelled grey), `--mf-load-*` (a sequential single hue, not traffic lights; Heavy gets the outline plus icon), `--mf-warn` (amber, only for warnings and stale data), `--mf-chart-*` (the Okabe-Ito set already used for lines, never reused for status). Add a unit test per token like `chart-contrast.spec.ts`. Contrast is already good (lowest measured 4.83:1, "Clear" in Trends at 13 px); this is about meaning, not ratios.
Effort: M.

**X2 [minor] Drill-down coverage** 
Linked: 8 Summary tiles, queue and list "View all", 24 links on Breakdowns (rows, legend, segments), legend totals and table cells on Trends, "Unassigned" chip on Users, cells on Coverage (drawer). Not linked: Swimlane lane counts (W2), Users "Overdue" mark and tile counts (open the drawer; fine, but the drawer is not sorted by overdue), Users chips Heavy/Idle (filters, by design), the Summary "Showing 8 of 101" text, tile captions. Rule to adopt: every number on the page is a link to the filtered queue or opens the list behind it; if it cannot, it is not styled like a number.

**X3 [minor] URL state matrix**
In the address: tab, Trends (types, measure, due lines), Swimlane (group, sort, days, filters), Users (pod, availability, search, load, priority), Coverage (view, filters). Not in the address: Summary period (localStorage), Users density and layout (localStorage, by design), scope (does not exist yet). Add `?period=` and `?pod=` (P1, P3) and a "Copy link" icon in the tab row (there is none; verified 0 copy/share controls), because the filters worth sharing are exactly the ones on Users and Swimlane.

**X4 [minor] One state kit**
Skeleton, error, stale banner, empty and Retry exist as separate implementations per tab (`data-error`, `data-users-error`, `data-swimlane-error`, `data-stale`, `data-users-stale`, `data-swimlane-stale`, `data-coverage-stale`, `data-trend-error`) with three different looks (`63`, `64`, `66`). Build `mf-dash-state` once: skeleton variants by silhouette, inline error with reference and a text Retry, stale banner, and the "empty because filtered" state.

**X5 [minor] Remembered preferences** 
Remembered per browser: period (Summary and Trends), Users sort, density, view, Swimlane group, sort, window, density, Trends types. Not remembered by design: filters and tab. One gap: preferences are per browser, not per user across devices (a director on a wall display and a laptop sets everything twice); acceptable until saved views exist (X7).

**X6 [minor] Target size** (carry-over of DASH3-09)
Measured on Summary: "Assign to me" 80 x 16 px, task links 17 px high, "View as table" 16 px. Under the 24 px of WCAG 2.2 SC 2.5.8 unless spacing rescues them, and the "Assign to me" link sits 8 px from the assignee select. Give list actions a 24 px minimum height (padding, not font size) and keep the visual size.
Effort: S.

**X7 [feature] Saved views**
The state is already in the URL for Users, Swimlane, Trends and Coverage. Per-user named views ("Review Alpha heavy", "Overdue Critical") stored beside the preferences, shown as a menu at the right of the tab row. Depends on P1 and P3 making Summary state shareable first. Effort: M.

**X8 [feature] Wall / TV mode**
`?wall=1` or a Full screen button: no sidebar or header, 1.25x type, the 5-minute refresh kept, "Updated 12:41" always visible (P6), pages Summary, Swimlane, Users in rotation every 60 seconds. The team already runs a 120-person grid that fits one 1920x1080 screen in dense mode; this is a mode, not a new feature. Effort: M.

**X9 [feature] Thresholds**
Load thresholds are configuration (`Dashboard:Workload:LightMax`, `NormalMax`). Extend the idea to the tiles: an admin sets "Overdue above 100" or "Unassigned older than 14 days" and the tile gets an attention state only past it (today Overdue is always red when above zero and neutral at zero, which is correct, but 152 and 3 look identical). This is thresholds, not alerts: no notifications. Effort: M.

**X10 [feature] Export / print (needs a product decision)**
Addendum (decisions "Dropped") lists reports and exports as dropped: the Dashboard is the only reporting. I am not recommending export. A print stylesheet for Summary and Breakdowns (so "Print to PDF" gives a clean one-pager for a Monday meeting) is not an export and costs little; confirm with the product owner. Effort: S.

**X11 [feature] Quick actions**
Already shipped: assign from queue, from Users tile, inline status/priority/assignee in drawers. Missing and cheap: "Assign to me" on an Overdue row when it is unassigned (the Overdue list has no actions), "Put on hold" and "Change due date" in the Swimlane card menu (status exists), bulk select on the Unassigned queue (assign 5 selected to one person). Effort: M.

**X12 [minor] Microcopy**
- "Completed and created in" next to the Overview heading is clear now; on Trends the same label sits under "Created and completed" (reversed order). Use "Created and completed" in both.
- "Waiting on something" (On hold tile) is vague; "On hold: waiting on client, custodian or internal" matches the reasons people type.
- "No due date, handle promptly" (ASAP): an instruction, not a description; "No due date" is enough, the tile's blue says the rest.
- Chips "Idle", "Light", "Normal", "Heavy": the thresholds (1 to 3, 4 to 8, more than 8) are in the legend only; add them to the chip tooltips (they are in the title already) and to the screen-reader name.

## 4. Bugs found (with repro steps)

No data discrepancies. Verified against SQL and the Task Queue on this seed: Summary 8 tiles equal their queue totals (725, 152, 101, 75, 115, 142, 73, 387); the four age buckets (19, 58, 73, 575) equal their queue totals and sum to Open; priority, task type and status breakdowns sum to Open; Users open total 624 = Open 725 minus Unassigned 101, Users overdue 120 = assigned overdue in SQL (152 minus 32 unassigned); Swimlane lanes 93 / 557 / 75 / 27 equal status counts and the 7-day done window (from Oct 10 in New York); Trends totals 387 and 73 equal the tiles; Coverage total 73 equals Completed. The Task Queue count for every breakdown row link matched (0 mismatches).

| ID | Severity | Bug | Repro |
|---|---|---|---|
| B1 | major | A failing shared summary request blanks the Swimlane and Users tabs (and removes the tab row) although they use their own endpoints | As Director, intercept `GET /api/v1/dashboard?*` with HTTP 500, open `/dashboard?tab=users` (or `tab=swimlane`): the page shows the red alert "The dashboard could not be loaded" and no tabs. `/api/v1/dashboard/workload` and `/swimlane` were fine. Also: every tab load calls `/api/v1/dashboard` first (Swimlane 9 API requests, Users 9) |
| B2 | minor | Trend y axis jumps to 50 for a peak of 21 (`niceMax` offers only 1, 2, 5, 10 times a power of ten) | Director, `/dashboard?tab=trends`, default view: axis 0 / 25 / 50, highest point 21 (`20`) |
| B3 | minor | Six of eight Summary tile captions are clipped at 375 px, including the required "Excludes ASAP tasks" | 375x812, `/dashboard?tab=summary` (`05`): `scrollWidth > clientWidth` on "Excludes ASAP tasks", "Waiting on something", "No due date, handle promptly", "New, in progress and on hold", "Next 2 days, excludes ASAP" |
| B4 | minor | Users table is wider than its box and has no sticky person column; Load and Actions are cut off at 1366 | `/dashboard?tab=users`, choose the table layout (`42`): table 1,347 px in a 1,096 px wrapper |
| B5 | minor | The "Assign to me" toast covers the next rows' Assign controls | Director, Summary, click "Assign to me" on the first queue row (`68`): the toast overlays rows 5 to 7 for the Undo window |
| B6 | minor | "Due soon / Next 2 days" covers three calendar days | On Oct 16 the tile query is `dueTo=2026-10-18`, 142 tasks, list rows show "Oct 16 ... Today". SQL: due Oct 16 to 18 inclusive = 142 |
| B7 | nit | Swimlane writes default values into the address | Open `/dashboard?tab=swimlane` as a Swimlane-only user: the address becomes `...&group=none&sort=priority&days=7` |

Not bugs, checked and fine: after "Assign to me" the tile and the queue count drop at once (101 to 100), the assigned row leaves, focus moves to the next row's control and the live region says "TSK-576 assigned to Dana Whitfield and removed from the Unassigned queue. 100 unassigned tasks left."; a manual Refresh keeps all 8 tiles on screen (no skeleton flicker, 73 busy frames, 0 empty frames); a failed Refresh keeps the figures and shows the amber banner with Retry (`64`); Back after Summary to Trends to Users goes to Trends (history pushes).

## 5. Proposed implementation batches (issue-sized, in order)

**Batch 1: bugs and one-line wins (each S, independent)**
1. Load the summary only for Summary, Breakdowns and Trends; keep the tab row and show errors inside the panel (P2, B1).
2. Overdue list: priority then days overdue, rule under the heading; Critical/High count in the Overdue tile caption (S2).
3. Due soon caption "Today and the next 2 days"; tile captions wrap to two lines at 480 px and below (S4, B3, B6).
4. Assign toast position or inline "Assigned to you. Undo" (S6, B5).
5. Trend `niceMax` steps and four gridlines; chart minimum height; markers only at ends for more than 14 days (T2, T4, T5, B2).
6. 24 px minimum hit area for list links and "View as table" (X6); remove duplicate headings (B5, T-heading); keep defaults out of the Swimlane address (B7).
7. Tab-row details: hide a single-tab tab row, one-line note when a deep link falls back to Summary, hide the Dashboard nav item with no tab permission (R1 to R3).

**Batch 2: Summary hierarchy**
8. One-line list rows with task type icon, client, due chip; rebalance so Overdue, Due soon and Unassigned fit above the fold at 1366x768 and 1920x1080 (S1, S7, S8).
9. Delta captions on tiles: API fields `overdueYesterday`, `previousPeriod` for Completed and Created; tile line (S3).
10. Technician Summary: chips (pod, priority, type), own-work line, page naming (S9).

**Batch 3: period and sharing**
11. One period model, `?period=` in the URL, shared by Summary, Trends and Coverage; Swimlane window renamed (P3, C4, X3).
12. Copy-link icon in the tab row (X3).
13. Staleness text after 10 minutes (P6).

**Batch 4: scope**
14. API: optional `podId` on `/dashboard` and `/dashboard/trend` (and the three list queries via the Task Queue pod filter).
15. UI: Scope control in the tab row, `?pod=`, default for Pod Leads, applied to all tabs (P1).

**Batch 5: Trends**
16. Chart fills its column, sticky while the panel scrolls, 375 layout (T1, T8).
17. Measure selector above the chart; Overdue and Open as a second panel with its own axis (T3, T6).
18. "Open at end of day" measure with weekly points for 90 days (T7); direct labels at line ends (T4).

**Batch 6: colour and the state kit**
19. Semantic colour tokens and a contrast test per token; migrate Summary, Breakdowns, Swimlane, Users, Trends in one pass (X1).
20. `mf-dash-state` (skeleton silhouettes, error, stale, empty, Retry) used by all tabs (P7, P8, X4).

**Batch 7: Swimlane and Users**
21. Swimlane compact one-line card, one-line toolbar, linked lane counts, no repeated client/matter when grouped (W1 to W3).
22. Swimlane lane switcher below 900 px (W4).
23. Users: capacity strip, text Workload/Coverage switch, sticky and sortable table, drawer rows without the repeated assignee, picker defaults to the person's pods, "can take work" filter (U1 to U6).
24. Lift the width cap for Swimlane, Users, Coverage at 1600 px and up; compact page header on the Dashboard (P4, P5).

**Batch 8: Coverage**
25. "By task type" orientation with named handlers and a pod default; quieter zero cells; separate "no one" from "one person" (C1 to C3).

**Batch 9: Breakdowns**
26. Overdue share inside each breakdown bar; longer age buckets after checking real data; card grid (B1 to B4).

**Batch 10: modes (product decision first)**
27. Wall mode (X8); tile thresholds (X9); print stylesheet (X10); saved views (X7); quick actions on the Overdue list and bulk assign (X11).

## 6. Already decided or shipped (not re-recommended)

- Needs attention with ASAP open as a quiet blue outlined tile (DASH3-01), Summary always opens first (DASH3-03), tab changes push history (DASH3-02, verified), focused tab scrolls into view at 375 (DASH3-08, verified `37`, `55`), tab rows with roving tabindex.
- One icon-only Refresh in the tab row with the time in its tooltip, 5-minute auto-refresh, failed-refresh banner (decision S). I only suggest text after a stale interval.
- Technician sees only the unassigned queue (`Dashboard.ViewUnassigned`, decision S); the Pod breakdown and "Your work" were removed (b2d3c02).
- No per-person completion, speed or ranking on Workload and Swimlane; the single exception is Coverage (decision Q). Nothing here recommends a ranking.
- Reports and exports are dropped (addendum): X10 is only a print stylesheet and needs confirmation.
- Overdue and "due soon" use the viewer's time zone; "Dotted: today so far" and weekend shading on Trends; Task Queue drill-through for every Summary and Breakdowns number; chart tooltips and keyboard read-out on Trends (`21`); colour-blind-safe line palette with dash and marker per line.
- Inline Assign to me with Undo, live-region announcement, focus moves to the next row, tile count drops at once (DASH-02, DASH-03 verified fixed).
- Zero-count tiles turn neutral (verified with a zeroed response) rather than red.
- No dark theme exists in the app (tokens are used throughout, so it would carry over).

## 7. What I did not verify

- Real screen readers (NVDA, JAWS, VoiceOver). axe 0 violations on five tabs; "incomplete" items were `color-contrast` (checked with my sampler: minimum 4.83:1 across about 2,500 text nodes) and 4 `aria-prohibited-attr` nodes on Swimlane (not examined).
- Browsers other than Chromium; real touch (viewport emulation only, no touch events or pinch zoom); Windows high contrast; 200 percent and 400 percent text zoom; colour-blindness simulation (relied on the earlier palette unit tests).
- Data at the firm's real scale: 833 tasks and 137 users here; no 50,000-task or 500-person run, no server timing (page loads were 1.1 to 1.9 s end to end locally, 6 to 9 API calls per tab).
- Other time zones (earlier rounds did New York, Los Angeles, Auckland); my runs are all America/New_York.
- A Pod Lead who is a member of pods ("My pods" behaviour for P1); my Pod Lead was in none.
- The 5-minute auto-refresh timer in this run (code read and earlier rounds' fake-clock tests), the Swimlane keyboard model and tree roles, the Coverage drawer, the Swimlane inline status dialogs, the Users assign flow beyond opening the picker.
- Seed realism: 16 percent ASAP, 21 percent overdue, 79 percent of open tasks 15 days or older, 17 of 26 task types never completed in the period. Findings that depend on those shares (B1, B2, C3) need a look at real data before sizing.
- Print output, and whether `@media print` rules exist for this page beyond what the global styles provide (a print rule exists in the global CSS; not rendered).
