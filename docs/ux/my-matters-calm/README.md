# My Matters: a calmer page (review, measurements and proposals)

Date 2026-10-27. Base `origin/dev` (`e2dd52e`, after PM v2 and its final verification). Epic **#893** (label `phase-24`). Plan and order: `delivery-plan.md` in this folder. Decisions: `docs/requirements/decisions-addendum.md` section **AO** (proposed, not decided). Method: the real product was built, started (SQL Server 2022 in Docker, the published API with Dev authentication, the Angular app on one origin), demo data seeded, and every tab and component was photographed and measured with Playwright. **Documentation and issues only; no product code was changed.**

> **Owner's bottom line (epic #893):** the screen is too busy, there is too much text, and it is hard to catch the important things.
> **Finding in one sentence:** the Overview prints the same few facts four to five times in four to five styles, puts five controls on top of every list before the first task, and reaches the first task row at **569 px** of a 768 px screen; nothing on it is louder than anything else.

## 0. Summary

### Top ten findings

| # | Finding | Evidence (1366x768 unless stated) | Issue |
|---|---|---|---|
| 1 | The first task row starts at **569 px** (74 % of the screen). 513 px of page content come before it; on a phone it is at 1,021 to 1,069 px, more than a screen down. | metrics, section 2 | #903 MM-10, #922 MM-29 |
| 2 | The page is 1,678 px (1-matter PM) and 2,599 px (3-matter PM) tall, **655 and 984 words**, 128 and 157 controls on the Overview. The phone page is 3,344 and 5,533 px. | section 2 | #903, #922 |
| 3 | The same task is listed up to **three times** on one screen (Due soon, Unassigned, Upcoming deadlines); a note "4 also listed under Overdue" patches the overlap. The same five events are shown twice (Since your last visit and Recent activity). | F-06, F-13 | #896, #905, #909 |
| 4 | Every list has **five controls** before its first row (Views, Export or 2 wk/4 wk, Task types, Sort, direction); Focus duplicates Task types; four different popover styles. | F-07 | #894, #907 |
| 5 | **At risk is counted (6) but has no list on the Overview**; Needs my attention is four groups of up to ten rows (1,339 px) with four "View all" links. | F-05, F-10 | #905 |
| 6 | **Matter health shows every matter Red** (any overdue task); for a 1-matter PM it is a table of one row that repeats the strip. | F-12 | #908 |
| 7 | Filters that cannot filter (Client, Role) are drawn for a PM with one matter; a third filter (Dates) appears on one tab and doubles the panel's own 2/4 weeks buttons. | F-03, F-17 | #906, #910 |
| 8 | Details tabs are as busy as the Overview: **Data** (484 words, two tables, three paragraphs of caveats, a flat chart of "no history"), **Activity** (25 two-line events, one task = 3 to 5 events, no dates), **Breakdown** (matrix, 75 controls), **Trends** (flat charts and strip repeats). | sections 3.2 to 3.6 | #911 to #917 |
| 9 | Nothing catches the eye: 28 task links, many pills and icons, red in five different forms; the one fact the PM needs ("how much is late") is the same weight as "Matters I manage 4". | F-24 | #918 |
| 10 | Empty and error states are not calm: five cards with toolbars and eight zeros for "nothing"; **six error blocks and six Retry buttons** for one failed call; on a phone one row title is squeezed into a one-letter column. | F-22, F-25, F-11 | #920, #921, #923 |

### What this review adds

