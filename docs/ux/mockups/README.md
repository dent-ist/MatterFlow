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


---

# My Matters mockup v2 (`my-matters-mockup-v2.html`)

New standalone file; `my-matters-mockup.html` (v1, options A, B, C) and the Dashboard mockups are untouched. It answers the owner's direction of 2026-10-30: a list of **active** matters, indicators for what needs attention, and a **calendar of important dates per matter**. Open by double-clicking. Mock data only: 3 clients, 40 open matters (12 active, 3 sensitive), 90 tasks, 155 assets with adds and updates dated inside the last 7 days, 25 events across the 8 types in the next 6 weeks, 69 activity entries, today = Fri 2026-10-30, signed in as Test User 19.
Screenshots: `screenshots/my-matters-v2-*.png` (A and B at 1366, 1920, 768, 375; matter view, calendar, assets, breakdown, one-matter, empty, 100 matters, show all, Add event dialog, event drawer, active-window setting, searchable dropdown, mockup panel).
Deep links: `my-matters-mockup-v2.html#design=A&scope=m01&tab=calendar&month=2026-11` (`design` A or B; `scope` all or a matter id such as m01; `tab` tasks, calendar, assets, activity, breakdown, today, list; `state` normal, one, empty; `n=100`; `win` 3, 7, 14, 30; `soon=1`; `client` nw, hv, oc; `pre` overdue, critical, unassigned, due7, risk, hold; `all=1`; `ev=0`, `tk=0`).

### Rationale
A PM may have 50 to 100 or more open matters, and most of them are quiet on any given day. v1 put the work first and the matters second. The owner now wants the page to be a list of matters that have something going on, with the reasons visible at a glance, plus a calendar. So the matter is the unit of the first screen, and the tasks, assets and dates hang off it. Everything else from v1 is kept (see the list below). The Dashboard (director and pod lead) keeps its own job, firm-wide health, and does not repeat this page: My Matters is where the PM works.

### Definitions (all visible in the page, none hidden in code)
- **Active matter** = a matter where you are Primary or Secondary PM and it has **an open task** (New or In progress), **or assets added or updated in the last N days**. N is 7 by default and can be changed in the green "Active in the last 7 days" control (3, 7, 14, 30). Optional third rule in the same control, off by default: "Also include matters with an important date in the next 7 days". A task On hold does not make a matter active (it is waiting, and it still shows as "+1 hold" in the row). Everything else sits under **Show all matters (28 more)**, with search, paging and group by client. In the mock data 7 days gives 12 active, 14 days 13, 30 days 16.
- **Order** = need for attention, not name. Score = overdue x 6 + critical x 5 + unassigned x 3, plus 4 if the next date is within 3 days (2 if within 7), plus 1 if assets changed. Ties by name. Any column header re-sorts; "Back to needs-attention order" restores it.
- **Row indicators** (small, always icon plus word, none when zero so a quiet matter stays quiet): **unassigned** (violet, person icon), **overdue** (red, warning triangle), **critical** (deep orange, flame; a Critical task that is not on hold), **assets** (blue, box: "+12 new today, 3 updated"; "new" = added in the window, "updated" = older assets changed in the window), and the **next important date** (its event type icon and colour plus "in 5 days"; amber-bold within 3 days, red-bold today). A sixth column shows open tasks ("8 open, +1 hold").
- **Critical** is the existing task priority, not a new field. **At risk** (grid pill) = due within 2 days, as before.
- **Event types** (fixed list of 8, each with one icon and one colour; the PM picks the type and the icon follows, there is no free icon picker): Court hearing (courthouse, navy), Trial (scales, plum), Deposition (microphone, cyan), Production deadline (package, olive), Filing deadline (document, raspberry), Mediation or settlement (two arrows meeting, green), Client meeting or call (speech bubble, brown), Other (pin, slate). The event colours are deliberately not the status colours (red, amber, blue, teal, violet), so an event never reads as "overdue". Icon, word and colour always appear together; every pair is at least 4.5:1.
- **Calendar layers** (two switches): **Matter events** and **Task due dates** (several tasks on one day collapse into "N tasks due", with a warning icon and red when any is overdue). The legend at the bottom shows or hides single event types. In "All active matters" scope the calendar shows events of **all** your matters, active or quiet, because a deposition on a quiet matter still matters; task due dates stay those of the active matters.
- **Add event** dialog: Matter (searchable dropdown), Type (eight radio tiles), Title, Date, optional Time, optional Note, optional Reminder (1, 2, 3, 5, 7 days before). Edit and Delete (with a one-line confirmation) from the event drawer. Saving jumps the calendar to that month and says so in a toast. Validation messages are inline.
- **Sensitive matters**: events inherit the matter's visibility. A sensitive matter's events are invisible to people who cannot see the matter; the dialog says "Only people with access to this matter will see this event" for a sensitive matter and "Visible to people who can see this matter" otherwise. Three of the 40 mock matters are sensitive (lock chip).

