# Dashboard mockup v4 (issue #997, TH-15)

Mockup and feasibility only, no app code. Open `index.html` by double-clicking (self-contained, tokens inlined from `docs/ux/tokens.css`). Notes on data and endpoints: `feasibility.md`. Screenshots: `screenshots/` (each role at 1366x768, 1920x1080, 1366x600, 768x1024, 375x812; plus states at 1366x768 and 375x812). Check script: `node docs/ux/mockups/dashboard-v4/shots.js check` (global `playwright`): 95 state and size combinations, 0 contrast failures (4.5:1, 3:1 large), 0 console errors, 0 fit failures (the page never scrolls from 768 wide and 561 tall).

Deep links: `index.html#role=pod&n=40&un=pile&gauge=B&card=unassigned&mock=1` (`role` director, pod, tech; `n` workers 0/3/12/40; `rule` pod or exec; `un` none, fresh, mixed, pile; `gauge` A, B, C; `cards` 3 or 4; `state` live, loading, error, stale, empty; `adv` hours to move the clock; `hours` work or clock; `sens` 0 or 1; `without` comma list such as `ViewUsers`).

## Look first
1. Open it: Summary has the 4 cards under the tabs, the task grid left, battery and gauge right.
2. Click a card (it toggles; click again or "Clear filters" clears). Click "Show them, longest waiting first" under the gauge.
3. Mockup toolbox (top right): View as, workers 3 / 12 / 40 / None, unassigned scenarios, "+1 h" clock, gauge styles A / B / C, 3 or 4 cards, loading / error / empty.

## How I read the request
- **Cards.** The current Summary has 4 cards under "Needs attention": Overdue, Unassigned, On hold, ASAP open (`dashboard-page.ts`). That conflicts with the owner decision of 2026-11-02 (3 tiles, no ASAP). The new request says "4 cards", so the mockup shows 4 (order Unassigned, Overdue, On hold, ASAP open, the v3 order plus ASAP last). Toolbox "Cards" shows the 3-card version. **Recommendation:** keep 4 as asked today; it only costs one card, and it restores ASAP visibility (v3 open question 5). Needs the owner's yes.
- **Overview removed**, with Open, Due soon, Completed, Created, the Period control and its scope note. Created and Completed stay on Trends. The Period control goes with it (it only drove Overview and Trends; Trends keeps its own). The Scope dropdown (All pods / My pods / a pod) sits top right of the tab row as in the app today and applies to cards, grid, battery and gauge.
- **Cards filter the grid** (radio-like: one or none, `aria-pressed`, Left/Right arrows move between cards, no new shortcuts). Card counts are scope-wide, not narrowed by Search or Filters (an alert should not shrink when you type); when other filters narrow the grid the title count differs from the card, and chips say why. Counts refresh with the grid (same load).
- **Grid** follows the My Matters / Task Queue standard (theme guide 11.1): title with count, Search, Filters, "Sorted by", Columns, chips with Clear filters, pager (50 rows), standard column order (Ref, Type, Title, CM Number, Matter Name, Project, Priority, Assignee, Due, Status, Progress), numeric dates `MM/DD hh:mm AM/PM`, scrolls sideways inside its frame with Ref pinned. One extra column "Unassigned for" shows while the Unassigned card is on (and sorts longest first).
- **Battery states.** The owner wrote "more than 1 task = occupied", then "2 = busy, 3 = overloaded, none = available". Read literally "more than 1" would start at 2 and clash with "2 = busy". I read it as **0 Available, 1 Occupied, 2 Busy, 3 or more Overloaded** (open tasks New or In progress; On hold not counted by default, toggle in toolbox).
- **Colour.** Lighter to darker by load (proposed tokens `--mf-cap-0..3`, derived from the existing blue). Never colour alone: each cell shows its task count, the legend has words, Out of office is hatched with a no-entry icon, Off hours is dashed with a moon.
- **Charge.** Big number = free capacity: free slots (3 per person minus open tasks, nothing for people out or off hours) over all slots, with "8 of 12 people can take work now" and a word (Healthy 50% or more, Limited 25 to 49, Low under 25). Cells sort light to dark, then Off hours, then Out. Click a cell (one person) or a legend entry (a state) to filter the grid; "People" opens a list. 3 workers: tall bars; 12: 6x2 squares; 40: 13-wide small squares (tooltips and the People list carry names).
- **Gauge logic (parameterised in the toolbox).** Level from the oldest unassigned task: under 1 h Normal (0), 1 h = 1 Warning, 2 h = 2, 3 h = 3, 4 h = 4, 5 h or more = 5 Critical. Then the count raises it: every 5 unassigned tasks adds 1 level, at most 2, capped at 5. Nothing unassigned = calm "All clear". Shows count, oldest age, level word, one "what to do" line, and a button that selects Unassigned sorted longest first. Level changes are announced politely (`aria-live`), only when the level changes. Levels 4 and 5 pulse softly; the pulse is off under `prefers-reduced-motion`.
- **Gauge alternatives:** A half-circle pressure gauge (recommended: reads in one glance, needle position plus numbers 0 to 5), B signal lamps (clear but less room for fine steps), C thermometer with flame (friendly but the scale is less precise). All three carry the same text, so colour is never alone.

