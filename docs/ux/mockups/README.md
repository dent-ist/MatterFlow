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

# My Matters v3 samples (`my-matters-v3-a-dropdowns.html`, `my-matters-v3-b-tree.html`, `my-matters-v3-c-recommended.html`)

Three self-contained, clickable samples (inline CSS and JS, system fonts, inline SVG, no network). They reuse the data of v2 (3 clients, 40 open matters of which 12 are active, 90 tasks, 155 assets, 25 events of the 8 types) with today = Saturday 31 October 2026, signed in as Test User 19. Mock data only; nothing here changes product code, tests, contracts or configuration. The older mockups are untouched.

| File | What it is |
|---|---|
| `my-matters-v3-a-dropdowns.html` | **A.** The project managers' layout built exactly as specified: title with icon, Client and Matter dropdowns and `+ New` on one row, tabs Overview, Calendar, Assets, Metrics, Activity. |
| `my-matters-v3-b-tree.html` | **B.** The same page plus a docked tree of clients and matters on the left that collapses to a thin rail after you choose. The dropdowns stay and stay in sync. |
| `my-matters-v3-c-recommended.html` | **C. Recommended.** The PM page, plus the v2 active-matters list with indicators, plus the tree as an on-demand Browse panel instead of a permanent column. |

Screenshots: `screenshots/my-matters-v3-*.png` (A, B and C at 1366, 1920, 768 and 375; calendar and Shows dropdown; assets with side panel; Metrics breakdown and data; Activity; task opened in a new window (A, B) and in the drawer (C); + New menu with a disabled option and its reason; New calendar item dialog; matter dropdown; tree open, rail, search and 100 matters (B); Browse panel and group by client (C); one matter, empty and 100 matters).

