# UX mockups

Clickable, self-contained HTML mockups (mock data, no build, no network). Open by double-clicking. They change no product code.

## Dashboard (`dashboard-mockup.html`)

Screenshots: `screenshots/dashboard-*.png` (1366, 1920, 768, 375; tabs; empty, loading and technician states).
Deep links for review: `dashboard-mockup.html#opt=B&tab=users&state=empty&role=tech`.

### What it is
The app shell (LPT Hub, navy rail, top bar) around a redesigned Dashboard. Mock data: 4 clients, 8 matters, 60 tasks, 8 people, dates around 2026-10-29.
The small "Mockup" button (bottom right) switches the design option, the state (live, empty, loading) and the viewer (Director, or Technician who only sees the unassigned queue, as `Dashboard.ViewUnassigned` does today).

### Three first-screen options (Summary tab)
- **A, What is late**: three large tiles (Overdue, Due in 2 days, Unassigned) that double as the switch for one task list below; ASAP, On hold, Open, Completed are demoted to a quiet "Also on your radar" list; "What changed" is a short feed. Order = what is late, what is next, what changed.
- **B, Client and matter story**: Client cards, then the matters of that client in a sortable table, then results for the chosen scope as three tabs (late, next, changed). Clicking a card or a row drives the same Client then Matter filters.
- **C, Executive summary**: one plain sentence ("3 of 8 matters have overdue work"), four big KPIs with change vs last week, matters ranked by risk, a small created-vs-completed chart. Best for a Director who wants no list.

All options keep the five tabs (Summary, Breakdowns, Trends, Swimlane, Users), the period control, drill-down ("Open in Tasks"), a task drawer from any row, sortable headers, and the Users Workload/Coverage views.

### What was removed or demoted from today's page
- The separate Needs attention and Overview tile blocks (8 equal tiles) became 3 large tiles plus a quiet radar list; the period control now sits in the filter bar, not inside the Overview heading.
- Three lists (Unassigned, Overdue, Due soon) shown at once became one list that you switch with the tiles. Rows are one line (44 px).
- Per-row inline assignee drop-downs and "Created today" text left the list (assign from the drawer, or "Assign to me" for technicians).
- The Refresh tooltip text became one visible "Updated 09:42".
- Swimlane shows 4 cards per lane with "show more"; the filter strip is two controls.

### Colour meaning
Red = overdue, act now. Amber = at risk (due in 2 days, watch). Blue = information and primary actions (ASAP, open). Teal = healthy or done. Violet = needs a person (unassigned). Slate = neutral or waiting (on hold, empty). Colour is always paired with an icon and a word; text colours are at least 4.5:1 on their tint. A zero in Overdue, Due soon or Unassigned turns teal ("All clear").

### Things to try
Pick a Client, then watch the Matter list narrow; pick a Matter first and the Client follows. Click each tile. Sort a column, "Show all". Click a row (drawer; Esc closes). Switch Period. Breakdowns: click a task type to filter. Trends: toggle the legend chips. Users: Workload/Coverage, Cards/Table. Switch to Technician and press "Assign to me". Try the empty and loading states, and resize the window.

