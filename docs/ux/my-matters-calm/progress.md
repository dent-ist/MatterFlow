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