## Roles (confirmed in `StarterRoles.cs`)
| | Director / Manager | Pod Lead | Technician |
|---|---|---|---|
| Permissions | all 8 Dashboard.* | View, ViewSummary, ViewSwimlane, ViewUsers, ViewCoverage | View, ViewUnassigned |
| Tabs | 5 | Summary, Swimlane, Users | none (one page "Unassigned work") |
| Cards + grid | yes (ViewSummary) | yes | queue only, no cards |
| Battery | yes (ViewUsers) | yes | no |
| Gauge | yes (ViewSummary) | yes | no |
| Scope default | All pods | My pods | n/a |
The seeded roles have no "Manager": the owner's Manager is the Director role (or a custom role). Project Manager has no Dashboard (unchanged). Without ViewUsers the cards, grid and gauge stay and the battery card says why it is hidden (untick it in the toolbox).

## Decisions and open questions (with my recommendation)
1. **4 or 3 cards?** Recommend 4 as asked. Owner to confirm (conflicts with 2026-11-02).
2. **Who is a worker?** Every seeded role (Director, Project Manager, Pod Lead, Technician, Data Scientist) holds Workflow.Execute, so "Workflow.Execute only" counts managers as workers and inflates capacity (toolbox "as asked" shows it). Recommend **Workflow.Execute and member of an active pod** (the app already has this "can take work" rule). Better long term: a "takes work" flag.
3. **Does On hold count as load?** Recommend no (waiting on others). Toolbox toggle.
4. **Working hours for age?** Recommend count **working hours of the firm** (8 AM to 6 PM, Mon to Fri, configurable) so a task created at 5:55 PM is not Critical at 8 AM; "mixed" shows 16 h 48 m clock versus 2 h 48 m worked (toolbox "clock hours").
5. **Count steps** (every 5 tasks, +2 max) and level thresholds are guesses; owner tunes with the toolbox numbers.
6. **Sensitive matters.** Counts follow visibility like the Users tab (hidden tasks not counted). For capacity this under-counts a person's load; alternative is aggregate-only counts of all tasks (no matter names). Recommend aggregate counts for the battery, visibility-filtered for cards, grid and gauge. Needs owner and security call.
7. **Scope place**: top right of the tab row. Pod Lead default is "My pods". OK?
8. **Gauge for Technicians?** Hidden (they see the queue only). Recommend keep hidden.
9. **Assigning** from the grid or battery is out of scope (v3 had "Assign to me"; not drawn here).
10. **Cells for people out of office who still hold tasks**: shown hatched; their tasks stay in the grid via the "Out of office" legend filter (useful to reassign). Recommend keep.

## Estimate (agent-hours, one agent)
| Part | Frontend only (existing endpoints) | With backend |
|---|---|---|
| Layout: cards row, remove Overview, Scope, fixed page | 2.5 | 2.5 |
| Cards filter the grid (selection, URL state, a11y) | 1.5 | 1.5 |
| Grid in list standard (toolbar, columns, pager, extra column) | 4.0 | 4.0 |
| Battery (cells, legend, popover, 3/12/40, states) | 4.0 (worker = anyone the workload endpoint lists, load from `openTotal`) | 4.0 + 3.0 (worker rule, hold-excluded count, endpoint) |
| Gauge (A) | 2.0 (age from created time of unassigned rows) | 2.0 + 2.5 (real "unassigned since", oldest and count endpoint) |
| Tests, axe at four sizes, e2e updates, contract text | 3.5 | 3.5 + 1.0 (OpenAPI, nswag, backend tests) |
| **Total** | **17.5** | **26.0** |
Frontend-only is a compromise (see `feasibility.md`): wrong worker set and created-not-unassigned age. Not recommended for release; fine for a first demo.
