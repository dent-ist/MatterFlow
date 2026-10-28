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