### The two designs (Mockup button, bottom right)
- **A. Active matters first (recommended).** The page opens on the list of active matters: a slim filter bar (Client, then Matter, then the active-window control, find box, group by client), then the ordered list with the indicators. Picking a matter (from the list, or the Matter dropdown, or "Tasks of all active matters") opens a context view: one header card (client, matter, Primary or Secondary, why it is active, count buttons that double as the task filter, next three important dates, Add event) and tabs Tasks (the one grid, urgency order, Show dropdown with counts, Focus, 25 per page), Calendar, Assets and data (selection bar, tiles, Table, Bar, Pie, recent changes), Activity (grid, unread, Mark as read), Breakdown (matrix, click a number to drill into the tasks).
- **B. Work and dates.** The page opens on what needs me today: five compact tiles (96 px class, number 30 px: Overdue, Critical, Unassigned, Due soon, New assets) and the task grid on the left, a mini calendar and a "Coming up" agenda (next 14 days, Matter events and Task due dates switches, overdue summary, click a day to filter) on the right. The active-matters list is a tab (with the count), and picking a matter there scopes the whole page to it (a chip "Scope: ..." with a close button). Tabs: Work and dates, Active matters, Calendar, Assets and data, Activity, Breakdown.

**Why A.** The owner's first sentence is a list of matters with recent activity, and the question a PM with 100 matters asks first is "which of my matters need me". In A the list is the page and a matter is one click away; the reasons are printed in the row, so most days the PM does not need to open anything. B is better for the PM who lives in the task grid and wants the dates beside it; it spends 360 px on the right column and shows the task grid narrower (the Matter column becomes a second line, Status becomes an inline pill). I would ship A and borrow B's "Coming up" agenda as an optional card on the Calendar tab if the owner likes it.

Both designs share: All active matters scope plus per-matter scope, Client then Matter searchable dropdowns without labels (the matter list shows "no recent activity" next to quiet matters and puts active ones first), the Primary and Secondary chips, sensitive matters invisible to others, each task once, one Focus filter, one task grid (urgency order, pills only for High, Critical, On hold, At risk, 25 per page, scrolls inside its frame), dark navy navigation with the white pill and the agreed menu order, no thick coloured borders, 24 to 32 px gutters, 16 to 24 px card padding, a task drawer (Esc closes), keyboard focus ring, semantic markup (tablist, dialog, listbox, table, aria-sort, live regions), reduced motion.

### States in the Mockup panel
- **PM with one matter**: no list and no filters; the page opens in the matter view without a back link.
- **No matters yet**: one-line explanation, no Add event.
- **100 matters (stress)**: about 35 active in the mock data; the active list pages at 25, can be searched, sorted and grouped by client; "Show all matters" has its own search and paging. No row is rendered that is not on the page, so the list does not slow down.
- Plus an empty message inside the list when nothing is active ("No active matters in the last N days ... Show all matters").