Open any file and use the dashed **Mockup** button (bottom right): number of matters (40, one, none, 100), what you may create (everything or limited), and what a click on a task does (new window or right drawer). Deep links: `my-matters-v3-c-recommended.html#client=nw&matter=m01&tab=calendar&month=2026-11` (`client` nw, hv, oc; `matter` m01 to m40; `tab` overview, calendar, assets, metrics, activity; `mview` data; `state` one or empty; `n=100`; `perm=limited`; `open` window or drawer; `tree=1` keeps B's tree open with a selection).

## How the PM feedback was applied

The PM list (item 8 is empty in the source, so there are seven items; please send the missing one) was built in A exactly, then judged.

| PM item | In A (exact) | Review decision applied in B and C |
|---|---|---|
| 1. Title with icon | Navy clipboard icon plus "My Matters". | Same. |
| 2. Client and Matter dropdowns | Two searchable dropdowns in the header, Client first. Picking a client narrows the Matter list; picking a matter sets the client. "Clear" resets both. | Same. In C the Matter list shows active matters first (teal dot), then quiet ones, and each matter shows a lock chip when it is sensitive. |
| 3. `+ New` on the right of the same row | Button with a menu: New task, New calendar item, New asset, New project. Each opens a dialog prefilled with the chosen client and matter; the project dialog opens with no matter when none is chosen. The calendar-item dialog has the 8 event types with icons. In the Mockup panel, "Limited" disables New asset and New project, each with a tooltip reason (hover or focus). With no matters at all, all four are disabled with a reason. | C moves the item that fits the current tab to the top and marks it "suggested here". |
| 4. Tabs | Overview, Calendar, Assets, Metrics, Activity (arrow keys move between tabs). Activity shows an unread count. | Same. |
| 5. Overview | Left: task list of the chosen scope. Right top: upcoming events (next 14 days). Right bottom: recent activity. Changing client or matter updates all panels at once with a short, subtle highlight and a polite screen-reader announcement. | The task list is the shared task grid (urgency order, "All open tasks (69)" pre-filter with counts, pills only for High, Critical, On hold and At risk, sortable headers, 25 per page, scrolls inside its frame), scoped to all of the PM's matters when none is chosen. The activity panel is a 6-item preview with filter chips and "View all" to the Activity tab. |
| 5. Click on an activity item opens a new window | A and B open a simulated browser window (tab, address bar, task page, closable with its X or Esc). | C opens a right-hand drawer with an **Open in new window** button. Both behaviours exist in all three files (Mockup panel). |
| 6. Calendar | Current month, previous, Today, next; `+ Add Event` above the calendar; **Shows** multi-select (Calendar events on, Critical tasks on, High priority tasks, All task due dates, Overdue tasks); the 8 event icons; adding an event with a type picker; click a day for details. | Same. The calendar follows the client and matter on top. |
| 7. Assets | Columns client, matter, asset type, created, updated, status (Active, Inactive, Pending disposition, Disposed), comment. Sortable headers, a filter under every column, a search box, 25 per page inside the frame, click a row for a side panel (fields, size, disposition history, linked tasks, comments, add a comment). | Same. |
| "Metrics" tab | One tab with a small toggle: **Breakdown** (matters by task type, click a number to drill into those tasks; one matter shows task type by status instead) and **Data** (group by, tiles including volume, Table, Bar, Pie). Nothing from v2 is lost. | Same. |
| "Activity" tab | Its own grid: When, Who, What, Task, Matter, unread dots, kind chips, Mark as read, paging. | Same. |

Activity kinds (6, owner decision): New assets, New comments, New status updates, On hold, Overdue, Due date updated. The PM's "Delayed" was merged into Overdue by the owner's decision, so there is no separate Delayed kind anywhere.

## Where I deviated from the PM list, and why

1. **Metrics holds two views.** The PM list had no place for the v2 Breakdown and Data; a toggle keeps both so no capability is lost and the tab bar stays at five tabs.
2. **Overview shows only 6 activity items.** The full grid already lives in the Activity tab; a preview that repeats it would show each activity twice. The chips filter the preview; "View all" carries the chosen chip to the tab.
3. **Click on an activity opens a drawer in C (new window kept as an option).** A new window loses the page behind it, is blocked by pop-up blockers on some browsers, needs its own permission check and a deep-linkable task URL, and makes the PM juggle windows. A right drawer keeps the list in view, closes with Esc, and still offers **Open in new window** for the PM who wants a second screen. I recommend the drawer as the default. An asset activity opens the Assets tab with that asset's side panel (there is no task to show).
4. **"Criticality" is task priority.** The Shows dropdown says Critical tasks (priority Critical) and High priority tasks; the app has no separate criticality weight (earlier owner decision).
5. **Tasks are one grid.** Each task appears once per screen: the calendar shows task due dates as chips that open the same task view, and the Overview lists each task once.
6. **The global "Create task" button in the top bar is not drawn** in these samples so there is one obvious place to create things (`+ New`). Please confirm whether the top-bar button stays.
7. **Asset name.** The PM's seven columns do not include the asset name; the asset type cell shows the name on its first line and the type below it, so sorting by "Asset type" sorts by type.
8. **C does not dock the tree** (see the verdict below).

## The tree view, judged honestly

What B does: a 280 px tree (clients, then their matters) docked left of the content. Each node shows a count and indicators: a teal dot for an active matter, a hollow dot for a quiet one (with screen-reader words), a red warning count for overdue tasks, a lock for a sensitive matter, and the number of matters or open tasks. Choosing a client or a matter selects it everywhere and the tree **collapses to a 48 px rail** (expand button, the current "Client > Matter" written vertically, a clear button). The pin button keeps the tree open after choosing. Search filters the tree and opens the clients that match; "Active only" hides quiet matters; "Expand all" and "Collapse all" are one toggle. Open or closed state of each client and the pin are remembered (browser storage). The tree follows the dropdowns and the dropdowns follow the tree. Keyboard: `role="tree"`, Up and Down move, Right opens or goes to the first child, Left closes or goes to the parent, Home and End, Enter or Space select, `*` opens all, typing jumps to the next label (type-ahead). Below 1100 px the docked tree is not used; the same tree opens as a panel from the Browse button.

When it helps:
- A PM with many matters across several clients who wants the whole structure on screen at once with overdue counts per matter and per client.
- Keyboard users who like arrow navigation, and screens of about 1600 px or wider, where docking costs little (at 1920 px the content is still about 1330 px wide).
- A deeper hierarchy later (client, matter, project): a tree is the natural picture.

When it hurts:
- **Width.** At 1366 px the navy navigation takes 232 px; a docked tree takes another 296 px (280 plus the gap). The content falls from 1070 px to **774 px**, the right-hand panels drop below the task list, and the PM sees less of the page that matters. Collapsed it is 1006 px, still 64 px less than without the rail.
- **Jumping.** Choosing a node collapses the tree and widens the content by about 230 px, so the whole page re-flows (the right column moves back beside the tasks). The page changes shape on every selection. The highlight helps, but it is the largest layout change in the app.
- **Two ways to do the same thing.** The dropdowns and the tree both choose; a new PM must learn both, and the rail text is vertical, which is slow to read.
- **Shallow data.** With three clients and about 14 matters each, a two-level tree is little more than a long dropdown. It earns its place only when the structure itself is the information.
- It does not say which matters need attention unless the dots are read; the v2 active list does that better.

**Recommended form:** do not dock it. Offer it on demand as a **Browse** panel next to the dropdowns (as in C): same tree, same keyboard semantics, search and counts, but it costs no width and closes after choosing. Group by client appears inline in the active matters list for the same overview. If the owner wants it docked, dock it only at 1600 px or wider and use the Browse panel below that.

## Comparison

| | A. Dropdowns (PM spec) | B. Dropdowns plus tree | C. Recommended |
|---|---|---|---|
| Content width at 1366 px (after the 232 px navigation) | 1070 px (78 percent) | 774 px with the tree open, 1006 px with the rail | 1070 px (the Browse panel floats over the page) |
| Right-hand panels beside the task list at 1366 | Yes | No with the tree open (they stack under the tasks), yes with the rail | Yes |
| Clicks from page load to a matter | 2 (Matter dropdown, pick; typing "tess" narrows it) | 1 if its client is open in the tree, 2 with the search; switching later is 2 or 3 (rail, click) | 1 if it is active (click its row in the list), 2 with the dropdown or Browse |
| Learnability | High: standard controls | Medium: two controls for one job, auto-collapse and a rail | High: the list explains itself; dropdowns work as in A |
| Which matters need me | Not shown | Dots and counts in the tree | Indicators in the list (overdue, critical, unassigned, assets, next date) |
| Scaling to 100 matters | Searchable dropdown (60 shown, "keep typing"); no overview | Tree with search and Active only; long scrolling lists per client | Active list of about 35 rows (pages by 25, groups by client); dropdown grouped Active and Quiet; Browse tree with search |
| Build cost | Low | High (tree component, accessibility, state memory, responsive) | Medium to high (list plus the same tree component, no docking) |
| Risk | Tasks only, so a quiet matter with a new asset is easy to miss | Layout jumps, narrower grid | Taller Overview: the list sits above the tasks (it scrolls inside its frame, 4 rows visible) |

**Recommendation: C.** It keeps everything the PM asked for (dropdowns, `+ New`, five tabs, the three-part Overview), keeps the owner's liked v2 ideas (active matters with indicators, calm look), and gives the tree idea its best use without charging width for it.

### Improvements in C and the reason for each
1. **Active matters list above the tasks when no matter is chosen** (v2 rule, indicators, attention order). Reason: the first question of a PM with many matters is "which of them needs me"; tasks alone do not answer it. It becomes a one-line context strip once a matter is chosen, with count buttons that filter the task list (overdue, critical, unassigned, due in 7 days).
2. **Browse tree as a panel, not a column.** Reason: width (see above) and no layout jump.
3. **Matter dropdown grouped Active first, Quiet second, sensitive chip.** Reason: the active list is where the PM works; quiet matters stay reachable by search.
4. **Group by client in the active list, collapsible, with counts.** Reason: the tree's best idea (the client as a parent) at no width cost.
5. **Task opens in a drawer with Open in new window.** Reason: see deviation 3.
6. **`+ New` puts the fitting item first on the Calendar and Assets tabs.** Reason: fewer clicks for the common case; the order of the four items otherwise stays fixed.
7. **Asset activity opens the asset's side panel.** Reason: the PM asked for the task; an asset has no task, so the nearest useful thing is shown.
8. **Real-time update** is instant and visible: all panels highlight together and a screen reader hears "Showing 40 open tasks, 5 upcoming events and 17 assets for ...".

## Definitions (please confirm)
- **Overdue** = an open task (New or In progress) whose due date is before today. Red. A task On hold is not overdue. The PM's "Delayed" is the same thing and was merged into Overdue (owner decision); the activity "Overdue" item appears when a task passes its due date.
- **Due date updated** = the due date of a task changed, later or earlier. Amber. The item says by how many days and which way.
- **On hold** = a task was put On hold. Slate. **New status update** = a task changed status (for example New to In progress). Teal. **New comment** = a comment on a task. **New assets** = an asset was added to, or updated in, a matter in the last 7 days. Blue.
- **At risk** (grid pill) = due within 2 days, as before.
- **Active matter** = a matter where you are Primary or Secondary PM and it has an open task (New or In progress) **or** assets added or updated in the last 7 days (teal dot, "Active" in the list header and tree legend; the same rule as v2). With the sample data: 12 of 40 (35 of 100 in the stress test).
- **Critical** is the task priority Critical; **High** is priority High. There is no separate criticality weight.
- **Asset status**: Active, Inactive, Pending disposition (amber, waiting for a retention decision), Disposed (dark slate). New assets can be created Active, Inactive or Pending disposition; Disposed is a result, not a starting state.
- **Content width** (comparison table) = the width of the page area that holds the tabs and their panels, measured at a 1366 x 768 window, after the navy navigation (232 px) and the 32 px gutters.
- **Sensitive matter** = invisible to people without access; this PM can see three of the 40 (lock chip in lists, tree, dropdown and dialogs; the event dialog says who can see the event).

## Kept from the owner's earlier rules
Little on the first screen, 24 to 32 px gutters and 16 to 24 px card padding, red overdue, amber at risk or due soon, blue information, teal healthy, violet needs a person, deep orange Critical, slate neutral (always icon plus word, 4.5:1), Client then Matter order, each task once per screen, no thick coloured borders, navy navigation #1A3556 with the white pill, menu order Dashboard, My Matters, My Work, Clients, Matters (Projects, Assets indented), Pod Work, Tasks, Administration, v0.1.1, no new keyboard shortcut concept (only the standard Esc, arrows, Enter, Home and End inside widgets; no global shortcut was added, phase rule, issue #420).

## What to click
Open **A**: choose a client in the Client dropdown, then the Matter dropdown (it only lists that client's matters); pick a matter and watch the three panels flash together; pick a matter of another client via **Clear** and see the client change by itself. Click **+ New** and open each of the four dialogs (save one empty to see the messages); in the Mockup panel switch "What you may create" to Limited and hover or Tab to the greyed New asset. On the Overview click an activity chip (Overdue), then an item: a simulated browser window opens (X or Esc closes it). Click **View all**. Open Calendar: Next, Today, the **Shows** dropdown (tick All task due dates), `+ Add Event` (pick a type, save), click a day. Open Assets: sort a header, filter Status = Pending disposition, type in a column filter, click a row for the side panel. Open Metrics: click a red number (it returns to the Overview with a filter chip), then Data (Table, Bar, Pie).
Open **B**: click a client in the tree (it collapses to the rail), click the rail button to expand again, use the keyboard in the tree (Up, Down, Right, Left, Home, End, type "orion", Enter), search "tess", turn on the pin, choose a matter in the Matter dropdown and see the tree follow. Compare the content width with the tree open and as a rail.
Open **C**: read the first row of the active list; click a matter row (it becomes the strip with count buttons), click **All matters**; tick Group by client; click **Browse** and use the tree; click an activity item (drawer) and **Open in new window**; use the Mockup panel for one matter, no matters, 100 matters. Resize to 768 and 375.

## Measurements (Playwright, Chromium)
- No console errors in any file, state or size (1366 x 768, 1920 x 1080, 768 x 1024, 375 x 812).
- No horizontal page scroll at 1366, 1920, 768 or 375 on all five tabs of all three files.
- About 390 scripted checks passed: dropdown sync in both directions, narrowing, the four dialogs with prefill and validation, limited permissions and tooltips, empty, one-matter and 100-matter states, every tab, calendar navigation, Shows, Add Event, asset sort, filters, search, side panel, Metrics drill-down and toggles, activity chips, window and drawer, tree open, rail, pin, search, keyboard and type-ahead, expand state memory, Browse panel.
- WCAG contrast (4.5:1) checked over every visible text and background pair in 106 view and overlay combinations at 1366 and 375 (tabs, dialogs, menus, tooltips, drawer, window, side panel, tree, Browse panel, empty state): no failures.
- Content width at 1366 x 768: A 1070 px, B 774 px (tree open) and 1006 px (rail), C 1070 px.
- Design review iterations: the first screenshots showed the event card title truncated, the task grid's Due column cut off, the tasks squeezed to 42 px in B when the tree was open, and the C list rows three lines tall. Fixes: header wrapping rules, the grid uses container-width rules (the right-hand panels drop below the list when the content is under 1000 px; Assignee hides under 620 px and Priority moves inside the task cell under 560 px), a two-line clamp and compact indicators in the C list, and the next-date column shortened to an icon, a short type name and a date.

## Open questions for the owner
1. Please confirm the definitions of Overdue and Due date updated (Delayed was merged into Overdue).
2. PM list item 8 is empty. What was meant to go there?
3. **New project without a matter**: must a project belong to a matter? The sample opens the dialog with no matter when none is chosen and asks for one before saving.
4. Who may create what? New permission catalog entries are likely (for example `Assets.Create`, `Projects.Create`, `Events.Manage`), and "limited" here is a placeholder for them. The top-bar "Create task" button: keep or remove?
5. **New window**: a real browser window or tab? It needs a deep-linkable task URL, a permission check on open (sensitive matters), and may be blocked by pop-up blockers. Is the drawer with "Open in new window" acceptable as the default?
6. Asset **Comment** column: one note on the asset, or the latest comment of a thread? Who edits it? Who may change the status to Pending disposition and Disposed, and who approves a disposal?
7. Should the Overview list tasks assigned to other people on the PM's matters (shown here, with the assignee column) or only the PM's own?
8. "Real time": the sample updates instantly on the PM's own clicks. Do other people's changes need to appear without a reload (push) or is a refresh fine?
9. Should the app remember the last chosen client and matter between visits, and the last tab?
10. Event data model and permissions from v2 still apply (see the v2 open questions); the calendar here adds the Shows options, so are "High priority tasks" and "All task due dates" worth keeping, or are Critical and Overdue enough?
11. Docked tree: acceptable at 1600 px and wider only, or not at all?

# My Matters v3 B, revision 2 (`my-matters-v3-b-tree-r2.html`)

Owner feedback: "I like v3 B style." This is one new self-contained file (inline CSS and JS, no network, mock data of v3, today = 31 October 2026). The older files are untouched. Screenshots: `screenshots/my-matters-v3-b-r2-*.png` (both panels open at 1920, tree open, right panel open and collapsed, rail tooltip, 1920, 768, 375, Assets, Metrics, Activity, Calendar, Completed chip, On Hold tooltip, task drawer, and `1366-both-forced-418` which shows why both wide panels are not allowed at 1366).

## What changed

1. **Smaller title.** "My Matters" is 19 px semi-bold (was 28), the icon stays (28 px chip), the title row is about 30 px high.
2. **Dropdowns under the title.** Client and Matter (plus Browse and Clear) sit on their own row; `+ New` is at the right end of that row. On a phone the dropdowns stack and `+ New` is full width.
3. **Collapsible side panel.** Upcoming events on top, Recent activity below. A chevron button in the panel header (`aria-expanded`, `aria-controls`, visible focus) collapses it to a 48 px rail with two icon buttons (events with a count of the next 14 days, activity with the unread count). Hover or keyboard focus shows a tooltip; a click or Enter re-opens the panel and moves focus to that section. The state is remembered in `localStorage` (`mm3r2-ui`) and in the link: `side=0` or `side=1`, `tree=0` or `tree=1`. The grid takes the freed width.
   - **Defaults and the turn-taking rule.** The grid needs at least 560 px. Below about 1510 px the tree and the side panel cannot both be wide, so they take turns: opening one collapses the other to its rail (a polite screen-reader message says so) and the one you used last stays wide. Choosing a matter collapses the tree as in v3 B, and the side panel then opens in the room that was freed (unless you closed it yourself). At 1366 the first load is therefore tree open and side rail; after the first choice it is tree rail and side open. Reason: the tree is needed to choose, the events and activity are needed once a matter is chosen, and the grid never drops below 650 px.
4. **Fit to the window.** Header, title, dropdown row, tabs, status row and pager stay in place; only the frames scroll (grid with sticky header row, calendar month area, assets list, metrics tables, both side-panel sections). The chain is `shell (100dvh) > main > page > work > panel`, all `flex: 1 1 0; min-height: 0`; no pixel heights, only a minimum derived from the row height (header + 5 rows + the card chrome, about 412 px). Below that the page scrolls. Up to 768 px wide the page scrolls normally and tasks are cards. Every frame reaches the bottom gutter even with few rows or an empty result (the empty space is inside the frame).
5. **Task status.** See below.

## Task status
Real statuses of the app (`status-badge.ts`, `work-vocabulary.ts`): **New, In Progress, On Hold, Completed, Cancelled** (Cancelled needs a comment, from any open state).

| Status | Look (icon, word, colour) | More |
|---|---|---|
| New | outlined chip, dot-in-circle, slate blue | not started |
| In Progress | blue chip, play-circle | workflow step as a segmented bar plus "3 of 5" (bar shown from 900 px grid width, text always) |
| On Hold | slate chip, pause | hover or focus: "On hold for 6 days because Waiting for client data" |
| Completed | teal chip, check | tooltip with the date |
| Cancelled | grey chip, x-circle | tooltip with the date and the reason |

The **Status row** above the grid has chips with counts: All open (default, New + In Progress + On Hold), New, In Progress, On Hold, Completed, Cancelled. Completed and Cancelled show only when their chip is chosen. Status is a sortable column (workflow order); urgency order stays the default sort. The task drawer shows Status, workflow step and the hold or cancel reason. The title row has a stacked **workflow bar** (New, In Progress, On Hold, Completed, Cancelled; counts on hover or focus) for the chosen client or matter.

**How the two filters relate.** *Status* answers "where is the work in the workflow"; *Show* (Everything, Overdue, At risk, Unassigned, Critical, Due in 7 days) answers "what needs attention". They combine (AND) and each one's counts respect the other, so every number matches what you get after the click. Overdue, At risk and Due in 7 days only apply to New and In Progress tasks by definition; Critical and Unassigned apply to any status. The old "On hold" entry of Show moved to the Status chips. Changing client or matter resets both. Deep links: `status=open|new|progress|hold|completed|cancelled`, `show=overdue|risk|critical|unassigned|due7`.

## Measurements (Playwright, Chromium)
Width of the task grid card (px):

| Window | Both wide | Tree rail + right open | Tree rail + right rail | Tree open + right rail |
|---|---|---|---|---|
| 1366 x 768 | 426 (not allowed, auto-collapse) | 658 | 950 | 718 (first-load default) |
| 1920 x 1080 | 980 (default) | 1212 | 1504 | 1272 |

The grid adapts with container queries: below 640 px Priority moves into the task cell, below 780 px Assignee is hidden, the step bar needs 900 px.
- Page scroll: `scrollingElement.scrollHeight <= innerHeight` and `main.scrollHeight <= main.clientHeight` on all tabs (Overview, Calendar, Assets, Metrics both views, Activity, with and without a matter) at 1366 x 768 (768 = 768, main 712) and 1920 x 1080 (1080, main 1024): pass; the grid frames scroll inside (for example 1140 px of rows in a 350 px frame).
- Bottom edge: the bottom of every frame (task grid, side-panel last card and rail, calendar, assets, metrics, activity, including few-row and empty cases) is exactly 16 px (the page gutter) above the window bottom at both sizes, 28 states checked.
- 69 scripted checks (panels, memory, keyboard, tooltips, status chips, filters, sort, drawer, dropdowns, four dialogs, calendar, assets panel, 768 and 375) pass; no console errors; WCAG 4.5:1 over 76 view and overlay combinations: 0 failures.
- Design review iterations: first screenshots showed a document scroll height of 1828 px (screen-reader text inside scroll frames escaped them; fixed with positioned frames), clipped Priority and Due cells (columns widened), the status row wrapping onto two lines, an empty-filter message styled as success, a duplicate status in the drawer, and the phone top bar overflowing. All fixed.

## Open questions
1. The real app colours In Progress teal; here it is blue and Completed teal, as asked. Should the app follow?
2. Is "All open" the right name and default for the first chip (the request listed "All")?
3. Where does the workflow bar live in the real matter header (this page has none in B)?
4. Workflow step names and counts are mock data; does the list API return "step n of m" per task?
5. Should the side panel and tree states be remembered per user on the server rather than per browser?
6. Cancelled needs a comment in the app; is the reason in the hover enough in the grid?


# Notes mockup (`notes-mockup.html`)

One self-contained file, no network, system fonts, inline SVG, a small hand-built rich-text editor (no editor library). Mock data only; nothing is saved. Open it in a browser and use the **Mockup** button in the top bar.

(The Mockup button sits in the top bar this time, not bottom right as in the earlier files: at bottom right it covered the editor's Save button.)

## What the owner asked for

Under Matter, a new entity **Notes**: rich text; the author adds **tags** when writing; the UI **groups notes by tag**, so a note with several tags shows up several times; an **admin** creates the tags on the Labels page, under **Notes tags**, and users only pick; notes support **tables, hyperlinks, "tags of names"** and show **who updated last and when**.

### Interpretation to confirm

- **"Notes Tags"** = the admin-managed categories (Privilege, Custodians, Search terms, ...). Users pick up to 5; they cannot create tags.
- **"tags of names"** = **@mentions of people by name inside the text** (type `@`, pick a person from a list, the name becomes a chip). The mockup does not notify anyone: you decided earlier that mentions are not needed for notifications (#737, closed not planned), so a mention here is a visible name chip that links to the person. The mention stores the user id, so a renamed person updates everywhere. **Please confirm this reading.** If you meant something else (for example free-text name labels, or tagging a note with people as a second kind of tag), say so and I will change it.

## What it shows

| Where | What |
|---|---|
| Matter record page | New **Notes** tab after Assets (Overview, Tasks, Projects, Assets, **Notes**), a **Notes 12** count chip in the header (opens the tab), and a "Notes, open the tab" tile plus a "Latest notes" list on Overview. |
| My Matters page | Notes appears as an extra tab for the selected matter (Overview, Calendar, Assets, Metrics, **Notes**, Activity), and the Overview tab gets a small "Recent notes" card. The tree panel can be collapsed to give the notes more room. |
| Notes view | Grouped by tag (one collapsible group per tag: colour chip, name, count; plus a last group **Untagged**), each note with title, 2-line plain-text preview, tag chips, author avatar, and "Updated by <name> . MM/DD hh:mm AM/PM". Search (title and text, with the match highlighted), tag filter (multi-select), sort, Expand/Collapse all, **+ New note**, empty state, loading state, "no match" state. |
| Reader and editor | Read mode renders tables, links and mention chips. Edit mode has the toolbar, the tag picker, a footer with **Created by** and **Last updated by**, Save and Cancel, Delete and Pin. |
| Labels page | New tab **Notes tags** beside Priorities, Status labels and On-hold reasons (create, rename, recolour, deactivate, delete only when unused). |

### How a note with several tags reads (the duplication)

The same note appears under each of its tags. Three cues make that obvious instead of confusing:

1. In every group the note's chip row starts with **this group's tag (ringed)**, then the words **"also in"**, then the other tags. So "Litigation hold: second notice sent" under Hold notices reads *Hold notices, also in Custodians, Privilege*.
2. **Hovering or focusing a note highlights every copy** of it (blue outline), in the list and on the board.
3. The numbers say it: in the tag rail (design B) the footer states "12 notes, 20 tag placements. Counts add up to more than 12 because a note with several tags is counted under each." The header chip counts each note once (12). **Latest first** shows every note exactly once. Switch "Tags per note" to "One tag only" in the Mockup panel to see the same data without repeats.

### The three designs (Mockup panel, Design option)

| | A. Grouped list + editor panel | B. Tag rail + notes + reader | C. Tag board |
|---|---|---|---|
| Layout | Groups fill the left; the reader opens in a right panel. **Edit opens the panel full width** (one click on the shrink icon brings the list back). | Left rail of tags with counts is the grouping (All notes, each tag, Untagged); middle list; right reader and editor. The rail collapses to a 56 px strip of dots. | One column per tag, cards inside, horizontal scroll in the frame. A card opens in a right drawer. |
| View switch | By tag / Latest first | none (the rail is the switch) | Tag board / Latest first |
| Scanning | Best: every note's preview, tags and last update in one column; groups are sticky headers | Good for one tag at a time; the rail shows the shape of the matter | Good for "what is in each bucket", weak for reading previews (about 3 columns visible at 1366) |
| Duplication | Same note repeated down the page, tied together by "also in" and hover | A note is shown once per selected tag, rail counts overlap | The same card sits in several columns side by side: clearest that it is one note |
| Editing comfort | Full-width editor (about 1080 px) or side panel | Reader and editor about 536 px at 1366 (list only 324 px), toolbar wraps | Drawer 580 px, expandable to 980 px |

**Recommendation: A.** At 1366 x 768 it gives the list about 583 px and the reader about 497 px (the editor opens at the full 1080 px); B has a 220 px rail, a 324 px list and a 536 px reader, so the list is narrow and the rail repeats what A's group headers already show; C shows three columns of previews at a time. A is also the only one that reads like a document: scan down, open one, edit full width. Keep B as the option for a matter with many tags on a wide screen (1920) and C for a visual "triage" mode if people ask. On My Matters, with the tree panel open the notes frame is only about 800 px wide, so A and B open the note in a drawer; collapse the tree and they dock. That is a good reason to keep the drawer behaviour in the build.

## The editor

- **Title** (required, 120 characters), **tags** (picker), **body**.
- **Toolbar** (`role="toolbar"`, one tab stop, arrow keys, Home and End move between buttons): text style menu (Paragraph, Heading 1, 2, 3), bold, italic, underline, bulleted list, numbered list, quote, link, table, mention, clear formatting, undo, redo.
- **Link**: dialog with the address (and the text to show if nothing is selected). Accepts `https://` and `onenote:https://` (the same rule as the app's documentation URL); anything else, including `http://`, shows an inline error. Remove link is offered when the cursor is in a link.
- **Table**: inserts 3 x 3 with a header row. A "Table" strip appears while the cursor is in a table: + Row, - Row, + Col, - Col, Header on/off, Delete. **Tab and Shift+Tab move between cells**; at the first or last cell Tab leaves the table as usual (no keyboard trap).
- **Mention**: type `@` (or press the @ button), a list of people opens at the cursor, arrows and Enter or Tab insert a name chip, Esc closes. The list says "no notification".
- **Tag picker**: a multi-select popover (rounded list, colour dot, name, count of notes right-aligned, check at the right), with search. Selected tags are removable chips in the field. The list shows **only active tags**; at 5 selected the others are disabled with a note. Users cannot create tags: the footer says "Ask an administrator" (an administrator gets a link to Labels). An inactive tag that is already on the note stays visible, marked "(inactive)", and can be removed.
- **Footer**: "Created by X . MM/DD hh:mm AM/PM" and "Last updated by Y . MM/DD hh:mm AM/PM" in both read and edit mode, plus an "Unsaved changes" indicator in the header.
- **Unsaved-changes guard**: leaving a dirty editor (another note, Cancel, closing, another tab or screen, the Mockup controls) asks "Discard unsaved changes?". The browser's own prompt covers closing the tab.
- **Concurrent edit**: Mockup panel > "Simulate: someone else saved". A warning banner (`role="alert"`) says who saved and when, with **Reload their version** or **Keep mine**. Save stays blocked until you choose; "Keep mine" shows that saving replaces their version. In the build this is the `rowVersion` check: the save returns 409 and the page shows this banner.
- **Delete**: confirmation dialog that names the tag groups the note will leave. **Pin/Unpin**: pinned notes stay on top of their groups (pin does not change "updated by").
- **Read-only user**: no New, Edit, Pin or Delete; a quiet line explains why.
- **Editor-local keys** (only while the cursor is in the note body, nothing is added to `shortcut-registry.ts`, #420): Ctrl+B bold, Ctrl+I italic, Ctrl+U underline, Ctrl+K link, Ctrl+Z undo, Ctrl+Y or Ctrl+Shift+Z redo, Tab and Shift+Tab inside a table, and the mention list keys (arrows, Enter, Tab, Esc). **Ctrl+K collides with the app's global search shortcut** (Ctrl+K in the top search box): inside the editor it opens the link dialog instead. Open question 13.

## The admin page: Labels > Notes tags

A fourth tab **Notes tags** (marked "New") next to Priorities, Status labels and On-hold reasons, with a primary button **New notes tag**. The table lists the tag chip, colour name, **notes using it**, **Active/Inactive**, and the actions Edit, Deactivate/Activate, Delete.

- **Create and edit** in a dialog: name (40 characters), colour from the **shared task type palette** (the same ten names, so chip contrast is already proven), Active on edit, live preview. **Duplicate names** (case-insensitive) show an inline error. Renaming warns "changes the tag on all N notes".
- **Deactivate**: the notes keep the tag and stay in its group (the group is labelled "inactive"), but the tag leaves the picker. Activate reverses it.
- **Delete only when unused**: with notes on it, a dialog says it cannot be deleted and offers "Deactivate instead"; with 0 notes, a plain confirmation. (Try Privilege for the blocked case and Deadlines for the allowed one; in the "None" data state every tag can be deleted.)
- **Permission note** at the foot of the table: needs the Label manage permission. The build would add `NoteTag.Manage` to `contracts/permissions.json`, like `StatusLabel.Manage`. Anyone who can see a matter can read its notes and pick active tags. A user without the permission sees a "no access" page (Role: Project Manager, then open Labels).
- Tags are ordered A to Z everywhere (table, picker, groups). Question 11 asks whether you want a manual order.

## Design rationale

- **Tokens and look** are those of the My Matters work: navy navigation with the white pill, 22 px page title, calm spacing, white cards on the grey page, no thick coloured left borders (quotes and banners use a tinted box), the shared dropdown (rounded popover, check right, counts right-aligned), coloured chips from the task type palette, MM/DD hh:mm AM/PM dates.
- **Fit to window**: on desktop the page never scrolls; the group list, the board, the editor and the admin table scroll inside their frames with sticky headers (group headers, the editor toolbar, the table head). On a tablet or phone the page scrolls and the panel becomes a full-width drawer.
- **Colour is never the only signal**: every tag chip has its name; pinned, inactive, "also in" and "Unsaved changes" have words or icons; focus is a 2 px amber ring.
- **Why one expand button per group set** ("Collapse all" turns into "Expand all"): one control, one state.

## Definitions (please confirm)

- **Note**: a titled, rich-text entry that belongs to one matter. It has a creator, a last updater, and a version number.
- **Notes tag**: an admin-managed category with a name and a palette colour; active or inactive.
- **Group**: all notes that carry a tag; a note with 3 tags is in 3 groups. **Untagged**: notes with no tag.
- **Updated by / when**: the person and time of the last save. Pinning does not count as an update.
- **Mention**: `@Name` in the body; stores the user id; no notification.

## What to click

1. Matter page, Notes tab: hover "Litigation hold: second notice sent" (it is in three groups; all three copies light up). Collapse a group; press **Collapse all**; switch **Latest first**; search `hold`; filter Tags; change Sort.
2. Open "Privilege log protocol" (table, link, mention chips). **Edit**: the editor opens full width. Try the style menu, Bold, a list, then **table** (Tab between cells, + Row, - Col, Header), **link** (Ctrl+K; try `http://x` then `https://example.com` or `onenote:https://x`), type `@ma` and press Enter, **Add tag** (search, pick, remove), undo and redo.
3. Mockup > **Simulate: someone else saved**, then Reload or Keep mine, then Save. Save, then Delete (confirmation). Start a new note, type a title, then click another note to see the discard guard.
4. Mockup > Design option B and C; Role: Read-only user; Notes on the matter: None, or 120 notes; Tags per note: One tag only; Sensitive matter; Loading state.
5. Screen: My Matters page (open a note, then collapse the tree to dock it). Screen: Admin, Labels > Notes tags: New notes tag (type `privilege` for the duplicate error), Edit, Deactivate, then Delete on Privilege (blocked) and on Deadlines (allowed).
6. **Show stored HTML** (Mockup panel) shows what the server would keep after sanitising, plus the plain-text copy for search.
7. The address records the state, for example `notes-mockup.html#screen=matter&opt=B&role=ro&data=many&note=n4`; keys: `screen` (matter, mymatters, admin), `opt` (A, B, C), `role` (pm, ro, admin), `data` (normal, many, empty), `tagmode` (many, one), `sens` (0, 1), `tab`, `view` (tag, latest, board), `note`.

## Security note for the build

The body is **HTML typed by users**, so the server is the only place that can be trusted:

- **Sanitise on the server with an allow-list** before storing: elements `p, br, strong, em, u, ul, ol, li, blockquote, h1, h2, h3, a, table, thead, tbody, tr, th, td, span`; on `a` only `href` (scheme `https:` or `onenote:https:`; the brief also listed `http:`, the mockup and the app's documentation rule do not accept it, please decide) with `rel="noopener"` forced and no `target`; on `span` only a mention data attribute (`data-user-id`, a number); everything else is dropped. Strip `script`, `style`, event handlers (`onclick` and the like), `img`, `iframe`, `object`, `embed`, `form`, `svg` and inline styles; unwrap unknown elements and keep their text. Use a maintained library (for example HtmlSanitizer or AngleSharp based) rather than regular expressions, and add tests with the usual XSS strings.
- The client only helps: the editor pastes **plain text** (no foreign HTML) and ignores drops, and the mockup runs a small allow-list on Save (see "Show stored HTML"), but the real check is on the server for every write, and the reader should render only what the server returns.
- **Store** the sanitised HTML and a **plain-text copy** for search (and for the 2-line preview). Put a **size limit** on both (the mockup uses 100 KB of HTML; a note rarely needs more) and a title limit (120).
- **Mentions** store a **user id**, never trust the displayed name; resolve the current name when rendering. No notification is sent.
- Links open with `rel="noopener"` in a new tab. Authorisation: reading and writing a note follows the matter (sensitive-matter rules included); a user who cannot see a matter must not get its notes from any endpoint, search or export.
- Audit: create, edit, pin and delete go to the audit log with the user and time.

## Open questions

1. Confirm the reading of **"tags of names"** as @mentions (name chips, no notification), and that **"Notes Tags"** are the admin-managed categories.
2. **Who may add, edit and delete notes?** Suggestion: people who can edit the matter plus the Primary and Secondary PM (the same rule as matter events); everyone who can see the matter can read; sensitive-matter rules apply. May an author delete a colleague's note, or only the author and PMs?
3. **Concurrent edits**: last writer wins with the conflict banner (suggested: `rowVersion`, 409 on save), or lock a note while someone edits it?
4. **Version history**: suggested later (the audit log already records who and when; a per-note history with restore is a separate feature).
5. **Attachments and images**: suggested out of scope for now (images are not in the allow-list; links to the document system cover it).
6. **Delete**: hard or **soft delete**? Suggested soft delete (hidden, recoverable by an administrator, kept in the audit log).
7. **Tag limits per note**: suggested maximum 5 (the mockup enforces it). Required at least one tag, or allow untagged (the mockup allows it and shows an Untagged group)?
8. **Mentions without notification**: confirm that is final (#737). Should a mention link to the person's profile page?
9. **Search**: only within the matter (the mockup), or also in the global search box and a global Notes search? Suggested: matter only first, global later.
10. **Export and print** of notes (one note, or all notes of a matter, perhaps as PDF or Word)?
11. **Order of tags**: A to Z (the mockup) or a manual order the admin sets? Do you want a tag description?
12. **Audit of changes**: log each note save with the changed fields, or only create/delete? (Suggested: every save, no body diff.)
13. **Ctrl+K in the editor**: keep it for the link dialog (it hides the global search shortcut only while typing in a note), or leave it out and use the toolbar button only? Ctrl+B, I, U and Z are normal editor habits.
14. **Editor library**: the mockup uses the browser's built-in editing so it needs no library. The build should use a maintained editor (TipTap or ProseMirror, Quill, CKEditor or Angular-friendly equivalents) that produces the same allow-listed HTML, for tables and undo that behave across browsers. Choice and licence need your OK (bundle limit 700 kB applies).
15. Permission name `NoteTag.Manage` and whether the Notes tab is shown to people with no notes permission at all (it is shown to everyone who can see the matter).

## Measurements (Playwright, Chromium)

- Windows: 1366 x 768, 1920 x 1080, 768 x 1024, 375 x 812; no console errors or page errors in any scripted run.
- Page scroll: on desktop (1366 and 1920) the document and the main area do not scroll in any screen or state (matter, My Matters, Labels, all three designs, empty, 120 notes, drawer open); there is no horizontal page scroll at any size.
- Controls exercised by script: group collapse and expand all, view switch, search and clear, tag filter (search, keyboard, clear), sort, open and edit, toolbar (bold, style menu, table insert, Tab between cells, add and delete row and column, header toggle, undo, redo), link dialog (rejects `ftp://` and `http://`, accepts `onenote:https://`), mention list (filter, Enter), tag picker (add, remove, inactive hidden), save with updated-by and time, conflict banner (Reload, Keep mine), delete confirm, discard guard, pin, design B rail (filter, collapse), design C board and drawer (Esc closes), My Matters tab and tree collapse, tab arrow keys, roving toolbar arrows, all Mockup panel states, admin create, duplicate error, rename, recolour, deactivate, activate, blocked delete, delete unused.
- Contrast: `notes-mockup-contrast.js` (run `node docs/ux/mockups/notes-mockup-contrast.js`) checks the colour pair of every visible text element in 22 states at the four sizes: **0 failures in 88 state and size combinations** (text 4.5:1, large text 3:1; the chips use the task type palette whose pairs are already proven)
- Screenshots (small, 256-colour PNG): `docs/ux/mockups/screenshots/notes-*.png`, for example `notes-A-1366-list-twin.png` (the duplication cues), `notes-A-1366-edit.png`, `notes-A-1366-edit-table.png`, `notes-A-1366-conflict.png`, `notes-B-1366.png`, `notes-C-1366-board.png`, `notes-mymatters-1366-tree-collapsed.png`, `notes-admin-tags-1366.png`, `notes-admin-blocked-delete-1366.png`, and the 1920, 768 and 375 sizes.
- Review iterations: the first build had the Mockup button at bottom right over the Save button (moved to the top bar), an editor so short at 1366 x 768 that the toolbar covered the text (Edit now opens full width and the notes header hides), a table preview that printed stray dots (fixed), drawers that covered the Mockup button (they now start under the top bar), a Labels page with zero height below 1000 px (fixed) and a phone header that took half the screen (compacted).

## Notes for the build

- Tables: `notes` (matter id, title, sanitised html, plain text, created by/at, updated by/at, pinned, row version, deleted flag) and `note_tags` (note id, tag id); `note_tag` (name, colour key, active, unique name). API: list notes of a matter (grouping is a client concern; return tag ids), get, create, update with row version, delete, pin; tags: list active (picker) and admin CRUD. Counts for the tab chip come with the matter's summary.
- Permissions: `NoteTag.Manage` (admin), and note write rights as in question 2. Update `contracts/openapi`, the nswag client and `contracts/permissions.json` together.
