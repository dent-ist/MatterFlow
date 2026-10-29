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