### What was kept from earlier decisions
Little on the first screen, generous margins, colour meaning (red overdue or act now, amber at risk or due soon, blue information, teal healthy, violet needs a person, slate neutral; deep orange only for Critical), mental-model order Client, Matter, results, one grid with a pre-filter dropdown, each task once, compact tiles only in B and in the Dashboard v2 size, navy navigation, Activity as a grid, Breakdown matrix, Data tab with selection bar, tiles and Table or Bar or Pie. The Trends tab and the old Overview matters block stay removed. No keyboard shortcut was added or changed (phase rule, issue #420).

### Which earlier decisions this reverses or changes
1. **Reverses** the PM v2 decision "matter key dates are not wanted". The owner now wants important dates per matter, so events, a calendar and a "next important date" column exist.
2. **Changes** the v1 page order: v1 opened on the task decision (cards in A, a client context in B). v2 A opens on the matter list. The v1 task cards (Late, About to slip, Needs a decision) are replaced by the row indicators and the count buttons; v2 B keeps tiles, but five compact ones.
3. **Changes** the v1 Calendar: it showed only task due dates; it now shows two layers, and the task-only calendar is the second layer.
4. **Adds** a "Critical" colour (deep orange) because red already means overdue; the earlier palette had no separate Critical colour.

### What to click
Open the page. Read the first row (FTC Second Request: 4 overdue, 3 critical, 2 unassigned, +8 new assets, a client call today). Click **Active in the last 7 days** and change to 14, then 30 days, then tick the third rule; click **Show all matters** (search, page 2, group by client). Pick a client, then the Matter dropdown and type "tess". Click the matter name **Northwind v. Meridian Pharma**: use the count buttons (overdue, critical, unassigned), the Show and Focus dropdowns, sort a header, open a task (Esc closes). Open **Calendar**: Next, Today, switch the two layers, hide a type in the legend, click a day number (pop-up) and the + on a day; click an event, **Edit**, **Delete** (confirm). Click **Add event**: save empty (inline messages), pick a sensitive matter (Qui Tam) to see the visibility line, choose a type and save. Try Assets and data (Table, Bar, Pie, Group by), Activity (Mark as read), Breakdown (click a red number). In the Mockup panel switch to **B** (tiles, click a mini-calendar day, the Active matters tab, the scope chip), then **PM with one matter**, **No matters yet**, **100 matters**, **Reset**. Resize to 768 and 375.

### Measurements (Playwright)
No console errors; no horizontal page scroll at 1366, 1920, 768 or 375 for the six main views; about 90 scripted checks (every filter, dropdown, sort, page, tab, layer, legend, dialog, drawer, deep link, state) passed. Text contrast was checked on 36 view and state combinations at 1366 and 375 (text 4.5:1 on its real background, including dropdowns, dialogs, drawer, pop-ups): no failures after fixing one grey zero in the Breakdown matrix. B tiles are about 92 px tall. The list shows about 5 rows at 1366x768 and about 11 at 1920x1080.

### Open questions
1. **Definition of active.** Is "open task (New or In progress) or assets changed in the last 7 days" right? Should On hold count? Should an upcoming important date make a matter active (the optional third rule), or only appear in the next-date column? Is 7 the right default, and should a firm administrator or each PM own N?
2. **Which assets count.** "Added or updated" is read from the asset's own timestamps; does an update to an asset's documents count, or only to the asset record? Do archived assets count?
3. **Order.** Is the attention score (overdue, critical, unassigned, date) the right order, or should the PM choose a saved order (for example by client)?
4. **Critical.** Is the task priority "Critical" the right source for the flame, or should a PM be able to flag a whole matter as critical?
5. **Event data model.** Event per matter only, or also per project or asset? One matter per event (as drawn) or several? Recurring events? Is the type a fixed list in code, or an Administration list the firm can extend (the owner said "a handful", about 8)? Time zone for time of day and for the reminder? Should an all-day filing deadline carry a time (a 5 pm cut-off) and warn when it passes?
6. **Reminders.** "N days before" shows only in the dialog here. Who is reminded: the creator, the Primary and Secondary PM, the assigned technicians? Through the bell, e-mail, or both? Is the reminder an extra notification type in the existing preferences?
7. **Permissions.** Who can add, edit and delete an event: Primary PM only, Secondary PM too, Pod Lead, Director? A new permission in `contracts/permissions.json` (for example `Events.Manage` and `Events.View`), or is it tied to editing the matter? Events must follow matter visibility: sensitive matters hide their events from everyone who cannot see the matter (also in reminders, the bell, search and any Dashboard or Pod Work use). Should the audit log record event changes?
8. **Who sees dates.** Should Technicians see the dates of the matters they work on (read only)? Should a client-facing or shared calendar export (iCal feed) exist, and is that allowed for sensitive matters?
9. **Calendar scope.** In "All active matters" I show events of all matters and tasks of active matters only. Is that surprising? Alternative: a switch "Include quiet matters".
10. **Dashboard.** Directors and pod leads should not get the same page. Does the Dashboard want only a single "dates this week" line, or nothing about dates at all?
11. **B on the same page.** Could A and B be one product, with B's agenda as a card on the Calendar tab and the user choosing a default tab?

### Notes for the build
The real page needs a matter-level query that returns, per matter, the counts (open, overdue, critical, unassigned), the asset adds and updates for N days and the next event. That is one aggregate per matter, so it scales to 100 or more matters with paging on the server. The events feature needs a table and API (create, update, delete, list by date range and matter), the permission catalog entries, the OpenAPI contract and the generated client, as the architecture rules require. Nothing in this mockup changes product code.