23 new issues (MM-10 to MM-32, #903 to #925, 65.0 agent-hours) and detail comments on the nine issues already filed (#894 to #902, 24.0 agent-hours). Epic total **89.0 agent-hours** (nominal). A three-release cut is proposed (section 9): **Release 1 "Calm Overview" 40.5 h** gets the first task row to about 250 px and the page to about 40 percent of its height.

## 1. Method

* **Worktree** `/home/user/wt-mycalm` at `origin/dev`, own `node_modules` (`npm ci`), build with `deploy/publish.sh` (`SKIP_FRONTEND_INSTALL=1`), through the shared heavy-job gate.
* **Stack** SQL Server container (random loopback port), API on 5611 with `Auth__Provider=Dev`, demo data from `npm run seed:demo` (`tools/seed-demo`, 145 tasks, 12 matters, 60 assets, 50 users). Because the seeder creates every task "now", **At risk** (80 percent of the target turnaround used) and aged On hold tasks cannot occur; the throwaway database was adjusted with SQL (target days on three task types; creation date of a third of the open tasks moved 9 days back; hold start dates moved 1 to 12 days back). Issue #925 (MM-32) puts this into the seeder.
* **Personas** (the Project Manager role of the seeder; `docs/ux/pm-review/fixtures.md`):
  * **pm1, "1-matter PM"** = Test User 35, Primary of one matter (90003-80008 Demo Data breach response): 10 open, 1 overdue, 1 at risk, 1 unassigned, 1 on hold, 2 due in 7 days. (The seeder gives this user two matters; one manager was cleared through `PUT /matters/{id}/managers`.)
  * **pm3, "3+ matters PM"** = Test User 19 (out of office), Primary or Secondary of four matters (two Primary, two Secondary), four clients: 24 open, 9 overdue, 6 at risk, 10 unassigned, 4 on hold, 2 due in 7 days; 20 assets. (A 5-matter user, Test User 03, was also checked; same pattern.)
* **Sizes** 1366x768, 1920x1080, 768x1024, 375x812; Chromium (Playwright). Viewport and full-page screenshots of every tab for both personas (`before/`), element screenshots of every component (`before/components/`), states (`before/states/`): empty (filter to Secondary), loading (responses delayed 12 s), error (HTTP 500 on `/api/v1/my-matters/*`), "since" empty (Mark as read). 302 PNG files, palette-reduced to 128 colours to keep the repository small.
* **Measurement** `before/metrics.mjs` runs inside the page (the shell is excluded: only `main` is measured). *Controls* = visible links, buttons, inputs, selects, summaries, tabs. *Words* and *text lines* = visible text nodes (lines = distinct text-line tops). *Pixels above the first task row* = top of the first row that links to a task, in page coordinates (absolute, from the top of the page including the 56 px shell bar). *Repeated items* = task codes (TSK-n) shown more than once on the page. Raw numbers: `before/metrics.json` (124 measurements). Capture script: `before/stageA.mjs`.

## 2. Measurements

### 2.1 Overview (the screen the owner sent), first screen and whole page

| Size | Persona | First task row at (px) | Controls on first screen | Words on first screen | Controls on page | Words on page | Text lines on page | Page height (px) | Task links | Repeated task ids (extra copies) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1366x768 | 1-matter | **569** | 84 | 384 | 128 | 655 | 116 | 1,678 | 12 | 2 (2) |
| 1366x768 | 3+ matters | **569** | 85 | 417 | 157 | 984 | 209 | 2,599 | 28 | 2 (4) |
| 1920x1080 | 1-matter | 569 | 109 | 494 | | | | | | |
| 1920x1080 | 3+ matters | 569 | 114 | 597 | | | | | | |
| 768x1024 | 1-matter | 669 | 101 | 436 | | | | | | |
| 768x1024 | 3+ matters | 697 | 101 | 501 | | | | | | |
| 375x812 | 1-matter | **1,021** | 30 | 168 | 119 | 647 | 163 | 3,344 | 12 | 2 (2) |
| 375x812 | 3+ matters | **1,069** | 31 | 172 | 145 | 994 | 271 | 5,533 | 28 | 2 (4) |
| 1366x768, "since" empty (Mark as read) | 1-matter | 494 | 84 | 382 | 121 | 631 | 113 | 1,603 | 12 | 2 (2) |

The "empty Since" card still costs 82 px: pressing Mark as read moves the first row only from 569 to 494 px.

### 2.2 Where the 569 px go (1366x768, 3+ matters)

| Block | From to (px) | Height |
|---|---|---|
| Shell bar (search, Create task, bell, user) | 0 to 56 | 56 (not this page) |
| Title, scope switch, Focus, New task, one description sentence | 69 to 125 | 56 |
| Filter bar (Client, Role) | 141 to 194 | 53 (+16 gap) |
| Count strip, 8 values | 206 to 234 | 28 (+8) |
| Tab strip | 242 to 280 | 38 |
| Since your last visit (with changes) | 297 to 455 | 158 |
| First list header and its toolbar (title, Views, Export; Task types, Sort, arrow; group heading) | 455 to about 560 | 105 |
| **First task row** | **569** | |

Before the first task: **513 px of this page's own chrome**, 4 blocks that say who and what is shown (title, description, filters, strip), a tab strip, a card about changes and two toolbars.

### 2.3 Every tab at 1366x768 (3+ matters; 1-matter in brackets)

| Tab | First task row (px) | Controls on first screen | Controls on page | Words on first screen | Words on page | Text lines on page | Page height (px) | Task links |
|---|---|---|---|---|---|---|---|---|
| Overview | 569 | 85 (84) | 157 (128) | 417 (384) | 984 (655) | 209 (116) | 2,599 (1,678) | 28 (12) |
| Deadlines | 415 | 63 (59) | 67 (63) | 275 (223) | 287 (235) | 62 (52) | 773 (773) | 5 (2) |
| Breakdown | no task rows (matrix of links) | 75 (60) | 94 (60) | 292 (225) | 331 (225) | 68 (45) | 928 (773) | 0 |
| Data | no task rows | 55 (47) | 78 (62) | 270 (261) | 484 (432) | 73 (64) | 1,544 (1,397) | 0 |
| Activity | 415 | 55 | 101 | 290 (297) | 755 (757) | 92 | 1,966 | 30 |
| Trends | no task rows | 46 | 46 | 320 | 449 | 59 | 829 | 0 |

Note the Deadlines and Breakdown first rows: even on the sparse tabs the content starts at 415 px or lower because the same header, filter bar, strip and tab strip (about 345 px) sit above every tab.

### 2.4 Every tab at 375x812

| Tab | First task row (px) | Page height (px) 1-matter / 3+ | Words on page 1-matter / 3+ |
|---|---|---|---|
| Overview | 1,021 / 1,069 | 3,344 / 5,533 | 647 / 994 |
| Deadlines | 696 | 879 / 1,162 | 231 / 283 |
| Breakdown | no task rows | 1,140 / 2,153 | 193 / 307 |
| Data | no task rows | 2,543 / 2,961 | 405 / 471 |
| Activity | 797 | 4,272 | 756 |
| Trends | no task rows | 2,077 | 520 |

### 2.5 States (1366x768)

| State | Controls | Words | Page height | Note |
|---|---|---|---|---|
| Overview, everything empty (filter Secondary, 1-matter PM) | 78 on screen, 92 on page | 320 on screen, 364 on page | 789 | five cards, two toolbars, eight zeros, two "Clear filters" |
| Overview, all calls fail (3+ matters) | 47 | 256 | 925 | six messages, six Retry buttons |
| Overview, loading | 42 | 223 | 841 | grey bars, toolbars drawn |

## 3. Findings and per-tab review

Principles used (from the epic): show less by default (options in one place); show a thing once; show a value only when unusual; empty states one line; plain words; one pattern for the same thing; important things (overdue, at risk, decisions needed) catch the eye in three seconds.

### 3.1 Overview, component by component

**F-01 Above the fold.** See 2.1 and 2.2. 513 px of chrome before the first task. Phone: no task in the first screen (the first screen holds title, scope switch, New task, Filters, Focus, eight chips in a 2 x 4 grid, a tab strip and the first lines of "Since your last visit"). Fix: #903 (MM-10 layout and budget), #922 (MM-29 phone).

**F-02 Description sentence.** "The matters you manage as primary or secondary project manager. This is your default view, not a limit on what you can open." (24 words) on every visit, every tab; the scope switch next to it already says the same. Fix: #904 (MM-11).

**F-03 Filter bar.** 53 px on every tab; Client and Role are drawn for a PM with one matter (nothing to filter). Labels differ (Client 14 px bold, Role and Dates 13 px regular; controls are all 32 px high). "Role: Both" is unclear. On the Deadlines tab only, "Dates" appears and the bar changes shape. Fix: #906 (MM-13 show only when useful, same bar on every tab) and #899 (MM-06 wording).

**F-04 Count strip.** Eight values: Matters I manage, Open tasks, Overdue, At risk, Due in 3 days, Due in 7 days, Unassigned, On hold. Plain text, nothing says they are links. "Due in 3 days" equals "Due in 7 days" for both personas (2 and 2). "Matters I manage" is the scope (always 1 for the 1-matter PM). The same numbers are printed again in list headings ("Overdue (9)", "Unassigned (10)") and Trends ("On hold 4", "Open the 24 open tasks"). Fix: #902 (MM-07; recommended set of five chips: Overdue, At risk, Unassigned, On hold, Due in 7 days, plus a muted "24 open on 4 matters").

**F-05 At risk has no list.** The strip says At risk 6 but Needs my attention has no At risk group (the pills appear on rows). The number leads nowhere on this page. Fix: #905 (MM-12).

**F-06 Repeats.** pm3: TSK-49 and TSK-48 are shown three times each (Due soon, Unassigned, Upcoming deadlines); pm1: two tasks twice. Needs my attention prints "4 also listed under Overdue" and "1 also listed under Overdue". Fix: #896 (MM-03) and #905.

**F-07 Toolbars.** Needs my attention: Views, Export, Task types, Sort, direction arrow (5). Upcoming deadlines: Views, 2 wk, 4 wk, Task types, Sort, arrow (6). Plus header Focus. **12 controls and about 11 words before the first row of each list**, and Focus and Task types do the same job. Four popover styles (details for Views, Types, Focus; action menu for Export; New task menu). The arrow button is grey and looks disabled. Fix: #894 (MM-01 one Options), #898 (MM-05 sort), #907 (MM-14 one task-type filter).

**F-08 Views menu.** Opening it shows "A view keeps this list's filters and sort under a name. Only you can see your views.", "No saved views yet." and a Save form, for a feature no one has used. Fix inside #894.

**F-09 Row anatomy.** 53 px, two lines: icon, underlined task link ("TSK-86 Analytics / TAR Setup - 5": the "- 5" is the matter-local number and reads as a stray digit), then line 2: matter ref and name (a second underlined link) and one to three bordered pills ("Normal" on most rows, "Low", "High", "No assignee", "On hold", "At risk"), right column text. The right column means four things (reason, assignee, flag, time). Fix: #897 (MM-04), #901 (MM-09), #918 (MM-25).

**F-10 Needs my attention.** Four groups, up to ten rows each, "View all" under each group, group counts in headings. pm3: 10 + 2 + 6 + 1 rows, 1,339 px high (Upcoming deadlines next to it is 539 px; the grid leaves a white hole). No ranking inside the page: the PM must read all of it. Fix: #905 (MM-12).

**F-11 Phone defect.** In "On hold more than 7 days" the reason text takes the width and the task title is printed one or two characters per line over eight lines (`before/pm3-overview-375x812-full.png`). Fix: #923 (MM-30).

**F-12 Matter health.** One-matter PM: a 390 px card with a one-row table of facts already in the strip. Four matters: **all four are Red** (Red = any overdue task) so the column discriminates nothing; "1 overdue, +2 more" is cryptic; client and matter names wrap in narrow columns; eight columns; a "How is this decided?" link above the table; per row "New task" and "..." buttons. Fix: #908 (MM-15).

**F-13 Recent activity (Overview).** Five events, two lines each, actor as a raw account (`KE\kekim`), time "5:48 PM" with no date, a blank 60 px column left of the text (the unread marker), footnote "An event is unread until you mark all as read or open it." These are **the same five events** that "Show events (5)" in Since your last visit lists. Fix: #909 (MM-16), #916 (MM-23).

**F-14 Since your last visit.** 158 px with changes: six count links (34 reassigned, 21 comments, 39 new tasks ...) plus "Show events", plus "Mark as read"; on a first visit it prints the last seven days, a wall of numbers. Nothing changed: still an 82 px bordered card. Fix: #895 (MM-02) and #909 (MM-16).

**F-15 Header.** Four controls beside the title (My matters | All matters, Focus, New task v) **and a second create button in the shell bar ("Create task")**. For one matter the New task menu has two lines (the matter and "Another matter..."). Fix: #900 (MM-08), #904 (MM-11).

**F-16 Tab strip.** Six tabs (Overview, Deadlines, Breakdown, Data, Activity, Trends). Overview already holds a list of deadlines and of activity, so two tab names have a smaller twin on the first page. On a phone Data, Activity and Trends are off screen (a chevron). Kept as is; the twin lists shrink (#896, #909) and Trends is lowered in rank (#917). Q5 asks whether to hide it.

### 3.2 Deadlines tab (3+ matters shown, `before/pm3-deadlines-*`)

What is there: shared header, filter bar with the extra "Dates" control, strip, tab strip; a panel "Deadlines" with 2 weeks / 4 weeks, List / Calendar, Task types; tasks grouped by matter ("90005-80005 Demo Patent dispute (2)  Demo Litware Health"), each row: icon, task link, "Tue Oct 27 . Unassigned" and pills. Calendar view: a four-week grid, mostly empty, titles truncated ("Incoming Production ...").

* **F-17** Two controls for one choice (Dates drop-down and 2/4 weeks buttons); heading repeats the tab name; matter headings with counts even for one matter; Calendar for five tasks; a near twin of the Overview list.
* Fix: #910 (MM-17).

**Calm layout, Deadlines, 1366x768, 1-matter PM** (about 230 px to the first row):

```
My Matters                                             [All matters] [Options]
Overdue 1   At risk 1   Unassigned 1   On hold 1   Due in 7 days 2   . 10 open
Overview | [Deadlines] | Breakdown | Data | Activity | Trends
Next  [ 2 weeks | 4 weeks | Custom ]                            [ Options v ]
Tue 27 Oct  (today)
  [icon] TSK-103 Incoming Production Intake            Test User 09
Thu 29 Oct
  [icon] TSK-142 Search and Culling   High             Test User 36
Fri 13 Nov
  [icon] TSK-12  Review Setup and Batching  at risk    no assignee
```

**3+ matters:** the same, grouped by day; the matter as short grey text after the title (two-line rows only on a phone); matter headings only if the owner wants "by matter" (Options > Group by matter). Calendar in Options.

### 3.3 Breakdown tab (`before/pm3-breakdown-*`)

Matrix: matters (rows) x task types (columns), counts per cell, "N overdue" red link under each count, a total row, header Export, Per matter | All matters, Open tasks | On hold only, "24 open tasks on 4 matters, 9 task types", "Open tasks per matter and task type. A cell opens the Task Queue with those tasks."

* **F-18** Four-line column headers; most cells "-"; two links per cell; the "All matters" toggle means something else than the scope's "All matters"; the sentences repeat the strip; for one matter the single row and the total row are identical; phone: one tall card per matter (2,153 px for four).
* Fix: #911 (MM-18), #912 (MM-19), #919 (MM-26 toggle words).

**Calm layout, 1366x768, 3+ matters:**

```
Matter                    Relativity  Review  Incoming  Archive  Harvey  Data Load   ...   (only types in use)
90003-80003 Regulatory        3        1        1        1 !      1 !      -
90004-80004 Merger            1        1 !      -        1        -        1
90001-80006 Employment        1        -        3        1 !      -        1
90005-80005 Patent            1 !      -        1        -        -        1
Total                         6        2 !      5        3        2        3
                                                        [ Options v ]  ( ! = has overdue, red number )
```

**1-matter PM:** one row, no total, only types in use; the matrix becomes a short list "Relativity Workspace Setup 3 (1 overdue)".

### 3.4 Data tab (`before/pm3-data-*`)

Card 1 "Data": Asset type select; "Warnings (1)" with a bordered box "2 assets wait for disposition (oldest 0 days). Show"; stats "Assets 20, Size 989.98 GB + 5,556 Items, Active 14, Inactive 2, Pending 2, Disposed 2"; paragraph about units; "By matter" table (six numeric columns, total row); "By asset type" table with a "Measured by" column ("volume_gb (GB)", "file_count (MB)"); paragraph. Card 2 "Data volume over time": Matter, Period, Unit selects, Chart / Show as table, "Highest 989.98", a bar chart where 11 of 12 bars are flat, three sentences of caveat ("No history is recorded").

* **F-19** Too many tables and caveats (about 90 words of caveats), raw setup names shown to a PM, unlike units summed ("GB + Items"), a chart that the page itself calls derived and unreliable, a table of one matter plus its identical total row (1-matter).
* Fix: #913 (MM-20), #914 (MM-21).

**Calm layout, 1366x768, 3+ matters:**

```
Data                                                     [ i ]  [ Options v ]
20 assets  .  990 GB  .  14 active          ! 2 assets wait for disposition  Show
[ By matter | By asset type ]
Matter                         Assets     Size        Active  Pending  Disposed
90001-80006 Employment            5     343 GB            3        1         1
90003-80003 Regulatory            5     276 GB            4        1         -
90004-80004 Merger                5     269 GB            3        1         1
90005-80005 Patent                5     102 GB            4        -         -
(Inactive column appears only when some asset is inactive. Volume over time: hidden until there is history.)
```

**1-matter PM:** no matter table; "By asset type" is the table.

### 3.5 Activity tab (`before/pm3-activity-*`)

A flat list of 25 two-line events (50 text lines; 755 words) with Matter box, Kind, Unread only, and "Load more".

* **F-20** A task produces three to five events (created, assigned, in progress, cancelled); the events that matter (on hold, overdue, cancelled, reassigned away) drown; no day headings and the same clock time on every row; account names; matter link under every row; blank left column.
* Fix: #915 (MM-22), #916 (MM-23).

**Calm layout, 1366x768:**

```
Activity                                                       [ Options v ]  (Kind, Unread only, Matter)
Today
 . 17:48  TSK-29 Relativity Workspace Setup   created, assigned to Dana Rao, then cancelled   (3 events)
 . 17:47  TSK-13 Review Setup and Batching    moved to On hold by Dana Rao                      Merger
   17:47  TSK-26 Relativity Workspace Setup   created, assigned to Priya Rao                    Patent
Yesterday
 . 09:10  TSK-19 Incoming Production Intake   moved to On hold                                  Employment
                                                                       [ Show earlier days ]
(. = needs a decision; matter name only with several matters)
```

### 3.6 Trends tab (`before/pm3-trends-*`)

"Approximate. Worked out from today's data, not recorded week by week" (grey bar); chart 1 "Overdue at week end" (a flat zero line then one point), chart 2 "Created and closed per week" (two bars), each with heading, sentence, legend, "Show as table"; blocks "Average age of open tasks 2.6 days" and "On hold 4" with links "Open the 24 open tasks", "Open the tasks on hold"; "How is this counted?".

* **F-21** The banner reads as a warning; charts built from today's data are artefacts (flat line); two blocks repeat the strip; sentences repeat charts.
* Fix: #917 (MM-24). Trends is already "low priority" by the owner (AN item 3).

**Calm layout:** one line "Overdue was 0 until this week; now 9" when the history is flat; charts only when they have a shape; "Created and closed per week" as one small chart; "Average age 2.6 days" as one muted line; one `i` for "How is this counted?" and "Show as table".

### 3.7 Cross-cutting findings

**F-22 Empty states.** Five cards with toolbars for "nothing", eight zeros, two Clear filters. Fix: #920 (MM-27).

**F-23 One pattern for the same thing.** Seven two-button toggles that look alike and mean different things ("All matters" twice, "2 wk" and "2 weeks", "Per matter"); four popover styles. Fix: #919 (MM-26), #894.

**F-24 What catches the eye.** 28 task links on the 3+ matters Overview, pills on most rows, red used as an icon plus word (strip), a "Red" flag on every matter, red "N overdue" links (Breakdown). There is no focal point; the number the PM needs ("9 overdue, 6 at risk") is one of eight equal values. Fix: #918 (MM-25).

**F-25 Loading and error.** Loading is calm (grey bars) but keeps toolbars; one failed call shows six messages and six Retry buttons; the strip error pushes the tab strip down 40 px. Fix: #921 (MM-28).

**F-26 Plain words.** Examples to change: "Matters I manage", "Role: Both", "Task types: All types", "Views", "Focus", "Matter health ... Flag", "% complete", "Per matter / All matters", "Measured by volume_gb (GB)", "Disposition", "Approximate. Worked out from today's data", "Due soon" vs "Due in 3 days" vs "Upcoming deadlines" for related ideas. The wording work is part of each issue above (acceptance lines); a glossary of the words the PM uses (late, at risk, no assignee, on hold, due this week) lives in section 3.8.

### 3.8 Words the page should use (proposed)

| Today | Proposed |
|---|---|
| Needs my attention | Needs my attention (keep) |
| Overdue / At risk / Unassigned / On hold | same, with the number first ("9 overdue") |
| Due soon (3 d), Due in 3 days, Due in 7 days | Due in 7 days (one) |
| Upcoming deadlines | Next 7 days (Overview), Deadlines (tab) |
| Matter health | Matters |
| Flag Red / Amber / Green | "5 overdue", "3 at risk" (counts) |
| Role: Both / Primary / Secondary | I am: Primary or secondary / Primary / Secondary |
| Per matter / All matters (Breakdown) | By matter (checkbox) |
| Show events (5) | (removed; Activity tab) |
| Measured by volume_gb (GB) | (removed from the PM's table) |

## 4. Component register (every component: verdict)

| Component | What it costs today | Verdict | Issue |
|---|---|---|---|
| Page header: title, scope switch, Focus, New task | 4 controls, 56 px, 24-word sentence | **Remove** sentence and duplicate create; **move** Focus and scope into the Options/phone overflow; keep title | #904, #900, #922 |
| Filter bar | 53 px, 2 to 3 controls, 3 label styles | **Remove** when it cannot filter; same bar on every tab; **move** Dates into the Deadlines tab | #906, #899, #910 |
| Count strip | 8 values, 28 px (phone 190 px) | **Merge** to 5 chips + one muted open count; chips are buttons; zeros muted | #902, #922 |
| Tab strip | 6 tabs, 38 px | Keep; Trends last; scroll cue on phone | #917 |
| Since your last visit | 158 px / 82 px empty | **Merge** with Recent activity into one line, only when something changed | #895, #909 |
| Needs my attention | 4 groups, 1,339 px, 5 controls | **Merge** groups into one ranked list of 5 with a reason column; add At risk | #905 |
| Upcoming deadlines (Overview) | 6 controls, repeats | **Merge/shrink** to "Next 7 days", 5 rows, no toolbar | #896, #910 |
| Matter health | 390 px for one row; all Red | **Remove** for one matter; graded counts for several | #908 |
| Recent activity (Overview) | 367 px, same 5 events as Since | **Remove** from Overview | #909 |
| List toolbars (Task types, Sort, arrow, Views, Export) | 5 controls per list | **Move** into one Options; **merge** Task types into Focus | #894, #898, #907 |
| Views menu | help text + empty state + form | **Move** into Options, help only when empty | #894 |
| Export | 1 control per list | **Move** into Options | #894 |
| Focus | button and chip | **Merge** with per-list Task types; shown as a chip only when set | #907 |
| Row anatomy | 53 px, 2 links, 1 to 3 pills | **Remove** matter text for one matter, Normal/Low pills; one link; one line | #897, #901, #918 |
| Deadlines tab | 2 range controls, heading, group counts, calendar | **Merge** range controls; group by day; calendar to Options | #910 |
| Breakdown tab | 4-line headers, 2 links per cell, 75 controls | **Remove** empty columns, total for one matter; compact phone | #911, #912 |
| Data tab | 2 tables, 90 words of caveats, flat chart | **Merge** tables; **move** caveats to an info point; **remove** chart without history | #913, #914 |
| Activity tab | 25 two-line events, 3 filters | **Merge** per-task chains, day headings; **move** filters to Options | #915, #916 |
| Trends tab | banner, flat charts, strip repeats | **Remove** repeats and flat charts; slim | #917 |
| Empty states | 5 cards, toolbars, zeros | One line | #920 |
| Loading | skeleton, keeps toolbars | Skeleton without toolbars, fixed height | #921 |
| Error | 6 messages, 6 Retry | One banner, one Retry | #921 |
| Phone | first task at 1,021 px | One header row, one chip row, tasks in first screen | #922, #923 |

## 5. Proposed "calm" Overview

### 5.1 1-matter PM, 1366x768 (target: first task row at about 250 px, page about 700 px)

```
+----------------------------------------------------------------------------------------------+
| MatterFlow   [ search ........................ ]  [+ Create task]      bell   Test User 35      |  56 shell
+----------------------------------------------------------------------------------------------+
 My Matters   90003-80008 Demo Data breach response                      [All matters] [Options]     36
 [ 1 overdue ] [ 1 at risk ] 1 unassigned   1 on hold   2 due in 7 days        . 10 open            32
 Overview | Deadlines | Breakdown | Data | Activity | Trends                                          38
 ---------------------------------------------------------------------------------------------
 Since your last visit: 1 became overdue, 1 put on hold            [Mark as read]   (only if changed) 24
 NEEDS MY ATTENTION                                                           View all 4             28
  [icon] TSK-117 Relativity Workspace Setup - 21                            19 d overdue     <- 250
  [icon] TSK-47  Access Request - 2                                         no assignee
  [icon] TSK-103 Incoming Production Intake - 16                            due today
  [icon] TSK-39  Collection Receipt - 7                                     on hold 12 d
 NEXT 7 DAYS                                                              All deadlines
  Thu 29 Oct   TSK-142 Search and Culling   High                           Test User 36
```

Removed for this persona: description sentence, filter bar, Matter health, Recent activity, the Upcoming list's toolbar, all list toolbars, the Matters-I-manage chip, the Task types and Sort controls. Moved: Focus and scope into Options. Merged: Since and Recent activity, Due soon / Unassigned / Overdue / On hold groups into one list. Controls on the first screen drop from 84 to about 25, words from 384 to about 120 (estimates, to be measured by MM-31).

### 5.2 3+ matters PM, 1366x768 (target: first task row at about 270 px, 320 px when the filter bar is needed; page about 1,100 px)

```
 My Matters                                                       [My matters | All matters] [Options]   36
 [ 9 overdue ] [ 6 at risk ]  10 unassigned   4 on hold   2 due in 7 days          . 24 open on 4 matters   32
 Overview | Deadlines | Breakdown | Data | Activity | Trends                                                38
 ---------------------------------------------------------------------------------------------
 Since your last visit: 2 became overdue, 4 put on hold, 9 completed                [Mark as read]       24
 NEEDS MY ATTENTION                                                                  View all 25      28
  [icon] TSK-86  Analytics / TAR Setup      Regulatory inquiry     High             23 d overdue  <- 270
  [icon] TSK-137 Relativity Workspace Setup Patent dispute                          22 d overdue
  [icon] TSK-125 Archive and Disposition    Employment                              20 d overdue
  [icon] TSK-48  Incoming Production Intake Employment             Critical, at risk   due tomorrow
  [icon] TSK-49  Incoming Production Intake Patent                 no assignee      due today
 NEXT 7 DAYS                                                                       All deadlines
  (2 rows not already shown above)
 MATTERS                                                                     All matters (4)
  90003-80003 Regulatory inquiry   [ 5 overdue ] 5 unassigned           next Nov 26
  90004-80004 Merger second req.   [ 2 overdue ]                        next Dec 5
  90001-80006 Employment           [ 1 overdue ] 1 at risk              next Oct 28
  90005-80005 Patent dispute       [ 1 overdue ]                        next Oct 27
```

Matters are sorted worst first; the red chip carries the number. The Client and Role filters appear only if the matters belong to several clients or are mixed Primary and Secondary. This persona has four clients and both roles, so the filter bar stays (one 53 px row) and the first task row is then at about 320 px; with one client it is not drawn.

### 5.3 Phone 375x812 (target: two task rows in the first screen)

```
 [=] MatterFlow        [search] [+] [bell]
 My Matters                          [...]    <- scope, Focus, New task inside
 [9 overdue][6 at risk][10 unassigned]-> (one scroll row, 44 px)
 Overview | Deadlines | Breakdown | >        <- scroll cue
 Since: 2 became overdue ...      [Mark read]
 NEEDS MY ATTENTION
  TSK-86 Analytics / TAR Setup     23 d overdue
  TSK-137 Relativity Workspace ... 22 d overdue
```

## 6. What to remove, move, merge (one list)

**Remove:** the description sentence; the second create button; Client and Role when they cannot filter; "Matters I manage" and "Due in 3 days" chips; Since's six counts (keep four decision counts); Recent activity on the Overview; "Show events"; the "N also listed under" notes; four "View all" links (keep one); per-list Task types, Sort, direction arrow on the Overview; Matter health for one matter; "Normal" and "Low" priority pills; the matter name on every row for one matter; "Measured by" column; mixed-unit sums; the flat charts; the "Approximate" bar; the Trends repeats of the strip; empty-column headers in Breakdown; the second link in every Breakdown cell; six Retry buttons.
**Move:** Views, Export, Sort, Kind, Unread only, Asset type, Calendar, Group by matter into one Options per tab; Dates into the Deadlines tab; Focus and the scope into the phone overflow; caveat paragraphs into one info point; hold reasons into tooltips; "How is this decided?" into an info point.
**Merge:** Since your last visit + Recent activity; the four attention groups into one ranked list; Focus + per-list Task types; Dates drop-down + 2/4 weeks; By matter + By asset type tables; per-task event chains in Activity.

## 7. Issues

Existing (extended by a comment each, no duplicates created): #894 MM-01 Options (5.0 h), #895 MM-02 Since (1.5), #896 MM-03 no repeats (3.0), #897 MM-04 rows (4.0), #898 MM-05 sort (2.0), #899 MM-06 filters (2.0), #902 MM-07 chips (3.0), #900 MM-08 header (2.0), #901 MM-09 right-hand (1.5) = **24.0 h**.

New (all label `phase-24`, sub-issues of #893, acceptance criteria in each):

| # | ID | Title | Area | Agent-h |
|---|---|---|---|---|
| #903 | MM-10 | Overview calm layout: one column, attention first, first task row within 300 px | Overview | 4.0 |
| #904 | MM-11 | Title block: no description sentence, one create-task button | Header | 1.0 |
| #905 | MM-12 | Needs my attention: one ranked list with a reason, five rows, one View all, includes At risk | Overview | 4.5 |
| #906 | MM-13 | Show a filter only when it can change the result; same bar on every tab | Filter bar | 2.0 |
| #907 | MM-14 | One task-type filter (Focus) instead of one per list | Toolbars | 2.5 |
| #908 | MM-15 | Matter health: hidden for one matter, graded counts for several | Overview | 4.5 |
| #909 | MM-16 | One "what changed" block: merge Since your last visit and Recent activity | Overview | 3.0 |
| #910 | MM-17 | Deadlines tab: one range control, group by day, calendar optional | Deadlines | 3.0 |
| #911 | MM-18 | Breakdown: only task types in use, one total, one toggle, no repeated sentence | Breakdown | 3.0 |
| #912 | MM-19 | Breakdown on a phone: compact cards | Breakdown | 2.0 |
| #913 | MM-20 | Data tab: one summary line, one table, plain words, no mixed-unit sums | Data | 4.0 |
| #914 | MM-21 | Data tab: warnings as one line, caveats behind one info point, volume only with history | Data | 2.5 |
| #915 | MM-22 | Activity tab: day groups, one line per event, fold per-task chains | Activity | 4.5 |
| #916 | MM-23 | Activity: names, dates, matter only when several, filters behind Options | Activity | 2.5 |
| #917 | MM-24 | Trends: slimmer, no repeats, no flat charts | Trends | 3.0 |
| #918 | MM-25 | Catch the eye in three seconds: late-work headline, colour/link/pill budget | All | 4.0 |
| #919 | MM-26 | One toggle pattern and plain labels | All | 1.5 |
| #920 | MM-27 | Empty states one line, no toolbars, one Clear filters | States | 2.0 |
| #921 | MM-28 | Loading and error: one message and one Retry per page | States | 2.0 |
| #922 | MM-29 | Phone first screen: tasks within the first screen | Phone | 3.5 |
| #923 | MM-30 | Phone defect: squeezed on-hold row title; "..." after pills | Phone | 1.0 |
| #924 | MM-31 | Calm budget test and after-screenshots | Test | 3.0 |
| #925 | MM-32 | Demo data for the review: one-matter PM, at-risk and aged on-hold tasks | Data | 2.0 |
| | | **New total** | | **65.0** |

Epic total: 24.0 + 65.0 = **89.0 agent-hours** (nominal).

## 8. Prioritised order: most calm for least work

Calm gain is estimated from the measurements (pixels and controls removed from the first screen or the page).

| Rank | Issue | Hours | What it removes |
|---|---|---|---|
| 1 | #904 MM-11 | 1.0 | 17 px + second create button |
| 2 | #923 MM-30 | 1.0 | a real defect on phones |
| 3 | #920 MM-27 | 2.0 | 4 cards, 78 controls of an empty page |
| 4 | #906 MM-13 | 2.0 | the 53 px filter bar for a 1-matter PM; one Clear filters |
| 5 | #909 MM-16 (with #895) | 3.0 (+1.5) | 158 px + 367 px, 12 repeated events |
| 6 | #902 MM-07 | 3.0 | 3 of 8 chips; chips become buttons |
| 7 | #905 MM-12 | 4.5 | 1,339 px to about 420 px; three repeats; At risk gets a list |
| 8 | #908 MM-15 | 4.5 | 390 px for one matter; the all-Red wall |
| 9 | #894 MM-01 | 5.0 | 12 toolbar controls per screen |
| 10 | #896 MM-03 | 3.0 | the remaining repeats |
| 11 | #897 MM-04 | 4.0 | row height and pills |
| 12 | #903 MM-10 | 4.0 | layout, no white hole, the budget |
| 13 | #918 MM-25 | 4.0 | the focal point |
| then | tabs | | #917 to #916, #911, #913, #915, #912, #914, #910, phone #922, states #921, test #924 |

Step 0 (enabler, 2.0 h): #925 MM-32, so each later issue is checked against realistic data.

## 9. Recommended first-release cut

**Release 1 "Calm Overview", 40.5 agent-hours:** #925, #904, #920, #906, #923, #909 (with #895), #902, #905, #908, #894, #896, #897, #903. Result (estimated, to be measured): first task row at about 250 px (from 569) at 1366x768; Overview 700 px (1-matter) and about 1,100 px (3+) tall (from 1,678 and 2,599); controls on the first screen about 25 (from 84); words about 120 (from 384); no task twice.

**Release 2 "Calm details", 21.5 h:** #918, #919, #921, #922, #924, #898, #899, #900, #901.
**Release 3 "Calm tabs", 27.0 h:** #907 (needs the owner, Q2), #910, #911, #912, #913, #914, #915, #916, #917.

Dependencies are in `delivery-plan.md`.

## 10. Open questions (recommended answer first)

| # | Question | Recommended answer | Why |
|---|---|---|---|
| Q1 | May a task be listed only once per screen, in its most urgent place? | **Yes.** | It removes the repeats and makes counts meaningful; "View all N" still opens the full list. |
| Q2 | One Focus filter for the whole page instead of a Task types button in each list (this reverses part of AN item 2)? | **Yes, keep Focus, remove the per-list filter.** | Two mechanisms for one job is the most confusing sentence on the page; the Focus chip makes the state visible. |
| Q3 | Replace the Red/Amber/Green flag in Matter health by counts (5 overdue, 3 at risk)? | **Yes.** | With the current rule every matter with any overdue task is Red; the number discriminates, the word does not. Keep the rule text in an info point. |
| Q4 | Keep the list of events inside Since your last visit? | **No** (counts on one line; events live on the Activity tab). | The same five events are on the page twice. |
| Q5 | Hide Trends until there are four weeks of data? | **No**; keep the tab, show a one-line sentence when history is flat. | Hiding a tab makes the strip change between people. |
| Q6 | Should the matter switcher of #900 also set a page filter? | **No**; it only chooses the matter for New task. | A second scope filter would be one more thing to explain. |
| Q7 | Remove Recent activity from the Overview? | **Yes.** | The Activity tab and Since line cover it. |
| Q8 | Keep the Deadlines Calendar? | **Yes, behind Options.** | Rarely used; hiding it costs nothing. |
| Q9 | Hide Data volume over time until asset size has history? | **Yes.** | It is derived from creation month and says so; it shows a shape that is not true history. |
| Q10 | The five chips: Overdue, At risk, Unassigned, On hold, Due in 7 days, plus a muted open count? | **Yes.** | "Due in 3 days" is always inside "7 days" and equal in the demo; "Matters I manage" is the scope. |
| Q11 | Enforce budgets in a test (first row at most 300 px, first screen at most 25 controls and 150 words)? | **Yes, after Release 1 lands, numbers set from the measured result.** | Stops the page from getting busy again one addition at a time. |

## 11. Evidence index

* Whole tab, viewport: `before/{pm1|pm3}-{overview|deadlines|breakdown|data|activity|trends}-{1366x768|1920x1080|768x1024|375x812}.png`; full page at 1366 and 375: same name with `-full`.
* Components (header, filter-bar, count-strip, tab-strip, since, needs-attention, upcoming-deadlines, health, recent-activity; popovers: attention-views-open, attention-task-types-open, attention-export-open, focus-open, new-task-menu, since-expanded, health-row-menu, client-filter-open, filters-sheet on a phone; tab controls: deadlines-calendar, breakdown-onhold, breakdown-all-matters, breakdown-export, data-volume-table, activity-unread-only, trends-explained, trends-table): `before/components/`.
* States: `before/states/{empty|loading|error}-{tab}-{size}.png`, `since-empty-*`.
* Numbers: `before/metrics.json`; scripts: `before/metrics.mjs`, `before/stageA.mjs`, `before/lib.mjs`.

Limits of this review: the demo data are generated (names "Test User nn", demo matters), the at-risk and hold ages were set with SQL on the throwaway database, one browser (Chromium), no screen-reader run (the issues keep the existing axe gate and ask for accessible names), pm3 has only four matters (a 40-matter PM would make Matter health and Breakdown taller, which strengthens #908 and #911).

## 8. Result after Release 2 ("Calm details") and the calm budget

Measured on the real app with the demo data (`npm run seed:demo -- --tasks 150 --seed 7 --aged` on a fresh database), the same two people (pm1: one matter, pm3: three matters), the same script (`after/stageA.mjs`, `after/metrics.mjs`) and the "reach" and "seen" method: only controls a person can reach (closed popovers, skip links and the shell's own controls left out) and words a person sees (closed popovers, the screen-reader-only sentence left out) inside the first screen. **The baseline was measured again with the same method** on the build of `e2dd52e` (the base of the review) and the same demo data (`after/metrics-baseline-remeasured.json`), so the old counts of this README (84 controls, 384 words), which counted hidden things, are not mixed with the new ones.

| 1366x768, Overview | Baseline (same method) | After batch 4 | **After Release 2** | Target | Met? |
|---|---|---|---|---|---|
| First task row, one matter / three matters | 569 / 569 px | 257 / 297 | **233 / 273 px** | about 250 / 270, 300 at most | yes |
| Controls reached on the first screen, one matter | 45 | 30 | **24** | about 25 | yes |
| Controls reached on the first screen, three matters | 47 | 39 | **36** | about 25 | **no** |
| Words seen on the first screen, one matter | 191 | 146 | **122** | about 120 to 150 | yes |
| Words seen on the first screen, three matters | 213 | 246 | **218** | about 120 to 150 | **no** |
| Page height, one matter / three matters | 1,996 / 2,513 px | 773 / 894 | **773 / 798 px** | about 700 / 1,100 | yes |
| Repeated task ids | 6 / 7 | 0 | **0** | none | yes |

| 375x812 phone, Overview | Baseline | After batch 4 | **After Release 2** | Target | Met? |
|---|---|---|---|---|---|
| First task row | 1,021 / 1,069 px | 326 / 326 | **278 / 278 px** | 420 | yes |
| Controls reached / words seen (one matter) | 25 / 75 | 22 / 102 | **19 / 96** | | |
| Controls reached / words seen (three matters) | 26 / 79 | 21 / 110 | **19 / 100** | | |

Why the three-matter person is not at 25 and 120 to 150: the first screen now holds MORE of the page (the first task row moved from 569 to 273 px, so Needs my attention, Next 7 days and all three matter rows fit), so it carries more words than the baseline (218 against 213) even though every part got shorter. What is left on it (36 controls): the header (Options, New task, Matter chooser = 3), Client and Role (2), the strip (6), the tabs (6), Needs my attention (View all, Options, 5 rows = 7), Next 7 days (All deadlines, 3 rows = 4), and the Matters list (All matters, the info button and three rows with their menu = 8). The matter name stays on every row (owner decision, Cut 4 not chosen), which is about 4 words on each of the 8 rows. Cuts that remain if the owner wants the number: the Matters list below the fold (a Matters section that starts under the first screen), the row menus of the Matters list (New task is also in the header chooser), the Export Options of Needs my attention (into the header Options).

The first thing the three-second test shows at 1366x768 is "5 overdue  2 at risk" in large red and amber type under the title (`after/pm3-overview-1366x768.png`); the owner names what they see first (acceptance of #918).

### The calm budget (#924)

`frontend/e2e/tests/mm-calm-budget.spec.ts` measures the first screen (the same function as `metrics.mjs`, `frontend/e2e/support/calm-metrics.ts`) for both people at 1366x768 and 375x812 on a busy fixture (five late tasks, three due soon) and fails, printing the measured numbers, when a budget is passed. It runs in 20 seconds.

| Budget (Overview) | One matter, 1366x768 | Three matters, 1366x768 | Phone (both) | Why |
|---|---|---|---|---|
| First task row | 300 px | 300 px | 420 px | the issue's numbers; measured 233, 273, 278 |
| Controls on the first screen | 25 | 37 | 22 | one matter: the issue's 25 (measured 25); three matters: measured 36 plus one, the number is a ceiling and the 25 stays open; phone measured 20 |
| Words on the first screen | 150 | 215 | 110 | one matter: the issue's 150 (measured 125); three matters: measured 207; phone measured 93 to 99 |
| A task id twice on the Overview | none | none | none | measured 0 |

The Deadlines and Activity tabs are not rebuilt yet (Release 3), so they get a ratchet at their measured numbers plus about 5 percent (Deadlines: row 400 / 430 px, controls 30 / 22, words 125 / 90; Activity: row 400 / 560 px, controls 42 / 27, words 215 / 90, desktop / phone). Release 3 lowers them.

Screenshots of every tab at four widths for both people are in `after/` under the file names of `before/`; `after/listControls.mjs` lists the controls of a screen (where a budget goes); the numbers of each batch are kept in `after/metrics-batch*.json`.
