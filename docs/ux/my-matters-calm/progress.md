# My Matters, a calmer page: progress

## Batch 1 (epic #893): #925, #904, #920, #906, #923

Measured on the real app (published API, Dev auth, `npm run seed:demo -- --tasks 150 --seed 7 --aged`), same personas and sizes as `before/` (pm1 = Test User 35, one matter; pm3 = Test User 19, three matters). Scripts: `after/stageA.mjs` (screens, `after/metrics.json`) and `after/stageStates.mjs` (empty state, `after/states/`). Screenshots are in `after/` with the file names of `before/`.

Caveat: `before/` was measured on a smaller, differently adjusted database (145 tasks, SQL fixes). The new seeder data has more activity, so the "Since your last visit" card is taller and the control and word counts of the first screen are NOT comparable (they rose by 3 to 100 words because of the data, not the layout). The pixel gains below are structural and exact: description line 17 px, filter bar 53 px, gaps 15 px.

| Overview | Before | After batch 1 |
|---|---|---|
| 1366x768, 1-matter: first task row | 569 px | **484 px** (-85: no description, no filter bar) |
| 1366x768, 3 matters: first task row | 569 px | **549 px** (-20; the bar stays: several clients and both roles) |
| 1920x1080, 1-matter / 3 matters | 569 / 569 | 484 / 549 |
| 768x1024, 1-matter / 3 matters | 669 / 697 | 612 / 677 |
| 375x812, 1-matter / 3 matters | 1,021 / 1,069 | 977 / 1,069 (phone work is #922) |
| Controls on first screen, 1366x768, 1-matter | 84 | 91 (data, see caveat) |
| Words on first screen, 1366x768, 1-matter | 384 | 460 (data, see caveat) |

| Nothing to show (1-matter person filtered to Secondary), 1366x768 | Before | After |
|---|---|---|
| Controls on screen | 78 | **28** (shell, header and the Role filter that is in force) |
| Words on screen | 320 | **117** |
| Content under the tab strip | five cards | **67 px**, one line per section |
| "Clear filters" buttons | 2 | 1 |
| Strip | eight zeros | not drawn |
| Empty tabs at 1366x768 (Deadlines, Breakdown, Activity) | controls + sentence | 27 px of content (Deadlines keeps its one Dates select) |

Phone defect (#923): on hold rows at 375 px now show the full title, the matter line (name cut with an ellipsis, pills never cut) and the reason below (`after/pm3-overview-375x812-full.png`).

Demo data (#925): after the seed, pm1 has 1 matter, 11 open, 1 overdue, 2 at risk, 3 unassigned, 3 on hold (oldest 21 days); pm3 has 3 matters, 24 open, 5 overdue, 1 at risk, 6 unassigned, 4 on hold (oldest 21 days).

Initial bundle: 645.43 kB (unchanged, limit 700 kB).

Not in batch 1 (stays for the next batches): Matter health still has a "New task for" button per row, so a one-matter person sees it beside the shell "Create task" until #908 removes the table for one matter; the asset count above 1,000 on a persona matter (the issue's e2e fixture wish) was not built (1,000 assets through the API is too slow; Release 3 Data tab issues need it).

## Batch 2 (epic #893): #909 with #895, #902, #908, #905

Same method, personas and sizes as batch 1 (real app, published API, Dev auth, `npm run seed:demo -- --tasks 150 --seed 7 --aged`; scripts `after/stageA.mjs` and `after/stageStates.mjs`, screenshots in `after/` with the same file names, batch 1 numbers kept in `after/metrics-batch1.json`). The numbers below are measured on a fresh database seeded the same way.

| Overview | After batch 1 | After batch 2 |
|---|---|---|
| 1366x768, 1-matter: first task row | 484 px | **341 px** |
| 1366x768, 3 matters: first task row | 549 px | **406 px** |
| 1920x1080, 1-matter / 3 matters | 484 / 549 | 341 / 406 |
| 768x1024, 1-matter / 3 matters | 612 / 677 | 429 / 494 |
| 375x812, 1-matter / 3 matters | 977 / 1,069 | 755 / 803 |
| Page height 1366x768, 1-matter / 3 matters | 1,878 / 2,440 px | **773 / 1,374 px** |
| Controls on the first screen, 1366x768, 1-matter / 3 matters | 91 / 88 | 93 / 91 |
| Words on the first screen, 1366x768, 1-matter / 3 matters | 460 / 417 | 457 / 461 |
| Task links on the page, repeated task ids (pm1 / pm3) | 20 links, 4 ids repeated (6 extra) / 31 links, 5 repeated (7 extra) | **0 repeated, 0 extra** |
| Needs my attention, 3 matters, 1366x768 | 1,339 px in the review, four groups | **400 px**, five rows, one View all 15 |
| "What changed" block | 158 px card + 367 px Recent activity card | **24 px line**, nothing when nothing needs a decision |
| Matter health, 1-matter | 390 px card | **not drawn** (the matter is named and linked in the strip) |
| Matter health, 3 matters | table, 8 columns, all Red | **189 px**, one line per matter, counts, worst first |

Controls and words on the first screen did not fall (the filters, tab strip and two toolbars above the lists are still there and the chips carry words): they are #894 (Options), #897 (lighter rows) and #903 (layout and budget), batch 3. The first task row and the page height did fall, and no task id is listed twice any more.

Empty page (1-matter person filtered to Secondary): 28 controls, 116 words, 55 px of content under the tabs, unchanged from batch 1.

What was built:

* **#909 + #895** One line, "Since your last visit: 2 became overdue, 4 put on hold, 9 completed, 3 new unassigned", each part a link, "Mark as read" at its end; without a marker "In the last 7 days:". Nothing is drawn (0 px, no card) when none of the four changed. Recent activity is gone from the Overview and so are the events inside the old card; the Activity tab keeps them. New API figure `newUnassigned` (open unassigned tasks created after the period's start). The marker still moves only on Mark as read and when the Activity tab is first read; the Overview no longer reads the events, so the Activity tab now creates the starting point of the unread marks on its own first visit.
* **#902** Five chip buttons (Overdue, At risk, Unassigned, On hold, Due in 7 days) and a muted "N open on M matters" (for one matter, "N open on" and a link to the matter). The count is the first word of the accessible name. Zero is muted, only Overdue (red) and At risk (amber) are loud and only above zero.
* **#908** One matter: no list. Several: at most 8 one-line rows, worst first (`sort=worst`), "N overdue" chip (red above zero), amber "N at risk" and "N unassigned" above zero, next deadline, one row menu with New task. "All matters (N)" and an info button with the rule. A phone row is a card of two lines. API: `atRisk` per row and `sort=worst`.
* **#905** One ranked list of five (overdue oldest first, at risk, due today, unassigned with a date within 7 days, on hold more than 7 days), the reason in a fixed right-hand column, one "View all N". New Task Queue filter `needsAttention=true` (shared definition `AttentionRules`) so N equals the Task Queue total. Upcoming deadlines leaves out the tasks listed above it.

Initial bundle: 645.43 kB (unchanged, limit 700 kB).

## Batch 3 (epic #893): #894 with #907, #896, #897, #903

Same method, personas and sizes as batches 1 and 2 (real app, published API, Dev auth, `npm run seed:demo -- --tasks 150 --seed 7 --aged`, fresh database; scripts `after/stageA.mjs` and `after/stageStates.mjs`, screenshots in `after/` under the file names of `before/`, batch 2 numbers kept in `after/metrics-batch2.json`). Release 1 targets are the ones of `delivery-plan.md` section 4.

| Overview, 1366x768 | Before (569 / 569) | After batch 2 | **After batch 3** | Release 1 target | Met? |
|---|---|---|---|---|---|
| First task row, 1-matter | 569 px | 341 px | **257 px** | about 250 px | yes (7 px over, with the "since" line drawn; 225 px without it) |
| First task row, 3 matters (Client and Role bar drawn) | 569 px | 406 px | **297 px** | about 270 px, 320 px with the bar | yes (the 320 variant and the issue's 300 px) |
| First task row, 1920x1080 | 569 / 569 | 341 / 406 | 257 / 297 | | |
| First task row, 768x1024, 1-matter / 3 matters | 669 / 697 | 429 / 494 | 293 / 333 | | |
| First task row, 375x812, 1-matter / 3 matters | 1,021 / 1,069 | 755 / 803 | 591 / 639 | (#922, Release 2: 420 px) | not yet |
| Page height, 1-matter / 3 matters | 1,678 / 2,599 px | 773 / 1,374 px | **773 (one screen) / 894 px** | about 700 / 1,100 px | yes |
| Controls on the first screen, 1-matter / 3 matters, same script as `before/` | 84 / 85 | 93 / 91 | 52 / 61 | about 25 | **no** |
| Controls the person can reach (closed Focus and Options popovers and skip links left out) | n/a | n/a | **30 / 39** | about 25 | **no** (30 is close; 39 is not) |
| Words on the first screen, same script as `before/` | 384 / 417 | 457 / 461 | 242 / 341 | about 120 | **no** |
| Words the person sees (closed popovers, the screen-reader-only sentence and skip links left out) | n/a | n/a | **134 / 233** | about 120 | **no** (134 is close; 233 is not) |
| Repeated task ids on the Overview | 2 (2) / 2 (4) | 0 | 0 | none | yes |

Two honest remarks about the measurement. The script of `before/` counts controls and words that nobody sees (the checkboxes of the closed Focus popover, the screen-reader sentence under the title, the skip links), so the old counts overstate every row of that table, including the baseline; the corrected figures ("reach", "seen") are new fields of `after/metrics.mjs` and are only available from this batch on (the baseline was not re-measured). Second, the demo data now draw the "since your last visit" line (about 36 px and 15 words); a person whose four changes are all zero gets a first row about 30 px higher.

Empty page (1-matter person filtered to Secondary), 1366x768: 28 controls and 114 words by the old script (11 controls and 21 words reachable), 33 px of content under the tabs, unchanged in shape from batch 1.

### What was built

* **#894 (and #907, done here)** A shared `mf-options-menu` (`shared/ui/options-menu.ts`): one "Options" button, a native `details` popover, Escape closes and returns the focus, a click or Tab outside closes, a count badge when something inside is in force, no shortcut. Export became its `inline` mode. Needs my attention has one control of its own, Options (Export), and "View all N" in its heading; Next 7 days has none. The Deadlines tab keeps List / Calendar behind its Options. **Deviation:** Views, Sort and Task types are gone from the two Overview lists rather than moved into Options. With Focus as the only task-type filter (Q2, #907) and a ranked list that cannot be sorted, a saved view has nothing left to keep, so a Views entry would have saved an empty state. The remembered per-list choices are ignored and the code that kept them (`section-prefs`, `section-toolbar`) is deleted; the sort in Options is built for the tabs that will use it (#898). The hint of the Focus checklist now says every list on the page shows only the chosen types.
* **#896** "Upcoming deadlines" is "Next 7 days": today to seven days ahead (a window of its own, not the page's date range, which belongs to the Deadlines tab), at most five rows, the due day as the first column, the assignee on the right, never a task that Needs my attention lists, "All deadlines (N)" opens the Deadlines tab. Verified on the Deadlines tab: a task appears once there (grouped by matter, one row each), and the tab is a different screen from the Overview, so the Overview rule (once per screen) holds on both. The e2e specs cover a task that is both due soon and listed above (it is only above).
* **#897** One shared row (`mfMmTaskRow`, used by both lists and the Deadlines tab): the type icon in its colour in a 28 px chip with a 20 px icon (`large` on the shared badge); the code and the title are the one link; the matter's name as short grey text after the title only for a person with several matters; a pill only for High, Critical, At risk or On hold ("Normal" and "Low" are never printed); one status text on the right in a fixed column (the reason of a hold is its tooltip); a row is one line (36 px) and on a phone a card. The accessible name still has the type (described by the badge), matter, priority and status. The "- 5" after some titles is part of the demo task titles (`seed-demo` appends a counter to each title), not something the product adds: the link text is already code and title only.
* **#903** One column in the order since, Needs my attention, Next 7 days, Matters; flat sections (no card, a rule under the heading); 8 px instead of 16 px under the title row and under the tab strip (the page header's own numbers are untouched); on wide screens the Client and Role labels sit beside their controls (a 32 px row instead of 53 px; the labels' wording and style stay #899's). **Where the matter's name goes for a one-matter person:** it stays in the strip, "11 open on <matter>" with the link, as built in batch 2, not in the title row of the mock-up. The page header contract allows a second thing in the title row only inside the H1 (`mfTitle`), which would change the H1 text that `sh-page-header` and the title rule pin; the name is named once, linked, on the first screen. The title-row placement is a one-line change if the owner prefers it.

Also fixed: a matter name that is one long word widened the strip and so every tab on a phone (found by the long-names test of `pv-final-gate`; the batch 2 strip had `data-strip-matter` without wrapping).

### What is NOT met, and what to cut (the owner decides)

* **About 25 controls and about 120 words on the first screen** are not met for a person with several matters (39 controls, 233 words seen), and only nearly for one matter (30 and 134). Where they are, 3 matters, 1366x768: the header (scope switch 2, Focus, Task on a matter = 4), the Client and Role controls (2), six chips (6), the tab strip (6), the since line (5), Needs my attention (View all, Options, 5 rows = 7) and Next 7 days (link, 5 rows = 6) and the first matter rows. Proposed cuts, biggest first: (1) the **since line as a count on the Activity tab** instead of a line on the Overview: -5 controls, -15 words; (2) **Focus and the scope switch into one header Options** as drawn in the mock-up (#900, Release 2): -3 controls, -3 words; (3) **Next 7 days to three rows**: -2 controls, -25 words; (4) **the "N open on 3 matters" text and the Matters list's first row below the fold** (the list starts at 560 px, so it is only partly on the first screen); (5) **drop the matter's name from the Next 7 days rows** (the day, title and assignee are enough): -5 words per row. With (1) to (3) a 3-matter person is at about 29 controls and 190 words; reaching 120 words needs the status words ("overdue" etc.) and the chips' words to shrink as well, which is #918.
* **Phone** (first row at 591 / 639 px against 420): #922, Release 2.
* The Matters rows on a phone overlap their client name under a long matter name (visible in `after/pm3-overview-375x812-full.png`); it comes from batch 2 and belongs to #922.

### Test problems found by batch 2

* **Three tests that failed only between 00:00 and 04:00 UTC** (two in `MyMattersSinceLastVisitTests`, one in `TaskQueueManagerFilterTests`) built dates from the UTC day while the viewer's zone is New York. They now take "today" from the viewer's zone (`Fixtures/ViewerDay.cs`, also used by `MyMattersTestBase.In`), and `MF_TEST_NOW` (an ISO instant) fixes the host's clock and the test's "now" so the hard hours can be run at any time. Checked with a fixed clock at 02:00 and 03:59 UTC: the three tests fail when `ViewerDay.Today` is made to return the UTC day (3 failed, 8 passed) and pass with the viewer's day (11 of 11), also at the real time of day.
* **The slow performance tests (`MyMattersPerformance*`, 9 tests) were run after batch 2** through `heavy.sh` (one slot; the machine's load average was 5.6 when they started and 0.0 at the end, so not perfectly quiet): all 9 passed. The attention call that batch 2 changed (11 statements whatever the number of matters, budget 300 ms warm p95 / 800 ms cold, failing at twice that): 5 matters cold 441 ms, warm p95 50 ms; 50 matters cold 85 ms, p95 88 ms; 145 matters cold 132 ms, p95 172 ms; the worst case 171 ms, the All scope 162 ms (12 statements). Other endpoints at 145 matters, warm p95: summary 41 ms, health 79 ms, deadlines 14 days 38 ms, activity 69 ms. Everything is inside the budget, the cold first call of the 5-matter case (441 ms) included.

* **Found, not fixed (seeder):** running `seed:demo --aged` a second time after a failed first run stops with "Asset N does not exist or is not active", because the first run already moved assets off Active and the persona step picks one of them. A fresh database (`npm run db:reset`) and one complete run avoid it.

Initial bundle: 645.43 kB (unchanged, limit 700 kB).
