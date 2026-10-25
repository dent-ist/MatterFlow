# PM experience review (epic #758, issue #787)

Date 2026-10-25, base `origin/dev` at `c01e7cf` (frontend 27cb265..673237e, backend 93e0bb5..f44e34e). An agent walked the **running product** as a Project Manager through four day-in-the-life scenarios at four sizes. Everything here is observed, not assumed; clicks are counted by the walk script, reading costs no click, scrolling is counted separately.

## Method

- **Stack.** Fresh publish of `dev`, SQL Server 2022 container, one API (Dev authentication, `Features:SensitiveMatterAccess` off), Playwright Chromium, `en-US`, America/New_York.
- **Data.** The PM fixtures of `frontend/e2e/support/pm-fixtures.ts` (`docs/ux/pm-review/fixtures.md`) are in the database (built by the px3 specs), plus the demo data of `tools/seed-demo` (50 users, 5 clients, 12 matters, 200 tasks, `--seed 7`). The person walked is **Test User 03** of the demo data, the first Project Manager user: Primary or Secondary on 5 of the 28 matters, 17 overdue tasks, 9 due in 3 days, about 30 unassigned, 10 on hold. Demo data gives a realistic mix (long names, many people, old overdue work) that the small fixtures do not; the fixture PMs (PM Alpha and the rest) are covered by the specs.
- **Sizes.** 1366x768, 1920x1080, 768x1024, 375x812; the same four scenarios at each, 16 runs, **99 screenshots** in `1366x768/`, `1920x1080/`, `768x1024/`, `375x812/` (file names `<scenario>-<nn>-<step>.png`, compressed) and the raw numbers in `walkthrough.json`.
- **Script.** `walkthrough.mjs` (repeatable: `BASE=... PM_USER=... OUT=... PW=frontend node docs/ux/pm-experience/review/walkthrough.mjs`; it resets the person's "since your last visit" marker before each morning check so every size starts as a first visit).
- **Checks on every step.** No page-level sideways scroll at any size in any of the 99 shots (all `pageOverflowPx` are 0). Axe, keyboard and permission checks are in the specs (`docs/qa/pm-keyboard-evidence.md`, `docs/qa/pm-permission-matrix.md`).

## Summary

The product now answers the PM's first questions on the first screen at desktop sizes: what is overdue (strip, 0 clicks), what changed (Since your last visit, 0 clicks), who is overloaded (Workload, 1 click), what is due (Deadlines, 1 click), everything about one matter (Matters, then the matter: 2 clicks; 3 on a phone). Reassigning an overdue task takes 4 clicks from the landing page with an Undo toast; commenting adds 3. What hurts is mostly **consistency and distance**: the scope switch says one thing while the list says another after a strip link, the path to "add work" starts 2,000 px down the page, the phone first screen cuts the Overdue count, and two screens repeat the same counts. Nothing blocks a scenario; no scenario needed a keyboard shortcut.

| Scenario | Desktop and tablet clicks | Phone clicks | Answered on the first screen |
|---|---|---|---|
| 1 Morning check (see counts, what changed, who is away, what is due, mark read) | 0 to see; 5 for all four tabs and Mark as read | same | strip and Since your last visit at every size; Needs my attention only starts at the fold |
| 2 Handling an overdue task (open the oldest, reassign, comment) | 2 to open a task; 4 to reassign; 7 with the comment | same (7) | the Overdue count and the list (17 of 17 equal) |
| 3 Adding work to a matter (create a task with its required fields) | 7 plus a 1,840 to 2,740 px scroll to find + New task | 7 plus 2,736 px | no: the control is far down the page |
| 4 Preparing for a client call (find the matter, read it, reach tasks and assets) | 2 to the Overview; 4 to the Assets tab; search 1 plus 1 | 3; 5; search 2 plus 1 | health, tasks by status, deadlines, people at 1366; Assets from 1920; not Activity at any size |

## Scenario 1: morning check

Steps and clicks: land on `/` (My Matters, 0), read the strip and the "Since your last visit" box (0), **Mark as read** (1), Deadlines (2), Workload (3), Trends (4), Activity (5). Screenshots: `*/morning-01-landing.png` to `morning-06-tab-activity.png`.

What helps
- The strip answers "how bad is it" in one line (Matters I manage 5, Open tasks, **Overdue 17**, Due in 3 days 9, ...), every cell is a link to the list it counts.
- "Since your last visit" gives counts that are links (2 tasks became overdue, 95 reassigned, 22 completed, ...) and the five newest events, in words; Mark as read is one click with a clear label.
- Workload lists pods and people with open, overdue, due this week and on hold, and a **Show matters** link per person; no ranking. Trends carry the plain-words note "Approximate. These figures are worked out from today's data" and "Show as table".
- No page scrolls sideways at any size; the tab strip scrolls inside itself on a phone.

What hurts
- At 375x812 the first screen is title, scope switch, a Filters button and a chip row whose red **Overdue** chip is cut off at the right edge, then the tab strip and the whole Since box: **Needs my attention starts at the fold** (R6, #818). At 1366x768 the Since box also pushes Needs my attention to the very bottom.
- Viewing the **Activity** tab and coming back changes "Since your last visit" to "Nothing has changed since your last visit." (also after a reload) although Mark as read was never pressed (R3, #815).
- The last strip cell reads "On hold, oldest 0 d 10": the age comes before the count (R9, #821).
- With demo data created today the Trends charts are almost flat; that is the data, not the page.

## Scenario 2: handling an overdue task

Steps and clicks: strip cell **Overdue 17** (1) opens the Task Queue with the 17 tasks (`overdue-01`); open the first task (2, `overdue-02-task-detail.png`); **Assignee** menu (3, `overdue-03`, 12 people with their open counts and "Unassigned"); pick a person (4, toast "TSK-59 assigned to Test User 02. Undo", `overdue-04`); Comments tab (5), focus the box and type (6), post (7).

What helps
- The count and the list are the same 17; the task page crumb carries the matter (one click to it); the Due cell says "Oct 13, overdue 12d" in words and red.
- The assignee menu shows each person's open count, so the PM picks someone with room; the change is one click with an **Undo** toast.
- Task and matter references are links everywhere; Back returns to the list.

What hurts
- The three signals on the Task Queue disagree: the scope switch has **All** pressed, the chip says "On matters I manage", and the status chips count everything (All open 159, Overdue 36) while the list holds 17 (R1, #813; `overdue-01-overdue-list.png` at every size).
- The list is in priority order: the task 68 days overdue is the fourth row (R5, #817).
- The assignee menu does not show who is away or already overloaded (not filed: needs the workload/away data in the picker; candidate for the epic's next round).

## Scenario 3: adding work to a matter

Steps and clicks: on My Matters scroll to Matter health (0 clicks, **2,004 px at 1366x768, 1,839 at 1920x1080, 1,943 at 768x1024, 2,736 at 375x812**), **+ New task** on the matter row (1) opens Create task with the matter fixed and a chooser of about twenty task type cards, choose a type (2), fill the title and the required requestor name, category (2 clicks), what is needed, what drives the due date (2 clicks), **Create task** (7); the task is created and the page returns to My Matters. Screenshots `addwork-01` to `addwork-06`.

What helps
- The matter is fixed and shown in the form's crumb; Create returns to My Matters (and Cancel does too); required fields are marked "(required)" and the error summary names each one in words.
- "Create and add another" exists for several tasks.

What hurts
- **The control is a scroll away** from the top of My Matters; the global Create task button does not know the matter (R2, #814).
- A chooser of twenty cards stands before the form; nothing remembers the last types used (R2, #814).
- Four required fields (requestor name, category, what is needed, due driver) are asked again for every task although the PM entered the same answers a minute ago (R7, #819).

## Scenario 4: preparing for a client call

Steps and clicks: Matters (1; on a phone Menu then Matters = 2), open the matter (2; 3 on a phone), read the Overview (0), **More actions** (3, the four actions in `clientcall-03`), **Assets** tab (4), search: header search (1; on a phone the search button first = 2), type "Smith", result list with matters and assets. Screenshots `clientcall-01` to `clientcall-05`.

What helps
- One screen per matter: Health Red with reasons as links ("2 tasks are overdue", "3 tasks have nobody assigned", "2 tasks are due within 3 days"), Tasks by status (links), Next deadlines, **Who is working on it** with open and overdue counts. The Matters list says "Matters you manage (5 of 28)" so the PM knows what is in view.
- Search is global and offers matters and assets in one list with "View all results".

What hurts
- The same counts appear twice: the matter header strip (Open, Overdue, Unassigned, On hold) and the Overview strip (Open, Overdue, Due soon, ASAP, On hold); on a phone they take about 45 percent of the first screen before Health (R4, #816).
- Assets and Recent activity fall below the first screen at 1366x768 (Assets visible from 1920 and 768x1024; Activity at none of the sizes).

## Ranked recommendations (all filed under epic #812 "Epic: PM experience follow-ups")

| Rank | Issue | Severity | Effort | What |
|---|---|---|---|---|
| 1 | #813 R1 | High | 3 h | Scope switch and chip counts agree with the link that opened the Task Queue |
| 2 | #814 R2 | High | 4 h | New task from the first screen; recently used task types |
| 3 | #815 R3 | Medium | 2 h | Opening Activity must not consume "Since your last visit" |
| 4 | #816 R4 | Medium | 1.5 h | Matter Overview: each count once, Health and Recent activity near the top |
| 5 | #817 R5 | Medium | 1.5 h | Overdue links open oldest overdue first |
| 6 | #818 R6 | Medium | 3 h | Phone My Matters: Overdue and Needs my attention in the first screen |
| 7 | #819 R7 | Low | 2.5 h | Create task offers the answers of the last task of the same type |
| 8 | #820 R8 | Low | 2 h | Skip links between the My Matters panels (more than 60 Tab stops) |
| 9 | #821 R9 | Low | 0.5 h | "On hold, oldest 0 d 10" reads wrongly |

Total about 20 agent-hours. Not implemented here.

Not filed (considered, judged not worth it now): showing away or load in the assignee picker; Reports in the PM menu and the starter reports (wait for epic #671, issues #775 and #784 stay open).

Found outside the PM views and filed apart: #822 (My Work at 375 px fails axe `target-size` on a populated database), #823 (specs that fail only in a full run or on a populated database).

## Verification (issue #785 and #786)

- `px6-matrix` (12 tests): permission matrix, Tab stops, reduced motion, 200 percent zoom; green with the sensitive-matter rule off and on.
- PM specs (`px3-*`, `px4-tabs`, `px5-matter`, `pm4-*`, `pm5-access`, `pm-matters`, `pw2-scope`, `sensitive-ui`, `sensitive-leak-scan`) with the rule off: 131 passed, 1 failed (`nav-phone`, see #822), 1 skipped; with the rule on (data volume of a long run): all PM specs passed, `sensitive-ui` and `sensitive-leak-scan` failed on the populated database and passed 14 of 14 on a fresh one (#823).
