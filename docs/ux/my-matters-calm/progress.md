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
