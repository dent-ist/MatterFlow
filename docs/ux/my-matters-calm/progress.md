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

## Batch 4 (epic #893): #922, #921, #919, #899, #898, #901 (Release 2, "Calm details", first part)

Same method, personas and sizes as batches 1 to 3 (real app, published API, Dev auth, `npm run seed:demo -- --tasks 150 --seed 7 --aged` on a fresh database; scripts `after/stageA.mjs` and `after/stageStates.mjs`, screenshots in `after/` under the file names of `before/`, batch 3 numbers kept in `after/metrics-batch3.json`).


| Overview | Before (review) | After batch 3 | **After batch 4** | Target |
|---|---|---|---|---|
| First task row, 375x812, 1-matter / 3 matters | 1,021 / 1,069 px | 591 / 639 px | **326 / 326 px** | at most 420 (#922): met |
| Task rows fully on the first screen, 375x812 | none | none | **2 or more** (checked by e2e for both personas) | at least 2: met |
| Page height, 375x812, 1-matter / 3 matters | 3,344 / 5,533 px | 1,281 / 2,208 px | **984 / 1,857 px** | at most 2,400 for 3 matters: met |
| Controls the person can reach on the first screen, 375x812 | 30 | 24 / 24 | **22 / 21** | |
| Words seen on the first screen, 375x812 | 168 | 84 / 83 | 102 / 110 (the strip scrolls sideways and the rows have a who column) | |
| First task row, 1366x768, 1-matter / 3 matters | 569 / 569 px | 257 / 297 | 257 / 297 (unchanged; with the filter bar and the strip on one line at 1920x1080 the 3-matter row is **261** instead of 297) | |
| First task row, 768x1024, 1-matter / 3 matters | 669 / 697 | 293 / 333 | 293 / 333 | |
| Controls reachable / words seen, 1366x768, 1-matter / 3 matters | 84 / 85 and 384 / 417 (old count) | 30 / 39 and 134 / 233 | 30 / 39 and **146 / 246** (+12 / +13 words: the assignee on each row of Needs my attention, #901) | about 25 and about 120: still **not met**, see batch 3 |
| Repeated task ids, horizontal scroll at any of the four sizes | | none | none, none | |
| Layout shift on load (Playwright `layout-shift`, 1-matter / 3 matters, 1366x768 and 375x812) | 0.013 / 0.101 and 0.048 / 0.103 (measured on batch 3 plus the phone layout, before the page held its body back) | | **0.000 / 0.002 and 0.000 / 0.003** | below 0.05 (#921): met |

The words on the Overview rose because every row of Needs my attention now says who has the task (#901, as its text asks) and the phone's strip and "since" line keep their words in a row that scrolls. The cut proposals of batch 3 (the owner decides) are still the way to the 25 controls and 120 words; #900 and #918 are not part of this batch.

| Filters and toggles | Before | After |
|---|---|---|
| Client and Role label style (1366x768, e2e) | Client 14 px / 600, Role 13 px / 400 | **both 14 px / 600** (the Dates label too) |
| Client and Role control height | 32 px | 32 px (e2e measures them equal) |
| Role wording | "Role: Both / Primary / Secondary" | **"I am: Primary or secondary / Primary / Secondary"** |
| Filter bar and strip, 1920x1080 | two rows | **one line** (1366x768 and below: two rows as before) |
| Scope switch, Breakdown, Deadlines, Trends and Data toggles | 5 look-alike pairs with their own CSS; "All matters" twice; "Per matter", "Show as table" | **one component and look, 32 px (44 px on a phone), a check mark on the pressed button, one Tab stop, arrow keys; "By matter / All together", "Table"; "All matters" only for the scope** |
| Tab stops of the scope switch | 2 | **1** (the arrow keys reach the other button) |
| Error banners and Retry buttons when every call fails | 6 and 6 (review) | **1 banner, 1 Retry** (e2e counts the visible Retry buttons) |
| Sort notes | "Sorted by Due date" + an arrow icon + "(ascending)" for screen readers | **"Sorted by Due date, soonest first"** (no arrow) |

### What was built

* **#922 Phone first screen.** At 375x812 the title row is the title, a Filters button (only when there is something to filter) and ONE Options menu that holds the scope switch, the Focus checklist and New task on a matter (`mf-options-menu` with `wide`; Focus and New task have an `inline` mode so there is no popover inside a popover). The strip is one 44 px row that scrolls sideways: four chips (Overdue, At risk, Unassigned, On hold; Due in 7 days is the Next 7 days section below it) and the muted count. "Since your last visit" is one 44 px row that scrolls sideways. Every control of the first screen is a 44 px target (checked by e2e). The Matters list no longer overlaps the client name under a long matter name (found in batch 3). **Deviation:** none from the issue's change list; the chips scroll instead of wrapping to two rows, as the issue says.
* **#921 Loading and error.** One `LoadGroup` per page: every request registers. Two or more failed requests give ONE banner ("Couldn't load My Matters.", the error reference, one Retry that asks every failed request again) and a muted "not loaded" line in each failed section; one failed request keeps its own message and Retry. The strip's error line keeps the height of the chips (28 px, 44 on a phone) and the width of a row of chips, so the tabs do not move. A loading section has no toolbar (Options, View all and the heading's links appear with the data) and its skeleton has the height of the list it stands for (five rows for Needs my attention). The page holds its body back, laid out but not painted, for at most 1.2 s while the first answers are on their way (the matters, which decide whether the Client / Role bar is drawn, and every request of the page), so the lists appear in one step; a slow server shows the skeleton after that. Layout shift on load (Playwright `layout-shift`, both personas, 1366x768 and 375x812) is below 0.01 on the demo data and below 0.05 in the e2e (it was 0.10 for the 3-matter person before).
* **#919 One toggle pattern.** `mfSegmented` (directive) and `.mf-seg` (style): two to four buttons that are alternatives of one thing, 32 px (44 px on a phone and on touch), the pressed button filled, bold and ticked (not colour alone), ONE Tab stop per group (the pressed button), arrow keys / Home / End move the focus, Space or Enter presses; no shortcut (the keys act only while the focus is inside the group, #420). Used by the scope switch (all seven list pages that have one), Breakdown ("By matter | All together", "Open tasks | On hold only"), Deadlines (List | Calendar, in Options), Trends ("8 weeks | 12 weeks | 26 weeks") and the Data tab ("Chart | Table"). "All matters" now means only the scope switch. Focus is the same menu as every Options button (`mf-options-menu` under the name Focus, with its number of task types). **Not done:** the row menus ("..." in Matters) and the "Task on a matter" menu are `mf-action-menu`, a different popover (a list of actions, not options); folding them into Options is a separate decision.
* **#899 Client and Role filters.** One label style (the form-label look: 14 px, weight 600, text colour) for Client, Role and the Dates control of the Deadlines tab (measured by e2e); equal control heights (32 px) were already true. Role reads "I am" with "Primary or secondary / Primary / Secondary" ("Their role" in the All matters scope once a manager is named). Where the width allows (1920x1080) the filters and the strip share one line; at 1366x768 and below they stack as before. On a phone the filters that are in force are removable chips under the title row ("Client: ...", "I am: Secondary", each with a 44 px x), so the closed Filters sheet still says what the page is filtered by; "Filters (2)" and the sheet are unchanged.
* **#898 Clear sort.** The server order was checked and is right: Priority ascending is Critical, High, Normal, Low and descending is the reverse (new integration tests for the Task Queue and the My Matters deadlines, tie-break by due date then id). The "Normal, Normal, High, High" of the review was a descending sort that only an arrow said. No Sort control remains in My Matters (batch 3 removed it; the ranked Needs my attention list names its order in its accessible name and the heading's tooltip: "Most urgent first: overdue, at risk, due today, unassigned, then on hold"). Where a sort remains (Task Queue, My Work, Pod Work, the record lists on a phone) the label now carries the direction: the note under the grid reads "Sorted by Due date, soonest first" (no arrow icon), the default reads "Sorted by Priority, most urgent first (default order)", the phone's Sort sheet has "Sort by" and "Order" with words per kind of field (most urgent first / least urgent first, soonest first / latest first, oldest first / newest first, A to Z / Z to A, lowest first / highest first, fewest first / most first), and the print line says the same. One table of words (`sort-sentences.ts`). **Deviation:** "Oldest overdue first" and "Due date, soonest first" as choices of a Sort select on the Overview lists were not built: those lists have no sort choice any more (the ranking is the sort), so the sentences are used where a sort is still chosen.
* **#901 The same right-hand pattern.** `mfMmTaskRow` (one row for Needs my attention, Next 7 days and the Deadlines tab) now has the same two right-hand columns in every list: WHO (the assignee, or "No assignee", muted) and WHEN (the time text: "23 d overdue", "at risk", "due today", "on hold 12 d", or the due day in Next 7 days and on the Deadlines tab; the only coloured element of a row). The leading day column is gone. An unassigned task's reason is the assignee column, so its time text is the day it is due ("due Thu Oct 29"). The accessible name of the link says the assignee too. On a phone the card keeps the order (title, matter, pills, then who and when on one line). Verified aligned across the lists by e2e (the same x and widths).

## Batch 5 (epic #893): #900, #926, the owner's cuts 1 to 3, #918, #924 (Release 2 completed)

Owner decisions of 2026-10-28 are in addendum AO items 15 and 16: (1) "Since your last visit" is not drawn on the Overview any more; the Activity tab shows its count as a small badge and shows the same line when opened, with Mark as read. (2) The scope switch and Focus go into ONE header Options menu; New task stays visible. (3) Next 7 days shows at most three rows. Cut 4 (no matter name on the Next 7 days rows) was NOT chosen, the name stays. (4) The matter's name of a one-matter person stays in the strip.

Same method as the earlier batches (real app, published API, Dev auth, `seed:demo --tasks 150 --seed 7 --aged`, a freshly reset database, `after/stageA.mjs`, `after/stageStates.mjs`). The numbers, the re-measured baseline and the budget are in README section 8; batch 4 numbers are kept in `after/metrics-batch4.json`, the re-measured baseline in `after/metrics-baseline-remeasured.json` (built from `e2dd52e`, same data, same script, same "reach" and "seen" fields).

| 1366x768 Overview | Baseline (re-measured) | After batch 4 | After batch 5 |
|---|---|---|---|
| First task row, one / three matters | 569 / 569 px | 257 / 297 | **233 / 273** |
| Controls reached, one / three | 45 / 47 | 30 / 39 | **24 / 36** |
| Words seen, one / three | 191 / 213 | 146 / 246 | **122 / 218** |
| Phone first task row | 1,021 / 1,069 px | 326 / 326 | **278 / 278** |

Not met: about 25 controls and about 120 to 150 words for the three-matter person (36 and 218). See README section 8 for where they are and what is left to cut. The one-matter person meets both.

### What was built

* **#900 header (Cut 2).** One Options menu in the title row at every width (scope switch when the person may see All matters, the Focus checklist; on a phone also the matters for a new task). "New task" is a plain button beside it. With several matters a "Matter: <name>" chooser next to it picks the matter New task uses (the last one used to begin with, "Matter: choose" before one is known); it filters nothing (Q6). One matter: no chooser, the shell's Create task is the create button. A small "Showing all matters" chip says so while the scope is All (the switch is inside the menu now). Focus-return after Create task goes to New task. **Deviation:** the Focus is no longer a button of its own with its own popover (the e2e specs that opened it now open the header menu).
* **#926 popover scrollbar (owner bug).** A press that began inside an Options menu never closes it (a scrollbar drag let go outside sends the click to the page, which was read as a click outside). The Focus list has a search box above ten task types and lists the task types in force first. The e2e creates 31 task types and checks all of it; **not tested for real:** headless Chromium in this container crashes on a real mouse press on a scrollbar (and on a click on plain text inside this popover), so the press is sent as the two events the browser sends and the list is scrolled by script; the real scrollbar drag should be tried by the owner on Windows.
* **Cut 1 and Cut 3.** The line moved to the top of the Activity tab, its four figures added up are a badge on the tab (accessible name "Activity, 15 changes since your last visit"); marking read on the line or on the tab refreshes both. Next 7 days: three rows, "All deadlines (N)".
* **#918 eye-catch.** Headline in the strip (overdue red, at risk amber, only above zero; "Nothing is late" in grey), quiet counts as plain text, red only for overdue and amber only for at risk everywhere (Matters rows, the Data tab's warning icon included), "due soon", "Unassigned", "24 open" without "on 3 matters". **Deviation:** the issue's e2e of "12 task links, 6 pills, red only on overdue things" was not built as such; the budget spec counts controls and words, and the colour rule is in the unit and e2e specs of the strip.
* **#924 budget test.** `mm-calm-budget.spec.ts`, README section 8.

### Tests

Run: frontend lint, format check, `tsc` of the app and of the e2e project, all 350 unit files (4,286 tests), build (initial bundle 646.11 kB, limit 700 kB), and e2e: `mm-calm-b1` to `b4`, `mm-controls-tabs`, `pm4-*`, `pm5-access`, `px3-*`, `px4-tabs`, `px7-*`, `pv-pm-ui`, `pv-final-gate`, `mm-focus-scroll`, `mm-calm-budget` (all pass on a freshly reset and seeded database; some specs were run again after the last small fix). Axe at 1366x768, 1920x1080, 768x1024 and 375x812 is part of those specs. Not run: the backend (no backend file was touched), `form-engine` unit tests, `px5-*`, `px6-*`, `pv-data-tab`, `pv-export`, the whole e2e suite.

## Batch 6 (epic #893): #930, #928, #927, #929 (Release 3, first part; code only, QA pending)

Owner decision of 2026-10-28 (coordinator): testing is combined, a separate QA agent runs the full e2e and integration suites on the combined result, sets the new calm budget numbers and closes the issues. This batch ran only cheap checks: backend build with warnings as errors, `dotnet format`, unit and architecture tests and the Breakdown integration tests (for #930), frontend lint, Prettier, `tsc` (app, spec, e2e), the unit tests of the touched files (201 pass) and the production build (initial bundle 646.11 kB, unchanged, limit 700 kB). **No e2e spec was run**; the e2e specs below were edited blind and may need small fixes.

### What was built

* **#930** The Breakdown no longer shows "Average turnaround against target" (column, card line, caption sentence, three export columns). API: `BreakdownType.avgDaysDone/doneCount/targetDays` and `MyMattersBreakdown.avgWindowDays` removed; OpenAPI and nswag client regenerated.
* **#928** Client filter = `mf-search-select` (shared, ARIA combobox): opens with "All clients" plus the clients of the person's matters, narrows as you type, Escape closes, asks the server instead in the All scope or with more than 100 matters. Input id `#mm-client` is unchanged; there is no "Change" button any more.
* **#927** Six equal tiles (Overdue, At risk, Unassigned, On hold, Due soon, Open); red only Overdue above zero, amber only At risk above zero, zero muted; phone 2 columns x 3 rows of 44 px. Hooks: `button[data-strip-item=<key>].tile`, classes `tile--danger/--warning/--zero`. The tile still navigates to the Task Queue (as the chips did); it does not filter the grids in place. The one matter's name is shown after the tiles on wide screens only (hidden on a phone to stay inside the 420 px row limit).
* **#929** Needs my attention (5 rows) and Next 7 days (3 rows) are the shared `mf-task-table` over `GET /task-queue` (`needsAttention=true`, `dueWithin=7`), read-only (new `readOnly` input of the table and the cards), server-side sort by header (default Due, soonest first), "View all N" = Task Queue with the same filter and sort, phone = the shared cards. Next 7 days asks for 8 rows and leaves out tasks Needs my attention lists. The Deadlines tab is removed (`?tab=deadlines` is replaced by the Overview); the Calendar (month weeks, range, phone list by matter) is a lazy chunk `panels/calendar-panel.ts` behind the icon button `mf-mm-calendar-toggle` ("Show calendar"/"Show list"; `?view=calendar`, remembered per person in localStorage). Removed: `panels/attention-panel.ts`, `panels/deadlines-panel.ts`, `tabs/deadlines-tab.ts`.

### Deviations and known risks (for the QA agent)

* The default order of Needs my attention is **Due, soonest first** (overdue oldest first), not the old reason ranking (overdue, at risk, due today, unassigned, on hold). An at-risk or held task that is due late can fall outside the five rows; "View all N" shows all. `GET /my-matters/attention` is no longer read by the Overview (left in the API and contract; remove in a later clean-up if the owner agrees).
* The "(N with all task types)" note beside a Focus-filtered list is gone.
* The shared table adds sortable column headers, a header row and the Matter name column: expect more controls and words on the first screen than the old rows, and phone cards taller than the old rows (the earlier "two rows fully on the first screen" check was relaxed to one card in `mm-calm-b4`). First task row limits (300 px at 1366x768 for both people, 420 px phone) may be exceeded for the three-matter person (filter bar row); tune row/heading spacing (`task-grid.ts` styles, compact density) rather than the limit if so.
* The grid's matter link and the cards' links must be 44 px targets on a phone (`mm-calm-b4` checks every control of the first screen); if not, add a My Matters override in `task-grid.ts`.
* `pv-task-types-on-hold.spec.ts` "My Matters section toolbar (#857)" was already failing before this batch (it clicks `[data-types-trigger]`, removed in batch 3); only its row selector was changed.

### Specs to run (QA)

Edited: `mm-calm-b1`, `b2`, `b3`, `b4`, `mm-controls-tabs`, `pm4-layout`, `pm4-my-matters`, `pm4-all-scope`, `pm5-access`, `px4-tabs`, `px6-matrix`, `pv-pm-ui`, `pv-final-gate`, `pv-task-types-on-hold`. Not yet edited and surely affected: `mm-calm-budget` (the Deadlines tab ratchet must become the Calendar view `?view=calendar`; numbers to be set), `px3-scope`, `px7-*`, `pm-matters`. Unit: `my-matters-page.spec.ts` (rewritten for the grids, tiles, calendar), `search-select.spec.ts` (new), `tabs-helpers.spec.ts`. Docs still to update by QA: README section 8 (budget numbers), `after/` screenshots (stageA.mjs lists the `deadlines` tab: drop it, add `?view=calendar`), the #893 body.

## Data Area (#931, #932, #933; owner decisions of 2026-10-28; #913 and #914 are superseded)

Written by the Data agent for the QA agent. Cheap checks were run (see the end); no e2e, no performance run, no screenshots, no measurements. Issues are NOT closed. The three issues are in one commit because the new Data tab uses the new API, the chart switch and the tile together and does not compile in parts.

### What was built

* **#931 selection bar and API.** `GET /my-matters/data` and `GET /my-matters/data/volume` take one selection: `matterIds` (repeated), `assetTypeIds` (repeated), `sizeFields` (repeated, `typeId:key` or `typeId:key:unit`, the unit is required for a field that is not the type's default), `from` and `to` (the days the assets were ADDED, UTC, last day included), plus the old `scope` and `role`. The old `assetTypeId`, `sizeField`, `sizeUnit`, `matterId` and the volume `months` UI are gone (the API keeps `months`, the tab asks 24). A matter id the person may not see, or that does not exist, is left out without a word: not counted, not named, and the answer is byte for byte the answer for ids that do not exist. New response parts: `selectedMatters`, per type `measures` (the fields measured, with their form labels), `numberFields` (the choices) and `dispositionSizes` (size per status, so a tile can filter the grid and still show its size); each volume point has `assetsAdded`. Backend: `AssetSelection.cs` (`AssetSelectionResolver`, `AssetMeasurePlan`), `AssetAggregates.Valued(assets, plan)` (the default size join for the types that chose nothing, one extra join per chosen field, joined with `Concat`), `AssetDataService`, `AssetVolumeService`. No SQL script, no new table.
  Frontend: `data-selection.ts` (pure model: address `?dm=&dt=&ds=&dp=&dfrom=&dto=&dv=&dstatus=`, remembered state, period to dates, exactness rule), `data/data-pick.ts` (multi-select popover, Matters asked from the server as you type, Asset types), `data/data-size-pick.ts` (size fields: tick a field, then its unit), `data/data-period.ts`. The choices are remembered per person in the `my-matters.data` view state (browser copy at once, server copy later); the address wins when it says anything (`dp` is always written once the person chose). `OptionsMenu` got `align="start"`. Matters is not offered to a person who manages exactly one matter; Asset types only with two or more; Size fields only when some type has a number field besides its default.
* **#932 Data Area.** One panel: bar, tiles, one warning line, then the grid of the selected asset types (a real table, cards on a phone) inside the shared `mf-chart-panel` with the one toggle pattern (`mfSegmented`, order Table, Bar, Pie, one Tab stop, arrow keys). While Bar or Pie is shown a second switch says what the chart measures (Assets, or Size in GB, Size in Items: units are never added). Every chart has the table as its alternative. The by-matter table, the Measured-by column and the raw field names are gone; the caveats are in ONE info point (button with the info icon in the panel heading). The volume panel appears only when assets were added in at least three different months (Q9); its limitation text moved into the info point. Counts and the warning "Show" are links only when the Assets list can show exactly those assets (at most one matter, all time; the warning also needs all types or one); otherwise plain text and the info point says why. `ChartPanel` (also used by the asset report builder) now uses `mfSegmented` and has a `[mfChartControls]` slot.
* **#933 tiles.** `shared/ui/stat-tile.ts` (`mf-stat-tile`): Total assets, Total size (one tile per unit when GB and Items meet, the unit shown once), Active, Inactive, Pending disposition (note "oldest N days"), Disposed. Accessible name starts with the value ("2 pending disposition, oldest 41 days"). A zero is muted; a status tile with something in it is a toggle button that filters the grid (and the chart) to that status, address `dstatus`. The six-tile strip of #927 is its own markup in `my-matters-strip.ts`; the two were not merged (different data, different shape); both follow the same rules (value first, zero muted).

### Specs written or edited

* Unit: `data-selection.spec.ts`, `data/data-size-pick.spec.ts`, `shared/ui/stat-tile.spec.ts` (new); `tabs/data-tab.spec.ts` (rewritten), `data-model.spec.ts`, `matters/ui/matter-overview.spec.ts` (new positional arguments of the volume call).
* e2e: `pv-data-tab.spec.ts` (rewritten: tiles, grid and links, tile filter, selection bar and remembering, chart switch, volume only with history (needs the SQL container: it ages assets with `seed.sql`), a hidden matter id in the address, empty state, failing request, axe and phone cards at four sizes), `pv-asset-report-builder.spec.ts` (keyboard step: one Tab stop, arrow keys, Home), `pv-final-gate.spec.ts` (no volume panel wait). `[data-show-table]` now exists once on the Data tab; the volume toggle uses `data-volume-as-chart` and `data-volume-as-table`.
* Backend: `AssetDataApiTests` (several matters, one, none visible, foreign and unknown ids, period, two size fields, status split, volume with the same selection), `AssetVolumeApiTests`, `AssetReportRunApiTests` (new parameter names), `SensitiveAccessCatalog` (new sample calls with `matterIds={matter}` and the other parameters), `SensitivePmV2Tests` (leak test: every persona asks for all four matter ids and for the hidden ones only; totals equal what the persona may see, `selectedMatters` only visible, hidden ids answer like ids that do not exist, no sentinel in data or volume), `MyMattersPerformancePmV2Tests` (six new shapes, budget 600 ms, the harness now has a second number field so it holds 300,000 index rows; the test name changed to `..._at_100000_assets_and_300000_index_rows`).

### To run (QA)

* **Not done by the Data agent, needs doing:** the `mm-calm-budget` Data ratchet (add a `data` entry to `TABS`: measure Data at 1366x768 and 375x812 for both people, plus about 5 percent, like Deadlines and Activity; the Data tab is now rebuilt), README section 8 after-measurements for the Data tab, `after/` screenshots of the Data tab at four sizes (`pv-data-tab` writes `pm1-data-*` when `E2E_SCREENSHOTS` is set; the review used `pm1-data` and `pm3-data` names), `metrics` JSON.
* e2e on a freshly reset and seeded database (`seed:demo --aged --seed 7`): `pv-data-tab`, `pv-asset-report-builder`, `pv-asset-*` (the other asset report specs), `pv-final-gate`, `mm-controls-tabs`, `mm-calm-b1`, `sensitive-leak-scan`, `px4-tabs`, `px6-matrix`, `mm-calm-budget`. The demo data has 20 or so assets created in one month, so the volume panel will NOT show there (by design).
* Performance, on a quiet machine: `dotnet test tests/MatterFlow.IntegrationTests --filter "FullyQualifiedName~MyMattersPerformanceTests"` (the PM v2 part). Look at the six `data (...)` and `data volume (...)` lines for the heavy person (72,500 assets) and the administrator (100,000): p95 must be at most 600 ms; Data without a selection is held to the old 300 ms (the test allows twice a budget). Also the statement-count and index-seek tests of that class (the new joins must still read `CustomFieldIndex` by seeks).
* Integration already green after the rebase: `AssetDataApiTests`, `AssetVolumeApiTests`, `AssetReportRunApiTests`, `SensitivePmV2Tests`, `SensitiveEndpointCatalogTests` (21 tests). `SensitivePersonaWalkTests` passed before the rebase.

### Expected behaviour

* Nothing chosen: all matters in the scope, all asset types, each type's own size field, all time; address has no `d*` keys until the person chooses. After a choice the address carries it, and a bare `/my-matters?tab=data` restores the last choice.
* Size fields: ticking another number field of a type adds it to the type's default (both are measured; the units stay apart); unticking the extras goes back to the default. The unit is required before the field is sent.
* Tile filter and the chart view survive a change of selection. Tiles reflect the whole selection; only the grid and chart are filtered by a tile.
* Phone: pickers open as full-width panels, tiles are two across, the grid is cards.

### Known risks

* The info point, the picker popovers and the tiles at 375 px have not been seen in a browser; axe has not run. Check the popover width (`wide`) on a phone and that the Matters popover is not clipped at 768 px.
* `mf-chart-panel` renders the projected grid or cards only for the Table view; the cards are instantiated but not shown for Bar and Pie (small waste).
* Period is "when the asset was added" (creation instant, UTC days). The Assets list has no period filter, so numbers are plain text with a period; if the owner wants links there, the list needs `createdFrom` and `createdTo`, and a list of matter ids.
* "Real history" is approximated by assets added in at least three months, because there is no snapshot table (the 600 ms budget decision of 2026-10-27 stands).
* `listMatters` is used for the Matters picker (fifty at a time, searched on the server); a person with many matters sees the first fifty until they type.
* ng test and ng build do not exit by themselves in this container: run them as `heavy.sh timeout 420 <cmd>`.

### Cheap checks run by the Data agent (after the rebase onto 2f209f0)

`dotnet build -warnaserror` (API), `dotnet format --verify-no-changes`, backend unit (2,470), architecture (47) and schema (102) tests, the five integration classes above (21), OpenAPI regenerated by the build and the nswag client regenerated (no difference after the rebase), frontend `ngc`, `tsc` of the spec and e2e projects, eslint, prettier on the whole tree, unit tests of `my-matters`, `shared`, `matters` and `assets` folders (187 files, all green), `npm run build` (initial total 646.11 kB, limit 700 kB). Not run: any e2e, any performance test, axe, screenshots, the whole backend integration suite, the whole frontend unit suite outside the four folders.

## Combined QA of batch 6 and the Data Area (2026-10-28 and 2026-10-29)

Done by the QA agent on `origin/dev` at `17f57ae`, own worktree, own SQL container, freshly reset and seeded database (`seed:demo --tasks 150 --seed 7 --aged`). Commits: `2509eaa`, `de40a37`, `4bee168`, `2085eb7` and the ones after it (all "WP-MM7").

### Owner's review of the first build (screenshot, 1888 px, KE\kekim)

1. **Tiles stacked in one tall column.** Cause: the strip host had no width of its own inside the flex row of the page top, so `width: min(100%, 56rem)` and `auto-fit` shrank it to one tile. Now the host is a flex item with a basis of 44 rem (wraps under the filters when there is no room) and the grid is six equal columns. 640 to 999 px: the number over its word; phone: three across, two rows, 44 px. Asserted in `mm-calm-b2` and `mm-calm-b6` at 768, 1366, 1920 (one row, equal widths, every word whole).
2. **Pills on every row.** `quiet` input of the shared table and cards (My Matters only): a pill only for High and Critical priority, On hold and At risk; plain words otherwise. Headings stay sortable.
3. **Due cut.** Cells with words ("Overdue 26d", "Due today", "Tomorrow") leave the date out (it is the tooltip); wider Due and Matter columns; the grids stop at 82 rem so a short Title does not leave a gap.
4. **Sort order visible.** The active heading is underlined with a bold arrow; the other arrows are faint (all tables).

### Results

* Backend: build with warnings as errors clean; unit, architecture and schema tests green; **full integration suite 1,617 passed, 0 failed** (performance class excluded, run alone below); frontend unit 355 files, 4,325 tests, form-engine 319; eslint, Prettier, tsc clean; initial bundle 646.11 kB (limit 700).
* Sensitive-matter e2e with `E2E_SENSITIVE_ACCESS=1` on a fresh database: **14 passed**.
* Playwright groups: mm-calm-b1..b4, b6 (new), budget, mm-focus-scroll, mm-controls-tabs, pm4-*, pm5-access, px3 to px7, pv-*, sh-*, wp12-phone-cards, dashboard-breakdowns, my-work-*, tq-*, pm-matters ran once (379 of 391 passed, 12 failed, all classified below) and the failed ones were fixed and re-run green, except the one open item below.
* Performance (quiet machine): Data p95 83 to 374 ms for all shapes except one (618 ms, heavy person, two size fields, still inside the test's 2x ceiling); statement counts 8, 12, 4, 7, 11, independent of the number of matters; seek test green; a 2.1 s volume read for the heavy person in the statement-count harness is recorded as #938.

### Failures found and how they were classified

| Spec | Class | What |
|---|---|---|
| mm-calm-b1 held row x4 | stale spec | the title link no longer holds the ref; the grid has a Ref column |
| mm-calm-b2 tiles at 375, matters list chips | stale spec | tiles three across now; chip query must stay inside the Matters list |
| mm-calm-b4 toggle pattern, filters label, error test | stale spec | Deadlines tab and its toggle gone (Calendar icon button instead); failing one section now means failing the attention request only |
| mm-calm-b4 phone first screen x2 | **real bug** | links of the cards were 24 px (not 44) and the strip's matter note showed on a phone |
| mm-calm-b4 loading and error | **real bug** | the error row was 4 px taller than the tiles (tabs moved) |
| mm-controls-tabs, px4-tabs, px6-matrix, pv-data-tab tab lists | stale spec | five tabs; the Activity badge digits |
| pm4-layout, pv-pm-ui, px4-tabs `h2` | stale spec | the cards have their own `h2` |
| pm5-access keyboard order | stale spec | Deadlines link replaced by the grid's own "View all", the sort headings are stops |
| pm5-access Back keeps focus | **real bug** | after Back the focus was lost: the body is held back (visibility hidden) while the answers arrive and cannot take the focus; `restoreRowFocus` retries for 2.5 s |
| pv-task-types-on-hold toolbar | stale since batch 3 | `[data-types-trigger]` is the Focus in the header Options now |
| pv-data-tab volume | stale spec | column is `CreatedAt` not `CreatedAtUtc` |
| pv-data-tab hidden matter | stale spec | the asset type catalogue lists a type named with the world's token; the assertion now checks matter and asset names |
| pv-final-gate axe at 768 | **real bug** | two regions "Assets by asset type" in the Data tab (landmark-unique) |
| the Client dropdown over the Role label | **real bug** (screenshot) | the search input kept its intrinsic width and ran over the next label |
| View all 1 tasks | real (wording) | singular |

### Known risks that were checked

* First task row, three matters: 299 px at 1366x768 after tightening spacing (tile 36 px, grid heading 30 px, panel heading 28 px, tab strip 4 px closer); limit not raised.
* Phone 420 px: 343 px; every control of the first screen is a 44 px target (asserted).
* axe at 1366x768, 1920x1080, 768x1024, 375x812 for the Overview, the Calendar and the Data Area (each picker open, info point open, Table, Bar, Pie): clean (`mm-calm-b6`).
* Default order "Due soonest": **a real problem**, see #935 (at-risk and held tasks fall out of the five rows).
* Layout shift: `mm-calm-b4` loading test (under 0.05) passes.

### Issues filed

#935 (attention order), #936 (task tiles above Data and Trends), #937 (small polish: tablet scroll, 1920 width, phone picker widths, wording, extra Tab stop, Activity on a phone), #938 (volume read 2.1 s in one harness).

### Status at the end of this QA (owner decision: the full-suite gate moves to the final QA)

* **Closed on the evidence above:** #927 to #933 (targeted groups, integration 1,617 passed, sensitive e2e 14 passed, Data performance, axe at four sizes for Overview, Calendar and Data Area).
* **The full Playwright suite was NOT completed.** It was started on the final build and stopped at test 1,942 of 3,101 (alphabetical, ad* to ty-permissions-matrix) when the owner moved the gate to the final QA. 15 failures were seen up to that point; the ones in the My Matters scope are all listed in the table above. The others, re-run alone on the same database: `assets-keyboard`, `assets-screen`, `column-filters-records`, 6 of `pv-asset-report-builder`, `pv-data-tab:198`: all wait for an asset type created by the test in a list that does not show it. The database had 219 asset types by then (the full run creates one or more per spec) and the lookup list stops at 200: **test-data pollution of a long-lived database, not a regression** (the same specs passed in the earlier group run on the same build when the database was smaller); to be confirmed on a fresh database at the final QA. `dashboard-breakdowns:266` (wide layout, Priority above Status) failed alone too; no file of the Dashboard was touched by this work, not investigated, check on a fresh database. `pm4-bulk-tasks:33` and `task-detail-t1:172` passed when re-run alone (load flakes).
* **Open defect:** `pv-pm-ui:185` "Focus is picked once..." fails axe `target-size` for the Assignee sort heading while the Focus popover is open (the popover covers part of the heading; it passed with the taller heading row of the first build). Not fixed (the heading row had to get lower to keep the first task row at 299 px). Options: let the popover open below the grids' heading or use a 32 px heading again and move the 300 px budget (owner decision).
* **Not run:** the rest of the full suite (from `ty-permissions-matrix` on: ty*, users-*, wp*, ...), the Windows / IIS check, the performance tests on a Windows machine.
* Last measured first task row at 1366x768: 290 px (one matter), 298 px (three matters); phone 343 px.
## Batch 7 (epic #893): #935, #934, #937, #938 (#936 superseded; cheap checks only, QA pending)

Owner change during the batch (coordinator, 2026-10-29): the six task tiles of the Overview are to be REMOVED and replaced by a pre-filter dropdown with counts above one merged grid; Needs my attention and Next 7 days become one grid; the Matters section of the Overview, the Trends tab go; Activity becomes a grid. So: the My Matters strip was NOT restyled, #936 was NOT done (superseded: the tiles are going), and the polish items about the strip tiles, the Trends tab and the Matters list were skipped.

### Built

* **#935 urgency order (commit a323b3a).** New sort `attention` of `GET /task-queue` (and My Work / Pod Work, which share the sort list): rank by reason in SQL (`AttentionRules.RankSelector`: overdue 0, at risk 1, due today 2, unassigned with a date within 7 days 3, on hold more than 7 days 4, none 5; the first matching reason wins), then inside a reason the due moment (overdue oldest first), for the hold the longest wait, then oldest created, then id; descending is the exact reverse. Implemented as a join of the sort rows with the rank selector applied to the filtered tasks (`TaskQueueRules.OrderByAttention`), no new table, no script. OpenAPI did not change (sort is a plain string; no regeneration needed, the build wrote an identical `v1.json`). Frontend: the attention grid (`panels/task-grid.ts`, the component that carries over to a merged grid) asks for `sort=attention` by default; a click on a heading sorts by it; "View all N" carries the sort in force (`sort=attention&dir=asc` by default); the Task Queue and the phone sort know `attention` ("Urgency, most urgent first"). The visible indicator: an **Urgency** control (button, `data-sort-urgency`, `aria-pressed`, underlined and bold while it is the order, a click brings the default back) in the heading of Needs my attention; no column heading is marked in the default order. The old `GET /my-matters/attention` link now says `sort=attention` too.
  Known by design: with five or more overdue tasks the five rows are all overdue (overdue ranks first, as in the old ranked list); at-risk and held tasks then show after them, or via the tile or "View all". That is what the delegated decision gives; the first-screen promise ("4 at risk" and none in the five rows) is only fixed when fewer than five tasks are overdue.
* **#934 (commit 4e55a2c), Data Area tiles only.** `shared/ui/tile-chip.ts` (`mf-tile-chip`, decorative, solid fill with a white glyph: red 6.6:1, amber 5.0, violet 7.1, slate 7.6, blue 8.0, teal 5.5, so it reads the same in a light or dark theme), `mf-stat-tile` got `icon`, `tone`, white tile, plain 1 px `--mf-border`, chip left of the number and label. Icons: assets box/blue, size database/teal, active check/teal, inactive minus/slate, pending hourglass/violet, disposed trash/slate (no red or amber). Zero = light neutral chip and lighter number. Tiles grid minimum width 11 rem (the chip needs room). The six-tile strip is untouched.
* **#937 (commit 049fd58 and the tile wording in 4e55a2c).** (1) Below 800 px the two grids drop the Ref column (they fit 768 without sideways scroll). (3) On a phone the three picker buttons of the Data tab are full width like the Period select (chevron at the right). (4) Pending disposition note: "oldest 41 d" / "oldest today" (one line, tiles level); the accessible name keeps "oldest 41 days" (`noteName` input). (5) `ScrollArea` got `whileScrolling`; the task grids of My Matters are a Tab stop only while they scroll (`TaskTable.scrollStopWhenScrolling`). Skipped: (2) 1920 px alignment with the Matters list (the Matters list is being removed), (6) Activity on a phone (#915, #916; Activity is being redesigned).
* **#938** see the end of this section.

### Specs edited (cheap, none run in a browser)

e2e: `mm-calm-b2` (default order Urgency, Urgency control returns the order, new test for the ranking: a held task due sooner does not go before an unassigned task due later, needs the SQL container), `mm-calm-b4` (indicator and tooltip), `mm-calm-b6` (Urgency control underlined, then a heading click for the aria-sort check; title heading instead of Ref; grids do not scroll sideways, a grid is a Tab stop only while it scrolls, no scroll hint), `px3-scope` (View all carries `sort=attention`), `pv-data-tab` (six tiles level in height, six decorative chips, "oldest today", phone picker as wide as the Period select). Unit: `my-matters-page.spec` (default sort attention, Urgency control, controls of the section), `queue-filters.spec`, `sort-sentences.spec`, `stat-tile.spec`, `data-tab.spec`, `fixed-page.spec`. Backend: `TaskQueuePmV2Tests` (urgency order, descending reverse).

### Cheap checks run

`dotnet build MatterFlow.sln -warnaserror` (0 warnings), `dotnet format --verify-no-changes`, unit tests 2,470, architecture 47, integration `TaskQueuePmV2Tests`, `MyMattersAttentionTests`, `TaskQueueSortApiTests` (17 pass), eslint and Prettier on the touched files, `tsc` for app, spec and e2e, unit tests of the my-matters, shared/ui and shared/work-queue folders (1,102 tests; the two failures of my first run were new tests of mine and are fixed, the page spec re-run is 58 of 58), `ng build`: initial total 646.78 kB (limit 700).

### Not run (QA)

Any e2e (a browser was never opened on this build), axe, screenshots, the calm budget, the performance class. Risks for QA: (a) the first task row of the three-matter person was 299 of 300 px; the Urgency control sits in the 28 px heading row and should not add height, but measure it; (b) the Ref column is gone at 640 to 799 px (`mm-calm-b*` that read the headings at 768 may expect it); (c) the `ScrollArea` change touches every fixed page only through a new input that is off by default; (d) the Data tiles are 11 rem wide at least: check six in one row at 1366 and the 2 x 3 phone layout, and the chip in the zero state; (e) `E2E_SQL_CONTAINER` is needed for the new ranking e2e test; (f) the Urgency control is one more control on the first screen (budget: 41 / 61 controls, measured 39 / 58 before).

### #938 volume read 2.1 s: real, fixed

Reproduced with a new test `The_data_reads_of_the_heavy_person_do_not_depend_on_which_person_compiled_the_plan_first` (plan cache emptied, the 5-matter person asks once, then the 145-matter person is measured; and the other way round). Before the fix: `data volume (24 months)` cold 1,599 ms and **p95 3,273 ms** with the small person first (165 to 210 ms the other way round), `data volume (period, 60 months)` p95 3,331 ms, `data (two size fields)` p95 993 ms. Cause: parameter sniffing. The asset scope is a subquery on the caller's id (matters the caller manages); the statements were compiled for five matters (seeks and key lookups) and reused for 145 matters and 72,500 assets. Fix: the asset scope's query is tagged (`QueryPlanTags.StablePlan`, SharedKernel) and a small interceptor in `MatterFlow.Data` (`StablePlanInterceptor`) adds `OPTION (USE HINT ('DISABLE_PARAMETER_SNIFFING'))` to the tagged SELECTs, so the plan is made for the average caller and does not depend on who came first. No per-call compile cost (RECOMPILE was not needed). After the fix, both orders: volume p95 172 to 202 ms, two size fields 226 to 234 ms, data 181 to 265 ms; the test fails above twice the Data budget in either order. Also green after the change: the budget test (`Breakdown_data_volume_and_the_reports_stay_within_the_budget_at_100000_assets_and_300000_index_rows`), the seek test, the statement-count test, `SensitivePmV2Tests`, `AssetDataApiTests` (12 tests in all), architecture tests, `dotnet format`. QA: run the whole `MyMattersPerformanceTests` class once on a quiet machine and look at the `data` and `data volume` lines; the task-queue and report statements were not touched.


## App shell (MM-43, MM-44)

Issues #939 (navigation panel colour) and #940 (version line). Both are app-shell only: no My Matters file, no shortcut, no API change.

**What was built**

* **#939 colour.** New tokens `--mf-nav-*` in `docs/ux/tokens.css`: panel `#EAF0F7` (soft blue-grey; page `#F5F6F8`, header white), hover `#DAE4F0`, selected `#FFFFFF`, border `#C3CFDD`, text and muted text, focus ring, marker. The shell styles use only these tokens for the panel: items, More button, the "Work" / "Records" / "Administration" headings, dividers (also the rail dividers), the scroll-shadow gradients and the phone overlay panel. Contrast on the panel (WCAG 1.4.3, computed): text 14.4:1, muted headings 6.6:1 (5.9:1 on hover), selected text 8.0:1, hover text 12.8:1, focus ring 4.4:1 (needs 3:1), pending badge white on red 6.6:1.
* **Selected item without colour.** Kept the bold weight and added a 3 px bar on its left edge (inset shadow; a real left border in forced-colors mode). The selected item is white on the tinted panel, so it also reads as a "tab" shape.
* **Dark values.** The app has NO dark theme yet. The dark panel values (`#172131` panel, light text, `#2C3E5C` selected, amber focus ring) are under `:root[data-theme="dark"]` in `tokens.css`, ready for when a dark theme is built. Contrast: text 13.5:1, muted 8.2:1, selected 7.1:1, hover 11.0:1, focus 7.9:1, bar 5.2:1. The dark screenshots set `data-theme="dark"` on `<html>`, so only the panel turns dark and the page stays light.
* **#940 version.** `"version": "0.1.1"` in the root `package.json` (and the root entry of `package-lock.json`) is the single source. `frontend/src/app/shared/layout/app-version.ts` imports that one property (the bundler keeps only the string, not the root scripts). The line sits at the foot of the nav (`margin-top: auto` in a flex column; it follows the last item when the panel scrolls): visible text "v0.1.1", muted, `aria-hidden`; screen readers get a visually hidden "Version 0.1.1". Not a link, not focusable. In the 56 px rail the same short "v0.1.1" is shown (11 px) and the name tip shows "Version 0.1.1" on hover. README, section "App version", says how to bump it.
* No new or changed keyboard shortcuts (#420).

**Cheap checks run:** `npm run lint`, `npm run format:check`, tsc for app, spec and e2e projects, unit tests of `src/app/shared/layout` (118 passed, includes `app-version.spec.ts` and the new shell test), initial bundle (see the issue comments for the number).

**What QA must test (full suites are QA's):** all nav states in light at 1366x768, 768x1024 (rail) and 375x812 (Menu panel): item, hover, selected, focus ring, More (a person who lands on My Matters), Administration heading, pending-users badge; the app title and logo in the header still read; axe at the four widths; the version line on every page with the nav (Dashboard, My Matters, a record page, an admin page, 403/404 pages, fixed-header pages where the nav is not sticky), pinned at the bottom with a tall and a short window, and not cut off in the rail; `e2e/tests/sh-nav-version.spec.ts`; the nav specs (`sh-nav-brand`, `sh-rail-icons`, `nav-phone`, `sh-final-contract`, `my-work-drill-in`); print (`wp26-print`) still hides the nav; a manual check that changing `version` in the root `package.json` changes the line after a build. Dark theme: nothing to test in the app (no dark theme); the tokens are documented.

Screenshots: `after/nav-before-light-*`, `after/nav-after-light-*`, `after/nav-after-dark-*` at 1366x768, 768x1024 and 375x812 (the Menu opened), plus hover and focus at 1366x768. Script: `after/navShots.mjs`. The "before" pictures are the same build with the old nav colours put back and the version line hidden (not a second build).

### App shell follow-up (MM-56, #948)

Owner feedback on #939: no thick left border, bigger icons.

* The 3 px left bar is gone (the `--mf-nav-marker` token too). The current page is now a fully rounded white pill, icon and label in the primary blue, semi-bold, `aria-current="page"` kept; a faint 1 px-blur shadow lifts it, no border anywhere in the panel. In the 56 px rail it is a filled rounded square (10 px radius). Hover uses the same shapes. Forced-colors: a full 2 px outline (the fill is dropped there). The icon set has one weight, so no "filled icon" swap.
* Icons: 19 px in the panel and the phone Menu, 21 px in the rail, the same for every item including Administration and More. Rows stay 40 px (44 px in the phone Menu); item padding grew from 12 to 16 px.
* Screenshots: `after/nav-pill-{light,dark}-{1366x768,768x1024,375x812}.png` plus hover and focus at 1366x768; the bar version stays as `nav-after-*` for comparison. Script `after/navShots.mjs`.
* Checks run: lint, prettier, tsc (app, spec, e2e), `shared/layout` unit tests (118 passed), production initial bundle 648.30 kB. e2e specs updated: `sh-nav-version` (pill, no left border, icon size, 44 px phone row) and `sh-rail-icons` (21 px). `sh-nav-brand`, `nav-phone`, `sh-final-contract` assert nothing about the selected style or icon size, so no change. NOT run: any e2e (`deploy/publish.sh` hangs on `ng build`, which never exits in this container, so the stack never started); QA runs them.