### Open questions
1. Should ASAP get a hero tile (it is only in the radar here)? The round-3 review flagged ASAP as invisible.
2. Is "Due in 2 days" (today's definition) the right window, or should it be 7?
3. Should On hold stay slate (neutral) or count as amber attention?
4. Which option should be the default, and should it depend on role (Director C, Project Manager B, Pod Lead A)?
5. Client health uses overdue counts only (3+ for a client, 2+ for a matter); is that the right rule?
6. The Matter filter shows all matters grouped by client when no client is chosen; is that clearer than disabling it?
7. Keyboard shortcuts were not touched (phase rule); the mockup only has Ctrl K for search.


---

# My Matters mockup (`my-matters-mockup.html`)

Open the file by double-clicking. One self-contained page, mock data only (3 clients, 5 matters for Test User 19, 70 tasks, 36 assets, 30 activity events, today = Thu 2026-10-29). Corner control "Design option" in the top bar: **A Work first**, **B Client first**, **C Board**, plus toggles **One matter** (a PM with a single matter) and **Empty** (no data). Screenshots: `screenshots/my-matters-*.png` (1366, 1920, 768, 375).

### Design options
- **A, Work first ("what needs me today").** Three big decision cards answer the litigation PM's questions in three seconds: **Late** (red), **About to slip** (amber, with "N due in 7 days"), **Needs a decision** (violet, with "N on hold"). They are the pre-filter: a click filters the one grid below (urgency order, 25 per page, scrolls in its frame). The dropdown "Show: All open (62)" with counts stays beside the Calendar button and stays in sync.
- **B, Client first.** Filters run Client, then Matter. The chosen client or matter becomes a context header (names, role chips, Sensitive chip, five key counts that are also the filter, and a late / at risk / on track bar). With no matter chosen, five matter cards ask you to pick one. Then the grid.
- **C, Board.** Status columns New, In progress, On hold, Done, cards sorted by urgency, colour-coded lens chips with counts above.
All three share the same filters, Calendar (month, Previous / Next / Today, warning icon on overdue, "+N more"), Breakdown, Data (selection bar, tiles, Table / Bar / Pie) and Activity (grid, unread dots, Mark as read, badge on the tab). A task opens in a side drawer.

### What was removed or changed against today's page
- Six tiles and the count strip are replaced by three cards (A), a context header (B) or lens chips (C); every option shows the same counts, nothing is printed twice.
- Filter bar is ordered by how people think: Client, then Matter, then Focus (task types), then Due. Matter is narrowed by the client; picking a matter sets the client. Labels sit inside the control. "I am" (role) and My / All matters moved into the Options menu. With one matter there are no filters at all. Focus and Due appear only where they can change the result (Overview, Breakdown).
- Grid: Ref hides below 1560 px; pills only for High / Critical / On hold / At risk; overdue shows "26 d overdue" with the date; unassigned is violet with an icon. No coloured row borders.
- Page gutters 32 px, card padding 16 to 24 px, gaps 16 px; hero numbers 44 px; Data header and descriptions dropped; Breakdown shows one number per cell, drill-down on click.
- Kept: Options + New task, Focus as the only task-type filter, each task once, one-line empty states, Primary / Secondary roles, Activity badge instead of a "since last visit" block on Overview, sensitive matters never listed (only the PM's own is marked), no new shortcuts.
- Reverses (and says so): the owner removed tiles in favour of a dropdown; option A brings back three large cards as the visible face of that same dropdown, because the brief asks for the three key things in three seconds. The grid, dropdown and counts are unchanged.

### Colour meaning
Red = overdue, act now. Amber = at risk. Blue = information, primary action, due soon. Teal = healthy, on track, active (a zero in a red / amber / violet card turns teal). Violet = needs a decision (unassigned). Slate = waiting or neutral (on hold). Task types keep their own icon colours. Every colour comes with an icon and a word; text is at least 4.5:1 on its tint.

### Things to try
Pick a client and watch Matter narrow (type to search); pick Focus types (multi-select with search); click the three cards, the "20 due in 7 days" link and the dropdown; sort a header, page; open Calendar, Next, Today, "+N more"; click a title for the drawer (Esc closes); Breakdown cell click drills to the tasks; Data Table / Bar / Pie and Group by; Activity Mark as read; Options menu; switch design option, One matter, Empty; resize to phone (menu button opens navigation).

### Open questions
1. Is bringing back three cards (A) acceptable given the tiles-to-dropdown decision of 2026-10-29?
2. In A the first task row is about 490 px at 1366x768 (budget in AO is 300 px). Is the colour headline worth that, or should cards be a slim strip?
3. Is "About to slip" = At risk with a link to Due soon the right grouping, and "Needs a decision" = Unassigned plus On hold?
4. Should B be the default once a matter is chosen, and A when none is?
5. Board (C): is a status board wanted at all for a PM, or only as a Pod Work view?
6. Should Due (period) stay a filter next to Focus, or be dropped as it overlaps "Due soon"?


---

# Dashboard mockup v2 (`dashboard-mockup-v2.html`)

Owner feedback on v1: "I like option A look and feel, but the box and font in the tiles are too big. Using the similar style, re-design the current Dashboard." This is a new standalone file; `dashboard-mockup.html` (v1) is untouched, so the two can be opened side by side. Mock data is v1's (4 clients, 8 matters, 60 tasks, 8 people, today = Thu 2026-10-29). Screenshots: `screenshots/dashboard-v2-*.png` (A and Recommended at 1366, 1920, 768, 375; roles; every tab; empty, loading and stale states; the mockup panel).
Deep links: `dashboard-mockup-v2.html#design=R&role=pm&tab=swimlane&state=stale&client=nw&matter=m2041&list=asap&win=2` (`design` A or R; `role` director, pm, pod, tech; `state` live, empty, loading, stale).

### What changed against v1
- **Tiles are compact and calm.** About 96 px tall (v1 about 156), 203 to 232 px wide, number 30 px semi-bold (v1 56 px bold), label 13.5 px, hint 13 px, icon chip 32 px (v1 56), inner padding 14 px. Still one row at 1366 and 1920. The number is the first thing the eye lands on: it is the largest, darkest text in the row, in the tone's dark ink. Selected tile = 2 px ring plus a small chevron (no thick coloured borders); zero = teal "All clear".
- **Type scale for the whole page** (v1 mixed 15 to 30 px): page title 22 px, section titles 17 px, body and tables 14 px, labels 13 px, smallest text 12 px (chart axes only). Controls are 38 px (v1 44), table rows 42 px (v1 44), page gutters 24 px (32 px from 1500 px), gaps 16 px, card padding 16 px.
- **No thick coloured borders anywhere.** v1 had 5 px accent strips on client cards, swimlane cards, KPI and user cards; v2 uses a state chip, a pill or a dot instead (checked by script: no border of 3 px or more).
- Summary is two rows: tiles, then the list with its right-hand column. The radar (ASAP, On hold, Open, Completed) moved into the tile row in design A; in Recommended ASAP and On hold became tiles and Open and Completed live in the "Show" dropdown.
- "Updated 09:42" is gone from the header: the real page shows no timestamp in a normal session (decision S) and says "Updated N min ago" only when the figures are stale. The Stale state in the mockup panel shows it.
- Breakdowns now has the four cards the real page has (Priority, Status, Task type, Age), each with Bars, Table or Pie. Trends has the Measure switch (Created and completed, Open backlog). Swimlane cards show an out-of-office marker on the avatar. Users, Coverage, Technician queue, empty and loading states are all restyled.
- The Project Manager role and the Pod Lead role are now in "View as". Tabs follow the seeded permissions: Director all five, Pod Lead Summary, Swimlane and Users, Technician the unassigned queue only. The Project Manager has no Dashboard by default (architecture.md); the mockup shows Summary and Swimlane as if an administrator granted them.

### The two designs ("Mockup" button, bottom right, Design)
- **A compact** is your option A with smaller tiles and nothing else rethought: three tiles (Overdue, Due in 2 days, Unassigned), a quiet radar card (ASAP, On hold, Open, Completed) in the same row, one task list that the tiles switch, "What changed" beside it. Five-column task table with Priority, sortable headers.
- **Recommended** applies the answers below. Five tiles in a fixed order (what is late, what is next, who is waiting): Overdue, ASAP, Due in 7 days, Unassigned, On hold. A one-line sentence under the title ("2 of 8 matters are late. 10 tasks overdue, 6 ASAP."). The list has a "Show" dropdown with counts that stays in sync with the tiles, urgency order by default, pills only for unusual values (ASAP, High, On hold), overdue shown as "12 days late". Beside it a Clients card (then Matters of the chosen client) with Late, At risk or On track, then "What changed" with 3 items. It follows the My Matters decisions: one task grid with a pre-filter dropdown, urgency order, pills for unusual values only, Client then Matter dropdowns, same colour words and the same 7-day look-ahead.

### My answers to the six open questions (shown in Recommended)
1. **ASAP visibility: its own tile, second in the row.** ASAP work has no date, so it can never appear in Overdue or Due soon; that is why it felt invisible. A badge on rows only helps after you open the list, a tile costs one small box and shows "Oldest 11 days". Rows also carry an ASAP pill. If the owner wants only four tiles, ASAP is the last one to drop and would then live in the "Show" dropdown.
2. **Due soon window: 7 days by default, with a 2 days / 7 days switch in the list header.** Document review and production deadlines need lead time, and My Matters already looks 7 days ahead, so the two pages agree. The tile hint keeps today's question ("2 today, 3 tomorrow"). Design A keeps today's 2 days.
3. **On hold: a quiet slate tile at the end, next to Unassigned.** It is waiting, not late, so never red or amber and never in the headline sentence. It sits beside Unassigned because both are "waiting for a person or a decision", the same grouping as "Needs a decision" in My Matters. On-hold tasks are not counted again in Overdue or Due soon.
4. **Role-based default (Recommended design).** Director: tiles in the order above, the Clients health card on the right (firm-wide: which client, which matter). Project Manager: scoped to their own matters (My matters / All matters toggle), the card lists their matters; list starts on Overdue. Pod Lead: Unassigned is the first tile and the first list, the right-hand card is Team capacity (who has room), Users tab one click away. Technician: only the unassigned queue, ASAP first, "Assign to me". Design A is not role-based, except that the Technician sees the queue.
5. **Client and matter health rule (one sentence each, shown under "How health is decided").** Late = 3 or more overdue tasks, or any task 10 or more days overdue. At risk = 1 or 2 overdue, or 3 or more due in the next 2 days, or a task unassigned for 7 days or more. On track = none of these. A client is as healthy as its worst matter and says why ("1 of 2 matters late"). Counts, not percentages, so a big matter is not judged differently from a small one; the same three words as My Matters.
6. **Matter when no client is chosen: keep it enabled, grouped by client.** Disabling it forces two steps when you already know the matter. Picking a matter sets the client; picking a client narrows the matter list. The Clients card, the dropdowns and the tiles all drive the same filter chain.

### How to compare
Open `dashboard-mockup.html#opt=A` (v1) next to `dashboard-mockup-v2.html#design=A` to judge tile size only; then switch Design to Recommended. Walk the roles in "View as" (Director, Project Manager, Pod Lead, Technician) and the states (Empty, Loading, Stale). Click every tile; use the "Show" dropdown; switch the Due window 2 / 7 days; click a client, then a matter in the right-hand card (the dropdowns follow); open a task row (Esc closes); sort a header, then "Back to urgency order"; walk the five tabs (Pod Lead has three, Project Manager two).

### Measurements (Playwright)
Tiles are 96 px tall everywhere on desktop. At 1366: A 232 px wide (3 tiles plus the radar card), Recommended 203 px wide (5 tiles in one row). At 1920: 232 px wide, one row. At 768 the tiles wrap (3 + 2); at 375 they are two columns. No horizontal page scroll at any size tested; no console errors. Text pairs were checked with a WCAG ratio script (about 100 pairs, text 4.5:1, icon and ring colours 3:1): none fails.

### Open questions
1. Five tiles or four? ASAP and On hold are the candidates; the list dropdown keeps them reachable either way.
2. Should the Project Manager get the Dashboard at all? By default the role has none and works from My Matters; if yes, is "My matters" the right default scope?
3. 7 days as the default for Due soon changes today's meaning of the number (8 becomes 11 in the mock data). Acceptable, or keep 2 as the default and show 7 as the switch?
4. Is "Late / At risk / On track" the right wording on the Dashboard, or keep "Overdue work / Watch" from v1?
5. The sentence under the title (Recommended) is computed; keep it, or leave the subtitle as the date only?
6. Pod Lead sees Team capacity instead of Clients on Summary. Should Directors also get a team strip, or is the Users tab enough?
